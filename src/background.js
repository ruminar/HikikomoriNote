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
// note上のコンテンツスクリプトや外部ページには設定変更を許可しない。
port.onMessage((message, sender, respond) => {
  if (!port.isHomeSender(sender)) return false;
  let operation;
  if (message?.type === "get-state") operation = controller.getState();
  else if (message?.type === "save-settings") operation = controller.save(message.patch);
  else return false;
  operation.then(settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message || "設定処理に失敗しました。" }));
  return true;
});
reconcile();
