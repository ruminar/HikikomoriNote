"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { documentFromHtml } = require("./helpers/dom.cjs");
const source = name => fs.readFileSync(path.join(__dirname, "..", "src", name + ".js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = { type: "user", userId: "sample_author", displayName: "Sample" };
const articleUrl = "https://note.com/sample_author/n/n123";
function backend(patch = {}) {
  const c = vm.createContext({ URL, console });
  for (const name of ["common", "routing"]) vm.runInContext(source(name), c);
  let state = { ...plain(c.HikikomoriNote.defaultSettings()), ...patch }, writes = 0;
  const controller = c.HikikomoriNoteRouting.createController({ load: async () => state, store: async value => { state = plain(value); writes++; }, setRules: async () => {} });
  return { c, controller, get state() { return state; }, get writes() { return writes; }, options: { validateCurrent: async () => true } };
}
test("Shift仮登録は通常・2段とも④固定で、選択・既存データ・JSON形式を維持", async () => {
  for (const mode of ["normal", "normal-double"]) {
    const f = backend({ mode });
    await f.controller.shiftFavorite("SampleTag", false, f.options);
    await f.controller.shiftFavorite(user, false, f.options);
    assert.deepEqual(f.state.tagGroups[3].tags, ["SampleTag", user]);
    assert.equal(f.state.selectedTagGroupId, "group1");
    const core = f.c.HikikomoriNote, loaded = core.inspectSettingsImport(core.exportSettings(core.readSettings(f.state)));
    assert.deepEqual(plain(loaded.settings.tagGroups[3].tags), ["SampleTag", user]);
  }
});
test("重複は全8グループで確認し、取り消しは④のみ。他へ移した後の解除は何もしない", async () => {
  const f = backend({ mode: "normal-double" });
  await f.controller.shiftFavorite(user, false, f.options);
  await f.controller.tag({ type: "TRANSFER_TAG", groupId: "group4", targetGroupId: "group8", tag: user });
  const writes = f.writes;
  await f.controller.shiftFavorite({ ...user, userId: "SAMPLE_AUTHOR" }, false, f.options);
  await f.controller.shiftFavorite(user, true, f.options);
  assert.equal(f.writes, writes); assert.deepEqual(f.state.tagGroups[7].tags, [user]);
  await f.controller.save({ mode: "normal" });
  await f.controller.shiftFavorite(user, false, f.options);
  assert.deepEqual(f.state.tagGroups[3].tags, []);
});
test("④の解除・登録は冪等。並行操作は既存キューで順序を守る", async () => {
  const f = backend();
  await Promise.all([f.controller.shiftFavorite(user, false, f.options), f.controller.shiftFavorite("Tag", false, f.options), f.controller.shiftFavorite(user, false, f.options)]);
  assert.equal(f.writes, 2);
  await f.controller.shiftFavorite(user, true, f.options); await f.controller.shiftFavorite(user, true, f.options);
  assert.deepEqual(f.state.tagGroups[3].tags, ["Tag"]); assert.equal(f.writes, 3);
});
test("無効・制限モード・破損・未検証・未対応種別では保存しない", async () => {
  for (const patch of [{ enabled: false }, { mode: "severe" }, { mode: "social" }, { tagGroups: "broken" }]) {
    const f = backend(patch); await assert.rejects(f.controller.shiftFavorite(user, false, f.options)); assert.equal(f.writes, 0);
  }
  const f = backend();
  await assert.rejects(f.controller.shiftFavorite(user, false));
  await assert.rejects(f.controller.shiftFavorite(user, false, { validateCurrent: async () => false }));
  await assert.rejects(f.controller.shiftFavorite("Tag", true, f.options));
  await assert.rejects(f.controller.shiftFavorite({ type: "membership", userId: user.userId, displayName: "" }, false, f.options));
  assert.equal(f.writes, 0);
});
const heart = '<button id="heart" type="button" aria-pressed="false"><svg data-id="Icon" role="img" aria-label="スキ"></svg></button>';
const card = `<div class="grid-rows-subgrid"><div><h3></h3><a href="${articleUrl}"></a></div><a data-name="avatar" href="/sample_author"><img alt="Sample"></a>${heart}</div>`;
function ui(html = card) {
  const c = vm.createContext({ URL, console }); for (const name of ["common", "note-ui"]) vm.runInContext(source(name), c);
  const doc = documentFromHtml(html); doc.body = doc.root;
  const jobs = new Map(); let next = 0, now = 0, calls = [], fail = false;
  const navigations = [];
  const win = { location: { assign(url) { navigations.push(url); } }, setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { jobs.delete(id); } };
  const settings = plain(c.HikikomoriNote.defaultSettings()); let url = "https://note.com/following";
  const control = c.HikikomoriNoteUi.createShiftFavorites(doc, win, { async save(patch) { calls.push(plain(patch)); if (fail) throw new Error("Save failed"); } });
  const sync = () => control.sync(settings, url); sync();
  function tick(ms) { const end = now + ms; while (true) { const entry = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; now = entry[1].at; jobs.delete(entry[0]); entry[1].fn(); } now = end; }
  function click(target = doc.getElementById("heart"), patch = {}) { const event = { target, composedPath: () => [target], isTrusted: true, button: 0, shiftKey: true, preventDefault() { throw new Error("Default blocked"); }, stopPropagation() { throw new Error("Propagation blocked"); }, ...patch }; control.click(event); return event; }
  function pressed(value) { const b = doc.getElementById("heart"); b.setAttribute("aria-pressed", String(value)); b.querySelector("svg").setAttribute("aria-label", value ? "スキを取り消す" : "スキ"); sync(); }
  return { doc, control, settings, sync, tick, click, pressed, calls, navigations, set url(value) { url = value; }, set fail(value) { fail = value; } };
}
test("Shiftスキは状態確定後にだけ作者を登録。解除時はremoveで送り、本来の操作を止めない", async () => {
  const f = ui(); f.click(); await flush(); assert.equal(f.calls.length, 0);
  f.pressed(true); f.tick(599); await flush(); assert.equal(f.calls.length, 0);
  f.tick(1); await flush(); assert.deepEqual(f.calls[0], { item: user, remove: false, sourceUrl: articleUrl, pageUrl: "https://note.com/following" });
  f.click(); f.pressed(false); f.tick(600); await flush(); assert.equal(f.calls[1].remove, true);
});
test("実カードと同じ深いスキ部品でも作者へ到達し、名前に経過時間を混ぜず④へ登録・解除する", async () => {
  // 提供DOMの構造のみ再現。URL・表示名等の個人設定は持ち込まない。
  const wrappers = '<div class="pointer-events-none relative"><div class="relative flex"><div class="pointer-events-auto"><div class="flex items-center justify-center"><div class="inline-flex"><div class="relative inline-flex">';
  const html = `<div class="grid-rows-subgrid"><div class="flex w-full bg-surface-normal"><a href="${articleUrl}"></a><div><h3></h3><a data-name="avatar" href="/sample_author" aria-label="Sampleのプロフィールへのリンク"><img alt=""><span class="truncate" id="name"></span><time id="time"></time></a>${wrappers}${heart}${'</div>'.repeat(6)}</div></div></div>`;
  const f = ui(html); f.doc.getElementById("name").textContent = "Sample"; f.doc.getElementById("time").textContent = "5時間前";
  f.click(); f.pressed(true); f.tick(600); await flush(); assert.deepEqual(f.calls[0].item, user); assert.equal(f.calls[0].remove, false);
  f.click(); f.pressed(false); f.tick(600); await flush(); assert.deepEqual(f.calls[1].item, user); assert.equal(f.calls[1].remove, true);
  f.doc.querySelector('a[data-name="avatar"]').removeAttribute("aria-label");
  f.click(); f.pressed(true); f.tick(600); await flush(); assert.equal(f.calls[2].item.displayName, "Sample");
});
test("Shift以外・修飾キー併用・非信頼クリック・モード制限では登録しない", async () => {
  for (const patch of [{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { button: 1 }, { isTrusted: false }]) {
    const f = ui(); f.click(undefined, patch); f.pressed(true); f.tick(6000); await flush(); assert.equal(f.calls.length, 0);
  }
  for (const patch of [{ enabled: false }, { mode: "social" }, { mode: "severe" }]) {
    const f = ui(); Object.assign(f.settings, patch); f.click(); f.pressed(true); f.tick(6000); await flush(); assert.equal(f.calls.length, 0);
  }
});
test("スキ失敗の巻き戻り・ラベル不一致・タイムアウト・再クリック・画面移動・消失では保存しない", async () => {
  for (const change of [f => f.pressed(false), f => f.doc.getElementById("heart").querySelector("svg").setAttribute("aria-label", "スキ"), f => f.click(undefined, { shiftKey: false }), f => { f.url = articleUrl; }, f => f.doc.getElementById("heart").remove(), f => { f.settings.enabled = false; }, f => f.control.stop()]) {
    const f = ui(); f.click(); f.pressed(true); f.tick(300); change(f); f.sync(); f.tick(6000); await flush(); assert.equal(f.calls.length, 0);
  }
  const f = ui(); f.click(); f.tick(5000); f.pressed(true); f.tick(600); await flush(); assert.equal(f.calls.length, 0);
});
const tagEvent = { cancelable: true, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
test("Shiftタグは標準の別ウインドウ動作を止め、保存後に同じタブでタグURLを開く", async () => {
  for (const href of ["https://note.com/hashtag/SampleTag", "https://note.com/tag/SampleTag"]) {
    const f = ui(`<a id="tag" href="${href}"><span id="label"></span></a>`); const event = f.click(f.doc.getElementById("label"), tagEvent);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.deepEqual(f.navigations, []); await flush();
    assert.equal(f.calls[0].item, "SampleTag"); assert.equal(f.calls[0].remove, false);
    assert.deepEqual(f.navigations, [href]);
  }
  for (const href of ["https://evil.test/hashtag/Tag", "https://note.com/search?q=Tag", "https://note.com/sample_author"]) {
    const f = ui(`<a id="tag" href="${href}"></a>`); f.click(f.doc.getElementById("tag")); await flush(); assert.equal(f.calls.length, 0);
  }
});
test("タグの保存失敗では遷移しない。通常クリック・修飾キー併用・取消不能は従来動作を維持", async () => {
  const html = '<a id="tag" href="https://note.com/hashtag/Tag"></a>';
  const f = ui(html); f.fail = true; f.click(f.doc.getElementById("tag"), tagEvent); await flush();
  assert.deepEqual(f.navigations, []); assert.match(f.doc.querySelector('[role="status"]').textContent, /保存できません/);
  for (const patch of [{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { cancelable: false }]) {
    const g = ui(html); g.click(g.doc.getElementById("tag"), patch); await flush();
    assert.equal(g.calls.length, 0); assert.deepEqual(g.navigations, []);
  }
});
test("記事本体のスキは記事ヘッダの作者を登録し、コメントのハートは拾わない", async () => {
  const html = `<article id="note-article"><div><a data-name="avatar" href="/sample_author"><img alt="Sample"></a><time></time></div><div id="note-body"></div><div class="flex items-center justify-center"><div>${heart}</div><button aria-label="12スキ この記事にスキをつけたユーザーを見る"></button></div></article>`;
  const f = ui(html); f.url = articleUrl; f.sync(); f.click(); f.pressed(true); f.tick(600); await flush(); assert.deepEqual(f.calls[0].item, user);
  const g = ui(html.replace('12スキ この記事にスキをつけたユーザーを見る', 'コメントのスキ')); g.url = articleUrl; g.sync(); g.click(); g.pressed(true); g.tick(600); await flush(); assert.equal(g.calls.length, 0);
});
test("作者不明・複数記事・表示専用ハート・本文内は操作しない。保存失敗を案内する", async () => {
  for (const html of [heart, card.replace('data-name="avatar"', 'data-name="other"'), card.replace("<h3>", '<a href="https://note.com/other/n/n456"></a><h3>'), `<article id="note-body">${card}</article>`, card.replace('aria-pressed="false"', '')]) {
    const f = ui(html); f.click(); f.pressed(true); f.tick(600); await flush(); assert.equal(f.calls.length, 0);
  }
  const f = ui(); f.fail = true; f.click(); f.pressed(true); f.tick(600); await flush();
  assert.match(f.doc.querySelector('[role="status"]').textContent, /保存できません.*Save failed/);
  f.tick(4500); assert.equal(f.doc.querySelector('[role="status"]'), null);
});
test("背景処理はnoteのメインフレームに限定し、タグ先・記事作者・現在URLを検証する", async () => {
  const f = backend(); let handler, current = true;
  const port = { onInstalled() {}, onStartup() {}, onAction() {}, onMessage(fn) { handler = fn; }, isHomeSender: s => s.home === true,
    isNoteSender: s => s.note === true, isCurrentNotePage: async () => current };
  const c = vm.createContext({ URL, console, HikikomoriNote: f.c.HikikomoriNote, HikikomoriNoteBackgroundPlatform: port, HikikomoriNoteRouting: { createController: () => f.controller } });
  vm.runInContext(source("background"), c); await flush();
  const send = (patch, sender = { note: true }) => new Promise(resolve => { if (!handler({ type: "shift-favorite", patch }, sender, resolve)) resolve(null); });
  const patch = { item: user, remove: false, sourceUrl: articleUrl, pageUrl: "https://note.com/following" };
  assert.equal(await send(patch, {}), null); assert.equal(await send(patch, { home: true }), null);
  assert.equal((await send({ ...patch, sourceUrl: "https://note.com/other/n/n123" })).ok, false);
  assert.equal((await send({ ...patch, pageUrl: "https://evil.test" })).ok, false);
  assert.equal((await send({ ...patch, arbitrary: true })).ok, false);
  current = false; assert.equal((await send(patch)).ok, false); current = true;
  assert.equal((await send(patch)).ok, true);
  assert.equal((await send({ item: "Tag", remove: false, sourceUrl: "https://note.com/hashtag/Other", pageUrl: patch.pageUrl })).ok, false);
  assert.equal((await send({ item: "Tag", remove: false, sourceUrl: "https://note.com/hashtag/Tag", pageUrl: patch.pageUrl })).ok, true);
  assert.deepEqual(f.state.tagGroups[3].tags, [user, "Tag"]);
});
test("現在タブ検証は別origin・遷移中・子フレーム・別拡張を受け付けない", async () => {
  let tab = { url: "https://note.com/following" };
  const browser = { runtime: { id: "self" }, tabs: { get: async () => tab } };
  const c = vm.createContext({ URL, browser, HikikomoriNote: { settingsKey: "settings" } });
  vm.runInContext(source("platform/browser-api"), c);
  const check = c.HikikomoriNoteBackgroundPlatform.isCurrentNotePage, sender = { id: "self", frameId: 0, tab: { id: 1 }, url: tab.url };
  assert.equal(await check(sender, tab.url), true);
  assert.equal(await check({ ...sender, frameId: 1 }, tab.url), false);
  assert.equal(await check({ ...sender, id: "other" }, tab.url), false);
  tab.pendingUrl = articleUrl; assert.equal(await check(sender, tab.url), false);
  tab = { url: "https://evil.test" }; assert.equal(await check(sender, tab.url), false);
});
