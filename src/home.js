(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const byId = id => document.getElementById(id);
  const views = ["tags", "settings"];
  const fields = { hidePaidArticles: "hide-paid-articles", noteUserId: "note-user", dashboardDisabled: "dashboard-disabled", hideArticleRecommendations: "hide-article-recommendations", noteLogoBrowserBack: "note-logo-browser-back", legacyMode: "legacy-mode" };
  const drafts = new Map();
  function draft(id) { if (!drafts.has(id)) drafts.set(id, { tag: "", name: "", nameDirty: false, expectedName: "" }); return drafts.get(id); }
  const dirty = new Set();
  let state, selected = location.hash === "#settings" ? "settings" : "tags", busy = false, uncertain = false, pendingState = false, dragTag = null, revision = 0;
  function selectView(name, focus = false) {
    if (!state && name !== "settings") return;
    selected = state?.legacyMode && name === "tags" ? "intro" : name;
    for (const view of views) {
      const button = byId(`nav-${view}`);
      if (view === selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      byId(`panel-${view}`).hidden = view !== selected;
    }
    byId("panel-intro").hidden = !state?.legacyMode;
    if (focus) byId(`nav-${selected === "intro" ? "settings" : selected}`).focus();
  }
  function controls() {
    const blocked = !state || busy || uncertain;
    const tagBlocked = blocked || state?.legacyMode || Boolean(state?.tagWarning) || Boolean(state?.groupSelectionInvalid);
    for (const id of ["normal", "save"]) byId(id).disabled = blocked;
    for (const id of Object.values(fields)) byId(id).disabled = !state || uncertain || (busy && pendingState === "settings");
    byId("tag-input").disabled = !state || uncertain || state.legacyMode || Boolean(state.tagWarning);
    byId("add-tag").disabled = tagBlocked;
    byId("group-name").disabled = !state || uncertain || state.legacyMode || Boolean(state.tagWarning);
    byId("save-group-name").disabled = tagBlocked;
    for (const id of ["edit-groups"]) byId(id).querySelectorAll("button").forEach(button => { button.disabled = blocked || state?.legacyMode || Boolean(state?.tagWarning); });
    byId("edit-tags").querySelectorAll("button").forEach(button => { button.disabled = tagBlocked || button.dataset.edge === "true"; });
    for (const row of byId("edit-tags").children) row.draggable = !tagBlocked;
    byId("edit-tags").querySelectorAll("select").forEach(select => { select.disabled = tagBlocked; });
    byId("retry").disabled = busy;
    byId("edit-tags").setAttribute("aria-busy", String(busy));
  }
  function renderTags() {
    const editor = byId("edit-tags");
    editor.replaceChildren();
    if (state.legacyMode) { byId("edit-groups").replaceChildren(); return; }
    const group = core.selectedGroup(state), tags = group.tags;
    for (const id of ["edit-groups"]) {
      const container = byId(id), focused = container.contains(document.activeElement) ? document.activeElement?.getAttribute("data-group-id") : null;
      container.replaceChildren(); container.setAttribute("role", "group"); container.setAttribute("aria-label", "お気に入りタグのグループ");
      state.tagGroups.forEach((item, index) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = ["①", "②", "③", "④"][index];
        button.setAttribute("data-group-id", item.id); button.setAttribute("aria-label", `${button.textContent} ${core.groupName(item)}`);
        button.setAttribute("aria-pressed", String(item.id === group.id)); button.setAttribute("title", core.groupName(item));
        button.onclick = () => { void perform(() => platform.tag({ type: "SELECT_TAG_GROUP", groupId: item.id }), { focusGroup: [id, item.id] }); };
        container.append(button);
      });
      const name = document.createElement("span"); name.textContent = core.groupName(group); name.setAttribute("title", name.textContent); container.append(name);
      if (focused) container.querySelector(`[data-group-id="${focused}"]`)?.focus();
    }
    byId("tags-empty").hidden = tags.length !== 0;
    tags.forEach((tag, index) => {
      const row = document.createElement("li"); row.className = "tag-row"; row.draggable = true;
      const name = document.createElement("span"); name.textContent = `# ${tag}`; name.className = "tag-name"; row.append(name);
      function action(text, label, operation, edge = false) {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary";
        button.textContent = text; button.setAttribute("aria-label", `${tag}：${label}`); button.dataset.edge = String(edge);
        button.onclick = () => { void mutateTag({ ...operation, groupId: group.id }, { focusTagInput: true }); }; row.append(button);
      }
      action("↑", "上へ移動", { type: "MOVE_TAG", tag, beforeTag: tags[index - 1] ?? null }, index === 0);
      action("↓", "下へ移動", { type: "MOVE_TAG", tag, beforeTag: tags[index + 2] ?? null }, index === tags.length - 1);
      action("削除", "削除", { type: "REMOVE_TAG", tag });
      const destination = document.createElement("select"); destination.setAttribute("aria-label", `${tag}の移動先`);
      for (const item of state.tagGroups.filter(item => item.id !== group.id)) {
        const option = document.createElement("option"); option.value = item.id; option.textContent = `${core.groupIds.indexOf(item.id) + 1} ${core.groupName(item)}`; destination.append(option);
      }
      destination.value = state.tagGroups.find(item => item.id !== group.id).id; row.append(destination);
      const transfer = document.createElement("button"); transfer.type = "button"; transfer.textContent = "移動";
      transfer.setAttribute("aria-label", `${tag}を別グループへ移動`);
      transfer.onclick = () => { void mutateTag({ type: "TRANSFER_TAG", groupId: group.id, targetGroupId: destination.value, tag }); }; row.append(transfer);
      row.ondragstart = event => {
        if (busy || uncertain || state.legacyMode || state.tagWarning) { event.preventDefault(); return; }
        dragTag = { tag, groupId: group.id }; event.dataTransfer.setData("text/plain", tag); event.dataTransfer.effectAllowed = "move";
      };
      row.ondragover = event => { if (dragTag && !busy && !uncertain) event.preventDefault(); };
      row.ondrop = event => {
        if (!dragTag || busy || uncertain) return;
        event.preventDefault(); event.stopPropagation(); const source = dragTag; dragTag = null;
        const rect = row.getBoundingClientRect();
        const beforeTag = Number.isFinite(event.clientY) && event.clientY > rect.top + rect.height / 2
          ? tags[index + 1] ?? null : tag;
        if (source.groupId !== state.selectedTagGroupId) return;
        void mutateTag({ type: "MOVE_TAG", groupId: source.groupId, tag: source.tag, beforeTag }, { focusTagInput: true });
      };
      row.ondragend = () => { dragTag = null; };
      editor.append(row);
    });
  }
  function show(value) {
    const firstLoad = !state;
    const previous = state?.selectedTagGroupId;
    if (previous) draft(previous).tag = byId("tag-input").value;
    state = core.readSettings(value);
    // 背景処理が正常項目と一緒に返した診断を、再正規化で消さない。
    if (typeof value?.tagWarning === "string" && value.tagWarning) state.tagWarning = value.tagWarning;
    if (value?.groupSelectionInvalid) state.groupSelectionInvalid = true;
    const group = core.selectedGroup(state), currentDraft = draft(group.id);
    if (previous !== group.id) { byId("tag-input").value = currentDraft.tag; dragTag = null; }
    byId("group-name").value = currentDraft.nameDirty ? currentDraft.name : group.name;
    byId("group-name-form").hidden = state.legacyMode;
    const active = document.activeElement;
    const hiddenFocus = state.legacyMode &&
      (byId("panel-tags").contains(active) || active === byId("nav-tags") || active === byId("following"));
    if (state.legacyMode && ((firstLoad && location.hash !== "#settings") || selected === "tags")) selected = "intro";
    if (!state.legacyMode && selected === "intro") selected = "tags";
    for (const [field, id] of Object.entries(fields)) {
      if (dirty.has(field)) continue;
      if (field === "noteUserId") byId(id).value = state[field];
      else byId(id).checked = state[field];
    }
    byId("home-menu").hidden = false;
    byId("nav-tags").hidden = state.legacyMode;
    byId("page-links").hidden = false;
    byId("following").hidden = state.legacyMode;
    const profile = core.profileUrl(state.noteUserId);
    byId("profile").textContent = profile ? `${state.noteUserId}のページ` : "自分のページ（未設定）";
    if (profile) { byId("profile").href = profile; byId("profile").removeAttribute("aria-disabled"); }
    else { byId("profile").removeAttribute("href"); byId("profile").setAttribute("aria-disabled", "true"); }
    byId("mode").textContent = state.enabled
      ? `拡張ON：通常ホームを専用ホームへ転送します。 ${state.legacyMode ? "重度ひきこもりモード" : "通常モード（ひとみしりモード）"}`
      : "拡張OFF：通常のnoteを利用できます。拡張アイコンからONへ戻せます。";
    const warning = state.tagWarning || (state.groupSelectionInvalid ? "保存済みの選択に異常があります。グループを選び直してください。" : "");
    byId("tag-warning").hidden = !warning; byId("tag-warning").textContent = warning;
    selectView(selected, hiddenFocus);
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
      uncertain = true; byId("status").textContent = `確認できませんでした。${error.message} 「設定」の「状態を再確認」で再試行できます。`;
      if (!state) {
        byId("home-menu").hidden = false;
        byId("nav-tags").hidden = true;
        byId("page-links").hidden = true;
      }
      selectView("settings");
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
      if (options.addInput !== undefined) {
        const savedDraft = draft(options.groupId);
        if (state.selectedTagGroupId === options.groupId && byId("tag-input").value === options.addInput) byId("tag-input").value = "";
        if (savedDraft.tag === options.addInput) savedDraft.tag = "";
      }
      if (options.rename && draft(options.rename.groupId).name === options.rename.name) draft(options.rename.groupId).nameDirty = false;
      show(before === revision ? result : state);
      byId("status").textContent = "保存しました。";
      if (options.off) location.assign("https://note.com/");
      if (options.focusTagInput && !state.legacyMode) byId("tag-input").focus();
      if (options.focusGroup) byId(options.focusGroup[0]).querySelector(`[data-group-id="${options.focusGroup[1]}"]`)?.focus();
    } catch (error) {
      uncertain = error.code === "UNCONFIRMED";
      byId("status").textContent = `処理できませんでした。${error.message}`;
      if (uncertain) selectView("settings", true);
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
    const groupId = state?.selectedTagGroupId;
    try { void mutateTag({ type: "ADD_TAG", groupId, tag: core.normalizeTag(input) }, { addInput: input, groupId }); }
    catch (error) { byId("status").textContent = error.message; }
  };
  byId("edit-tags").ondragover = event => { if (dragTag && !busy && !uncertain) event.preventDefault(); };
  byId("edit-tags").ondrop = event => {
    if (!dragTag || busy || uncertain) return;
    event.preventDefault(); const tag = dragTag; dragTag = null;
    if (tag.groupId !== state.selectedTagGroupId) return;
    void mutateTag({ type: "MOVE_TAG", groupId: tag.groupId, tag: tag.tag, beforeTag: null }, { focusTagInput: true });
  };
  byId("group-name").addEventListener("input", () => {
    const group = core.selectedGroup(state), value = draft(group.id);
    if (!value.nameDirty) value.expectedName = group.name;
    value.nameDirty = true; value.name = byId("group-name").value;
  });
  byId("group-name-form").onsubmit = event => {
    event.preventDefault(); const group = core.selectedGroup(state), value = draft(group.id);
    void perform(() => platform.tag({ type: "RENAME_TAG_GROUP", groupId: group.id, name: byId("group-name").value, expectedName: value.nameDirty ? value.expectedName : group.name }), { rename: { groupId: group.id, name: value.name } });
  };
  for (const name of views) byId(`nav-${name}`).onclick = () => selectView(name);
  byId("home-menu").onkeydown = event => {
    const visible = state?.legacyMode || !state ? ["settings"] : views;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = visible.indexOf(selected);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visible.length - 1;
    else index = (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
    selectView(visible[index], true);
  };
  byId("previous-page").onclick = () => platform.goBackUnrestricted();
  byId("normal").onclick = () => { void perform(() => platform.save({ enabled: false }), { off: true }); };
  byId("retry").onclick = () => { void refresh(); };
  platform.subscribe(value => { revision++; show(value); });
  void refresh();
})();
