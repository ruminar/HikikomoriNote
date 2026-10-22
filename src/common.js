/* ブラウザAPIにもnoteのDOM構造にも依存しない処理。 */
(() => {
  "use strict";
  const settingsKey = "hikikomoriNote.settings.v1";
  function isHome(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://note.com" && parsed.pathname === "/";
    } catch { return false; }
  }
  function normalizeUserId(value) {
    let id = String(value ?? "").trim();
    if (!id) return "";
    if (id.startsWith("https://")) {
      let url;
      try { url = new URL(id); } catch { throw new Error("プロフィールURLを確認してください。"); }
      if (url.origin !== "https://note.com" || !/^\/[a-zA-Z0-9_]+\/?$/.test(url.pathname)) {
        throw new Error("noteの公開プロフィールURLを入力してください。");
      }
      id = url.pathname.split("/")[1];
    }
    if (!/^[a-zA-Z0-9_]+$/.test(id)) {
      throw new Error("ユーザー名は半角英数字とアンダースコアで入力してください。");
    }
    return id;
  }
  function isDashboard(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://note.com" &&
        (parsed.pathname === "/dashboard" || parsed.pathname.startsWith("/dashboard/"));
    } catch { return false; }
  }
  function shouldRedirect(url, settings) {
    return settings?.enabled === true &&
      (isHome(url) || (settings.dashboardDisabled === true && isDashboard(url)));
  }
  function readSettings(value) {
    let noteUserId = "";
    try { noteUserId = normalizeUserId(value?.noteUserId); } catch { /* 破損値は空欄へ */ }
    return { enabled: value?.enabled !== false, noteUserId, dashboardDisabled: value?.dashboardDisabled === true };
  }
  function profileUrl(id) {
    const normalized = normalizeUserId(id);
    return normalized ? `https://note.com/${encodeURIComponent(normalized)}` : null;
  }
  globalThis.HikikomoriNote = Object.freeze({ settingsKey, isHome, isDashboard, shouldRedirect, normalizeUserId, readSettings, profileUrl });
})();
