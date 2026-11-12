// Zwart gat camera: photo service for the QR-code download mode (a Cloudflare Worker).
// See SETUP.md in this folder for the step-by-step setup.
//
// Bindings (Worker -> Settings -> Bindings / Variables and Secrets):
//   PHOTOS_KV       KV namespace binding (recommended: free plan, no payment method), or
//   PHOTOS          R2 bucket binding (alternative; R2 needs a payment method on file)
//   BOOTH_KEY       secret: only uploads carrying this key are accepted
//   ALLOWED_ORIGIN  optional text variable, e.g. https://drmayerson.github.io
//                   (comma-separated list allowed); empty = any web page may call
//
// Routes:
//   POST /upload    body = JPEG, headers X-Booth-Key, X-Photo-Name  -> {id, page, expires}
//   GET  /check     header X-Booth-Key                              -> {ok: true}
//   GET  /p/<id>    small download page for visitors (what the QR code opens)
//   GET  /f/<id>    the photo itself (?download=1 to save it as a file)
//
// Photos are deleted 24 hours after the upload. The id starts with the upload time, so
// the Worker refuses anything older than that; KV also deletes entries by itself after
// 24 hours (expirationTtl), for R2 add a lifecycle rule (see SETUP.md).

const KEEP_MS = 24*60*60*1000;
const MAX_BYTES = 6*1024*1024;
const ID_RE = /^([0-9a-z]{6,12})\.([A-Za-z0-9_-]{22})$/;

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    const st = storage(env);
    if (!st) return json({error: 'Geen opslag gekoppeld (PHOTOS_KV of PHOTOS).'}, 500, cors);

    if (url.pathname === '/upload' && req.method === 'POST') {
      if (!(await keyOK(req, env))) return json({error: 'verkeerde standsleutel'}, 403, cors);
      if ((req.headers.get('Content-Type') || '').split(';')[0].trim() !== 'image/jpeg') return json({error: 'alleen JPEG'}, 415, cors);
      const body = await req.arrayBuffer(), b = new Uint8Array(body);
      if (body.byteLength > MAX_BYTES) return json({error: 'foto te groot'}, 413, cors);
      if (body.byteLength < 100 || b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF) return json({error: 'geen JPEG'}, 415, cors);
      const now = Date.now(), id = now.toString(36) + '.' + randomPart();
      const name = (req.headers.get('X-Photo-Name') || 'zwart-gat.jpg').replace(/[^\w.-]/g, '').slice(0, 80) || 'zwart-gat.jpg';
      await st.put(id, body, name);
      return json({id, page: url.origin + '/p/' + id, expires: now + KEEP_MS}, 200, cors);
    }

    if (url.pathname === '/check' && req.method === 'GET') {
      if (!(await keyOK(req, env))) return json({error: 'verkeerde standsleutel'}, 403, cors);
      return json({ok: true, keepHours: KEEP_MS/3600000}, 200, cors);
    }

    let m = url.pathname.match(/^\/f\/([^/]+?)(\.jpg)?$/);
    if (m && req.method === 'GET') {
      const id = m[1], age = ageOf(id);
      const obj = age != null && age < KEEP_MS ? await st.get(id) : null;
      if (!obj) {
        if (age != null && age >= KEEP_MS) await st.del(id).catch(() => {});
        return new Response('Deze foto is niet (meer) beschikbaar.', {status: 404, headers: privateHeaders({'Content-Type': 'text/plain; charset=utf-8'})});
      }
      const disp = url.searchParams.has('download') ? 'attachment' : 'inline';
      return new Response(obj.body, {headers: privateHeaders({
        'Content-Type': 'image/jpeg',
        'Content-Disposition': disp + '; filename="' + (obj.name || 'zwart-gat.jpg') + '"',
        'Cache-Control': 'private, max-age=3600'})});
    }

    m = url.pathname.match(/^\/p\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const id = m[1], age = ageOf(id);
      let state = 'gone';
      if (age != null && age < KEEP_MS) {
        if (await st.exists(id)) state = 'ok';
        else if (age < 120000) state = 'wait';   // just uploaded; storage may need a moment
      }
      return new Response(page(state, id, age), {status: state === 'gone' ? 404 : 200,
        headers: privateHeaders({'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'})});
    }

    if (url.pathname === '/' && req.method === 'GET') return new Response('Zwart gat camera: fotodienst actief.', {headers: privateHeaders({'Content-Type': 'text/plain; charset=utf-8'})});
    return new Response('Niet gevonden.', {status: 404, headers: privateHeaders({'Content-Type': 'text/plain; charset=utf-8'})});
  }
};

// one interface for both kinds of storage
function storage(env){
  if (env.PHOTOS_KV) {
    const kv = env.PHOTOS_KV;
    return {
      put: (id, body, name) => kv.put(id, body, {expirationTtl: Math.round(KEEP_MS/1000), metadata: {name}}),
      async get(id){
        const r = await kv.getWithMetadata(id, {type: 'stream'});
        return r && r.value ? {body: r.value, name: r.metadata && r.metadata.name} : null;
      },
      async exists(id){
        const r = await kv.get(id, {type: 'stream'});
        if (r) { await r.cancel(); return true; }
        return false;
      },
      del: id => kv.delete(id)
    };
  }
  if (env.PHOTOS) {
    const r2 = env.PHOTOS;
    return {
      put: (id, body, name) => r2.put(id, body, {httpMetadata: {contentType: 'image/jpeg'}, customMetadata: {name}}),
      async get(id){
        const o = await r2.get(id);
        return o ? {body: o.body, name: o.customMetadata && o.customMetadata.name} : null;
      },
      exists: async id => !!(await r2.head(id)),
      del: id => r2.delete(id)
    };
  }
  return null;
}

// milliseconds since the upload (the id starts with the upload time), or null if not an id
function ageOf(id){
  const m = ID_RE.exec(id);
  if (!m) return null;
  const t = parseInt(m[1], 36);
  return Number.isFinite(t) ? Date.now() - t : null;
}

async function keyOK(req, env){
  const got = req.headers.get('X-Booth-Key') || '', want = env.BOOTH_KEY || '';
  if (!want || got.length !== want.length) return false;
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(want);
  if (a.length !== b.length) return false;
  if (crypto.subtle && crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}

function randomPart(){         // 128 random bits, base64url (22 characters)
  const r = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...r)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders(req, env){
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Booth-Key, X-Photo-Name',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function privateHeaders(h){ return Object.assign({'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer'}, h); }
function json(o, status, extra){
  return new Response(JSON.stringify(o), {status, headers: Object.assign({'Content-Type': 'application/json'}, extra)});
}

function page(state, id, age){
  const head = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">' +
    (state === 'wait' ? '<meta http-equiv="refresh" content="3">' : '') +
    '<title>Je foto met het zwarte gat</title><style>' +
    'body{margin:0;background:#0b0718;color:#f3ecff;font:17px/1.45 "Helvetica Neue",Arial,system-ui,sans-serif;text-align:center}' +
    'main{max-width:640px;margin:0 auto;padding:20px 16px 32px}h1{font-size:1.4rem;margin:8px 0 16px}' +
    'img{width:100%;height:auto;border-radius:14px;display:block;background:#000}' +
    'a.btn{display:inline-block;margin:18px 0 10px;padding:14px 22px;border-radius:14px;background:#ff6c9c;color:#1b0f2c;font-weight:700;text-decoration:none}' +
    'p{color:#c3b6e0;margin:6px 0}</style></head><body><main>';
  if (state === 'gone') return head + '<h1>Deze foto is niet meer beschikbaar</h1><p>Foto\'s worden 24 uur na het maken automatisch gewist.</p></main></body></html>';
  if (state === 'wait') return head + '<h1>Je foto wordt klaargezet…</h1><p>Een ogenblik: deze pagina ververst vanzelf.</p></main></body></html>';
  const left = Math.max(1, Math.round((KEEP_MS - age)/3600000));
  return head + '<h1>Je foto met het zwarte gat</h1>' +
    '<img src="/f/' + id + '.jpg" alt="Je foto, afgebogen door een zwart gat">' +
    '<a class="btn" href="/f/' + id + '.jpg?download=1">Foto downloaden</a>' +
    '<p>Lukt downloaden niet? Houd de foto ingedrukt en kies "Bewaar".</p>' +
    '<p>Deze foto wordt over ongeveer ' + left + ' uur automatisch gewist.</p></main></body></html>';
}
