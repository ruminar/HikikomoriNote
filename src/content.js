/* ホームと、利用者が無効化したダッシュボードへの導線を扱う。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const noteUi = globalThis.HikikomoriNoteUi?.create(document, window, {
    async addCurrentTag() {
      const before = revision;
      const value = await platform.addCurrentTag();
      if (!stopped && revision === before) { settings = core.readSettings(value); checkHome(); }
    },
    async refresh() {
      const before = revision;
      const value = await platform.load();
      if (!stopped && revision === before) { settings = core.readSettings(value); checkHome(); }
    }
  });
  let settings;
  let revision = 0;
  let stopped = false;
  let unsubscribe;
  let interval;
  let observer;
  let scheduled = false;
  const hiddenLinks = new Set();
  const dashboardMarker = "data-hikikomori-note-dashboard-hidden";
  function restoreLinks() {
    for (const anchor of hiddenLinks) anchor.removeAttribute(dashboardMarker);
    hiddenLinks.clear();
  }
  function syncDashboardLinks() {
    if (!enabled()) { restoreLinks(); return; }
    const hide = settings.dashboardDisabled === true;
    for (const anchor of hiddenLinks) {
      if (!hide || !anchor.isConnected || !core.isDashboard(anchor.href)) {
        anchor.removeAttribute(dashboardMarker);
        hiddenLinks.delete(anchor);
      }
    }
    if (!hide) return;
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (core.isDashboard(anchor.href) && !hiddenLinks.has(anchor)) {
        anchor.setAttribute(dashboardMarker, "");
        hiddenLinks.add(anchor);
      }
    }
  }
  function stop() {
    stopped = true;
    clearInterval(interval);
    observer?.disconnect();
    restoreLinks();
    noteUi?.stop();
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
    if (enabled() && core.shouldRedirect(location.href, settings)) location.replace(platform.homeUrl());
    if (!stopped && settings) noteUi?.update(settings, location.href);
  }
  function scheduleSync(records) {
    const own = node => node.nodeType === 1 && (node.hasAttribute?.("data-hikikomori-note-owned") || node.closest?.("[data-hikikomori-note-owned]"));
    if (records?.length && records.every(record => own(record.target) ||
        (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].length &&
          [...record.addedNodes, ...record.removedNodes].every(own)))) return;
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!stopped) { syncDashboardLinks(); checkHome(); } });
  }
  function onClick(event) {
    if (!enabled() || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(node => node?.tagName === "A");
    if (!anchor || anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self") || !core.shouldRedirect(anchor.href, settings)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(platform.homeUrl());
  }
  function onNavigate(event) {
    if (!enabled() || !event.cancelable || !core.shouldRedirect(event.destination.url, settings)) return;
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
        syncDashboardLinks();
        checkHome();
      });
      const before = revision;
      const stored = await platform.load();
      if (stopped) return;
      if (revision === before) settings = core.readSettings(stored);
      observer = new MutationObserver(scheduleSync);
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
      syncDashboardLinks();
      checkHome();
      interval = setInterval(checkHome, 250);
    } catch (error) { stop(); console.warn("ひきこもりnote：ホーム導線の切替を停止しました。", error); }
  }
  void start();
})();
