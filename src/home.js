(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const platform = globalThis.HikikomoriNotePlatform;
  const byId = id => document.getElementById(id);
  const views = ["tags", "settings", "authors", "transfer"];
  const fields = { hidePaidArticles: "hide-paid-articles", noteUserId: "note-user", dashboardDisabled: "dashboard-disabled", hideArticleRecommendations: "hide-article-recommendations", noteLogoBrowserBack: "note-logo-browser-back", legacyMode: "legacy-mode" };
  const drafts = new Map();
  function draft(id) { if (!drafts.has(id)) drafts.set(id, { tag: "", name: "", nameDirty: false, expectedName: "" }); return drafts.get(id); }
  const dirty = new Set();
  let copying = false, validatedText, parsedImport;
  function transferControls() {
    const text = byId("settings-json").value;
    if (text !== validatedText) {
      validatedText = text; parsedImport = undefined;
      let message = "設定JSONを入力してください。";
      if (text.trim()) {
        try {
          parsedImport = core.parseSettingsExport(text);
          message = `読み込み可能です。4グループ・タグ${parsedImport.tagGroups.reduce((total, group) => total + group.tags.length, 0)}件。`;
        } catch (error) { message = error.message; }
      }
      byId("transfer-validation").textContent = message;
    }
    let healthy = false;
    try { if (state) { core.settingsToken(state); healthy = true; } } catch { /* 不正な保存値を正常な書き出しとして扱わない。 */ }
    const blocked = !healthy || busy || uncertain || copying;
    byId("export-settings").disabled = blocked;
    byId("import-settings").disabled = blocked || !parsedImport;
    byId("copy-settings").disabled = busy || copying || !text.trim();
    byId("clear-settings-json").disabled = busy || copying || !text.length;
    byId("settings-json").disabled = busy && ["import", "export"].includes(pendingState);
  }
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
    for (const id of Object.values(fields)) byId(id).disabled = !state || uncertain || (busy && ["settings", "import"].includes(pendingState));
    byId("tag-input").disabled = !state || uncertain || state.legacyMode || Boolean(state.tagWarning) || (busy && pendingState === "import");
    byId("add-tag").disabled = tagBlocked;
    byId("group-name").disabled = !state || uncertain || state.legacyMode || Boolean(state.tagWarning) || (busy && pendingState === "import");
    byId("save-group-name").disabled = tagBlocked;
    for (const id of ["edit-groups"]) byId(id).querySelectorAll("button").forEach(button => { button.disabled = blocked || state?.legacyMode || Boolean(state?.tagWarning); });
    byId("edit-tags").querySelectorAll("button").forEach(button => { button.disabled = tagBlocked || button.dataset.edge === "true"; });
    for (const row of byId("edit-tags").children) row.draggable = !tagBlocked;
    byId("edit-tags").querySelectorAll("select").forEach(select => { select.disabled = tagBlocked; });
    byId("retry").disabled = busy;
    byId("nav-transfer").disabled = !state;
    byId("nav-authors").disabled = !state;
    const authorBlocked = blocked || !state?.noteUserId || Boolean(state?.authorWarning);
    for (const id of ["author-user", "author-name", "author-action", "author-add"]) byId(id).disabled = authorBlocked;
    for (const id of ["authors-hidden", "authors-allowed"]) for (const button of byId(id).querySelectorAll("button")) {
      button.disabled = blocked || Boolean(state?.authorWarning) || (button.dataset.remove !== "true" && (authorBlocked || button.dataset.self === "true"));
    }
    byId("edit-tags").setAttribute("aria-busy", String(busy));
    transferControls();
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
  function authorOperation(rule, action) {
    return { userId: rule.userId, displayName: rule.displayName, action,
      expectedAction: core.authorRule(state, rule.userId)?.action ?? null,
      expectedRevision: state.authorDisplayRevision, expectedSelf: state.noteUserId };
  }
  function renderAuthors() {
    byId("authors-state").textContent = state.authorWarning || (!state.noteUserId
      ? "自分を対象外にするため、設定で自分のnoteユーザー名を登録してください。登録の解除は可能です。"
      : `一覧への適用：${state.enabled ? "有効" : "拡張OFFのため停止"}。有料記事検出時の確認：${state.enabled && state.hidePaidArticles ? "有効" : "停止"}。手動管理はいつでも可能です。`);
    for (const [id, action] of [["authors-hidden", "hide"], ["authors-allowed", "allow"]]) {
      const list = byId(id); list.replaceChildren();
      const rules = core.sortAuthors(state.authorDisplayRules.filter(rule => rule.action === action));
      byId(`${id}-heading`).textContent = `${action === "hide" ? "非表示" : "表示を許可"}（${rules.length}件）`;
      for (const rule of rules) {
        const row = document.createElement("li"); row.className = "author-row";
        const link = document.createElement("a"); link.href = core.profileUrl(rule.userId); link.textContent = core.authorLabel(rule); row.append(link);
        const self = core.isSelf(state, rule.userId);
        if (self) { const note = document.createElement("span"); note.textContent = "自分のため対象外"; row.append(note); }
        for (const [label, next] of [[action === "hide" ? "表示を許可" : "非表示", action === "hide" ? "allow" : "hide"], ["登録を解除", null]]) {
          const button = document.createElement("button"); button.type = "button"; button.className = "secondary"; button.textContent = label;
          button.dataset.remove = String(next === null); button.dataset.self = String(self);
          button.setAttribute("aria-label", `${core.authorLabel(rule)}：${label}`);
          const operation = authorOperation(rule, next);
          button.onclick = () => { void perform(() => platform.author(operation), { kind: "author" }); }; row.append(button);
        }
        list.append(row);
      }
      if (!rules.length) { const empty = document.createElement("li"); empty.textContent = "登録はありません。"; list.append(empty); }
    }
  }
  function show(value) {
    const firstLoad = !state;
    const previous = state?.selectedTagGroupId;
    if (previous) draft(previous).tag = byId("tag-input").value;
    state = core.readSettings(value);
    // 背景処理が正常項目と一緒に返した診断を、再正規化で消さない。
    if (typeof value?.tagWarning === "string" && value.tagWarning) state.tagWarning = value.tagWarning;
    if (value?.groupSelectionInvalid) state.groupSelectionInvalid = true;
    if (value?.authorWarning) state.authorWarning = value.authorWarning;
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
    else { byId("profile").setAttribute("href", "#settings"); byId("profile").removeAttribute("aria-disabled"); }
    byId("mode").textContent = state.enabled
      ? `拡張ON：通常ホームを専用ホームへ転送します。 ${state.legacyMode ? "重度ひきこもりモード" : "通常モード（ひとみしりモード）"}`
      : "拡張OFF：通常のnoteを利用できます。拡張アイコンからONへ戻せます。";
    const warning = state.tagWarning || (state.groupSelectionInvalid ? "保存済みの選択に異常があります。グループを選び直してください。" : "");
    byId("tag-warning").hidden = !warning; byId("tag-warning").textContent = warning;
    selectView(selected, hiddenFocus);
    renderTags(); renderAuthors(); controls();
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
      if (options.kind === "settings" || options.kind === "import") dirty.clear();
      if (options.kind === "import") {
        drafts.clear(); dragTag = null; byId("tag-input").value = "";
        byId("author-user").value = ""; byId("author-name").value = "";
      }
      if (options.addInput !== undefined) {
        const savedDraft = draft(options.groupId);
        if (state.selectedTagGroupId === options.groupId && byId("tag-input").value === options.addInput) byId("tag-input").value = "";
        if (savedDraft.tag === options.addInput) savedDraft.tag = "";
      }
      if (options.rename && draft(options.rename.groupId).name === options.rename.name) draft(options.rename.groupId).nameDirty = false;
      show(before === revision ? result : state);
      byId("status").textContent = "保存しました。";
      if (options.kind === "import") byId("transfer-status").textContent = "設定を読み込みました。各画面へ反映しました。";
      if (options.off) location.assign("https://note.com/");
      if (options.focusTagInput && !state.legacyMode) byId("tag-input").focus();
      if (options.focusGroup) byId(options.focusGroup[0]).querySelector(`[data-group-id="${options.focusGroup[1]}"]`)?.focus();
    } catch (error) {
      uncertain = error.code === "UNCONFIRMED";
      byId("status").textContent = `処理できませんでした。${error.message}`;
      if (options.kind === "import") byId("transfer-status").textContent = `読み込みを完了できませんでした。${error.message}`;
      if (uncertain) selectView("settings", true);
      if (["CONFLICT", "LEGACY_MODE", "INVALID_TAGS", "INVALID_AUTHORS"].includes(error.code)) {
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
    const visible = !state ? ["settings"] : state.legacyMode ? ["settings", "authors", "transfer"] : views;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = visible.indexOf(selected);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visible.length - 1;
    else index = (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
    selectView(visible[index], true);
  };
  byId("previous-page").onclick = () => platform.goBackUnrestricted();
  byId("profile").onclick = event => {
    if (state?.noteUserId) return;
    event.preventDefault();
    selectView("settings");
    byId(byId("note-user").disabled ? "nav-settings" : "note-user").focus();
  };
  byId("normal").onclick = () => { void perform(() => platform.save({ enabled: false }), { off: true }); };
  byId("retry").onclick = () => { void refresh(); };
  byId("author-form").onsubmit = event => {
    event.preventDefault();
    if (byId("author-add").disabled) return;
    try {
      const userId = core.authorId(byId("author-user").value), displayName = core.authorName(byId("author-name").value);
      if (core.isSelf(state, userId)) throw new Error("自分は登録できません。");
      const operation = authorOperation({ userId, displayName }, byId("author-action").value);
      void perform(() => platform.author(operation), { kind: "author" });
    } catch (error) { byId("status").textContent = error.message; }
  };
  byId("settings-json").oninput = () => { byId("transfer-status").textContent = ""; transferControls(); };
  byId("clear-settings-json").onclick = () => {
    if (byId("clear-settings-json").disabled) return;
    byId("settings-json").value = "";
    byId("transfer-status").textContent = "";
    transferControls();
    byId("settings-json").focus();
  };
  byId("export-settings").onclick = async () => {
    if (byId("export-settings").disabled) return;
    if (byId("settings-json").value && !confirm("テキストエリアの内容を、保存済み設定のJSONで置き換えますか？")) return;
    busy = true; pendingState = "export"; controls();
    const before = revision;
    try {
      const saved = await platform.getState();
      if (before === revision) show(saved);
      const json = core.exportSettings(before === revision ? saved : state);
      core.parseSettingsExport(json);
      byId("settings-json").value = json;
      byId("transfer-status").textContent = "JSONを表示しました。「コピー」またはテキストの選択でコピーして保存してください。";
    } catch (error) { byId("transfer-status").textContent = `書き出せませんでした。${error.message}`; }
    finally { busy = false; pendingState = false; controls(); }
  };
  byId("copy-settings").onclick = async () => {
    if (byId("copy-settings").disabled) return;
    copying = true; transferControls();
    try {
      await navigator.clipboard.writeText(byId("settings-json").value);
      byId("transfer-status").textContent = "設定をクリップボードにコピーしました。移行先の「設定の移行」に貼り付けるか、テキストファイルやnoteの下書きなどに保存してください。";
    } catch { byId("transfer-status").textContent = "コピーできませんでした。テキストエリアから手動でコピーしてください。"; }
    finally { copying = false; transferControls(); }
  };
  byId("import-settings").onclick = () => {
    transferControls();
    if (byId("import-settings").disabled) return;
    const json = byId("settings-json").value, expectedToken = core.settingsToken(state);
    const oldFormat = JSON.parse(json).schemaVersion === 1 ? " このJSONには作者の表示設定がなく、現在の作者設定も解除されます。" : "";
    if (!confirm(`現在の設定とお気に入りタグ・作者の表示設定をすべて置き換えます。未保存の入力も破棄します。${oldFormat}読み込みますか？`)) return;
    void perform(() => platform.importSettings({ json, expectedToken }), { kind: "import" });
  };
  platform.subscribe(value => { revision++; show(value); });
  void refresh();
})();
