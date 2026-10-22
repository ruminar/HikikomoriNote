(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const byId = id => document.getElementById(id);
  let busy = false;
  function show(settings) {
    byId("note-user").value = settings.noteUserId;
    byId("dashboard-disabled").checked = settings.dashboardDisabled === true;
    const url = core.profileUrl(settings.noteUserId);
    byId("profile").hidden = !url;
    if (url) byId("profile").href = url;
    else byId("profile").removeAttribute("href");
    byId("user-status").textContent = url ? `登録ユーザー：${settings.noteUserId}` : "下の設定でnoteユーザー名を登録してください。";
    byId("mode").textContent = settings.enabled ? "ON：noteの通常ホームへの移動を、この専用ホームへ転送します。" : "OFF：noteの通常ホームを利用できます。拡張アイコンを押すとONに戻ります。";
  }
  async function perform(task) {
    if (busy) return;
    busy = true;
    document.querySelectorAll("button, input").forEach(node => { node.disabled = true; });
    byId("status").textContent = "処理しています…";
    try {
      const result = await task();
      show(result);
      byId("status").textContent = location.hash === "#activation-failed" && !result.enabled
        ? "ONへの切り替えに失敗しました。拡張アイコンを押して再度お試しください。"
        : "設定と転送状態を確認しました。";
      for (const id of ["normal", "note-user", "dashboard-disabled", "save"]) byId(id).disabled = false;
    } catch (error) {
      byId("status").textContent = `処理できませんでした。${error.message} 状態を再確認してください。`;
    } finally {
      busy = false;
      byId("retry").disabled = false;
    }
  }
  byId("normal").onclick = () => { void perform(async () => {
    const result = await platform.save({ enabled: false });
    location.assign("https://note.com/");
    return result;
  }); };
  byId("settings").onsubmit = event => {
    event.preventDefault();
    let noteUserId;
    try { noteUserId = core.normalizeUserId(byId("note-user").value); }
    catch (error) { byId("status").textContent = error.message; byId("note-user").focus(); return; }
    void perform(() => platform.save({ noteUserId, dashboardDisabled: byId("dashboard-disabled").checked }));
  };
  byId("retry").onclick = () => { void perform(() => platform.getState()); };
  platform.subscribe(() => { if (!busy) void perform(() => platform.getState()); });
  void perform(() => platform.getState());
})();
