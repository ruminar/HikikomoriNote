/* おしゃべりnoteの公開記事URL・前後情報・可視本文抽出だけを移植。保存・AI送信は行わない。 */
(() => {
  "use strict";
  const invalid = message => Object.assign(new Error(message), { code: "INVALID_INPUT" });
  function page(url) {
    let parsed; try { parsed = new URL(url); } catch { throw invalid("記事URLを確認できません。"); }
    const match = /^\/([a-zA-Z0-9_]+)\/n\/(n[a-zA-Z0-9]+)\/?$/.exec(parsed.pathname);
    if (parsed.origin !== "https://note.com" || parsed.username || parsed.password || !match) throw invalid("noteの公開記事ページで実行してください。");
    return { articleId: match[2], authorUrl: `https://note.com/${match[1]}`, url: `https://note.com/${match[1]}/n/${match[2]}` };
  }
  function validate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("記事情報の形式が不正です。");
    const canonical = page(value.url);
    for (const [field, maximum] of [["title", 500], ["author", 200], ["body", 200000]]) {
      if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > maximum) throw invalid("記事のタイトル・著者・本文が空か、取得上限を超えています。コピーは行いません。");
    }
    if (value.articleId !== canonical.articleId) throw invalid("記事IDとURLが一致しません。");
    return { articleId: canonical.articleId, title: value.title, author: value.author, body: value.body, url: canonical.url };
  }
  function adjacentPage(url) {
    const article = page(url), source = new URL(url), magazine = source.searchParams.get("magazine_key");
    if (source.searchParams.getAll("magazine_key").length > 1) throw invalid("マガジンの指定が重複しています。");
    if (magazine !== null && !/^m[a-zA-Z0-9]+$/.test(magazine)) throw invalid("マガジンの指定を確認できません。");
    const query = magazine ? `?magazine_key=${encodeURIComponent(magazine)}` : "";
    return { ...article, url: article.url + query, requestUrl: `https://note.com/api/v3/notes/${article.articleId}/extra_items${query}` };
  }
  async function adjacent(url, fetcher, signal) {
    const source = adjacentPage(url);
    const response = await fetcher(source.requestUrl, { method: "GET", headers: { Accept: "application/json" }, credentials: "omit", redirect: "error", signal });
    if (!response.ok) throw invalid("前後の記事を取得できませんでした。");
    const data = (await response.json())?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid("前後の記事の情報を確認できません。");
    const result = {};
    for (const [direction, field] of [["previous", "prev_note"], ["next", "next_note"]]) {
      const note = data[field];
      if (!note || note.status !== "published" || note.custom_domain != null || typeof note.name !== "string" || !note.name.trim() || note.name.length > 500) continue;
      try {
        const author = globalThis.HikikomoriNote.authorId(note.user?.urlname);
        if (!/^n[a-zA-Z0-9]+$/.test(note.key)) continue;
        const target = page(`https://note.com/${author}/n/${note.key}`);
        if (target.url !== page(url).url) result[direction] = { url: target.url + new URL(source.url).search, title: note.name.trim() };
      } catch { /* 公開note記事と確認できない候補は使わない。 */ }
    }
    return result;
  }
  function extract(doc, win, url) {
    const address = page(url), article = doc.querySelector('article[id="note-article"]');
    const bodies = article?.querySelectorAll('[id="note-body"]');
    const visible = node => {
      for (let current = node; current?.nodeType === 1; current = current.parentElement) {
        const style = win.getComputedStyle(current);
        if (current.hidden || current.getAttribute("aria-hidden") === "true" || style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0" || style.contentVisibility === "hidden") return false;
      }
      return true;
    };
    const visibleText = node => (typeof node.innerText === "string" ? node.innerText : node.textContent).trim();
    if (!article || bodies?.length !== 1 || bodies[0].getAttribute("data-name") !== "body" || !visible(article) || !visible(bodies[0])) throw invalid("閲覧できる記事本文を特定できません。");
    const region = bodies[0].closest('[data-note-key]');
    if (!region || !article.contains(region) || region.getAttribute("data-note-key") !== address.articleId || !visible(region)) throw invalid("表示中の本文と記事URLの一致を確認できません。読み込み完了後に取り込み直してください。");
    const headings = [...article.querySelectorAll("h1")].filter(node => !node.closest('[id="note-body"]') && visible(node));
    if (headings.length !== 1) throw invalid("記事タイトルを特定できません。");
    if (!region.contains(headings[0])) throw invalid("記事タイトルと本文の対応を確認できません。");
    let author = "";
    for (const time of article.querySelectorAll("time")) {
      if (time.closest('[id="note-body"]')) continue;
      let region = time.parentElement;
      for (let depth = 0; region && region !== article && depth < 4; depth++, region = region.parentElement) {
        if (region.querySelector('[id="note-body"]')) break;
        const name = [...region.querySelectorAll("a[href]")].find(a => a.href.replace(/\/$/, "") === address.authorUrl && a.textContent.trim() && visible(a));
        if (name) { author = visibleText(name); break; }
      }
      if (author) break;
    }
    const chunks = [], excluded = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "NAV", "ASIDE", "BUTTON", "FORM", "INPUT", "TEXTAREA", "SVG", "CANVAS", "AUDIO", "VIDEO", "TITLE", "META", "LINK"]);
    const blocks = new Set(["P", "DIV", "SECTION", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION"]);
    function linkUrl(value) {
      try {
        const parsed = new URL(value, address.url);
        if (!value || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
        return parsed.href;
      } catch { return null; }
    }
    function attachment(node) {
      if (node.tagName !== "FIGURE" || node.getAttribute("embedded-service") !== "attachment") return null;
      const links = [...node.querySelectorAll('a[class~="file-widget__link"]')].filter(visible);
      if (links.length !== 1) return null;
      const link = links[0], url = linkUrl(link.getAttribute("href")), name = link.querySelector('[class~="file-widget__filename"]');
      if (!url || !name || !visible(name)) return null;
      const parsed = new URL(url);
      if (parsed.origin !== "https://note.com" || !/^\/api\/v2\/attachments\/download\/[^/]+$/.test(parsed.pathname)) return null;
      const filename = visibleText(name).replace(/\s+/g, " ");
      if (!filename) return null;
      const size = link.querySelector('[class~="file-widget__filesize"]');
      return { url, filename, size: size && visible(size) ? visibleText(size).replace(/\s+/g, " ") : "" };
    }
    function embedAddress(value, embedded = false) {
      const url = linkUrl(value);
      if (!url || !String(value).trim() || String(value).trim().startsWith("#")) return null;
      const source = new URL(url), host = source.hostname;
      let target, match;
      if (host === "open.spotify.com" && (match = /^\/embed\/(track|album|playlist|artist|show|episode)\/([a-zA-Z0-9]{22})\/?$/.exec(source.pathname))) {
        target = new URL(`https://open.spotify.com/${match[1]}/${match[2]}`);
      } else if (host === "codepen.io" && (match = /^\/([a-zA-Z0-9_-]+)\/embed\/(?:preview\/)?([a-zA-Z0-9]+)\/?$/.exec(source.pathname))) {
        target = new URL(`https://codepen.io/${match[1]}/pen/${match[2]}`);
      } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host) &&
          (match = /^\/embed\/([a-zA-Z0-9_-]{11})\/?$/.exec(source.pathname)) && !["videoseries", "live_stream"].includes(match[1])) {
        target = new URL(`https://www.youtube.com/watch?v=${match[1]}`);
        const list = source.searchParams.get("list"), start = source.searchParams.get("start");
        if (list && /^[a-zA-Z0-9_-]+$/.test(list)) target.searchParams.set("list", list);
        if (start && /^\d+$/.test(start)) target.searchParams.set("t", `${start}s`);
      }
      if (target) { target.hash = source.hash; return { url: target.href, embedded: false }; }
      if (source.origin === "https://note.com" && /^\/embed\//.test(source.pathname)) embedded = true;
      return { url, embedded };
    }
    function embedMetadataVisible(element, root) {
      // 未読込iframeのvisibility:hiddenは許容する。内部文書やsrcプロパティには触れない。
      for (let current = element; current && current !== root; current = current.parentElement) {
        const style = win.getComputedStyle(current);
        if (current.hidden || current.getAttribute("aria-hidden") === "true" || current.hasAttribute("data-hikikomori-note-owned") ||
            style.display === "none" || style.opacity === "0" || style.contentVisibility === "hidden") return false;
      }
      return true;
    }
    function embedAddresses(node) {
      for (const attribute of ["data-src", "data-emb-url"]) {
        const source = embedAddress(node.getAttribute(attribute));
        if (source) return [source];
      }
      const links = [...node.querySelectorAll("a[href]")].filter(link => link.closest("[embedded-service]") === node &&
        !link.closest("figcaption") && !link.hasAttribute("data-lightbox") && embedMetadataVisible(link, node));
      const preferred = links.filter(link => link.hasAttribute("data-iframely-url") || link.querySelector('[class~="external-article-widget-title"]'));
      const original = (preferred.length ? preferred : links).map(link => embedAddress(link.getAttribute("href"))).filter(source =>
        source && (preferred.length || !node.querySelector("iframe") || new URL(source.url).pathname !== "/"));
      if (original.length) return [...new Map(original.map(source => [source.url, source])).values()];
      const frames = [];
      for (const frame of node.querySelectorAll("iframe")) {
        if (frame.closest("[embedded-service]") !== node || !embedMetadataVisible(frame, node)) continue;
        for (const attribute of ["data-src", "src"]) {
          const source = embedAddress(frame.getAttribute(attribute), true);
          if (source) { frames.push(source); break; }
        }
      }
      return [...new Map(frames.map(source => [source.url, source])).values()];
    }
    function linkCard(node) {
      if (node.tagName !== "FIGURE") return null;
      const service = node.getAttribute("embedded-service");
      if (!service || service === "attachment") return null;
      const addresses = embedAddresses(node);
      const preserveText = true; // URLの補完で、既に取得できていた投稿文・説明・キャプションを消さない。
      if (addresses.length !== 1 || addresses[0].embedded || !["note", "external-article", "githubRepository"].includes(service)) return { addresses, preserveText };
      const url = addresses[0].url;
      if (service === "note" && linkUrl(node.getAttribute("data-src")) !== url) return { addresses, preserveText };
      // GitHub埋め込みは外側の元URLだけ残し、Iframelyのiframe内部には触れない。
      if (service === "githubRepository") return { url, urlOnly: true };
      let title = "", author = "", description = "", creator = false;
      try {
        const target = new URL(url), match = /^\/([a-zA-Z0-9_]+)\/?$/.exec(target.pathname);
        if (target.origin === "https://note.com" && match) creator = Boolean(globalThis.HikikomoriNote.authorId(match[1]));
      } catch { /* 公開プロフィールと確認できないURLは通常のカードとして扱う。 */ }
      if (service === "external-article") {
        const heading = node.querySelector('[class~="external-article-widget-title"]'), anchor = heading?.closest("a[href]");
        if (heading && anchor && visible(heading) && linkUrl(anchor.getAttribute("href")) === url) title = visibleText(heading);
        if (creator) {
          const text = node.querySelector('[class~="external-article-widget-description"]'), link = text?.closest("a[href]");
          if (text && link && visible(text) && linkUrl(link.getAttribute("href")) === url) description = visibleText(text);
        }
      } else {
        // 読み込み済みの同一オリジンnoteカードだけ参照する。srcの設定や追加通信は行わない。
        for (const frame of node.querySelectorAll("iframe")) {
          try {
            if (!visible(frame)) continue;
            const target = page(url), src = new URL(frame.getAttribute("src"), address.url);
            if (src.origin !== "https://note.com" || src.pathname !== `/embed/notes/${target.articleId}`) continue;
            const child = frame.contentDocument;
            if (!child || new URL(child.URL).origin !== src.origin || new URL(child.URL).pathname !== src.pathname) continue;
            const heading = child.querySelector('[class~="p-noteEmbed__title"]'), anchor = child.querySelector('a[class~="p-noteEmbed__link"]');
            if (!anchor || linkUrl(anchor.getAttribute("href")) !== url) continue;
            if (heading && visible(heading)) title = visibleText(heading);
            const name = child.querySelector('[class~="p-noteEmbed__name"]');
            const profile = name && [...name.querySelectorAll("a[href]")].find(a => linkUrl(a.getAttribute("href"))?.replace(/\/$/, "") === target.authorUrl && visible(a));
            if (profile) author = visibleText(profile);
            if (title || author) break;
          } catch { /* 未読込・別オリジンのフレームはURLだけを残す。 */ }
        }
      }
      return { url, title: title.replace(/\s+/g, " ") || "（タイトル未取得）", author: author.replace(/\s+/g, " ") || (new URL(url).origin === "https://note.com" ? "（著者未取得）" : ""), creator, description: description.replace(/\s+/g, " ") };
    }
    function walk(node) {
      if (node.nodeType === 3) { chunks.push(node.nodeValue); return; }
      if (node.nodeType !== 1 || excluded.has(node.tagName) || node.hasAttribute("data-hikikomori-note-owned") || !visible(node)) return;
      const file = attachment(node);
      if (file) {
        chunks.push(`\n[ファイルダウンロード]\nファイル名：${file.filename}${file.size ? ` （${file.size}）` : ""}\nリンク先URL：${file.url}\n`);
        for (const caption of node.querySelectorAll("figcaption")) walk(caption);
        return;
      }
      const card = linkCard(node);
      if (card) {
        if (card.addresses) {
          chunks.push("\n[リンクカード]\n");
          if (!card.addresses.length) chunks.push("URL：（未取得）\n");
          for (const source of card.addresses) chunks.push(`${source.embedded ? "埋め込みURL" : "URL"}：${source.url}\n`);
          if (card.preserveText) for (const child of node.childNodes) walk(child);
        } else if (card.urlOnly) chunks.push(`\n[リンクカード]\nURL：${card.url}\n`);
        else if (card.creator) chunks.push(`\n[リンクカード]\n種類：クリエーターページ\nタイトル：${card.title}\n${card.description ? `紹介文：${card.description}\n` : ""}URL：${card.url}\n`);
        else chunks.push(`\n[リンクカード]\nタイトル：${card.title}\n${card.author ? `著者：${card.author}\n` : ""}URL：${card.url}\n`);
        if (!card.preserveText) for (const caption of node.querySelectorAll("figcaption")) walk(caption);
        return;
      }
      if (node.tagName === "BR") { chunks.push("\n"); return; }
      if (blocks.has(node.tagName)) chunks.push("\n");
      const linkStart = chunks.length;
      for (const child of node.childNodes) walk(child);
      if (node.tagName === "A" && !node.hasAttribute("data-lightbox")) {
        const url = linkUrl(node.getAttribute("href")), text = chunks.slice(linkStart).join("").trim();
        // リンク文字列の位置にURLを添える。不可視テキスト・画像だけのリンクは対象外。
        if (url && text && text !== url) chunks.push(`（リンク先URL：${url}）`);
        else if (url && text) chunks.push(" ");
      }
      if (blocks.has(node.tagName)) chunks.push("\n");
    }
    walk(bodies[0]);
    return validate({ ...address, title: visibleText(headings[0]), author, body: chunks.join("").replace(/\n{3,}/g, "\n\n").trim() });
  }
  function copyText(article, publishedAt = "") {
    const value = validate(article);
    return `タイトル：${value.title}\n著者名：${value.author}\n投稿日：${publishedAt || "不明"}\nURL：${value.url}\n\n本文：\n${value.body}`;
  }
  globalThis.HikikomoriNoteArticles = Object.freeze({ page, validate, adjacentPage, adjacent, extract, copyText });
})();
