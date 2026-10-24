/* 拡張APIの差分はこのファイル内に閉じ込める。 */
(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const key = globalThis.HikikomoriNote.settingsKey;
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
    getState: () => request("get-state"),
    save: patch => request("save-settings", patch),
    tag: operation => request("tag-operation", operation),
    addCurrentTag: () => request("add-current-tag"),
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
    currentTag: sender => {
      if (sender?.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return null;
      const page = globalThis.HikikomoriNote.pageKind(sender.url);
      return page?.type === "tag" ? page.tag : null;
    },
    isHomeSender: sender => sender?.id === api.runtime.id &&
      sender.url?.split(/[?#]/)[0] === api.runtime.getURL("home.html")
  });
})();
