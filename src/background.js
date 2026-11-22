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
// note上はグループ選択と表示中のタグ・作者の登録。設定変更・削除・並べ替えは専用ホームに限定。
port.onMessage((message, sender, respond) => {
  let operation;
  if (port.isHomeSender(sender)) {
    if (message?.type === "get-state") operation = controller.getState();
    else if (message?.type === "save-settings") operation = controller.save(message.patch);
    else if (message?.type === "import-settings") operation = controller.importSettings(message.patch);
    else if (message?.type === "author-operation") operation = controller.author(message.patch, { requireExisting: true });
    else if (message?.type === "tag-operation") operation = controller.tag(message.patch);
    else if (message?.type === "bulk-add-tags") operation = controller.tag({ type: "ADD_TAGS", groupId: message.patch?.groupId, tags: message.patch?.tags, position: message.patch?.position });
    else if (message?.type === "select-tag-group") operation = controller.tag({ type: "SELECT_TAG_GROUP", groupId: message.patch?.groupId });
    else return false;
  } else {
    if (!["bulk-add-tags", "menu-favorite-drop", "add-searched-user", "select-tag-group", "add-current-tag", "add-current-user", "add-current-magazine", "add-current-membership", "add-current-article", "current-author-operation"].includes(message?.type) || !port.isNoteSender?.(sender)) return false;
    operation = (async () => {
      if (message.type === "bulk-add-tags") {
        const patch = message.patch;
        if (!patch || Object.keys(patch).some(key => !["groupId", "tags", "pageUrl", "position"].includes(key))) throw new Error("タグの登録要求を確認してください。");
        const page = await port.currentAuthorPage(sender, patch.pageUrl);
        if (page?.type !== "article") throw Object.assign(new Error("現在の記事ページを確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_TAGS", groupId: patch.groupId, tags: patch.tags, position: patch.position }, {
          requireEnabled: true, validateCurrent: async () => (await port.currentAuthorPage(sender, patch.pageUrl))?.type === "article"
        });
      }
      if (message.type === "menu-favorite-drop") {
        const patch = message.patch, change = patch?.operation;
        const keys = ["type", "groupId", "tag", ...(change?.type === "MOVE_TAG" ? ["beforeTag"] : change?.type === "TRANSFER_TAG" ? ["targetGroupId"] : [])];
        if (!patch || Object.keys(patch).some(key => !["operation", "selectionRevision", "pageUrl"].includes(key)) ||
            !change || !["REMOVE_TAG", "TRANSFER_TAG", "MOVE_TAG"].includes(change.type) || Object.keys(change).some(key => !keys.includes(key)) ||
            !Number.isSafeInteger(patch.selectionRevision) || patch.selectionRevision < 0) throw Object.assign(new Error("お気に入りの操作を確認できません。"), { code: "CONFLICT" });
        const page = await port.currentMenuPage(sender, patch.pageUrl);
        if (!page || !globalThis.HikikomoriNote.hasFavoriteMenu(patch.pageUrl)) throw Object.assign(new Error("お気に入りのあるメニューで操作してください。"), { code: "CONFLICT" });
        return controller.tag(change, { requireEnabled: true, selectionRevision: patch.selectionRevision, validateCurrent: async () => {
          const current = await port.currentMenuPage(sender, patch.pageUrl);
          return Boolean(current && globalThis.HikikomoriNote.hasFavoriteMenu(patch.pageUrl));
        } });
      }
      if (message.type === "add-searched-user") {
        const patch = message.patch, page = await port.currentMenuPage(sender, patch?.pageUrl);
        const userId = globalThis.HikikomoriNote.searchedAuthor(patch?.pageUrl);
        if (page?.type !== "search" || !userId || typeof patch?.userId !== "string" || userId.toLowerCase() !== patch.userId.toLowerCase() ||
            !Number.isSafeInteger(patch.selectionRevision) || patch.selectionRevision < 0) throw Object.assign(new Error("検索中の作者と選択グループを確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_USER", groupId: patch.groupId, userId, displayName: patch.displayName, position: patch.position }, {
          requireEnabled: true, currentUser: userId, selectionRevision: patch.selectionRevision, validateCurrent: async () => {
            const current = await port.currentMenuPage(sender, patch.pageUrl);
            return current?.type === "search" && globalThis.HikikomoriNote.searchedAuthor(patch.pageUrl)?.toLowerCase() === userId.toLowerCase();
          }
        });
      }
      if (message.type === "add-current-article") {
        const patch = message.patch, page = await port.currentArticlePage(sender, patch?.pageUrl);
        if (!page || page.articleId !== patch?.articleId || page.url !== patch?.url) throw Object.assign(new Error("現在の記事を確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_ARTICLE", groupId: patch.groupId, articleId: patch.articleId, url: patch.url, title: patch.title, position: patch.position }, { requireEnabled: true, currentArticleId: page.articleId, currentArticleUrl: page.url, validateCurrent: async () => {
          const current = await port.currentArticlePage(sender, patch.pageUrl);
          return current?.articleId === page.articleId && current.url === page.url;
        } });
      }
      if (message.type === "add-current-membership") {
        const patch = message.patch, page = await port.currentMembershipPage(sender, patch?.pageUrl);
        if (page?.type !== "membership" || typeof patch?.userId !== "string" || page.user.toLowerCase() !== patch.userId.toLowerCase()) throw Object.assign(new Error("現在のメンバーシップを確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_MEMBERSHIP", groupId: patch.groupId, userId: patch.userId, displayName: patch.displayName, position: patch.position }, { requireEnabled: true, currentUser: page.user, currentMembership: true, validateCurrent: async () => {
          const current = await port.currentMembershipPage(sender, patch.pageUrl);
          return current?.type === "membership" && current.user.toLowerCase() === page.user.toLowerCase();
        } });
      }
      if (message.type === "add-current-magazine") {
        const patch = message.patch, page = await port.currentMagazinePage(sender, patch?.pageUrl);
        if (page?.type !== "magazine" || typeof patch?.userId !== "string" || page.user.toLowerCase() !== patch.userId.toLowerCase() || page.magazineId !== patch.magazineId) throw Object.assign(new Error("現在のマガジンを確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_MAGAZINE", groupId: patch.groupId, userId: patch.userId, magazineId: patch.magazineId, displayName: patch.displayName, position: patch.position }, { requireEnabled: true, currentUser: page.user, currentMagazineId: page.magazineId, validateCurrent: async () => {
          const current = await port.currentMagazinePage(sender, patch.pageUrl);
          return current?.type === "magazine" && current.user.toLowerCase() === page.user.toLowerCase() && current.magazineId === page.magazineId;
        } });
      }
      if (message.type === "add-current-user") {
        const patch = message.patch, page = await port.currentAuthorPage(sender, patch?.pageUrl);
        if (page?.type !== "profile" || typeof patch?.userId !== "string" || page.user.toLowerCase() !== patch.userId.toLowerCase()) throw Object.assign(new Error("現在の作者ページを確認できません。"), { code: "CONFLICT" });
        return controller.tag({ type: "ADD_USER", groupId: patch.groupId, userId: patch.userId, displayName: patch.displayName, position: patch.position }, { requireEnabled: true, currentUser: page.user, validateCurrent: async () => {
          const current = await port.currentAuthorPage(sender, patch.pageUrl);
          return current?.type === "profile" && current.user.toLowerCase() === page.user.toLowerCase();
        } });
      }
      if (message.type === "current-author-operation") {
        const page = await port.currentAuthorPage(sender, message.patch?.pageUrl);
        const source = message.patch?.source, patch = message.patch?.operation;
        if (!page || !["article", "profile"].includes(source) || page.type !== source ||
            typeof patch?.userId !== "string" || page.user.toLowerCase() !== patch.userId.toLowerCase()) throw Object.assign(new Error("現在の作者を確認できません。"), { code: "CONFLICT" });
        return controller.author(patch, { fromArticle: source === "article", validateCurrent: async () => {
          const current = await port.currentAuthorPage(sender, message.patch.pageUrl);
          return current?.type === source && current.user.toLowerCase() === patch.userId.toLowerCase();
        } });
      }
      const page = await port.currentMenuPage(sender, message.patch?.pageUrl);
      const tag = page?.type === "tag" ? page.tag : page?.type === "search" && message.type === "add-current-tag" ? globalThis.HikikomoriNote.addableTag(message.patch?.pageUrl) : null;
      if (!page || (message.type === "add-current-tag" && tag === null)) {
        throw Object.assign(new Error("表示中のページを確認できません。ページの読み込みが完了してから、もう一度お試しください。"), { code: "CONFLICT" });
      }
      if (message.type === "select-tag-group") {
        return controller.tag({ type: "SELECT_TAG_GROUP", groupId: message.patch?.groupId }, { requireEnabled: true });
      }
      if (!Number.isSafeInteger(message.patch?.selectionRevision) || message.patch.selectionRevision < 0) {
        throw Object.assign(new Error("選択グループを再確認してください。"), { code: "CONFLICT" });
      }
      return controller.tag({ type: "ADD_TAG", tag, groupId: message.patch?.groupId, position: message.patch?.position }, {
        requireEnabled: true, selectionRevision: message.patch.selectionRevision,
        ...(page.type === "search" ? { validateCurrent: async () => {
          const current = await port.currentMenuPage(sender, message.patch.pageUrl);
          return current?.type === "search" && globalThis.HikikomoriNote.addableTag(message.patch.pageUrl) === tag;
        } } : {})
      });
    })();
  }
  operation.then(settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message || "設定処理に失敗しました。", code: error.code || "OPERATION_FAILED" }));
  return true;
});
reconcile();
