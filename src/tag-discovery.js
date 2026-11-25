/* 入力元を保存先から分離する。外部AIへの通信・本文の保存は行わない。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const emptyMessage = "候補がありません。[#タグ名] または [@ユーザーID] の形式で入力してください。";
  const inputLimit = 1048576;
  function extract(text) {
    if (typeof text !== "string" || text.length > inputLimit) throw new Error("提案文は1,048,576文字以内で入力してください。");
    // URL・コード・Markdownリンク先は候補ではない。見出しの # + 空白も拾わない。
    const mask = value => " ".repeat(value.length);
    const input = text.replace(/!?\[[^\]\n]*\]\([^\s)]*\)/g, mask)
      .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, mask);
    const matches = [], explicit = /\[(#|@)([^\]\r\n]+)\]/g;
    // AIがコード枠で列挙した明示形式も読める。通常のコード中の # は推測しない。
    for (const match of input.matchAll(explicit)) matches.push({ index: match.index, kind: match[1], raw: match[2].trim() });
    const prose = input.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, mask)
      .replace(/`[^`\n]*`/g, mask).replace(explicit, mask);
    const pattern = /(^|[\s\[（(「『【、。，,;；:：!?！？・])#([^\s#\[\]（）()「」『』【】、。，,;；:：!?！？<>`"'。]+)/gmu;
    for (const match of prose.matchAll(pattern)) matches.push({ index: match.index, raw: match[2] });
    const items = matches.sort((a, b) => a.index - b.index).flatMap(({ kind, raw }) => {
      if (kind === "@") return /^[a-zA-Z0-9_]+$/.test(raw) ? [{ type: "user", userId: raw, displayName: "" }] : [];
      const tag = raw.replace(/^[（(「『【]+|[）)」』】]+$/g, "").trim();
      return tag && !/^[#@&]/.test(tag) && !/[<>]/.test(tag) ? [tag] : [];
    });
    return core.bulkFavoriteCandidates(items);
  }
  function shareList(items, type) {
    const lines = [];
    let length = 0, skipped = 0;
    for (const item of items) {
      if ((typeof item === "string" ? "tag" : item.type) !== type) continue;
      const line = type === "tag" ? `[#${item}]` : `[@${item.userId}]`;
      const nextLength = length + line.length + (lines.length ? 1 : 0);
      // 貼り戻したときに別のタグとして読まれる表記をコピーしない。
      const parsed = type === "tag" && nextLength <= inputLimit ? extract(line) : null;
      if (nextLength > inputLimit || (parsed && (parsed.length !== 1 || parsed[0] !== item))) { skipped++; continue; }
      lines.push(line); length = nextLength;
    }
    return { text: lines.join("\n"), count: lines.length, skipped };
  }
  function prompt(settings) {
    const tags = core.normalizeTagCandidates(settings.tagGroups.flatMap(group => group.tags.filter(item => typeof item === "string")));
    return ["私はnoteで読む記事を探すため、お気に入りのハッシュタグを増やしたいです。",
      tags.length ? `現在登録しているタグ：${tags.map(tag => `[#${tag}]`).join(" ")}` : "興味・関心：［ここに自分の興味や読みたい内容を追記してください］",
      "既存のタグや私の興味を参考に、新しく興味を持てそうな閲覧用タグを提案してください。",
      "noteで実在するタグを優先し、各候補を [#タグ名] の形式で出力してください。",
      "既存のタグそのものを繰り返す必要はありません。理由や補足説明を添えても構いません。"].join("\n");
  }
  function articleTags(doc, url) {
    if (!core.isArticle(url)) throw new Error("noteの記事ページで実行してください。");
    const articles = [...doc.querySelectorAll('article[id="note-article"]')];
    if (articles.length !== 1) throw new Error("現在の記事を確認できません。");
    const article = articles[0], bodies = [...article.querySelectorAll('[id="note-body"]')];
    if (bodies.length !== 1 || bodies[0].closest('article') !== article) throw new Error("現在の記事本文を確認できません。");
    const address = core.articleAddress(url), keyed = bodies[0].closest('[data-note-key]');
    if (!keyed || !article.contains(keyed) || keyed.getAttribute("data-note-key") !== address.articleId) throw new Error("記事URLと表示内容が一致しません。");
    const canonicals = [...doc.querySelectorAll('link[rel="canonical"]')];
    if (canonicals.length && !canonicals.some(link => {
      try { return core.articleAddress(link.getAttribute("href")).articleId === core.articleAddress(url).articleId; } catch { return false; }
    })) throw new Error("記事URLと表示内容が一致しません。");
    const tags = [];
    const lists = [...article.querySelectorAll('ul[data-testid="hashtag-list"]')].filter(list =>
      list.closest('article') === article && !list.closest('[id="note-body"]') && !list.closest('[data-hikikomori-note-owned]') &&
      (list.parentElement?.getAttribute("id") === "hashtag-accordion" || list.parentElement?.getAttribute("data-testid") === "hashtag-mobile-view"));
    for (const list of lists) {
      for (const link of list.querySelectorAll('a[data-name="Tag"]')) {
        if (link.parentElement?.tagName !== "LI" || link.parentElement.parentElement !== list) continue;
        try {
          const parsed = new URL(link.getAttribute("href"), url), page = core.pageKind(parsed.href);
          if (parsed.username || parsed.password) continue;
          // 社会復帰note等が公式タグリンクを新着検索へ書き換えた場合も、
          // 専用タグ領域・単一の#検索・表示ラベルの一致をすべて確認する。
          const query = parsed.searchParams.get("q");
          const tag = page?.type === "tag" ? page.tag : page?.type === "search" &&
            parsed.searchParams.get("context") === "note" && parsed.searchParams.getAll("q").length === 1 &&
            query?.startsWith("#") ? query.slice(1) : null;
          if (!tag) continue;
          const label = link.textContent.trim();
          if (label !== `#${tag}` && label !== `# ${tag}`) continue;
          tags.push(tag);
        } catch { /* 不明なリンクは推測しない。 */ }
      }
    }
    return core.normalizeTagCandidates(tags);
  }
  function createDialog(doc, actions) {
    const dialog = doc.createElement("dialog");
    dialog.className = "hikikomori-note-tag-dialog"; dialog.hidden = true;
    dialog.setAttribute("data-hikikomori-note-owned", "");
    dialog.setAttribute("aria-label", "タグをまとめて登録");
    const title = doc.createElement("h2"); title.textContent = "タグをまとめて登録";
    const list = doc.createElement("div"); list.className = "hikikomori-note-tag-candidates";
    list.setAttribute("role", "group"); list.setAttribute("aria-label", "登録するタグ候補");
    const count = doc.createElement("p"), status = doc.createElement("p");
    count.setAttribute("aria-live", "polite"); status.setAttribute("role", "status");
    const tools = doc.createElement("div"); tools.className = "hikikomori-note-tag-tools";
    const all = doc.createElement("button"), none = doc.createElement("button"), save = doc.createElement("button"), close = doc.createElement("button"), refresh = doc.createElement("button");
    for (const button of [all, none, save, close, refresh]) button.type = "button";
    all.textContent = "すべてON"; none.textContent = "すべてOFF"; close.textContent = "閉じる"; refresh.textContent = "状態を再確認"; refresh.hidden = true;
    save.setAttribute("title", "CtrlまたはShift＋クリックで先頭に追加");
    tools.append(all, none, count);
    const label = doc.createElement("label"), select = doc.createElement("select");
    label.textContent = "登録先グループ"; select.setAttribute("aria-label", "タグの一括登録先グループ"); label.append(select);
    const controls = doc.createElement("div"); controls.className = "hikikomori-note-tag-tools"; controls.append(save, close, refresh);
    dialog.append(title, tools, label, controls, status, list);
    let state, selected = new Set(), candidates = [], busy = false, uncertain = false, opened = false, focusBefore, generation = 0, groupSignature;
    function update(value) {
      state = value;
      const groups = state ? core.availableGroups(state) : [];
      const signature = JSON.stringify(groups.map(group => [group.id, group.name]));
      if (signature !== groupSignature) {
        const previous = select.value; select.replaceChildren();
        for (const group of groups) {
          const option = doc.createElement("option"); option.value = group.id;
          option.textContent = `${core.groupSymbols[core.groupIds.indexOf(group.id)]} ${core.groupName(group)}`; select.append(option);
        }
        select.value = groups.some(group => group.id === previous) ? previous : groups[0]?.id || "";
        groupSignature = signature;
      }
      const blocked = busy || uncertain || !state || !core.usesTags(state) || Boolean(state.tagWarning) || Boolean(state.groupSelectionInvalid);
      const group = groups.find(group => group.id === select.value);
      const registered = new Set(group?.tags.map(core.favoriteKey) || []);
      candidates.forEach((item, index) => {
        const button = list.children[index];
        button.setAttribute("aria-pressed", String(selected.has(item))); button.disabled = blocked;
        button.setAttribute("title", registered.has(core.favoriteKey(item)) ? "登録済み（再登録はしません）" : button.textContent);
      });
      count.textContent = `${selected.size} / ${candidates.length}件選択`;
      save.textContent = `選択した${selected.size}件を登録`;
      save.disabled = blocked || !group || !selected.size;
      all.disabled = none.disabled = select.disabled = blocked;
      close.disabled = busy; refresh.disabled = busy;
      if (!core.usesTags(state)) status.textContent = "ひとみしりモードでお気に入りに登録できます。";
      else if (state?.tagWarning || state?.groupSelectionInvalid) status.textContent = state.tagWarning || "グループを選び直してください。";
    }
    function finish(force = false) {
      if (busy && !force) return;
      generation++; opened = false;
      if (typeof dialog.close === "function") dialog.close();
      dialog.removeAttribute("open"); dialog.hidden = true;
      if (focusBefore?.isConnected) focusBefore.focus();
    }
    close.onclick = () => finish();
    dialog.oncancel = event => { event.preventDefault(); finish(); };
    all.onclick = () => { if (all.disabled) return; selected = new Set(candidates); update(state); };
    none.onclick = () => { if (none.disabled) return; selected.clear(); update(state); };
    select.onchange = () => update(state);
    refresh.onclick = async () => {
      if (refresh.disabled || !actions.refresh) return;
      busy = true; update(state);
      try { const value = await actions.refresh(); uncertain = false; refresh.hidden = true; status.textContent = "保存状態を確認しました。"; update(value); }
      catch (error) { status.textContent = error.message || "状態を確認できません。"; }
      finally { busy = false; update(state); }
    };
    save.onclick = async event => {
      if (save.disabled || !opened) return;
      const position = core.favoriteClickPosition(event);
      const items = candidates.filter(item => selected.has(item)), groupId = select.value, before = generation;
      busy = true; status.textContent = "保存中…"; update(state);
      try {
        const result = await actions.save(groupId, items, position);
        actions.onSaved?.(result);
        if (before !== generation) return;
        const report = result.bulkTagReport;
        selected.clear();
        status.textContent = `${report.added}件追加・${report.duplicates}件登録済み・${report.skipped}件未登録。`;
        update(result);
      } catch (error) {
        if (before !== generation) return;
        uncertain = error.code === "UNCONFIRMED";
        refresh.hidden = !uncertain || !actions.refresh;
        status.textContent = error.message || "保存できませんでした。";
      } finally { busy = false; if (before === generation) update(state); }
    };
    return Object.freeze({
      open(items, value) {
        if (busy || !core.usesTags(value)) return false;
        const normalized = core.bulkFavoriteCandidates(items);
        if (!normalized.length) return false;
        candidates = normalized;
        const includesUsers = candidates.some(item => typeof item !== "string");
        title.textContent = includesUsers ? "タグ・ユーザーをまとめて登録" : "タグをまとめて登録";
        dialog.setAttribute("aria-label", title.textContent);
        list.setAttribute("aria-label", includesUsers ? "登録するタグ・ユーザー候補" : "登録するタグ候補");
        select.setAttribute("aria-label", includesUsers ? "タグ・ユーザーの一括登録先グループ" : "タグの一括登録先グループ");
        if (!dialog.isConnected) (doc.body || doc.root).append(dialog);
        generation++; selected.clear(); refresh.hidden = !uncertain || !actions.refresh; status.textContent = uncertain ? "保存結果を確認できません。状態を再確認してください。" : ""; groupSignature = undefined;
        list.replaceChildren();
        for (const item of candidates) {
          const button = doc.createElement("button"); button.type = "button";
          if (typeof item === "string") { button.textContent = `#${item}`; button.setAttribute("data-tag-candidate", item); }
          else { button.textContent = core.favoriteLabel(item); button.setAttribute("data-user-candidate", item.userId); }
          button.onclick = () => { if (button.disabled) return; if (selected.has(item)) selected.delete(item); else selected.add(item); update(state); }; list.append(button);
        }
        update(value);
        if (core.availableGroups(value).some(group => group.id === value.selectedTagGroupId)) select.value = value.selectedTagGroupId;
        update(value); focusBefore = doc.activeElement; opened = true; dialog.hidden = false;
        if (typeof dialog.showModal === "function") { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute("open", "");
        list.scrollTop = 0; dialog.scrollTop = 0;
        (all.disabled ? close : all).focus(); return true;
      },
      update(value) {
        if (!opened) return;
        if (!core.usesTags(value)) finish(true);
        else update(value);
      },
      close: () => finish(true),
      dispose() { finish(true); dialog.remove(); }
    });
  }
  globalThis.HikikomoriNoteTagDiscovery = Object.freeze({ extract, shareList, prompt, articleTags, createDialog, emptyMessage });
})();
