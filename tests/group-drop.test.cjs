"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const homeFixture = require("./helpers/home.cjs"), settings = require("./helpers/settings.cjs");
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const items = ["SampleTag", { type: "user", userId: "sample_author", displayName: "Sample" },
  { type: "magazine", userId: "sample_author", magazineId: "m123", displayName: "Magazine" },
  { type: "membership", userId: "sample_author", displayName: "Membership" },
  { type: "article", articleId: "n123", url: "https://note.com/sample_author/n/n123", title: "Article" }];
async function fixture(patch = {}, options = {}) {
  const state = { ...settings(plain(items)), tagSchemaVersion: 6, ...patch };
  const f = homeFixture({ hash: "#tags", ...options, state }); await flush();
  const n = id => f.nodes.get(id);
  const group = id => n("edit-groups").querySelector(`[data-group-id="${id}"]`);
  const drag = (index = 0) => {
    const row = n("edit-tags").children[index], dataTransfer = { data: {}, setData(type, value) { this.data[type] = value; } };
    const event = row.fire("dragstart", { dataTransfer }); return { row, dataTransfer, event };
  };
  return Object.assign(f, { n, group, drag });
}
test("設定画面の全5種を別番号へドロップして末尾へ移動し、選択グループ・共通宛先を維持", async () => {
  for (let index = 0; index < items.length; index++) {
    const state = settings(items); state.tagGroups[1].tags = ["Existing"];
    const f = await fixture({ tagGroups: state.tagGroups });
    f.n("favorite-destination").value = "group3"; f.n("favorite-destination").fire("change");
    const drag = f.drag(index), source = f.group("group1"), target = f.group("group2");
    assert.equal(source.textContent, "🗑"); assert.equal(source.getAttribute("data-favorite-drop"), "delete");
    assert.equal(target.getAttribute("data-favorite-drop"), "move"); assert.equal(drag.dataTransfer.effectAllowed, "move");
    const over = target.fire("dragover", { dataTransfer: drag.dataTransfer }); assert.equal(over.defaultPrevented, true); assert.equal(drag.dataTransfer.dropEffect, "move");
    assert.equal(target.hasAttribute("data-drag-over"), true); assert.equal(f.state.selectedTagGroupId, "group1");
    target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items.filter((_, i) => i !== index));
    assert.deepEqual(f.state.tagGroups[1].tags, ["Existing", items[index]]); assert.equal(f.state.selectedTagGroupId, "group1");
    assert.equal(f.n("favorite-destination").value, "group3"); assert.equal(f.group("group1").textContent, "①");
    assert.equal(f.n("edit-groups").querySelectorAll("button").some(b => b.hasAttribute("data-favorite-drop") || b.hasAttribute("data-drag-over")), false);
    assert.match(f.n("favorite-operation-status").textContent, /② グループ2へ移動しました/);
  }
});
test("設定画面の全5種を現在の番号へドロップするとお気に入りだけ削除する", async () => {
  for (let index = 0; index < items.length; index++) {
    const f = await fixture(), drag = f.drag(index); assert.match(f.group("group1").getAttribute("title"), /お気に入りから削除/);
    f.group("group1").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items.filter((_, i) => i !== index)); assert.equal(f.state.selectedTagGroupId, "group1");
    assert.deepEqual(f.state.tagGroups[1].tags, []); assert.match(f.n("favorite-operation-status").textContent, /お気に入りから削除しました/);
  }
});
test("タグ・作者・マガジン・メンバーシップの移動先重複を禁止し、元項目を保持して保存処理を呼ばない", async () => {
  for (let index = 0; index < items.length; index++) {
    const state = settings(items), duplicate = typeof items[index] === "string" ? items[index] : { ...items[index], ...(items[index].type === "user" ? { userId: "SAMPLE_AUTHOR" } : {}) };
    state.tagGroups[1].tags = [duplicate];
    // 記事だけは既存仕様でグループ間重複自体が不正なので、別試験で競合を確認。
    if (items[index]?.type === "article") continue;
    const f = await fixture({ tagGroups: state.tagGroups }), drag = f.drag(index), target = f.group("group2");
    let calls = 0; f.c.HikikomoriNotePlatform.tag = async () => { calls++; throw Error("must not save"); };
    assert.equal(target.getAttribute("data-favorite-drop"), "blocked"); target.fire("dragover", { dataTransfer: drag.dataTransfer }); assert.equal(drag.dataTransfer.dropEffect, "none");
    target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.equal(calls, 0); assert.deepEqual(f.state.tagGroups[0].tags, items); assert.deepEqual(f.state.tagGroups[1].tags, [duplicate]);
    assert.match(f.n("favorite-operation-status").textContent, /元の項目は変更していません/);
  }
});
test("ドラッグ開始後に別画面が登録・移動しても、背景処理が競合を検証してデータを保持", async () => {
  const f = await fixture(), drag = f.drag();
  f.state.tagGroups[1].tags.push("SampleTag"); // ストレージ更新通知がまだ届かない競合。
  f.group("group2").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
  assert.deepEqual(f.state.tagGroups[0].tags, items); assert.deepEqual(f.state.tagGroups[1].tags, ["SampleTag"]);
  assert.match(f.n("favorite-operation-status").textContent, /既に登録/);
  const g = await fixture(), articleDrag = g.drag(4);
  g.state.tagGroups[1].tags.push(g.state.tagGroups[0].tags.pop());
  g.group("group1").fire("drop", { dataTransfer: articleDrag.dataTransfer }); await flush();
  assert.deepEqual(g.state.tagGroups[0].tags, items.slice(0, 4)); assert.deepEqual(g.state.tagGroups[1].tags, [items[4]]);
  assert.match(g.n("favorite-operation-status").textContent, /別の画面で削除/);
});
test("ドラッグ終了・対象外ドロップ相当の終了・画面切替でゴミ箱と強調を解除し、通常クリックを維持", async () => {
  const f = await fixture(), drag = f.drag(); const target = f.group("group2"); target.fire("dragover", { dataTransfer: drag.dataTransfer });
  target.onclick(); await flush(); assert.equal(f.state.selectedTagGroupId, "group1");
  target.fire("dragleave", { relatedTarget: null }); assert.equal(target.hasAttribute("data-drag-over"), false);
  drag.row.fire("dragend"); assert.equal(f.group("group1").textContent, "①"); assert.equal(target.hasAttribute("data-favorite-drop"), false);
  target.onclick(); await flush(); assert.equal(f.state.selectedTagGroupId, "group2");
  f.group("group1").onclick(); await flush(); f.drag(); f.n("nav-settings").fire("click");
  assert.equal(f.group("group1").textContent, "①"); assert.deepEqual(f.state.tagGroups[0].tags, items);
});
test("外部のテキスト・URL・ファイルのドロップだけではお気に入りを変更しない", async () => {
  const f = await fixture(); let calls = 0; f.c.HikikomoriNotePlatform.tag = async () => { calls++; };
  for (const dataTransfer of [{ types: ["text/plain"], getData: () => "SampleTag" }, { types: ["text/uri-list"], getData: () => "https://note.com/sample_author" }, { files: [{}] }]) {
    for (const id of ["group1", "group2"]) { const target = f.group(id); target.fire("dragover", { dataTransfer }); target.fire("drop", { dataTransfer }); }
  }
  assert.equal(calls, 0); assert.deepEqual(f.state.tagGroups[0].tags, items); assert.equal(f.group("group1").textContent, "①");
});
test("2段モードは⑧へ移動でき、通常への切替や外部更新後の古いドロップは取り消す", async () => {
  const groups = Array.from({ length: 8 }, (_, i) => ({ id: `group${i + 1}`, name: "", tags: i === 0 ? [...items] : [] }));
  const f = await fixture({ mode: "normal-double", tagSchemaVersion: 7, tagGroups: groups });
  let drag = f.drag(); f.group("group8").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
  assert.deepEqual(f.state.tagGroups[7].tags, ["SampleTag"]);
  drag = f.drag(); const stale = f.group("group8"); f.changed({ mode: "normal" });
  stale.fire("drop", { dataTransfer: drag.dataTransfer }); await flush(); assert.equal(f.group("group8"), null); assert.equal(f.state.tagGroups[0].tags.length, 4);
  drag = f.drag(); const target = f.group("group2"); f.changed({ tagGroupsRevision: f.state.tagGroupsRevision + 1 });
  target.fire("drop", { dataTransfer: drag.dataTransfer }); await flush(); assert.deepEqual(f.state.tagGroups[1].tags, []); assert.equal(f.group("group1").textContent, "①");
});
test("移動・削除の保存失敗と結果不明でも元項目を残し、保存中の再ドラッグを抑止", async () => {
  for (const targetId of ["group1", "group2"]) for (const option of ["saveError", "unconfirmed"]) {
    const f = await fixture({}, { [option]: true }), drag = f.drag(); f.group(targetId).fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
    assert.deepEqual(f.state.tagGroups[0].tags, items); assert.deepEqual(f.state.tagGroups[1].tags, []);
    assert.match(f.n("favorite-operation-status").textContent, /処理できませんでした/); assert.equal(f.group("group1").textContent, "①");
  }
  let release; const f = await fixture({}, { saveGate: new Promise(resolve => { release = resolve; }) }), drag = f.drag();
  f.group("group2").fire("drop", { dataTransfer: drag.dataTransfer }); const second = f.drag(1); assert.equal(second.event.defaultPrevented, true);
  f.group("group1").fire("drop", { dataTransfer: second.dataTransfer }); release(); await flush();
  assert.equal(f.state.tagGroups[0].tags.length, 4); assert.deepEqual(f.state.tagGroups[1].tags, ["SampleTag"]);
});
test("既存の項目間・末尾ドロップによる並べ替えでもゴミ箱表示を解除し、JSONは従来形式", async () => {
  const f = await fixture(); let drag = f.drag(); f.n("edit-tags").children[1].fire("drop", { dataTransfer: drag.dataTransfer, clientY: 100 }); await flush();
  assert.deepEqual(f.state.tagGroups[0].tags, [items[1], items[0], ...items.slice(2)]); assert.equal(f.group("group1").textContent, "①");
  drag = f.drag(); f.n("edit-tags").fire("drop", { dataTransfer: drag.dataTransfer }); await flush();
  assert.deepEqual(f.state.tagGroups[0].tags, [items[0], ...items.slice(2), items[1]]); assert.equal(f.group("group1").textContent, "①");
  const core = f.c.HikikomoriNote, imported = core.inspectSettingsImport(core.exportSettings(core.readSettings(f.state)));
  assert.deepEqual(plain(imported.settings.tagGroups), plain(core.readSettings(f.state).tagGroups));
});
