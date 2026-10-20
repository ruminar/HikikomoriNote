"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

function fixture(stored, options = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ""; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    get isConnected() { return this === document.documentElement || Boolean(this.parent?.isConnected); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    attachShadow() { this.shadowRoot = new Element("shadow"); this.shadowRoot.parent = this; return this.shadowRoot; }
    querySelectorAll(selector) {
      return this.children.flatMap(node => [
        ...((selector === "button" ? node.tag === "button" : node.attributes.role === "status") ? [node] : []),
        ...node.querySelectorAll(selector)
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() { this.focused = true; }
  }
  const document = { documentElement: new Element("html"), createElement: tag => new Element(tag) };
  const body = new Element("body");
  const original = new Element("article");
  body.append(original);
  document.documentElement.append(body);
  let tick, listener, saved;
  const events = new Map();
  const context = vm.createContext({
    URL, document, location: { href: options.url ?? "https://note.com/" }, console: { warn() {} },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = null; },
    window: { addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } },
    chrome: {
      runtime: { id: "test-extension" },
      storage: {
        local: {
          async get(key) { if (options.loadError) throw new Error("read failed"); return { [key]: stored }; },
          async set(value) { if (options.saveError) throw new Error("write failed"); saved = value; }
        },
        onChanged: { addListener(fn) { listener = fn; }, removeListener() { listener = null; } }
      }
    }
  });
  for (const file of ["src/common.js", "src/platform/browser-api.js"]) vm.runInContext(source(file), context);
  return {
    context, document, body, original, events,
    core: context.HikikomoriNote,
    start: async () => { vm.runInContext(source("src/content.js"), context); await flush(); },
    tick: () => tick?.(),
    changed: value => listener({ [context.HikikomoriNote.settingsKey]: { newValue: value } }, "local"),
    get saved() { return saved; },
    get shadow() { return document.documentElement.children.find(n => n.shadowRoot)?.shadowRoot; },
    get active() { return document.documentElement.attributes["data-hikikomori-note-home"] === "active"; }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) {
  if (!node) return;
  if (predicate(node)) return node;
  for (const child of node.children) { const result = find(child, predicate); if (result) return result; }
}
test("ホーム限定：query/hashは許容し、記事・編集・認証・別originは対象外", () => {
  const { core } = fixture();
  for (const url of ["https://note.com/", "https://note.com/?x=1#top"]) assert.equal(core.isHome(url), true);
  for (const url of ["https://note.com/user/n/abc", "https://note.com/notes/new", "https://note.com/login", "https://note.com/settings", "https://note.com/purchase", "https://example.com/", "http://note.com/"]) assert.equal(core.isHome(url), false);
});
test("ユーザー名とプロフィールURLを正規化し、外部URLやHTMLを拒否", () => {
  const { core } = fixture();
  assert.equal(core.normalizeUserId(" ruminar "), "ruminar");
  assert.equal(core.normalizeUserId("https://note.com/ruminar/?x=1"), "ruminar");
  assert.equal(core.profileUrl("ruminar"), "https://note.com/ruminar");
  assert.equal(core.profileUrl(""), null);
  for (const value of ["https://evil.test/user", "https://note.com/user/n/abc", "<img>", "../x", "https://note.com@evil.test/user"]) assert.throws(() => core.normalizeUserId(value));
  assert.equal(core.readSettings({ enabled: false, noteUserId: "<script>" }).noteUserId, "");
});
test("SPA往復でも元DOMを保持して復帰し、ホームへ戻ると再表示", async () => {
  const f = fixture({ noteUserId: "ruminar" }); await f.start();
  assert.equal(f.active, true);
  assert.equal(find(f.shadow, n => n.tag === "a").href, "https://note.com/ruminar");
  f.context.location.href = "https://note.com/ruminar/n/example"; f.tick();
  assert.equal(f.active, false); assert.equal(f.shadow, undefined);
  assert.equal(f.body.children[0], f.original);
  f.context.location.href = "https://note.com/"; f.tick(); assert.equal(f.active, true);
});
test("記事から起動した場合も介入せず、SPAでホームへ来た時だけ表示", async () => {
  const f = fixture(undefined, { url: "https://note.com/login" }); await f.start();
  assert.equal(f.shadow, undefined);
  f.context.location.href = "https://note.com/"; f.tick(); assert.equal(f.active, true);
});
test("OFFは即時復帰して保存、再起動時もOFF、再度ONにできる", async () => {
  const f = fixture(); await f.start();
  find(f.shadow, n => n.tag === "button" && n.textContent.includes("OFF")).onclick();
  assert.equal(f.active, false); await flush();
  const settings = f.saved[f.core.settingsKey]; assert.equal(settings.enabled, false);
  const next = fixture(settings); await next.start(); assert.equal(next.active, false);
  find(next.shadow, n => n.tag === "button").onclick(); await flush(); assert.equal(next.active, true);
});
test("保存入力は検証してテキスト表示し、再起動後も保持", async () => {
  const f = fixture(); await f.start();
  const input = find(f.shadow, n => n.tag === "input");
  const form = find(f.shadow, n => n.tag === "form");
  input.value = "<script>"; form.onsubmit({ preventDefault() {} }); await flush();
  assert.equal(f.saved, undefined);
  input.value = "https://note.com/ruminar"; form.onsubmit({ preventDefault() {} }); await flush();
  const next = fixture(f.saved[f.core.settingsKey]); await next.start();
  assert.equal(find(next.shadow, n => n.tag === "input").value, "ruminar");
});
test("他タブの変更を反映し、読込失敗・拡張無効化時は通常表示へ復帰", async () => {
  const f = fixture(); await f.start(); f.changed({ enabled: false }); assert.equal(f.active, false);
  f.changed({ enabled: true }); assert.equal(f.active, true);
  f.context.chrome.runtime.id = undefined; f.tick(); assert.equal(f.active, false); assert.equal(f.shadow, undefined);
  const broken = fixture(undefined, { loadError: true }); await broken.start(); assert.equal(broken.active, false); assert.equal(broken.shadow, undefined);
});
test("OFFの保存失敗でも通常画面を利用でき、未保存を伝える", async () => {
  const f = fixture(undefined, { saveError: true }); await f.start();
  find(f.shadow, n => n.tag === "button" && n.textContent.includes("OFF")).onclick(); await flush();
  assert.equal(f.active, false); assert.equal(f.saved, undefined);
  assert.match(f.shadow.querySelector('[role="status"]').textContent, /保存できませんでした/);
});
test("ManifestはMV3・note限定・storageのみ、全参照ファイルが存在", () => {
  const manifest = JSON.parse(source("manifest.json"));
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://note.com/*"]);
  for (const file of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css]) assert.ok(fs.existsSync(path.join(root, file)));
});
