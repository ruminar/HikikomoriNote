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
    return Object.freeze({
      getState: () => run(async () => {
        const settings = core.readSettings(await port.load());
        await port.setRules(rules(settings.enabled, settings.dashboardDisabled));
        return settings;
      }),
      save: patch => run(async () => {
        if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
            Object.keys(patch).some(key => !["enabled", "noteUserId", "dashboardDisabled"].includes(key))) {
          throw new Error("設定の形式が正しくありません。");
        }
        if (Object.hasOwn(patch, "enabled") && typeof patch.enabled !== "boolean") {
          throw new Error("ON/OFFの値が正しくありません。");
        }
        const previous = core.readSettings(await port.load());
        if (Object.hasOwn(patch, "dashboardDisabled") && typeof patch.dashboardDisabled !== "boolean") {
          throw new Error("ダッシュボード設定の値が正しくありません。");
        }
        const next = { ...previous, ...patch };
        next.noteUserId = core.normalizeUserId(next.noteUserId);
        await port.setRules(rules(next.enabled, next.dashboardDisabled));
        try { await port.store(next); }
        catch (error) {
          try { await port.setRules(rules(previous.enabled, previous.dashboardDisabled)); }
          catch { throw new Error("保存と転送設定の復旧に失敗しました。拡張を無効化して再読み込みしてください。"); }
          throw error;
        }
        return next;
      })
    });
  }
  globalThis.HikikomoriNoteRouting = Object.freeze({ rules, createController });
})();
