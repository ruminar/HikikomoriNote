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
      Boolean(anchor.closest('header[data-header-state="navbar"]') || (isManagementPage(url) && anchor.closest("header"))) &&
      [...anchor.querySelectorAll('svg[aria-label="note"]')].some(svg => svg.getAttribute("role") === "img");
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
  function create(doc, win, actions = {}) {
    const authorControls = createAuthorControls(doc, win, actions);
    let host, menu, signature;
    let articleFollowing;
    let articleAuthor, authorSignature;
    let currentSettings, currentUrl, adding = false, uncertain = false, actionMessage = "", disposed = false;
    function repaint() { if (!disposed && currentSettings) update(currentSettings, currentUrl); }
    async function addTag(tag) {
      if (adding || uncertain || !currentSettings?.enabled || currentSettings.legacyMode ||
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
    const gridClasses = ["lg:grid-cols-[202px_minmax(0,1fr)]", "lg:grid-cols-[12.625rem_minmax(0,1fr)]"];
    const isSidebarGrid = root => gridClasses.some(name => root.classList.contains(name));
    function prepareSidebar(url, settings) {
      if (disposed) return;
      const active = (!settings || (settings.enabled && !settings.legacyMode)) &&
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
          !input.closest('header[data-header-state="navbar"]') ||
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
    const paidHidden = "data-hikikomori-note-paid-hidden";
    const membershipLock = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2Z";
    function isMembershipLock(path) {
      return path.getAttribute("d") === membershipLock && Boolean(path.closest("svg") && path.closest("h3"));
    }
    function isPaidPrice(price) {
      return price.classList.contains("text-text-success") && /^¥\s*[1-9]\d*(?:,\d{3})*\s*[〜～]?\s*$/.test(price.textContent.trim());
    }
    let paidDirty = true, paidSignature;
    function isPaidCard(card) {
      if (!card.isConnected || card.closest('article') || card.closest('[id="note-body"]')) return false;
      return [...card.querySelectorAll('a[href]')].some(link =>
        link.parentElement?.parentElement === card && link.classList.contains("absolute") &&
        link.classList.contains("inset-0") && link.getAttribute("title") && link.getAttribute("aria-label") && core.isArticle(link.href) &&
        link.parentElement.querySelector("h3") &&
        ([...link.parentElement.querySelectorAll("span[class]")].some(isPaidPrice) ||
          [...link.parentElement.querySelectorAll("path[d]")].some(isMembershipLock)));
    }
    function paidCardContainer(card) { return articleCardContainer(card); }
    function syncPaidCards(settings, url) {
      let active = false;
      try {
        const page = new URL(url);
        active = settings.enabled && settings.hidePaidArticles === true && page.origin === "https://note.com" &&
          !/^\/notes\/purchased(?:\/|$)/.test(page.pathname);
      } catch { /* 不明なURLでは解除 */ }
      const signature = JSON.stringify([active, url]);
      if (!paidDirty && paidSignature === signature) return;
      paidDirty = false; paidSignature = signature;
      for (const [card, container] of paidCards) {
        if (!active || !isPaidCard(card) || paidCardContainer(card) !== container) {
          container.removeAttribute(paidHidden); paidCards.delete(card);
        }
      }
      if (!active) return;
      const prices = [...doc.querySelectorAll("span[class]")].filter(isPaidPrice);
      const locks = [...doc.querySelectorAll("path[d]")].filter(isMembershipLock);
      for (const indicator of [...prices, ...locks]) {
        let card = indicator.parentElement;
        for (let depth = 0; card && depth < 10; depth++, card = card.parentElement) {
          if (!card.classList.contains("grid-rows-subgrid")) continue;
          if (isPaidCard(card)) {
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
    function syncSideProfiles(active) {
      const current = new Set();
      if (active) {
        for (const profile of doc.querySelectorAll('[data-testid="side-creator-profile"]')) {
          const container = profile.parentElement;
          if (profile.closest("article") || profile.closest('[id="note-body"]') ||
              container?.tagName !== "DIV" || !["fixed", "top-24", "left-8"].every(name => container.classList.contains(name))) continue;
          const offset = articleAuthor?.isConnected ? "author" : "following";
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
      const show = settings.enabled && !settings.legacyMode && (core.isArticle(url) || core.isPreviewArticle(url)) &&
        win.matchMedia("(min-width: 1100px)").matches && article && visible(article) &&
        article.getBoundingClientRect().left >= 228 && doc.body;
      if (!show) { articleFollowing?.remove(); articleFollowing = undefined; clearArticleAuthor(); syncSideProfiles(false); return; }
      if (!articleFollowing?.isConnected) {
        articleFollowing = doc.createElement("a");
        articleFollowing.setAttribute(owned, "");
        articleFollowing.className = "hikikomori-note-article-following";
        articleFollowing.href = "https://note.com/following";
        articleFollowing.textContent = "フォロー中のTL";
        doc.body.append(articleFollowing);
      }
      syncArticleAuthor(article, url);
      syncSideProfiles(true);
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
        const logo = [...doc.querySelectorAll('header[data-header-state="navbar"]')]
          .flatMap(header => [...header.querySelectorAll('a[href]')])
          .find(a => isOfficialHeaderLogo(a, currentUrl) && visible(a) && logoContainer(a));
        if (!logo) return null;
        const header = logo.closest('header[data-header-state="navbar"]'), parent = logo.parentElement;
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
      const header = mobile.logo.closest('header[data-header-state="navbar"]');
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
      return [...doc.querySelectorAll("aside")].find(element =>
        element.classList.contains("w-[11.375rem]") && element.classList.contains("sticky") &&
        element.querySelector('nav[aria-label="急上昇"]') && visible(element));
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
    function update(settings, url) {
      if (disposed) return;
      prepareSidebar(url, settings);
      if (core.pageKind(currentUrl)?.tag !== core.pageKind(url)?.tag && !uncertain && !adding) actionMessage = "";
      currentSettings = settings; currentUrl = url;
      authorControls.update(settings, url);
      syncSearchClear(settings.enabled);
      syncHeaderSettings(settings.enabled && settings.noteLogoBrowserBack);
      syncLogoCursor(settings.enabled && settings.noteLogoBrowserBack);
      const page = core.pageKind(url);
      syncArticleFollowing(settings, url);
      syncProducts(settings.enabled && !settings.legacyMode && page?.type === "tag");
      syncRecommendations(settings.enabled && settings.hideArticleRecommendations === true && core.isArticle(url));
      syncTips(settings, url);
      syncPaidCards(settings, url);
      if (!settings.enabled || settings.legacyMode || !page) { removeMobile(); restore(); return; }
      const common = ["following", "tag", "search", "topic"].includes(page.type);
      const officialAside = common && [...doc.querySelectorAll("aside")].find(a => a.classList.contains("w-[11.375rem]") && a.classList.contains("sticky"));
      const compact = common && (officialAside ? !visible(officialAside) : win.matchMedia("(max-width: 1023px)").matches);
      const mobileHost = syncMobile(compact, url);
      const nextHost = mobileHost || (page.type === "profile" ? profile(page.user) : sidebar());
      if (!nextHost) { restore(); return; }
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
        menu.append(following);
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
          const title = doc.createElement("p"); title.textContent = "お気に入りタグ"; menu.append(title);
          const selector = doc.createElement("div"); selector.className = "hikikomori-note-group-selector";
          selector.setAttribute("role", "group"); selector.setAttribute("aria-label", "お気に入りタグのグループ");
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
            link.textContent = `# ${tag}`; link.href = core.tagUrl(tag);
            link.setAttribute("title", `# ${tag}`);
            if (activeTag === tag) link.setAttribute("aria-current", "page");
            item.append(link); list.append(item);
          }
        }
        signature = nextSignature;
      }
      // 独自メニューを挿入できてから、aside直下の公式メニューだけを隠す。
      if (page.type !== "profile" && host !== mobileHost) {
        for (const element of host.children) {
          if (element === menu) continue;
          if (!originals.has(element)) { element.setAttribute(hidden, ""); originals.add(element); }
        }
      }
      for (const element of originals) if (!element.isConnected || element.parentElement !== host) { element.removeAttribute(hidden); originals.delete(element); }
    }
    return Object.freeze({
      update, prepareSidebar,
      invalidatePaidCards() {
        authorControls.invalidate();
        paidDirty = true;
        tipsDirty = true;
      },
      stop() {
        for (const root of sidebarRoots) root.classList.remove(rootClass);
        sidebarRoots.clear();
        authorControls.stop();
        disposed = true;
        removeMobile();
        syncHeaderSettings(false);
        syncLogoCursor(false);
        syncSearchClear(false);
        articleFollowing?.remove();
        articleFollowing = undefined;
        clearArticleAuthor();
        syncSideProfiles(false);
        restore();
        syncProducts(false);
        syncRecommendations(false);
        for (const container of tips.values()) container.removeAttribute(tipHidden);
        tips.clear();
        for (const container of paidCards.values()) container.removeAttribute(paidHidden);
        paidCards.clear();
      }
    });
  }
  // 作者設定は通常のナビゲーションと独立。重度・拡張OFFでも手動管理を残す。
  function createAuthorControls(doc, win, actions) {
    const marker = "data-hikikomori-note-author-hidden", hiddenCards = new Map();
    let settings, url, dirty = true, cardSignature, disposed = false;
    let dialog, dialogContext, previousFocus, askedArticle, profileBlock, profileContext, profileSelect;
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
      try {
        const userId = core.authorId(new URL(link.href).pathname.split("/")[1]);
        const profile = [...card.querySelectorAll('a[data-name="avatar"]')].find(a => idFromLink(a)?.toLowerCase() === userId.toLowerCase());
        return profile ? { userId } : null;
      } catch { return null; }
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
      const description = doc.createElement("p"); description.textContent = "「非表示」にすると無料記事も一覧から非表示になります。記事や作者ページへの直接アクセスは制限しません。「表示を許可」でも「有料記事を非表示」の設定は適用されます。";
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
      if (page?.type !== "profile" || core.isSelf(settings, page.user)) return null;
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
      if (!owner) { profileBlock?.remove(); profileBlock = undefined; profileContext = undefined; return; }
      const context = JSON.stringify([owner.userId, owner.displayName, settings.noteUserId, settings.authorWarning, core.authorRule(settings, owner.userId)]);
      if (profileBlock?.isConnected && context === profileContext && profileBlock.parentElement === owner.host) { refreshDisabled(); return; }
      profileBlock?.remove(); profileContext = context;
      profileBlock = doc.createElement("div"); profileBlock.setAttribute(owned, ""); profileBlock.className = "hikikomori-note-author-profile";
      const label = doc.createElement("label"), select = doc.createElement("select");
      label.textContent = "この作者の表示"; label.append(select); profileSelect = select;
      for (const [text, value] of [["未設定", ""], ["非表示", "hide"], ["表示を許可", "allow"]]) {
        const option = doc.createElement("option"); option.textContent = text; option.value = value; select.append(option);
      }
      select.value = core.authorRule(settings, owner.userId)?.action || "";
      const saveButton = doc.createElement("button"); saveButton.type = "button"; saveButton.textContent = "変更を保存"; saveButton.setAttribute("data-author-save", "");
      const help = doc.createElement("p"); help.textContent = settings.authorWarning || (!settings.noteUserId ? "自分を対象外にするため、専用ホームでnoteユーザー名を設定してください。" : "非表示にすると無料記事も一覧から隠します。記事や作者ページは直接開けます。表示許可でも有料記事の非表示設定は適用されます。");
      const status = doc.createElement("p"); status.setAttribute("role", "status");
      saveButton.onclick = () => { const result = save(owner, select.value || null, "profile", status, snapshot(owner)); refreshDisabled(); void result; };
      profileBlock.append(label, saveButton, help, status); refreshButton(profileBlock, status); owner.host.prepend(profileBlock); refreshDisabled();
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
    return { update, invalidate() { dirty = true; }, stop() {
      disposed = true; closeDialog(); profileBlock?.remove();
      for (const container of hiddenCards.values()) container.removeAttribute(marker);
      hiddenCards.clear(); doc.removeEventListener?.("visibilitychange", onVisibility);
    } };
  }
  globalThis.HikikomoriNoteUi = Object.freeze({ create, isOfficialHeaderLogo });
})();
