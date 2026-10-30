/* 拡張APIの差分はこのファイル内に閉じ込める。 */
(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const key = globalThis.HikikomoriNote.settingsKey;
  function isNoteSender(sender) {
    if (sender?.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return false;
    try { return new URL(sender.url).origin === "https://note.com"; }
    catch { return false; }
  }
  async function request(type, patch) {
    let result;
    try { result = await api.runtime.sendMessage({ type, patch }); }
    catch { throw Object.assign(new Error("保存結果を確認できません。状態を再確認してください。操作は自動再送しません。"), { code: "UNCONFIRMED" }); }
    if (!result?.ok) throw Object.assign(new Error(result?.error ?? "拡張の背景処理に接続できません。状態を再確認してください。"), { code: result?.code ?? "UNCONFIRMED" });
    return result.settings;
  }
  globalThis.HikikomoriNotePlatform = Object.freeze({
    isAvailable: () => Boolean(api?.runtime?.id),
    async load() {
      const result = await api.storage.local.get(key);
      return result[key];
    },
    homeUrl: () => api.runtime.getURL("home.html"),
    goBackUnrestricted: () => globalThis.history.back(),
    async goBack() {
      try {
        const navigation = globalThis.navigation;
        if (navigation?.canGoBack !== true || typeof navigation.back !== "function") return false;
        const result = navigation.back();
        // back()が返す完了結果まで確認し、history.backへの代替は行わない。
        result.committed?.catch(() => {});
        if (typeof result.finished?.then !== "function") return false;
        await result.finished;
        return true;
      } catch { return false; }
    },
    getState: () => request("get-state"),
    save: patch => request("save-settings", patch),
    importSettings: patch => request("import-settings", patch),
    author: operation => request("author-operation", operation),
    currentAuthor: (operation, source) => request("current-author-operation", { operation, source, pageUrl: globalThis.location.href }),
    tag: operation => request("tag-operation", operation),
    addCurrentTag: (groupId, selectionRevision) => request("add-current-tag", { groupId, selectionRevision, pageUrl: globalThis.location.href }),
    selectGroup: groupId => request("select-tag-group", { groupId, pageUrl: globalThis.location.href }),
    subscribe(listener) {
      const onChange = (changes, area) => {
        if (area === "local" && Object.hasOwn(changes, key)) listener(changes[key].newValue);
      };
      api.storage.onChanged.addListener(onChange);
      return () => api.storage.onChanged.removeListener(onChange);
    }
  });
  // このポートは背景処理（Service Worker / Firefox Event Page）だけで使用する。
  globalThis.HikikomoriNoteBackgroundPlatform = Object.freeze({
    load: async () => (await api.storage.local.get(key))[key],
    store: settings => api.storage.local.set({ [key]: settings }),
    setRules: rules => api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2, 3, 4], addRules: rules }),
    onMessage: listener => api.runtime.onMessage.addListener(listener),
    onInstalled: listener => api.runtime.onInstalled.addListener(listener),
    onStartup: listener => api.runtime.onStartup.addListener(listener),
    onAction: listener => api.action.onClicked.addListener(listener),
    openHome: (activationFailed = false) => api.tabs.create({
      url: api.runtime.getURL("home.html") + (activationFailed ? "#activation-failed" : "")
    }),
    isNoteSender,
    async currentAuthorPage(sender, pageUrl) {
      if (!isNoteSender(sender)) return null;
      try {
        const tab = await api.tabs.get(sender.tab.id), current = new URL(tab.url);
        if (current.origin !== "https://note.com" || new URL(pageUrl).href !== current.href ||
            (tab.pendingUrl && new URL(tab.pendingUrl).href !== current.href)) return null;
        const core = globalThis.HikikomoriNote;
        if (core.isArticle(current.href)) return { type: "article", user: core.authorId(current.pathname.split("/")[1]) };
        const page = core.pageKind(current.href);
        return page?.type === "profile" ? { type: "profile", user: core.authorId(page.user) } : null;
      } catch { return null; }
    },
    async currentMenuPage(sender, pageUrl) {
      if (!isNoteSender(sender)) return null;
      try {
        // sender.urlはSPA遷移後の表示URLと異なる場合がある。ホスト権限で現在のタブを確認する。
        const tab = await api.tabs.get(sender.tab.id);
        const current = new URL(tab.url);
        if (current.origin !== "https://note.com" || new URL(pageUrl).href !== current.href) return null;
        if (tab.pendingUrl && new URL(tab.pendingUrl).href !== current.href) return null;
        const page = globalThis.HikikomoriNote.pageKind(current.href);
        return ["following", "tag", "search", "topic"].includes(page?.type) ? page : null;
      } catch { return null; }
    },
    isHomeSender: sender => sender?.id === api.runtime.id &&
      sender.url?.split(/[?#]/)[0] === api.runtime.getURL("home.html")
  });
})();
