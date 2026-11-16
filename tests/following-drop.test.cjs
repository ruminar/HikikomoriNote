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
    async followingFavoriteDrop(operation, selectionRevision) {
      calls.push({ operation: plain(operation), selectionRevision, pageUrl: url });
      if (options.unconfirmed) throw Object.assign(Error("result unconfirmed"), { code: "UNCONFIRMED" });
      return apply("following-favorite-drop", { operation, selectionRevision, pageUrl: url });
    },
    selectGroup: groupId => apply("select-tag-group", { groupId, pageUrl: url }),
    async refresh() { state = core.readSettings(stored); ui.update(state, url); }
  });
  ui.update(state, url);
  const menu = () => doc.querySelector('[class="hikikomori-note-navigation"]');
  const group = id => menu()?.querySelector(`[data-group-id="${id}"]`);
  const rows = () => menu()?.querySelectorAll('[data-following-favorite-item]') || [];
  const drag = (index = 0) => { const row = rows()[index], dataTransfer = { setData() {} }; const event = row.fire("dragstart", { dataTransfer }); return { row, dataTransfer, event }; };
  return { c, core, doc, win, ui, options, calls, send, menu, group, rows, drag,
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
  drag = f.drag(); const list = f.menu().querySelector('[data-following-favorite-list]');
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
    assert.equal((await f.send("following-favorite-drop", { ...patch, operation: { ...operation, ...change } })).ok, false);
  }
  assert.equal(f.writes, 0); assert.equal((await f.send("following-favorite-drop", patch)).ok, true);
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
test("タグ・検索・helpなど他の左メニューにはドラッグ処理を追加しない", async () => {
  for (const url of ["https://note.com/tag/Tag", "https://note.com/search?q=from:@sample_author", "https://note.com/help", "https://note.com/topic/computer_it"]) {
    const f = await fixture({}, { url }); assert.equal(f.rows().length, 0);
    assert.ok(f.menu().querySelectorAll('button[data-group-id]').every(b => b.ondrop === undefined));
  }
  for (const patch of [{ mode: "severe" }, { mode: "social" }, { enabled: false }]) { const f = await fixture(patch); assert.equal(f.rows().length, 0); }
});
test("背景処理はTL・メインフレーム・削除／移動だけ許可し、選択リビジョンと現在URLを再検証", async () => {
  const f = await fixture(), operation = { type: "REMOVE_TAG", groupId: "group1", tag: "SampleTag" }, patch = { operation, selectionRevision: 0, pageUrl: "https://note.com/following" };
  const send = (value = patch, sender) => f.send("following-favorite-drop", value, sender);
  assert.equal(await send(patch, { home: true }), null); assert.equal(await send(patch, { note: true, frameId: 1 }), null); assert.equal(await send(patch, {}), null);
  for (const change of [{ selectionRevision: undefined }, { selectionRevision: -1 }, { selectionRevision: 1 }, { pageUrl: "https://note.com/tag/Tag" }, { extra: true },
    { operation: { ...operation, type: "SELECT_TAG_GROUP" } }, { operation: { ...operation, type: "MOVE_TAG" } }, { operation: { ...operation, enabled: false } },
    { operation: { ...operation, groupId: "group2" } }, { operation: { type: "TRANSFER_TAG", groupId: "group1", targetGroupId: "group8", tag: "SampleTag" } }]) {
    assert.equal((await send({ ...patch, ...change })).ok, false);
  }
  assert.equal(await f.send("tag-operation", operation), null); assert.equal(f.writes, 0);
  assert.equal((await send()).ok, true); assert.equal(f.writes, 1);
  const g = await fixture({}, { changeDuringSave: true }); assert.equal((await g.send("following-favorite-drop", patch)).ok, false); assert.equal(g.writes, 0);
  const h = await fixture({}, { url: "https://note.com/tag/Tag" }); assert.equal((await h.send("following-favorite-drop", { ...patch, pageUrl: "https://note.com/tag/Tag" })).ok, false);
});
test("ブラウザAPIは操作と選択リビジョン・現在URLだけを送信する", async () => {
  const calls = [], c = vm.createContext({ location: { href: "https://note.com/following" }, HikikomoriNote: { settingsKey: "settings" },
    browser: { runtime: { id: "self", async sendMessage(message) { calls.push(plain(message)); return { ok: true, settings: {} }; } } } });
  vm.runInContext(source("platform/browser-api"), c);
  const operation = { type: "REMOVE_TAG", groupId: "group1", tag: "Tag" }; await c.HikikomoriNotePlatform.followingFavoriteDrop(operation, 3);
  assert.deepEqual(calls, [{ type: "following-favorite-drop", patch: { operation, selectionRevision: 3, pageUrl: "https://note.com/following" } }]);
});
