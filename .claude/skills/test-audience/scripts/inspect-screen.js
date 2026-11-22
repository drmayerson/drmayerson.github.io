// Paste this whole file into the browser's javascript tool on each screen of the walkthrough.
// It returns what a visitor can actually see right now: visible text (above and below the fold),
// word counts, visible controls with their size, and the smallest visible font size.
// Inspection only: it changes nothing on the page.
(() => {
  const vh = innerHeight, vw = innerWidth;
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const words = t => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,]*/gu) || []).length;
  // visible text blocks, split by fold
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const above = [], below = [];
  let minFont = 99, minFontText = '';
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t || !n.parentElement || !visible(n.parentElement)) continue;
    if (n.parentElement.closest('script,style,noscript,template,[aria-hidden="true"] svg')) continue;
    const det = n.parentElement.closest('details:not([open])');
    if (det && !n.parentElement.closest('summary')) continue; // inside a closed <details>
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const top = r.top + scrollY;
    const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (fs < minFont) { minFont = fs; minFontText = t.slice(0, 40); }
    (r.top < vh && r.bottom > 0 ? above : below).push({ top: Math.round(top), fs: Math.round(fs), t });
  }
  const join = a => a.sort((x, y) => x.top - y.top).map(x => x.t).join(' | ');
  // visible controls
  const ctrls = [...document.querySelectorAll('button,a[href],input,select,textarea,summary,[role=button],[onclick],canvas')]
    .filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
      return { tag: el.tagName.toLowerCase(), label, w: Math.round(r.width), h: Math.round(r.height),
               x: Math.round(r.left), y: Math.round(r.top + scrollY), inView: r.top < vh && r.bottom > 0,
               disabled: !!el.disabled };
    });
  const aboveText = join(above), belowText = join(below);
  return {
    viewport: `${vw}x${vh}`, scrollY: Math.round(scrollY), pageHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > vw,
    lang: document.documentElement.lang, title: document.title,
    wordsAboveFold: words(aboveText), wordsBelowFold: words(belowText),
    textAboveFold: aboveText, textBelowFold: belowText,
    smallestFontPx: minFont === 99 ? null : minFont, smallestFontSample: minFontText,
    controls: ctrls,
    smallControls: ctrls.filter(c => !c.disabled && c.tag !== 'canvas' && (c.w < 44 || c.h < 44)).map(c => `${c.label} ${c.w}x${c.h}`),
  };
})()
