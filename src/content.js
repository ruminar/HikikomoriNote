/* noteページではホームへの導線だけを扱い、画面のDOMを隠さない。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  let settings;
  let revision = 0;
  let stopped = false;
  let unsubscribe;
  let interval;
  function stop() {
    stopped = true;
    clearInterval(interval);
    try { unsubscribe?.(); } catch { /* 拡張の再読み込み */ }
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("popstate", checkHome);
    window.removeEventListener("pageshow", checkHome);
    window.navigation?.removeEventListener("navigate", onNavigate);
    window.navigation?.removeEventListener("currententrychange", checkHome);
  }
  function enabled() {
    if (stopped) return false;
    try { if (!platform.isAvailable()) { stop(); return false; } }
    catch { stop(); return false; }
    return settings?.enabled === true;
  }
  function checkHome() {
    if (enabled() && core.isHome(location.href)) location.replace(platform.homeUrl());
  }
  function onClick(event) {
    if (!enabled() || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(node => node?.tagName === "A");
    if (!anchor || anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self") || !core.isHome(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(platform.homeUrl());
  }
  function onNavigate(event) {
    if (!enabled() || !event.cancelable || !core.isHome(event.destination.url)) return;
    event.preventDefault();
    location.assign(platform.homeUrl());
  }
  async function start() {
    try {
      document.addEventListener("click", onClick, true);
      window.addEventListener("popstate", checkHome);
      window.addEventListener("pageshow", checkHome);
      window.navigation?.addEventListener("navigate", onNavigate);
      window.navigation?.addEventListener("currententrychange", checkHome);
      unsubscribe = platform.subscribe(value => {
        if (stopped) return;
        revision++;
        settings = core.readSettings(value);
        checkHome();
      });
      const before = revision;
      const stored = await platform.load();
      if (stopped) return;
      if (revision === before) settings = core.readSettings(stored);
      checkHome();
      interval = setInterval(checkHome, 250);
    } catch (error) { stop(); console.warn("ひきこもりnote：ホーム導線の切替を停止しました。", error); }
  }
  void start();
})();
