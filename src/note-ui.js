/* 確認済みのナビゲーション・関連商品・記事おすすめ枠を扱う。詳細はdocs/note-dom.md。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const owned = "data-hikikomori-note-owned";
  const hidden = "data-hikikomori-note-menu-hidden";
  const productHidden = "data-hikikomori-note-product-hidden";
  const recommendationsHidden = "data-hikikomori-note-recommendations-hidden";
  const productCard = '[data-aicn-thing-card="true"], [data-testid="aicn-thing-card"]';
  function create(doc, win, actions = {}) {
    let host, menu, signature;
    let currentSettings, currentUrl, adding = false, uncertain = false, actionMessage = "", disposed = false;
    function repaint() { if (!disposed && currentSettings) update(currentSettings, currentUrl); }
    async function addTag(tag) {
      if (adding || uncertain || !currentSettings?.enabled || currentSettings.legacyMode ||
          currentSettings.tagWarning || core.pageKind(currentUrl)?.tag !== tag) return;
      adding = true; actionMessage = "保存中…"; repaint();
      try { await actions.addCurrentTag(); actionMessage = `# ${tag}をお気に入りに追加しました。`; }
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
    const originals = new Set();
    const products = new Set();
    const recommendations = new Set();
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
      syncProducts(settings.enabled && !settings.legacyMode && page?.type === "tag");
      syncRecommendations(settings.enabled && settings.hideArticleRecommendations === true && core.isArticle(url));
      if (!settings.enabled || settings.legacyMode || !page) { restore(); return; }
      const nextHost = page.type === "profile" ? profile(page.user) : sidebar();
      if (!nextHost) { restore(); return; }
      if (host !== nextHost || !menu?.isConnected) restore();
      host = nextHost;
      const nextSignature = JSON.stringify([page, settings.favoriteTags, settings.tagWarning, adding, uncertain, actionMessage]);
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
        following.textContent = "フォロー中のTL";
        if (page.type === "following") following.setAttribute("aria-current", "page");
        menu.append(following);
        if (page.type !== "profile") {
          if (page.type === "tag") {
            let normalized;
            try { normalized = core.normalizeTag(page.tag); } catch { /* 空タグ等は登録不可 */ }
            const registered = settings.favoriteTags.includes(normalized);
            const button = doc.createElement("button"); button.type = "button";
            button.textContent = registered ? "このタグは登録済み" : adding ? "保存中…" : "タグをお気に入りに追加";
            button.setAttribute("aria-label", `# ${page.tag}：${button.textContent}`);
            button.disabled = !normalized || registered || adding || uncertain || Boolean(settings.tagWarning) || !actions.addCurrentTag;
            button.onclick = () => { void addTag(page.tag); }; menu.append(button);
            const status = doc.createElement("span"); status.className = "hikikomori-note-tag-status";
            status.setAttribute("role", "status"); status.textContent = settings.tagWarning || actionMessage;
            menu.append(status);
            if (actionMessage && !registered && actions.refresh) {
              const refresh = doc.createElement("button"); refresh.type = "button"; refresh.textContent = "状態を再確認";
              refresh.disabled = adding; refresh.onclick = () => { void refreshTags(); }; menu.append(refresh);
            }
          }
          const title = doc.createElement("p"); title.textContent = "お気に入りタグ"; menu.append(title);
          const list = doc.createElement("ul"); menu.append(list);
          for (const tag of settings.favoriteTags) {
            const item = doc.createElement("li"), link = doc.createElement("a");
            link.textContent = `# ${tag}`; link.href = core.tagUrl(tag);
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
    return Object.freeze({ update, stop() { disposed = true; restore(); syncProducts(false); syncRecommendations(false); } });
  }
  globalThis.HikikomoriNoteUi = Object.freeze({ create });
})();
