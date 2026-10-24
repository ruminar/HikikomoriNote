(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const byId = id => document.getElementById(id);
  const tabs = ["main", "tags", "settings"];
  const fields = { noteUserId: "note-user", dashboardDisabled: "dashboard-disabled", hideArticleRecommendations: "hide-article-recommendations", legacyMode: "legacy-mode" };
  const dirty = new Set();
  let state, selected = "main", busy = false, uncertain = false, pendingState = false, dragTag = null, revision = 0;
  function selectTab(name, focus = false) {
    if (!state && name !== "settings") return;
    selected = state?.legacyMode ? "settings" : name;
    for (const tab of tabs) {
      byId(`tab-${tab}`).setAttribute("aria-selected", String(tab === selected));
      byId(`tab-${tab}`).tabIndex = tab === selected ? 0 : -1;
      byId(`panel-${tab}`).hidden = tab !== selected;
    }
    if (focus) byId(`tab-${selected}`).focus();
  }
  function controls() {
    const blocked = !state || busy || uncertain;
    const tagBlocked = blocked || state?.legacyMode || Boolean(state?.tagWarning);
    for (const id of ["normal", "save"]) byId(id).disabled = blocked;
    for (const id of Object.values(fields)) byId(id).disabled = !state || uncertain || (busy && pendingState === "settings");
    byId("tag-input").disabled = !state || uncertain || state.legacyMode || Boolean(state.tagWarning);
    byId("add-tag").disabled = tagBlocked;
    byId("edit-tags").querySelectorAll("button").forEach(button => { button.disabled = tagBlocked || button.dataset.edge === "true"; });
    for (const row of byId("edit-tags").children) row.draggable = !tagBlocked;
    byId("retry").disabled = busy;
    byId("edit-tags").setAttribute("aria-busy", String(busy));
  }
  function link(tag) {
    const a = document.createElement("a"); a.textContent = `# ${tag}`; a.href = core.tagUrl(tag); return a;
  }
  function renderTags() {
    const main = byId("main-tags"), editor = byId("edit-tags");
    main.replaceChildren(); editor.replaceChildren();
    if (state.legacyMode) return;
    const tags = state.favoriteTags;
    byId("tags-empty").hidden = tags.length !== 0;
    tags.forEach((tag, index) => {
      const item = document.createElement("li"); item.append(link(tag)); main.append(item);
      const row = document.createElement("li"); row.className = "tag-row"; row.draggable = true;
      const name = document.createElement("span"); name.textContent = `# ${tag}`; name.className = "tag-name"; row.append(name);
      function action(text, label, operation, edge = false) {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary";
        button.textContent = text; button.setAttribute("aria-label", `${tag}：${label}`); button.dataset.edge = String(edge);
        button.onclick = () => { void mutateTag(operation, { focusTagInput: true }); }; row.append(button);
      }
      action("↑", "上へ移動", { type: "MOVE_TAG", tag, beforeTag: tags[index - 1] ?? null }, index === 0);
      action("↓", "下へ移動", { type: "MOVE_TAG", tag, beforeTag: tags[index + 2] ?? null }, index === tags.length - 1);
      action("削除", "削除", { type: "REMOVE_TAG", tag });
      row.ondragstart = event => {
        if (busy || uncertain || state.legacyMode || state.tagWarning) { event.preventDefault(); return; }
        dragTag = tag; event.dataTransfer.setData("text/plain", tag); event.dataTransfer.effectAllowed = "move";
      };
      row.ondragover = event => { if (dragTag && !busy && !uncertain) event.preventDefault(); };
      row.ondrop = event => {
        if (!dragTag || busy || uncertain) return;
        event.preventDefault(); event.stopPropagation(); const source = dragTag; dragTag = null;
        const rect = row.getBoundingClientRect();
        const beforeTag = Number.isFinite(event.clientY) && event.clientY > rect.top + rect.height / 2
          ? tags[index + 1] ?? null : tag;
        void mutateTag({ type: "MOVE_TAG", tag: source, beforeTag }, { focusTagInput: true });
      };
      row.ondragend = () => { dragTag = null; };
      editor.append(row);
    });
  }
  function show(value) {
    state = core.readSettings(value);
    // 背景処理が正常項目と一緒に返した診断を、再正規化で消さない。
    if (typeof value?.tagWarning === "string" && value.tagWarning) state.tagWarning = value.tagWarning;
    const active = document.activeElement;
    const hiddenFocus = state.legacyMode && ["main", "tags"].some(tab =>
      byId(`panel-${tab}`).contains(active) || active === byId(`tab-${tab}`));
    for (const [field, id] of Object.entries(fields)) {
      if (dirty.has(field)) continue;
      if (field === "noteUserId") byId(id).value = state[field];
      else byId(id).checked = state[field];
    }
    byId("tabs").hidden = false;
    for (const tab of ["main", "tags"]) byId(`tab-${tab}`).hidden = state.legacyMode;
    byId("legacy-intro").hidden = !state.legacyMode;
    byId(state.legacyMode ? "legacy-quick-slot" : "quick-slot").append(byId("quick-access"));
    byId("quick-access").hidden = false;
    byId("following").hidden = state.legacyMode;
    const profile = core.profileUrl(state.noteUserId);
    byId("profile").hidden = !profile;
    byId("profile").textContent = profile ? `${state.noteUserId}のページ` : "自分のページ";
    if (profile) byId("profile").href = profile; else byId("profile").removeAttribute("href");
    byId("setup-user").hidden = Boolean(profile);
    byId("mode").textContent = `${state.enabled ? "拡張ON：通常ホームを専用ホームへ転送します。" : "拡張OFF：通常のnoteを利用できます。拡張アイコンからONへ戻せます。"} ${state.legacyMode ? "0.1.1モード（重度引きこもりモード）" : "通常モード"}`;
    byId("tag-warning").hidden = !state.tagWarning; byId("tag-warning").textContent = state.tagWarning ?? "";
    selectTab(selected, hiddenFocus);
    renderTags(); controls();
  }
  async function refresh() {
    if (busy) return;
    busy = true; controls();
    const before = revision;
    byId("status").textContent = "設定と転送状態を確認しています…";
    try {
      const value = await platform.getState(); uncertain = false; if (before === revision) show(value);
      byId("status").textContent = location.hash === "#activation-failed" && !state.enabled
        ? "ONへの切り替えに失敗しました。拡張アイコンを押して再度お試しください。" : "設定と転送状態を確認しました。";
    } catch (error) {
      uncertain = true; byId("status").textContent = `確認できませんでした。${error.message} 設定タブの「状態を再確認」で再試行できます。`;
      if (!state) {
        byId("tabs").hidden = false;
        for (const tab of ["main", "tags"]) byId(`tab-${tab}`).hidden = true;
      }
      selectTab("settings");
    }
    finally { busy = false; controls(); }
  }
  async function perform(task, options = {}) {
    if (busy || uncertain || !state) return;
    busy = true; pendingState = options.kind ?? "tag"; controls();
    const before = revision;
    byId("status").textContent = "保存しています…";
    try {
      const result = await task();
      if (options.kind === "settings") dirty.clear();
      if (options.addInput !== undefined && byId("tag-input").value === options.addInput) byId("tag-input").value = "";
      show(before === revision ? result : state);
      byId("status").textContent = "保存しました。";
      if (options.off) location.assign("https://note.com/");
      if (options.focusTagInput && !state.legacyMode) byId("tag-input").focus();
    } catch (error) {
      uncertain = error.code === "UNCONFIRMED";
      byId("status").textContent = `処理できませんでした。${error.message}`;
      if (uncertain) selectTab("settings", true);
      if (["CONFLICT", "LEGACY_MODE", "INVALID_TAGS"].includes(error.code)) {
        try { show(await platform.getState()); } catch { uncertain = true; }
      }
    } finally { busy = false; pendingState = false; controls(); }
  }
  function mutateTag(operation, options) { return perform(() => platform.tag(operation), options); }
  for (const [field, id] of Object.entries(fields)) {
    byId(id).addEventListener(field === "noteUserId" ? "input" : "change", () => dirty.add(field));
  }
  byId("settings").onsubmit = event => {
    event.preventDefault();
    const patch = {};
    for (const field of dirty) patch[field] = field === "noteUserId" ? byId(fields[field]).value : byId(fields[field]).checked;
    try { if (Object.hasOwn(patch, "noteUserId")) patch.noteUserId = core.normalizeUserId(patch.noteUserId); }
    catch (error) { byId("status").textContent = error.message; byId("note-user").focus(); return; }
    void perform(() => platform.save(patch), { kind: "settings" });
  };
  byId("tag-form").onsubmit = event => {
    event.preventDefault(); const input = byId("tag-input").value;
    try { void mutateTag({ type: "ADD_TAG", tag: core.normalizeTag(input) }, { addInput: input }); }
    catch (error) { byId("status").textContent = error.message; }
  };
  byId("edit-tags").ondragover = event => { if (dragTag && !busy && !uncertain) event.preventDefault(); };
  byId("edit-tags").ondrop = event => {
    if (!dragTag || busy || uncertain) return;
    event.preventDefault(); const tag = dragTag; dragTag = null;
    void mutateTag({ type: "MOVE_TAG", tag, beforeTag: null }, { focusTagInput: true });
  };
  for (const name of tabs) byId(`tab-${name}`).onclick = () => selectTab(name);
  byId("tabs").onkeydown = event => {
    const visible = state?.legacyMode ? ["settings"] : tabs;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = visible.indexOf(selected);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visible.length - 1;
    else index = (index + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length;
    selectTab(visible[index], true);
  };
  byId("setup-user").onclick = () => { selectTab("settings"); byId("note-user").focus(); };
  byId("normal").onclick = () => { void perform(() => platform.save({ enabled: false }), { off: true }); };
  byId("retry").onclick = () => { void refresh(); };
  platform.subscribe(value => { revision++; show(value); });
  void refresh();
})();
