"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function context(extra = {}) {
  const c = vm.createContext({ URL, console: { warn() {} }, ...extra });
  for (const file of ["src/common.js", "src/routing.js"]) vm.runInContext(source(file), c);
  return c;
}
function controllerFixture(stored, options = {}) {
  const c = context();
  let value = stored, activeRules = [], updates = 0;
  const history = [];
  const controller = c.HikikomoriNoteRouting.createController({
    async load() { return value; },
    async store(next) {
      history.push("store");
      if (options.storeError) throw new Error("store failed");
      value = plain(next);
    },
    async setRules(next) {
      updates++;
      history.push(next.length ? "rules:on" : "rules:off");
      if (options.rulesError || updates === options.failUpdate) throw new Error("rules failed");
      activeRules = plain(next);
    }
  });
  return { c, controller, history, get value() { return value; }, get rules() { return activeRules; } };
}
test("ホーム限定：query/hashは対象、記事・投稿・認証・別originは対象外", () => {
  const core = context().HikikomoriNote;
  for (const url of ["https://note.com/", "https://note.com/?x=1#top"]) assert.equal(core.isHome(url), true);
  for (const url of ["https://note.com/ruminar", "https://note.com/user/n/abc", "https://note.com/notes/new", "https://note.com/login", "https://note.com/settings", "https://note.com/purchase", "https://example.com/", "http://note.com/"]) assert.equal(core.isHome(url), false);
});
test("ユーザー名・プロフィールURLを正規化し、不正URL・HTMLを拒否", () => {
  const core = context().HikikomoriNote;
  assert.equal(core.normalizeUserId(" ruminar "), "ruminar");
  assert.equal(core.normalizeUserId("https://note.com/ruminar/?x=1"), "ruminar");
  assert.equal(core.profileUrl("ruminar"), "https://note.com/ruminar");
  assert.equal(core.profileUrl(""), null);
  for (const value of ["https://evil.test/user", "https://note.com/user/n/abc", "<img>", "../x", "https://note.com@evil.test/user"]) assert.throws(() => core.normalizeUserId(value));
  assert.equal(core.readSettings({ noteUserId: "<script>" }).noteUserId, "");
});
test("DNR：ホームの文書だけ専用ページへ転送、事前取得もホームURLだけ遮断", () => {
  const rules = plain(context().HikikomoriNoteRouting.rules(true));
  assert.equal(rules[0].action.redirect.extensionPath, "/home.html");
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
  assert.equal(rules[1].action.type, "block");
  assert.deepEqual(rules[1].condition.excludedResourceTypes, ["main_frame"]);
  const regex = new RegExp(rules[0].condition.regexFilter);
  for (const url of ["https://note.com/", "https://note.com/?x=1", "https://note.com/#top"]) assert.ok(regex.test(url));
  for (const url of ["https://note.com/ruminar", "https://note.com/login", "https://note.com/api/v2/contents", "https://note.com/notes/new", "https://note.com/purchase", "https://note.com.evil.test/", "http://note.com/"]) assert.equal(regex.test(url), false);
  assert.deepEqual(plain(context().HikikomoriNoteRouting.rules(false)), []);
});
test("既存のユーザー名・OFFを引き継ぎ、再起動後もOFFルールを適用", async () => {
  const f = controllerFixture({ enabled: false, noteUserId: "ruminar" });
  assert.deepEqual(plain(await f.controller.getState()), { enabled: false, noteUserId: "ruminar" });
  assert.deepEqual(f.rules, []);
  await f.controller.save({ enabled: true });
  const restart = controllerFixture(f.value); await restart.controller.getState();
  assert.equal(restart.rules.length, 2);
});
test("OFFはルール解除・保存の順に完了してから成功を返す", async () => {
  const f = controllerFixture({ enabled: true, noteUserId: "ruminar" });
  const result = await f.controller.save({ enabled: false });
  assert.deepEqual(f.history, ["rules:off", "store"]);
  assert.equal(result.enabled, false); assert.equal(f.value.noteUserId, "ruminar");
});
test("複数タブから同時保存してもON/OFFとユーザー名を上書きし合わない", async () => {
  const f = controllerFixture();
  await Promise.all([f.controller.save({ enabled: false }), f.controller.save({ noteUserId: "ruminar" })]);
  assert.deepEqual(f.value, { enabled: false, noteUserId: "ruminar" });
  assert.deepEqual(f.rules, []);
});
test("転送更新失敗時は設定を保存せず、次の操作は再試行できる", async () => {
  const f = controllerFixture({ enabled: true, noteUserId: "ruminar" }, { failUpdate: 1 });
  await assert.rejects(f.controller.save({ enabled: false }), /rules failed/);
  assert.equal(f.value.enabled, true);
  await f.controller.save({ enabled: false }); assert.equal(f.value.enabled, false);
});
test("保存失敗時は以前の転送状態へ戻し、成功扱いにしない", async () => {
  const f = controllerFixture({ enabled: true }, { storeError: true });
  await assert.rejects(f.controller.save({ enabled: false }), /store failed/);
  assert.deepEqual(f.history, ["rules:off", "store", "rules:on"]);
  assert.equal(f.rules.length, 2); assert.equal(f.value.enabled, true);
});
test("復旧も失敗した場合は拡張無効化の案内を返す", async () => {
  const f = controllerFixture({ enabled: true }, { storeError: true, failUpdate: 2 });
  await assert.rejects(f.controller.save({ enabled: false }), /拡張を無効化/);
});
test("設定の型・未知項目・不正ユーザー名はルール更新前に拒否", async () => {
  const f = controllerFixture();
  for (const patch of [null, [], { enabled: "false" }, { unexpected: true }, { noteUserId: "<script>" }]) await assert.rejects(f.controller.save(patch));
  assert.equal(f.history.length, 0);
});
function contentFixture(stored, options = {}) {
  const documentEvents = new Map(), events = new Map(), navigationEvents = new Map();
  const moves = [];
  let subscriber, tick;
  const home = "chrome-extension://test/home.html";
  const location = { href: options.url ?? "https://note.com/ruminar", assign: url => moves.push(["assign", url]), replace: url => moves.push(["replace", url]) };
  const c = context({
    location,
    document: { addEventListener: (name, fn) => documentEvents.set(name, fn), removeEventListener: name => documentEvents.delete(name) },
    window: {
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
      navigation: { addEventListener: (name, fn) => navigationEvents.set(name, fn), removeEventListener: name => navigationEvents.delete(name) }
    },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = undefined; },
    HikikomoriNotePlatform: {
      isAvailable: () => !options.invalid,
      homeUrl: () => home,
      load: async () => { if (options.loadError) throw new Error("read failed"); return stored; },
      subscribe(fn) { subscriber = fn; return () => { subscriber = undefined; }; }
    }
  });
  vm.runInContext(source("src/content.js"), c);
  function click(url = "https://note.com/", changes = {}) {
    const event = {
      button: 0, defaultPrevented: false, composedPath: () => [{ tagName: "svg" }, { tagName: "A", href: url, hasAttribute: () => false }],
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...changes
    };
    documentEvents.get("click")?.(event);
    return event;
  }
  return { c, home, moves, location, events, navigationEvents, documentEvents, click, tick: () => tick?.(), changed: value => subscriber?.(value) };
}
test("noteロゴの通常クリックはSPA処理の前に専用ホームへ直行", async () => {
  const f = contentFixture(); await flush();
  const event = f.click();
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  assert.deepEqual(f.moves, [["assign", f.home]]);
});
test("OFF・記事リンク・修飾クリック・別タブ・ダウンロードには介入しない", async () => {
  const f = contentFixture(); await flush();
  assert.equal(f.click("https://note.com/ruminar/n/abc").defaultPrevented, false);
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) assert.equal(f.click(undefined, { [key]: true }).defaultPrevented, false);
  assert.equal(f.click(undefined, { button: 1 }).defaultPrevented, false);
  for (const anchor of [{ target: "_blank" }, { hasAttribute: () => true }]) {
    assert.equal(f.click(undefined, { composedPath: () => [{ tagName: "A", href: "https://note.com/", hasAttribute: () => false, ...anchor }] }).defaultPrevented, false);
  }
  f.changed({ enabled: false }); assert.equal(f.click().defaultPrevented, false);
  assert.equal(f.moves.length, 0);
});
test("JSによるホーム遷移も可能なら通信開始前にキャンセルし専用ホームへ", async () => {
  const f = contentFixture(); await flush();
  let canceled = false;
  f.navigationEvents.get("navigate")({ cancelable: true, destination: { url: "https://note.com/?x=1" }, preventDefault() { canceled = true; } });
  assert.equal(canceled, true); assert.deepEqual(f.moves, [["assign", f.home]]);
});
test("履歴操作等でホームへ着いた場合のフォールバックとOFF維持", async () => {
  const f = contentFixture(); await flush();
  f.location.href = "https://note.com/"; f.events.get("popstate")();
  assert.deepEqual(f.moves, [["replace", f.home]]);
  f.changed({ enabled: false }); f.tick(); assert.equal(f.moves.length, 1);
});
test("ストレージ読込失敗・拡張無効時はnoteの操作を妨げない", async () => {
  for (const options of [{ loadError: true }, { invalid: true }]) {
    const f = contentFixture(undefined, options); await flush(); f.tick();
    assert.equal(f.click().defaultPrevented, false); assert.equal(f.moves.length, 0);
    assert.equal(f.documentEvents.size, 0);
  }
});
function homeFixture(options = {}) {
  const nodes = new Map();
  for (const id of ["normal", "mode", "status", "profile", "user-status", "note-user", "save", "settings", "enable", "retry"]) nodes.set(id, {
    value: "", disabled: true, hidden: false, removeAttribute(name) { delete this[name]; }, focus() { this.focused = true; }
  });
  const moves = [], patches = [];
  let state = { enabled: true, noteUserId: "ruminar" };
  const c = context({
    document: { getElementById: id => nodes.get(id), querySelectorAll: () => ["normal", "note-user", "save", "enable", "retry"].map(id => nodes.get(id)) },
    location: { assign: url => moves.push(url) },
    HikikomoriNotePlatform: {
      getState: async () => { if (options.stateError) throw new Error("state failed"); return state; },
      save: async patch => {
        patches.push(plain(patch));
        await options.saveGate;
        if (options.saveError) throw new Error("save failed");
        state = { ...state, ...patch }; return state;
      }, subscribe() {}
    }
  });
  vm.runInContext(source("src/home.js"), c);
  return { nodes, moves, patches };
}
test("専用ホームはnoteへの移動なしで設定とプロフィールを表示", async () => {
  const f = homeFixture(); await flush();
  assert.equal(f.nodes.get("profile").href, "https://note.com/ruminar");
  assert.equal(f.nodes.get("note-user").value, "ruminar"); assert.equal(f.moves.length, 0);
});
test("OFFの完了応答前は通常noteを開かず、成功後にだけ移動", async () => {
  let resolve;
  const f = homeFixture({ saveGate: new Promise(done => { resolve = done; }) }); await flush();
  f.nodes.get("normal").onclick(); await flush(); assert.equal(f.moves.length, 0);
  resolve(); await flush(); assert.deepEqual(f.moves, ["https://note.com/"]);
  assert.deepEqual(f.patches, [{ enabled: false }]);
});
test("転送解除失敗時は通常noteへ移動せず、再確認を案内", async () => {
  const f = homeFixture({ saveError: true }); await flush();
  f.nodes.get("normal").onclick(); await flush();
  assert.equal(f.moves.length, 0); assert.match(f.nodes.get("status").textContent, /状態を再確認/);
  assert.equal(f.nodes.get("retry").disabled, false);
});
test("ユーザー設定は名前だけを保存し、HTMLや記事URLは拒否", async () => {
  const f = homeFixture(); await flush();
  const submit = () => f.nodes.get("settings").onsubmit({ preventDefault() {} });
  f.nodes.get("note-user").value = "<script>"; submit(); assert.equal(f.patches.length, 0);
  f.nodes.get("note-user").value = "https://note.com/ruminar"; submit(); await flush();
  assert.deepEqual(f.patches, [{ noteUserId: "ruminar" }]);
});
test("背景処理は専用ホームからのメッセージだけを受理し、起動時にも整合", async () => {
  let handler, installs, startups, action, opened = 0;
  const f = controllerFixture();
  const c = context({
    importScripts() {},
    HikikomoriNoteBackgroundPlatform: {
      onInstalled(fn) { installs = fn; }, onStartup(fn) { startups = fn; }, onAction(fn) { action = fn; },
      onMessage(fn) { handler = fn; }, isHomeSender: sender => sender.url === "extension-home",
      openHome: async () => { opened++; }
    }
  });
  c.HikikomoriNoteRouting = { createController: () => f.controller };
  vm.runInContext(source("src/background.js"), c); await flush(); assert.equal(f.rules.length, 2);
  let answer;
  assert.equal(handler({ type: "save-settings", patch: { enabled: false } }, { url: "https://note.com/" }, value => { answer = value; }), false);
  assert.equal(answer, undefined);
  assert.equal(handler({ type: "save-settings", patch: { enabled: false } }, { url: "extension-home" }, value => { answer = value; }), true);
  await flush(); assert.equal(answer.ok, true); assert.equal(f.rules.length, 0);
  installs(); startups(); action(); await flush(); assert.equal(opened, 1); assert.equal(f.rules.length, 0);
});
test("アダプターは自拡張のhome.htmlだけを設定メッセージ送信元と認める", () => {
  const c = context({ chrome: { runtime: { id: "test", getURL: file => `chrome-extension://test/${file}` } } });
  vm.runInContext(source("src/platform/browser-api.js"), c);
  const check = c.HikikomoriNoteBackgroundPlatform.isHomeSender;
  assert.equal(check({ id: "test", url: "chrome-extension://test/home.html?x=1" }), true);
  for (const sender of [{ id: "test", url: "https://note.com/" }, { id: "other", url: "chrome-extension://test/home.html" }, { id: "test", url: "chrome-extension://test/home.html.evil" }]) assert.equal(check(sender), false);
});
test("Manifest・専用HTMLの参照、権限と公開範囲が一致し、旧CSS差替えはない", () => {
  const m = JSON.parse(source("manifest.json"));
  assert.equal(m.manifest_version, 3); assert.equal(m.version, "0.1.0");
  assert.deepEqual(m.permissions, ["storage", "declarativeNetRequestWithHostAccess"]);
  assert.deepEqual(m.host_permissions, ["https://note.com/*"]);
  assert.deepEqual(m.web_accessible_resources, [{ resources: ["home.html"], matches: ["https://note.com/*"] }]);
  assert.equal(m.content_scripts[0].run_at, "document_start");
  assert.equal(m.content_scripts[0].css, undefined);
  for (const file of [m.background.service_worker, ...m.content_scripts[0].js, ...Object.values(m.icons), "home.html"]) assert.ok(fs.existsSync(path.join(root, file)));
  for (const match of source("home.html").matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])));
  assert.equal(/<script[^>]*>[^<]+<\/script>/.test(source("home.html")), false);
});
