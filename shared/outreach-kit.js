/* Outreach kit: shared header link, credit line and kiosk idle reset for the
   gravitational-wave outreach apps on this site.

   Usage (at the end of <body>):
     <script src="../shared/outreach-kit.js" data-header="top-left" data-credit="footer"></script>

   Script attributes
     data-header   "top-left" (default) | "top-right" | "none"  -> "← Projecten" pill
     data-credit   "footer" (default) | "none"                   -> one-line credit at the end of <body>
     data-idle     seconds of inactivity before a kiosk reset (default 75)
     data-kiosk    "url" (default: kiosk only with ?kiosk=1) | "always" | "never"

   Page API (all optional)
     window.OutreachKit.setLang('nl'|'en'|'fr')   re-labels the kit's own texts
     window.OutreachKit.onReset = fn              called on idle reset instead of a reload
     window.OutreachKit.kiosk                     true when kiosk mode is on
     window.OutreachKit.invite(text)              shows the "touch to start" overlay now

   In kiosk mode an idle reset reloads the page in Dutch (?kiosk=1), unless the
   page sets onReset. After the reload an invitation overlay waits for a touch. */
(function () {
  'use strict';
  var me = document.currentScript;
  var opt = function (k, d) { var v = me && me.getAttribute('data-' + k); return v == null ? d : v; };
  var params = new URLSearchParams(location.search);
  var kioskMode = opt('kiosk', 'url');
  var kiosk = kioskMode === 'always' || (kioskMode !== 'never' && params.get('kiosk') === '1');
  var idleSec = parseFloat(opt('idle', '75')) || 75;

  var T = {
    nl: { back: '← Projecten', credit: 'Leuven Gravity Institute, KU Leuven · voor de Einstein Telescope', invite: 'Raak het scherm aan om te beginnen' },
    en: { back: '← Projects', credit: 'Leuven Gravity Institute, KU Leuven · for the Einstein Telescope', invite: 'Touch the screen to start' },
    fr: { back: '← Projets', credit: 'Leuven Gravity Institute, KU Leuven · pour l’Einstein Telescope', invite: 'Touchez l’écran pour commencer' }
  };
  var lang = (document.documentElement.lang || 'nl').slice(0, 2);
  if (!T[lang]) lang = 'nl';

  var css = [
    '.ok-back{position:fixed;top:10px;z-index:9000;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    'padding:7px 11px;border-radius:999px;text-decoration:none;color:#e9eef7;background:rgba(10,14,24,.72);',
    'border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '.ok-back:hover,.ok-back:focus-visible{background:rgba(30,40,60,.9);outline:2px solid #7fd1ff;outline-offset:2px}',
    '.ok-back.tl{left:10px}.ok-back.tr{right:10px}',
    '.ok-credit{font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:.7;text-align:center;padding:14px 16px 18px}',
    '.ok-invite{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;',
    'background:rgba(4,7,14,.55);cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.ok-invite span{font:700 clamp(20px,3.4vw,38px)/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;',
    'padding:22px 34px;border-radius:20px;background:rgba(10,14,24,.85);border:1px solid rgba(255,255,255,.25);',
    'animation:okp 2.2s ease-in-out infinite;text-align:center;max-width:86vw}',
    '@keyframes okp{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
    '@media (prefers-reduced-motion:reduce){.ok-invite span{animation:none}}',
    'body.ok-kiosk .ok-back{display:none}'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var back = null, credit = null, inviteEl = null;
  var hdr = opt('header', 'top-left');
  if (hdr !== 'none') {
    back = document.createElement('a');
    back.className = 'ok-back ' + (hdr === 'top-right' ? 'tr' : 'tl');
    back.href = '../';
    document.body.appendChild(back);
  }
  if (opt('credit', 'footer') !== 'none') {
    credit = document.createElement('div');
    credit.className = 'ok-credit';
    document.body.appendChild(credit);
  }
  function label() {
    var t = T[lang];
    if (back) { back.textContent = t.back; back.setAttribute('aria-label', t.back.replace('← ', '')); }
    if (credit) credit.textContent = t.credit;
    if (inviteEl) inviteEl.firstChild.textContent = inviteEl._custom || t.invite;
  }
  label();

  function invite(text) {
    if (inviteEl) return;
    inviteEl = document.createElement('div');
    inviteEl.className = 'ok-invite';
    inviteEl.setAttribute('role', 'button');
    inviteEl._custom = text || '';
    inviteEl.appendChild(document.createElement('span'));
    label();
    var go = function (e) { e.preventDefault(); e.stopPropagation(); inviteEl.remove(); inviteEl = null; poke(); };
    inviteEl.addEventListener('pointerdown', go);
    inviteEl.addEventListener('keydown', go);
    document.body.appendChild(inviteEl);
  }

  var timer = 0;
  function reset() {
    if (typeof api.onReset === 'function') {
      try { api.onReset(); } catch (e) { console.error(e); }
      api.setLang('nl');
      invite();
    } else {
      var u = new URL(location.href); u.searchParams.set('kiosk', '1'); u.searchParams.delete('lang');
      location.replace(u.toString());
    }
  }
  function poke() {
    if (!kiosk) return;
    clearTimeout(timer);
    timer = setTimeout(function () { if (!inviteEl) reset(); else poke(); }, idleSec * 1000);
  }
  if (kiosk) {
    document.body.classList.add('ok-kiosk');
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, poke, { capture: true, passive: true });
    });
    poke();
  }

  var api = window.OutreachKit = {
    kiosk: kiosk,
    onReset: null,
    invite: invite,
    poke: poke,
    setLang: function (l) { l = String(l || 'nl').slice(0, 2); if (T[l]) { lang = l; label(); } }
  };
  if (kiosk && opt('invite', 'on') !== 'off') invite();
})();
