"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {documentFromHtml}=require('./helpers/dom.cjs');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
const article=(articleId='n123')=>({articleId,title:'題',author:'著者',body:'本文',url:`https://note.com/test/n/${articleId}`});
function runtime(){const context=vm.createContext({URL,console});for(const name of ['common','articles','note-ui'])vm.runInContext(source(`src/${name}.js`),context);return {context};}
function articleCopyUi(options={}) {
 const f=runtime(),doc=documentFromHtml((options.header ? '<header data-header-state="navbar"><div><a href="/" target="_self"><svg role="img" aria-label="note"></svg></a></div></header>' : '')+'<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time id="published" datetime="2026-10-07T23:30:00-05:00"></time></div><div id="note-body" data-name="body"><p id="text"></p><p><a href="https://example.com/source" id="link"></a></p><p hidden id="hidden"></p><time datetime="2000-01-01"></time></div></div></article>');
 doc.body=doc.root;for(const [id,text] of [['title','記事の題'],['author','著者'],['text','コピーする本文'],['link','参照先'],['hidden','非表示の秘密']])doc.getElementById(id).textContent=text;
 if(options.avatar){const avatar=doc.createElement('span');avatar.setAttribute('data-name','avatar');doc.getElementById('author').append(avatar);}
 doc.getElementById('note-article').getBoundingClientRect=()=>({left:options.left??240,width:700});
 const win={AbortController,matchMedia:query=>({matches:query.includes("max-width")?options.wide===false:options.wide!==false}),getComputedStyle:node=>({display:node.hidden?'none':'block',visibility:node.getAttribute('data-visibility')||'visible',opacity:node.getAttribute('data-opacity')||'1'})};
 const copies=[],dates=[];
 const ui=f.context.HikikomoriNoteUi.create(doc,win,{copyArticle:async(value,date)=>{if(options.fail)throw Error('clipboard denied');if(options.copy)return options.copy(value,date);copies.push(f.context.HikikomoriNoteArticles.copyText(value,date));dates.push(date);},...(options.loadAdjacent?{loadArticleAdjacent:options.loadAdjacent}:{})});
 const update=(url=article().url,patch={})=>ui.update({...f.context.HikikomoriNote.defaultSettings(),...patch},url);update();
 return {f,doc,win,copies,dates,update,ui,get wrapper(){return doc.querySelectorAll('div').find(n=>n.className==='hikikomori-note-article-actions');},get button(){return this.wrapper?.querySelector('button');},get status(){return this.wrapper?.querySelector('span');}};
}

const mobileToggle=f=>f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]');
const mobilePanel=f=>f.doc.querySelector('[class="hikikomori-note-mobile-panel"]');
test('記事の狭幅メニューはTL・作者・作者検索・前後・全文の順、閉状態で開始しEscapeとリンクで閉じる',async()=>{
 const f=articleCopyUi({header:true,avatar:true,wide:false});const toggle=mobileToggle(f),panel=mobilePanel(f),nav=panel.querySelector('nav');
 assert.ok(toggle);assert.equal(panel.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 assert.deepEqual(nav.children.slice(0,3).map(n=>n.textContent),['フォロー中のTL','著者','＠著者']);
 assert.deepEqual(f.wrapper.children.slice(0,3).map(n=>n.textContent),['◀ 前の記事','次の記事 ▶','記事全文を取得']);
 assert.equal(panel.querySelector('form'),null);assert.equal(nav.querySelector('ul'),null);
 toggle.onclick();assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
 await f.button.onclick();assert.equal(f.copies.length,1);assert.equal(panel.hidden,false);assert.match(f.status.textContent,/コピーしました/);
 panel.fire('keydown',{key:'Escape'});assert.equal(panel.hidden,true);assert.equal(f.doc.activeElement,toggle);
 toggle.onclick();panel.fire('click',{target:nav.querySelector('a')});assert.equal(panel.hidden,true);
});
test('記事メニューは3モードで使え重度のみTLなし、公式ヘッダや記事枠が不明なら出さない',()=>{
 const f=articleCopyUi({header:true,avatar:true,wide:false});
 for(const mode of ['normal','social','severe','normal']){f.update(undefined,{mode});const nav=mobilePanel(f).querySelector('nav');assert.equal(nav.children[0].textContent,mode==='severe'?'著者':'フォロー中のTL');assert.ok(f.button);assert.equal(mobileToggle(f).isConnected,true);}
 const g=articleCopyUi({header:false,wide:false});assert.equal(mobileToggle(g),null);assert.equal(Boolean(g.wrapper),false);
 f.doc.getElementById('note-article').hidden=true;f.update();assert.equal(mobileToggle(f),null);assert.equal(Boolean(f.wrapper),false);
});
test('記事の幅変更・左余白不足では操作要素とコピー中状態を移し、前後情報は一度だけ取得する',async()=>{
 let count=0,finish;const options={header:true,avatar:true,wide:true,loadAdjacent:async()=>{count++;return{previous:{url:'https://note.com/test/n/n111',title:'前'}};},copy:()=>new Promise(r=>finish=r)};
 const f=articleCopyUi(options);await flush();const wrapper=f.wrapper,button=f.button,pending=button.onclick();
 options.wide=false;f.update();assert.equal(f.wrapper,wrapper);assert.equal(f.button,button);assert.equal(button.disabled,true);assert.equal(wrapper.closest('nav').parentElement,mobilePanel(f));
 mobileToggle(f).onclick();options.wide=true;f.update();assert.equal(mobileToggle(f),null);assert.equal(wrapper.parentElement,f.doc.body);assert.equal(button.disabled,true);
 finish();await pending;assert.match(f.status.textContent,/コピーしました/);
 options.left=227;f.update();assert.ok(mobileToggle(f));assert.equal(f.wrapper,wrapper);assert.equal(mobilePanel(f).hidden,true);await flush();assert.equal(count,1);
});
test('記事SPA遷移は閉じて古い結果を破棄し、OFF・停止でヘッダから撤去する',async()=>{
 const pending=[],f=articleCopyUi({header:true,avatar:true,wide:false,loadAdjacent:(url,signal)=>new Promise(resolve=>pending.push({url,signal,resolve}))});await flush();mobileToggle(f).onclick();
 f.doc.querySelector('[data-note-key]').setAttribute('data-note-key','n456');f.update(article('n456').url);await flush();assert.equal(mobilePanel(f).hidden,true);assert.equal(pending[0].signal.aborted,true);assert.equal(pending.length,2);
 pending[0].resolve({previous:{url:'https://note.com/test/n/nOld',title:'古い応答'}});await flush();assert.ok(!f.wrapper.querySelector('a').hasAttribute('href'));
 f.update(article('n456').url,{enabled:false});assert.equal(mobileToggle(f),null);assert.equal(mobilePanel(f),null);assert.equal(pending[1].signal.aborted,true);
 f.update();assert.ok(mobileToggle(f));f.ui.stop();assert.equal(mobilePanel(f),null);assert.equal(mobileToggle(f),null);
});
test('記事から検索へ移ると記事操作を撤去し、元の共通ハンバーガーへ切り替わる',()=>{
 const f=articleCopyUi({header:true,avatar:true,wide:false});mobileToggle(f).onclick();f.update('https://note.com/search?q=tag');
 assert.equal(Boolean(f.wrapper),false);assert.equal(f.doc.querySelector('[class="hikikomori-note-article-mobile"]'),null);
 assert.ok(mobileToggle(f));assert.equal(mobilePanel(f).hidden,true);assert.ok(mobilePanel(f).querySelector('[class="hikikomori-note-navigation"]'));
 f.update();assert.ok(f.wrapper);assert.equal(f.doc.querySelector('[class="hikikomori-note-navigation"]'),null);assert.equal(mobilePanel(f).hidden,true);
});
test('記事のヘッダ交換時は旧ボタンを外して閉じたメニューを作り直し、前後情報を再取得しない',async()=>{
 let count=0;const f=articleCopyUi({header:true,avatar:true,wide:false,loadAdjacent:async()=>{count++;return{};}});await flush();const old=mobileToggle(f);old.onclick();const header=f.doc.querySelector('header'),next=documentFromHtml('<header data-header-state="navbar"><div><a href="/" target="_self"><svg role="img" aria-label="note"></svg></a></div></header>').root.children[0];
 header.remove();f.doc.body.prepend(next);f.update();await flush();assert.notEqual(mobileToggle(f),old);assert.equal(old.isConnected,false);assert.equal(mobilePanel(f).hidden,true);assert.equal(count,1);
});

test('コピーはタイトル・著者・元の投稿日・正規URLと可視本文だけ、失敗後も再試行可能',async()=>{
 const options={fail:true},f=articleCopyUi(options);
 await f.button.onclick();assert.match(f.status.textContent,/コピーに失敗/);assert.equal(f.button.disabled,false);
 options.fail=false;await f.button.onclick();assert.equal(f.copies.length,1);
 assert.match(f.copies[0],/^タイトル：記事の題\n著者名：著者\n投稿日：2026-10-07\nURL：https:\/\/note.com\/test\/n\/n123\n\n本文：\nコピーする本文/);
 assert.ok(f.copies[0].includes('参照先（リンク先URL：https://example.com/source）'));assert.ok(!f.copies[0].includes('非表示の秘密'));assert.match(f.status.textContent,/コピーしました/);
});
test('投稿日は未知・不可視・不正・複数候補なら不明とし、本文のtimeは使わない',async()=>{
 const f=articleCopyUi(),time=f.doc.getElementById('published');
 for(const value of ['', '2026-10-XX','2026-02-30T00:00:00+09:00']){time.setAttribute('datetime',value);await f.button.onclick();assert.equal(f.dates.at(-1),'');assert.ok(f.copies.at(-1).includes('投稿日：不明'));}
 time.setAttribute('datetime','2026-10-07');time.hidden=true;await f.button.onclick();assert.equal(f.dates.at(-1),'');
 time.hidden=false;const other=f.doc.createElement('time');other.setAttribute('datetime','2026-10-08');time.parentElement.append(other);await f.button.onclick();assert.equal(f.dates.at(-1),'');
});
test('SPAのURL不一致はコピーせず、旧非同期結果を新メニューへ残さない',async()=>{
 let finish;const f=articleCopyUi({copy:()=>new Promise(r=>finish=r)}),old=f.wrapper,copy=f.button;
 const pending=copy.onclick();assert.equal(copy.disabled,true);
 f.update(article('n456').url);assert.notEqual(f.wrapper,old);assert.equal(f.status.textContent,'');
 finish();await pending;assert.equal(f.status.textContent,'');
 await f.button.onclick();assert.match(f.status.textContent,/本文と記事URL/);assert.equal(f.copies.length,0);
});
test('3モードで配置しOFF・停止・非記事・プレビュー・狭幅・余白不足で撤去する',()=>{
 const f=articleCopyUi();for(const mode of ['normal','social','severe']){f.update(undefined,{mode});assert.ok(f.wrapper?.isConnected);assert.equal(f.wrapper.hasAttribute('data-hikikomori-note-actions-only'),mode==='severe');}
 f.update(undefined,{enabled:false});assert.equal(Boolean(f.wrapper),false);f.update();f.ui.stop();assert.equal(Boolean(f.wrapper),false);
 for(const options of [{wide:false},{left:227}])assert.equal(Boolean(articleCopyUi(options).wrapper),false);
 const g=articleCopyUi();for(const url of ['https://note.com/test','https://note.com/preview/n123','https://user:pass@note.com/test/n/n123']){assert.doesNotThrow(()=>g.update(url));assert.equal(Boolean(g.wrapper),false);}
});
test('重度で作者ボタンが未確認でも新操作と公式作者欄を重ねず、OFFで位置を戻す',()=>{
 const f=articleCopyUi(),container=f.doc.createElement('div'),profile=f.doc.createElement('div');container.className='fixed top-24 left-8';profile.setAttribute('data-testid','side-creator-profile');container.append(profile);f.doc.body.append(container);
 f.update(undefined,{mode:'severe'});assert.equal(container.getAttribute('data-hikikomori-note-side-profile-offset'),'article-actions-only');
 f.update(undefined,{enabled:false});assert.equal(container.hasAttribute('data-hikikomori-note-side-profile-offset'),false);
});
test('停止前に開始していない通信は送らず、開始済みは中止し再描画で再送しない',async()=>{
 let calls=0;const f=articleCopyUi({loadAdjacent:async()=>{calls++;return{};}});f.ui.stop();await flush();assert.equal(calls,0);
 let signal;const g=articleCopyUi({loadAdjacent:(_,s)=>{calls++;signal=s;return new Promise(()=>{});}});await flush();g.update();await flush();assert.equal(calls,1);g.update(undefined,{enabled:false});assert.equal(signal.aborted,true);
});
test('記事・マガジン文脈が変われば新規取得し、その他のquery変更では再取得しない',async()=>{
 const calls=[],f=articleCopyUi({loadAdjacent:async url=>{calls.push(url);return{};}});await flush();
 f.update(article().url+'?foo=bar#text');await flush();assert.equal(calls.length,1);
 f.update(article().url+'?magazine_key=m123');await flush();assert.equal(calls.length,2);assert.ok(calls[1].endsWith('?magazine_key=m123'));
 f.doc.querySelector('[data-note-key]').setAttribute('data-note-key','n456');f.update(article('n456').url);await flush();assert.equal(calls.length,3);
});
test('空・上限超過・不可視・二重本文・不一致では切り詰めずコピーを拒否する',async()=>{
 const f=articleCopyUi();const api=f.f.context.HikikomoriNoteArticles;
 for(const [field,max] of [['title',500],['author',200],['body',200000]]){assert.throws(()=>api.copyText({...article(),[field]:''}));assert.throws(()=>api.copyText({...article(),[field]:'x'.repeat(max+1)}));assert.equal(api.validate({...article(),[field]:'x'.repeat(max)})[field].length,max);}
 for(const attr of ['data-opacity','data-visibility']){const body=f.doc.getElementById('note-body');body.setAttribute(attr,attr==='data-opacity'?'0':'hidden');await f.button.onclick();assert.equal(f.copies.length,0);body.removeAttribute(attr);}
 const duplicate=f.doc.createElement('div');duplicate.id='note-body';duplicate.setAttribute('id','note-body');f.doc.getElementById('note-article').append(duplicate);await f.button.onclick();assert.equal(f.copies.length,0);
});
test('URLとマガジン指定を厳格に確認し、コピーにqueryや認証情報を含めない',async()=>{
 const api=runtime().context.HikikomoriNoteArticles;assert.equal(api.page(article().url+'?x=1#s').url,article().url);
 for(const url of ['http://note.com/test/n/n123','https://note.com.evil/test/n/n123','https://u:p@note.com/test/n/n123','https://note.com/preview/n123'])assert.throws(()=>api.page(url));
 await assert.rejects(api.adjacent(article().url+'?magazine_key=m1&magazine_key=m2',()=>assert.fail('送信しない')));
 assert.ok(!api.copyText({...article(),url:article().url+'?private=x#s'}).includes('private='));
});
test('本文が未知・不可視・重複なら前後情報を新規取得せずDOMリンクも使わない',async()=>{
 for(const mutate of [f=>f.doc.getElementById('note-body').removeAttribute('data-name'),f=>{f.doc.getElementById('note-body').hidden=true;},f=>{const b=f.doc.createElement('div');b.setAttribute('id','note-body');f.doc.getElementById('note-article').append(b);}]){
  let calls=0;const f=articleCopyUi({loadAdjacent:async()=>{calls++;return{};}});await flush();mutate(f);f.update();await flush();assert.equal(calls,1);
  const prev=appendAdjacent(f,'前の記事','/test/n/n111');f.update();assert.ok(!f.wrapper.querySelector('a').hasAttribute('href'));prev.root.remove();
 }
});
function appendAdjacent(f, label, href, title='前後の記事', host=f.doc.body) {
 const fragment=documentFromHtml('<div class="flex"><div class="relative flex min-w-0 basis-1/2 items-center gap-2 py-4"><a class="absolute inset-0" target="_self"></a><div class="min-w-0"><p></p><p></p></div></div></div>');
 const root=fragment.root.children[0],card=root.children[0],link=card.querySelector('a'),ps=card.querySelectorAll('p');
 ps[0].textContent=label;ps[1].textContent=title;link.setAttribute('href',href);link.setAttribute('title',title);link.setAttribute('aria-label',title);host.append(root);
 return {root,card,link};
}

test('記事末尾の前後リンクをコピーボタンの上へ配置し、遅延出現・片側なしを反映する',()=>{
 const f=articleCopyUi(),links=f.wrapper.querySelectorAll('a[data-hikikomori-note-adjacent]');
 assert.deepEqual(f.wrapper.children.slice(0,3).map(n=>n.textContent),['◀ 前の記事','次の記事 ▶','記事全文を取得']);
 assert.ok(links.every(n=>!n.hasAttribute('href')&&n.getAttribute('aria-disabled')==='true'));
 const prev=appendAdjacent(f,'前の記事','/test/n/n111','以前の記事'),next=appendAdjacent(f,'次の記事','https://note.com/test/n/n222','以降の記事');f.update();
 assert.equal(links[0].href,'https://note.com/test/n/n111');assert.equal(links[1].href,'https://note.com/test/n/n222');assert.equal(links[0].getAttribute('target'),'_self');assert.equal(links[0].getAttribute('title'),'以前の記事');assert.ok(!links[0].hasAttribute('aria-disabled'));
 const event=links[0].fire('click',{ctrlKey:true});assert.ok(!event.defaultPrevented);
 prev.root.remove();f.update();assert.ok(!links[0].hasAttribute('href'));assert.equal(links[1].href,'https://note.com/test/n/n222');
 next.link.setAttribute('href','https://evil.test/test/n/n222');const stale=links[1].fire('click');assert.equal(stale.defaultPrevented,true);assert.ok(!links[1].hasAttribute('href'));
 assert.deepEqual(f.copies,[]);assert.deepEqual(f.copies,[]);
});

test('前後記事は本文内・外部・別記事の古い枠・重複・未知構造を採用せずSPA遷移でも消去する',()=>{
 const f=articleCopyUi(),previous=f.wrapper.querySelectorAll('a[data-hikikomori-note-adjacent]')[0];
 appendAdjacent(f,'前の記事','/test/n/n111','本文中の偽リンク',f.doc.getElementById('note-body'));f.update();assert.ok(!previous.hasAttribute('href'));
 const source=appendAdjacent(f,'前の記事','https://evil.test/test/n/n111');f.update();assert.ok(!previous.hasAttribute('href'));
 source.link.setAttribute('href','/test/n/n111');source.card.hidden=true;f.update();assert.ok(!previous.hasAttribute('href'));source.card.hidden=false;
 source.link.setAttribute('aria-label','不一致');f.update();assert.ok(!previous.hasAttribute('href'));source.link.setAttribute('aria-label','前後の記事');
 source.root.setAttribute('data-note-key','nOld');f.update();assert.ok(!previous.hasAttribute('href'));source.root.removeAttribute('data-note-key');
 f.update();assert.equal(f.wrapper.querySelector('a').href,'https://note.com/test/n/n111');
 const duplicate=appendAdjacent(f,'前の記事','/test/n/n333');f.update();assert.ok(!previous.hasAttribute('href'));duplicate.root.remove();f.update();
 f.update(article('n456').url);assert.ok(!f.wrapper.querySelector('a').hasAttribute('href'));
 f.update();assert.equal(f.wrapper.querySelector('a').href,'https://note.com/test/n/n111');
 source.card.classList.remove('basis-1/2');f.update();assert.ok(!f.wrapper.querySelector('a').hasAttribute('href'));
});

test('前後記事はスクロールせず一度だけ取得し、DOMの公式リンクを優先して再描画で再送しない',async()=>{
 const calls=[],f=articleCopyUi({loadAdjacent:async url=>{calls.push(url);return {previous:{url:'https://note.com/test/n/n111',title:'APIの前記事'},next:{url:'https://note.com/test/n/n222',title:'APIの次記事'}};}});
 await new Promise(r=>setImmediate(r));const links=f.wrapper.querySelectorAll('a[data-hikikomori-note-adjacent]');
 assert.equal(calls.length,1);assert.equal(links[0].href,'https://note.com/test/n/n111');assert.equal(links[1].href,'https://note.com/test/n/n222');assert.ok(!links[0].fire('click').defaultPrevented);
 for(let i=0;i<3;i++)f.update();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
 appendAdjacent(f,'前の記事','/test/n/n333','公式DOMの前記事');f.update();assert.equal(links[0].href,'https://note.com/test/n/n333');assert.deepEqual(f.copies,[]);
});

test('前後記事の取得失敗は再送せず、遷移前の遅い応答を別記事へ適用しない',async()=>{
 const pending=[],f=articleCopyUi({loadAdjacent:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))});await new Promise(r=>setImmediate(r));
 const links=f.wrapper.querySelectorAll('a[data-hikikomori-note-adjacent]');
 f.doc.querySelector('[data-note-key]').setAttribute('data-note-key','n456');f.update(article('n456').url);await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);
 pending[0].resolve({previous:{url:'https://note.com/test/n/nOld',title:'古い記事の結果'}});await new Promise(r=>setImmediate(r));assert.ok(!links[0].hasAttribute('href'));
 pending[1].reject(Error('HTTP 500'));await new Promise(r=>setImmediate(r));assert.match(f.wrapper.querySelector('a').getAttribute('title'),/取得できませんでした/);f.update(article('n456').url);await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);
});

test('前後記事APIは固定したnoteのGETだけを使い、前後の公開記事名とURLだけを返す',async()=>{
 const f=runtime(),api=f.context.HikikomoriNoteArticles,calls=[];
 const note=(key,name)=>({key,name,status:'published',user:{urlname:'test'},custom_domain:null,body:'送らない本文'});
 const value=await api.adjacent(article().url+'?magazine_key=mSeries#anchor',async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({data:{prev_note:note('n111','前記事'),next_note:note('n222','次記事'),comments:['保存しないコメント']}})};});
 assert.equal(calls[0].url,'https://note.com/api/v3/notes/n123/extra_items?magazine_key=mSeries');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');
 assert.deepEqual(JSON.parse(JSON.stringify(value)),{previous:{url:'https://note.com/test/n/n111?magazine_key=mSeries',title:'前記事'},next:{url:'https://note.com/test/n/n222?magazine_key=mSeries',title:'次記事'}});
 await assert.rejects(api.adjacent('https://evil.test/test/n/n123',()=>assert.fail('外部URLには送信しない')));
 await assert.rejects(api.adjacent(article().url+'?magazine_key=invalid',()=>assert.fail('不正なマガジンでは送信しない')));
});

test('前後記事APIは失敗や不正応答を拒否し、下書き・外部ドメイン・不正ID・自記事を候補にしない',async()=>{
 const api=runtime().context.HikikomoriNoteArticles;
 await assert.rejects(api.adjacent(article().url,async()=>({ok:false})),/取得できません/);
 await assert.rejects(api.adjacent(article().url,async()=>({ok:true,json:async()=>({data:[]})})),/確認できません/);
 const base={key:'n111',name:'前記事',status:'published',user:{urlname:'test'},custom_domain:null};
 for(const bad of [{...base,status:'draft'},{...base,custom_domain:'outside.test'},{...base,key:'../bad'},{...base,user:{urlname:'settings'}},{...base,key:'n123'}]){
  const result=await api.adjacent(article().url,async()=>({ok:true,json:async()=>({data:{prev_note:bad,next_note:null}})}));assert.deepEqual(JSON.parse(JSON.stringify(result)),{});
 }
});


test('表示中の本文領域だけを抽出し、不可視・スクリプト・有料境界・コメントを除外する',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="body"></p><p hidden id="hidden"></p><script id="script"></script></div></div><aside id="paywall"></aside></article><p id="comment"></p>');
 for(const [id,text]of [['title','見える題'],['author','著者名'],['body','表示本文'],['hidden','非表示の秘密'],['script','実行しない'],['paywall','ここから先は購入'],['comment','コメント']])doc.getElementById(id).textContent=text;
 const win={getComputedStyle:node=>({display:node.hidden?'none':'block',visibility:'visible'})},api=f.context.HikikomoriNoteArticles;
 const region=doc.querySelector('[data-note-key]');
 assert.throws(()=>api.extract(doc,win,article('n456').url),/本文と記事URL/);
 region.removeAttribute('data-note-key');assert.throws(()=>api.extract(doc,win,article().url),/本文と記事URL/);region.setAttribute('data-note-key','n123');
 const extracted=api.extract(doc,win,article().url);assert.equal(extracted.body,'表示本文');assert.equal(extracted.title,'見える題');assert.equal(extracted.author,'著者名');
 doc.getElementById('body').textContent='';assert.throws(()=>api.extract(doc,win,article().url),/空/);
 doc.getElementById('note-body').hidden=true;assert.throws(()=>api.extract(doc,win,article().url),/本文/);
 doc.getElementById('note-body').hidden=false;doc.getElementById('body').textContent='本文';const hidden=doc.createElement('div');hidden.hidden=true;doc.getElementById('note-article').append(hidden);hidden.append(doc.getElementById('title'));assert.throws(()=>api.extract(doc,win,article().url),/タイトル/);
});

test('リンクカードを本文順にタイトル・著者・URLで取得する',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="before"></p><figure embedded-service="external-article" data-src="https://example.com/works"><a href="https://example.com/works"><strong class="external-article-widget-title" id="card-title"></strong><em id="description"></em></a><a href="https://example.com/works"></a></figure><figure embedded-service="note" data-src="https://note.com/other/n/n456"><iframe id="frame" src="https://note.com/embed/notes/n456"></iframe></figure><figure embedded-service="note" data-src="https://note.com/other/n/n789"><iframe></iframe></figure><p id="after"></p></div></div></article>');
 for(const [id,text]of [['title','リンク集'],['author','著者'],['before','前の本文'],['after','後の本文'],['card-title','外部作品の題名'],['description','カードの説明文は送らない']])doc.getElementById(id).textContent=text;
 const child=documentFromHtml('<a class="p-noteEmbed__link" href="https://note.com/other/n/n456"></a><div class="p-noteEmbed__title" id="linked-title"></div><div class="p-noteEmbed__name"><a id="card-author" href="https://note.com/other"></a></div><p id="unrelated"></p>');
 child.URL='https://note.com/embed/notes/n456';child.getElementById('linked-title').textContent='note作品の題名';child.getElementById('unrelated').textContent='スキ数は送らない';child.getElementById('card-author').textContent='参照先の作者';doc.getElementById('frame').contentDocument=child;
 const win={getComputedStyle:node=>({display:node.hidden?'none':'block',visibility:'visible'})};
 const value=f.context.HikikomoriNoteArticles.extract(doc,win,article().url);
 assert.ok(value.body.indexOf('前の本文')<value.body.indexOf('外部作品の題名'));
 assert.ok(value.body.indexOf('外部作品の題名')<value.body.indexOf('note作品の題名'));
 assert.ok(value.body.indexOf('note作品の題名')<value.body.indexOf('後の本文'));
 for(const url of ['https://example.com/works','https://note.com/other/n/n456','https://note.com/other/n/n789'])assert.equal(value.body.split(url).length-1,1);
 assert.match(value.body,/タイトル：（タイトル未取得）/);
 assert.ok(value.body.includes('タイトル：外部作品の題名\nURL：https://example.com/works'));
 assert.ok(value.body.includes('タイトル：note作品の題名\n著者：参照先の作者\nURL：https://note.com/other/n/n456'));assert.equal(value.body.split('著者：（著者未取得）').length-1,1);
 const cardAuthor=child.getElementById('card-author');cardAuthor.setAttribute('href','https://note.com/wrong');assert.ok(!f.context.HikikomoriNoteArticles.extract(doc,win,article().url).body.includes('参照先の作者'));cardAuthor.setAttribute('href','https://note.com/other');cardAuthor.hidden=true;assert.ok(!f.context.HikikomoriNoteArticles.extract(doc,win,article().url).body.includes('参照先の作者'));
 assert.ok(!value.body.includes('説明文は送らない'));assert.ok(!value.body.includes('スキ数は送らない'));
});

test('クリエーターページのカードは記事と区別し、表示中の紹介文とURLをコピーする',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><figure embedded-service="external-article" data-src="https://note.com/legal_knot1730" id="card"><div><a id="card-link" href="https://note.com/legal_knot1730"><strong class="external-article-widget-title" id="card-title"></strong><em class="external-article-widget-description" id="description"></em></a></div></figure><p id="after"></p></div></div></article>');
 for(const [id,text]of [['title','紹介記事'],['author','記事の著者'],['card-title','言ノ葉しをり Shioiri Kotonoha｜note'],['description','将来小説家になる、まだ誰も知らない中学生。'],['after','このユーザを見てほしい']])doc.getElementById(id).textContent=text;
 const win={getComputedStyle:n=>({display:n.hidden?'none':'block',visibility:'visible'})},extract=()=>f.context.HikikomoriNoteArticles.extract(doc,win,article().url);
 const value=extract();assert.match(value.body,/\[リンクカード\]\n種類：クリエーターページ\nタイトル：言ノ葉しをり Shioiri Kotonoha｜note\n紹介文：将来小説家になる、まだ誰も知らない中学生。\nURL：https:\/\/note.com\/legal_knot1730/);
 assert.ok(!value.body.includes('著者：'));assert.ok(value.body.indexOf('クリエーターページ')<value.body.indexOf('このユーザ'));
 const description=doc.getElementById('description');description.hidden=true;assert.ok(!extract().body.includes('紹介文：'));description.hidden=false;
 const link=doc.getElementById('card-link');link.setAttribute('href','https://note.com/other');const mismatched=extract().body;assert.ok(!mismatched.includes('言ノ葉しをり'));assert.ok(!mismatched.includes('将来小説家'));
 for(const url of ['https://note.com/search','https://note.com/preview','https://example.com/legal_knot1730','https://note.com.evil.test/legal_knot1730','https://note.com/legal_knot1730/n/n456']){
  doc.getElementById('card').setAttribute('data-src',url);link.setAttribute('href',url);const body=extract().body;assert.ok(!body.includes('種類：クリエーターページ'));assert.ok(!body.includes('紹介文：'));assert.equal(body.includes('著者：（著者未取得）'),new URL(url).origin==='https://note.com');
 }
});

test('GitHub埋め込みは外側の元URLを一度だけコピーし、iframe内部を読まない',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="before"></p><figure embedded-service="githubRepository" data-src="https://github.com/ruminar/OpenGepa" id="card"><div><a href="https://github.com/ruminar/OpenGepa" data-iframely-url="//iframely.net/HYDXw0b3"></a><iframe id="frame" src="https://iframely.net/HYDXw0b3?v=1"></iframe></div><figcaption id="caption"></figcaption></figure><p id="after"></p></div></div></article>');
 for(const [id,text]of [['title','埋め込みの記事'],['author','著者'],['before','前の本文'],['caption','キャプション'],['after','後の本文']])doc.getElementById(id).textContent=text;
 Object.defineProperty(doc.getElementById('frame'),'contentDocument',{get(){assert.fail('iframe内部へアクセスしてはいけない');}});
 const win={getComputedStyle:n=>({display:n.hidden?'none':'block',visibility:'visible'})},extract=()=>f.context.HikikomoriNoteArticles.extract(doc,win,article().url);
 const value=extract();assert.ok(value.body.includes('[リンクカード]\nURL：https://github.com/ruminar/OpenGepa'));assert.equal(value.body.split('https://github.com/ruminar/OpenGepa').length-1,1);assert.ok(!value.body.includes('iframely.net'));assert.ok(!value.body.includes('未取得'));
 assert.ok(value.body.indexOf('前の本文')<value.body.indexOf('https://github.com'));assert.ok(value.body.indexOf('https://github.com')<value.body.indexOf('キャプション'));assert.ok(value.body.indexOf('キャプション')<value.body.indexOf('後の本文'));
 const card=doc.getElementById('card');card.hidden=true;assert.ok(!extract().body.includes('https://github.com'));card.hidden=false;
 for(const url of ['javascript:alert(1)','https://user:password@github.com/ruminar/OpenGepa']){card.setAttribute('data-src',url);const body=extract().body;assert.ok(!body.includes('javascript:'));assert.ok(!body.includes('user:password'));assert.ok(body.includes('https://github.com/ruminar/OpenGepa'));}
});

function embedFixture(html) {
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="before"></p>'+html+'<p id="after"></p></div></div></article>');
 for(const [id,text]of [['title','埋め込みの題'],['author','著者'],['before','前の本文'],['after','後の本文']])doc.getElementById(id).textContent=text;
 const win={getComputedStyle:n=>({display:n.hidden?'none':'block',visibility:n.getAttribute('style')?.includes('visibility:hidden')?'hidden':'visible'}),scrollTo:()=>assert.fail('スクロールしない')};
 for(const frame of doc.querySelectorAll('iframe'))Object.defineProperty(frame,'contentDocument',{get(){assert.fail('URL補完はiframe内部を読まない');}});
 return {doc,extract:()=>f.context.HikikomoriNoteArticles.extract(doc,win,article().url)};
}

test('未知の埋め込みも外側の元URLを優先し、iframe属性の変更・内部取得をしない',async()=>{
 const f=embedFixture('<figure embedded-service="oembed" data-src="https://example.com/item/123"><iframe id="frame" src="https://embed.example.com/player" data-src="https://embed.example.com/lazy"></iframe></figure>');
 const frame=f.doc.getElementById('frame');frame.setAttribute=()=>assert.fail('iframe属性を書き換えない');
 const value=f.extract();assert.ok(value.body.includes('[リンクカード]\nURL：https://example.com/item/123'));assert.ok(!value.body.includes('embed.example.com'));
});

test('古いnoteカードは未読込iframeの属性から埋め込みURLを残し、作者を推測しない',()=>{
 const f=embedFixture('<figure embedded-service="note" data-identifier="nOld"><iframe src="about:blank" data-src="https://note.com/embed/notes/nOld" style="visibility:hidden"></iframe></figure>');
 const body=f.extract().body;assert.ok(body.includes('[リンクカード]\n埋め込みURL：https://note.com/embed/notes/nOld'));assert.ok(!body.includes('著者：'));assert.ok(!body.includes('/test/n/nOld'));
 const linked=embedFixture('<figure embedded-service="note"><a href="https://note.com/other/n/nOld"></a><iframe src="https://note.com/embed/notes/nOld"></iframe></figure>');assert.ok(linked.extract().body.includes('URL：https://note.com/other/n/nOld'));
});

test('添付ファイルはファイル名・サイズ・URLへ整形し、操作文言を除いてコピーする',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="before"></p><figure embedded-service="attachment" id="attachment"><div><a class="file-widget__link" href="https://note.com/api/v2/attachments/download/fe2a0438f7f580abf17fd054ff1c036d"><div><strong class="file-widget__filename" id="filename"></strong><div class="file-widget__filesize" id="filesize"></div><span id="disclaimer"></span></div><div id="download"></div></a></div><figcaption id="caption"></figcaption></figure><p id="after"></p></div></div></article>');
 for(const [id,text]of [['title','添付の記事'],['author','著者'],['before','前の本文'],['filename','iconSet_default.zip'],['filesize','783 KB'],['disclaimer','ファイルダウンロードについて'],['download','ダウンロード'],['caption','添付の説明'],['after','後の本文']])doc.getElementById(id).textContent=text;
 const win={getComputedStyle:n=>({display:n.hidden?'none':'block',visibility:'visible'})},extract=()=>f.context.HikikomoriNoteArticles.extract(doc,win,article().url);
 const value=extract(),url='https://note.com/api/v2/attachments/download/fe2a0438f7f580abf17fd054ff1c036d';
 assert.ok(value.body.includes(`[ファイルダウンロード]\nファイル名：iconSet_default.zip （783 KB）\nリンク先URL：${url}`));assert.equal(value.body.split(url).length-1,1);assert.ok(!value.body.includes('ファイルダウンロードについて'));
 assert.ok(value.body.indexOf('前の本文')<value.body.indexOf('ファイル名：'));assert.ok(value.body.indexOf(url)<value.body.indexOf('添付の説明'));assert.ok(value.body.indexOf('添付の説明')<value.body.indexOf('後の本文'));
 doc.getElementById('filesize').hidden=true;assert.ok(extract().body.includes(`ファイル名：iconSet_default.zip\nリンク先URL：${url}`));assert.ok(!extract().body.includes('783 KB'));
 doc.getElementById('attachment').hidden=true;assert.ok(!extract().body.includes('iconSet_default.zip'));
});

test('本文中の文字列リンクと添付ファイルのURLを文字の位置に残し、非表示・画像だけ・危険なリンクを除外する',async()=>{
 const f=runtime(),doc=documentFromHtml('<article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/test" id="author"></a><time></time></div><div id="note-body" data-name="body"><p id="intro"></p><p><a href="https://note.com/other/n/n456"><strong id="link-text"></strong></a></p><figure embedded-service="attachment"><a href="https://note.com/api/v2/attachments/download/key"><strong id="file"></strong></a></figure><a id="url-text" href="https://example.org/plain"></a><a hidden href="https://hidden.example/"><span id="hidden"></span></a><a href="javascript:alert(1)" id="unsafe"></a><a href="https://user:secret@example.com/" id="credentials"></a><a href="https://image.example/full"><img></a><p id="end"></p></div></div></article>');
 for(const [id,text]of [['title','リンク付き記事'],['author','筆者'],['intro','私の考えです。'],['link-text','鳥ランド'],['file','参照プロンプト.md'],['url-text','https://example.org/plain'],['hidden','秘密'],['unsafe','危険リンクの文字'],['credentials','認証リンクの文字'],['end','記事の終わり']])doc.getElementById(id).textContent=text;
 const win={getComputedStyle:node=>({display:node.hidden?'none':'block',visibility:'visible'})};
 const value=f.context.HikikomoriNoteArticles.extract(doc,win,article().url);
 assert.ok(value.body.includes('鳥ランド（リンク先URL：https://note.com/other/n/n456）'));
 assert.ok(value.body.includes('参照プロンプト.md（リンク先URL：https://note.com/api/v2/attachments/download/key）'));
 assert.equal(value.body.split('https://example.org/plain').length-1,1);
 for(const excluded of ['hidden.example','秘密','javascript:','secret@example.com','image.example'])assert.ok(!value.body.includes(excluded));
 assert.ok(value.body.indexOf('鳥ランド')<value.body.indexOf('参照プロンプト.md'));assert.ok(value.body.indexOf('参照プロンプト.md')<value.body.indexOf('記事の終わり'));

});
