/* 確認済みのナビゲーション・関連商品・記事おすすめ枠を扱う。詳細はdocs/note-dom.md。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const owned = "data-hikikomori-note-owned";
  const hidden = "data-hikikomori-note-menu-hidden";
  const productHidden = "data-hikikomori-note-product-hidden";
  const recommendationsHidden = "data-hikikomori-note-recommendations-hidden";
  const tipHidden = "data-hikikomori-note-tip-hidden";
  const productCard = '[data-aicn-thing-card="true"], [data-testid="aicn-thing-card"]';
  const likeHidden = "data-hikikomori-note-like-hidden";
  const likeCss = `[${likeHidden}] { display: none !important; }`;
  const sidebarGridClasses = ["lg:grid-cols-[202px_minmax(0,1fr)]", "lg:grid-cols-[12.625rem_minmax(0,1fr)]"];
  function navigationSidebars(doc) {
    return [...doc.querySelectorAll('aside[class~="w-[11.375rem]"], div[class~="w-[11.375rem]"]')].filter(element => {
      if (!element.classList.contains("sticky") || element.closest("article") || element.closest('[id="note-body"]') || element.closest(`[${owned}]`)) return false;
      if (element.tagName === "ASIDE" && element.querySelector('nav[aria-label="急上昇"]')) return true;
      // 2026-11-04の公式左メニューはasideではなくdiv。横並びのカテゴリナビと区別する。
      let grid = element.parentElement;
      // 検索はhidden lg:block、タグはhidden lg:contentsを1段挟む。
      // 任意の祖先まで探すと本文中の似たDIVを拾うため、確認済みの1段だけを許可する。
      if (grid?.tagName === "DIV" && grid.classList.contains("hidden") &&
          (grid.classList.contains("lg:block") || grid.classList.contains("lg:contents"))) grid = grid.parentElement;
      if (!["top-3", "hidden", "h-full", "max-h-screen", "overflow-y-auto", "pr-4", "lg:block"].every(c => element.classList.contains(c)) ||
          !grid?.classList.contains("lg:grid") || !grid.classList.contains("min-h-screen") ||
          !sidebarGridClasses.some(c => grid.classList.contains(c)) || ![...grid.children].some(e => e.tagName === "MAIN")) return false;
      return [...element.querySelectorAll('nav[aria-label="カテゴリナビゲーション"]')].some(nav =>
        ["flex", "flex-col", "gap-4"].every(c => nav.classList.contains(c)) && [...nav.querySelectorAll("a[href]")].some(a => {
          try { const url = new URL(a.href); return url.origin === "https://note.com" && url.pathname === "/trend"; } catch { return false; }
        }));
    });
  }
  // 数字・ハートの外見だけで判定せず、確認済みの操作部品／埋め込みカードを照合する。
  function createLikeVisibility(doc) {
    let dirty = true, activeBefore = false;
    const targets = new Map(), frameStyles = new Map();
    const numeric = value => /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:万|億|[kKmM])?$/.test(value.trim());
    const interactive = 'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex], [onclick], [contenteditable]';
    function likeButton(button) {
      return button?.tagName === "BUTTON" && button.getAttribute("type") === "button" &&
        ["true", "false"].includes(button.getAttribute("aria-pressed")) &&
        [...button.querySelectorAll('svg[aria-label="スキ"]')].some(svg => svg.getAttribute("role") === "img" && svg.getAttribute("data-id") === "Icon");
    }
    function scan(document) {
      const next = new Set();
      for (const count of document.querySelectorAll('button[aria-label]')) {
        if (count.closest(`[${owned}]`) || !numeric(count.textContent)) continue;
        const label = count.getAttribute("aria-label"), suffix = "スキ この記事にスキをつけたユーザーを見る";
        if (!label.endsWith(suffix) || !numeric(label.slice(0, -suffix.length))) continue;
        const group = count.parentElement;
        if (!group || !["flex", "items-center", "justify-center"].every(c => group.classList.contains(c)) || group.children.length !== 2) continue;
        const buttons = [...group.querySelectorAll("button")].filter(likeButton);
        if (buttons.length === 1 && !count.contains(buttons[0])) next.add(count);
      }
      for (const count of document.querySelectorAll('div[class~="p-noteEmbed__suki"]')) {
        const inner = count.parentElement, card = inner?.parentElement;
        if (count.closest(`[${owned}]`) || !inner?.classList.contains("p-noteEmbed__inner") || !card?.classList.contains("p-noteEmbed") ||
            interactive.split(", ").some(selector => count.closest(selector)) || count.querySelector(interactive) || count.children.length !== 2) continue;
        const [icon, label] = count.children;
        if (!icon.classList.contains("p-noteEmbed__sukiIcon") || !label.classList.contains("p-noteEmbed__sukiLabel") || !numeric(label.textContent)) continue;
        const hearts = icon.querySelectorAll('i[class~="c-icon--heart"]');
        if (hearts.length !== 1 || !hearts[0].classList.contains("c-icon") || icon.textContent.trim()) continue;
        const links = [...inner.children].filter(e => e.tagName === "A" && e.classList.contains("p-noteEmbed__link") && core.isArticle(e.href));
        if (links.length !== 1 || !inner.querySelector('div[class~="p-noteEmbed__body"]')) continue;
        next.add(count);
      }
      for (const target of targets.get(document) ?? []) if (!next.has(target)) target.removeAttribute(likeHidden);
      for (const target of next) if (!target.hasAttribute(likeHidden)) target.setAttribute(likeHidden, "");
      targets.set(document, next);
    }
    function release(document) {
      for (const target of targets.get(document) ?? []) target.removeAttribute(likeHidden);
      targets.delete(document); frameStyles.get(document)?.remove(); frameStyles.delete(document);
    }
    function clear() { for (const document of targets.keys()) release(document); activeBefore = false; dirty = true; }
    return {
      invalidate() { dirty = true; },
      stop: clear,
      update(settings, url) {
        let active = false;
        try { active = settings.enabled && settings.hideLikeCounts === true && new URL(url).origin === "https://note.com"; } catch { /* 対象外は復元 */ }
        if (!active) { if (activeBefore) clear(); return; }
        if (dirty || !activeBefore) scan(doc);
        dirty = false; activeBefore = true;
        const documents = new Set([doc]);
        for (const frame of doc.querySelectorAll("iframe[src]")) {
          try {
            const src = new URL(frame.getAttribute("src"), url);
            if (src.origin !== "https://note.com" || !/^\/embed\/notes\/n[a-zA-Z0-9]+\/?$/.test(src.pathname)) continue;
            const child = frame.contentDocument;
            if (!child?.head || new URL(child.location.href).origin !== src.origin || new URL(child.location.href).pathname !== src.pathname) continue;
            documents.add(child);
            let style = frameStyles.get(child);
            if (!style?.isConnected) {
              style = child.createElement("style"); style.setAttribute(owned, ""); style.textContent = likeCss;
              child.head.append(style); frameStyles.set(child, style);
            }
            // 親のMutationObserverはiframe内を観測しない。既存の再同期で遅延読込・数字変更も確認する。
            scan(child);
          } catch { /* 外部・sandbox・読込途中のフレームには触れない */ }
        }
        for (const document of targets.keys()) if (!documents.has(document)) release(document);
      }
    };
  }
  function isManagementPage(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === "https://note.com" &&
        (/^\/(?:dashboard|settings)(?:\/|$)/.test(parsed.pathname) || /^\/user_verification\/?$/.test(parsed.pathname));
    } catch { return false; }
  }
  function isOfficialHeaderLogo(anchor, url) {
    return anchor.isConnected && core.isHome(anchor.href) &&
      !anchor.closest("article") && !anchor.closest('[id="note-body"]') && !anchor.closest(`[${owned}]`) &&
      Boolean(isOfficialNavbar(anchor.closest("header")) || (isManagementPage(url) && anchor.closest("header"))) &&
      [...anchor.querySelectorAll('svg[aria-label="note"]')].some(svg => svg.getAttribute("role") === "img");
  }
  function isNavbarContainer(header) {
    return header?.tagName === "HEADER" && header.className.split(/\s+/).some(name => name.startsWith("with-navbar-layout_navbarContainer__"));
  }
  function isOfficialNavbar(header) {
    return header?.tagName === "HEADER" && (header.getAttribute("data-header-state") === "navbar" || isNavbarContainer(header));
  }
  function selectedTag(page, url) {
    if (page?.type === "tag") return page.tag;
    if (page?.type !== "search") return null;
    const params = new URL(url).searchParams;
    const query = params.get("q");
    return query?.startsWith("#") ? query.slice(1) : null;
  }
  function articleCardContainer(card) {
    // カード内だけでなく、一覧で1件分の場所を占める既知のラッパーも隠す。
    let container = card;
    for (let depth = 0; depth < 3; depth++) {
      const parent = container.parentElement;
      if (!parent || parent.tagName !== "DIV" || parent.children.length !== 1) break;
      const classes = parent.className.trim();
      const wrapper = !classes || classes === "contents" ||
        ["mb-0", "w-full", "min-w-0", "border-b-0", "pb-0"].every(name => parent.classList.contains(name));
      if (!wrapper) break;
      container = parent;
    }
    return container;
  }
  function cardCreatorId(card, link) {
    try {
      const userId = core.authorId(new URL(link.href).pathname.split("/")[1]);
      return [...card.querySelectorAll('a[data-name="avatar"]')].some(a => {
        try { return core.authorId(a.href).toLowerCase() === userId.toLowerCase(); } catch { return false; }
      }) ? userId : null;
    } catch { return null; }
  }
  function favoriteIcon(doc, type = "magazine") {
    const ns = "http://www.w3.org/2000/svg", svg = doc.createElementNS(ns, "svg"), path = doc.createElementNS(ns, "path");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "20"); svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", type === "membership" ? "hikikomori-note-membership-icon" : "hikikomori-note-book-icon");
    svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", type === "membership" ? core.membershipIconPath : core.bookIconPath); svg.append(path); return svg;
  }
  function create(doc, win, actions = {}) {
    const likeVisibility = createLikeVisibility(doc);
    let profileLayout;
    // 見た目だけでなくTab移動・読み上げも同じ順序にする。各機能は自分の領域だけを更新する。
    function profileSlot(owner, name) {
      if (!profileLayout || profileLayout.host !== owner.host || profileLayout.userId !== owner.userId || !profileLayout.root.isConnected) {
        profileLayout?.root.remove();
        const root = doc.createElement("div"); root.setAttribute(owned, ""); root.className = "hikikomori-note-profile-controls";
        const slots = {};
        for (const slot of ["navigation", "favorites", "author"]) {
          const element = doc.createElement("div"); element.setAttribute("data-hikikomori-note-profile-slot", slot);
          root.append(element); slots[slot] = element;
        }
        owner.host.prepend(root); profileLayout = { root, host: owner.host, userId: owner.userId, slots };
      }
      return profileLayout.slots[name];
    }
    function pruneProfileLayout() {
      if (profileLayout && Object.values(profileLayout.slots).every(slot => !slot.children.length)) {
        profileLayout.root.remove(); profileLayout = undefined;
      }
    }
    const authorControls = createAuthorControls(doc, win, actions, profileSlot);
    let host, menu, signature;
    let articleFollowing;
    let articleAuthor, authorSignature;
    let currentSettings, currentUrl, adding = false, uncertain = false, actionMessage = "", disposed = false;
    let favoriteProfile;
    function membershipOwner() {
      const page = core.membershipPage(currentUrl);
      if (!page) return null;
      for (const heading of doc.querySelectorAll("h1")) {
        const header = heading.closest("header"), host = heading.parentElement;
        if (!header || isOfficialNavbar(header) || heading.closest("article") || heading.closest(`[${owned}]`) ||
            header.querySelectorAll("h1").length !== 1 || !hasClasses(host, ["min-w-0", "flex-1"])) continue;
        const creator = [...host.querySelectorAll("a[href]")].some(a => {
          try { return new URL(a.href).href.replace(/\/$/, "") === core.profileUrl(page.user) &&
            a.getAttribute("aria-label")?.endsWith("さんのクリエイターページ") && a.querySelector("img"); } catch { return false; }
        });
        if (!creator) continue;
        try {
          const item = core.favoriteMembership({ type: "membership", userId: page.user, displayName: core.authorName(heading.textContent) });
          if (item.displayName) return { ...item, host };
        } catch { /* 見出しと作者を確認できない間は登録欄を出さない */ }
      }
      return null;
    }
    function magazineOwner() {
      const page = core.pageKind(currentUrl);
      if (page?.type !== "magazine") return null;
      const confirmed = [...doc.querySelectorAll('a[data-id="NavigationItem"]')].some(a => {
        if (!a.closest("nav") || a.closest("article") || a.closest(`[${owned}]`)) return false;
        const target = core.pageKind(a.href);
        return target?.type === "magazine" && target.user.toLowerCase() === page.user.toLowerCase() && target.magazineId === page.magazineId;
      });
      if (!confirmed) return null;
      for (const heading of doc.querySelectorAll("h1")) {
        if (heading.closest("article") || heading.closest(`[${owned}]`)) continue;
        let host = heading.parentElement;
        for (let depth = 0; host && depth < 4; depth++, host = host.parentElement) {
          if (!hasClasses(host, ["flex", "flex-col", "gap-4", "px-4", "md:row-span-2"])) continue;
          const root = host.parentElement;
          if (!root || root.querySelectorAll("h1").length !== 1 || ![...root.querySelectorAll("a[href]")].some(a => {
            try { return new URL(a.href).href.replace(/\/$/, "") === core.profileUrl(page.user) && a.getAttribute("aria-label")?.endsWith("のクリエイターページへ"); } catch { return false; }
          })) continue;
          // PC/狭幅の公式操作列は両方DOMに存在する。表示中の列だけへ自分のボタンを加える。
          for (const button of host.querySelectorAll("button")) {
            if (button.closest(`[${owned}]`) || !visible(button)) continue;
            const label = button.textContent.trim(), kind = button.getAttribute("data-name");
            if (!(kind === "ToggleButton" && ["フォロー", "フォロー中", "フォローを外す"].includes(label)) && !(kind === "Button" && label === "購入手続きへ")) continue;
            let row = button.parentElement;
            for (let d = 0; row && d < 4 && host.contains(row); d++, row = row.parentElement) {
              if (!hasClasses(row, ["flex", "flex-wrap", "justify-end", "gap-4"])) continue;
              try {
                const item = core.favoriteMagazine({ type: "magazine", userId: page.user, magazineId: page.magazineId, displayName: core.authorName(heading.textContent) });
                if (item.displayName) return { ...item, host, row };
              } catch { /* 名前が取得できない間は登録欄を出さない */ }
            }
          }
        }
      }
      return null;
    }
    function syncFavoriteProfile(settings) {
      const magazine = core.pageKind(currentUrl)?.type === "magazine";
      const membership = Boolean(core.membershipPage(currentUrl));
      let owner = null;
      if (settings.enabled && core.usesTags(settings)) {
        if (membership && actions.addCurrentMembership) owner = membershipOwner();
        else if (magazine && actions.addCurrentMagazine) owner = magazineOwner();
        else if (!magazine && !membership && actions.addCurrentUser) owner = authorControls.profileOwner();
      }
      if (favoriteProfile && (!owner || owner.type !== favoriteProfile.owner.type || owner.userId !== favoriteProfile.owner.userId || owner.magazineId !== favoriteProfile.owner.magazineId || owner.host !== favoriteProfile.owner.host || !favoriteProfile.block.isConnected)) {
        favoriteProfile.toggle.remove(); favoriteProfile.block.remove(); favoriteProfile.mount?.remove(); favoriteProfile = undefined;
      }
      if (!owner) return;
      if (!favoriteProfile) {
        const block = doc.createElement("div"); block.setAttribute(owned, ""); block.className = "hikikomori-note-author-profile hikikomori-note-favorite-profile";
        block.id = "hikikomori-note-favorite-profile"; block.setAttribute("id", block.id); block.hidden = true;
        const toggle = doc.createElement("button"); toggle.type = "button"; toggle.setAttribute(owned, "");
        toggle.className = "hikikomori-note-favorite-toggle"; toggle.textContent = "＠";
        if (magazine || membership) { toggle.textContent = ""; toggle.append(favoriteIcon(doc, membership ? "membership" : "magazine")); toggle.classList.add(membership ? "hikikomori-note-membership-toggle" : "hikikomori-note-magazine-toggle"); }
        const title = membership ? "このメンバーシップをお気に入りに追加" : magazine ? "このマガジンをお気に入りに追加" : "この作者をお気に入りに追加";
        toggle.setAttribute("aria-label", title); toggle.setAttribute("title", title);
        toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", block.id);
        const label = doc.createElement("label"); label.textContent = "お気に入りに追加　登録先";
        const select = doc.createElement("select"); select.setAttribute("aria-label", "お気に入りの登録先グループ"); label.append(select);
        const button = doc.createElement("button"); button.type = "button"; button.textContent = "この作者を追加";
        const status = doc.createElement("p"); status.setAttribute("role", "status");
        const refresh = doc.createElement("button"); refresh.type = "button"; refresh.textContent = "状態を再確認"; refresh.hidden = true;
        const context = { block, toggle, select, button, status, refresh, owner, groupId: "", busy: false, uncertain: false };
        toggle.onclick = () => {
          if (favoriteProfile !== context) return;
          block.hidden = !block.hidden; toggle.setAttribute("aria-expanded", String(!block.hidden));
          if (block.hidden && block.contains(doc.activeElement)) toggle.focus();
        };
        block.onkeydown = event => {
          if (event.key === "Escape") { event.preventDefault(); block.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
        };
        select.onchange = () => { context.groupId = select.value; status.textContent = ""; repaint(); };
        button.onclick = async () => {
          if (favoriteProfile !== context || context.busy || context.uncertain || button.disabled) return;
          context.busy = true; const groupId = context.groupId, user = context.owner; status.textContent = "保存しています…"; repaint();
          try {
            if (membership) await actions.addCurrentMembership(groupId, user.userId, user.displayName);
            else if (magazine) await actions.addCurrentMagazine(groupId, user.userId, user.magazineId, user.displayName);
            else await actions.addCurrentUser(groupId, user.userId, user.displayName);
            if (favoriteProfile === context) status.textContent = "お気に入りに追加しました。";
          }
          catch (error) { context.uncertain = error.code === "UNCONFIRMED"; if (favoriteProfile === context) status.textContent = `${error.message || "保存できませんでした。"} 「状態を再確認」で確認してください。`; refresh.hidden = false; }
          finally { context.busy = false; repaint(); }
        };
        refresh.onclick = async () => {
          if (context.busy || favoriteProfile !== context) return;
          context.busy = true; repaint();
          try { await actions.refresh(); context.uncertain = false; refresh.hidden = true; status.textContent = "保存済みの状態を確認しました。"; }
          catch { status.textContent = "状態を確認できませんでした。"; }
          finally { context.busy = false; repaint(); }
        };
        block.append(label, button, status, refresh);
        if (membership) {
          const mount = doc.createElement("div"); mount.setAttribute(owned, ""); mount.className = "hikikomori-note-membership-controls";
          mount.append(toggle, block); owner.host.append(mount); context.mount = mount;
        } else if (magazine) owner.host.append(block); else profileSlot(owner, "favorites").append(block);
        favoriteProfile = context;
      }
      const context = favoriteProfile; context.owner = owner;
      if (magazine && owner.row.children[0] !== context.toggle) owner.row.prepend(context.toggle);
      const names = JSON.stringify(settings.tagGroups.map(g => [g.id, core.groupName(g)]));
      if (context.names !== names) {
        context.select.replaceChildren(); const placeholder = doc.createElement("option"); placeholder.value = ""; placeholder.textContent = "登録先を選択"; context.select.append(placeholder);
        settings.tagGroups.forEach((group, index) => { const option = doc.createElement("option"); option.value = group.id; option.textContent = `${["①", "②", "③", "④"][index]} ${core.groupName(group)}`; context.select.append(option); }); context.names = names;
      }
      context.select.value = context.groupId;
      const group = settings.tagGroups.find(g => g.id === context.groupId);
      const key = core.favoriteKey(magazine || membership ? owner : { type: "user", userId: owner.userId });
      const registered = group?.tags.some(item => core.favoriteKey(item) === key);
      context.button.textContent = context.busy ? "保存中…" : registered ? "登録済み" : membership ? "このメンバーシップを追加" : magazine ? "このマガジンを追加" : "この作者を追加";
      context.button.disabled = !group || registered || context.busy || context.uncertain || Boolean(settings.tagWarning);
      context.select.disabled = context.busy || context.uncertain || Boolean(settings.tagWarning);
      context.refresh.disabled = context.busy || !actions.refresh;
    }
    const pinnedHeaders = new Set();
    const headerPinned = "data-hikikomori-note-header-pinned";
    const headerSidebars = new Set();
    const headerSidebar = "data-hikikomori-note-header-sidebar";
    let headerSidebarStyle;
    function syncHeaderSidebars(headers, url) {
      const targets = new Set(), page = core.pageKind(url);
      const height = Math.max(0, ...[...headers].map(header => header.getBoundingClientRect().height));
      if (headers.size && Number.isFinite(height) && height > 0 &&
          (core.isHome(url) || ["following", "tag", "search", "topic"].includes(page?.type))) {
        for (const aside of new Set([...doc.querySelectorAll('aside[class~="w-[11.375rem]"]'), ...navigationSidebars(doc)])) {
          if (hasClasses(aside, ["sticky", "top-3", "max-h-screen", "overflow-y-auto"]) &&
              !aside.closest("article") && !aside.closest(`[${owned}]`)) targets.add(aside);
        }
      }
      for (const aside of headerSidebars) if (!targets.has(aside)) aside.removeAttribute(headerSidebar);
      headerSidebars.clear();
      for (const aside of targets) {
        if (!aside.hasAttribute(headerSidebar)) aside.setAttribute(headerSidebar, "");
        headerSidebars.add(aside);
      }
      if (!targets.size) { headerSidebarStyle?.remove(); headerSidebarStyle = undefined; return; }
      if (!headerSidebarStyle?.isConnected) {
        headerSidebarStyle = doc.createElement("style"); headerSidebarStyle.setAttribute(owned, "");
        (doc.head || doc.documentElement || doc.root).append(headerSidebarStyle);
      }
      const css = `[${headerSidebar}] { --hikikomori-note-sidebar-top: ${Math.ceil(height) + 12}px; }`;
      if (headerSidebarStyle.textContent !== css) headerSidebarStyle.textContent = css;
    }
    const profileFixedBars = new Set();
    const profileFixedBarHidden = "data-hikikomori-note-profile-fixed-bar-hidden";
    function syncProfileFixedBars(headers, url) {
      const targets = new Set(), page = core.pageKind(url);
      if (page?.type === "profile" && headers.size) {
        for (const bar of doc.querySelectorAll('div[class~="z-[11]"]')) {
          if (!hasClasses(bar, ["fixed", "top-0", "left-0", "w-full"]) || bar.closest("article") || bar.closest(`[${owned}]`)) continue;
          const grid = [...bar.children].find(child => hasClasses(child, ["grid", "min-h-[49px]", "border-b", "bg-background-primary"]));
          if (!grid?.querySelector('[data-name="avatar"]') || !grid.querySelector("nav")) continue;
          if ([...grid.querySelectorAll('a[data-id="NavigationItem"]')].some(link => {
            try { const u = new URL(link.href); return u.origin === "https://note.com" && u.pathname.replace(/\/$/, "") === `/${page.user}`; } catch { return false; }
          })) targets.add(bar);
        }
      }
      for (const bar of profileFixedBars) if (!targets.has(bar)) bar.removeAttribute(profileFixedBarHidden);
      profileFixedBars.clear();
      for (const bar of targets) {
        if (!bar.hasAttribute(profileFixedBarHidden)) bar.setAttribute(profileFixedBarHidden, "");
        profileFixedBars.add(bar);
      }
    }
    function syncPinnedHeader(settings, url) {
      const targets = new Set();
      let active = false;
      try { active = settings.enabled && settings.keepNoteHeaderVisible === true && new URL(url).origin === "https://note.com"; } catch { /* 不明なURLでは解除 */ }
      if (active) for (const header of doc.querySelectorAll("header")) {
        // data-header-stateはスクロールでcreator-row-only等へ変わる。固定の構造とロゴで識別する。
        if (isNavbarContainer(header) && [...header.querySelectorAll("a[href]")].some(anchor =>
          anchor.closest("header") === header && isOfficialHeaderLogo(anchor, url))) targets.add(header);
      }
      for (const header of pinnedHeaders) if (!targets.has(header)) header.removeAttribute(headerPinned);
      pinnedHeaders.clear();
      for (const header of targets) {
        if (!header.hasAttribute(headerPinned)) header.setAttribute(headerPinned, "");
        pinnedHeaders.add(header);
      }
      syncProfileFixedBars(targets, url);
      syncHeaderSidebars(targets, url);
    }
    function repaint() { if (!disposed && currentSettings) update(currentSettings, currentUrl); }
    async function addTag(tag) {
      if (adding || uncertain || !currentSettings?.enabled || !core.usesTags(currentSettings) ||
          currentSettings.tagWarning || core.pageKind(currentUrl)?.tag !== tag) return;
      adding = true; actionMessage = "保存中…"; repaint();
      const groupId = currentSettings.selectedTagGroupId, selectionRevision = currentSettings.groupSelectionRevision;
      try { await actions.addCurrentTag(groupId, selectionRevision); actionMessage = `# ${tag}を${core.groupName(currentSettings.tagGroups.find(group => group.id === groupId))}に追加しました。`; }
      catch (error) {
        uncertain = error.code === "UNCONFIRMED";
        actionMessage = error.message || "保存できませんでした。";
      } finally { adding = false; repaint(); }
    }
    async function refreshTags() {
      if (adding) return;
      adding = true; repaint();
      try { await actions.refresh(); uncertain = false; actionMessage = "保存済みの状態を確認しました。"; }
      catch { actionMessage = "状態を確認できませんでした。もう一度、状態を再確認してください。"; }
      finally { adding = false; repaint(); }
    }
    async function selectGroup(groupId) {
      if (adding || uncertain || currentSettings.tagWarning || !actions.selectGroup) return;
      adding = true; repaint();
      try { await actions.selectGroup(groupId); actionMessage = ""; }
      catch (error) { uncertain = error.code === "UNCONFIRMED"; actionMessage = error.message; }
      finally {
        adding = false; repaint();
        menu?.querySelector(`[data-group-id="${groupId}"]`)?.focus();
      }
    }
    const originals = new Set();
    const products = new Set();
    const recommendations = new Set();
    const sidebarRoots = new Set();
    const rootClass = "hikikomori-note-navigation-root";
    const isSidebarGrid = root => sidebarGridClasses.some(name => root.classList.contains(name));
    function prepareSidebar(url, settings) {
      if (disposed) return;
      const active = (settings?.enabled && core.usesTags(settings)) &&
        ["following", "tag", "search", "topic"].includes(core.pageKind(url)?.type);
      for (const root of sidebarRoots) {
        if (!active || !root.isConnected || !isSidebarGrid(root)) {
          root.classList.remove(rootClass); sidebarRoots.delete(root);
        }
      }
      if (!active) return;
      // 急上昇navやasideの完成を待たず、SSRで先に現れるレイアウトの親へ印を付ける。
      for (const root of doc.querySelectorAll('div[class~="lg:grid"]')) {
        if (!root.classList.contains("min-h-screen") || !isSidebarGrid(root) || root.closest("article")) continue;
        if (!root.classList.contains(rootClass)) root.classList.add(rootClass);
        sidebarRoots.add(root);
      }
    }
    const headerSettings = new Map();
    const inactiveLogos = new Set();
    const inactiveLogo = "data-hikikomori-note-logo-back-unavailable";
    function syncLogoCursor(active) {
      let canGoBack = false;
      try { canGoBack = win.navigation?.canGoBack === true && typeof win.navigation.back === "function"; }
      catch { /* 判定できない場合も戻れない状態として扱う。 */ }
      for (const logo of inactiveLogos) {
        if (!active || canGoBack || !isOfficialHeaderLogo(logo, currentUrl)) {
          logo.removeAttribute(inactiveLogo); inactiveLogos.delete(logo);
        }
      }
      if (!active || canGoBack) return;
      for (const header of doc.querySelectorAll("header")) {
        for (const logo of header.querySelectorAll("a[href]")) {
          if (isOfficialHeaderLogo(logo, currentUrl) && !inactiveLogos.has(logo)) {
            logo.setAttribute(inactiveLogo, ""); inactiveLogos.add(logo);
          }
        }
      }
    }
    const settingsLayout = "data-hikikomori-note-logo-settings-layout";
    function logoContainer(logo) {
      const parent = logo.parentElement;
      return isOfficialHeaderLogo(logo, currentUrl) && (parent?.tagName === "DIV" || (isManagementPage(currentUrl) && parent?.tagName === "HEADER")) &&
        [...parent.children].filter(child => !child.hasAttribute(owned)).length === 1 ? parent : null;
    }
    function syncHeaderSettings(active) {
      for (const [logo, control] of headerSettings) {
        if (!active || logoContainer(logo) !== control.parent || !control.link.isConnected) {
          control.link.remove(); control.parent.removeAttribute(settingsLayout); headerSettings.delete(logo);
        } else if (actions.settingsUrl) {
          const destination = actions.settingsUrl();
          if (control.link.href !== destination) control.link.href = destination;
        }
      }
      if (!active || !actions.settingsUrl) return;
      for (const header of doc.querySelectorAll("header")) {
        for (const logo of header.querySelectorAll('a[href]')) {
          const parent = logoContainer(logo);
          if (!parent || headerSettings.has(logo)) continue;
          const link = doc.createElement("a"); link.className = "hikikomori-note-header-settings";
          link.href = actions.settingsUrl(); link.setAttribute(owned, "");
          link.setAttribute("aria-label", "設定画面を表示"); link.setAttribute("title", "設定画面を表示");
          const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
          const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M9.5 3h5l.5 3 2 1 2.5-1 2.5 4-2 2v2l2 2-2.5 4-2.5-1-2 1-.5 3h-5L9 20l-2-1-2.5 1L2 16l2-2v-2l-2-2 2.5-4L7 7l2-1Z");
          const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", "12"); circle.setAttribute("cy", "13"); circle.setAttribute("r", "3");
          icon.append(path, circle); link.append(icon); parent.append(link); parent.setAttribute(settingsLayout, "");
          headerSettings.set(logo, { parent, link });
        }
      }
    }
    const searchClearControls = new Map();
    const clearLayout = "data-hikikomori-note-search-clear-layout";
    function searchForm(input) {
      const form = input.closest("form"), field = input.closest('[data-name="Field"]');
      if (!input.isConnected || input.disabled || input.readOnly ||
          !isOfficialNavbar(input.closest("header")) ||
          input.getAttribute("type") !== "search" || input.getAttribute("name") !== "q" ||
          input.getAttribute("aria-label") !== "キーワードやクリエイターで検索" ||
          input.parentElement?.getAttribute("data-name") !== "TextFieldBase" ||
          !form || form.getAttribute("role") !== "search" || field?.parentElement !== form) return null;
      try {
        const action = new URL(form.getAttribute("action"), "https://note.com");
        return action.origin === "https://note.com" && action.pathname === "/search" ? form : null;
      } catch { return null; }
    }
    function removeSearchClear(input, control) {
      control.button.remove(); control.form.removeAttribute(clearLayout);
      input.removeEventListener("input", control.refresh);
      input.removeEventListener("compositionstart", control.startComposition);
      input.removeEventListener("compositionend", control.endComposition);
      searchClearControls.delete(input);
    }
    function syncSearchClear(active) {
      for (const [input, control] of searchClearControls) {
        if (!active || searchForm(input) !== control.form || !control.button.isConnected) removeSearchClear(input, control);
      }
      if (!active) return;
      for (const input of doc.querySelectorAll('input[name="q"]')) {
        const form = searchForm(input);
        if (!form) continue;
        if (!searchClearControls.has(input)) {
          const button = doc.createElement("button"); button.type = "button";
          button.className = "hikikomori-note-search-clear"; button.setAttribute(owned, "");
          button.setAttribute("aria-label", "検索欄をクリア"); button.setAttribute("title", "検索欄をクリア");
          const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
          const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M6 6l12 12M18 6L6 18"); icon.append(path); button.append(icon);
          let composing = false;
          const refresh = () => {
            const empty = input.value.length === 0;
            if (button.hidden !== empty) button.hidden = empty;
            button.disabled = composing;
            if (!empty && !form.hasAttribute(clearLayout)) form.setAttribute(clearLayout, "");
            if (empty && form.hasAttribute(clearLayout)) form.removeAttribute(clearLayout);
          };
          const startComposition = () => { composing = true; refresh(); };
          const endComposition = () => { composing = false; refresh(); };
          button.onclick = event => {
            event.preventDefault(); event.stopPropagation();
            if (disposed || !currentSettings?.enabled || composing || searchForm(input) !== form) return;
            try {
              // React等が持つ入力追跡にも変更を伝える。ページ側の内部状態には触れない。
              const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set;
              if (!setter) return;
              setter.call(input, "");
              input.dispatchEvent(new win.Event("input", { bubbles: true, composed: true }));
              if (input.isConnected) input.focus();
            } finally { refresh(); }
          };
          input.addEventListener("input", refresh);
          input.addEventListener("compositionstart", startComposition);
          input.addEventListener("compositionend", endComposition);
          form.append(button); searchClearControls.set(input, { form, button, refresh, startComposition, endComposition });
        }
        searchClearControls.get(input).refresh();
      }
    }
    const paidCards = new Map();
    // 本人の記事が並ぶトップと/allだけ、許可結果を共有する。各カードの作者照合は省略しない。
    let profilePaidAllowance;
    function prepareProfilePaidAllowance(settings, url) {
      let owner;
      try {
        const page = core.pageKind(url), path = new URL(url).pathname.replace(/\/$/, "");
        if (settings.enabled && settings.hidePaidArticles && page?.type === "profile" &&
            [`/${page.user}`, `/${page.user}/all`].includes(path)) owner = page.user;
      } catch { /* 確認できないページはカードごとの判定を維持する */ }
      if (!owner) { profilePaidAllowance = undefined; return; }
      const userId = owner.toLowerCase();
      if (profilePaidAllowance?.userId === userId && profilePaidAllowance.rules === settings.authorDisplayRules &&
          profilePaidAllowance.self === settings.noteUserId && profilePaidAllowance.warning === settings.authorWarning) return;
      const allowed = Boolean(settings.noteUserId && !settings.authorWarning && !core.isSelf(settings, owner) && core.authorRule(settings, owner)?.action === "allow");
      profilePaidAllowance = { userId, rules: settings.authorDisplayRules, self: settings.noteUserId, warning: settings.authorWarning, allowed };
    }
    function isAllowedAuthor(settings, userId) {
      if (!settings.noteUserId || settings.authorWarning || core.isSelf(settings, userId)) return false;
      return profilePaidAllowance?.userId === userId.toLowerCase() ? profilePaidAllowance.allowed : core.authorRule(settings, userId)?.action === "allow";
    }
    const paidHidden = "data-hikikomori-note-paid-hidden";
    const membershipLock = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2Z";
    function isMembershipLock(path) {
      return path.getAttribute("d") === membershipLock && Boolean(path.closest("svg") && path.closest("h3"));
    }
    function isPaidPrice(price) {
      return price.classList.contains("text-text-success") && isPaidAmount(price.textContent);
    }
    function isPaidAmount(text) {
      return /^¥\s*[1-9]\d*(?:,\d{3})*\s*[〜～]?\s*$/.test(text.trim());
    }
    let paidDirty = true, paidSignature;
    function isMagazineCard(card) {
      return card.tagName === "DIV" && ["relative", "mb-[6px]", "mr-[6px]", "flex", "w-[calc(100%-6px)]"].every(name => card.classList.contains(name));
    }
    function isHomeArticleCard(card) {
      return card.tagName === "DIV" && hasClasses(card, ["relative", "w-full"]) &&
        [...card.children].some(child => child.tagName === "DIV" &&
          hasClasses(child, ["flex", "w-full", "bg-surface-normal", "[grid-row:2]", "min-w-0"]));
    }
    function isPaidMagazineCard(card, settings) {
      if (!isMagazineCard(card)) return false;
      const cover = [...card.children].find(child => child.tagName === "DIV" &&
        ["before:-z-20", "after:-z-10", "rounded-lg", "border-border-default"].every(name => child.classList.contains(name)));
      if (!cover?.querySelector("h3")) return false;
      const link = [...card.children].find(child => {
        if (child.tagName !== "A" || !child.classList.contains("absolute") || !child.classList.contains("inset-0") ||
            !child.getAttribute("title") || !child.getAttribute("aria-label")) return false;
        try { const url = new URL(child.href); return url.origin === "https://note.com" && /^\/[a-zA-Z0-9_]+\/m\/m[a-zA-Z0-9]+\/?$/.test(url.pathname); }
        catch { return false; }
      });
      if (!link || isAllowedCard(card, link, settings)) return false;
      return [...cover.querySelectorAll("span[class]")].some(price => {
        const holder = price.parentElement, metadata = holder?.parentElement;
        return isPaidPrice(price) && holder.tagName === "DIV" && holder.classList.contains("text-text-success") &&
          metadata?.classList.contains("isolate") && Boolean(metadata.querySelector('a[data-name="avatar"]'));
      });
    }
    function isPaidCard(card, settings) {
      if (!card.isConnected || card.closest('article') || card.closest('[id="note-body"]')) return false;
      // 固定記事にも同じ内側構造がある。既知の既存カードはホーム以外でも扱う。
      if (!card.classList.contains("grid-rows-subgrid") && isHomeArticleCard(card) && !core.isHome(currentUrl)) return false;
      if (isPaidMagazineCard(card, settings)) return true;
      return [...card.querySelectorAll('a[href]')].some(link =>
        link.parentElement?.parentElement === card && link.classList.contains("absolute") &&
        link.classList.contains("inset-0") && link.getAttribute("title") && link.getAttribute("aria-label") && core.isArticle(link.href) &&
        link.parentElement.querySelector("h3") &&
        !isAllowedCard(card, link, settings) &&
        ([...link.parentElement.querySelectorAll("span[class]")].some(isPaidPrice) ||
          [...link.parentElement.querySelectorAll("path[d]")].some(isMembershipLock)));
    }
    function isAllowedCard(card, link, settings) {
      if (!settings.noteUserId || settings.authorWarning) return false;
      const userId = cardCreatorId(card, link);
      return Boolean(userId && isAllowedAuthor(settings, userId));
    }
    function paidCardContainer(card) {
      // ホームの横並びでは幅を確保する1件分の枠も隠す。
      const slot = card.parentElement, list = slot?.parentElement;
      if (core.isHome(currentUrl) && isHomeArticleCard(card) && slot?.tagName === "DIV" && slot.children.length === 1 &&
          hasClasses(slot, ["h-auto", "shrink-0", "w-36", "sm:w-48"]) &&
          hasClasses(list, ["flex", "overflow-x-auto", "overflow-y-hidden"])) return slot;
      return articleCardContainer(card);
    }
    const homePaidHidden = "data-hikikomori-note-home-paid-hidden";
    let homePaidRoot;
    function syncHomePaidRecommendations(settings, url) {
      const root = doc.documentElement || doc.root;
      const active = settings.enabled && settings.hidePaidArticles && core.modeOf(settings) === "social" && core.isHome(url);
      if (homePaidRoot && (!active || root !== homePaidRoot)) {
        homePaidRoot.removeAttribute(homePaidHidden); homePaidRoot = undefined;
      }
      if (active && root) {
        if (!root.hasAttribute(homePaidHidden)) root.setAttribute(homePaidHidden, "");
        homePaidRoot = root;
      }
    }
    function syncPaidCards(settings, url) {
      let active = false;
      try {
        const page = new URL(url);
        active = settings.enabled && settings.hidePaidArticles === true && page.origin === "https://note.com" &&
          !/^\/notes\/purchased(?:\/|$)/.test(page.pathname);
      } catch { /* 不明なURLでは解除 */ }
      const signature = JSON.stringify([active, url, settings.noteUserId, settings.authorDisplayRules, settings.authorWarning]);
      if (!paidDirty && paidSignature === signature) return;
      paidDirty = false; paidSignature = signature;
      for (const [card, container] of paidCards) {
        if (!active || !isPaidCard(card, settings) || paidCardContainer(card) !== container) {
          container.removeAttribute(paidHidden); paidCards.delete(card);
        }
      }
      if (!active) return;
      const prices = [...doc.querySelectorAll("span[class]")].filter(isPaidPrice);
      const locks = [...doc.querySelectorAll("path[d]")].filter(isMembershipLock);
      for (const indicator of [...prices, ...locks]) {
        let card = indicator.parentElement;
        for (let depth = 0; card && depth < 10; depth++, card = card.parentElement) {
          if (!card.classList.contains("grid-rows-subgrid") && !isMagazineCard(card) &&
              !(core.isHome(url) && isHomeArticleCard(card))) continue;
          if (isPaidCard(card, settings)) {
            const container = paidCardContainer(card);
            container.setAttribute(paidHidden, ""); paidCards.set(card, container);
          }
          break;
        }
      }
    }
    function clearArticleAuthor() {
      articleAuthor?.remove(); articleAuthor = undefined; authorSignature = undefined;
    }
    const sideProfiles = new Set();
    const sideProfileOffset = "data-hikikomori-note-side-profile-offset";
    const sideProfileFollowRoots = new Set();
    const sideProfileFollowHidden = "data-hikikomori-note-side-profile-follow-hidden";
    function syncSideProfileFollow(settings, url) {
      const current = new Set();
      if (settings.enabled && (core.isArticle(url) || core.isPreviewArticle(url))) {
        for (const profile of doc.querySelectorAll('[data-testid="side-creator-profile"]')) {
          const container = profile.parentElement;
          if (profile.closest("article") || profile.closest('[id="note-body"]') ||
              container?.tagName !== "DIV" || !["fixed", "top-24", "left-8"].every(name => container.classList.contains(name))) continue;
          if (!profile.hasAttribute(sideProfileFollowHidden)) profile.setAttribute(sideProfileFollowHidden, "");
          current.add(profile);
        }
      }
      for (const profile of sideProfileFollowRoots) if (!current.has(profile)) profile.removeAttribute(sideProfileFollowHidden);
      sideProfileFollowRoots.clear(); for (const profile of current) sideProfileFollowRoots.add(profile);
    }
    function syncSideProfiles(active) {
      const current = new Set();
      if (active) {
        for (const profile of doc.querySelectorAll('[data-testid="side-creator-profile"]')) {
          const container = profile.parentElement;
          if (profile.closest("article") || profile.closest('[id="note-body"]') ||
              container?.tagName !== "DIV" || !["fixed", "top-24", "left-8"].every(name => container.classList.contains(name))) continue;
          const offset = articleAuthor?.isConnected && articleFollowing?.isConnected ? "author" : "following";
          if (container.getAttribute(sideProfileOffset) !== offset) container.setAttribute(sideProfileOffset, offset);
          current.add(container);
        }
      }
      for (const container of sideProfiles) if (!current.has(container)) container.removeAttribute(sideProfileOffset);
      sideProfiles.clear(); for (const container of current) sideProfiles.add(container);
    }
    function syncArticleAuthor(article, url) {
      const preview = core.isPreviewArticle(url);
      let profileUrl = preview ? null : core.profileUrl(new URL(url).pathname.split("/")[1]);
      let author;
      for (const time of article.querySelectorAll("time")) {
        if (time.closest('[id="note-body"]')) continue;
        let region = time.parentElement;
        for (let depth = 0; region && region !== article && depth < 4; depth++, region = region.parentElement) {
          if (region.querySelector('[id="note-body"]')) break;
          const avatar = region.querySelector('[data-name="avatar"]');
          let candidateProfile = profileUrl;
          if (preview) {
            try {
              const link = avatar?.closest("a")?.href;
              if (core.pageKind(link)?.type !== "profile") continue;
              candidateProfile = core.profileUrl(core.normalizeUserId(link));
            } catch { continue; }
          }
          const name = [...region.querySelectorAll("a[href]")].find(a => a.href === candidateProfile && a.textContent.trim());
          if (!avatar || avatar.closest("a")?.href !== candidateProfile || !name) continue;
          let image = "";
          try {
            const source = new URL(avatar.querySelector("img")?.getAttribute("src"));
            if (source.protocol === "https:" && source.hostname === "assets.st-note.com") image = source.href;
          } catch { /* 画像が不明な場合は名前だけ表示する */ }
          profileUrl = candidateProfile;
          author = { name: name.textContent.trim(), image }; break;
        }
        if (author) break;
      }
      if (!author) { clearArticleAuthor(); return; }
      const nextSignature = JSON.stringify([profileUrl, author]);
      if (authorSignature === nextSignature && articleAuthor?.isConnected) return;
      clearArticleAuthor();
      articleAuthor = doc.createElement("a"); articleAuthor.setAttribute(owned, "");
      articleAuthor.className = "hikikomori-note-article-author";
      articleAuthor.href = profileUrl;
      articleAuthor.setAttribute("title", author.name);
      articleAuthor.setAttribute("aria-label", `${author.name}のクリエーターページ`);
      if (author.image) {
        const image = doc.createElement("img"); image.setAttribute("src", author.image);
        image.setAttribute("alt", ""); image.setAttribute("width", "32"); image.setAttribute("height", "32");
        articleAuthor.append(image);
      }
      const name = doc.createElement("span"); name.textContent = author.name; articleAuthor.append(name);
      doc.body.append(articleAuthor); authorSignature = nextSignature;
    }
    function syncArticleFollowing(settings, url) {
      const article = doc.querySelector('article[id="note-article"]');
      const show = settings.enabled && (core.isArticle(url) || core.isPreviewArticle(url)) &&
        win.matchMedia("(min-width: 1100px)").matches && article && visible(article) &&
        article.getBoundingClientRect().left >= 228 && doc.body;
      if (!show) { articleFollowing?.remove(); articleFollowing = undefined; clearArticleAuthor(); syncSideProfiles(false); return; }
      if (!core.usesFollowing(settings)) { articleFollowing?.remove(); articleFollowing = undefined; }
      else if (!articleFollowing?.isConnected) {
        articleFollowing = doc.createElement("a");
        articleFollowing.setAttribute(owned, "");
        articleFollowing.className = "hikikomori-note-article-following";
        articleFollowing.href = "https://note.com/following";
        articleFollowing.textContent = "フォロー中のTL";
        doc.body.append(articleFollowing);
      }
      syncArticleAuthor(article, url);
      if (articleAuthor) {
        if (articleFollowing?.isConnected) articleAuthor.classList.remove("hikikomori-note-article-author-only");
        else articleAuthor.classList.add("hikikomori-note-article-author-only");
      }
      syncSideProfiles(Boolean(articleFollowing?.isConnected || articleAuthor?.isConnected));
    }
    function isRecommendations(element) {
      if (element.tagName !== "DIV" || !element.classList.contains("pt-6") ||
          element.closest("article") || element.closest('[id="note-body"]') || element.children.length !== 2) return false;
      const [title, list] = element.children;
      const headings = [...element.querySelectorAll("h2")];
      return title.tagName === "DIV" && title.children.length === 1 && headings.length === 1 &&
        title.children[0] === headings[0] && headings[0].textContent.trim() === "あなたへのおすすめ" &&
        list.tagName === "ASIDE" && (list.getAttribute("aria-label") === "記事" ||
          (list.classList.contains("p-8") && ["true", "false"].includes(list.getAttribute("aria-busy"))));
    }
    const recommendationRoots = new Set();
    const recommendationRoot = "hikikomori-note-recommendations-root";
    const notesPromotionRoots = new Set();
    const homeBanners = new Set();
    const homeBannerHidden = "data-hikikomori-note-home-banner-hidden";
    let homeBannersDirty = true, homeBannersSignature;
    function syncHomeBanners(settings, url) {
      const active = settings.enabled && settings.hideArticleRecommendations && core.isHome(url);
      const signature = JSON.stringify([Boolean(active), url]);
      if (!homeBannersDirty && signature === homeBannersSignature) return;
      homeBannersDirty = false; homeBannersSignature = signature;
      const targets = new Set();
      if (active) {
        for (const image of doc.querySelectorAll('img[width="960"]')) {
          if (!image.getAttribute("alt") || image.closest("article") || image.closest('[id="note-body"]') || image.closest(`[${owned}]`)) continue;
          let source;
          try { source = new URL(image.getAttribute("src")); } catch { continue; }
          if (source.origin !== "https://assets.st-note.com" || !source.pathname.startsWith("/poc-image/manual/production/")) continue;
          const banner = image.parentElement;
          if (banner?.tagName !== "DIV" || !hasClasses(banner, ["relative", "mx-auto", "max-w-[960px]"])) continue;
          if (![...banner.children].some(link => {
            if (link.tagName !== "A" || !hasClasses(link, ["absolute", "inset-0"]) || !link.getAttribute("title") || !link.getAttribute("aria-label")) return false;
            try { return new URL(link.href).origin === "https://note.com"; } catch { return false; }
          })) continue;
          const padding = banner.parentElement, row = padding?.parentElement;
          const wholeRow = padding?.tagName === "DIV" && hasClasses(padding, ["px-4", "lg:px-0"]) && padding.children.length === 1 &&
            row?.tagName === "DIV" && row.classList.contains("mb-5") && row.children.length === 1;
          targets.add(wholeRow ? row : banner);
        }
      }
      for (const target of homeBanners) if (!targets.has(target)) target.removeAttribute(homeBannerHidden);
      homeBanners.clear();
      for (const target of targets) { if (!target.hasAttribute(homeBannerHidden)) target.setAttribute(homeBannerHidden, ""); homeBanners.add(target); }
    }
    const notesPromotionRoot = "data-hikikomori-note-notes-promotions";
    let notesPromotionsDirty = true, notesPromotionsSignature;
    const membershipExamples = new Set();
    const membershipExamplesHidden = "data-hikikomori-note-membership-examples-hidden";
    let membershipExamplesDirty = true, membershipExamplesSignature;
    const magazinePromotions = new Set();
    const magazinePromotionHidden = "data-hikikomori-note-magazine-promotion-hidden";
    let magazinePromotionsDirty = true, magazinePromotionsSignature;
    function hasClasses(element, names) { return Boolean(element && names.every(name => element.classList.contains(name))); }
    function notesBanner(block) {
      if (block.tagName !== "DIV" || !hasClasses(block, ["hidden", "md:block"])) return false;
      return [...block.children].some(scroller => scroller.tagName === "DIV" &&
        hasClasses(scroller, ["flex", "flex-nowrap", "gap-2", "overflow-x-auto", "md:flex-wrap"]) &&
        [...scroller.children].some(card => card.tagName === "DIV" &&
          hasClasses(card, ["relative", "flex", "w-60", "min-w-60", "items-stretch", "md:w-full"]) &&
          [...card.children].some(child => child.tagName === "IMG" && child.getAttribute("alt")) &&
          [...card.children].some(child => {
            if (child.tagName !== "A" || !hasClasses(child, ["absolute", "inset-0"]) || !child.getAttribute("aria-label") || !child.getAttribute("title")) return false;
            try { return new URL(child.href).origin === "https://note.com"; } catch { return false; }
          })));
    }
    function notesSuggestion(group) {
      if (group.tagName !== "DIV" || !hasClasses(group, ["flex", "flex-col", "gap-4"])) return false;
      return [...group.children].some(block => {
        const desktop = block.tagName === "SECTION" && hasClasses(block, ["hidden", "rounded-lg", "bg-surface-normal", "p-6", "md:block"]);
        const mobile = block.tagName === "DIV" && hasClasses(block, ["border-border-default", "border-b", "bg-background-primary", "md:hidden"]);
        if (!desktop && !mobile) return false;
        const title = desktop ? [...block.children].find(n => n.tagName === "H2") : block.querySelector("summary");
        return title?.textContent.trim() === "あなたへの提案" && [...block.querySelectorAll("a[href]")].some(a => {
          try { const url = new URL(a.href); return url.origin === "https://note.com" && url.pathname === "/monetization-guide"; } catch { return false; }
        });
      });
    }
    function syncNotesPromotions(settings, url) {
      let active = false;
      try { const page = new URL(url); active = settings.enabled && settings.hideArticleRecommendations && page.origin === "https://note.com" && /^\/notes\/?$/.test(page.pathname); } catch { /* 不明なURLでは解除 */ }
      const signature = JSON.stringify([Boolean(active), url]);
      if (!notesPromotionsDirty && notesPromotionsSignature === signature) return;
      notesPromotionsDirty = false; notesPromotionsSignature = signature;
      const current = new Set();
      if (active) {
        for (const root of doc.querySelectorAll("div[class]")) {
          if (!hasClasses(root, ["flex", "flex-col", "gap-4"]) || root.closest("article") || root.closest('[id="note-body"]') || root.closest(`[${owned}]`)) continue;
          if (![...root.children].some(block => notesBanner(block) || notesSuggestion(block))) continue;
          if (!root.hasAttribute(notesPromotionRoot)) root.setAttribute(notesPromotionRoot, "");
          current.add(root);
        }
      }
      for (const root of notesPromotionRoots) if (!current.has(root)) root.removeAttribute(notesPromotionRoot);
      notesPromotionRoots.clear(); for (const root of current) notesPromotionRoots.add(root);
    }
    function syncMembershipExamples(settings, url) {
      let active = false;
      try {
        const page = new URL(url);
        active = settings.enabled && (settings.hidePaidArticles || settings.hideArticleRecommendations) &&
          page.origin === "https://note.com" && /^\/membership\/settings(?:\/manage)?\/?$/.test(page.pathname);
      } catch { /* 不明なURLでは解除 */ }
      const signature = JSON.stringify([Boolean(active), url]);
      if (!membershipExamplesDirty && membershipExamplesSignature === signature) return;
      membershipExamplesDirty = false; membershipExamplesSignature = signature;
      const targets = new Set();
      if (active) {
        for (const aside of doc.querySelectorAll("aside")) {
          if (!hasClasses(aside, ["order-2", "w-full", "flex-none", "md:order-3"]) ||
              aside.closest("article") || aside.closest('[id="note-body"]') || aside.closest(`[${owned}]`)) continue;
          for (const group of aside.children) {
            if (group.tagName !== "DIV" || !hasClasses(group, ["flex", "flex-col", "gap-y-4"])) continue;
            for (const box of group.children) {
              if (box.tagName !== "DIV" || !hasClasses(box, ["flex", "flex-col", "gap-y-4", "bg-background-primary", "p-4", "md:p-6"]) ||
                  ![...box.querySelectorAll("summary")].some(title => title.textContent.trim() === "参考事例")) continue;
              const search = [...box.querySelectorAll("form")].some(form => {
                try {
                  const action = new URL(form.getAttribute("action"), "https://note.com");
                  return action.origin === "https://note.com" && action.pathname === "/search" && form.getAttribute("method")?.toLowerCase() === "get" &&
                    [...form.querySelectorAll('input[name="context"]')].some(input => input.getAttribute("type") === "hidden" && input.getAttribute("value") === "circle");
                } catch { return false; }
              });
              if (!search) continue;
              // 参考事例だけのカラムなら余白も隠す。別の設定枠が混ざる場合は事例枠だけに留める。
              targets.add(aside.children.length === 1 && group.children.length === 1 ? aside : box);
            }
          }
        }
      }
      for (const target of membershipExamples) if (!targets.has(target)) target.removeAttribute(membershipExamplesHidden);
      membershipExamples.clear();
      for (const target of targets) { if (!target.hasAttribute(membershipExamplesHidden)) target.setAttribute(membershipExamplesHidden, ""); membershipExamples.add(target); }
    }
    function magazinePromotion(block) {
      if (block.tagName !== "DIV") return false;
      if (hasClasses(block, ["relative", "mx-2", "flex", "overflow-hidden", "rounded-lg", "md:mx-0"])) {
        const image = [...block.children].some(node => {
          if (node.tagName !== "IMG" || !node.getAttribute("alt")) return false;
          try { const url = new URL(node.getAttribute("src")); return url.origin === "https://assets.st-note.com" && url.pathname.startsWith("/poc-image/manual/"); } catch { return false; }
        });
        return image && [...block.children].some(node => {
          if (node.tagName !== "A" || !hasClasses(node, ["absolute", "inset-0"]) || !node.getAttribute("aria-label") || !node.getAttribute("title")) return false;
          try { const url = new URL(node.href); return url.origin === "https://note.com" && url.pathname === "/lp/membership/start"; } catch { return false; }
        });
      }
      return hasClasses(block, ["rounded-lg", "bg-background-primary", "p-6"]) &&
        [...block.children].some(node => node.tagName === "H3" && node.textContent.trim() === "マガジンをもっと活用するには") &&
        [...block.querySelectorAll("a[href]")].some(link => {
          try {
            const url = new URL(link.href);
            return (url.origin === "https://help-note.com" && url.pathname.startsWith("/hc/ja/articles/")) ||
              (url.origin === "https://note.com" && /^\/notemag\/n\/n[a-zA-Z0-9]+\/?$/.test(url.pathname));
          } catch { return false; }
        });
    }
    function syncMagazinePromotions(settings, url) {
      let active = false;
      try { const page = new URL(url); active = settings.enabled && settings.hideArticleRecommendations && page.origin === "https://note.com" && /^\/magazines\/(?:all|my|follow|editable|readable)\/?$/.test(page.pathname); } catch { /* 不明なURLでは解除 */ }
      const signature = JSON.stringify([Boolean(active), url]);
      if (!magazinePromotionsDirty && magazinePromotionsSignature === signature) return;
      magazinePromotionsDirty = false; magazinePromotionsSignature = signature;
      const targets = new Set();
      if (active) for (const aside of doc.querySelectorAll("aside")) {
        if (!hasClasses(aside, ["w-full", "[grid-area:aside]", "md:max-w-[17.5rem]"]) || aside.closest("article") || aside.closest('[id="note-body"]') || aside.closest(`[${owned}]`)) continue;
        for (const group of aside.children) {
          if (group.tagName !== "DIV" || !hasClasses(group, ["space-y-2", "md:space-y-4"])) continue;
          const blocks = [...group.children].filter(magazinePromotion);
          if (blocks.length && blocks.length === group.children.length && aside.children.length === 1) targets.add(aside);
          else for (const block of blocks) targets.add(block);
        }
      }
      for (const target of magazinePromotions) if (!targets.has(target)) target.removeAttribute(magazinePromotionHidden);
      magazinePromotions.clear();
      for (const target of targets) { if (!target.hasAttribute(magazinePromotionHidden)) target.setAttribute(magazinePromotionHidden, ""); magazinePromotions.add(target); }
    }
    function syncRecommendations(active) {
      const article = doc.querySelector('article[id="note-article"]');
      const root = article?.parentElement;
      const nextRoot = active && root?.tagName === "DIV" && !root.closest("article") && !root.closest('[id="note-body"]') ? root : null;
      for (const previous of recommendationRoots) {
        if (previous !== nextRoot || !previous.isConnected) { previous.classList.remove(recommendationRoot); recommendationRoots.delete(previous); }
      }
      if (nextRoot && !recommendationRoots.has(nextRoot)) { nextRoot.classList.add(recommendationRoot); recommendationRoots.add(nextRoot); }
      for (const element of recommendations) {
        if (!active || !element.isConnected || !isRecommendations(element)) {
          element.removeAttribute(recommendationsHidden); recommendations.delete(element);
        }
      }
      if (!active) return;
      for (const heading of doc.querySelectorAll("h2")) {
        if (heading.textContent.trim() !== "あなたへのおすすめ") continue;
        const element = heading.parentElement?.parentElement;
        if (element && isRecommendations(element) && !recommendations.has(element)) {
          element.setAttribute(recommendationsHidden, ""); recommendations.add(element);
        }
      }
    }
    const tips = new Map();
    let tipsDirty = true, tipsSignature;
    function tipContainer(section) {
      if (!section.isConnected || section.closest('[id="note-body"]') ||
          section.tagName !== "SECTION" || !section.classList.contains("bg-surface-quaternary") ||
          !section.classList.contains("flex-col")) return null;
      const heading = [...section.children].find(child => child.tagName === "H2");
      if (heading?.textContent.trim() !== "いいなと思ったら応援しよう！" ||
          ![...section.children].some(child => child.tagName === "BUTTON" && child.getAttribute("data-name") === "Button" &&
            child.getAttribute("type") === "button" && child.textContent.trim() === "チップで応援する")) return null;
      const inner = section.parentElement, outer = inner?.parentElement;
      return inner?.tagName === "DIV" && inner.children.length === 1 && outer?.tagName === "DIV" && outer.children.length === 1 &&
        ["mx-4", "mt-6", "mb-4"].every(name => outer.classList.contains(name)) ? outer : section;
    }
    function syncTips(settings, url) {
      const active = settings.enabled && settings.hidePaidArticles && (core.isArticle(url) || core.isPreviewArticle(url));
      const signature = JSON.stringify([active, url]);
      if (!tipsDirty && tipsSignature === signature) return;
      tipsDirty = false; tipsSignature = signature;
      for (const [section, container] of tips) {
        if (!active || tipContainer(section) !== container) { container.removeAttribute(tipHidden); tips.delete(section); }
      }
      if (!active) return;
      for (const heading of doc.querySelectorAll("h2")) {
        if (heading.textContent.trim() !== "いいなと思ったら応援しよう！") continue;
        const section = heading.parentElement, container = tipContainer(section);
        if (container && !tips.has(section)) { container.setAttribute(tipHidden, ""); tips.set(section, container); }
      }
    }
    function restore() {
      menu?.remove(); menu = undefined; host = undefined; signature = undefined;
      for (const element of originals) element.removeAttribute(hidden);
      originals.clear();
    }
    function isProductSection(section) {
      const headings = [...section.querySelectorAll("h2")];
      return headings.length === 1 && headings[0].classList.contains("sr-only") &&
        headings[0].textContent.trim() === "関連商品" && !section.querySelector("article") &&
        [...section.querySelectorAll(productCard)].some(card => card.closest("section") === section);
    }
    function syncProducts(active) {
      for (const section of products) {
        if (!active || !section.isConnected || !isProductSection(section)) {
          section.removeAttribute(productHidden); products.delete(section);
        }
      }
      if (!active) return;
      for (const card of doc.querySelectorAll(productCard)) {
        const section = card.closest("section");
        if (section && isProductSection(section) && !products.has(section)) {
          section.setAttribute(productHidden, ""); products.add(section);
        }
      }
    }
    function visible(element) {
      if (!element.isConnected || element.getBoundingClientRect().width <= 0) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (node.hidden || style.display === "none" || style.visibility === "hidden") return false;
      }
      return true;
    }
    let mobile;
    function closeMobile(focus = false) {
      if (!mobile) return;
      mobile.panel.hidden = true; mobile.button.setAttribute("aria-expanded", "false");
      if (focus) mobile.button.focus();
    }
    function removeMobile() {
      if (!mobile) return;
      const focusInside = mobile.panel.contains(doc.activeElement) || doc.activeElement === mobile.button;
      mobile.button.remove(); mobile.panel.remove(); mobile.parent.removeAttribute("data-hikikomori-note-mobile-logo");
      if (focusInside && mobile.logo.isConnected) mobile.logo.focus();
      mobile = undefined;
    }
    function syncMobile(active, url) {
      if (mobile && (!active || !mobile.panel.isConnected || logoContainer(mobile.logo) !== mobile.parent)) removeMobile();
      if (!active) return null;
      if (!mobile) {
        const logo = [...doc.querySelectorAll("header")].filter(isOfficialNavbar)
          .flatMap(header => [...header.querySelectorAll('a[href]')])
          .find(a => isOfficialHeaderLogo(a, currentUrl) && visible(a) && logoContainer(a));
        if (!logo) return null;
        const header = logo.closest("header"), parent = logo.parentElement;
        const panel = doc.createElement("div"); panel.setAttribute(owned, ""); panel.className = "hikikomori-note-mobile-panel";
        panel.setAttribute("id", "hikikomori-note-mobile-navigation"); panel.hidden = true;
        const button = doc.createElement("button"); button.type = "button"; button.setAttribute(owned, "");
        button.className = "hikikomori-note-mobile-toggle"; button.textContent = "☰";
        button.setAttribute("aria-label", "ナビゲーションメニュー"); button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "hikikomori-note-mobile-navigation");
        button.onclick = () => { panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden)); };
        const escape = event => { if (event.key === "Escape") { event.preventDefault(); closeMobile(true); } };
        button.onkeydown = escape; panel.onkeydown = escape;
        panel.onclick = event => { if (event.target?.closest("a[href]")) closeMobile(); };
        parent.prepend(button); parent.setAttribute("data-hikikomori-note-mobile-logo", ""); header.append(panel);
        mobile = { logo, parent, button, panel, url };
      }
      if (mobile.url !== url) {
        closeMobile(); mobile.url = url;
        const input = mobile.form?.querySelector('input[name="q"]');
        if (input) input.value = core.pageKind(url)?.type === "search" ? new URL(url).searchParams.get("q") || "" : "";
      }
      const header = mobile.logo.closest("header");
      const officialSearch = [...header.querySelectorAll('input[name="q"]')].some(input => !input.closest(`[${owned}]`) && visible(input));
      const needsSearch = ["following", "tag"].includes(core.pageKind(url)?.type) && !officialSearch;
      if (!needsSearch && mobile.form) { mobile.form.remove(); mobile.form = undefined; }
      if (needsSearch && !mobile.form) {
        const form = doc.createElement("form"); form.setAttribute("action", "https://note.com/search");
        form.setAttribute("method", "get"); form.setAttribute("role", "search"); form.className = "hikikomori-note-mobile-search";
        const input = doc.createElement("input"); input.setAttribute("type", "search"); input.setAttribute("name", "q");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("aria-label", "キーワードやクリエイターで検索"); input.setAttribute("placeholder", "キーワードやクリエイターで検索");
        const params = new URL(url).searchParams; input.value = core.pageKind(url)?.type === "search" ? params.get("q") || "" : "";
        for (const [name, value] of [["context", "note"], ["mode", "search"]]) {
          const field = doc.createElement("input"); field.setAttribute("type", "hidden"); field.setAttribute("name", name); field.value = value; form.append(field);
        }
        const submit = doc.createElement("button"); submit.type = "submit"; submit.textContent = "検索";
        form.prepend(input); form.append(submit); mobile.panel.prepend(form); mobile.form = form;
      }
      return mobile.panel;
    }
    function sidebar() {
      return navigationSidebars(doc).find(visible);
    }
    function profile(user) {
      return [...doc.querySelectorAll("aside")].find(element =>
        element.classList.contains("lg:w-96") && element.querySelector("h1") &&
        element.querySelector('[data-name="avatar"]') &&
        [...element.querySelectorAll("a[href]")].some(a => {
          const url = new URL(a.href);
          return url.origin === "https://note.com" && url.pathname === `/${user}/followings`;
        }) && visible(element));
    }
    const profilePromotions = new Set();
    const profilePromotionHidden = "data-hikikomori-note-profile-promotion-hidden";
    let profilePromotionsDirty = true, profilePromotionsSignature;
    function profilePaidMagazine(link, destination, user) {
      const parts = destination.pathname.replace(/\/$/, "").split("/");
      if (destination.origin !== "https://note.com" || parts.length !== 4 || parts[1] !== user || parts[2] !== "m" || !/^m[a-zA-Z0-9]+$/.test(parts[3]) ||
          !hasClasses(link, ["absolute", "inset-0"]) || !link.getAttribute("title") || !link.getAttribute("aria-label")) return null;
      const card = link.parentElement, list = card?.parentElement;
      if (card?.tagName !== "DIV" || !card.classList.contains("relative") || !card.querySelector("h3") || !card.querySelector("img")) return null;
      if (list?.tagName === "DIV" && hasClasses(list, ["flex", "flex-col", "gap-4"]) &&
          [...card.children].some(child => hasClasses(child, ["flex", "items-center", "gap-2"]))) {
        // サイド欄は「3件¥2,480」。既知の件数要素を除いた残りだけを価格として検証する。
        const paid = [...card.querySelectorAll("div[class]")].some(row => {
          if (!hasClasses(row, ["flex", "items-center", "gap-1", "font-bold", "text-text-success", "text-xs"])) return false;
          const count = row.children[0], text = row.textContent.trim(), prefix = count?.textContent.trim();
          return count?.tagName === "DIV" && count.classList.contains("text-text-primary") && count.querySelector("svg") &&
            /^[\d,]+件$/.test(prefix) && text.startsWith(prefix) && isPaidAmount(text.slice(prefix.length));
        });
        return paid ? card : null;
      }
      if (hasClasses(card, ["flex", "items-start", "gap-4", "bg-surface-normal", "py-4"]) &&
          list?.tagName === "LI" && hasClasses(list, ["border-border-default", "border-b"]) &&
          list.children.length === 1 && list.parentElement?.tagName === "UL" && list.parentElement.classList.contains("grid")) {
        const priceArea = [...card.children].find(child => hasClasses(child, ["relative", "z-10", "ml-auto"]));
        return priceArea && [...priceArea.querySelectorAll("span[class]")].some(isPaidPrice) ? list : null;
      }
      return null;
    }
    function syncProfilePromotions(settings, url) {
      const signature = JSON.stringify([url, settings.enabled, settings.hidePaidArticles, settings.noteUserId, settings.authorDisplayRules, settings.authorWarning]);
      if (!profilePromotionsDirty && signature === profilePromotionsSignature) return;
      profilePromotionsDirty = false; profilePromotionsSignature = signature;
      const targets = new Set(), page = core.pageKind(url);
      const active = settings.enabled && settings.hidePaidArticles && settings.noteUserId && !settings.authorWarning &&
        page?.type === "profile" && new URL(url).pathname.replace(/\/$/, "") !== `/${page.user}/store` &&
        !core.isSelf(settings, page.user) && !isAllowedAuthor(settings, page.user);
      // 表示管理UIと同じ確認済み作者を使う。TL用asideの形に依存させない。
      const author = active ? authorControls.profileOwner() : null;
      const main = author && author.userId === page?.user ? author.host.closest('[id="main-content"]') : null;
      if (main) {
        const groups = new Set();
        const planGroups = new Map();
        const profileListing = [`/${page.user}`, `/${page.user}/all`, `/${page.user}/magazines`, `/${page.user}/likes`, `/${page.user}/archives`].includes(new URL(url).pathname.replace(/\/$/, ""));
        function promotionalGroup(wrapper) {
          const group = wrapper?.parentElement;
          if (group?.tagName !== "DIV") return null;
          const desktop = hasClasses(group, ["mb-8", "flex", "flex-col", "items-stretch", "gap-4", "empty:mb-0"]);
          const carousel = hasClasses(group, ["flex", "items-stretch", "gap-2"]) &&
            hasClasses(group.parentElement, ["flex", "flex-nowrap", "overflow-auto"]) &&
            hasClasses(group.parentElement.parentElement, ["mt-4", "block", "empty:hidden", "lg:hidden"]);
          return desktop || carousel ? group : null;
        }
        for (const link of main.querySelectorAll("a[href]")) {
          if (link.closest("article") || link.closest('[id="note-body"]') || link.closest(`[${owned}]`)) continue;
          let destination;
          try { destination = new URL(link.href); } catch { continue; }
          const card = link.parentElement;
          if (profileListing) {
            const magazine = profilePaidMagazine(link, destination, page.user);
            if (magazine) targets.add(magazine);
          }
          if (profileListing &&
              destination.origin === "https://note.com" && destination.pathname === `/${page.user}/membership/join` &&
              link.classList.contains("absolute") && link.classList.contains("inset-0") &&
              card.tagName === "DIV" && card.classList.contains("relative") && card.querySelector("h3")) {
            const list = card.parentElement, section = list?.parentElement;
            const membership = section?.tagName === "SECTION" && [...section.querySelectorAll("h2")].some(heading =>
              [...heading.querySelectorAll("a[href]")].some(a => {
                try { const u = new URL(a.href); return u.origin === "https://note.com" && u.pathname === `/${page.user}/membership`; } catch { return false; }
              }));
            const monthly = [...card.querySelectorAll("p[class]")].some(p => p.classList.contains("text-text-success") && /^¥\s*[1-9]\d*(?:,\d{3})*\s*\/\s*月/.test(p.textContent.trim()));
            const button = [...card.querySelectorAll('button[data-name="Button"]')].some(b => ["参加手続きへ", "募集終了"].includes(b.textContent.trim()));
            if (membership && monthly && button && list.tagName === "DIV" && hasClasses(list, ["my-4", "flex", "flex-col", "gap-4"])) {
              targets.add(card);
              if (!planGroups.has(list)) planGroups.set(list, new Set());
              planGroups.get(list).add(card);
            }
          }
          const overlay = link.classList.contains("absolute") && link.classList.contains("inset-0") && link.getAttribute("title") && link.getAttribute("aria-label");
          const amazon = overlay && destination.protocol === "https:" && ["amazon.co.jp", "www.amazon.co.jp"].includes(destination.hostname) &&
            /^\/(?:dp\/[A-Z0-9]+|[^/]+\/dp\/[A-Z0-9]+)\/?$/i.test(destination.pathname) && card.tagName === "SECTION" &&
            hasClasses(card, ["relative", "flex", "rounded-lg", "border-border-default", "bg-surface-normal", "p-4"]) && card.querySelector("h3") && card.querySelector('img[alt="商品画像"]');
          const storeItem = overlay && destination.protocol === "https:" && destination.origin !== "https://note.com" && card.tagName === "DIV" &&
            hasClasses(card, ["relative", "flex", "rounded-lg", "border-solid", "border-border-strong", "p-4", "items-center"]) &&
            card.querySelector("h3") && card.querySelector("img") && [...card.querySelectorAll("span[class]")].some(isPaidPrice);
          const storeButton = destination.origin === "https://note.com" && destination.pathname === `/${page.user}/store` &&
            link.getAttribute("data-name") === "Button" && link.textContent.trim() === "ストアをみる";
          const wrapper = storeButton ? link.parentElement : card.parentElement;
          const group = promotionalGroup(wrapper);
          if (!group || wrapper.tagName !== "DIV" || wrapper.children.length !== 1 || !(amazon || storeItem || storeButton)) continue;
          targets.add(wrapper); groups.add(group);
        }
        for (const [list, plans] of planGroups) {
          const children = [...list.children], separator = child => child.tagName === "HR" && child.classList.contains("border-border-default");
          if (children.every(child => plans.has(child) || separator(child))) targets.add(list);
          else children.forEach((child, index) => {
            if (separator(child) && plans.has(children[index - 1]) && plans.has(children[index + 1])) targets.add(child);
          });
        }
        for (const group of groups) {
          if (![...group.children].every(child => targets.has(child))) continue;
          targets.add(group);
          const scroll = group.parentElement, region = scroll?.parentElement;
          if (hasClasses(scroll, ["flex", "flex-nowrap", "overflow-auto"]) && scroll.children.length === 1 &&
              hasClasses(region, ["mt-4", "block", "empty:hidden", "lg:hidden"]) && region.children.length === 1) targets.add(region);
        }
      }
      for (const target of profilePromotions) if (!targets.has(target)) target.removeAttribute(profilePromotionHidden);
      profilePromotions.clear();
      for (const target of targets) { if (!target.hasAttribute(profilePromotionHidden)) target.setAttribute(profilePromotionHidden, ""); profilePromotions.add(target); }
    }
    function update(settings, url) {
      if (disposed) return;
      likeVisibility.update(settings, url);
      const profilePage = core.pageKind(url);
      if (profileLayout && (profilePage?.type !== "profile" || profilePage.user !== profileLayout.userId ||
          !profileLayout.root.isConnected || Object.values(profileLayout.slots).some(slot => slot.parentElement !== profileLayout.root))) {
        profileLayout.root.remove(); profileLayout = undefined; authorControls.invalidate();
      }
      prepareSidebar(url, settings);
      if (core.pageKind(currentUrl)?.tag !== core.pageKind(url)?.tag && !uncertain && !adding) actionMessage = "";
      currentSettings = settings; currentUrl = url;
      prepareProfilePaidAllowance(settings, url);
      syncPinnedHeader(settings, url);
      authorControls.update(settings, url);
      syncFavoriteProfile(settings);
      syncSearchClear(settings.enabled);
      syncHeaderSettings(settings.enabled && (core.modeOf(settings) === "social" || settings.noteLogoBrowserBack));
      syncLogoCursor(core.usesLogoBack(settings));
      const page = core.pageKind(url);
      syncArticleFollowing(settings, url);
      syncSideProfileFollow(settings, url);
      syncProducts(settings.enabled && core.usesFollowing(settings) && page?.type === "tag");
      syncRecommendations(settings.enabled && settings.hideArticleRecommendations === true && core.isArticle(url));
      syncNotesPromotions(settings, url);
      syncMembershipExamples(settings, url);
      syncMagazinePromotions(settings, url);
      syncHomeBanners(settings, url);
      syncTips(settings, url);
      syncPaidCards(settings, url);
      syncHomePaidRecommendations(settings, url);
      syncProfilePromotions(settings, url);
      if (!settings.enabled || !page || core.membershipPage(url) || page.type === "magazine" || !(page.type === "profile" ? core.usesFollowing(settings) : core.usesTags(settings))) { removeMobile(); restore(); pruneProfileLayout(); return; }
      const common = ["following", "tag", "search", "topic"].includes(page.type);
      const officialAside = common && (navigationSidebars(doc)[0] || [...doc.querySelectorAll("aside")].find(a => a.classList.contains("w-[11.375rem]") && a.classList.contains("sticky")));
      const compact = common && (officialAside ? !visible(officialAside) : win.matchMedia("(max-width: 1023px)").matches);
      const mobileHost = syncMobile(compact, url);
      const profileHost = page.type === "profile" ? profile(page.user) : null;
      let nextHost = mobileHost;
      if (!nextHost && profileHost) nextHost = profileSlot(authorControls.profileOwner() || { host: profileHost, userId: page.user }, "navigation");
      if (!nextHost && page.type !== "profile") nextHost = sidebar();
      if (!nextHost) { restore(); pruneProfileLayout(); return; }
      if (host !== nextHost || !menu?.isConnected) restore();
      host = nextHost;
      const group = core.selectedGroup(settings);
      const activeTag = selectedTag(page, url);
      const nextSignature = JSON.stringify([page, activeTag, settings.tagGroups, settings.selectedTagGroupId, settings.noteLogoBrowserBack, settings.tagWarning, adding, uncertain, actionMessage]);
      if (!menu) {
        menu = doc.createElement(page.type === "profile" ? "div" : "nav");
        menu.setAttribute(owned, "");
        menu.className = page.type === "profile"
          ? "hikikomori-note-navigation hikikomori-note-profile-navigation" : "hikikomori-note-navigation";
        menu.setAttribute("aria-label", page.type === "profile" ? "フォロー中のTLへの移動" : "ひきこもりnote ナビゲーション");
        if (host === mobileHost) host.append(menu);
        else host.prepend(menu);
      }
      if (signature !== nextSignature) {
        menu.replaceChildren();
        const following = doc.createElement("a"); following.href = "https://note.com/following";
        following.className = "hikikomori-note-navigation-following";
        following.textContent = "フォロー中のTL";
        if (page.type === "following") following.setAttribute("aria-current", "page");
        if (page.type === "profile" && favoriteProfile) {
          const row = doc.createElement("div"); row.className = "hikikomori-note-profile-actions";
          row.append(favoriteProfile.toggle, following); menu.append(row);
        } else menu.append(following);
        if (page.type !== "profile") {
          let registered = false;
          if (page.type === "tag") {
            let normalized;
            try { normalized = core.normalizeTag(page.tag); } catch { /* 空タグ等は登録不可 */ }
            registered = group.tags.includes(normalized);
            if (!registered) {
              const button = doc.createElement("button"); button.type = "button";
              button.textContent = adding ? "保存中…" : "タグをお気に入りに追加";
              button.setAttribute("aria-label", `# ${page.tag}：${button.textContent}`);
              button.disabled = !normalized || adding || uncertain || Boolean(settings.tagWarning) || settings.groupSelectionInvalid || !actions.addCurrentTag;
              button.setAttribute("data-tag-add", "");
              button.onclick = () => { void addTag(page.tag); }; menu.append(button);
            }
          }
          const status = doc.createElement("span"); status.className = "hikikomori-note-tag-status";
          status.setAttribute("role", "status"); status.textContent = settings.tagWarning || (settings.groupSelectionInvalid ? "グループを選び直してください。" : actionMessage);
          menu.append(status);
          if (actionMessage && (!registered || uncertain) && actions.refresh) {
            const refresh = doc.createElement("button"); refresh.type = "button"; refresh.textContent = "状態を再確認";
            refresh.disabled = adding; refresh.onclick = () => { void refreshTags(); }; menu.append(refresh);
          }
          const title = doc.createElement("p"); title.textContent = "お気に入り"; menu.append(title);
          const selector = doc.createElement("div"); selector.className = "hikikomori-note-group-selector";
          selector.setAttribute("role", "group"); selector.setAttribute("aria-label", "お気に入りのグループ");
          settings.tagGroups.forEach((item, index) => {
            const button = doc.createElement("button"); button.type = "button"; button.textContent = ["①", "②", "③", "④"][index];
            button.setAttribute("data-group-id", item.id); button.setAttribute("title", core.groupName(item));
            button.setAttribute("aria-label", `${button.textContent} ${core.groupName(item)}`);
            button.setAttribute("aria-pressed", String(item.id === group.id));
            button.disabled = adding || uncertain || Boolean(settings.tagWarning) || !actions.selectGroup;
            button.onclick = () => { void selectGroup(item.id); }; selector.append(button);
          });
          menu.append(selector);
          const name = doc.createElement("div"); name.className = "hikikomori-note-group-name"; name.textContent = core.groupName(group); name.setAttribute("title", name.textContent); menu.append(name);
          const list = doc.createElement("ul"); menu.append(list);
          for (const tag of group.tags) {
            const item = doc.createElement("li"), link = doc.createElement("a");
            link.textContent = core.favoriteLabel(tag); link.href = core.favoriteUrl(tag);
            if (["magazine", "membership"].includes(tag?.type)) link.prepend(favoriteIcon(doc, tag.type));
            link.setAttribute("title", typeof tag === "string" ? core.favoriteLabel(tag) : `${tag.type === "magazine" ? `${core.favoriteLabel(tag)} (${tag.userId}/${tag.magazineId})` : core.authorLabel(tag)}（新しいタブで開く）`);
            if (typeof tag !== "string") {
              link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer");
              link.setAttribute("aria-label", `${tag.type === "membership" ? "メンバーシップ：" : tag.type === "magazine" ? "マガジン：" : ""}${core.favoriteLabel(tag)}（新しいタブで開く）`);
            }
            if (activeTag === tag) link.setAttribute("aria-current", "page");
            item.append(link); list.append(item);
          }
        }
        signature = nextSignature;
      }
      if (page.type === "profile" && favoriteProfile) {
        let row = menu.querySelector('[class="hikikomori-note-profile-actions"]');
        if (!row) {
          const following = menu.querySelector('[class="hikikomori-note-navigation-following"]');
          row = doc.createElement("div"); row.className = "hikikomori-note-profile-actions"; row.append(following); menu.prepend(row);
        }
        if (favoriteProfile.toggle.parentElement !== row) row.prepend(favoriteProfile.toggle);
      }
      // 独自メニューを挿入できてから、確認済み左カラム直下の公式メニューだけを隠す。
      if (page.type !== "profile" && host !== mobileHost) {
        for (const element of host.children) {
          if (element === menu) continue;
          if (!originals.has(element)) { element.setAttribute(hidden, ""); originals.add(element); }
        }
      }
      for (const element of originals) if (!element.isConnected || element.parentElement !== host) { element.removeAttribute(hidden); originals.delete(element); }
      pruneProfileLayout();
    }
    return Object.freeze({
      update, prepareSidebar,
      invalidatePaidCards() {
        likeVisibility.invalidate();
        authorControls.invalidate();
        notesPromotionsDirty = true;
        membershipExamplesDirty = true;
        magazinePromotionsDirty = true;
        homeBannersDirty = true;
        paidDirty = true;
        tipsDirty = true;
        profilePromotionsDirty = true;
      },
      stop() {
        likeVisibility.stop();
        for (const root of sidebarRoots) root.classList.remove(rootClass);
        sidebarRoots.clear();
        authorControls.stop();
        disposed = true;
        profilePaidAllowance = undefined;
        favoriteProfile?.toggle.remove(); favoriteProfile?.block.remove(); favoriteProfile?.mount?.remove(); favoriteProfile = undefined;
        profileLayout?.root.remove(); profileLayout = undefined;
        syncPinnedHeader({ enabled: false }, currentUrl);
        removeMobile();
        syncHeaderSettings(false);
        syncLogoCursor(false);
        syncSearchClear(false);
        articleFollowing?.remove();
        articleFollowing = undefined;
        clearArticleAuthor();
        syncSideProfiles(false);
        for (const profile of sideProfileFollowRoots) profile.removeAttribute(sideProfileFollowHidden);
        sideProfileFollowRoots.clear();
        restore();
        syncProducts(false);
        syncRecommendations(false);
        for (const root of notesPromotionRoots) root.removeAttribute(notesPromotionRoot);
        notesPromotionRoots.clear();
        for (const target of membershipExamples) target.removeAttribute(membershipExamplesHidden);
        membershipExamples.clear();
        for (const target of magazinePromotions) target.removeAttribute(magazinePromotionHidden);
        magazinePromotions.clear();
        for (const target of homeBanners) target.removeAttribute(homeBannerHidden);
        homeBanners.clear();
        for (const container of tips.values()) container.removeAttribute(tipHidden);
        tips.clear();
        for (const container of paidCards.values()) container.removeAttribute(paidHidden);
        paidCards.clear();
        homePaidRoot?.removeAttribute(homePaidHidden); homePaidRoot = undefined;
        for (const target of profilePromotions) target.removeAttribute(profilePromotionHidden);
        profilePromotions.clear();
      }
    });
  }
  // 作者設定は通常のナビゲーションと独立。重度・拡張OFFでも手動管理を残す。
  function createAuthorControls(doc, win, actions, profileSlot) {
    const marker = "data-hikikomori-note-author-hidden", hiddenCards = new Map();
    let settings, url, dirty = true, cardSignature, disposed = false;
    let dialog, dialogContext, previousFocus, askedArticle, profileBlock, profileContext, profileSelect, currentProfileOwner;
    let busy = false, uncertain = false, recoveryNeeded = false, currentArticle, lastSettings;
    function visible(element) {
      if (!element?.isConnected) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (node.hidden || node.hasAttribute("hidden") || style.display === "none" || style.visibility === "hidden") return false;
      }
      return true;
    }
    function idFromLink(link) {
      try { return core.authorId(link.href); } catch { return null; }
    }
    function displayName(element) {
      try { return core.authorName(element?.textContent?.trim() || ""); } catch { return ""; }
    }
    function headerAuthor(article, userId) {
      for (const time of article.querySelectorAll("time")) {
        if (time.closest('[id="note-body"]') || time.closest('[id="note-paywall"]')) continue;
        let root = time.parentElement;
        for (let depth = 0; root && root !== article && depth < 4; depth++, root = root.parentElement) {
          const links = [...root.querySelectorAll("a[href]")].filter(a => idFromLink(a)?.toLowerCase() === userId.toLowerCase());
          const name = links.map(displayName).find(Boolean);
          if (name) return { userId, displayName: name };
        }
      }
      return null;
    }
    function cardAuthor(card, link) {
      const userId = cardCreatorId(card, link);
      return userId ? { userId } : null;
    }
    function containerFor(card) { return articleCardContainer(card); }
    function syncCards() {
      const signature = JSON.stringify([url, settings.enabled, settings.noteUserId, settings.authorDisplayRules, settings.authorWarning]);
      if (!dirty && signature === cardSignature) return;
      dirty = false; cardSignature = signature;
      for (const container of hiddenCards.values()) container.removeAttribute(marker);
      hiddenCards.clear();
      let active = false;
      try { const page = new URL(url); active = page.origin === "https://note.com" && !/^\/notes\/purchased(?:\/|$)/.test(page.pathname) && core.pageKind(url)?.type !== "profile"; } catch { /* 表示を維持 */ }
      if (!active || !settings.enabled || !settings.noteUserId || settings.authorWarning || !settings.authorDisplayRules.some(rule => rule.action === "hide")) return;
      for (const link of doc.querySelectorAll("a[href]")) {
        if (!core.isArticle(link.href) || !link.classList.contains("absolute") || !link.classList.contains("inset-0") || !link.getAttribute("title") || !link.getAttribute("aria-label")) continue;
        const card = link.parentElement?.parentElement;
        if (!card?.classList.contains("grid-rows-subgrid") || !link.parentElement.querySelector("h3") || card.closest("article") || card.closest('[id="note-body"]')) continue;
        const author = cardAuthor(card, link);
        if (!author || core.isSelf(settings, author.userId) || core.authorRule(settings, author.userId)?.action !== "hide") continue;
        const container = containerFor(card); container.setAttribute(marker, ""); hiddenCards.set(card, container);
      }
    }
    function paidArticle() {
      if (!settings.enabled || !settings.hidePaidArticles || !settings.noteUserId || settings.authorWarning || !core.isArticle(url)) return null;
      const userId = new URL(url).pathname.split("/")[1];
      if (core.isSelf(settings, userId) || core.authorRule(settings, userId)) return null;
      const article = doc.querySelector('article[id="note-article"]');
      const paywall = article?.querySelector('div[id="note-paywall"]');
      if (!paywall || paywall.closest('[id="note-body"]') || !visible(paywall) || !paywall.classList.contains("note-paywall")) return null;
      const root = [...paywall.children].find(n => n.tagName === "SECTION");
      if (!root || ![...root.querySelectorAll("h2")].some(h => h.textContent.trim() === "ここから先は")) return null;
      const author = headerAuthor(article, userId);
      if (!author) return null;
      for (const block of root.querySelectorAll("section")) {
        if (!["flex", "flex-col", "rounded-lg", "border", "border-border-strong", "px-4"].every(c => block.classList.contains(c)) || !visible(block)) continue;
        const buttons = [...block.querySelectorAll('button[data-name="Button"]')].filter(b => b.getAttribute("type") === "button" && visible(b));
        const purchase = buttons.some(b => b.textContent.trim() === "購入手続きへ");
        const join = buttons.some(b => b.textContent.trim() === "参加手続きへ");
        const spans = [...block.querySelectorAll("span")];
        const price = spans.some(n => /^¥\s*[1-9]\d*(?:,\d{3})*\s*$/.test(n.textContent.trim()));
        const membership = [...block.querySelectorAll("a[href]")].some(a => {
          try { const p = new URL(a.href); return p.origin === "https://note.com" && p.pathname === `/${userId}/membership`; } catch { return false; }
        });
        if ((purchase && price && spans.some(n => n.textContent.trim() === "記事")) || (join && membership)) return author;
      }
      return null;
    }
    function closeDialog() {
      const focus = previousFocus, modal = dialog;
      dialog = undefined; dialogContext = undefined; previousFocus = undefined;
      if (modal) { if (modal.open && typeof modal.close === "function") modal.close(); modal.remove(); }
      if (focus?.isConnected) focus.focus();
    }
    function snapshot(author) {
      // プロフィール探索結果のhost等、DOM参照をメッセージへ含めない。
      return { userId: author.userId, displayName: author.displayName, expectedAction: core.authorRule(settings, author.userId)?.action ?? null,
        expectedRevision: settings.authorDisplayRevision, expectedSelf: settings.noteUserId };
    }
    async function save(author, action, source, status, context) {
      if (busy || uncertain || disposed) return false;
      busy = true;
      const operation = { ...context, action };
      status.textContent = "保存しています…";
      try {
        if (!actions.setAuthor) throw new Error("保存処理を利用できません。");
        await actions.setAuthor(operation, source);
        recoveryNeeded = false;
        status.textContent = "保存しました。";
        return true;
      } catch (error) {
        uncertain = error.code === "UNCONFIRMED";
        recoveryNeeded = true;
        status.textContent = `保存できませんでした。${error.message} 「状態を再確認」で確認してください。`;
        return false;
      } finally { busy = false; refreshDisabled(); }
    }
    function refreshDisabled() {
      for (const block of [dialog, profileBlock]) if (block) {
        for (const button of block.querySelectorAll("button")) button.disabled = busy || (uncertain && !button.hasAttribute("data-author-refresh"));
        const refresh = block.querySelector('button[data-author-refresh]');
        if (refresh) refresh.hidden = !recoveryNeeded;
      }
      if (profileSelect) profileSelect.disabled = busy || uncertain || !settings?.noteUserId || Boolean(settings.authorWarning);
      const saveButton = profileBlock?.querySelector('button[data-author-save]');
      if (saveButton && (!settings?.noteUserId || settings.authorWarning)) saveButton.disabled = true;
    }
    function refreshButton(block, status) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = "状態を再確認"; button.setAttribute("data-author-refresh", "");
      button.hidden = !recoveryNeeded;
      button.onclick = async () => {
        if (busy) return;
        const wasDialog = Boolean(dialog); let refreshed = false;
        busy = true; refreshDisabled();
        try { await actions.refresh(); uncertain = false; recoveryNeeded = false; refreshed = true; status.textContent = "保存済みの状態を確認しました。もう一度操作してください。"; }
        catch { recoveryNeeded = true; status.textContent = "状態を確認できませんでした。"; }
        finally {
          busy = false;
          if (refreshed) {
            closeDialog(); if (wasDialog) askedArticle = undefined;
            profileContext = undefined; dirty = true; if (!disposed && settings) update(settings, url);
          } else refreshDisabled();
        }
      };
      block.append(button);
    }
    function showDialog(author) {
      const modal = doc.createElement("dialog");
      if (typeof modal.showModal !== "function") return;
      modal.setAttribute(owned, ""); modal.className = "hikikomori-note-author-dialog";
      const heading = doc.createElement("h2"); heading.id = "hikikomori-note-author-dialog-title"; heading.setAttribute("id", heading.id); heading.textContent = "有料記事を検出しました　この作者の記事を今後どう表示しますか？";
      modal.setAttribute("aria-labelledby", heading.id);
      const creator = doc.createElement("p"); creator.textContent = `作者：${core.authorLabel(author)}。`;
      const description = doc.createElement("p"); description.textContent = "「非表示」にすると無料記事も一覧から非表示になります。記事や作者ページへの直接アクセスは制限しません。「表示を許可」した作者は、有料記事も一覧に表示します。";
      const status = doc.createElement("p"); status.setAttribute("role", "status");
      modal.append(heading, creator, description, status);
      const context = snapshot(author); let dismiss;
      for (const [text, action] of [["この作者を非表示にする", "hide"], ["この作者の表示を許可する", "allow"], ["今回は何もしない", null]]) {
        const button = doc.createElement("button"); button.type = "button"; button.textContent = text;
        button.onclick = async () => {
          if (action === null) { if (!busy) closeDialog(); return; }
          if (dialog !== modal || !core.isArticle(url) || currentArticle !== dialogContext) return;
          const result = save(author, action, "article", status, context); refreshDisabled();
          if (await result) closeDialog();
        };
        modal.append(button); if (action === null) dismiss = button;
      }
      refreshButton(modal, status);
      modal.addEventListener("cancel", event => { event.preventDefault(); if (!busy) closeDialog(); });
      modal.addEventListener("close", () => { if (dialog === modal) { modal.remove(); dialog = undefined; dialogContext = undefined; if (previousFocus?.isConnected) previousFocus.focus(); } });
      (doc.body || doc.documentElement || doc.root).append(modal);
      previousFocus = doc.activeElement; dialog = modal; dialogContext = currentArticle;
      try { modal.showModal(); dismiss.focus(); } catch { closeDialog(); }
    }
    function profileOwner() {
      const page = core.pageKind(url);
      if (page?.type !== "profile" || core.membershipPage(url)) return null;
      for (const heading of doc.querySelectorAll("h1")) {
        if (heading.closest("article") || heading.closest(`[${owned}]`)) continue;
        let root = heading.parentElement;
        for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
          if (![...root.querySelectorAll("a[href]")].some(a => {
            try { const u = new URL(a.href); return u.origin === "https://note.com" && u.pathname === `/${page.user}/followings`; } catch { return false; }
          }) || !root.querySelector('[data-name="avatar"]')) continue;
          if (visible(root)) return { host: root, userId: core.authorId(page.user), displayName: displayName(heading) };
        }
      }
      return null;
    }
    function syncProfile() {
      const owner = profileOwner();
      currentProfileOwner = owner;
      if (!owner || core.isSelf(settings, owner.userId)) { profileBlock?.remove(); profileBlock = undefined; profileContext = undefined; return; }
      const slot = profileSlot(owner, "author");
      const context = JSON.stringify([owner.userId, owner.displayName, settings.noteUserId, settings.authorWarning, core.authorRule(settings, owner.userId)]);
      if (profileBlock?.isConnected && context === profileContext && profileBlock.parentElement === slot) { refreshDisabled(); return; }
      profileBlock?.remove(); profileContext = context;
      profileBlock = doc.createElement("div"); profileBlock.setAttribute(owned, ""); profileBlock.className = "hikikomori-note-author-profile";
      const label = doc.createElement("label"), select = doc.createElement("select");
      label.textContent = "この作者の表示"; label.append(select); profileSelect = select;
      for (const [text, value] of [["未設定", ""], ["非表示", "hide"], ["表示を許可", "allow"]]) {
        const option = doc.createElement("option"); option.textContent = text; option.value = value; select.append(option);
      }
      select.value = core.authorRule(settings, owner.userId)?.action || "";
      const saveButton = doc.createElement("button"); saveButton.type = "button"; saveButton.textContent = "変更を保存"; saveButton.setAttribute("data-author-save", "");
      const help = doc.createElement("p"); help.textContent = settings.authorWarning || (!settings.noteUserId ? "自分を対象外にするため、専用ホームでnoteユーザー名を設定してください。" : "非表示にすると無料記事も一覧から隠します。記事や作者ページは直接開けます。表示を許可した作者は、有料記事も表示します。");
      const status = doc.createElement("p"); status.setAttribute("role", "status");
      saveButton.onclick = () => { const result = save(owner, select.value || null, "profile", status, snapshot(owner)); refreshDisabled(); void result; };
      profileBlock.append(label, saveButton, help, status); refreshButton(profileBlock, status); slot.append(profileBlock); refreshDisabled();
    }
    function update(value, pageUrl) {
      if (disposed) return;
      const urlChanged = url !== pageUrl;
      settings = value; url = pageUrl;
      const articleKey = core.isArticle(url) ? new URL(url).origin + new URL(url).pathname.replace(/\/$/, "") : null;
      if (currentArticle !== articleKey) { currentArticle = articleKey; askedArticle = undefined; closeDialog(); }
      const identity = JSON.stringify([settings.noteUserId, settings.enabled, settings.hidePaidArticles, settings.authorDisplayRevision, settings.authorWarning]);
      const scan = dirty || urlChanged || lastSettings !== identity;
      if (dialog && lastSettings !== identity) closeDialog();
      lastSettings = identity;
      if (dialog && scan && !paidArticle()) closeDialog();
      syncCards(); if (scan) syncProfile(); else refreshDisabled();
      if (doc.visibilityState === "hidden") return;
      if (scan && !dialog && currentArticle && askedArticle !== currentArticle && !busy && !uncertain) {
        const author = paidArticle();
        if (author) { askedArticle = currentArticle; showDialog(author); }
      }
    }
    function onVisibility() { dirty = true; if (!disposed && settings) update(settings, url); }
    doc.addEventListener?.("visibilitychange", onVisibility);
    return { update, profileOwner: () => currentProfileOwner, invalidate() { dirty = true; }, stop() {
      disposed = true; closeDialog(); profileBlock?.remove();
      for (const container of hiddenCards.values()) container.removeAttribute(marker);
      hiddenCards.clear(); doc.removeEventListener?.("visibilitychange", onVisibility);
    } };
  }
  globalThis.HikikomoriNoteUi = Object.freeze({ create, isOfficialHeaderLogo });
})();
