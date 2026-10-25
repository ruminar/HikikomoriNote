/* ブラウザAPIにもnoteのDOM構造にも依存しない処理。 */
(() => {
  "use strict";
  const settingsKey = "hikikomoriNote.settings.v1";
  const groupIds = ["group1", "group2", "group3", "group4"];
  function groupName(group) { return group.name || `グループ${groupIds.indexOf(group.id) + 1}`; }
  function normalizeGroupName(value) {
    if (typeof value !== "string") throw new Error("グループ名を文字列で入力してください。");
    const name = value.trim();
    if ([...name].length > 40 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name)) throw new Error("グループ名は改行なしの40文字以内で入力してください。");
    try { encodeURIComponent(name); } catch { throw new Error("グループ名に使用できない文字があります。"); }
    return name;
  }
  function inspectGroups(value) {
    const legacy = value?.tagSchemaVersion === undefined &&
      !["tagGroups", "selectedTagGroupId", "groupSelectionRevision", "tagGroupsRevision"].some(key => Object.hasOwn(value ?? {}, key));
    let warning = value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)) ? "設定の保存形式に異常があります。タグ編集を停止しました。" : "";
    let groups;
    if (legacy) {
      const old = inspectTags(value?.favoriteTags); warning ||= old.warning;
      groups = groupIds.map((id, index) => ({ id, name: "", tags: index === 0 ? old.tags : [] }));
    } else {
      const source = Array.isArray(value?.tagGroups) ? value.tagGroups : [];
      if (value?.tagSchemaVersion !== 2 || source.length !== 4) warning = "タググループの保存形式に異常があります。元データを保持し、編集を停止しました。";
      groups = groupIds.map((id, index) => {
        const matches = source.filter(group => group?.id === id), item = matches.length === 1 ? matches[0] : undefined;
        const tags = inspectTags(item?.tags); let name = "";
        try { name = normalizeGroupName(item?.name); if (name !== item.name) warning ||= "グループ名の保存値に異常があります。"; }
        catch { warning ||= "グループ名の保存値に異常があります。"; }
        if (!item || !Array.isArray(item.tags) || source[index]?.id !== id || tags.warning) warning ||= "タググループの保存データに異常があります。編集を停止しました。";
        return { id, name, tags: tags.tags };
      });
      for (const key of ["groupSelectionRevision", "tagGroupsRevision"]) {
        if (!Number.isSafeInteger(value?.[key]) || value[key] < 0) warning ||= "グループの更新番号に異常があります。";
      }
    }
    const selectionInvalid = !legacy && !groupIds.includes(value?.selectedTagGroupId);
    return { tagSchemaVersion: legacy ? undefined : value?.tagSchemaVersion, tagGroups: groups,
      selectedTagGroupId: !selectionInvalid && !legacy ? value.selectedTagGroupId : "group1",
      groupSelectionRevision: legacy ? 0 : value?.groupSelectionRevision,
      tagGroupsRevision: legacy ? 0 : value?.tagGroupsRevision,
      ...(warning ? { tagWarning: warning } : {}), ...(selectionInvalid ? { groupSelectionInvalid: true } : {}) };
  }
  function selectedGroup(settings) { return settings.tagGroups.find(group => group.id === settings.selectedTagGroupId); }
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
    const groups = inspectGroups(value);
    return { enabled: value?.enabled !== false, noteUserId, dashboardDisabled: value?.dashboardDisabled === true,
      legacyMode: value?.legacyMode === true, hideArticleRecommendations: value?.hideArticleRecommendations === true, favoriteTags: inspectTags(value?.favoriteTags).tags,
      confirmNoteLogoClick: value?.confirmNoteLogoClick === true, ...groups };
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
  function tagUrl(tag) { return `https://note.com/search?q=${encodeURIComponent(`#${normalizeTag(tag)}`)}&context=note&mode=search&sort=new`; }
  function articleSearchTabUrl(currentUrl, targetUrl) {
    try {
      const current = new URL(currentUrl), target = new URL(targetUrl, current);
      if (pageKind(current.href)?.type !== "search" || pageKind(target.href)?.type !== "search" ||
          !["user", "magazine", "circle"].includes(current.searchParams.get("context")) ||
          target.searchParams.get("context") !== "note" ||
          target.searchParams.get("q") !== current.searchParams.get("q")) return null;
      target.searchParams.set("mode", "search"); target.searchParams.set("sort", "new");
      return target.href;
    } catch { return null; }
  }
  function isArticle(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://note.com" && /^\/[a-zA-Z0-9_]+\/n\/n[a-zA-Z0-9]+\/?$/.test(parsed.pathname);
    } catch { return false; }
  }
  function pageKind(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://note.com") return null;
      if (/^\/following\/?$/.test(parsed.pathname)) return { type: "following" };
      if (/^\/search\/?$/.test(parsed.pathname)) return { type: "search" };
      const match = /^\/(?:tag|hashtag)\/([^/]+)\/?$/.exec(parsed.pathname);
      if (match) return { type: "tag", tag: decodeURIComponent(match[1]) };
      const profile = /^\/([a-zA-Z0-9_]+)(?:\/(?:all|magazines|membership|likes|archives|followings|followers)(?:\/[^/]+)*)?\/?$/.exec(parsed.pathname);
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
    normalizeTag, inspectTags, tagUrl, articleSearchTabUrl, pageKind, isArticle, groupIds, groupName, normalizeGroupName, selectedGroup });
})();
