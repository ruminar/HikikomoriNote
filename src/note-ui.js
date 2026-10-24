/* 確認済みのナビゲーションと関連商品枠を扱う。詳細はdocs/note-dom.md。 */
(() => {
  "use strict";
  const core = globalThis.HikikomoriNote;
  const owned = "data-hikikomori-note-owned";
  const hidden = "data-hikikomori-note-menu-hidden";
  const productHidden = "data-hikikomori-note-product-hidden";
  const productCard = '[data-aicn-thing-card="true"], [data-testid="aicn-thing-card"]';
  function create(doc, win) {
    let host, menu, signature;
    const originals = new Set();
    const products = new Set();
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
      const page = core.pageKind(url);
      syncProducts(settings.enabled && !settings.legacyMode && page?.type === "tag");
      if (!settings.enabled || settings.legacyMode || !page) { restore(); return; }
      const nextHost = page.type === "profile" ? profile(page.user) : sidebar();
      if (!nextHost) { restore(); return; }
      if (host !== nextHost || !menu?.isConnected) restore();
      host = nextHost;
      const nextSignature = JSON.stringify([page, settings.favoriteTags]);
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
    return Object.freeze({ update, stop() { restore(); syncProducts(false); } });
  }
  globalThis.HikikomoriNoteUi = Object.freeze({ create });
})();
