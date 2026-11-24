/* Chromiumのルール形式と、設定・ルールの単一書込制御。通信内容は取得しない。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const singleAddTypes = ["ADD_TAG", "ADD_USER", "ADD_MAGAZINE", "ADD_MEMBERSHIP", "ADD_ARTICLE"];
  function rules(enabled, dashboardDisabled = false, mode = "normal") {
    if (!enabled) return [];
    const regexFilter = "^https://note\\.com/([?#].*)?$";
    const result = mode === "social" ? [] : [
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
      // 元データの保護を維持し、検証済みの8グループ移行と選択補正だけを許可する。
      for (const key of ["tagSchemaVersion", "tagGroups", "selectedTagGroupId", "groupSelectionRevision", "tagGroupsRevision", "authorDisplayRules", "authorDisplayRevision"]) delete clean[key];
      const result = { ...(raw === undefined ? core.defaultSettings() : raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), ...clean };
      if (!settings.tagWarning && settings.tagGroups.length === 8 && result.tagSchemaVersion !== 7) {
        result.tagGroups = settings.tagGroups;
        result.tagSchemaVersion = 7;
      }
      const selection = core.selectedGroupId(settings);
      if (!settings.tagWarning && !settings.groupSelectionInvalid && selection !== result.selectedTagGroupId) {
        result.selectedTagGroupId = selection;
        result.groupSelectionRevision = increment(settings.groupSelectionRevision);
      }
      delete result.legacyMode;
      return result;
    }
    function increment(value) {
      if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) throw failure("更新番号が不正か上限です。編集を停止しました。", "INVALID_TAGS");
      return value + 1;
    }
    return Object.freeze({
      getState: () => run(async () => {
        const settings = core.readSettings(await port.load());
        await port.setRules(rules(settings.enabled, settings.dashboardDisabled, core.modeOf(settings)));
        return settings;
      }),
      save: patch => run(async () => {
        if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
            Object.keys(patch).some(key => !["enabled", "theme", "noteUserId", "dashboardDisabled", "mode", "hideArticleRecommendations", "hidePaidArticles", "hideLikeCounts", "noteLogoBrowserBack", "keepNoteHeaderVisible"].includes(key))) {
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
        if (Object.hasOwn(patch, "mode") && !core.operationModes.includes(patch.mode)) throw new Error("モード設定の値が正しくありません。");
        if (Object.hasOwn(patch, "hidePaidArticles") && typeof patch.hidePaidArticles !== "boolean") throw new Error("有料記事表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "hideLikeCounts") && typeof patch.hideLikeCounts !== "boolean") throw new Error("スキ数表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "hideArticleRecommendations") && typeof patch.hideArticleRecommendations !== "boolean") throw new Error("おすすめ表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "noteLogoBrowserBack") && typeof patch.noteLogoBrowserBack !== "boolean") throw new Error("ロゴのブラウザバック設定の値が正しくありません。");
        if (Object.hasOwn(patch, "keepNoteHeaderVisible") && typeof patch.keepNoteHeaderVisible !== "boolean") throw new Error("ヘッダ表示設定の値が正しくありません。");
        if (Object.hasOwn(patch, "theme") && !["system", "dark", "light"].includes(patch.theme)) throw new Error("テーマの値が正しくありません。");
        const next = { ...previous, ...patch };
        // 旧4グループを2段モードで初めて保存する際にだけ不足領域を補う。
        if (!previous.tagWarning && next.mode === "normal-double" && next.tagGroups.length === 4) {
          next.tagGroups = core.groupIds.map(id => next.tagGroups.find(group => group.id === id) || { id, name: "", tags: [] });
        }
        next.noteUserId = core.normalizeUserId(next.noteUserId);
        await port.setRules(rules(next.enabled, next.dashboardDisabled, core.modeOf(next)));
        try { await port.store(storedValue(raw, next)); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled, core.modeOf(previous))); }
          catch { throw new Error("保存と転送設定の復旧に失敗しました。拡張を無効化して再読み込みしてください。"); }
          throw error;
        }
        return core.readSettings(storedValue(raw, next));
      }),
      importSettings: patch => run(async () => {
        if (!patch || Object.keys(patch).length !== 2 || typeof patch.expectedToken !== "string" || !Object.hasOwn(patch, "json")) throw new Error("読み込み要求が正しくありません。");
        const previous = core.readSettings(await port.load());
        const report = core.inspectSettingsImport(patch.json, previous), imported = report.settings;
        if (core.settingsToken(previous) !== patch.expectedToken) throw failure("別の画面で設定が変更されました。状態を再確認し、もう一度読み込んでください。", "CONFLICT");
        if (!report.applied.length) return { ...previous, importReport: { applied: [], ignored: report.ignored } };
        const next = { ...imported, tagSchemaVersion: core.favoriteSchema(imported.tagGroups),
          groupSelectionRevision: increment(previous.groupSelectionRevision), tagGroupsRevision: increment(previous.tagGroupsRevision), authorDisplayRevision: increment(previous.authorDisplayRevision) };
        await port.setRules(rules(next.enabled, next.dashboardDisabled, core.modeOf(next)));
        try { await port.store(next); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled, core.modeOf(previous))); }
          catch { throw failure("保存と転送設定の復旧に失敗しました。状態を再確認してください。", "UNCONFIRMED"); }
          throw error;
        }
        return { ...core.readSettings(next), importReport: { applied: report.applied, ignored: report.ignored } };
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
        if (options.requireExisting && !previous) throw failure("新規登録は作者のページで行ってください。", "CONFLICT");
        const rules = settings.authorDisplayRules.filter(rule => rule.userId.toLowerCase() !== userId.toLowerCase());
        if (operation.action !== null) rules.push({ userId: options.requireExisting ? previous.userId : userId,
          displayName: options.requireExisting ? previous.displayName : displayName || previous?.displayName || "", action: operation.action });
        const next = { ...storedValue(raw, settings), authorDisplayRules: rules, authorDisplayRevision: increment(settings.authorDisplayRevision) };
        if (JSON.stringify(next).length > 1048576) throw new Error("設定データが大きすぎます。登録を整理してください。");
        await port.store(next);
        return core.readSettings(next);
      }),
      tag: (operation, options = {}) => run(async () => {
        if (!operation || ![...singleAddTypes, "ADD_TAGS", "REMOVE_TAG", "MOVE_TAG", "TRANSFER_TAG", "SELECT_TAG_GROUP", "RENAME_TAG_GROUP", "CLEAR_TAG_GROUP"].includes(operation.type) ||
            Object.keys(operation).some(key => !["type", "tags", "tag", "beforeTag", "groupId", "targetGroupId", "name", "expectedName", "userId", "magazineId", "displayName", "articleId", "url", "title", "position", "expectedTagGroupsRevision", "expectedGroupSelectionRevision"].includes(key)) ||
            !core.groupIds.includes(operation.groupId)) throw new Error("グループを指定して画面を再読み込みしてください。");
        if (Object.hasOwn(operation, "position") && (operation.type !== "ADD_TAGS" && !singleAddTypes.includes(operation.type) ||
            (operation.position !== undefined && !["start", "end"].includes(operation.position)))) throw new Error("お気に入りの追加位置を確認してください。");
        if (operation.type === "ADD_TAG") core.normalizeTag(operation.tag);
        if (operation.type === "ADD_TAGS" && (!Array.isArray(operation.tags) || !operation.tags.length || operation.tags.some(tag => typeof tag !== "string") || JSON.stringify(operation.tags).length > 1048576)) throw new Error("登録するタグ候補を確認してください（1,048,576文字以内）。");
        if (["REMOVE_TAG", "MOVE_TAG", "TRANSFER_TAG"].includes(operation.type)) core.favorite(operation.tag);
        if (operation.type === "ADD_USER" && (!options.validateCurrent || !options.currentUser || core.authorId(operation.userId).toLowerCase() !== options.currentUser.toLowerCase())) throw new Error("作者ページから登録してください。");
        if (operation.type === "ADD_MAGAZINE" && (!options.validateCurrent || !options.currentUser || core.authorId(operation.userId).toLowerCase() !== options.currentUser.toLowerCase() || operation.magazineId !== options.currentMagazineId)) throw new Error("マガジンのページから登録してください。");
        if (operation.type === "ADD_MEMBERSHIP" && (!options.validateCurrent || options.currentMembership !== true || !options.currentUser || core.authorId(operation.userId).toLowerCase() !== options.currentUser.toLowerCase())) throw new Error("メンバーシップのページから登録してください。");
        if (operation.type === "ADD_ARTICLE") {
          const item = core.favoriteArticle({ type: "article", articleId: operation.articleId, url: operation.url, title: operation.title });
          if (!options.validateCurrent || options.currentArticleId !== item.articleId || options.currentArticleUrl !== item.url) throw new Error("表示中の記事ページから登録してください。");
        }
        if (operation.type === "RENAME_TAG_GROUP") core.normalizeGroupName(operation.name);
        const loaded = await port.load(), raw = loaded === undefined ? core.defaultSettings() : loaded;
        const settings = core.readSettings(raw);
        if (options.requireEnabled && !settings.enabled) throw failure("拡張OFFではタグを追加できません。", "DISABLED");
        if (!core.usesTags(settings)) throw failure("現在のモードではタグを編集できません。状態を再確認してください。", "MODE_RESTRICTED");
        if (settings.tagWarning) throw failure(settings.tagWarning, "INVALID_TAGS");
        const available = core.availableGroups(settings);
        if (!available.some(group => group.id === operation.groupId) ||
            (operation.type === "TRANSFER_TAG" && !available.some(group => group.id === operation.targetGroupId))) {
          throw failure("現在のモードではこのグループを操作できません。状態を再確認してください。", "MODE_RESTRICTED");
        }
        if (settings.groupSelectionInvalid && operation.type !== "SELECT_TAG_GROUP") throw failure("グループを選び直してください。", "CONFLICT");
        if (options.selectionRevision !== undefined && (settings.groupSelectionRevision !== options.selectionRevision || settings.selectedTagGroupId !== operation.groupId)) throw failure("選択グループが変わりました。状態を再確認してください。", "CONFLICT");
        const groups = settings.tagGroups.map(group => ({ ...group, tags: [...group.tags] }));
        const group = groups.find(item => item.id === operation.groupId);
        async function storeGroups(patch = {}) {
          if (options.validateCurrent && !await options.validateCurrent()) throw failure("現在の作者が変わりました。ページを再確認してください。", "CONFLICT");
          const next = { ...storedValue(raw, settings), tagSchemaVersion: core.favoriteSchema(groups, settings.tagSchemaVersion), tagGroups: groups, tagGroupsRevision: increment(settings.tagGroupsRevision), ...patch };
          if (JSON.stringify(next).length > 1048576) throw new Error("設定データが大きすぎます。登録を整理してください。");
          await port.store(next); return core.readSettings(next);
        }
        if (operation.type === "ADD_TAGS") {
          const normalized = operation.tags.flatMap(tag => { try { return [core.normalizeTag(tag)]; } catch { return []; } });
          const candidates = core.normalizeTagCandidates(normalized), report = { added: 0, duplicates: normalized.length - candidates.length, skipped: operation.tags.length - normalized.length };
          const seen = new Set(group.tags.filter(item => typeof item === "string"));
          const added = [];
          let size = JSON.stringify({ ...storedValue(raw, settings), tagSchemaVersion: core.favoriteSchema(groups, settings.tagSchemaVersion), tagGroups: groups, tagGroupsRevision: increment(settings.tagGroupsRevision) }).length;
          for (const tag of candidates) {
            if (seen.has(tag)) { report.duplicates++; continue; }
            const extra = JSON.stringify(tag).length + (group.tags.length || added.length ? 1 : 0);
            if (size + extra > 1048576) { report.skipped++; continue; }
            added.push(tag); seen.add(tag); size += extra;
          }
          report.added = added.length;
          if (added.length) group.tags = operation.position === "start" ? added.concat(group.tags) : group.tags.concat(added);
          const saved = added.length ? await storeGroups() : settings;
          return { ...saved, bulkTagReport: report };
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
        if (operation.type === "CLEAR_TAG_GROUP") {
          if (settings.selectedTagGroupId !== group.id ||
              operation.expectedTagGroupsRevision !== settings.tagGroupsRevision ||
              operation.expectedGroupSelectionRevision !== settings.groupSelectionRevision) {
            throw failure("グループの内容や選択が変わりました。もう一度確認してください。", "CONFLICT");
          }
          if (!group.tags.length) return settings;
          group.tags = [];
          return storeGroups();
        }
        const tag = operation.type === "ADD_ARTICLE" ? core.favoriteArticle({ type: "article", articleId: operation.articleId, url: operation.url, title: operation.title }) : operation.type === "ADD_MEMBERSHIP" ? core.favoriteMembership({ type: "membership", userId: operation.userId, displayName: operation.displayName }) : operation.type === "ADD_MAGAZINE" ? core.favoriteMagazine({ type: "magazine", userId: operation.userId, magazineId: operation.magazineId, displayName: operation.displayName }) : operation.type === "ADD_USER" ? core.favoriteUser({ type: "user", userId: operation.userId, displayName: operation.displayName }) : operation.type === "ADD_TAG" ? core.normalizeTag(operation.tag) : core.favorite(operation.tag);
        const tags = group.tags;
        const key = core.favoriteKey(tag), index = tags.findIndex(item => core.favoriteKey(item) === key);
        if (singleAddTypes.includes(operation.type)) {
          if (index >= 0 || (tag?.type === "article" && groups.some(g => g.tags.some(item => core.favoriteKey(item) === key)))) throw failure("このお気に入りは既に登録されています。", "CONFLICT");
          if (operation.position === "start") tags.unshift(tag);
          else tags.push(tag);
        } else {
          if (index < 0) throw failure("対象タグが別の画面で削除されています。最新一覧を確認してください。", "CONFLICT");
          if (operation.type === "TRANSFER_TAG") {
            const target = groups.find(item => item.id === operation.targetGroupId);
            if (!target || target === group) throw new Error("別の移動先グループを指定してください。");
            if (target.tags.some(item => core.favoriteKey(item) === key)) throw failure("移動先には既に登録されています。", "CONFLICT");
            target.tags.push(tags.splice(index, 1)[0]);
          } else if (operation.type === "REMOVE_TAG") tags.splice(index, 1);
          else {
            const before = operation.beforeTag === null ? null : core.favorite(operation.beforeTag);
            const beforeKey = before === null ? null : core.favoriteKey(before);
            if (beforeKey === key) return settings;
            if (before !== null && !tags.some(item => core.favoriteKey(item) === beforeKey)) throw failure("移動先のタグが削除されています。最新一覧を確認してください。", "CONFLICT");
            const moved = tags.splice(index, 1)[0];
            tags.splice(before === null ? tags.length : tags.findIndex(item => core.favoriteKey(item) === beforeKey), 0, moved);
          }
        }
        return storeGroups();
      })
    });
  }
  globalThis.HikikomoriNoteRouting = Object.freeze({ rules, createController });
})();
