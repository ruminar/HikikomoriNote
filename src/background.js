"use strict";
// ChromiumはService Workerから読込。Firefoxはmanifestのbackground.scriptsで順に読込。
if (typeof importScripts === "function") {
  importScripts("common.js", "platform/browser-api.js", "routing.js");
}
const port = globalThis.HikikomoriNoteBackgroundPlatform;
const controller = globalThis.HikikomoriNoteRouting.createController(port);
function reconcile() {
  void controller.getState().catch(error => console.warn("ひきこもりnote：転送設定を適用できません。", error));
}
port.onInstalled(reconcile);
port.onStartup(reconcile);
port.onAction(() => {
  void (async () => {
    let activationFailed = false;
    try { await controller.save({ enabled: true }); }
    catch (error) {
      activationFailed = true;
      console.warn("ひきこもりnote：ONへの切り替えに失敗しました。", error);
    }
    // ONの保存・転送適用を終えてから開く。失敗時も専用画面で案内する。
    await port.openHome(activationFailed);
  })().catch(error => console.warn(error));
});
// note上はグループ選択と送信元URLのタグ追加だけ。設定変更・削除・並べ替えは専用ホームに限定。
port.onMessage((message, sender, respond) => {
  let operation;
  if (port.isHomeSender(sender)) {
    if (message?.type === "get-state") operation = controller.getState();
    else if (message?.type === "save-settings") operation = controller.save(message.patch);
    else if (message?.type === "import-settings") operation = controller.importSettings(message.patch);
    else if (message?.type === "tag-operation") operation = controller.tag(message.patch);
    else if (message?.type === "select-tag-group") operation = controller.tag({ type: "SELECT_TAG_GROUP", groupId: message.patch?.groupId });
    else return false;
  } else {
    if (!["select-tag-group", "add-current-tag"].includes(message?.type) || !port.isNoteSender?.(sender)) return false;
    operation = (async () => {
      const page = await port.currentMenuPage(sender, message.patch?.pageUrl);
      if (!page || (message.type === "add-current-tag" && page.type !== "tag")) {
        throw Object.assign(new Error("表示中のページを確認できません。ページの読み込みが完了してから、もう一度お試しください。"), { code: "CONFLICT" });
      }
      if (message.type === "select-tag-group") {
        return controller.tag({ type: "SELECT_TAG_GROUP", groupId: message.patch?.groupId }, { requireEnabled: true });
      }
      if (!Number.isSafeInteger(message.patch?.selectionRevision) || message.patch.selectionRevision < 0) {
        throw Object.assign(new Error("選択グループを再確認してください。"), { code: "CONFLICT" });
      }
      return controller.tag({ type: "ADD_TAG", tag: page.tag, groupId: message.patch?.groupId }, { requireEnabled: true, selectionRevision: message.patch.selectionRevision });
    })();
  }
  operation.then(settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message || "設定処理に失敗しました。", code: error.code || "OPERATION_FAILED" }));
  return true;
});
reconcile();
