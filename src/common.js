/* ブラウザAPIにもnoteのDOM構造にも依存しない処理。 */
(() => {
  "use strict";
  const settingsKey = "hikikomoriNote.settings.v2";
  const groupIds = ["group1", "group2", "group3", "group4"];
  function defaultSettings() {
    return { enabled: true, noteUserId: "", dashboardDisabled: false, legacyMode: false,
      hideArticleRecommendations: false, hidePaidArticles: false, noteLogoBrowserBack: false, tagSchemaVersion: 2,
      tagGroups: groupIds.map(id => ({ id, name: "", tags: [] })), selectedTagGroupId: "group1",
      groupSelectionRevision: 0, tagGroupsRevision: 0, authorDisplayRules: [], authorDisplayRevision: 0 };
  }
  function groupName(group) { return group.name || `グループ${groupIds.indexOf(group.id) + 1}`; }
  function normalizeGroupName(value) {
    if (typeof value !== "string") throw new Error("グループ名を文字列で入力してください。");
    const name = value.trim();
    if ([...name].length > 40 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name)) throw new Error("グループ名は改行なしの40文字以内で入力してください。");
    try { encodeURIComponent(name); } catch { throw new Error("グループ名に使用できない文字があります。"); }
    return name;
  }
  function inspectGroups(value) {
    let warning = !value || typeof value !== "object" || Array.isArray(value) ? "設定の保存形式に異常があります。タグ編集を停止しました。" : "";
    const source = Array.isArray(value?.tagGroups) ? value.tagGroups : [];
    if (value?.tagSchemaVersion !== 2 || source.length !== 4) warning = "タググループの保存形式に異常があります。元データを保持し、編集を停止しました。";
    const groups = groupIds.map((id, index) => {
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
    const selectionInvalid = !groupIds.includes(value?.selectedTagGroupId);
    return { tagSchemaVersion: value?.tagSchemaVersion, tagGroups: groups,
      selectedTagGroupId: !selectionInvalid ? value.selectedTagGroupId : "group1",
      groupSelectionRevision: value?.groupSelectionRevision,
      tagGroupsRevision: value?.tagGroupsRevision,
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
  function readSettings(value = defaultSettings()) {
    let noteUserId = "";
    try { noteUserId = normalizeUserId(value?.noteUserId); } catch { /* 破損値は空欄へ */ }
    const groups = inspectGroups(value);
    return { enabled: value?.enabled !== false, noteUserId, dashboardDisabled: value?.dashboardDisabled === true,
      legacyMode: value?.legacyMode === true, hideArticleRecommendations: value?.hideArticleRecommendations === true, hidePaidArticles: value?.hidePaidArticles === true,
      noteLogoBrowserBack: value?.noteLogoBrowserBack === true, ...groups, ...inspectAuthors(value) };
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
  function isPreviewArticle(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://note.com" && /^\/preview\/n[a-zA-Z0-9]+\/?$/.test(parsed.pathname);
    } catch { return false; }
  }
  function pageKind(url) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://note.com") return null;
      if (/^\/following\/?$/.test(parsed.pathname)) return { type: "following" };
      if (/^\/search\/?$/.test(parsed.pathname)) return { type: "search" };
      if (/^\/topic\/[^/]+(?:\/[^/]+)*\/?$/.test(parsed.pathname)) return { type: "topic" };
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
  function authorId(value) {
    const id = normalizeUserId(value);
    if (!id || pageKind(profileUrl(id.toLowerCase()))?.type !== "profile" || /^(?:preview|user_verification)$/i.test(id)) throw new Error("noteの公開プロフィールを指定してください。");
    return id;
  }
  function authorName(value) {
    if (typeof value !== "string" || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) throw new Error("表示名は改行なしの200文字以内で入力してください。");
    return value.trim();
  }
  function isSelf(settings, id) { return Boolean(settings.noteUserId && settings.noteUserId.toLowerCase() === id.toLowerCase()); }
  function authorRule(settings, id) { return settings.authorDisplayRules.find(rule => rule.userId.toLowerCase() === id.toLowerCase()); }
  function authorLabel(rule) { return rule.displayName ? `${rule.displayName}（${rule.userId}）` : rule.userId; }
  function sortAuthors(rules) {
    const collator = new Intl.Collator("ja");
    return [...rules].sort((a, b) => collator.compare(a.displayName || a.userId, b.displayName || b.userId) || (a.userId.toLowerCase() < b.userId.toLowerCase() ? -1 : a.userId.toLowerCase() > b.userId.toLowerCase() ? 1 : 0));
  }
  function validateAuthors(value) {
    if (!Array.isArray(value)) throw new Error("作者の表示設定が正しくありません。");
    const seen = new Set();
    return value.map(rule => {
      if (!exactKeys(rule, ["userId", "displayName", "action"]) || authorId(rule.userId) !== rule.userId || authorName(rule.displayName) !== rule.displayName || !["hide", "allow"].includes(rule.action) || seen.has(rule.userId.toLowerCase())) throw new Error("作者の表示設定に不正な値または重複があります。");
      seen.add(rule.userId.toLowerCase());
      return { userId: rule.userId, displayName: rule.displayName, action: rule.action };
    });
  }
  function inspectAuthors(value) {
    if (value?.authorDisplayRules === undefined && value?.authorDisplayRevision === undefined) return { authorDisplayRules: [], authorDisplayRevision: 0 };
    try {
      if (!Number.isSafeInteger(value?.authorDisplayRevision) || value.authorDisplayRevision < 0) throw new Error();
      return { authorDisplayRules: validateAuthors(value.authorDisplayRules), authorDisplayRevision: value.authorDisplayRevision };
    } catch { return { authorDisplayRules: [], authorDisplayRevision: 0, authorWarning: "作者の保存データに異常があります。作者の表示制御を停止しました。元データを保持して修復してください。" }; }
  }
  const transferFlags = ["enabled", "dashboardDisabled", "legacyMode", "hideArticleRecommendations", "hidePaidArticles", "noteLogoBrowserBack"];
  function exactKeys(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }
  function validateTransferSettings(value, version = 2) {
    const flags = version === 3 ? transferFlags.filter(key => key !== "legacyMode") : transferFlags;
    if (!exactKeys(value, [...flags, "noteUserId", "tagGroups", "selectedTagGroupId", ...(version >= 2 ? ["authorDisplayRules"] : []), ...(version === 3 ? ["mode"] : [])])) throw new Error("設定の項目に不足または未対応の項目があります。");
    for (const key of flags) if (typeof value[key] !== "boolean") throw new Error(`${key}はtrueまたはfalseを指定してください。`);
    let legacyMode = value.legacyMode;
    if (version === 3) {
      if (!["normal", "severe", "social"].includes(value.mode)) throw new Error("modeはnormal・severe・socialのいずれかを指定してください。");
      if (value.mode === "social") throw new Error("社会復帰モードはこのバージョンでは未対応です。対応版へ更新してから読み込んでください。設定は変更していません。");
      legacyMode = value.mode === "severe";
    }
    if (typeof value.noteUserId !== "string" || normalizeUserId(value.noteUserId) !== value.noteUserId) throw new Error("ユーザー名の保存値が正しくありません。");
    if (!Array.isArray(value.tagGroups) || value.tagGroups.length !== 4 || !groupIds.includes(value.selectedTagGroupId)) throw new Error("4グループと選択グループを確認してください。");
    const groups = value.tagGroups.map((group, index) => {
      if (!exactKeys(group, ["id", "name", "tags"]) || group.id !== groupIds[index] ||
          normalizeGroupName(group.name) !== group.name || !Array.isArray(group.tags) || inspectTags(group.tags).warning) {
        throw new Error(`グループ${index + 1}の名前・タグ・並び順が正しくありません。`);
      }
      return { id: group.id, name: group.name, tags: [...group.tags] };
    });
    return { ...Object.fromEntries(transferFlags.map(key => [key, key === "legacyMode" ? legacyMode : value[key]])), noteUserId: value.noteUserId,
      tagGroups: groups, selectedTagGroupId: value.selectedTagGroupId, authorDisplayRules: version >= 2 ? validateAuthors(value.authorDisplayRules) : [] };
  }
  function transferSettings(settings) {
    if (settings.tagWarning || settings.groupSelectionInvalid || settings.authorWarning) throw new Error("保存データに異常があります。状態を再確認してください。");
    return validateTransferSettings(Object.fromEntries([...transferFlags, "noteUserId", "tagGroups", "selectedTagGroupId", "authorDisplayRules"].map(key => [key, key === "authorDisplayRules" ? settings[key] ?? [] : settings[key]])));
  }
  function exportSettings(settings) {
    // 外部JSONだけを将来の3モード形式にする。現行の保存値・動作はlegacyModeのまま。
    const { legacyMode, ...value } = transferSettings(settings);
    const json = JSON.stringify({ format: "hikikomori-note-settings", schemaVersion: 3, settings: { ...value, mode: legacyMode ? "severe" : "normal" } }, null, 2);
    if (json.length > 1048576) throw new Error("設定JSONは1,048,576文字以内で入力してください。");
    return json;
  }
  function parseSettingsExport(text) {
    if (typeof text !== "string" || text.length > 1048576) throw new Error("設定JSONは1,048,576文字以内で入力してください。");
    let document;
    try { document = JSON.parse(text); } catch { throw new Error("JSONの書式が正しくありません。"); }
    if (!exactKeys(document, ["format", "schemaVersion", "settings"]) || document.format !== "hikikomori-note-settings" || ![1, 2, 3].includes(document.schemaVersion)) {
      throw new Error("ひきこもりnoteの設定JSON（形式バージョン1・2・3）を入力してください。");
    }
    return validateTransferSettings(document.settings, document.schemaVersion);
  }
  function settingsToken(settings) {
    return JSON.stringify([transferSettings(settings), settings.groupSelectionRevision, settings.tagGroupsRevision, settings.authorDisplayRevision ?? 0]);
  }
  globalThis.HikikomoriNote = Object.freeze({ settingsKey, isHome, isDashboard, shouldRedirect, normalizeUserId, readSettings, profileUrl,
    exportSettings, parseSettingsExport, settingsToken, authorId, authorName, isSelf, authorRule, authorLabel, sortAuthors,
    normalizeTag, inspectTags, tagUrl, articleSearchTabUrl, pageKind, isArticle, isPreviewArticle, groupIds, groupName, normalizeGroupName, selectedGroup, defaultSettings });
})();
