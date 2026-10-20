/* 拡張APIの差分はこのファイル内に閉じ込める。 */
(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const key = globalThis.HikikomoriNote.settingsKey;
  async function request(type, patch) {
    const result = await api.runtime.sendMessage({ type, patch });
    if (!result?.ok) throw new Error(result?.error ?? "拡張の背景処理に接続できません。拡張を再読み込みしてください。");
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
    setRules: rules => api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2], addRules: rules }),
    onMessage: listener => api.runtime.onMessage.addListener(listener),
    onInstalled: listener => api.runtime.onInstalled.addListener(listener),
    onStartup: listener => api.runtime.onStartup.addListener(listener),
    onAction: listener => api.action.onClicked.addListener(listener),
    openHome: () => api.tabs.create({ url: api.runtime.getURL("home.html") }),
    isHomeSender: sender => sender?.id === api.runtime.id &&
      sender.url?.split(/[?#]/)[0] === api.runtime.getURL("home.html")
  });
})();
