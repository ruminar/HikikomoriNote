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
    const inspected = inspectTags(value?.favoriteTags);
    return { enabled: value?.enabled !== false, noteUserId, dashboardDisabled: value?.dashboardDisabled === true,
      legacyMode: value?.legacyMode === true, favoriteTags: inspected.tags,
      ...(inspected.warning ? { tagWarning: inspected.warning } : {}) };
  }
  function normalizeTag(value) {
    if (typeof value !== "string") throw new Error("タグ名は文字列で入力してください。");
    const tag = value.trim().replace(/^#+/, "").trim();
    if (!tag) throw new Error("タグ名を入力してください。");
    try { encodeURIComponent(tag); } catch { throw new Error("タグ名に使用できない文字が含まれています。"); }
    return tag;
  }
  function inspectTags(value) {
    if (value === undefined) return { tags: [], warning: "" };
    const tags = [], seen = new Set();
    let invalid = !Array.isArray(value);
    for (const item of Array.isArray(value) ? value : []) {
      try {
        const tag = normalizeTag(item);
        if (tag !== item || seen.has(tag)) { invalid = true; continue; }
        seen.add(tag); tags.push(tag);
      } catch { invalid = true; }
    }
    return { tags, warning: invalid ? "タグの保存データに異常があります。正常な項目だけ表示しています。タグ編集を停止しました。元のデータを保存してから、開発者へ修復をご相談ください。" : "" };
  }
  function tagUrl(tag) { return `https://note.com/tag/${encodeURIComponent(normalizeTag(tag))}`; }
  function pageKind(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://note.com") return null;
      if (/^\/following\/?$/.test(parsed.pathname)) return { type: "following" };
      const match = /^\/(?:tag|hashtag)\/([^/]+)\/?$/.exec(parsed.pathname);
      if (match) return { type: "tag", tag: decodeURIComponent(match[1]) };
      const profile = /^\/([a-zA-Z0-9_]+)(?:\/(?:all|magazines|membership|likes|archives)(?:\/[^/]+)*)?\/?$/.exec(parsed.pathname);
      const reserved = new Set(["dashboard", "settings", "login", "signup", "api", "notes", "following", "tag", "hashtag", "search", "trend", "contests", "topic", "terms", "notifications", "messages", "new"]);
      if (profile && !reserved.has(profile[1])) return { type: "profile", user: profile[1] };
    } catch { /* 壊れたURLは対象外 */ }
    return null;
  }
  function profileUrl(id) {
    const normalized = normalizeUserId(id);
    return normalized ? `https://note.com/${encodeURIComponent(normalized)}` : null;
  }
  globalThis.HikikomoriNote = Object.freeze({ settingsKey, isHome, isDashboard, shouldRedirect, normalizeUserId, readSettings, profileUrl,
    normalizeTag, inspectTags, tagUrl, pageKind });
})();
