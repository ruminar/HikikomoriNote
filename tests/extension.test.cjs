"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const settingsData = require("./helpers/settings.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function context(extra = {}) {
  const c = vm.createContext({ URL, queueMicrotask, console: { warn() {} }, ...extra });
  for (const file of ["src/common.js", "src/routing.js"]) vm.runInContext(source(file), c);
  return c;
}
function controllerFixture(stored, options = {}) {
  const c = context();
  let value = stored === undefined ? undefined : {...settingsData(),...stored}, activeRules = [], updates = 0;
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
test("ダッシュボード判定は本体・配下・query/hashを対象とし、似た名前や外部URLを除外", () => {
  const core = context().HikikomoriNote;
  for (const url of ["https://note.com/dashboard", "https://note.com/dashboard/", "https://note.com/dashboard/suggestions", "https://note.com/dashboard/sales/deeper?x=1#tab", "https://note.com/dashboard?x=1#top"]) {
    assert.equal(core.isDashboard(url), true);
    assert.equal(core.shouldRedirect(url, { enabled: true, dashboardDisabled: true }), true);
    assert.equal(core.shouldRedirect(url, { enabled: true, dashboardDisabled: false }), false);
    assert.equal(core.shouldRedirect(url, { enabled: false, dashboardDisabled: true }), false);
  }
  for (const url of ["", undefined, "https://note.com/dashboard-old", "https://note.com/dashboardish/", "https://note.com/settings/account", "https://note.com/api/dashboard", "https://other.test/dashboard", "https://note.com.evil.test/dashboard", "http://note.com/dashboard"]) assert.equal(core.isDashboard(url), false);
  assert.equal(core.readSettings().dashboardDisabled, false);
});
test("ダッシュボード無効化のDNRは本体と全配下のみを転送・遮断し、OFFでは全ルール解除", () => {
  const routing = context().HikikomoriNoteRouting;
  const rules = plain(routing.rules(true, true));
  assert.equal(rules.length, 4);
  assert.deepEqual(rules.map(rule => rule.id), [1, 2, 3, 4]);
  assert.equal(rules[2].action.redirect.extensionPath, "/home.html");
  assert.deepEqual(rules[2].condition.resourceTypes, ["main_frame"]);
  assert.equal(rules[3].action.type, "block");
  const regex = new RegExp(rules[2].condition.regexFilter);
  for (const url of ["https://note.com/dashboard", "https://note.com/dashboard/", "https://note.com/dashboard/suggestions?x=1", "https://note.com/dashboard#tab"]) assert.equal(regex.test(url), true);
  for (const url of ["https://note.com/dashboard-x", "https://note.com/settings/account", "https://note.com/api/v1/dashboard", "https://note.com/ruminar/n/test", "https://other.test/dashboard"]) assert.equal(regex.test(url), false);
  assert.equal(routing.rules(true, false).length, 2);
  assert.deepEqual(plain(routing.rules(false, true)), []);
});
test("ダッシュボード設定を保存・復元し、全体OFF/ONと別タブの部分保存でも選択を維持", async () => {
  const f = controllerFixture({ enabled: true, noteUserId: "ruminar" });
  await f.controller.save({ dashboardDisabled: true }); assert.equal(f.rules.length, 4);
  await Promise.all([f.controller.save({ noteUserId: "other_user" }), f.controller.save({ enabled: false })]);
  assert.deepEqual(f.value, { enabled: false, noteUserId: "other_user", dashboardDisabled: true, legacyMode: false, hideArticleRecommendations: false, hidePaidArticles: false, noteLogoBrowserBack: false, ...settingsData.groups() });
  assert.equal(f.rules.length, 0);
  const restart = controllerFixture(f.value); await restart.controller.getState(); assert.equal(restart.rules.length, 0);
  await restart.controller.save({ enabled: true }); assert.equal(restart.rules.length, 4);
  await restart.controller.save({ dashboardDisabled: false }); assert.equal(restart.rules.length, 2);
});
test("ダッシュボード設定の保存に失敗したら以前の制限と設定を復元", async () => {
  const f = controllerFixture({ enabled: true, dashboardDisabled: true }, { storeError: true });
  await assert.rejects(f.controller.save({ dashboardDisabled: false }), /store failed/);
  assert.equal(f.value.dashboardDisabled, true); assert.equal(f.rules.length, 4);
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
test("保存したユーザー名・OFFを再起動後も適用", async () => {
  const f = controllerFixture({ enabled: false, noteUserId: "ruminar" });
  assert.deepEqual(plain(await f.controller.getState()), { enabled: false, noteUserId: "ruminar", dashboardDisabled: false, legacyMode: false, hideArticleRecommendations: false, hidePaidArticles: false, noteLogoBrowserBack: false, tagSchemaVersion: 2, tagGroups: [1,2,3,4].map(number=>({id:`group${number}`,name:"",tags:[]})), selectedTagGroupId:"group1", groupSelectionRevision:0, tagGroupsRevision:0 });
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
  assert.deepEqual(f.value, { enabled: false, noteUserId: "ruminar", dashboardDisabled: false, legacyMode: false, hideArticleRecommendations: false, hidePaidArticles: false, noteLogoBrowserBack: false, ...settingsData.groups() });
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
  for (const patch of [null, [], { enabled: "false" }, { unexpected: true }, { noteUserId: "<script>" }, { dashboardDisabled: "true" }]) await assert.rejects(f.controller.save(patch));
  assert.equal(f.history.length, 0);
});
function contentFixture(stored, options = {}) {
  const documentEvents = new Map(), events = new Map(), navigationEvents = new Map();
  const moves = [];
  let subscriber, tick, mutation;
  let disconnected = false;
  const anchors = [];
  function addAnchor(url) {
    const attributes = new Map();
    const anchor = { tagName: "A", href: url, isConnected: true,
      hasAttribute: key => attributes.has(key),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key)
    };
    anchors.push(anchor);
    return anchor;
  }
  const home = "chrome-extension://test/home.html";
  const location = { href: options.url ?? "https://note.com/ruminar", assign: url => moves.push(["assign", url]), replace: url => moves.push(["replace", url]) };
  const c = context({
    location,
    HikikomoriNoteUi: options.ui ?? (options.logoDetector ? { create:()=>undefined, isOfficialHeaderLogo:options.logoDetector } : undefined),
    document: {
      addEventListener: (name, fn) => documentEvents.set(name, fn), removeEventListener: name => documentEvents.delete(name),
      querySelectorAll: () => anchors.filter(anchor => anchor.isConnected && anchor.href)
    },
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    window: {
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
      navigation: { addEventListener: (name, fn) => navigationEvents.set(name, fn), removeEventListener: name => navigationEvents.delete(name) }
    },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = undefined; },
    HikikomoriNotePlatform: {
      isAvailable: () => !options.invalid,
      homeUrl: () => home,
      goBack: () => { const result = options.back?.(); if (result !== undefined) return result; if (options.backResult === false) return false; moves.push(["back"]); return true; },
      load: async () => { await options.loadGate; if (options.loadError) throw new Error("read failed"); return {...settingsData(),...stored}; },
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
  return { c, home, moves, location, events, navigationEvents, documentEvents, click,
    addAnchor, mutate: () => { if (!disconnected) mutation?.(); },
    tick: () => tick?.(), changed: value => subscriber?.(value) };
}
test("設定読込待ちでも親の先行準備とDOM監視を開始し、設定確認後の更新へ引き継ぐ",async()=>{
 let resolve;const calls=[];const f=contentFixture({}, {url:'https://note.com/following',loadGate:new Promise(done=>{resolve=done;}),ui:{create:()=>({prepareSidebar:url=>calls.push(['prepare',url]),update:()=>calls.push(['update'])})}});
 assert.deepEqual(calls,[['prepare','https://note.com/following']]);f.mutate();await flush();assert.equal(calls.filter(call=>call[0]==='prepare').length,2);
 resolve();await flush();assert.equal(calls.at(-1)[0],'update');
});

test("noteロゴの通常クリックはSPA処理の前に専用ホームへ直行", async () => {
  const f = contentFixture(); await flush();
  const event = f.click();
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  assert.deepEqual(f.moves, [["assign", f.home]]);
});

test("検索の他対象タブから記事へ戻るURLだけ新着にし、検索語と追加条件を維持", () => {
  const core = context().HikikomoriNote;
  for (const type of ["user", "magazine", "circle"]) {
    const next = new URL(core.articleSearchTabUrl(`https://note.com/search?q=%23AI&context=${type}`, "/search?context=note&q=%23AI&extra=yes"));
    assert.equal(next.searchParams.get("q"), "#AI"); assert.equal(next.searchParams.get("sort"), "new");
    assert.equal(next.searchParams.get("mode"), "search"); assert.equal(next.searchParams.get("extra"), "yes");
  }
  for (const [current, target] of [
    ["https://note.com/search?q=AI&context=note", "https://note.com/search?q=AI&context=note&sort=popular"],
    ["https://note.com/search?q=AI&context=user", "https://note.com/search?q=other&context=note"],
    ["https://note.com/search?q=AI&context=user", "https://other.test/search?q=AI&context=note"],
    ["https://note.com/ruminar", "https://note.com/search?q=AI&context=note"],
    ["invalid", "invalid"]
  ]) assert.equal(core.articleSearchTabUrl(current, target), null);
});

test("後から出る記事タブの通常クリックを新着へ。並び順・修飾クリック・OFF・重度は維持", async () => {
  const f = contentFixture({}, { url: "https://note.com/search?q=%23AI&context=user" }); await flush();
  const anchor = { tagName: "A", href: "https://note.com/search?q=%23AI&context=note", textContent: "記事", hasAttribute: () => false, getAttribute: key => key === "data-id" ? "NavigationItem" : null };
  const click = (changes = {}, link = anchor) => f.click(undefined, { composedPath: () => [{ tagName: "SPAN" }, link], ...changes });
  assert.equal(click().stopped, true); assert.equal(new URL(f.moves[0][1]).searchParams.get("sort"), "new");
  for (const changes of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) assert.equal(click(changes).defaultPrevented, false);
  for (const patch of [{ target: "_blank" }, { textContent: "人気" }, { getAttribute: () => null }, { hasAttribute: () => true }]) assert.equal(click({}, { ...anchor, ...patch }).defaultPrevented, false);
  f.location.href = "https://note.com/search?q=%23AI&context=note&sort=new";assert.equal(click().defaultPrevented, false);
  f.location.href = "https://note.com/search?q=%23AI&context=user";
  for (const settings of [{ enabled: false }, { enabled: true, legacyMode: true }]) { f.changed(settings); assert.equal(click().defaultPrevented, false); }
  assert.equal(f.moves.length, 1);
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

test("ロゴの通常クリックはイベント停止後にブラウザバック。重度でも適用しOFFで停止",async()=>{
 let event,calls=0;const f=contentFixture({noteLogoBrowserBack:true,legacyMode:true},{logoDetector:()=>true,back(){calls++;assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);}});await flush();
 event={button:0,isTrusted:true,cancelable:true,defaultPrevented:false,composedPath:()=>[{tagName:'A',href:'https://note.com/',hasAttribute:()=>false}],preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};
 f.documentEvents.get('click')(event);assert.equal(calls,1);assert.deepEqual(f.moves,[['back']]);
 f.changed({enabled:false,noteLogoBrowserBack:true});assert.equal(f.click(undefined,{isTrusted:true,cancelable:true}).defaultPrevented,false);assert.equal(calls,1);
});

test("ロゴ以外・修飾キー・非trusted・設定OFFではブラウザバックしない",async()=>{
 let calls=0;const options={logoDetector:()=>true,back(){calls++;}};
 const f=contentFixture({noteLogoBrowserBack:true},options);await flush();
 for(const event of [{isTrusted:true,cancelable:true,ctrlKey:true},{isTrusted:false,cancelable:true},{isTrusted:true,cancelable:false},{isTrusted:true,cancelable:true,button:1}])f.click(undefined,event);
 assert.equal(calls,0);f.changed({enabled:true,noteLogoBrowserBack:false});f.click(undefined,{isTrusted:true,cancelable:true});assert.equal(calls,0);
 const other=contentFixture({noteLogoBrowserBack:true},{...options,logoDetector:()=>false});await flush();other.click(undefined,{isTrusted:true,cancelable:true});assert.equal(calls,0);assert.deepEqual(other.moves,[['assign',other.home]]);
 await assert.rejects(controllerFixture().controller.save({noteLogoBrowserBack:'true'}));
});

test("ロゴで戻れない・API失敗時は現在ページにとどまり、次のクリックを再試行できる",async()=>{
 for(const options of [{backResult:false},{back(){throw Error('unsupported');}},{back:()=>Promise.reject(Error('failed'))},{back:()=>Promise.resolve(false)}]){
  let calls=0;
  const f=contentFixture({noteLogoBrowserBack:true},{logoDetector:()=>true,back(){calls++;return calls===1?(options.back?options.back():false):true;}});await flush();
  const event=f.click(undefined,{isTrusted:true,cancelable:true});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);await flush();
  assert.deepEqual(f.moves,[]);
  const retry=f.click(undefined,{isTrusted:true,cancelable:true});assert.equal(retry.defaultPrevented,true);await flush();assert.equal(calls,2);assert.deepEqual(f.moves,[]);
 }
});

test("ロゴの戻る待機中は連打をまとめ、利用者の画面移動・設定OFF後には転送しない",async()=>{
 for(const change of [f=>{f.location.href='https://note.com/other';},f=>f.changed({enabled:false})]){
  let resolve,calls=0;const f=contentFixture({noteLogoBrowserBack:true},{logoDetector:()=>true,back(){calls++;return new Promise(done=>{resolve=done;});}});await flush();
  f.click(undefined,{isTrusted:true,cancelable:true});f.click(undefined,{isTrusted:true,cancelable:true});assert.equal(calls,1);
  change(f);resolve(false);await flush();assert.deepEqual(f.moves,[]);
 }
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
test("ダッシュボード導線は後から出るメニューも隠し、設定・OFF・href変更・無効化時に復帰", async () => {
  const options = {};
  const f = contentFixture({ dashboardDisabled: true }, options);
  const marker = "data-hikikomori-note-dashboard-hidden";
  const dashboard = f.addAnchor("https://note.com/dashboard");
  const settings = f.addAnchor("https://note.com/settings/account");
  await flush();
  assert.equal(dashboard.hasAttribute(marker), true); assert.equal(settings.hasAttribute(marker), false);
  const submenu = f.addAnchor("https://note.com/dashboard/suggestions?x=1"); f.mutate(); await flush();
  assert.equal(submenu.hasAttribute(marker), true);
  assert.equal(f.click(submenu.href).defaultPrevented, true);
  dashboard.href = "https://note.com/settings/account"; f.mutate(); await flush(); assert.equal(dashboard.hasAttribute(marker), false);
  submenu.href = ""; f.mutate(); await flush(); assert.equal(submenu.hasAttribute(marker), false);
  submenu.href = "https://note.com/dashboard/suggestions"; f.mutate(); await flush(); assert.equal(submenu.hasAttribute(marker), true);
  f.changed({ enabled: true, dashboardDisabled: false, legacyMode: false }); assert.equal(submenu.hasAttribute(marker), false);
  assert.equal(f.click(submenu.href).defaultPrevented, false);
  f.changed({ enabled: true, dashboardDisabled: true }); assert.equal(submenu.hasAttribute(marker), true);
  f.changed({ enabled: false, dashboardDisabled: true }); assert.equal(submenu.hasAttribute(marker), false);
  f.changed({ enabled: true, dashboardDisabled: true });
  options.invalid = true; f.tick(); assert.equal(submenu.hasAttribute(marker), false);
});
test("無効化中にダッシュボード配下へSPA・履歴・直行した場合も専用ホームへ戻す", async () => {
  const f = contentFixture({ dashboardDisabled: true }, { url: "https://note.com/dashboard/suggestions" }); await flush();
  assert.deepEqual(f.moves, [["replace", f.home]]);
  let canceled = false;
  f.navigationEvents.get("navigate")({ cancelable: true, destination: { url: "https://note.com/dashboard/sales" }, preventDefault() { canceled = true; } });
  assert.equal(canceled, true);
  f.location.href = "https://note.com/dashboard?tab=x"; f.events.get("popstate")();
  assert.equal(f.moves.at(-1)[0], "replace");
});
const homeFixture = require("./helpers/home.cjs");

test("専用ホームはnoteへの移動なしでタグ管理と設定を表示", async () => {
  const f = homeFixture(); await flush();
  assert.equal(f.nodes.get("panel-tags").hidden, false); assert.equal(f.nodes.get("profile").href, "https://note.com/ruminar");
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
  assert.equal(f.moves.length, 0); assert.match(f.nodes.get("status").textContent, /処理できませんでした/);
  assert.equal(f.nodes.get("retry").disabled, false);
});
test("ユーザー名とダッシュボード選択を保存し、HTMLや記事URLは拒否", async () => {
  const f = homeFixture(); await flush();
  const submit = () => f.nodes.get("settings").onsubmit({ preventDefault() {} });
  f.nodes.get("note-user").value = "<script>"; f.nodes.get("note-user").fire("input"); submit(); assert.equal(f.patches.length, 0);
  f.nodes.get("note-user").value = "https://note.com/ruminar"; f.nodes.get("note-user").fire("input"); submit(); await flush();
  assert.deepEqual(f.patches, [{ noteUserId: "ruminar" }]);
});
test("ホームの選択を保存し、再表示で復元。保存失敗は成功扱いにしない", async () => {
  const f = homeFixture({ state: { dashboardDisabled: true } }); await flush();
  assert.equal(f.nodes.get("dashboard-disabled").checked, true);
  f.nodes.get("dashboard-disabled").checked = false; f.nodes.get("dashboard-disabled").fire("change");
  f.nodes.get("settings").onsubmit({ preventDefault() {} }); await flush();
  assert.deepEqual(f.patches, [{ dashboardDisabled: false }]);
  const failed = homeFixture({ saveError: true }); await flush();
  failed.nodes.get("dashboard-disabled").checked = true; failed.nodes.get("dashboard-disabled").fire("change");
  failed.nodes.get("settings").onsubmit({ preventDefault() {} }); await flush();
  assert.match(failed.nodes.get("status").textContent, /処理できませんでした/);
});
test("背景処理は専用ホームからのメッセージだけを受理し、起動時にも整合", async () => {
  let handler, installs, startups, action, opened = 0;
  const f = controllerFixture();
  const c = context({
    importScripts() {},
    HikikomoriNoteBackgroundPlatform: {
      onInstalled(fn) { installs = fn; }, onStartup(fn) { startups = fn; }, onAction(fn) { action = fn; },
      onMessage(fn) { handler = fn; }, isHomeSender: sender => sender.url === "extension-home",
      openHome: async failed => {
        assert.equal(failed, false);
        assert.equal(f.value.enabled, true);
        assert.equal(f.rules.length, 2);
        assert.equal(f.value.noteUserId, "");
        opened++;
      }
    }
  });
  c.HikikomoriNoteRouting = { createController: () => f.controller };
  vm.runInContext(source("src/background.js"), c); await flush(); assert.equal(f.rules.length, 2);
  let answer;
  assert.equal(handler({ type: "save-settings", patch: { enabled: false } }, { url: "https://note.com/" }, value => { answer = value; }), false);
  assert.equal(answer, undefined);
  assert.equal(handler({ type: "save-settings", patch: { enabled: false } }, { url: "extension-home" }, value => { answer = value; }), true);
  await flush(); assert.equal(answer.ok, true); assert.equal(f.rules.length, 0);
  installs(); startups(); action(); await flush(); assert.equal(opened, 1); assert.equal(f.rules.length, 2);
});
test("アイコンのON保存が失敗した時も専用ホームを開き、失敗の印を渡す", async () => {
  let action, opened;
  const f = controllerFixture({ enabled: false, noteUserId: "ruminar" }, { storeError: true });
  const c = context({
    importScripts() {},
    HikikomoriNoteBackgroundPlatform: {
      onInstalled() {}, onStartup() {}, onMessage() {},
      onAction(fn) { action = fn; },
      openHome: async failed => { opened = failed; }
    }
  });
  c.HikikomoriNoteRouting = { createController: () => f.controller };
  vm.runInContext(source("src/background.js"), c); await flush();
  action(); await flush();
  assert.equal(opened, true); assert.equal(f.value.enabled, false); assert.deepEqual(f.rules, []);
});
test("OFFの専用ホームを直接開いてもONへ変更せず、アイコンからの再開を案内", async () => {
  const f = homeFixture({ state: { enabled: false } }); await flush();
  assert.equal(f.patches.length, 0);
  assert.match(f.nodes.get("mode").textContent, /拡張アイコン/);
  assert.equal(source("home.html").includes('id="enable"'), false);
});
test("アイコンからのON切替失敗を画面に表示", async () => {
  const f = homeFixture({ state: { enabled: false }, hash: "#activation-failed" }); await flush();
  assert.match(f.nodes.get("status").textContent, /ONへの切り替えに失敗/);
  assert.equal(f.patches.length, 0);
});
test("アダプターは自拡張のhome.htmlだけを設定メッセージ送信元と認める", () => {
  const c = context({ chrome: { runtime: { id: "test", getURL: file => `chrome-extension://test/${file}` } } });
  vm.runInContext(source("src/platform/browser-api.js"), c);
  const check = c.HikikomoriNoteBackgroundPlatform.isHomeSender;
  assert.equal(check({ id: "test", url: "chrome-extension://test/home.html?x=1" }), true);
  for (const sender of [{ id: "test", url: "https://note.com/" }, { id: "other", url: "chrome-extension://test/home.html" }, { id: "test", url: "chrome-extension://test/home.html.evil" }]) assert.equal(check(sender), false);
});
test("Manifest・専用HTMLの参照、権限と公開範囲が一致し、ホーム全体を隠さない", () => {
  const m = JSON.parse(source("manifest.json"));
  assert.equal(m.manifest_version, 3); assert.equal(m.version, "0.2.2");
  assert.deepEqual(m.permissions, ["storage", "declarativeNetRequestWithHostAccess"]);
  assert.deepEqual(m.host_permissions, ["https://note.com/*"]);
  assert.deepEqual(m.web_accessible_resources, [{ resources: ["home.html"], matches: ["https://note.com/*"] }]);
  assert.equal(m.content_scripts[0].run_at, "document_start");
  assert.deepEqual(m.content_scripts[0].css, ["src/content.css"]);
  assert.equal(source("src/content.css").includes("> body"), false);
  for (const file of [m.background.service_worker, ...m.content_scripts[0].js, ...m.content_scripts[0].css, ...Object.values(m.icons), "home.html"]) assert.ok(fs.existsSync(path.join(root, file)));
  for (const match of source("home.html").matchAll(/(?:src|href)="([^"]+)"/g)) if (!match[1].startsWith("https://")) assert.ok(fs.existsSync(path.join(root, match[1])));
  assert.equal(/<script[^>]*>[^<]+<\/script>/.test(source("home.html")), false);
});
