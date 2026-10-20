(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const marker = "data-hikikomori-note-home";
  let settings;
  let host;
  let interval;
  let unsubscribe;
  let revision = 0;
  let stopped = false;
  let saving = false;

  const css = `
    :host { all: initial; display: block; color: #283b35; font: 16px/1.7 system-ui, sans-serif; }
    * { box-sizing: border-box; }
    .home { min-height: 100vh; background: #f6f7f2; padding: 48px 24px; }
    main { max-width: 880px; margin: auto; }
    header { display: flex; gap: 20px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    h1 { font-size: 28px; margin: 0; } h2 { font-size: 20px; margin-top: 0; }
    p { margin: 12px 0; } .muted { color: #59685e; font-size: 14px; }
    section { background: white; border: 1px solid #d9dfd5; border-radius: 16px; padding: 28px; margin: 24px 0; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    input { width: 100%; max-width: 520px; padding: 12px; border: 1px solid #728579; border-radius: 6px; font: inherit; }
    button, a { font: inherit; } button { cursor: pointer; background: #285d4b; color: white; border: 1px solid #285d4b; border-radius: 8px; padding: 10px 18px; }
    button:disabled { opacity: .6; cursor: wait; } .secondary { background: white; color: #285d4b; }
    a { color: #245c49; text-underline-offset: 4px; } :focus-visible { outline: 3px solid #b06923; outline-offset: 4px; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
    .badge { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: calc(100vw - 32px); background: white; border: 1px solid #728579; border-radius: 12px; padding: 12px; box-shadow: 0 4px 20px #0002; }
    .status { min-height: 1.7em; color: #704014; } footer { font-size: 13px; color: #59685e; }
    @media(max-width: 520px) { .home { padding: 24px 16px; } section { padding: 20px; } h1 { font-size: 24px; } }
  `;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function link(text, url) {
    const node = element("a", text);
    node.href = url;
    return node;
  }
  function restore() {
    document.documentElement.removeAttribute(marker);
    host?.remove();
    host = undefined;
  }
  function stop(error) {
    stopped = true;
    restore();
    clearInterval(interval);
    try { unsubscribe?.(); } catch { /* 拡張の再読み込み後も元画面を復帰 */ }
    window.removeEventListener("popstate", sync);
    window.removeEventListener("hashchange", sync);
    window.removeEventListener("pageshow", sync);
    window.navigation?.removeEventListener("currententrychange", sync);
    if (error) console.warn("ひきこもりnote：通常表示へ復帰しました。", error);
  }
  async function save(next, status) {
    if (saving) return;
    saving = true;
    host?.shadowRoot.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      await platform.save(next);
      settings = next;
      revision++;
      sync(true);
      const message = host?.shadowRoot.querySelector('[role="status"]');
      if (message) message.textContent = "設定を保存しました。";
    } catch (error) {
      if (status?.isConnected) status.textContent = "保存できませんでした。変更は保存されていません。再度お試しください。";
      console.warn("ひきこもりnote：設定保存失敗", error);
    } finally {
      saving = false;
      host?.shadowRoot.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  }
  function render() {
    const newHost = element("div");
    const shadow = newHost.attachShadow({ mode: "open" });
    shadow.append(element("style", css));
    const status = element("p", "", "status");
    status.setAttribute("role", "status");
    if (!settings.enabled) {
      const badge = element("aside", "", "badge");
      const enable = element("button", "ひきこもりnoteをONにする");
      enable.onclick = () => { void save({ ...settings, enabled: true }, status); };
      badge.append(enable, status);
      shadow.append(badge);
    } else {
      const wrapper = element("div", "", "home");
      const main = element("main");
      const header = element("header");
      const title = element("div");
      title.append(element("h1", "ひきこもりnote"), element("p", "枠を超えたら落選したので、殻を作りました。", "muted"));
      const disable = element("button", "通常のnoteを表示（OFF）", "secondary");
      disable.onclick = () => {
        // 永続化を待たず、まず通常画面を戻す。
        settings = { ...settings, enabled: false };
        render();
        void save(settings, host.shadowRoot.querySelector('[role="status"]'));
      };
      header.append(title, disable);
      const articles = element("section");
      articles.append(element("h2", "自分の記事"));
      const profile = core.profileUrl(settings.noteUserId);
      if (profile) {
        articles.append(element("p", `登録ユーザー：${settings.noteUserId}`), link("公開プロフィールで自分の記事を見る", profile));
        articles.append(element("p", "v0.1.0では記事一覧を取得せず、公開プロフィールをご案内します。", "muted"));
      } else {
        articles.append(element("p", "下の設定でnoteユーザー名を登録してください。"));
      }
      // 投稿管理URLは未検証のため推測せず、公式ホーム上の操作へ案内。
      articles.append(element("p", "投稿・下書き管理・ログインは「通常のnoteを表示（OFF）」から、note公式画面で操作してください。", "muted"));
      const section = element("section");
      const form = element("form");
      const label = element("label", "noteユーザー名 または 公開プロフィールURL");
      label.htmlFor = "note-user";
      const input = element("input");
      input.id = "note-user";
      input.type = "text";
      input.value = settings.noteUserId;
      input.placeholder = "例：ruminar または https://note.com/ruminar";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 256;
      const row = element("div", "", "row");
      const submit = element("button", "ユーザー設定を保存");
      submit.type = "submit";
      row.append(submit);
      form.append(label, input, element("p", "空欄で保存すると登録を解除します。ブラウザ内にのみ保存します。", "muted"), row, status);
      form.onsubmit = event => {
        event.preventDefault();
        try { void save({ ...settings, noteUserId: core.normalizeUserId(input.value) }, status); }
        catch (error) { status.textContent = error.message; input.focus(); }
      };
      section.append(element("h2", "ユーザー設定"), form);
      main.append(header, articles, section, element("footer", "非公式拡張 · v0.1.0 · note株式会社とは関係ありません。"));
      wrapper.append(main);
      shadow.append(wrapper);
    }
    restore();
    host = newHost;
    document.documentElement.append(host);
    if (settings.enabled) document.documentElement.setAttribute(marker, "active");
  }
  function sync(force = false) {
    if (stopped || !settings) return;
    try {
      if (!platform.isAvailable()) { stop(); return; }
      if (!core.isHome(location.href)) { restore(); return; }
      if (force === true || !host?.isConnected) render();
    } catch (error) { stop(error); }
  }
  async function start() {
    try {
      unsubscribe = platform.subscribe(value => {
        revision++;
        settings = core.readSettings(value);
        sync(true);
      });
      const before = revision;
      const stored = await platform.load();
      if (revision === before) settings = core.readSettings(stored);
      sync();
      if (stopped) return;
      // isolated worldからページ側historyを書き換えず、SPAの往復を検知。
      interval = setInterval(sync, 250);
      window.addEventListener("popstate", sync);
      window.addEventListener("hashchange", sync);
      window.addEventListener("pageshow", sync);
      window.navigation?.addEventListener("currententrychange", sync);
    } catch (error) { stop(error); }
  }
  void start();
})();
