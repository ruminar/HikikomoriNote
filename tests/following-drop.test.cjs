"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { documentFromHtml } = require("./helpers/dom.cjs"), settingsData = require("./helpers/settings.cjs");
const source = name => fs.readFileSync(path.join(__dirname, "..", "src", name + ".js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value)), flush = () => new Promise(resolve => setImmediate(resolve));
const items = ["SampleTag", { type: "user", userId: "sample_author", displayName: "Sample" },
  { type: "magazine", userId: "sample_author", magazineId: "m123", displayName: "Magazine" },
  { type: "membership", userId: "sample_author", displayName: "Membership" },
  { type: "article", articleId: "n123", url: "https://note.com/sample_author/n/n123", title: "Article" }];
const html = '<header data-header-state="navbar"><div><a href="/" target="_self"><svg role="img" aria-label="note"></svg></a></div></header><div class="min-h-screen lg:grid lg:grid-cols-[202px_minmax(0,1fr)]"><div id="sidebar" class="sticky top-3 hidden h-full max-h-screen w-[11.375rem] overflow-y-auto pr-4 lg:block"><div><nav aria-label="カテゴリナビゲーション" class="flex flex-col gap-4"><a href="https://note.com/trend"></a></nav></div></div><main><article></article></main></div>';
async function fixture(patch = {}, options = {}) {
  const c = vm.createContext({ URL, console });
  for (const name of ["common", "routing", "note-ui"]) vm.runInContext(source(name), c);
  const core = c.HikikomoriNote; let stored = { ...settingsData(plain(items)), tagSchemaVersion: 6, ...patch }, state = core.readSettings(stored);
  let url = options.url || "https://note.com/following", handler, writes = 0, checks = 0;
  const calls = [], doc = documentFromHtml(html), win = { wide: !options.mobile, matchMedia: q => ({ matches: q.includes("max-width") ? !win.wide : win.wide }), getComputedStyle: () => ({ display: "block" }) };
  const windowEvents = new Map();
  win.addEventListener = (type, listener) => windowEvents.set(type, listener);
  win.removeEventListener = type => windowEvents.delete(type);
  win.sessionStorage = options.sessionStorage;
  if (options.scrollLayout) {
    const create = doc.createElement.bind(doc);
    doc.createElement = function(tag) {
      const element = create(tag);
      if (tag === "ul") {
        element.scrollTop = element.clientTop = 0;
        Object.defineProperty(element, "clientHeight", { get: () => element.closest('[class="hikikomori-note-mobile-panel"]')?.hidden ? 0 : 120 });
        element.getBoundingClientRect = () => ({ top: 100, bottom: 220 });
      }
      if (tag === "a") element.getBoundingClientRect = () => {
        const row = element.parentElement, list = row?.parentElement;
        if (list?.tagName !== "UL") return { width: 180 };
        const top = 100 + list.children.indexOf(row) * 40 - list.scrollTop;
        return { top, bottom: top + 40, width: 180 };
      };
      return element;
    };
  }
  if (options.mobile) doc.getElementById("sidebar").width = 0;
  c.HikikomoriNoteBackgroundPlatform = {
    load: async () => stored, store: async value => { await options.saveGate; if (options.saveError) throw Error("save failed"); stored = plain(value); writes++; }, setRules: async () => {},
    onInstalled() {}, onStartup() {}, onAction() {}, onMessage(fn) { handler = fn; }, isHomeSender: s => s.home === true, isNoteSender: s => s.note === true && s.frameId === 0,
    async currentMenuPage(sender, pageUrl) { checks++; if (pageUrl !== url || (options.changeDuringSave && checks > 1)) return null; return core.pageKind(url); }
  };
  vm.runInContext(source("background"), c); await flush();
  const send = (type, patch, sender = { note: true, frameId: 0 }) => new Promise(resolve => {
    if (!handler({ type, patch }, sender, resolve)) resolve(null);
  });
  let ui;
  async function apply(type, patch) {
    const result = await send(type, patch);
    if (!result?.ok) throw Object.assign(Error(result?.error || "rejected"), { code: result?.code });
    state = result.settings; ui.update(state, url); return state;
  }
  ui = c.HikikomoriNoteUi.create(doc, win, {
    settingsUrl: () => "chrome-extension://self/home.html",
    async menuFavoriteDrop(operation, selectionRevision, pageUrl = url) {
      calls.push({ operation: plain(operation), selectionRevision, pageUrl });
      if (options.unconfirmed) throw Object.assign(Error("result unconfirmed"), { code: "UNCONFIRMED" });
      return apply("menu-favorite-drop", { operation, selectionRevision, pageUrl });
    },
    selectGroup: groupId => apply("select-tag-group", { groupId, pageUrl: url }),
    async refresh() { state = core.readSettings(stored); ui.update(state, url); }
  });
  ui.update(state, url);
  const menu = () => doc.querySelector('[class="hikikomori-note-navigation"]');
  const group = id => menu()?.querySelector(`[data-group-id="${id}"]`);
  const rows = () => menu()?.querySelectorAll('[data-menu-favorite-item]') || [];
  const drag = (index = 0) => { const row = rows()[index], dataTransfer = { setData() {} }; const event = row.fire("dragstart", { dataTransfer }); return { row, dataTransfer, event }; };
  return { c, core, doc, win, ui, options, calls, send, menu, group, rows, drag, windowEvents,
    get state() { return stored; }, get writes() { return writes; }, get checks() { return checks; },
    update() { ui.update(state, url); }, set url(value) { url = value; },
    changed(patch) { stored = { ...stored, ...patch }; state = core.readSettings(stored); ui.update(state, url); }
  };
}
test("TLの全5種を別番号へ移動し、現在番号を🗑にする。通常同期でドラッグが途切れない", async () => {
  for (let index = 0; index < items.length; index++) {
    const groups = settingsData(plain(items)).tagGroups; groups[1].tags = ["Existing"];
    const f = await fixture({ tagGroups: groups }), href = f.rows()[index].querySelector("a").href, drag = f.drag(index);
    assert.equal(f.group("group1").textContent, "🗑"); assert.equal(f.group("group1").getAttribute("data-favorite-drop"), "delete");
    f.ui.invalidatePaidCards(); f.update(); assert.equal(f.group("group1").textContent, "🗑"); assert.equal(drag.row.isConnected, true);
    const target = f.group("group2"); target.fire("dragover", { dataTransfer: drag.dataTransfer }); assert.equal(drag.dataTransfer.dropEffect, "move");
    target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items.filter((_, i) => i !== index)); assert.deepEqual(f.state.tagGroups[1].tags, ["Existing", items[index]]);
    assert.equal(f.state.selectedTagGroupId, "group1"); assert.equal(f.group("group1").textContent, "①"); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].operation.type, "TRANSFER_TAG"); assert.equal(drag.row.querySelector("a").href, href);
    assert.match(f.menu().querySelector('[role="status"]').textContent, /② グループ2へ移動しました/);
  }
});
test("TLの全5種を現在番号へドロップするとお気に入りだけ削除し、選択を維持する", async () => {
  for (let index = 0; index < items.length; index++) {
    const f = await fixture(), drag = f.drag(index); f.group("group1").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items.filter((_, i) => i !== index)); assert.equal(f.state.selectedTagGroupId, "group1");
    assert.equal(f.calls[0].operation.type, "REMOVE_TAG"); assert.match(f.menu().querySelector('[role="status"]').textContent, /削除しました/);
  }
});
test("TLの項目の上半分・下半分で全5種を並べ替え、挿入線とゴミ箱表示を終了時に解除", async () => {
  for (const mobile of [false, true]) for (let index = 0; index < items.length; index++) {
    const f = await fixture({}, { mobile });
    if (mobile) f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]').onclick();
    const drag = f.drag(index), before = index === items.length - 1, target = f.rows()[before ? 0 : items.length - 1], clientY = before ? 1 : 39;
    const over = target.fire("dragover", { dataTransfer: drag.dataTransfer, clientY });
    assert.equal(over.defaultPrevented, true); assert.equal(target.getAttribute("data-favorite-insert"), before ? "before" : "after");
    f.update(); assert.equal(target.isConnected, true); assert.equal(f.group("group1").textContent, "🗑");
    target.fire("drop", { dataTransfer: drag.dataTransfer, clientY }); await flush();
    const rest = items.filter((_, i) => i !== index); assert.deepEqual(f.state.tagGroups[0].tags, before ? [items[index], ...rest] : [...rest, items[index]]);
    assert.equal(f.calls[0].operation.type, "MOVE_TAG"); assert.equal(f.state.selectedTagGroupId, "group1"); assert.equal(f.group("group1").textContent, "①");
    assert.equal(f.menu().querySelector('[data-favorite-insert]'), null); assert.match(f.menu().querySelector('[role="status"]').textContent, /順序を変更/);
  }
});
test("TL一覧の末尾へドロップでき、自分自身や同じ順序になる位置は保存せず、二重実行しない", async () => {
  const f = await fixture(); let drag = f.drag(1); f.rows()[1].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 1 });
  drag = f.drag(1); f.rows()[0].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 39 }); await flush(); assert.equal(f.calls.length, 0);
  drag = f.drag(); const list = f.menu().querySelector('[data-menu-favorite-list]');
  list.fire("dragover", { dataTransfer: drag.dataTransfer }); assert.equal(list.hasAttribute("data-favorite-list-end"), true);
  list.fire("drop", { dataTransfer: drag.dataTransfer }); list.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
  assert.deepEqual(f.state.tagGroups[0].tags, [...items.slice(1), items[0]]); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].operation.beforeTag, null);
  assert.equal(f.menu().querySelector('[data-favorite-list-end]'), null);
});
test("TL並べ替えも保存失敗・結果不明・挿入先の削除競合で項目を失わない", async () => {
  for (const option of ["saveError", "unconfirmed"]) {
    const f = await fixture({}, { [option]: true }), drag = f.drag(1); f.rows()[0].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 1 }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items); assert.equal(f.writes, 0); assert.equal(f.group("group1").textContent, "①");
    assert.equal(f.menu().querySelector('[data-favorite-insert]'), null);
  }
  const f = await fixture(), drag = f.drag(4); f.state.tagGroups[0].tags.shift();
  f.rows()[0].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 1 }); await flush();
  assert.deepEqual(f.state.tagGroups[0].tags, items.slice(1)); assert.equal(f.writes, 0); assert.match(f.menu().querySelector('[role="status"]').textContent, /移動先のタグが削除/);
});
test("背景処理の並べ替えは現在グループ内の挿入先を検証し、余分な操作項目を受け付けない", async () => {
  const f = await fixture(), operation = { type: "MOVE_TAG", groupId: "group1", tag: items[0], beforeTag: items[3] };
  const patch = { operation, selectionRevision: 0, pageUrl: "https://note.com/following" };
  for (const change of [{ beforeTag: "Missing" }, { beforeTag: undefined }, { targetGroupId: "group2" }]) {
    assert.equal((await f.send("menu-favorite-drop", { ...patch, operation: { ...operation, ...change } })).ok, false);
  }
  assert.equal(f.writes, 0); assert.equal((await f.send("menu-favorite-drop", patch)).ok, true);
  assert.deepEqual(f.state.tagGroups[0].tags, [items[1], items[2], items[0], ...items.slice(3)]);
});
test("重複先では移動せず、ドラッグ終了・外部データのドロップは保存せず元の表示へ戻る", async () => {
  const groups = settingsData(plain(items)).tagGroups; groups[1].tags = [{ ...items[1], userId: "SAMPLE_AUTHOR" }];
  const f = await fixture({ tagGroups: groups }), drag = f.drag(1), target = f.group("group2");
  assert.equal(target.getAttribute("data-favorite-drop"), "blocked"); target.fire("dragover", { dataTransfer: drag.dataTransfer }); assert.equal(drag.dataTransfer.dropEffect, "none");
  target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush(); assert.equal(f.calls.length, 0); assert.deepEqual(f.state.tagGroups[0].tags, items);
  const next = f.drag(); f.group("group2").fire("dragover", { dataTransfer: next.dataTransfer }); next.row.fire("dragend");
  assert.equal(f.group("group1").textContent, "①"); assert.equal(f.group("group2").hasAttribute("data-drag-over"), false);
  for (const dataTransfer of [{ types: ["text/plain"] }, { types: ["text/uri-list"] }, { files: [{}] }]) {
    f.group("group1").fire("drop", { dataTransfer }); f.group("group2").fire("drop", { dataTransfer });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.writes, 0);
});
test("2段の⑧と狭幅メニューでも移動でき、メニュー閉鎖時はドラッグを取り消す", async () => {
  const groups = Array.from({ length: 8 }, (_, i) => ({ id: `group${i + 1}`, name: "", tags: i === 0 ? plain(items) : [] }));
  for (const mobile of [false, true]) {
    const f = await fixture({ mode: "normal-double", tagSchemaVersion: 7, tagGroups: plain(groups) }, { mobile });
    if (mobile) f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]').onclick();
    const drag = f.drag(); f.group("group8").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[7].tags, ["SampleTag"]); assert.equal(f.state.selectedTagGroupId, "group1");
    if (mobile) {
      const old = f.drag(), button = f.group("group2"); f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]').onclick();
      assert.equal(f.group("group1").textContent, "①"); button.fire("drop", { dataTransfer: old.dataTransfer }); await flush(); assert.equal(f.calls.length, 1);
    }
  }
});
test("ドラッグ中は番号クリックで選択を変えず、通常クリックによるグループ切替は維持", async () => {
  const f = await fixture(), link = f.rows()[0].querySelector("a"), href = link.href; assert.equal(link.onclick, undefined);
  const drag = f.drag(); f.group("group2").onclick(); await flush(); assert.equal(f.state.selectedTagGroupId, "group1");
  drag.row.fire("dragend"); f.group("group2").onclick(); await flush(); assert.equal(f.state.selectedTagGroupId, "group2"); assert.equal(link.href, href);
});
test("保存失敗・結果不明で項目を残し、結果不明は再確認までドラッグを抑止する", async () => {
  for (const option of ["saveError", "unconfirmed"]) for (const id of ["group1", "group2"]) {
    const f = await fixture({}, { [option]: true }), drag = f.drag(); f.group(id).fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items); assert.deepEqual(f.state.tagGroups[1].tags, []); assert.equal(f.group("group1").textContent, "①");
    if (option === "unconfirmed") {
      assert.equal(f.rows()[0].draggable, false); assert.equal(f.drag().event.defaultPrevented, true); assert.equal(f.calls.length, 1);
      const refresh = f.menu().querySelectorAll("button").find(b => b.textContent === "状態を再確認"); refresh.onclick(); await flush(); assert.equal(f.rows()[0].draggable, true);
    } else assert.match(f.menu().querySelector('[role="status"]').textContent, /save failed/);
  }
});
test("保存中は再ドラッグ・番号選択を抑止し、通常の保存は一度だけ行う", async () => {
  let release; const f = await fixture({}, { saveGate: new Promise(resolve => { release = resolve; }) }), drag = f.drag();
  f.group("group2").fire("drop", { dataTransfer: drag.dataTransfer }); assert.equal(f.rows()[0].draggable, false); assert.equal(f.drag().event.defaultPrevented, true);
  f.group("group3").onclick(); release(); await flush(); assert.equal(f.calls.length, 1); assert.equal(f.state.selectedTagGroupId, "group1"); assert.equal(f.writes, 1);
});
test("外部更新・選択変更・OFF・ページ変更・停止で古いドロップを取り消す", async () => {
  for (const change of [f => f.changed({ tagGroupsRevision: 1 }), f => f.changed({ selectedTagGroupId: "group2", groupSelectionRevision: 1 }),
    f => f.changed({ enabled: false }), f => { f.url = "https://note.com/search?q=Tag"; f.update(); }, f => f.ui.stop()]) {
    const f = await fixture(), drag = f.drag(), target = f.group("group2"); change(f); target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.equal(f.calls.length, 0); assert.equal(f.writes, 0); assert.deepEqual(f.state.tagGroups[0].tags, items);
  }
});
const menuUrls = ["https://note.com/following?view=all#top", "https://note.com/tag/Tag", "https://note.com/hashtag/%E5%89%B5%E4%BD%9C",
  "https://note.com/search?q=%23Tag&context=note", "https://note.com/search?q=from:@sample_author&context=note", "https://note.com/search?q=from:@sample_author&context=magazine",
  "https://note.com/search?q=from:@sample_author&context=user", "https://note.com/search?q=from:@sample_author&context=circle", "https://note.com/search?q=&context=note&mode=search&sort=new",
  "https://note.com/topic/computer_it", "https://note.com/topic/computer_it/ai", "https://note.com/help", "https://note.com/help/pg/event"];
test("お気に入りがある全左メニューへ並べ替え・移動・削除を適用し、広幅／狭幅と4／8グループを維持", async () => {
  for (const url of menuUrls) for (const mobile of [false, true]) for (const mode of ["normal", "normal-double"]) {
    const patch = mode === "normal" ? {} : { mode, tagSchemaVersion: 7, tagGroups: Array.from({ length: 8 }, (_, i) => ({ id: `group${i + 1}`, name: "", tags: i === 0 ? plain(items) : [] })) };
    const f = await fixture(patch, { url, mobile });
    if (mobile) f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]').onclick();
    assert.equal(f.rows().length, items.length, url); assert.equal(f.menu().querySelectorAll('button[data-group-id]').length, mode === "normal" ? 4 : 8);
    let drag = f.drag(2); f.rows()[0].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 1 }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, [items[2], items[0], items[1], ...items.slice(3)], url);
    const destination = mode === "normal" ? "group2" : "group8";
    drag = f.drag(); assert.equal(f.group("group1").textContent, "🗑"); f.group(destination).fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    drag = f.drag(); f.group("group1").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, [items[1], ...items.slice(3)], url); assert.deepEqual(f.state.tagGroups[mode === "normal" ? 1 : 7].tags, [items[2]], url);
    assert.equal(f.state.selectedTagGroupId, "group1"); assert.deepEqual(f.calls.map(call => call.operation.type), ["MOVE_TAG", "TRANSFER_TAG", "REMOVE_TAG"]);
  }
});
test("グループのない専用ナビや対象外モードへグループ欄を追加しない", async () => {
  for (const url of ["https://note.com/sample_author/n/n123", "https://note.com/sample_author", "https://note.com/qa/sample_author", "https://note.com/sample_author/membership",
    "https://note.com/sample_author/m/m123", "https://note.com/notes/viewed", "https://note.com/help/unknown", "https://evil.test/tag/Tag"]) {
    const f = await fixture({}, { url }); assert.equal(f.rows().length, 0, url); assert.equal(f.core.hasFavoriteMenu(url), false, url);
  }
  for (const patch of [{ mode: "severe" }, { mode: "social" }, { enabled: false }]) { const f = await fixture(patch); assert.equal(f.rows().length, 0); }
});
test("背景処理は共通メニューのメインフレーム・限定操作だけ許可し、選択リビジョンと現在URLを再検証", async () => {
  const f = await fixture(), operation = { type: "REMOVE_TAG", groupId: "group1", tag: "SampleTag" }, patch = { operation, selectionRevision: 0, pageUrl: "https://note.com/following" };
  const send = (value = patch, sender) => f.send("menu-favorite-drop", value, sender);
  assert.equal(await send(patch, { home: true }), null); assert.equal(await send(patch, { note: true, frameId: 1 }), null); assert.equal(await send(patch, {}), null);
  for (const change of [{ selectionRevision: undefined }, { selectionRevision: -1 }, { selectionRevision: 1 }, { pageUrl: "https://note.com/tag/Tag" }, { extra: true },
    { operation: { ...operation, type: "SELECT_TAG_GROUP" } }, { operation: { ...operation, type: "MOVE_TAG" } }, { operation: { ...operation, enabled: false } },
    { operation: { ...operation, groupId: "group2" } }, { operation: { type: "TRANSFER_TAG", groupId: "group1", targetGroupId: "group8", tag: "SampleTag" } }]) {
    assert.equal((await send({ ...patch, ...change })).ok, false);
  }
  assert.equal(await f.send("tag-operation", operation), null); assert.equal(f.writes, 0);
  assert.equal((await send()).ok, true); assert.equal(f.writes, 1);
  const g = await fixture({}, { changeDuringSave: true }); assert.equal((await g.send("menu-favorite-drop", patch)).ok, false); assert.equal(g.writes, 0);
  const h = await fixture({}, { url: "https://note.com/sample_author" }); assert.equal((await h.send("menu-favorite-drop", { ...patch, pageUrl: "https://note.com/sample_author" })).ok, false);
});
test("ブラウザAPIは操作と選択リビジョン・現在URLだけを送信する", async () => {
  const calls = [], c = vm.createContext({ location: { href: "https://note.com/following" }, HikikomoriNote: { settingsKey: "settings" },
    browser: { runtime: { id: "self", async sendMessage(message) { calls.push(plain(message)); return { ok: true, settings: {} }; } } } });
  vm.runInContext(source("platform/browser-api"), c);
  const operation = { type: "REMOVE_TAG", groupId: "group1", tag: "Tag" }; await c.HikikomoriNotePlatform.menuFavoriteDrop(operation, 3);
  assert.deepEqual(calls, [{ type: "menu-favorite-drop", patch: { operation, selectionRevision: 3, pageUrl: "https://note.com/following" } }]);
  c.location.href = "https://note.com/help";
  await c.HikikomoriNotePlatform.menuFavoriteDrop(operation, 3, "https://note.com/tag/Tag");
  assert.equal(calls[1].patch.pageUrl, "https://note.com/tag/Tag");
});
test("作者検索から別作者検索・タグから活用術への遷移では、古いドラッグを保存しない", async () => {
  for (const [from, to] of [["https://note.com/search?q=from:@sample_author", "https://note.com/search?q=from:@other_author"], ["https://note.com/tag/Tag", "https://note.com/help"]]) {
    for (const update of [false, true]) {
      const f = await fixture({}, { url: from }), drag = f.drag(), target = f.group("group1");
      f.url = to; if (update) f.update();
      target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
      assert.equal(f.writes, 0); assert.deepEqual(f.state.tagGroups[0].tags, items);
      assert.equal(f.calls.length, update ? 0 : 1); if (!update) assert.equal(f.calls[0].pageUrl, from);
    }
  }
});
test("実際のタブ照合も共通メニュー全種を扱い、未対応URL・別タブURL・遷移中を拒否", async () => {
  const f = await fixture(); let tab = { url: "https://note.com/following" };
  const browser = { runtime: { id: "self" }, tabs: { get: async () => tab } }, c = vm.createContext({ URL, browser, HikikomoriNote: f.core });
  vm.runInContext(source("platform/browser-api"), c);
  const sender = { id: "self", frameId: 0, tab: { id: 1 }, url: "https://note.com/following" }, check = c.HikikomoriNoteBackgroundPlatform.currentMenuPage;
  for (const url of menuUrls) { tab = { url }; assert.equal((await check(sender, url)).type, f.core.pageKind(url).type, url); }
  tab = { url: "https://note.com/tag/Tag", pendingUrl: "https://note.com/help" }; assert.equal(await check(sender, tab.url), null);
  tab = { url: "https://note.com/help" }; assert.equal(await check(sender, "https://note.com/tag/Tag"), null);
  for (const url of ["https://note.com/sample_author", "https://note.com/sample_author/n/n123", "https://note.com/help/unknown", "https://evil.test/tag/Tag"]) { tab = { url }; assert.equal(await check(sender, url), null); }
});


test("共通メニューは4/8グループを一覧スクロールの外に置き、PCとハンバーガーで切り替え可能",async()=>{
 for(const mobile of [false,true])for(const mode of ['normal','normal-double']){
  const f=await fixture({mode},{mobile}),menu=f.menu(),host=menu.parentElement,list=menu.querySelector('[data-hikikomori-note-favorite-scroll-list]'),selector=menu.querySelector('[class="hikikomori-note-group-selector"]');
  assert.equal(host.hasAttribute('data-hikikomori-note-favorite-scroll-host'),true);assert.equal(host.scrollTop,0);assert.equal(menu.hasAttribute('data-hikikomori-note-favorite-scroll'),true);
  assert.equal(list.parentElement,menu);assert.equal(selector.parentElement,menu);assert.equal(list.contains(selector),false);assert.equal(selector.children.length,mode==='normal-double'?8:4);
  assert.equal(list.hasAttribute('data-menu-favorite-list'),true);list.scrollTop=240;f.update();assert.equal(list.scrollTop,240);
  f.group('group2').onclick();await flush();assert.equal(f.state.selectedTagGroupId,'group2');assert.equal(f.group('group2').getAttribute('aria-pressed'),'true');
  assert.equal(f.menu().parentElement,host);assert.equal(host.scrollTop,0);assert.equal(f.menu().querySelector('[data-hikikomori-note-favorite-scroll-list]').parentElement,f.menu());
 }
});
test("スクロール用の外枠属性はモード変更・OFF・停止・メニュー移動で復元する",async()=>{
 for(const change of [f=>f.changed({enabled:false}),f=>f.changed({mode:'severe'}),f=>f.changed({mode:'social'}),f=>f.ui.stop()]){
  const f=await fixture(),host=f.menu().parentElement;change(f);assert.equal(host.hasAttribute('data-hikikomori-note-favorite-scroll-host'),false);
 }
 const f=await fixture(),host=f.menu().parentElement;f.win.wide=false;f.doc.getElementById('sidebar').width=0;f.update();
 assert.equal(host.hasAttribute('data-hikikomori-note-favorite-scroll-host'),false);assert.equal(f.menu().parentElement.hasAttribute('data-hikikomori-note-favorite-scroll-host'),true);
 const css=fs.readFileSync(path.join(__dirname,'../src/content.css'),'utf8');
 assert.match(css,/\[data-hikikomori-note-favorite-scroll-host\] \{ overflow-y: hidden !important/);
 assert.match(css,/ul\[data-hikikomori-note-favorite-scroll-list\][\s\S]*?overflow-y: auto/);
 assert.match(css,/mobile-panel > \.hikikomori-note-navigation\[data-hikikomori-note-favorite-scroll\][^}]*max-height: none/);
});

const favoriteList = f => f.menu().querySelector("[data-hikikomori-note-favorite-scroll-list]");
function longFavoriteGroups() {
  const { tagGroups } = settingsData();
  tagGroups[0].tags = Array.from({ length: 16 }, (_, i) => `Tag${i}`);
  tagGroups[1].tags = Array.from({ length: 16 }, (_, i) => `Other${i}`);
  return tagGroups;
}
test("タグを開いたとき一覧の位置を復元し、同じタブの新しい文書へも引き継ぐ", async () => {
  const data = new Map(), sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const f = await fixture({ tagGroups: longFavoriteGroups() }, { scrollLayout: true, sessionStorage });
  const list = favoriteList(f);
  list.scrollTop = 270;
  list.fire("scroll");
  const target = list.children[8].querySelector("a");
  f.url = target.href;
  f.update();
  assert.notEqual(favoriteList(f), list);
  assert.equal(favoriteList(f).scrollTop, 270);
  assert.equal(favoriteList(f).querySelector('[aria-current="page"]').textContent, "# Tag8");
  assert.equal(data.size, 0);
  f.windowEvents.get("pagehide")();
  assert.deepEqual(JSON.parse([...data.values()][0]), { group1: 270 });
  const next = await fixture({ tagGroups: longFavoriteGroups() }, { url: target.href, scrollLayout: true, sessionStorage });
  assert.equal(favoriteList(next).scrollTop, 270);
  next.ui.stop();
  assert.equal(next.windowEvents.has("pagehide"), false);
});

test("検索したまま別グループから戻ると、元の位置を使いハイライトが見切れる場合だけ調整する", async () => {
  const f = await fixture({ tagGroups: longFavoriteGroups() }, { scrollLayout: true });
  f.url = f.core.tagUrl("Tag8");
  f.update();
  favoriteList(f).scrollTop = 270;
  f.group("group2").onclick(); await flush();
  assert.equal(favoriteList(f).scrollTop, 0);
  assert.equal(favoriteList(f).querySelector('[aria-current="page"]'), null);
  favoriteList(f).scrollTop = 135;
  f.group("group1").onclick(); await flush();
  assert.equal(favoriteList(f).scrollTop, 270);
  assert.equal(favoriteList(f).querySelector('[aria-current="page"]').textContent, "# Tag8");
  favoriteList(f).scrollTop = 12;
  f.group("group2").onclick(); await flush();
  assert.equal(favoriteList(f).scrollTop, 135);
  f.group("group1").onclick(); await flush();
  assert.equal(favoriteList(f).scrollTop, 240);
});

test("ハンバーガーは閉じている間に一覧の位置を上書きせず、タグ遷移後に開くと復元する", async () => {
  const f = await fixture({ tagGroups: longFavoriteGroups() }, { mobile: true, scrollLayout: true });
  const toggle = f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]');
  toggle.onclick();
  favoriteList(f).scrollTop = 305;
  favoriteList(f).fire("scroll");
  f.url = favoriteList(f).children[8].querySelector("a").href;
  f.update();
  assert.equal(f.menu().parentElement.hidden, true);
  assert.equal(favoriteList(f).scrollTop, 0);
  toggle.onclick();
  assert.equal(favoriteList(f).scrollTop, 305);
  assert.equal(favoriteList(f).querySelector('[aria-current="page"]').textContent, "# Tag8");
});
