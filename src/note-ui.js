/* 確認済みのナビゲーション・関連商品・記事おすすめ枠を扱う。詳細はdocs/note-dom.md。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const owned = "data-hikikomori-note-owned";
  const hidden = "data-hikikomori-note-menu-hidden";
  const productHidden = "data-hikikomori-note-product-hidden";
  const recommendationsHidden = "data-hikikomori-note-recommendations-hidden";
  const productCard = '[data-aicn-thing-card="true"], [data-testid="aicn-thing-card"]';
  function isOfficialHeaderLogo(anchor) {
    return anchor.isConnected && core.isHome(anchor.href) &&
      !anchor.closest("article") && !anchor.closest('[id="note-body"]') && !anchor.closest(`[${owned}]`) &&
      Boolean(anchor.closest('header[data-header-state="navbar"]')) &&
      [...anchor.querySelectorAll('svg[aria-label="note"]')].some(svg => svg.getAttribute("role") === "img");
  }
  function create(doc, win, actions = {}) {
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
    const paidCards = new Map();
    const paidHidden = "data-hikikomori-note-paid-hidden";
    let paidDirty = true, paidSignature;
    function isPaidCard(card) {
      if (!card.isConnected || card.closest('article') || card.closest('[id="note-body"]')) return false;
      return [...card.querySelectorAll('a[href]')].some(link =>
        link.parentElement?.parentElement === card && link.classList.contains("absolute") &&
        link.classList.contains("inset-0") && link.getAttribute("title") && link.getAttribute("aria-label") && core.isArticle(link.href) &&
        link.parentElement.querySelector("h3") && [...link.parentElement.querySelectorAll("span[class]")].some(price =>
          price.classList.contains("text-text-success") && /^¥\s*[1-9]\d*(?:,\d{3})*\s*$/.test(price.textContent.trim())));
    }
    function paidCardContainer(card) {
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
      for (const price of doc.querySelectorAll("span[class]")) {
        if (!price.classList.contains("text-text-success") || !/^¥\s*[1-9]\d*(?:,\d{3})*\s*$/.test(price.textContent.trim())) continue;
        let card = price.parentElement;
        for (let depth = 0; card && depth < 6; depth++, card = card.parentElement) {
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
    function syncArticleAuthor(article, url) {
      const profileUrl = core.profileUrl(new URL(url).pathname.split("/")[1]);
      let author;
      for (const time of article.querySelectorAll("time")) {
        if (time.closest('[id="note-body"]')) continue;
        let region = time.parentElement;
        for (let depth = 0; region && region !== article && depth < 4; depth++, region = region.parentElement) {
          if (region.querySelector('[id="note-body"]')) break;
          const avatar = region.querySelector('[data-name="avatar"]');
          const name = [...region.querySelectorAll("a[href]")].find(a => a.href === profileUrl && a.textContent.trim());
          if (!avatar || avatar.closest("a")?.href !== profileUrl || !name) continue;
          let image = "";
          try {
            const source = new URL(avatar.querySelector("img")?.getAttribute("src"));
            if (source.protocol === "https:" && source.hostname === "assets.st-note.com") image = source.href;
          } catch { /* 画像が不明な場合は名前だけ表示する */ }
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
      const show = settings.enabled && !settings.legacyMode && core.isArticle(url) &&
        win.matchMedia("(min-width: 1100px)").matches && article && visible(article) &&
        article.getBoundingClientRect().left >= 228 && doc.body;
      if (!show) { articleFollowing?.remove(); articleFollowing = undefined; clearArticleAuthor(); return; }
      if (!articleFollowing?.isConnected) {
        articleFollowing = doc.createElement("a");
        articleFollowing.setAttribute(owned, "");
        articleFollowing.className = "hikikomori-note-article-following";
        articleFollowing.href = "https://note.com/following";
        articleFollowing.textContent = "フォロー中のTL";
        doc.body.append(articleFollowing);
      }
      syncArticleAuthor(article, url);
    }
    function isRecommendations(element) {
      if (element.tagName !== "DIV" || !element.classList.contains("pt-6") ||
          element.closest("article") || element.closest('[id="note-body"]') || element.children.length !== 2) return false;
      const [title, list] = element.children;
      const headings = [...element.querySelectorAll("h2")];
      return title.tagName === "DIV" && title.children.length === 1 && headings.length === 1 &&
        title.children[0] === headings[0] && headings[0].textContent.trim() === "あなたへのおすすめ" &&
        list.tagName === "ASIDE" && list.getAttribute("aria-label") === "記事";
    }
    function syncRecommendations(active) {
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
      return element.isConnected && element.getBoundingClientRect().width > 0 && win.getComputedStyle(element).display !== "none";
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
      if (core.pageKind(currentUrl)?.tag !== core.pageKind(url)?.tag && !uncertain && !adding) actionMessage = "";
      currentSettings = settings; currentUrl = url;
      const page = core.pageKind(url);
      syncArticleFollowing(settings, url);
      syncProducts(settings.enabled && !settings.legacyMode && page?.type === "tag");
      syncRecommendations(settings.enabled && settings.hideArticleRecommendations === true && core.isArticle(url));
      syncPaidCards(settings, url);
      if (!settings.enabled || settings.legacyMode || !page) { restore(); return; }
      const nextHost = page.type === "profile" ? profile(page.user) : sidebar();
      if (!nextHost) { restore(); return; }
      if (host !== nextHost || !menu?.isConnected) restore();
      host = nextHost;
      const group = core.selectedGroup(settings);
      const nextSignature = JSON.stringify([page, settings.tagGroups, settings.selectedTagGroupId, settings.tagWarning, adding, uncertain, actionMessage]);
      if (!menu) {
        menu = doc.createElement(page.type === "profile" ? "div" : "nav");
        menu.setAttribute(owned, "");
        menu.className = page.type === "profile"
          ? "hikikomori-note-navigation hikikomori-note-profile-navigation" : "hikikomori-note-navigation";
        menu.setAttribute("aria-label", page.type === "profile" ? "フォロー中のTLへの移動" : "ひきこもりnote ナビゲーション");
        host.prepend(menu);
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
            if (page.type === "tag" && page.tag === tag) link.setAttribute("aria-current", "page");
            item.append(link); list.append(item);
          }
        }
        signature = nextSignature;
      }
      // 独自メニューを挿入できてから、aside直下の公式メニューだけを隠す。
      if (page.type !== "profile") {
        for (const element of host.children) {
          if (element === menu) continue;
          if (!originals.has(element)) { element.setAttribute(hidden, ""); originals.add(element); }
        }
      }
      for (const element of originals) if (!element.isConnected || element.parentElement !== host) { element.removeAttribute(hidden); originals.delete(element); }
    }
    return Object.freeze({ update, invalidatePaidCards() { paidDirty = true; }, stop() { disposed = true; articleFollowing?.remove(); articleFollowing = undefined; clearArticleAuthor(); restore(); syncProducts(false); syncRecommendations(false); for (const container of paidCards.values()) container.removeAttribute(paidHidden); paidCards.clear(); } });
  }
  globalThis.HikikomoriNoteUi = Object.freeze({ create, isOfficialHeaderLogo });
})();
