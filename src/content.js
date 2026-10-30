/* ホームと、利用者が無効化したダッシュボードへの導線を扱う。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  function readView(value) {
    const state = core.readSettings(value);
    if (value?.tagWarning) state.tagWarning = value.tagWarning;
    if (value?.groupSelectionInvalid) state.groupSelectionInvalid = true;
    if (value?.authorWarning) state.authorWarning = value.authorWarning;
    return state;
  }
  const noteUi = globalThis.HikikomoriNoteUi?.create(document, window, {
    settingsUrl: () => platform.homeUrl(),
    async setAuthor(operation, source) {
      const before = revision;
      const value = await platform.currentAuthor(operation, source);
      if (!stopped && revision === before) { settings = readView(value); checkHome(); }
    },
    async addCurrentTag(groupId, selectionRevision) {
      const before = revision;
      const value = await platform.addCurrentTag(groupId, selectionRevision);
      if (!stopped && revision === before) { settings = readView(value); checkHome(); }
    },
    async selectGroup(groupId) {
      const before = revision;
      const value = await platform.selectGroup(groupId);
      if (!stopped && revision === before) { settings = readView(value); checkHome(); }
    },
    async refresh() {
      const before = revision;
      const value = await platform.load();
      if (!stopped && revision === before) { settings = readView(value); checkHome(); }
    }
  });
  let settings;
  let revision = 0;
  let stopped = false;
  let unsubscribe;
  let interval;
  let observer;
  let scheduled = false;
  let logoBackPending = false;
  async function logoBack() {
    if (logoBackPending) return;
    logoBackPending = true;
    try {
      await platform.goBack();
    } catch {
      // 戻れない・API利用不可・失敗時は現在のページにとどまる。
    } finally { logoBackPending = false; }
  }
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
    window.removeEventListener("resize", checkHome);
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
    else if (!stopped) noteUi?.prepareSidebar?.(location.href);
  }
  function scheduleSync(records) {
    const own = node => node.nodeType === 1 && (node.hasAttribute?.("data-hikikomori-note-owned") || node.closest?.("[data-hikikomori-note-owned]"));
    if (records?.length && records.every(record => own(record.target) ||
        (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].length &&
          [...record.addedNodes, ...record.removedNodes].every(own)))) return;
    noteUi?.invalidatePaidCards?.();
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!stopped) { syncDashboardLinks(); checkHome(); } });
  }
  function onClick(event) {
    if (!enabled() || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(node => node?.tagName === "A");
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    if (settings.noteLogoBrowserBack && event.isTrusted === true && event.cancelable === true && core.isHome(anchor.href) &&
        globalThis.HikikomoriNoteUi?.isOfficialHeaderLogo(anchor, location.href)) {
      event.preventDefault(); event.stopImmediatePropagation();
      void logoBack();
      return;
    }
    // クリック時の委譲処理なので、SPAで後から追加された公式タブにも対応する。
    const articleTabUrl = !settings.legacyMode && anchor.getAttribute?.("data-id") === "NavigationItem" &&
      anchor.textContent?.trim() === "記事" ? core.articleSearchTabUrl(location.href, anchor.href) : null;
    if (articleTabUrl) {
      event.preventDefault(); event.stopImmediatePropagation(); location.assign(articleTabUrl); return;
    }
    if (!core.shouldRedirect(anchor.href, settings)) return;
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
      window.addEventListener("resize", checkHome);
      window.navigation?.addEventListener("navigate", onNavigate);
      window.navigation?.addEventListener("currententrychange", checkHome);
      observer = new MutationObserver(scheduleSync);
      observer.observe(document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["href", "class", "hidden", "style"] });
      noteUi?.prepareSidebar?.(location.href);
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
      syncDashboardLinks();
      checkHome();
      interval = setInterval(checkHome, 250);
    } catch (error) { stop(); console.warn("ひきこもりnote：ホーム導線の切替を停止しました。", error); }
  }
  void start();
})();
