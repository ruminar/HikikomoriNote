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
      const { tagWarning, ...clean } = settings;
      if (tagWarning) clean.favoriteTags = raw.favoriteTags;
      return { ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), ...clean };
    }
    return Object.freeze({
      getState: () => run(async () => {
        const settings = core.readSettings(await port.load());
        await port.setRules(rules(settings.enabled, settings.dashboardDisabled));
        return settings;
      }),
      save: patch => run(async () => {
        if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
            Object.keys(patch).some(key => !["enabled", "noteUserId", "dashboardDisabled", "legacyMode", "hideArticleRecommendations"].includes(key))) {
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
        if (Object.hasOwn(patch, "hideArticleRecommendations") && typeof patch.hideArticleRecommendations !== "boolean") throw new Error("おすすめ表示設定の値が正しくありません。");
        const next = { ...previous, ...patch };
        next.noteUserId = core.normalizeUserId(next.noteUserId);
        await port.setRules(rules(next.enabled, next.dashboardDisabled));
        try { await port.store(storedValue(raw, next)); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled)); }
          catch { throw new Error("保存と転送設定の復旧に失敗しました。拡張を無効化して再読み込みしてください。"); }
          throw error;
        }
        return next;
      }),
      tag: operation => run(async () => {
        if (!operation || !["ADD_TAG", "REMOVE_TAG", "MOVE_TAG"].includes(operation.type) ||
            Object.keys(operation).some(key => !["type", "tag", "beforeTag"].includes(key))) throw new Error("タグ操作の形式が正しくありません。");
        const raw = await port.load();
        const settings = core.readSettings(raw);
        if (settings.legacyMode) throw failure("重度引きこもりモードではタグを編集できません。状態を再確認してください。", "LEGACY_MODE");
        if (settings.tagWarning) throw failure(settings.tagWarning, "INVALID_TAGS");
        const tag = core.normalizeTag(operation.tag);
        const tags = [...settings.favoriteTags];
        const index = tags.indexOf(tag);
        if (operation.type === "ADD_TAG") {
          if (index >= 0) throw failure("このタグは既に登録されています。", "CONFLICT");
          tags.push(tag);
        } else {
          if (index < 0) throw failure("対象タグが別の画面で削除されています。最新一覧を確認してください。", "CONFLICT");
          if (operation.type === "REMOVE_TAG") tags.splice(index, 1);
          else {
            if (operation.beforeTag !== null && typeof operation.beforeTag !== "string") throw new Error("移動先を指定してください。");
            const before = operation.beforeTag === null ? null : core.normalizeTag(operation.beforeTag);
            if (before === tag) return settings;
            if (before !== null && !tags.includes(before)) throw failure("移動先のタグが削除されています。最新一覧を確認してください。", "CONFLICT");
            tags.splice(index, 1);
            tags.splice(before === null ? tags.length : tags.indexOf(before), 0, tag);
          }
        }
        const next = { ...settings, favoriteTags: tags };
        await port.store(storedValue(raw, next));
        return next;
      })
    });
  }
  globalThis.HikikomoriNoteRouting = Object.freeze({ rules, createController });
})();
