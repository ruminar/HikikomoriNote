/* note埋め込み内だけでスキ数を制御する。記事本文・作者UI・背景処理への操作要求は扱わない。 */
(() => {
  "use strict";
  const ready = "data-hikikomori-note-embed-ready";
  function reveal() { document.documentElement?.setAttribute(ready, ""); }
  let url;
  try { url = new URL(location.href); } catch { reveal(); return; }
  if (url.origin !== "https://note.com" || !/^\/embed\/notes\/n[a-zA-Z0-9]+\/?$/.test(url.pathname)) { reveal(); return; }
  const core = globalThis.HikikomoriNote, platform = globalThis.HikikomoriNotePlatform;
  const likes = globalThis.HikikomoriNoteUi.createLikeVisibility(document);
  let settings, revision = 0, stopped = false;
  function sync() {
    if (stopped || !settings) return;
    likes.invalidate(); likes.update(settings, location.href);
    // 設定とDOMの厳密な検証が完了するまで、先行CSSで既知のスキ欄だけを覆う。
    reveal();
  }
  const observer = new MutationObserver(sync);
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["class", "href", "role", "tabindex", "onclick", "contenteditable", "data-hikikomori-note-owned"] });
  const unsubscribe = platform.subscribe(value => { if (!stopped) { revision++; settings = core.readSettings(value); sync(); } });
  const before = revision;
  platform.load().then(value => {
    if (stopped || revision !== before) return;
    settings = core.readSettings(value); sync();
  }).catch(() => { if (!stopped && revision === before) { settings = core.readSettings(); sync(); } });
  document.addEventListener("DOMContentLoaded", sync);
  function stop() {
    if (stopped) return;
    stopped = true; observer.disconnect(); unsubscribe(); likes.stop(); reveal();
    document.removeEventListener("DOMContentLoaded", sync);
  }
  window.addEventListener("pagehide", event => { if (!event.persisted) stop(); });
  window.addEventListener("pageshow", sync);
})();
