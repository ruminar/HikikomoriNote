/* Chromiumのルール形式と、設定・ルールの単一書込制御。通信内容は取得しない。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  function rules(enabled, dashboardDisabled = false) {
    if (!enabled) return [];
    const regexFilter = "^https://note\\.com/([?#].*)?$";
    const result = [
      { id: 1, priority: 1, action: { type: "redirect", redirect: { extensionPath: "/home.html" } },
        condition: { regexFilter, resourceTypes: ["main_frame"] } },
      { id: 2, priority: 1, action: { type: "block" },
        condition: { regexFilter, excludedResourceTypes: ["main_frame"] } }
    ];
    if (dashboardDisabled) {
      const dashboard = "^https://note\\.com/dashboard([/?#].*)?$";
      result.push(
        { id: 3, priority: 1, action: { type: "redirect", redirect: { extensionPath: "/home.html" } },
          condition: { regexFilter: dashboard, resourceTypes: ["main_frame"] } },
        { id: 4, priority: 1, action: { type: "block" },
          condition: { regexFilter: dashboard, excludedResourceTypes: ["main_frame"] } }
      );
    }
    return result;
  }
  function createController(port) {
    let queue = Promise.resolve();
    function run(task) {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    }
    function failure(message, code) { return Object.assign(new Error(message), { code }); }
    function storedValue(raw, settings) {
      const { tagWarning, groupSelectionInvalid, authorWarning, ...clean } = settings;
      // タグ関連の保存値は通常設定保存では一切正規化・上書きしない。
      for (const key of ["tagSchemaVersion", "tagGroups", "selectedTagGroupId", "groupSelectionRevision", "tagGroupsRevision", "authorDisplayRules", "authorDisplayRevision"]) delete clean[key];
      return { ...(raw === undefined ? core.defaultSettings() : raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), ...clean };
    }
    function increment(value) {
      if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) throw failure("更新番号が不正か上限です。編集を停止しました。", "INVALID_TAGS");
      return value + 1;
    }
    return Object.freeze({
      getState: () => run(async () => {
        const settings = core.readSettings(await port.load());
        await port.setRules(rules(settings.enabled, settings.dashboardDisabled));
        return settings;
      }),
      save: patch => run(async () => {
        if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
            Object.keys(patch).some(key => !["enabled", "noteUserId", "dashboardDisabled", "legacyMode", "hideArticleRecommendations", "hidePaidArticles", "noteLogoBrowserBack"].includes(key))) {
          throw new Error("設定の形式が正しくありません。");
        }
        if (Object.hasOwn(patch, "enabled") && typeof patch.enabled !== "boolean") {
          throw new Error("ON/OFFの値が正しくありません。");
        }
        const raw = await port.load();
        const previous = core.readSettings(raw);
        if (Object.hasOwn(patch, "dashboardDisabled") && typeof patch.dashboardDisabled !== "boolean") {
          throw new Error("ダッシュボード設定の値が正しくありません。");
        }
        if (Object.hasOwn(patch, "legacyMode") && typeof patch.legacyMode !== "boolean") throw new Error("モード設定の値が正しくありません。");
        if (Object.hasOwn(patch, "hidePaidArticles") && typeof patch.hidePaidArticles !== "boolean") throw new Error("有料記事表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "hideArticleRecommendations") && typeof patch.hideArticleRecommendations !== "boolean") throw new Error("おすすめ表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "noteLogoBrowserBack") && typeof patch.noteLogoBrowserBack !== "boolean") throw new Error("ロゴのブラウザバック設定の値が正しくありません。");
        const next = { ...previous, ...patch };
        next.noteUserId = core.normalizeUserId(next.noteUserId);
        await port.setRules(rules(next.enabled, next.dashboardDisabled));
        try { await port.store(storedValue(raw, next)); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled)); }
          catch { throw new Error("保存と転送設定の復旧に失敗しました。拡張を無効化して再読み込みしてください。"); }
          throw error;
        }
        return core.readSettings(storedValue(raw, next));
      }),
      importSettings: patch => run(async () => {
        if (!patch || Object.keys(patch).length !== 2 || typeof patch.expectedToken !== "string" || !Object.hasOwn(patch, "json")) throw new Error("読み込み要求が正しくありません。");
        const imported = core.parseSettingsExport(patch.json);
        const previous = core.readSettings(await port.load());
        if (core.settingsToken(previous) !== patch.expectedToken) throw failure("別の画面で設定が変更されました。状態を再確認し、もう一度読み込んでください。", "CONFLICT");
        const next = { ...imported, tagSchemaVersion: 2,
          groupSelectionRevision: increment(previous.groupSelectionRevision), tagGroupsRevision: increment(previous.tagGroupsRevision), authorDisplayRevision: increment(previous.authorDisplayRevision) };
        await port.setRules(rules(next.enabled, next.dashboardDisabled));
        try { await port.store(next); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled)); }
          catch { throw failure("保存と転送設定の復旧に失敗しました。状態を再確認してください。", "UNCONFIRMED"); }
          throw error;
        }
        return core.readSettings(next);
      }),
      author: (operation, options = {}) => run(async () => {
        if (!operation || typeof operation !== "object" || Object.keys(operation).length !== 6 ||
            !["userId", "displayName", "action", "expectedAction", "expectedRevision", "expectedSelf"].every(key => Object.hasOwn(operation, key)) ||
            ![null, "hide", "allow"].includes(operation.action) || ![null, "hide", "allow"].includes(operation.expectedAction)) throw new Error("作者の変更要求が正しくありません。");
        const userId = core.authorId(operation.userId), displayName = core.authorName(operation.displayName);
        const loaded = await port.load(), raw = loaded === undefined ? core.defaultSettings() : loaded, settings = core.readSettings(raw);
        if (options.validateCurrent && !await options.validateCurrent()) throw failure("現在の作者が変わりました。ページを再確認してください。", "CONFLICT");
        if (settings.authorWarning) throw failure(settings.authorWarning, "INVALID_AUTHORS");
        if (operation.expectedRevision !== settings.authorDisplayRevision || operation.expectedSelf !== settings.noteUserId ||
            operation.expectedAction !== (core.authorRule(settings, userId)?.action ?? null)) throw failure("別の画面で作者の表示設定が変更されました。状態を再確認してください。", "CONFLICT");
        if (operation.action !== null && (!settings.noteUserId || core.isSelf(settings, userId))) throw new Error("自分のnoteユーザー名を確認してください。自分は登録できません。");
        if (options.fromArticle && (!settings.enabled || !settings.hidePaidArticles || core.isSelf(settings, userId) || core.authorRule(settings, userId))) throw failure("有料記事の確認条件が変わりました。状態を再確認してください。", "CONFLICT");
        const previous = core.authorRule(settings, userId);
        const rules = settings.authorDisplayRules.filter(rule => rule.userId.toLowerCase() !== userId.toLowerCase());
        if (operation.action !== null) rules.push({ userId, displayName: displayName || previous?.displayName || "", action: operation.action });
        const next = { ...raw, authorDisplayRules: rules, authorDisplayRevision: increment(settings.authorDisplayRevision) };
        if (JSON.stringify(next).length > 1048576) throw new Error("設定データが大きすぎます。登録を整理してください。");
        await port.store(next);
        return core.readSettings(next);
      }),
      tag: (operation, options = {}) => run(async () => {
        if (!operation || !["ADD_TAG", "REMOVE_TAG", "MOVE_TAG", "TRANSFER_TAG", "SELECT_TAG_GROUP", "RENAME_TAG_GROUP"].includes(operation.type) ||
            Object.keys(operation).some(key => !["type", "tag", "beforeTag", "groupId", "targetGroupId", "name", "expectedName"].includes(key)) ||
            !core.groupIds.includes(operation.groupId)) throw new Error("グループを指定して画面を再読み込みしてください。");
        if (["ADD_TAG", "REMOVE_TAG", "MOVE_TAG", "TRANSFER_TAG"].includes(operation.type)) core.normalizeTag(operation.tag);
        if (operation.type === "RENAME_TAG_GROUP") core.normalizeGroupName(operation.name);
        const loaded = await port.load(), raw = loaded === undefined ? core.defaultSettings() : loaded;
        const settings = core.readSettings(raw);
        if (options.requireEnabled && !settings.enabled) throw failure("拡張OFFではタグを追加できません。", "DISABLED");
        if (settings.legacyMode) throw failure("重度ひきこもりモードではタグを編集できません。状態を再確認してください。", "LEGACY_MODE");
        if (settings.tagWarning) throw failure(settings.tagWarning, "INVALID_TAGS");
        if (settings.groupSelectionInvalid && operation.type !== "SELECT_TAG_GROUP") throw failure("グループを選び直してください。", "CONFLICT");
        if (options.selectionRevision !== undefined && (settings.groupSelectionRevision !== options.selectionRevision || settings.selectedTagGroupId !== operation.groupId)) throw failure("選択グループが変わりました。状態を再確認してください。", "CONFLICT");
        const groups = settings.tagGroups.map(group => ({ ...group, tags: [...group.tags] }));
        const group = groups.find(item => item.id === operation.groupId);
        async function storeGroups(patch = {}) {
          const next = { ...raw, tagGroups: groups, tagGroupsRevision: increment(settings.tagGroupsRevision), ...patch };
          await port.store(next); return core.readSettings(next);
        }
        if (operation.type === "SELECT_TAG_GROUP") {
          if (!settings.groupSelectionInvalid && settings.selectedTagGroupId === group.id) return settings;
          return storeGroups({ selectedTagGroupId: group.id, groupSelectionRevision: increment(settings.groupSelectionRevision) });
        }
        if (operation.type === "RENAME_TAG_GROUP") {
          if (operation.expectedName !== group.name) throw failure("別の画面でグループ名が変更されました。", "CONFLICT");
          const name = core.normalizeGroupName(operation.name);
          if (name === group.name) return settings;
          group.name = name; return storeGroups();
        }
        const tag = core.normalizeTag(operation.tag);
        const tags = group.tags;
        const index = tags.indexOf(tag);
        if (operation.type === "ADD_TAG") {
          if (index >= 0) throw failure("このタグは既に登録されています。", "CONFLICT");
          tags.push(tag);
        } else {
          if (index < 0) throw failure("対象タグが別の画面で削除されています。最新一覧を確認してください。", "CONFLICT");
          if (operation.type === "TRANSFER_TAG") {
            const target = groups.find(item => item.id === operation.targetGroupId);
            if (!target || target === group) throw new Error("別の移動先グループを指定してください。");
            if (target.tags.includes(tag)) throw failure("移動先には既に登録されています。", "CONFLICT");
            tags.splice(index, 1); target.tags.push(tag);
          } else if (operation.type === "REMOVE_TAG") tags.splice(index, 1);
          else {
            if (operation.beforeTag !== null && typeof operation.beforeTag !== "string") throw new Error("移動先を指定してください。");
            const before = operation.beforeTag === null ? null : core.normalizeTag(operation.beforeTag);
            if (before === tag) return settings;
            if (before !== null && !tags.includes(before)) throw failure("移動先のタグが削除されています。最新一覧を確認してください。", "CONFLICT");
            tags.splice(index, 1);
            tags.splice(before === null ? tags.length : tags.indexOf(before), 0, tag);
          }
        }
        return storeGroups();
      })
    });
  }
  globalThis.HikikomoriNoteRouting = Object.freeze({ rules, createController });
})();
