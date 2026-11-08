/* ブラウザAPIにもnoteのDOM構造にも依存しない処理。 */
(() => {
  "use strict";
  const settingsKey = "hikikomoriNote.settings.v2";
  const groupIds = ["group1", "group2", "group3", "group4"];
  function defaultSettings() {
    return { enabled: true, theme: "system", noteUserId: "", dashboardDisabled: false, mode: "normal",
      hideArticleRecommendations: false, hidePaidArticles: false, hideLikeCounts: false, noteLogoBrowserBack: false, keepNoteHeaderVisible: false, tagSchemaVersion: 2,
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
    if (![2, 3, 4, 5].includes(value?.tagSchemaVersion) || source.length !== 4) warning = "お気に入りの保存形式に異常があります。元データを保持し、編集を停止しました。";
    const groups = groupIds.map((id, index) => {
      const matches = source.filter(group => group?.id === id), item = matches.length === 1 ? matches[0] : undefined;
      const tags = inspectTags(item?.tags, value?.tagSchemaVersion >= 3, value?.tagSchemaVersion >= 4, value?.tagSchemaVersion === 5); let name = "";
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
      ((modeOf(settings) !== "social" && isHome(url)) || (settings.dashboardDisabled === true && isDashboard(url)));
  }
  function modeOf(settings) { return ["normal", "severe", "social"].includes(settings?.mode) ? settings.mode : "normal"; }
  function themeOf(settings) { return ["system", "dark", "light"].includes(settings?.theme) ? settings.theme : "system"; }
  function usesTags(settings) { return modeOf(settings) === "normal"; }
  function usesFollowing(settings) { return modeOf(settings) !== "severe"; }
  function usesLogoBack(settings) { return settings?.enabled === true && modeOf(settings) !== "social" && settings.noteLogoBrowserBack === true; }
  function readSettings(value = defaultSettings()) {
    let noteUserId = "";
    try { noteUserId = normalizeUserId(value?.noteUserId); } catch { /* 破損値は空欄へ */ }
    const groups = inspectGroups(value);
    return { enabled: value?.enabled !== false, theme: themeOf(value), noteUserId, dashboardDisabled: value?.dashboardDisabled === true,
      mode: modeOf(value), hideArticleRecommendations: value?.hideArticleRecommendations === true, hidePaidArticles: value?.hidePaidArticles === true, hideLikeCounts: value?.hideLikeCounts === true,
      noteLogoBrowserBack: value?.noteLogoBrowserBack === true, keepNoteHeaderVisible: value?.keepNoteHeaderVisible === true, ...groups, ...inspectAuthors(value) };
  }
  function normalizeTag(value) {
    if (typeof value !== "string") throw new Error("タグ名は文字列で入力してください。");
    const tag = value.trim().replace(/^#+/, "").trim();
    if (!tag) throw new Error("タグ名を入力してください。");
    try { encodeURIComponent(tag); } catch { throw new Error("タグ名に使用できない文字が含まれています。"); }
    return tag;
  }
  function favoriteUser(value) {
    if (!exactKeys(value, ["type", "userId", "displayName"]) || value.type !== "user") throw new Error("お気に入りユーザーの形式が正しくありません。");
    const userId = authorId(value.userId), displayName = authorName(value.displayName);
    if (userId !== value.userId || displayName !== value.displayName) throw new Error("お気に入りユーザーの保存値が正しくありません。");
    return { type: "user", userId, displayName };
  }
  function favoriteMagazine(value) {
    if (!exactKeys(value, ["type", "userId", "magazineId", "displayName"]) || value.type !== "magazine") throw new Error("お気に入りマガジンの形式が正しくありません。");
    const userId = authorId(value.userId), displayName = authorName(value.displayName);
    if (userId !== value.userId || displayName !== value.displayName || typeof value.magazineId !== "string" || !/^m[a-zA-Z0-9]+$/.test(value.magazineId)) throw new Error("お気に入りマガジンの保存値が正しくありません。");
    return { type: "magazine", userId, magazineId: value.magazineId, displayName };
  }
  function favoriteMembership(value) {
    if (!exactKeys(value, ["type", "userId", "displayName"]) || value.type !== "membership") throw new Error("お気に入りメンバーシップの形式が正しくありません。");
    const userId = authorId(value.userId), displayName = authorName(value.displayName);
    if (userId !== value.userId || displayName !== value.displayName) throw new Error("お気に入りメンバーシップの保存値が正しくありません。");
    return { type: "membership", userId, displayName };
  }
  function favorite(value) {
    if (typeof value === "string") return normalizeTag(value);
    if (value?.type === "membership") return favoriteMembership(value);
    return value?.type === "magazine" ? favoriteMagazine(value) : favoriteUser(value);
  }
  function favoriteKey(value) { return typeof value === "string" ? `tag:${value}` : value.type === "magazine" ? `magazine:${value.userId.toLowerCase()}:${value.magazineId}` : `${value.type}:${value.userId.toLowerCase()}`; }
  function favoriteLabel(value) { return typeof value === "string" ? `# ${value}` : value.type === "membership" ? value.displayName || `${value.userId}のメンバーシップ` : value.type === "magazine" ? value.displayName || value.magazineId : `＠${value.displayName || value.userId}`; }
  function favoriteUrl(value) { return typeof value === "string" ? tagUrl(value) : value.type === "membership" ? `${profileUrl(value.userId)}/membership` : value.type === "magazine" ? `${profileUrl(value.userId)}/m/${value.magazineId}` : profileUrl(value.userId); }
  function authorSearchUrl(userId) {
    const url = new URL("https://note.com/search");
    for (const [key, value] of [["q", `from:@${authorId(userId)} `], ["context", "note"], ["mode", "search"], ["sort", "new"]]) url.searchParams.set(key, value);
    return url.href;
  }
  function searchedAuthor(url) {
    try {
      const page = new URL(url), params = page.searchParams;
      if (page.origin !== "https://note.com" || !/^\/search\/?$/.test(page.pathname) || params.getAll("q").length !== 1 ||
          params.getAll("context").length > 1) return null;
      // noteは先頭のfrom指定を使い、引用符でも無効にならない。後続の語句は解釈しない。
      // contextを問わず戻り先を提供し、実際の挿入可否は既知の左メニュー領域で決める。
      const match = /^["']?from:@([a-zA-Z0-9_]+)["']?(?=\s|$)/.exec(params.get("q").trim());
      return match ? authorId(match[1]) : null;
    } catch { return null; }
  }
  function favoriteSchema(groups, minimum = 2) { return Math.max(minimum, groups.some(g => g.tags.some(t => t?.type === "membership")) ? 5 : groups.some(g => g.tags.some(t => t?.type === "magazine")) ? 4 : groups.some(g => g.tags.some(t => t?.type === "user")) ? 3 : 2); }
  // 自前の輪郭SVG。絵文字の字体や外部アイコン配信には依存しない。
  const bookIconPath = "M12 5.5C9 3.5 5 3.5 2 4.5v14c3-1 7-1 10 1 3-2 7-2 10-1v-14c-3-1-7-1-10 1Zm0 0v14";
  const membershipIconPath = "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M18 15a4 4 0 0 1 4 4v2";
  function inspectTags(value, allowUsers = false, allowMagazines = false, allowMemberships = false) {
    if (value === undefined) return { tags: [], warning: "" };
    const tags = [], seen = new Set();
    let invalid = !Array.isArray(value);
    for (const item of Array.isArray(value) ? value : []) {
      try {
        const tag = typeof item === "string" ? normalizeTag(item) : allowMemberships && item?.type === "membership" ? favoriteMembership(item) : allowMagazines && item?.type === "magazine" ? favoriteMagazine(item) : allowUsers ? favoriteUser(item) : normalizeTag(item);
        const key = favoriteKey(tag);
        if ((typeof item === "string" && tag !== item) || seen.has(key)) { invalid = true; continue; }
        seen.add(key); tags.push(tag);
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
      const magazine = /^\/([a-zA-Z0-9_]+)\/m\/(m[a-zA-Z0-9]+)(?:\/(?:archive|hashtag))?\/?$/.exec(parsed.pathname);
      if (magazine && pageKind(`https://note.com/${magazine[1]}`)?.type === "profile") return { type: "magazine", user: magazine[1], magazineId: magazine[2] };
      const profile = /^\/([a-zA-Z0-9_]+)(?:\/(?:all|magazines|membership|likes|archives|followings|followers)(?:\/[^/]+)*)?\/?$/.exec(parsed.pathname) ?? /^\/([a-zA-Z0-9_]+)\/store\/?$/.exec(parsed.pathname);
      const reserved = new Set(["dashboard", "settings", "login", "signup", "api", "notes", "following", "tag", "hashtag", "search", "trend", "contests", "topic", "terms", "notifications", "messages", "new"]);
      if (profile && !reserved.has(profile[1])) return { type: "profile", user: profile[1] };
    } catch { /* 壊れたURLは対象外 */ }
    return null;
  }
  function membershipPage(url) {
    try {
      const parsed = new URL(url), match = /^\/([a-zA-Z0-9_]+)\/membership(?:\/join)?\/?$/.exec(parsed.pathname);
      if (parsed.origin === "https://note.com" && match) return { type: "membership", user: authorId(match[1]) };
    } catch { /* 未知の下位ページ・外部URLは登録対象にしない */ }
    return null;
  }
  function questionPage(url) {
    try {
      const parsed = new URL(url), match = /^\/qa\/([a-zA-Z0-9_]+)(?:\/q\/([a-zA-Z0-9]+))?\/?$/.exec(parsed.pathname);
      if (parsed.origin === "https://note.com" && match) return { user: authorId(match[1]), questionId: match[2] || null };
    } catch { /* 不明な質問箱URLは対象外 */ }
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
  // 保存用配列には触れず、配列の寿命に合わせた検索索引だけを保持する。
  // ルール更新時は配列を差し替える。同じ配列内でIDの変更・追加・削除は行わない。
  const authorIndexes = new WeakMap();
  function authorRule(settings, id) {
    const rules = settings.authorDisplayRules;
    let index = authorIndexes.get(rules);
    if (!index) {
      index = new Map();
      for (const rule of rules) {
        const key = rule.userId.toLowerCase();
        if (!index.has(key)) index.set(key, rule); // findと同じ先頭優先。通常は検証済みで重複なし。
      }
      authorIndexes.set(rules, index);
    }
    return index.get(id.toLowerCase());
  }
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
    const flags = version >= 3 ? [...transferFlags.filter(key => key !== "legacyMode"), ...(version >= 4 ? ["keepNoteHeaderVisible"] : []), ...(version >= 7 ? ["hideLikeCounts"] : [])] : transferFlags;
    if (!exactKeys(value, [...flags, "noteUserId", "tagGroups", "selectedTagGroupId", ...(version >= 2 ? ["authorDisplayRules"] : []), ...(version >= 3 ? ["mode"] : [])])) throw new Error("設定の項目に不足または未対応の項目があります。");
    for (const key of flags) if (typeof value[key] !== "boolean") throw new Error(`${key}はtrueまたはfalseを指定してください。`);
    let mode = value.legacyMode === true ? "severe" : "normal";
    if (version >= 3) {
      if (!["normal", "severe", "social"].includes(value.mode)) throw new Error("modeはnormal・severe・socialのいずれかを指定してください。");
      mode = value.mode;
    }
    if (typeof value.noteUserId !== "string" || normalizeUserId(value.noteUserId) !== value.noteUserId) throw new Error("ユーザー名の保存値が正しくありません。");
    if (!Array.isArray(value.tagGroups) || value.tagGroups.length !== 4 || !groupIds.includes(value.selectedTagGroupId)) throw new Error("4グループと選択グループを確認してください。");
    const groups = value.tagGroups.map((group, index) => {
      const items = version >= 5 ? group?.items : group?.tags;
      if (!exactKeys(group, ["id", "name", version >= 5 ? "items" : "tags"]) || group.id !== groupIds[index] ||
          normalizeGroupName(group.name) !== group.name || !Array.isArray(items)) {
        throw new Error(`グループ${index + 1}の名前・タグ・並び順が正しくありません。`);
      }
      const tags = version >= 5 ? items.map(item => {
        if (item?.type === "tag" && exactKeys(item, ["type", "tag"]) && normalizeTag(item.tag) === item.tag) return item.tag;
        if (version >= 6 && item?.type === "membership") return favoriteMembership(item);
        return item?.type === "magazine" ? favoriteMagazine(item) : favoriteUser(item);
      }) : items;
      if (inspectTags(tags, version >= 5, version >= 5, version >= 6).warning) throw new Error("お気に入りの内容または重複を確認してください。");
      return { id: group.id, name: group.name, tags: [...tags] };
    });
    return { ...Object.fromEntries(transferFlags.filter(key => key !== "legacyMode").map(key => [key, value[key]])), keepNoteHeaderVisible: version >= 4 ? value.keepNoteHeaderVisible : false, hideLikeCounts: version >= 7 ? value.hideLikeCounts : false, mode, noteUserId: value.noteUserId,
      tagGroups: groups, selectedTagGroupId: value.selectedTagGroupId, authorDisplayRules: version >= 2 ? validateAuthors(value.authorDisplayRules) : [] };
  }
  function transferSettings(settings) {
    if (settings.tagWarning || settings.groupSelectionInvalid || settings.authorWarning) throw new Error("保存データに異常があります。状態を再確認してください。");
    const value = Object.fromEntries([...transferFlags.filter(key => key !== "legacyMode"), "keepNoteHeaderVisible", "hideLikeCounts", "mode", "noteUserId", "tagGroups", "selectedTagGroupId", "authorDisplayRules"].map(key => [key, key === "mode" ? modeOf(settings) : ["keepNoteHeaderVisible", "hideLikeCounts"].includes(key) ? settings[key] ?? false : key === "authorDisplayRules" ? settings[key] ?? [] : settings[key]]));
    value.tagGroups = value.tagGroups.map(group => ({ id: group.id, name: group.name, items: group.tags.map(item => typeof item === "string" ? { type: "tag", tag: item } : item) }));
    return { ...validateTransferSettings(value, 7), theme: themeOf(settings) };
  }
  function exportSettings(settings) {
    const value = transferSettings(settings);
    value.tagGroups = value.tagGroups.map(group => ({ id: group.id, name: group.name, items: group.tags.map(item => typeof item === "string" ? { type: "tag", tag: item } : item) }));
    const json = JSON.stringify({ format: "hikikomori-note-settings", schemaVersion: 7, settings: value }, null, 2);
    if (json.length > 1048576) throw new Error("設定JSONは1,048,576文字以内で入力してください。");
    return json;
  }
  function inspectSettingsImport(text, current = defaultSettings()) {
    if (typeof text !== "string" || text.length > 1048576) throw new Error("設定JSONは1,048,576文字以内で入力してください。");
    let document;
    try { document = JSON.parse(text); } catch { throw new Error("JSONの書式が正しくありません。"); }
    const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!object(document)) throw new Error("設定項目を含むJSONオブジェクトを入力してください。");
    const wrapped = Object.hasOwn(document, "settings"), source = wrapped ? document.settings : document;
    if (!object(source)) throw new Error("settingsはJSONオブジェクトにしてください。");
    const settings = transferSettings(current), applied = [], ignored = [];
    settings.tagGroups = settings.tagGroups.map(g => ({ ...g, tags: [...g.tags] }));
    const skip = (path, reason) => ignored.push({ path, reason });
    const accept = path => applied.push(path);
    const metadata = new Set(["format", "schemaVersion"]);
    if (wrapped) for (const key of Object.keys(document)) {
      if (key !== "settings" && !metadata.has(key)) skip(key, "設定ラッパーの未対応項目です。");
    }
    const flags = new Set([...transferFlags.filter(k => k !== "legacyMode"), "keepNoteHeaderVisible", "hideLikeCounts"]);
    const scalar = new Set([...flags, "noteUserId", "mode", "theme", "selectedTagGroupId", "legacyMode"]);
    const fieldsOnly = (value, keys, path) => {
      for (const key of Object.keys(value)) if (!keys.includes(key)) skip(`${path}.${key}`, "未対応の項目です。");
      return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
    };
    const parseFavorite = (item, path) => {
      if (typeof item === "string") {
        const tag = normalizeTag(item); if (tag !== item) throw new Error("タグ名の前後の空白・#を除いてください。"); return tag;
      }
      if (!object(item)) throw new Error("お気に入りは文字列またはオブジェクトにしてください。");
      if (item.type === "tag") {
        const clean = fieldsOnly(item, ["type", "tag"], path), tag = normalizeTag(clean.tag);
        if (tag !== clean.tag) throw new Error("タグ名の前後の空白・#を除いてください。"); return tag;
      }
      const keys = item.type === "magazine" ? ["type", "userId", "magazineId", "displayName"] : ["type", "userId", "displayName"];
      if (!["user", "magazine", "membership"].includes(item.type)) throw new Error("未対応のお気に入り種別です。");
      const clean = fieldsOnly(item, keys, path); if (!Object.hasOwn(clean, "displayName")) clean.displayName = "";
      return favorite(clean);
    };
    function list(value, path, parse, keyOf) {
      if (!Array.isArray(value)) { skip(path, "配列ではないため現在値を維持しました。"); return null; }
      const result = [], seen = new Set();
      value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        try {
          const parsed = parse(item, itemPath), key = keyOf(parsed);
          if (seen.has(key)) throw new Error("重複しているため先頭の項目を使用します。");
          seen.add(key); result.push(parsed);
        } catch (error) { skip(itemPath, error.message); }
      });
      if (value.length && !result.length) { skip(path, "有効な項目がないため現在値を維持しました。"); return null; }
      accept(path); return result;
    }
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (metadata.has(key)) continue;
      if (scalar.has(key)) {
        try {
          if (key === "legacyMode" && Object.hasOwn(source, "mode")) { skip(key, "modeが指定されているため使用しません。"); continue; }
          let parsed = value;
          if (flags.has(key) || key === "legacyMode") { if (typeof value !== "boolean") throw new Error("trueまたはfalseにしてください。"); }
          else if (key === "noteUserId") { if (typeof value !== "string") throw new Error("文字列にしてください。"); parsed = normalizeUserId(value); }
          else if (key === "mode" && !["normal", "severe", "social"].includes(value)) throw new Error("normal・severe・socialのいずれかにしてください。");
          else if (key === "theme" && !["system", "dark", "light"].includes(value)) throw new Error("system・dark・lightのいずれかにしてください。");
          else if (key === "selectedTagGroupId" && !groupIds.includes(value)) throw new Error("group1〜group4のいずれかにしてください。");
          settings[key === "legacyMode" ? "mode" : key] = key === "legacyMode" ? value ? "severe" : "normal" : parsed;
          accept(key); continue;
        } catch (error) { skip(key, error.message); continue; }
      }
      if (key === "tagGroups") {
        if (!Array.isArray(value)) { skip(key, "配列ではないため現在値を維持しました。"); continue; }
        if (!value.length) { settings.tagGroups = settings.tagGroups.map(g => ({ ...g, tags: [] })); accept(key); continue; }
        const seen = new Set();
        value.forEach((group, index) => {
          const path = `tagGroups[${index}]`;
          if (!object(group) || !groupIds.includes(group.id)) { skip(path, "既知のグループIDがありません。"); return; }
          if (seen.has(group.id)) { skip(path, "重複グループのため先頭を使用します。"); return; }
          seen.add(group.id); const target = settings.tagGroups.find(g => g.id === group.id);
          fieldsOnly(group, ["id", "name", "items", "tags"], path);
          if (Object.hasOwn(group, "name")) {
            try { const name = normalizeGroupName(group.name); if (name !== group.name) throw new Error("グループ名の前後の空白を除いてください。"); target.name = name; accept(`${path}.name`); }
            catch (error) { skip(`${path}.name`, error.message); }
          }
          const field = Object.hasOwn(group, "items") ? "items" : Object.hasOwn(group, "tags") ? "tags" : null;
          if (field === "items" && Object.hasOwn(group, "tags")) skip(`${path}.tags`, "itemsを優先します。");
          if (field) { const tags = list(group[field], `${path}.${field}`, parseFavorite, favoriteKey); if (tags !== null) target.tags = tags; }
        });
        continue;
      }
      if (key === "authorDisplayRules") {
        const rules = list(value, key, (rule, path) => {
          if (!object(rule)) throw new Error("作者ルールはオブジェクトにしてください。");
          const clean = fieldsOnly(rule, ["userId", "displayName", "action"], path);
          if (!Object.hasOwn(clean, "displayName")) clean.displayName = "";
          return validateAuthors([clean])[0];
        }, rule => rule.userId.toLowerCase());
        if (rules !== null) settings.authorDisplayRules = rules;
        continue;
      }
      skip(key, "ひきこもりnoteでは未対応の項目です。");
    }
    return { settings, applied, ignored };
  }
  function parseSettingsExport(text, current = defaultSettings()) { return inspectSettingsImport(text, current).settings; }
  function settingsToken(settings) {
    return JSON.stringify([transferSettings(settings), settings.groupSelectionRevision, settings.tagGroupsRevision, settings.authorDisplayRevision ?? 0]);
  }
  globalThis.HikikomoriNote = Object.freeze({ settingsKey, isHome, isDashboard, shouldRedirect, normalizeUserId, readSettings, profileUrl,
    modeOf, themeOf, usesTags, usesFollowing, usesLogoBack,
    exportSettings, parseSettingsExport, inspectSettingsImport, settingsToken, authorId, authorName, isSelf, authorRule, authorLabel, sortAuthors,
    favorite, favoriteKey, favoriteLabel, favoriteUrl, authorSearchUrl, searchedAuthor, favoriteUser, favoriteMagazine, favoriteMembership, favoriteSchema, bookIconPath, membershipIconPath, membershipPage, questionPage,
    normalizeTag, inspectTags, tagUrl, articleSearchTabUrl, pageKind, isArticle, isPreviewArticle, groupIds, groupName, normalizeGroupName, selectedGroup, defaultSettings });
})();
