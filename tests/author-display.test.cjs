"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {documentFromHtml}=require('./helpers/dom.cjs');
const homeFixture=require('./helpers/home.cjs');
const root=path.resolve(__dirname,'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
const flush=()=>new Promise(r=>setImmediate(r));
function backend(patch={}){
 const c=vm.createContext({URL,console}); for(const file of ['src/common.js','src/routing.js'])vm.runInContext(source(file),c);
 const core=c.HikikomoriNote;let state={...plain(core.defaultSettings()),noteUserId:'me',...patch},writes=0,fail=false;
 const controller=c.HikikomoriNoteRouting.createController({load:async()=>state,store:async v=>{if(fail)throw Error('storage failed');state=plain(v);writes++;},setRules:async()=>{}});
 return {c,core,controller,get state(){return state;},get writes(){return writes;},set fail(v){fail=v;}};
}
function operation(f,userId='yeku',action='hide',displayName='YeKu@「知る」を優しさに。'){
 const s=f.core.readSettings(f.state);return {userId,displayName,action,expectedAction:f.core.authorRule(s,userId)?.action??null,expectedRevision:s.authorDisplayRevision,expectedSelf:s.noteUserId};
}
const articleUrl='https://note.com/yeku/n/n123';
const articleHtml='<article id="note-article"><div><a href="https://note.com/yeku" id="author-name"></a><div><time></time></div></div><div id="note-body"></div><div id="note-paywall" class="note-paywall"><section><div><h2 id="pay-heading"></h2></div><div><section id="offer" class="flex flex-col rounded-lg border border-border-strong px-4"><span id="article-label"></span><span id="price"></span><a id="membership" href="https://note.com/yeku/membership"></a><button id="buy" type="button" data-name="Button"></button></section></div></section></div></article>';
function ui(html=articleHtml,patch={},actions={}){
 const f=backend(patch),doc=documentFromHtml(html);
 const create=doc.createElement.bind(doc);
 doc.createElement=tag=>{const n=create(tag);if(tag==='dialog'){n.showModal=()=>{n.open=true;};n.close=()=>{n.open=false;};}return n;};
 const win={wide:true,matchMedia:()=>({matches:true}),getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const calls=[];vm.runInContext(source('src/note-ui.js'),f.c);
 const control=f.c.HikikomoriNoteUi.create(doc,win,{settingsUrl:()=>"chrome-extension://self/home.html",async setAuthor(op,src){calls.push({op:plain(op),src});await f.controller.author(op,{fromArticle:src==='article'});control.update(f.core.readSettings(f.state),articleUrl);},async refresh(){},...actions});
 return {...f,backend:f,doc,control,win,calls,update:(url=articleUrl)=>control.update(f.core.readSettings(f.state),url)};
}
function fillArticle(f,kind='purchase'){
 f.doc.getElementById('author-name').textContent='YeKu@「知る」を優しさに。';f.doc.getElementById('pay-heading').textContent='ここから先は';
 f.doc.getElementById('article-label').textContent='記事';f.doc.getElementById('price').textContent='¥200';f.doc.getElementById('buy').textContent=kind==='purchase'?'購入手続きへ':'参加手続きへ';
 if(kind==='membership'){f.doc.getElementById('price').textContent='';f.doc.getElementById('article-label').textContent='';}
}
const card='<div class="grid-rows-subgrid"><div><a class="absolute inset-0" title="記事" aria-label="記事" href="https://note.com/yeku/n/n123"></a><h3></h3><a data-name="avatar" href="https://note.com/yeku"></a><span id="card-price" class="text-text-success"></span></div></div>';

test('作者データは表示名を保持し、日本語表示名順・IDの補助順で整理する',()=>{
 const f=backend();const list=[{userId:'b',displayName:'あ',action:'hide'},{userId:'z',displayName:'か',action:'hide'},{userId:'a',displayName:'あ',action:'allow'}];
 assert.deepEqual(plain(f.core.sortAuthors(list)).map(x=>x.userId),['a','b','z']);assert.equal(f.core.authorLabel(list[0]),'あ（b）');assert.equal(f.core.authorLabel({userId:'a',displayName:''}),'a');
 assert.equal(f.core.authorId('https://note.com/yeku/'),'yeku');for(const id of ['settings','Search','preview','https://evil.test/a','https://note.com/yeku/n/n123'])assert.throws(()=>f.core.authorId(id));
 const old={...f.state};delete old.authorDisplayRules;delete old.authorDisplayRevision;assert.deepEqual(plain(f.core.readSettings(old).authorDisplayRules),[]);
});
test('作者の追加・許可への変更・解除は1回ずつ保存し、無料設定・OFF・重度でも管理できる',async()=>{
 const f=backend({enabled:false,mode:'severe',hidePaidArticles:false});await f.controller.author(operation(f));
 assert.equal(f.writes,1);assert.equal(f.state.authorDisplayRules[0].displayName,'YeKu@「知る」を優しさに。');
 await f.controller.author(operation(f,'yeku','allow','新しい名前'));assert.equal(f.state.authorDisplayRules[0].action,'allow');assert.equal(f.state.authorDisplayRules[0].displayName,'新しい名前');
 await f.controller.author(operation(f,'yeku',null));assert.deepEqual(f.state.authorDisplayRules,[]);assert.equal(f.state.enabled,false);assert.equal(f.state.authorDisplayRevision,3);
});
test('自分・空ID・不明操作・古いrevisionを拒否し、他タブの許可を上書きしない',async()=>{
 const f=backend();await assert.rejects(f.controller.author(operation(f,'ME')));await assert.rejects(f.controller.author(operation(f,'')));
 const stale=operation(f);await f.controller.author(operation(f,'yeku','allow'));await assert.rejects(f.controller.author(stale),{code:'CONFLICT'});
 await assert.rejects(f.controller.author({...operation(f),action:'block'}));await assert.rejects(f.controller.author({...operation(f),extra:true}));assert.equal(f.state.authorDisplayRules[0].action,'allow');
});
test('作者保存と既存設定・タグのキューはデータを保持し、失敗・破損でも消去しない',async()=>{
 const f=backend();await Promise.all([f.controller.author(operation(f)),f.controller.save({hidePaidArticles:true}),f.controller.tag({type:'ADD_TAG',tag:'AI',groupId:'group1'})]);
 assert.equal(f.state.authorDisplayRules.length,1);assert.equal(f.state.hidePaidArticles,true);assert.deepEqual(f.state.tagGroups[0].tags,['AI']);
 const before=plain(f.state);f.fail=true;await assert.rejects(f.controller.author(operation(f,'yeku',null)));assert.deepEqual(f.state,before);
 const broken=backend({authorDisplayRules:[{userId:'yeku',displayName:'',action:'unknown'}]});assert.ok((await broken.controller.getState()).authorWarning);
 await assert.rejects(broken.controller.author(operation(broken)),{code:'INVALID_AUTHORS'});await broken.controller.save({enabled:false});assert.equal(broken.state.authorDisplayRules[0].action,'unknown');assert.throws(()=>broken.core.exportSettings(broken.core.readSettings(broken.state)));
 const dup=backend({authorDisplayRules:[{userId:'yeku',displayName:'',action:'hide'},{userId:'YeKu',displayName:'',action:'allow'}]});assert.ok(dup.core.readSettings(dup.state).authorWarning);
});
test('記事からの保存だけは拡張ON・有料非表示ON・未登録が必要',async()=>{
 for(const patch of [{enabled:false,hidePaidArticles:true},{hidePaidArticles:false}]){const f=backend(patch);await assert.rejects(f.controller.author(operation(f),{fromArticle:true}),{code:'CONFLICT'});}
 const f=backend({hidePaidArticles:true});await f.controller.author(operation(f),{fromArticle:true});await assert.rejects(f.controller.author(operation(f,'yeku','allow'),{fromArticle:true}),{code:'CONFLICT'});
});
test('設定形式6は作者名・状態を往復し、形式1は確認用の空リストとして取り込む',async()=>{
 const f=backend();await f.controller.author(operation(f));const json=f.core.exportSettings(f.core.readSettings(f.state));assert.equal(JSON.parse(json).schemaVersion,6);
 assert.deepEqual(plain(f.core.parseSettingsExport(json).authorDisplayRules),f.state.authorDisplayRules);
 const old=JSON.parse(json);old.schemaVersion=1;for(const g of old.settings.tagGroups){g.tags=g.items.map(x=>x.tag);delete g.items;}delete old.settings.keepNoteHeaderVisible;old.settings.legacyMode=old.settings.mode==='severe';delete old.settings.mode;delete old.settings.authorDisplayRules;
 assert.deepEqual(plain(f.core.parseSettingsExport(JSON.stringify(old)).authorDisplayRules),[]);
 const token=f.core.settingsToken(f.core.readSettings(f.state));await f.controller.importSettings({json:JSON.stringify(old),expectedToken:token});assert.deepEqual(f.state.authorDisplayRules,[]);assert.equal(f.state.authorDisplayRevision,2);
 const bad=JSON.parse(json);bad.settings.authorDisplayRules[0].displayName='x\ny';assert.throws(()=>f.core.parseSettingsExport(JSON.stringify(bad)));
});
test('形式6は3モードを内部保存・書き出しで往復し作者名を保持',async()=>{
 for(const mode of ['normal','severe','social']){
   const f=backend({mode,enabled:false,authorDisplayRules:[{userId:'yeku',displayName:'作者名',action:'allow'}]});
   const json=f.core.exportSettings(f.core.readSettings(f.state)),doc=JSON.parse(json);
   assert.equal(doc.schemaVersion,6);assert.equal(doc.settings.mode,mode);assert.equal(Object.hasOwn(doc.settings,'legacyMode'),false);
   assert.equal(f.core.parseSettingsExport(json).mode,mode);
   await f.controller.importSettings({json,expectedToken:f.core.settingsToken(f.core.readSettings(f.state))});
   assert.equal(f.state.mode,mode);assert.equal(Object.hasOwn(f.state,'legacyMode'),false);assert.equal(f.state.authorDisplayRules[0].displayName,'作者名');assert.equal(f.state.enabled,false);
 }
});
test('未知mode・旧フラグ混在は読み込み前に拒否し、保存済み設定を変更しない',async()=>{
 const f=backend(),base=JSON.parse(f.core.exportSettings(f.core.readSettings(f.state))),before=plain(f.state),expectedToken=f.core.settingsToken(f.core.readSettings(f.state));
 for(const mode of ['unknown','NORMAL',false,null,{},undefined]){
   const doc=plain(base);doc.settings.mode=mode;const json=JSON.stringify(doc);
   assert.throws(()=>f.core.parseSettingsExport(json));await assert.rejects(f.controller.importSettings({json,expectedToken}));assert.deepEqual(f.state,before);assert.equal(f.writes,0);
 }
 const mixed=plain(base);mixed.settings.legacyMode=false;assert.throws(()=>f.core.parseSettingsExport(JSON.stringify(mixed)));
});
test('既存の形式2は明示的なインポートでsevereへ変換し、書き出しは形式6',async()=>{
 const f=backend(),doc=JSON.parse(f.core.exportSettings(f.core.readSettings(f.state)));doc.schemaVersion=2;for(const g of doc.settings.tagGroups){g.tags=g.items.map(x=>x.tag);delete g.items;}delete doc.settings.keepNoteHeaderVisible;doc.settings.legacyMode=true;delete doc.settings.mode;
 doc.settings.authorDisplayRules=[{userId:'yeku',displayName:'YeKu',action:'hide'}];
 const json=JSON.stringify(doc);assert.equal(f.core.parseSettingsExport(json).mode,'severe');
 await f.controller.importSettings({json,expectedToken:f.core.settingsToken(f.core.readSettings(f.state))});
 const out=JSON.parse(f.core.exportSettings(f.core.readSettings(f.state)));assert.equal(out.schemaVersion,6);assert.equal(out.settings.mode,'severe');assert.deepEqual(out.settings.authorDisplayRules,doc.settings.authorDisplayRules);
});
test('移行画面は社会復帰モードのJSONを読み込み、タグを保持して設定画面を利用可能',async()=>{
 const f=homeFixture();await flush();const core=f.c.HikikomoriNote,doc=JSON.parse(core.exportSettings(core.readSettings(f.state)));doc.settings.mode='social';
 const json=JSON.stringify(doc);f.nodes.get('settings-json').value=json;f.nodes.get('settings-json').oninput();
 assert.equal(f.nodes.get('import-settings').disabled,false);f.nodes.get('import-settings').onclick();await flush();assert.equal(f.state.mode,'social');assert.equal(f.nodes.get('nav-tags').hidden,true);assert.equal(f.nodes.get('settings-json').value,json);
});

test('作者の無料カードも非表示にし、有料フィルターとは独立して解除・購入済み例外・停止復元',()=>{
 const rule={userId:'yeku',displayName:'名前',action:'hide'},f=ui('<main>'+card+'</main>',{authorDisplayRules:[rule]});
 const c=f.doc.querySelector('main').children[0];f.update('https://note.com/tag/AI');assert.equal(c.hasAttribute('data-hikikomori-note-author-hidden'),true);
 f.backend.state.authorDisplayRules[0].action='allow';f.update('https://note.com/tag/AI');assert.equal(c.hasAttribute('data-hikikomori-note-author-hidden'),false);
 f.backend.state.authorDisplayRules[0].action='hide';f.update('https://note.com/notes/purchased');assert.equal(c.hasAttribute('data-hikikomori-note-author-hidden'),false);
 f.update('https://note.com/search');assert.equal(c.hasAttribute('data-hikikomori-note-author-hidden'),true);f.control.stop();assert.equal(c.hasAttribute('data-hikikomori-note-author-hidden'),false);
});
test('自分・作者不一致・全体OFFは作者カードを隠さず、カード再利用も再評価する',()=>{
 const rule={userId:'yeku',displayName:'',action:'hide'};
 for(const patch of [{noteUserId:'YeKu'},{enabled:false},{noteUserId:''}]){const f=ui('<main>'+card+'</main>',{authorDisplayRules:[rule],...patch});f.update('https://note.com/search');assert.equal(f.doc.querySelector('main').children[0].hasAttribute('data-hikikomori-note-author-hidden'),false);}
 const f=ui('<main>'+card+'</main>',{authorDisplayRules:[rule]});f.update('https://note.com/search');f.doc.querySelector('a[data-name="avatar"]').href='https://note.com/other';f.control.invalidatePaidCards();f.update('https://note.com/search');assert.equal(f.doc.querySelector('main').children[0].hasAttribute('data-hikikomori-note-author-hidden'),false);
});
test('購入枠は記事・会員限定の両方を検出し、hidePaidArticlesがOFFなら確認しない',()=>{
 for(const kind of ['purchase','membership']){const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f,kind);f.update();assert.ok(f.doc.querySelector('dialog'));assert.equal(f.doc.activeElement.textContent,'今回は何もしない');}
 for(const patch of [{hidePaidArticles:false},{enabled:false,hidePaidArticles:true},{noteUserId:'yeku',hidePaidArticles:true},{noteUserId:'',hidePaidArticles:true},{hidePaidArticles:true,authorDisplayRules:[{userId:'yeku',displayName:'',action:'allow'}]}]){const f=ui(articleHtml,patch);fillArticle(f);f.update();assert.equal(f.doc.querySelector('dialog'),null);}
});
test('3択の非表示・表示許可でIDと表示名を保存し、選択なし・Escapeは保存しない',async()=>{
 for(const action of ['hide','allow']){const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f);f.update();const dialog=f.doc.querySelector('dialog');await dialog.querySelectorAll('button')[action==='hide'?0:1].onclick();await flush();assert.equal(f.backend.state.authorDisplayRules[0].action,action);assert.equal(f.backend.state.authorDisplayRules[0].userId,'yeku');assert.equal(f.backend.state.authorDisplayRules[0].displayName,'YeKu@「知る」を優しさに。');assert.equal(f.doc.querySelector('dialog'),null);}
 const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f);f.update();f.doc.querySelector('dialog').fire('cancel');assert.equal(f.doc.querySelector('dialog'),null);assert.equal(f.backend.writes,0);f.control.invalidatePaidCards();f.update();assert.equal(f.doc.querySelector('dialog'),null);
});
test('購入枠の後挿入、設定OFF、SPA離脱に追従し、本文内の模倣・作者不一致は検出しない',()=>{
 const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f);const wall=f.doc.getElementById('note-paywall');wall.remove();f.update();assert.equal(f.doc.querySelector('dialog'),null);f.doc.getElementById('note-article').append(wall);f.control.invalidatePaidCards();f.update();assert.ok(f.doc.querySelector('dialog'));
 f.backend.state.hidePaidArticles=false;f.update();assert.equal(f.doc.querySelector('dialog'),null);f.backend.state.hidePaidArticles=true;f.update('https://note.com/search');assert.equal(f.doc.querySelector('dialog'),null);
 for(const variant of ['body','author','hidden','preview']){const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f);if(variant==='body')f.doc.getElementById('note-body').append(f.doc.getElementById('note-paywall'));if(variant==='author')f.doc.getElementById('author-name').href='https://note.com/other';if(variant==='hidden')f.doc.getElementById('note-paywall').hidden=true;f.update(variant==='preview'?'https://note.com/preview/n123':articleUrl);assert.equal(f.doc.querySelector('dialog'),null,variant);}
});
test('表示中の購入枠・作者が変わった場合は古いダイアログを撤去する',()=>{
 for(const kind of ['paywall','author']){const f=ui(articleHtml,{hidePaidArticles:true});fillArticle(f);f.update();assert.ok(f.doc.querySelector('dialog'));if(kind==='paywall')f.doc.getElementById('note-paywall').remove();else f.doc.getElementById('author-name').href='https://note.com/other';f.control.invalidatePaidCards();f.update();assert.equal(f.doc.querySelector('dialog'),null);}
});
test('ダイアログ保存失敗は成功扱いにせず、未確認では再確認まで登録を停止',async()=>{
 let calls=0;const f=ui(articleHtml,{hidePaidArticles:true},{async setAuthor(){calls++;throw Object.assign(Error('保存結果不明'),{code:'UNCONFIRMED'});}});fillArticle(f);f.update();const dialog=f.doc.querySelector('dialog');assert.equal(dialog.querySelector('button[data-author-refresh]').hidden,true);await dialog.querySelector('button').onclick();assert.match(dialog.textContent,/保存結果不明/);assert.equal(dialog.querySelector('button').disabled,true);assert.equal(dialog.querySelector('button[data-author-refresh]').hidden,false);assert.equal(calls,1);assert.equal(f.backend.writes,0);
 await dialog.querySelector('button[data-author-refresh]').onclick();assert.ok(f.doc.querySelector('dialog'));assert.equal(f.doc.querySelector('dialog').querySelector('button').disabled,false);assert.equal(f.doc.querySelector('dialog').querySelector('button[data-author-refresh]').hidden,true);assert.equal(calls,1);
});
const profile='<aside class="w-full lg:w-96"><div><h1 id="profile-name"></h1><button data-name="avatar"></button><a href="https://note.com/yeku/followings"></a></div></aside>';
test('プロフィールの再確認は通常隠し、保存失敗・競合で表示し、再確認失敗中は残す',async()=>{
 for(const code of ['OPERATION_FAILED','CONFLICT','UNCONFIRMED']){
   let failRefresh=true;
   const f=ui(profile,{}, {async setAuthor(){throw Object.assign(Error('保存失敗'),{code});},async refresh(){if(failRefresh)throw Error('確認失敗');}});
   f.doc.getElementById('profile-name').textContent='作者名';f.update('https://note.com/yeku');
   assert.equal(f.doc.querySelector('button[data-author-refresh]').hidden,true);
   f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select').value='hide';f.doc.querySelector('button[data-author-save]').onclick();await flush();
   assert.equal(f.doc.querySelector('button[data-author-refresh]').hidden,false);
   await f.doc.querySelector('button[data-author-refresh]').onclick();assert.equal(f.doc.querySelector('button[data-author-refresh]').hidden,false);
   failRefresh=false;await f.doc.querySelector('button[data-author-refresh]').onclick();assert.equal(f.doc.querySelector('button[data-author-refresh]').hidden,true);
 }
});
test('プロフィール管理は重度・拡張OFF・有料非表示OFFでも利用でき、自分には出さない',async()=>{
 for(const patch of [{mode:'severe',enabled:false},{hidePaidArticles:false}]){let op;const f=ui(profile,patch,{async setAuthor(v){op=v;}});f.doc.getElementById('profile-name').textContent='作者名';f.update('https://note.com/yeku');const select=f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select');assert.ok(select);select.value='allow';f.doc.querySelector('button[data-author-save]').onclick();await flush();assert.equal(op.userId,'yeku');assert.equal(op.displayName,'作者名');assert.equal(op.action,'allow');}
 const f=ui(profile,{noteUserId:'YeKu'});f.update('https://note.com/yeku');assert.equal(f.doc.querySelector('[class="hikikomori-note-author-profile"]'),null);
});
test('プロフィールの非表示から未設定への保存はDOM参照を送信せず実際の背景処理まで完了する',async()=>{
 let f;
 f=ui(profile,{authorDisplayRules:[{userId:'yeku',displayName:'作者名',action:'hide'}]}, {
   async setAuthor(op,source){
     assert.equal(source,'profile');
     assert.deepEqual(Object.keys(op).sort(),['action','displayName','expectedAction','expectedRevision','expectedSelf','userId'].sort());
     const wire=JSON.parse(JSON.stringify(op));
     await f.backend.controller.author(wire);
     f.control.update(f.core.readSettings(f.backend.state),'https://note.com/yeku');
   }
 });
 f.doc.getElementById('profile-name').textContent='作者名';f.update('https://note.com/yeku');
 f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select').value='';await f.doc.querySelector('button[data-author-save]').onclick();await flush();
 assert.deepEqual(f.backend.state.authorDisplayRules,[]);assert.equal(f.backend.state.authorDisplayRevision,1);assert.equal(f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select').value,'');
});
test('ユーザーページではIDフィルターを外し、有料カードだけを既存設定で隠す',()=>{
 const f=ui('<main>'+card+card+'</main>',{hidePaidArticles:true,authorDisplayRules:[{userId:'yeku',displayName:'作者名',action:'hide'}]});
 const [free,paid]=f.doc.querySelector('main').children;paid.querySelector('span').textContent='¥300';
 for(const url of ['https://note.com/yeku','https://note.com/yeku/all','https://note.com/yeku/likes']){
   f.update(url);assert.equal(free.hasAttribute('data-hikikomori-note-author-hidden'),false,url);assert.equal(paid.hasAttribute('data-hikikomori-note-author-hidden'),false,url);assert.equal(paid.hasAttribute('data-hikikomori-note-paid-hidden'),true,url);
 }
 f.update('https://note.com/search');assert.equal(free.hasAttribute('data-hikikomori-note-author-hidden'),true);
 f.update('https://note.com/yeku');assert.equal(free.hasAttribute('data-hikikomori-note-author-hidden'),false);assert.equal(paid.hasAttribute('data-hikikomori-note-paid-hidden'),true);
});
test('表示許可は値札付き・鍵付きカードも表示し、解除すると有料非表示へ戻る',()=>{
 const lock='M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2Z';
 for(const kind of ['price','lock']){
   const f=ui('<main>'+card+'</main>',{hidePaidArticles:true,authorDisplayRules:[]}),c=f.doc.querySelector('main').children[0];
   if(kind==='price')c.querySelector('span').textContent='¥300';else {const svg=f.doc.createElement('svg'),path=f.doc.createElement('path');path.setAttribute('d',lock);svg.append(path);c.querySelector('h3').append(svg);}
   f.update('https://note.com/search');assert.equal(c.hasAttribute('data-hikikomori-note-paid-hidden'),true,kind);
   f.backend.state.authorDisplayRules=[{userId:'yeku',displayName:'作者名',action:'allow'}];f.update('https://note.com/search');assert.equal(c.hasAttribute('data-hikikomori-note-paid-hidden'),false,kind);
   f.update('https://note.com/yeku');assert.equal(c.hasAttribute('data-hikikomori-note-paid-hidden'),false,kind);
   f.backend.state.authorDisplayRules=[];f.update('https://note.com/yeku');assert.equal(c.hasAttribute('data-hikikomori-note-paid-hidden'),true,kind);
 }
});
test('作者の照合が不明・自分・自己ID未設定の場合は表示許可で有料判定を解除しない',()=>{
 for(const kind of ['mismatch','self','unset']){
   const f=ui('<main>'+card+'</main>',{hidePaidArticles:true,noteUserId:kind==='self'?'yeku':kind==='unset'?'':'me',authorDisplayRules:[{userId:'yeku',displayName:'名前',action:'allow'}]}),c=f.doc.querySelector('main').children[0];
   c.querySelector('span').textContent='¥300';if(kind==='mismatch')c.querySelector('a[data-name="avatar"]').href='https://note.com/other';
   f.update('https://note.com/search');assert.equal(c.hasAttribute('data-hikikomori-note-paid-hidden'),true,kind);
 }
});
test('管理画面では通常の説明を省き、自己ID未設定・破損時だけ案内を表示',async()=>{
 const f=homeFixture();await flush();assert.equal(f.nodes.get('authors-state').hidden,true);assert.equal(f.nodes.get('authors-state').textContent,'');
 f.changed({noteUserId:''});assert.equal(f.nodes.get('authors-state').hidden,false);assert.match(f.nodes.get('authors-state').textContent,/noteユーザー名/);
 f.changed({noteUserId:'me',authorDisplayRules:[{userId:'bad',displayName:'',action:'bad'}],authorDisplayRevision:0});assert.equal(f.nodes.get('authors-state').hidden,false);assert.match(f.nodes.get('authors-state').textContent,/異常/);
});
test('専用ホームは辞書順の既存ユーザーの状態変更・解除だけができ、新規登録欄がない',async()=>{
 const f=homeFixture({hash:'#authors',state:{enabled:false,mode:'severe',authorDisplayRevision:0,authorDisplayRules:[{userId:'z',displayName:'か',action:'hide'},{userId:'b',displayName:'あ',action:'hide'}]}});await flush();const n=f.nodes;
 assert.equal(n.get('panel-authors').hidden,false);assert.equal(n.get('author-form'),undefined);assert.equal(n.get('author-user'),undefined);assert.match(n.get('authors-hidden').children[0].textContent,/あ（b）/);
 n.get('authors-hidden').children[0].querySelector('button').onclick();await flush();assert.equal(f.state.authorDisplayRules.find(x=>x.userId==='b').action,'allow');assert.equal(f.state.enabled,false);
 n.get('authors-allowed').children[0].querySelectorAll('button')[1].onclick();await flush();assert.equal(f.state.authorDisplayRules.some(x=>x.userId==='b'),false);
 const doc=JSON.parse(f.c.HikikomoriNote.exportSettings(f.c.HikikomoriNote.readSettings(f.state)));doc.schemaVersion=1;for(const g of doc.settings.tagGroups){g.tags=g.items.map(x=>x.tag);delete g.items;}delete doc.settings.keepNoteHeaderVisible;doc.settings.legacyMode=doc.settings.mode==='severe';delete doc.settings.mode;delete doc.settings.authorDisplayRules;n.get('settings-json').value=JSON.stringify(doc);n.get('settings-json').oninput();n.get('import-settings').onclick();await flush();assert.match(f.confirmations.at(-1),/作者設定も解除/);assert.deepEqual(f.state.authorDisplayRules,[]);
});
test('作者操作の送信元検証はトップフレーム・現URL・本人・pendingUrlを確認する',async()=>{
 let tab={url:articleUrl};const api={runtime:{id:'self'},tabs:{async get(){return tab;}}};
 const c=vm.createContext({URL,chrome:api});for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),c);
 const check=c.HikikomoriNoteBackgroundPlatform.currentAuthorPage,sender={id:'self',frameId:0,tab:{id:7},url:'https://note.com/tag/old'};
 assert.equal((await check(sender,articleUrl)).user,'yeku');
 for(const other of [{...sender,id:'other'},{...sender,frameId:1},{...sender,tab:{id:'7'}}])assert.equal(await check(other,articleUrl),null);
 assert.equal(await check(sender,'https://note.com/yeku/n/n999'),null);
 tab={url:articleUrl,pendingUrl:'https://note.com/other'};assert.equal(await check(sender,articleUrl),null);
 for(const url of ['https://evil.test/yeku','https://note.com/preview/n123','https://note.com/settings/account']){tab={url};assert.equal(await check(sender,url),null);}
 for(const url of ['https://note.com/yeku','https://note.com/yeku/store','https://note.com/yeku/store/?page=2']){tab={url};const owner=await check(sender,url);assert.equal(owner.type,'profile');assert.equal(owner.user,'yeku');}
});
test('背景は作者ページ以外の要求・別作者の要求・設定全置換の流用を拒否する',async()=>{
 const f=backend({hidePaidArticles:true});let handler,page={type:'article',user:'yeku'};
 f.c.HikikomoriNoteRouting={createController:()=>f.controller};
 f.c.HikikomoriNoteBackgroundPlatform={onInstalled(){},onStartup(){},onAction(){},onMessage(fn){handler=fn;},isHomeSender:sender=>sender.url==='extension-home',isNoteSender:sender=>sender.url==='note',async currentAuthorPage(){return page;}};
 vm.runInContext(source('src/background.js'),f.c);await flush();
 const send=(message,sender={url:'note'})=>new Promise(resolve=>{if(!handler(message,sender,resolve))resolve(null);});
 assert.equal(await send({type:'author-operation',patch:operation(f)}),null);
 let response=await send({type:'current-author-operation',patch:{operation:operation(f,'other'),source:'article',pageUrl:articleUrl}});assert.equal(response.code,'CONFLICT');
 response=await send({type:'current-author-operation',patch:{operation:operation(f),source:'profile',pageUrl:articleUrl}});assert.equal(response.code,'CONFLICT');
 response=await send({type:'current-author-operation',patch:{operation:operation(f),source:'article',pageUrl:articleUrl}});assert.equal(response.ok,true);
 page=null;response=await send({type:'current-author-operation',patch:{operation:operation(f),source:'article',pageUrl:articleUrl}});assert.equal(response.code,'CONFLICT');
});
test('作者変更後は古い設定JSONの確認トークンを拒否し、自己ID変更後は登録済みでも対象外',async()=>{
 const f=backend(),before=f.core.readSettings(f.state),json=f.core.exportSettings(before),expectedToken=f.core.settingsToken(before);
 await f.controller.author(operation(f));await assert.rejects(f.controller.importSettings({json,expectedToken}),{code:'CONFLICT'});
 await f.controller.save({noteUserId:'YeKu'});assert.equal(f.core.isSelf(f.core.readSettings(f.state),'yeku'),true);assert.equal(f.state.authorDisplayRules.length,1);
 await f.controller.author(operation(f,'yeku',null));assert.equal(f.state.authorDisplayRules.length,0);
});

test('管理画面の背景要求では新規登録を拒否し、既存ユーザーの名前を変えず状態だけを変更',async()=>{
 const f=backend();await assert.rejects(f.controller.author(operation(f),{requireExisting:true}),{code:'CONFLICT'});assert.equal(f.writes,0);
 await f.controller.author(operation(f));await f.controller.author(operation(f,'yeku','allow','別の名前'),{requireExisting:true});assert.equal(f.state.authorDisplayRules[0].displayName,'YeKu@「知る」を優しさに。');assert.equal(f.state.authorDisplayRules[0].action,'allow');
 await f.controller.author(operation(f,'yeku',null),{requireExisting:true});assert.equal(f.state.authorDisplayRules.length,0);
});
test('歯車はプロフィールから管理画面へ直行し、SPAで他の画面へ戻ると通常の専用ホームへ戻す',()=>{
 let destination='chrome-extension://self/home.html#authors';const header='<header data-header-state="navbar"><div><a href="/"><svg role="img" aria-label="note"></svg></a></div></header>';
 const f=ui(header,{noteLogoBrowserBack:true},{settingsUrl:()=>destination});f.update('https://note.com/yeku');const gear=f.doc.querySelector('a[data-hikikomori-note-owned]');assert.equal(gear.href,destination);
 destination='chrome-extension://self/home.html';f.update('https://note.com/search');assert.equal(gear.href,destination);
});

test('ストアの作者表示設定から登録・解除でき、3モードとOFFで既存条件を維持',async()=>{
 for(const patch of [{mode:'normal'},{mode:'social'},{mode:'severe'},{enabled:false}]){
  let f;f=ui(profile,{...patch,hidePaidArticles:true},{async setAuthor(op,source){assert.equal(source,'profile');await f.backend.controller.author(op);f.control.update(f.core.readSettings(f.backend.state),'https://note.com/yeku/store');}});f.doc.getElementById('profile-name').textContent='作者名';f.update('https://note.com/yeku/store');
  assert.ok(f.doc.querySelector('button[data-author-save]'));f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select').value='hide';f.doc.querySelector('button[data-author-save]').onclick();await flush();assert.equal(f.backend.state.authorDisplayRules[0].userId,'yeku');
  f.doc.querySelector('[class="hikikomori-note-author-profile"]').querySelector('select').value='';f.doc.querySelector('button[data-author-save]').onclick();await flush();assert.deepEqual(f.backend.state.authorDisplayRules,[]);
 }
});
test('作者検索は非表示と表示許可を大小文字に依存せず取得し、未登録・特殊なIDでも従来と同じ',()=>{
 const {core}=backend(),rules=Object.freeze([{userId:'YeKu',displayName:'作者',action:'hide'},{userId:'allowed',displayName:'許可',action:'allow'},{userId:'constructor',displayName:'同名',action:'allow'},{userId:'__proto__',displayName:'特殊',action:'hide'}].map(Object.freeze)),state={authorDisplayRules:rules};
 for(const id of ['yeku','YEKU','ALLOWED','constructor','__PROTO__','unknown','toString'])assert.equal(core.authorRule(state,id),rules.find(rule=>rule.userId.toLowerCase()===id.toLowerCase()));
 const duplicate={authorDisplayRules:[rules[0],{userId:'YEKU',displayName:'後の項目',action:'allow'}]};assert.equal(core.authorRule(duplicate,'yeku'),rules[0]);
});

test('作者ルール配列の差し替えで変更・追加・削除を反映し、同じ更新番号の別設定や以前の状態と混同しない',()=>{
 const {core}=backend(),old={authorDisplayRevision:1,authorDisplayRules:[{userId:'yeku',displayName:'作者',action:'hide'}]},state={...old};assert.equal(core.authorRule(state,'yeku').action,'hide');
 state.authorDisplayRules=[{userId:'yeku',displayName:'作者',action:'allow'},{userId:'new_user',displayName:'新規',action:'hide'}];assert.equal(core.authorRule(state,'yeku').action,'allow');assert.equal(core.authorRule(state,'NEW_USER').action,'hide');assert.equal(core.authorRule(old,'yeku').action,'hide');
 state.authorDisplayRules=[];assert.equal(core.authorRule(state,'yeku'),undefined);assert.equal(core.authorRule(state,'new_user'),undefined);assert.equal(core.authorRule(old,'yeku').action,'hide');
});

test('5000件の作者検索を繰り返しても同じ配列のIDを再走査せず、設定の他項目だけの変更でも再利用',()=>{
 const {core}=backend();let idReads=0;const rules=Object.freeze(Array.from({length:5000},(_,i)=>Object.freeze({get userId(){idReads++;return `author_${i}`;},displayName:`作者${i}`,action:i%2?'allow':'hide'}))),state={authorDisplayRules:rules};
 assert.equal(core.authorRule(state,'AUTHOR_4999'),rules[4999]);assert.equal(idReads,5000);
 for(let i=0;i<1000;i++){assert.equal(core.authorRule(state,`author_${i}`),rules[i]);assert.equal(core.authorRule(state,`missing_${i}`),undefined);}
 assert.equal(core.authorRule({...state,enabled:false},'author_100'),rules[100]);assert.equal(idReads,5000);
});

test('作者索引は保存・JSON・競合トークンに混ざらず、表示設定の保存とJSON再読込を反映',async()=>{
 const f=backend({authorDisplayRules:[{userId:'yeku',displayName:'作者',action:'hide'}],authorDisplayRevision:1}),s=f.core.readSettings(f.state),before=JSON.stringify(s),json=f.core.exportSettings(s),token=f.core.settingsToken(s),raw=plain(f.state);
 for(const id of ['yeku','unknown','YEKU'])f.core.authorRule(s,id);assert.equal(JSON.stringify(s),before);assert.equal(f.core.exportSettings(s),json);assert.equal(f.core.settingsToken(s),token);assert.deepEqual(f.state,raw);assert.equal(f.writes,0);assert.equal(JSON.parse(json).schemaVersion,6);
 await f.controller.author(operation(f,'yeku','allow'));const allowed=f.core.readSettings(f.state);assert.equal(f.core.authorRule(allowed,'YEKU').action,'allow');assert.equal(f.core.authorRule(s,'yeku').action,'hide');
 await f.controller.importSettings({json,expectedToken:f.core.settingsToken(allowed)});assert.equal(f.core.authorRule(f.core.readSettings(f.state),'yeku').action,'hide');assert.deepEqual(f.state.authorDisplayRules,raw.authorDisplayRules);
});
function profileAllowanceFixture(){
 const f=backend({hidePaidArticles:true,authorDisplayRules:[{userId:'creator',displayName:'作者',action:'allow'}]}),doc=documentFromHtml('<main></main>'),calls=[];
 f.c.HikikomoriNote={...f.core,authorRule(settings,id){calls.push(id.toLowerCase());return f.core.authorRule(settings,id);}};vm.runInContext(source('src/note-ui.js'),f.c);
 const control=f.c.HikikomoriNoteUi.create(doc,{wide:true,matchMedia:()=>({matches:true}),getComputedStyle:()=>({display:'block'})});
 function addCard(user='creator',paid=true){const outer=doc.createElement('div'),inner=doc.createElement('div'),link=doc.createElement('a'),heading=doc.createElement('h3'),avatar=doc.createElement('a'),price=doc.createElement('span');outer.className='grid-rows-subgrid';link.className='absolute inset-0';link.setAttribute('title','記事');link.setAttribute('aria-label','記事');link.href=`https://note.com/${user}/n/n123`;avatar.setAttribute('data-name','avatar');avatar.href=`https://note.com/${user}`;price.className='text-text-success';price.textContent=paid?'¥200':'';inner.append(link,heading,avatar,price);outer.append(inner);doc.querySelector('main').append(outer);return {outer,link,avatar};}
 const cards=[addCard(),addCard(),addCard()];return {...f,doc,control,calls,cards,addCard,settings:f.core.readSettings(f.state)};
}
const priceHidden='data-hikikomori-note-paid-hidden';

test('作者トップとallの有料表示許可は本人分だけ1回判定し、DOM追加・再描画・同一作者の移動で再利用',()=>{
 const f=profileAllowanceFixture(),s=f.settings;f.control.update(s,'https://note.com/creator');assert.deepEqual(f.calls,['creator']);for(const card of f.cards)assert.equal(card.outer.hasAttribute(priceHidden),false);
 for(const url of ['https://note.com/creator','https://note.com/creator/all','https://note.com/creator/all/?page=2#list']){f.control.invalidatePaidCards();f.control.update(s,url);assert.equal(f.calls.length,1);}
 const added=f.addCard();f.control.invalidatePaidCards();f.control.update(s,'https://note.com/creator/all');assert.equal(f.calls.length,1);assert.equal(added.outer.hasAttribute(priceHidden),false);
 for(const mode of ['normal','social','severe']){f.control.update({...s,mode},'https://note.com/creator/all');assert.equal(f.calls.length,1);}f.control.stop();
});

test('本人の許可変更・解除・自己ID・異常状態の変更を再判定し、非表示設定でも無料記事を隠さない',()=>{
 const f=profileAllowanceFixture(),free=f.addCard('creator',false);let s=f.settings;f.control.update(s,'https://note.com/creator');
 for(const rules of [[{userId:'creator',displayName:'作者',action:'hide'}],[],[{userId:'creator',displayName:'作者',action:'allow'}]]){s={...s,authorDisplayRules:rules};f.control.update(s,'https://note.com/creator');assert.equal(f.cards[0].outer.hasAttribute(priceHidden),rules[0]?.action!=='allow');assert.equal(free.outer.hasAttribute(priceHidden),false);assert.equal(free.outer.hasAttribute('data-hikikomori-note-author-hidden'),false);}
 assert.equal(f.calls.length,4);for(const patch of [{noteUserId:''},{noteUserId:'creator'},{authorWarning:'broken'}]){f.control.update({...s,...patch},'https://note.com/creator');assert.equal(f.cards[0].outer.hasAttribute(priceHidden),true);f.control.update(s,'https://note.com/creator');assert.equal(f.cards[0].outer.hasAttribute(priceHidden),false);}
 f.control.update({...s,enabled:false},'https://note.com/creator');assert.equal(f.cards[0].outer.hasAttribute(priceHidden),false);f.control.update({...s,hidePaidArticles:false},'https://note.com/creator');assert.equal(f.cards[0].outer.hasAttribute(priceHidden),false);
});

test('作者トップでも別作者と作者不一致のカードには本人の許可を流用せず、作者移動でも結果を持ち越さない',()=>{
 const f=profileAllowanceFixture(),other=f.addCard('other'),unverified=f.addCard();unverified.avatar.href='https://note.com/other';f.control.update(f.settings,'https://note.com/creator');assert.equal(f.calls.filter(id=>id==='creator').length,1);assert.ok(f.calls.includes('other'));assert.equal(other.outer.hasAttribute(priceHidden),true);assert.equal(unverified.outer.hasAttribute(priceHidden),true);assert.equal(f.cards[0].outer.hasAttribute(priceHidden),false);
 f.control.invalidatePaidCards();f.control.update(f.settings,'https://note.com/creator/all');assert.equal(f.calls.filter(id=>id==='creator').length,1);assert.equal(other.outer.hasAttribute(priceHidden),true);
 f.control.update(f.settings,'https://note.com/other/all');assert.equal(other.outer.hasAttribute(priceHidden),true);assert.equal(f.cards[0].outer.hasAttribute(priceHidden),false);
});

test('likes等の対象外はカードごとの許可判定を維持し、トップへ戻ると改めて本人分を判定',()=>{
 for(const path of ['/creator/likes','/creator/magazines','/creator/archives','/search?q=AI']){const f=profileAllowanceFixture();f.control.update(f.settings,'https://note.com'+path);assert.ok(f.calls.filter(id=>id==='creator').length>=3,path);for(const card of f.cards)assert.equal(card.outer.hasAttribute(priceHidden),false);const before=f.calls.length;f.control.update(f.settings,'https://note.com/creator');assert.equal(f.calls.length,before+1);f.control.invalidatePaidCards();f.control.update(f.settings,'https://note.com/creator');assert.equal(f.calls.length,before+1);}
});
