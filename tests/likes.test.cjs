"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {documentFromHtml}=require('./helpers/dom.cjs');
const homeFixture=require('./helpers/home.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const marker='data-hikikomori-note-like-hidden';
const url='https://note.com/ruminar/n/na68901f3be0b';
const heart='<button id="heart" type="button" aria-pressed="false"><svg data-id="Icon" role="img" aria-label="スキ"></svg></button>';
const counter='<div id="reaction" class="flex items-center justify-center"><div>'+heart+'</div><button id="count" aria-label="12スキ この記事にスキをつけたユーザーを見る"></button></div>';
const embed='<div class="p-noteEmbed note-embed"><div class="p-noteEmbed__inner"><a id="link" class="p-noteEmbed__link" href="https://note.com/ruminar/n/n123"></a><div class="p-noteEmbed__body"><div id="title"></div><div id="description"></div></div><div id="static" class="p-noteEmbed__suki"><div class="p-noteEmbed__sukiIcon"><i class="c-icon c-icon--heart"></i></div><div id="static-count" class="p-noteEmbed__sukiLabel"></div></div><div id="author"></div></div></div>';
function fixture(html=counter,patch={}) {
 const c=vm.createContext({URL,console});for(const file of ['src/common.js','src/routing.js','src/note-ui.js'])vm.runInContext(source(file),c);
 const doc=documentFromHtml(html),settings={...plain(c.HikikomoriNote.defaultSettings()),hideLikeCounts:true,...patch};
 const win={matchMedia:()=>({matches:true}),getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const control=c.HikikomoriNoteUi.create(doc,win,{});
 const update=(nextUrl=url)=>control.update(settings,nextUrl);
 if(doc.getElementById('count'))doc.getElementById('count').textContent='12';
 fillEmbed(doc);
 return {c,doc,settings,control,update,core:c.HikikomoriNote};
}
function fillEmbed(doc) {
 for(const [id,text] of [['static-count','9'],['title','2026年の作品'],['description','本文には123とハート♡もある'],['author','作者名']])if(doc.getElementById(id))doc.getElementById(id).textContent=text;
}
function embeddedDocument() {
 const doc=documentFromHtml('<head></head>'+embed);doc.head=doc.querySelector('head');doc.location={href:'https://note.com/embed/notes/n123?theme=auto'};fillEmbed(doc);return doc;
}
test('スキ数設定は初期OFF、旧保存は読取だけでOFF。形式7の往復・旧形式1〜6・型検証',async()=>{
 const f=fixture();assert.equal(f.core.defaultSettings().hideLikeCounts,false);assert.equal(f.core.readSettings({}).hideLikeCounts,false);
 let raw=plain(f.core.defaultSettings()),writes=0;delete raw.hideLikeCounts;
 const controller=f.c.HikikomoriNoteRouting.createController({load:async()=>raw,store:async v=>{raw=plain(v);writes++;},setRules:async()=>{}});
 assert.equal((await controller.getState()).hideLikeCounts,false);assert.equal(writes,0);
 await controller.save({hideLikeCounts:true});assert.equal(raw.hideLikeCounts,true);
 const json=f.core.exportSettings(await controller.getState()),d=JSON.parse(json);assert.equal(d.schemaVersion,7);assert.equal(f.core.parseSettingsExport(json).hideLikeCounts,true);
 for(const version of [1,2,3,4,5,6]) {
  const old=JSON.parse(json);old.schemaVersion=version;delete old.settings.hideLikeCounts;
  if(version<5)for(const g of old.settings.tagGroups){g.tags=g.items.map(i=>i.tag);delete g.items;}
  if(version<4)delete old.settings.keepNoteHeaderVisible;
  if(version<3){old.settings.legacyMode=false;delete old.settings.mode;}
  if(version<2)delete old.settings.authorDisplayRules;
  assert.equal(f.core.parseSettingsExport(JSON.stringify(old)).hideLikeCounts,false);
 }
 const before=JSON.stringify(raw);for(const v of ['true',1,null])await assert.rejects(controller.save({hideLikeCounts:v}));assert.equal(JSON.stringify(raw),before);
 delete d.settings.hideLikeCounts;assert.throws(()=>f.core.parseSettingsExport(JSON.stringify(d)));
 d.settings.hideLikeCounts='true';assert.throws(()=>f.core.parseSettingsExport(JSON.stringify(d)));
});
test('設定画面のスキ数チェックを保存し、JSON書き出しにも反映する',async()=>{
 const f=homeFixture();await new Promise(r=>setImmediate(r));const checkbox=f.nodes.get('hide-like-counts');assert.equal(checkbox.disabled,false);assert.equal(checkbox.checked,false);
 checkbox.checked=true;checkbox.fire('change');f.nodes.get('settings').fire('submit');await new Promise(r=>setImmediate(r));assert.equal(f.state.hideLikeCounts,true);
 f.nodes.get('export-settings').onclick();await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(f.nodes.get('settings-json').value).settings.hideLikeCounts,true);
});
test('操作ハートとイベントを保持し、ユーザー一覧を開く数字だけ隠す。ON/OFFと全モード',()=>{
 for(const mode of ['normal','social','severe']) {
  const f=fixture(counter,{mode}),count=f.doc.getElementById('count'),button=f.doc.getElementById('heart');let clicks=0;button.addEventListener('click',()=>clicks++);
  f.update();assert.ok(count.hasAttribute(marker));assert.equal(button.hasAttribute(marker),false);assert.equal(button.parentElement.hasAttribute(marker),false);
  assert.equal(button.fire('click').defaultPrevented,undefined);assert.equal(clicks,1);
  button.setAttribute('aria-pressed','true');button.querySelector('svg').setAttribute('aria-label','スキを取り消す');count.textContent='13';count.setAttribute('aria-label','13スキ この記事にスキをつけたユーザーを見る');f.control.invalidatePaidCards();f.update();assert.ok(count.hasAttribute(marker));
  f.settings.hideLikeCounts=false;f.update();assert.equal(count.hasAttribute(marker),false);assert.equal(count.textContent,'13');
  f.settings.hideLikeCounts=true;f.update();assert.ok(count.hasAttribute(marker));f.settings.enabled=false;f.update();assert.equal(count.hasAttribute(marker),false);
 }
});
test('既にスキ済みのカードも数字を隠し、押下と取り消しのラベル・状態更新順に依存しない',()=>{
 const f=fixture(counter.replace('aria-pressed="false"','aria-pressed="true"').replace('aria-label="スキ"','aria-label="スキを取り消す"'));
 const button=f.doc.getElementById('heart'),icon=button.querySelector('svg'),count=f.doc.getElementById('count');let clicks=0;button.addEventListener('click',()=>clicks++);
 count.textContent='531';count.setAttribute('aria-label','531スキ この記事にスキをつけたユーザーを見る');f.update();assert.ok(count.hasAttribute(marker));
 for(const [pressed,label,number] of [['false','スキを取り消す','531'],['false','スキ','530'],['false','スキを取り消す','530'],['true','スキ','531'],['true','スキを取り消す','531']]){
  button.setAttribute('aria-pressed',pressed);icon.setAttribute('aria-label',label);count.textContent=number;count.setAttribute('aria-label',number+'スキ この記事にスキをつけたユーザーを見る');
  f.control.invalidatePaidCards();f.update();assert.ok(count.hasAttribute(marker));assert.equal(button.hasAttribute(marker),false);assert.equal(button.fire('click').defaultPrevented,undefined);
 }
 assert.equal(clicks,5);f.settings.hideLikeCounts=false;f.update();assert.equal(count.hasAttribute(marker),false);assert.equal(count.textContent,'531');assert.equal(icon.getAttribute('aria-label'),'スキを取り消す');
});
test('数字以外・別操作・役割不明のハート・未知の構造は変更しない',()=>{
 for(const change of [f=>f.doc.getElementById('count').textContent='12人の感想',f=>f.doc.getElementById('count').setAttribute('aria-label','12コメント'),f=>f.doc.getElementById('heart').removeAttribute('aria-pressed'),f=>f.doc.getElementById('reaction').className='',f=>f.doc.getElementById('heart').querySelector('svg').setAttribute('aria-label','お気に入り')]) {
  const f=fixture();change(f);f.update();assert.equal(f.doc.getElementById('count').hasAttribute(marker),false);
 }
 const f=fixture(counter);f.doc.getElementById('reaction').setAttribute('data-hikikomori-note-owned','');f.update();assert.equal(f.doc.getElementById('count').hasAttribute(marker),false);
});
test('表示専用ハートと数だけ隠し、埋め込みカードのリンク・本文・作者名を維持',()=>{
 const f=fixture(embed);let navigated=0;f.doc.getElementById('link').addEventListener('click',()=>navigated++);f.update();
 assert.ok(f.doc.getElementById('static').hasAttribute(marker));
 for(const id of ['link','title','description','author'])assert.equal(f.doc.getElementById(id).hasAttribute(marker),false);
 f.doc.getElementById('link').fire('click');assert.equal(navigated,1);assert.equal(f.doc.getElementById('title').textContent,'2026年の作品');assert.match(f.doc.getElementById('description').textContent,/123/);
 f.control.stop();assert.equal(f.doc.getElementById('static').hasAttribute(marker),false);
});
test('静的カードに操作が追加された場合や数字以外の説明・外部リンクは残す',()=>{
 for(const change of [f=>f.doc.getElementById('static').setAttribute('role','button'),f=>f.doc.getElementById('static-count').textContent='9つの作品',f=>f.doc.getElementById('link').href='https://example.org/n/n123',f=>{const b=f.doc.createElement('button');f.doc.getElementById('static').append(b);},f=>f.doc.getElementById('static').parentElement.setAttribute('tabindex','0')]) {
  const f=fixture(embed);change(f);f.update();assert.equal(f.doc.getElementById('static').hasAttribute(marker),false);
 }
});
test('後挿入・数字更新・DOM再利用を再判定し、構造不一致や対象外URLで復元',()=>{
 const f=fixture('');f.update();const other=documentFromHtml(counter);const row=other.getElementById('reaction');f.doc.root.append(row);const count=other.getElementById('count');count.textContent='0';count.setAttribute('aria-label','0スキ この記事にスキをつけたユーザーを見る');f.control.invalidatePaidCards();f.update();assert.ok(count.hasAttribute(marker));
 count.setAttribute('aria-label','別の機能');f.control.invalidatePaidCards();f.update();assert.equal(count.hasAttribute(marker),false);
 count.setAttribute('aria-label','0スキ この記事にスキをつけたユーザーを見る');f.control.invalidatePaidCards();f.update();assert.ok(count.hasAttribute(marker));f.update('https://example.org');assert.equal(count.hasAttribute(marker),false);
});
test('同一オリジンの埋め込み文書を遅延ロード後に処理し、差し替え・OFFで印とスタイルを復元',()=>{
 const f=fixture('<iframe id="frame" src="https://note.com/embed/notes/n123?theme=auto"></iframe>'),frame=f.doc.getElementById('frame');f.update();
 const child=embeddedDocument();frame.contentDocument=child;f.update();assert.ok(child.getElementById('static').hasAttribute(marker));assert.equal(child.head.children.length,1);
 child.getElementById('static-count').textContent='文字へ変更';f.update();assert.equal(child.getElementById('static').hasAttribute(marker),false);
 child.getElementById('static-count').textContent='10';f.update();assert.ok(child.getElementById('static').hasAttribute(marker));
 const next=embeddedDocument();frame.contentDocument=next;f.update();assert.equal(child.getElementById('static').hasAttribute(marker),false);assert.equal(child.head.children.length,0);assert.ok(next.getElementById('static').hasAttribute(marker));
 f.settings.enabled=false;f.update();assert.equal(next.getElementById('static').hasAttribute(marker),false);assert.equal(next.head.children.length,0);
 f.settings.enabled=true;f.update();frame.remove();f.update();assert.equal(next.getElementById('static').hasAttribute(marker),false);assert.equal(next.head.children.length,0);
});
test('外部・sandbox・別URLへ移動したフレームには触れない。停止時も埋め込みを復元',()=>{
 const f=fixture('<iframe id="frame" src="https://note.com/embed/notes/n123"></iframe>'),frame=f.doc.getElementById('frame'),child=embeddedDocument();
 frame.contentDocument=child;frame.setAttribute('src','https://example.org/embed/notes/n123');f.update();assert.equal(child.head.children.length,0);
 frame.setAttribute('src','https://note.com/embed/notes/n123');child.location.href='https://note.com/ruminar';f.update();assert.equal(child.head.children.length,0);
 Object.defineProperty(frame,'contentDocument',{configurable:true,get(){throw new Error('SecurityError');}});assert.doesNotThrow(()=>f.update());
 Object.defineProperty(frame,'contentDocument',{value:child});child.location.href='https://note.com/embed/notes/n123';f.update();assert.ok(child.getElementById('static').hasAttribute(marker));f.control.stop();assert.equal(child.getElementById('static').hasAttribute(marker),false);assert.equal(child.head.children.length,0);
});

const magazineLikes='<div id="card" class="flex w-full rounded bg-surface-normal flex-col"><a id="article" href="https://note.com/nontsu/n/n123"></a><div class="block basis-auto overflow-visible mt-2"><div id="stats" class="mt-2 flex items-center gap-2 text-sm empty:hidden"><div id="display-likes" class="flex items-center justify-center gap-1 text-text-like"><svg id="display-heart" data-id="Icon" role="img" aria-label="スキの数"></svg><span id="display-count" class="text-sm"></span></div><span id="price"></span></div><a id="profile" href="https://note.com/nontsu"></a></div></div>';
function magazineFixture(){const f=fixture(magazineLikes);f.doc.getElementById('display-count').textContent='19';f.doc.getElementById('price').textContent='¥450';return f;}
test('マガジン一覧の表示専用ハートとスキ数だけ隠し、価格・記事と作者のリンクを保持',()=>{
 for(const mode of ['normal','social','severe']){
  const f=magazineFixture();f.settings.mode=mode;let navigated=0;f.doc.getElementById('article').addEventListener('click',()=>navigated++);f.update('https://note.com/nontsu/magazines');assert.ok(f.doc.getElementById('display-likes').hasAttribute(marker));
  for(const id of ['card','stats','price','article','profile'])assert.equal(f.doc.getElementById(id).hasAttribute(marker),false);f.doc.getElementById('article').fire('click');assert.equal(navigated,1);assert.equal(f.doc.getElementById('price').textContent,'¥450');
  f.settings.hideLikeCounts=false;f.update();assert.equal(f.doc.getElementById('display-likes').hasAttribute(marker),false);f.settings.hideLikeCounts=true;f.update();f.settings.enabled=false;f.update();assert.equal(f.doc.getElementById('display-likes').hasAttribute(marker),false);
 }
});
test('表示専用ハートは操作可能・数字以外・未知のカードとアイコンを誤って隠さない',()=>{
 for(const change of [f=>f.doc.getElementById('display-count').textContent='19人の感想',f=>f.doc.getElementById('display-likes').setAttribute('role','button'),f=>f.doc.getElementById('card').setAttribute('tabindex','0'),f=>f.doc.getElementById('display-heart').setAttribute('aria-label','お気に入り'),f=>f.doc.getElementById('display-heart').removeAttribute('role'),f=>f.doc.getElementById('article').href='https://example.org/n/n123',f=>f.doc.getElementById('stats').className='',f=>f.doc.getElementById('card').className='',f=>{const b=f.doc.createElement('button');f.doc.getElementById('display-likes').append(b);}]){
  const f=magazineFixture();change(f);f.update('https://note.com/nontsu/magazines');assert.equal(f.doc.getElementById('display-likes').hasAttribute(marker),false);
 }
});
test('表示専用スキ数の後挿入・数値変更・構造変更・停止に追従する',()=>{
 const f=magazineFixture(),card=f.doc.getElementById('card'),group=f.doc.getElementById('display-likes');card.remove();f.update();f.doc.root.append(card);f.control.invalidatePaidCards();f.update();assert.ok(group.hasAttribute(marker));
 f.doc.getElementById('display-count').textContent='1.2万';f.control.invalidatePaidCards();f.update();assert.ok(group.hasAttribute(marker));f.doc.getElementById('display-count').textContent='本文';f.control.invalidatePaidCards();f.update();assert.equal(group.hasAttribute(marker),false);f.doc.getElementById('display-count').textContent='20';f.control.invalidatePaidCards();f.update();f.control.stop();assert.equal(group.hasAttribute(marker),false);
});
test('質問箱の末尾波括弧付きスキ数ラベルも数値だけ隠し、ハート操作と復元を維持',()=>{
 for(const qaUrl of ['https://note.com/qa/nontsu','https://note.com/qa/nontsu/q/abc123'])for(const mode of ['normal','social','severe']){
  const f=fixture(counter,{mode}),count=f.doc.getElementById('count'),heart=f.doc.getElementById('heart');let clicks=0;heart.addEventListener('click',()=>clicks++);
  count.setAttribute('aria-label','12スキ この記事にスキをつけたユーザーを見る}');f.update(qaUrl);assert.ok(count.hasAttribute(marker));assert.equal(heart.hasAttribute(marker),false);heart.fire('click');assert.equal(clicks,1);
  heart.querySelector('svg').setAttribute('aria-label','スキを取り消す');count.textContent='13';count.setAttribute('aria-label','13スキ この記事にスキをつけたユーザーを見る}');f.control.invalidatePaidCards();f.update(qaUrl);assert.ok(count.hasAttribute(marker));
  count.setAttribute('aria-label','13スキ この記事にスキをつけたユーザーを見る}}');f.control.invalidatePaidCards();f.update(qaUrl);assert.equal(count.hasAttribute(marker),false);
  count.setAttribute('aria-label','13スキ この記事にスキをつけたユーザーを見る}');f.control.invalidatePaidCards();f.update(qaUrl);f.settings.hideLikeCounts=false;f.update(qaUrl);assert.equal(count.hasAttribute(marker),false);assert.equal(count.textContent,'13');
 }
 const f=fixture(counter);f.doc.getElementById('count').setAttribute('aria-label','12スキ この記事にスキをつけたユーザーを見る}');f.update();assert.equal(f.doc.getElementById('count').hasAttribute(marker),false);
});

function embedScriptFixture(patch={}) {
 const doc=embeddedDocument();doc.documentElement=doc.root;const docEvents={},winEvents={};doc.addEventListener=(name,fn)=>docEvents[name]=fn;doc.removeEventListener=(name,fn)=>{if(docEvents[name]===fn)delete docEvents[name];};
 let resolveLoad,rejectLoad,listener,disconnected=false,unsubscribed=false,observed,notify;
 const c=vm.createContext({URL,document:doc,location:doc.location,window:{addEventListener:(name,fn)=>winEvents[name]=fn},MutationObserver:class {constructor(fn){notify=fn;}observe(target,options){observed={target,options};}disconnect(){disconnected=true;}}});
 for(const file of ['src/common.js','src/note-ui.js'])vm.runInContext(source(file),c);
 c.HikikomoriNotePlatform={subscribe(fn){listener=fn;return ()=>unsubscribed=true;},load:()=>new Promise((resolve,reject)=>{resolveLoad=resolve;rejectLoad=reject;})};
 if(patch.url)doc.location.href=patch.url;
 vm.runInContext(source('src/embed-likes.js'),c);
 return {doc,c,notify:()=>notify?.(),change:value=>listener?.(value),resolve:value=>resolveLoad?.(value),reject:()=>rejectLoad?.(new Error('storage unavailable')),show:()=>winEvents.pageshow?.(),hide:persisted=>winEvents.pagehide?.({persisted}),loaded:()=>docEvents.DOMContentLoaded?.(),get disconnected(){return disconnected;},get unsubscribed(){return unsubscribed;},get observed(){return observed;}};
}
const embedReady='data-hikikomori-note-embed-ready',flushEmbed=()=>new Promise(resolve=>setImmediate(resolve));
test('埋め込み専用スクリプトは設定と厳密判定の後に先行CSSを解除し、ON・OFFを復元',async()=>{
 const f=embedScriptFixture();assert.equal(f.doc.documentElement.hasAttribute(embedReady),false);assert.equal(f.observed.target,f.doc);assert.equal(f.observed.options.characterData,true);assert.equal(f.observed.options.attributeFilter.includes(marker),false);
 f.resolve({enabled:true,hideLikeCounts:true});await flushEmbed();assert.equal(f.doc.documentElement.hasAttribute(embedReady),true);assert.ok(f.doc.getElementById('static').hasAttribute(marker));
 f.change({enabled:true,hideLikeCounts:false});assert.equal(f.doc.getElementById('static').hasAttribute(marker),false);f.change({enabled:true,hideLikeCounts:true});assert.ok(f.doc.getElementById('static').hasAttribute(marker));f.change({enabled:false,hideLikeCounts:true});assert.equal(f.doc.getElementById('static').hasAttribute(marker),false);
});
test('埋め込み自身の変更監視で後挿入・数値と役割変更を反映し、本文・リンク・操作を維持',async()=>{
 const f=embedScriptFixture(),count=f.doc.getElementById('static');f.resolve({enabled:true,hideLikeCounts:true});await flushEmbed();assert.ok(count.hasAttribute(marker));
 for(const id of ['link','title','description','author'])assert.equal(f.doc.getElementById(id).hasAttribute(marker),false);
 f.doc.getElementById('static-count').textContent='9つの作品';f.notify();assert.equal(count.hasAttribute(marker),false);f.doc.getElementById('static-count').textContent='12';f.notify();assert.ok(count.hasAttribute(marker));count.setAttribute('role','button');f.notify();assert.equal(count.hasAttribute(marker),false);count.removeAttribute('role');f.notify();assert.ok(count.hasAttribute(marker));
 const parent=count.parentElement;count.remove();f.notify();parent.append(count);f.notify();assert.ok(count.hasAttribute(marker));f.hide(true);assert.equal(f.disconnected,false);f.show();assert.ok(count.hasAttribute(marker));f.hide(false);assert.equal(count.hasAttribute(marker),false);assert.equal(f.disconnected,true);assert.equal(f.unsubscribed,true);f.change({enabled:true,hideLikeCounts:true});assert.equal(count.hasAttribute(marker),false);
});
test('埋め込みの古い設定読込は新しい通知や停止を上書きせず、エラー・対象外URLは表示を戻す',async()=>{
 const f=embedScriptFixture();f.change({enabled:false,hideLikeCounts:true});f.resolve({enabled:true,hideLikeCounts:true});await flushEmbed();assert.equal(f.doc.getElementById('static').hasAttribute(marker),false);
 const stopped=embedScriptFixture();stopped.hide(false);stopped.resolve({enabled:true,hideLikeCounts:true});await flushEmbed();assert.equal(stopped.doc.getElementById('static').hasAttribute(marker),false);
 const error=embedScriptFixture();error.reject();await flushEmbed();assert.equal(error.doc.documentElement.hasAttribute(embedReady),true);assert.equal(error.doc.getElementById('static').hasAttribute(marker),false);
 for(const url of ['https://example.org/embed/notes/n123','https://note.com/embed/notes/unknown','https://note.com/embed/notes/n123/admin']){const other=embedScriptFixture({url});assert.equal(other.doc.documentElement.hasAttribute(embedReady),true);assert.equal(other.observed,undefined);}
});
test('親文書は専用スクリプトが準備済みの埋め込みを定期走査せず、未準備の互換処理は維持',()=>{
 const f=fixture('<iframe id="frame" src="https://note.com/embed/notes/n123?theme=auto"></iframe>'),child=embeddedDocument();child.documentElement=child.root;child.documentElement.setAttribute(embedReady,'');f.doc.getElementById('frame').contentDocument=child;f.update();assert.equal(child.head.children.length,0);assert.equal(child.getElementById('static').hasAttribute(marker),false);
 child.documentElement.removeAttribute(embedReady);f.update();assert.equal(child.head.children.length,1);assert.ok(child.getElementById('static').hasAttribute(marker));
 child.documentElement.setAttribute(embedReady,'');f.update();assert.equal(child.head.children.length,0);assert.ok(child.getElementById('static').hasAttribute(marker));f.control.stop();assert.ok(child.getElementById('static').hasAttribute(marker));
});
test('埋め込み専用登録はdocument_start・note埋め込みURL・全フレームだけに限定する',()=>{
 const manifest=JSON.parse(source('manifest.json')),registration=manifest.content_scripts[1];assert.deepEqual(registration.matches,['https://note.com/embed/notes/*']);assert.equal(registration.all_frames,true);assert.equal(registration.run_at,'document_start');assert.deepEqual(registration.css,['src/embed-likes.css']);assert.deepEqual(manifest.content_scripts[0].exclude_matches,registration.matches);
 for(const file of [...registration.js,...registration.css])assert.ok(source(file).length);
 assert.equal(registration.js.includes('src/content.js'),false);assert.equal(manifest.permissions.includes('scripting'),false);
});
