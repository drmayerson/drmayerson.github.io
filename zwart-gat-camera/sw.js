// Zwart gat camera: offline cache (service worker).
// After one visit with internet, the page also starts without internet: the page itself,
// the texts, the background pictures, the fonts, the QR library and (once they have been
// used) the person-recognition files are kept on this computer.
// - page and texts: fetched fresh when there is internet (so updates arrive), from the
//   cache when there is none or it takes longer than 4 s;
// - everything else (pictures, fonts, fixed library versions, AI models): cache first.
// The photo service (QR codes) is never cached.
const CACHE = 'zgc-offline-v1';
const SCOPE = new URL('./', self.location).pathname;          // /zwart-gat-camera/
const CORE = [
  './', 'teksten.js',
  'achtergronden/aarde.jpg', 'achtergronden/aardopgang.jpg', 'achtergronden/maan.jpg',
  'achtergronden/pilaren.jpg', 'achtergronden/diep-heelal.jpg',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'storage.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(new Request(u, {mode: u.startsWith('http') ? 'cors' : 'same-origin', cache: 'reload'}))
      .catch(err => console.warn('offline cache: could not store', u, err)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('zgc-offline-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (own && !url.pathname.startsWith(SCOPE)) return;          // other pages of this site
  if (!own && !CDN.includes(url.hostname)) return;             // e.g. the photo service
  const fresh = own && (req.mode === 'navigate' || url.pathname === SCOPE ||
                        url.pathname.endsWith('/index.html') || url.pathname.endsWith('/teksten.js'));
  e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req){
  const c = await caches.open(CACHE);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
    if (r.ok) c.put(stripSearch(req), r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req, {ignoreSearch: true});
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req){
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}

// the page is stored without ?pinreset etc., so it is found again with any address suffix
function stripSearch(req){
  const u = new URL(req.url); u.search = '';
  return u.href;
}
