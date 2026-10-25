"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const homeFixture=require('./helpers/home.cjs');
const settingsData=require('./helpers/settings.cjs');
const groups=settingsData.groups;
const {documentFromHtml}=require('./helpers/dom.cjs');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial={},options={}) {
 let stored={...settingsData(),...initial},rules=[],writes=0;
 const context=vm.createContext({URL,console});
 for(const file of ['src/common.js','src/routing.js'])vm.runInContext(source(file),context);
 function restart(){return context.HikikomoriNoteRouting.createController({load:async()=>stored,store:async next=>{if(options.fail)throw Error('save failed');stored=plain(next);writes++;},setRules:async next=>{rules=plain(next);}});}
 return {core:context.HikikomoriNote,controller:restart(),restart,options,get stored(){return stored;},get rules(){return rules;},get writes(){return writes;}};
}
test('タグ正規化は前後空白と#だけ。大小・全半角・内部空白・Unicode表現を保存',()=>{
 const {core}=fixture();
 assert.equal(core.normalizeTag('  #ComfyUI  '),'ComfyUI');
 for(const tag of ['comfyui','ComfyUI','ＡＩ','AI','a b','a  b','e\u0301','é'])assert.equal(core.normalizeTag(tag),tag);
 for(const tag of ['', '  ', '#  ', null, 3,'\ud800'])assert.throws(()=>core.normalizeTag(tag));
 assert.equal(core.tagUrl('a/b?# x'),'https://note.com/search?q=%23a%2Fb%3F%23%20x&context=note&mode=search&sort=new');
 assert.equal(core.tagUrl('るみなー先生'),'https://note.com/search?q=%23%E3%82%8B%E3%81%BF%E3%81%AA%E3%83%BC%E5%85%88%E7%94%9F&context=note&mode=search&sort=new');
});
test('現行設定の読み込みは保存を発生させずユーザー名とOFFを維持',async()=>{
 const f=fixture({enabled:false,noteUserId:'ruminar',dashboardDisabled:true});
 const settings=await f.controller.getState();
 assert.equal(settings.legacyMode,false);assert.deepEqual(plain(settings.tagGroups[0].tags),[]);assert.equal(settings.enabled,false);assert.equal(settings.dashboardDisabled,true);
 assert.equal(f.writes,0);assert.equal(f.stored.tagSchemaVersion,2);
});
test('異なる2タブの追加と通常設定保存を直列化し、11件以上も保持',async()=>{
 const f=fixture({noteUserId:'ruminar'});
 await Promise.all([...Array.from({length:15},(_,i)=>f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:`tag${i}`})),f.controller.save({dashboardDisabled:true}),f.controller.save({enabled:false})]);
 assert.equal(f.stored.tagGroups[0].tags.length,15);assert.equal(f.stored.dashboardDisabled,true);assert.equal(f.stored.enabled,false);assert.equal(f.stored.noteUserId,'ruminar');
});
test('同じタグの同時追加は1件だけ保存し、完全一致だけ重複とする',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'AI'}),f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'AI'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONFLICT');
 await f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'ＡＩ'});await f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'ai'});
 assert.deepEqual(f.stored.tagGroups[0].tags,['AI','ＡＩ','ai']);
});
test('移動はタグ名・移動先を最新配列へ適用し、移動先削除の競合で保存しない',async()=>{
 const f=fixture({...groups(['A','B','C'])});
 await f.controller.tag({groupId:'group1',type:'REMOVE_TAG',tag:'B'});
 await assert.rejects(f.controller.tag({groupId:'group1',type:'MOVE_TAG',tag:'A',beforeTag:'B'}),{code:'CONFLICT'});
 assert.deepEqual(f.stored.tagGroups[0].tags,['A','C']);assert.equal(f.writes,1);
 await f.controller.tag({groupId:'group1',type:'MOVE_TAG',tag:'A',beforeTag:null});assert.deepEqual(f.stored.tagGroups[0].tags,['C','A']);
 await f.controller.tag({groupId:'group1',type:'MOVE_TAG',tag:'A',beforeTag:'C'});assert.deepEqual(f.stored.tagGroups[0].tags,['A','C']);
});
test('不正保存値は正常な項目を残して報告し、他設定の保存でも元データを消さない',async()=>{
 for(const tags of [['A',null,'A','','B'],{broken:true}]) {
  const f=fixture({...groups(tags),noteUserId:'ruminar'});const settings=await f.controller.getState();
  assert.ok(settings.tagWarning);assert.deepEqual(plain(settings.tagGroups[0].tags),Array.isArray(tags)?['A','B']:[]);
  await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'C'}),{code:'INVALID_TAGS'});
  await f.controller.save({legacyMode:true});assert.deepEqual(f.stored.tagGroups[0].tags,tags);assert.equal(f.stored.noteUserId,'ruminar');
 }
});
test('配列の一括保存・不正なモード型・未知の操作を受け付けない',async()=>{
 const f=fixture();
 for(const patch of [{tagGroups:[]},{legacyMode:'true'}])await assert.rejects(f.controller.save(patch));
 for(const operation of [{type:'BOGUS',tag:'A'},{groupId:'group1',type:'ADD_TAG',tag:null},{groupId:'group1',type:'MOVE_TAG',tag:'A',index:2}])await assert.rejects(f.controller.tag(operation));
 assert.equal(f.writes,0);
});
test('モード変更とタグ操作は同じキュー。先の保存を保持し後のタグ操作を拒否',async()=>{
 const f=fixture({...groups(['A'])});
 const results=await Promise.allSettled([f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'B'}),f.controller.save({legacyMode:true}),f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'C'})]);
 assert.equal(results[2].reason.code,'LEGACY_MODE');assert.deepEqual(f.stored.tagGroups[0].tags,['A','B']);
 await f.controller.save({enabled:false});assert.equal(f.stored.legacyMode,true);assert.equal(f.rules.length,0);
 await f.controller.save({enabled:true,dashboardDisabled:true});assert.equal(f.stored.legacyMode,true);assert.equal(f.rules.length,4);
 await f.controller.save({legacyMode:false});assert.deepEqual(f.stored.tagGroups[0].tags,['A','B']);
});
test('保存失敗ではタグ・モードを確定せず、背景再起動後は保存状態から再開',async()=>{
 const f=fixture({...groups(['A'])},{fail:true});
 await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'B'}));await assert.rejects(f.controller.save({legacyMode:true}));
 assert.deepEqual(f.stored,{...settingsData(['A'])});f.options.fail=false;
 await f.restart().tag({groupId:'group1',type:'ADD_TAG',tag:'C'});assert.deepEqual(f.stored.tagGroups[0].tags,['A','C']);
});
test('通常の3タブ、重度モードの設定先頭、自分のページとキャッチコピーの切替',async()=>{
 const f=homeFixture({state:{...groups(['A'])}});await flush();const n=f.nodes;
 assert.match(n.get('mode').textContent,/通常モード（ひとみしりモード）/);
 assert.equal(n.get('panel-main').hidden,false);assert.equal(n.get('quick-access').parentElement,n.get('quick-slot'));
 assert.equal(n.get('panel-main').contains(n.get('quick-access')),true);assert.equal(n.get('profile').textContent,'ruminarのページ');
 assert.equal(source('home.html').includes('フォロー中のTL'),true);assert.equal(f.document.querySelector('h2'),null);assert.equal(n.has('user-status'),false);
 assert.equal(n.get('legacy-intro').hidden,true);
 n.get('tab-tags').onclick();n.get('tag-input').value='入力途中';n.get('tag-input').focus();
 f.changed({legacyMode:true});
 assert.match(n.get('mode').textContent,/重度ひきこもりモード/);
 assert.equal(n.get('tab-main').hidden,true);assert.equal(n.get('tab-tags').hidden,true);assert.equal(n.get('panel-settings').hidden,false);
 assert.equal(n.get('quick-access').parentElement,n.get('legacy-quick-slot'));assert.equal(n.get('following').hidden,true);assert.equal(n.get('legacy-intro').hidden,false);
 assert.equal(n.get('profile').href,'https://note.com/ruminar');assert.equal(n.get('tag-input').value,'入力途中');assert.equal(f.document.activeElement,n.get('tab-settings'));
 assert.equal(n.get('main-tags').children.length,0);assert.equal(n.get('edit-tags').children.length,0);
 f.changed({legacyMode:false});assert.equal(n.get('tab-main').hidden,false);assert.equal(n.get('following').hidden,false);assert.equal(n.get('legacy-intro').hidden,true);assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('main-tags').children.length,1);
 f.changed({enabled:false,legacyMode:true});assert.match(n.get('mode').textContent,/拡張OFF：通常のnote/);assert.doesNotMatch(n.get('mode').textContent,/ひきこもりモード|ひとみしりモード/);
});
test('重度モードで新規表示してもメインを表示せず、解除操作は同じ設定保存を使う',async()=>{
 const f=homeFixture({state:{legacyMode:true,...groups(['A'])}});await flush();const n=f.nodes;
 assert.equal(n.get('panel-main').hidden,true);assert.equal(n.get('panel-settings').hidden,false);
 n.get('legacy-mode').checked=false;n.get('legacy-mode').fire('change');n.get('settings').fire('submit');await flush();
 assert.deepEqual(f.patches,[{legacyMode:false}]);assert.deepEqual(f.state.tagGroups[0].tags,['A']);
});
test('別タブの更新は編集中タグと既存設定の未保存入力を消さない',async()=>{
 const f=homeFixture();await flush();const n=f.nodes;
 n.get('tag-input').value='Comfy';n.get('note-user').value='draft_user';n.get('note-user').fire('input');
 f.changed({...groups(['A']),noteUserId:'remote_user',dashboardDisabled:true});
 assert.equal(n.get('tag-input').value,'Comfy');assert.equal(n.get('note-user').value,'draft_user');assert.equal(n.get('dashboard-disabled').checked,true);
 n.get('settings').fire('submit');await flush();assert.deepEqual(f.patches,[{noteUserId:'draft_user'}]);assert.equal(f.state.dashboardDisabled,true);
});
test('背景処理からの破損データ診断を表示し、正常項目は残すがタグ編集は停止',async()=>{
 const f=homeFixture({state:{...groups(['A',null,'B'])}});await flush();const n=f.nodes;
 assert.equal(n.get('tag-warning').hidden,false);assert.match(n.get('tag-warning').textContent,/異常/);
 assert.equal(n.get('tag-input').disabled,true);assert.equal(n.get('add-tag').disabled,true);assert.equal(n.get('main-tags').children.length,2);
 assert.equal(n.get('edit-tags').children[0].draggable,false);assert.equal(n.get('edit-tags').children[0].children.at(-1).disabled,true);
 n.get('legacy-mode').checked=true;n.get('legacy-mode').fire('change');n.get('settings').fire('submit');await flush();
 assert.deepEqual(f.state.tagGroups[0].tags,['A',null,'B']);assert.equal(n.get('tag-warning').hidden,false);
});
test('追加保存中に入力を変えても消さず、保存中の別タグ操作を受け付けない',async()=>{
 let resolve;const f=homeFixture({saveGate:new Promise(done=>{resolve=done;})});await flush();const n=f.nodes;
 n.get('tag-input').value='A';n.get('tag-form').fire('submit');n.get('tag-input').value='B';n.get('tag-form').fire('submit');
 assert.equal(n.get('add-tag').disabled,true);resolve();await flush();assert.deepEqual(f.state.tagGroups[0].tags,['A']);assert.equal(n.get('tag-input').value,'B');
});
test('結果未確認時はタグ操作を止め、再取得するまで自動再送も成功表示もしない',async()=>{
 const f=homeFixture({unconfirmed:true});await flush();const n=f.nodes;
 n.get('tag-input').value='A';n.get('tag-form').fire('submit');await flush();
 assert.equal(n.get('add-tag').disabled,true);assert.match(n.get('status').textContent,/未確認/);assert.equal(n.get('tag-input').value,'A');assert.deepEqual(f.state.tagGroups[0].tags,[]);
 assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('settings').contains(n.get('retry')),true);
 f.options.unconfirmed=false;n.get('retry').onclick();await flush();assert.equal(n.get('add-tag').disabled,false);assert.deepEqual(f.state.tagGroups[0].tags,[]);
});
test('初回の設定読込失敗でも設定タブに再確認を表示し、再試行で復旧できる',async()=>{
 const f=homeFixture({stateError:true});await flush();const n=f.nodes;
 assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('tabs').hidden,false);
 assert.equal(n.get('retry').disabled,false);assert.equal(n.get('save').disabled,true);
 assert.equal(n.get('save').parentElement,n.get('retry').parentElement);assert.equal(n.get('retry').getAttribute('type'),'button');
 f.options.stateError=false;n.get('retry').onclick();await flush();
 assert.equal(n.get('save').disabled,false);assert.equal(n.get('tab-main').hidden,false);
 assert.equal(n.get('profile').textContent,'ruminarのページ');
});
test('上下ボタンとドラッグの移動を保存し、キーボードでタブ選択できる',async()=>{
 const f=homeFixture({state:{...groups(['A','B','C'])}});await flush();const n=f.nodes;
 n.get('edit-tags').children[1].children[1].onclick();await flush();assert.deepEqual(f.state.tagGroups[0].tags,['B','A','C']);
 const rows=n.get('edit-tags').children;rows[2].fire('dragstart',{dataTransfer:{setData(){}}});rows[0].fire('drop');await flush();assert.deepEqual(f.state.tagGroups[0].tags,['C','B','A']);
 const moved=n.get('edit-tags').children;moved[0].fire('dragstart',{dataTransfer:{setData(){}}});moved[2].fire('drop',{clientY:39});await flush();assert.deepEqual(f.state.tagGroups[0].tags,['B','A','C']);
 n.get('tabs').fire('keydown',{key:'End'});assert.equal(n.get('panel-settings').hidden,false);assert.equal(f.document.activeElement,n.get('tab-settings'));
});
function uiFixture(html,actions){const doc=documentFromHtml(html);const win={matchMedia:()=>({matches:win.wide}),wide:true,getComputedStyle:()=>({display:'block'})};const context=vm.createContext({URL,console});vm.runInContext(source('src/common.js'),context);vm.runInContext(source('src/note-ui.js'),context);return {doc,win,core:context.HikikomoriNote,isLogo:context.HikikomoriNoteUi.isOfficialHeaderLogo,ui:context.HikikomoriNoteUi.create(doc,win,actions)};}
const sidebarHtml='<aside class="sticky w-[11.375rem]"><div><nav aria-label="急上昇"></nav></div></aside><main><article></article></main>';

test('トピック配下だけを共通メニュー対象とし、topic直下・類似パス・外部を除外',()=>{
 const {core}=fixture();
 for(const url of ['https://note.com/topic/education_learning','https://note.com/topic/education_learning/?mode=new#main','https://note.com/topic/education_learning/sub'])assert.equal(core.pageKind(url).type,'topic');
 for(const url of ['https://note.com/topic','https://note.com/topic/','https://note.com/topics/education_learning','https://other.test/topic/education_learning'])assert.equal(core.pageKind(url),null);
});

test('トピックの既存asideにTLとグループ・タグを表示し、OFF・重度・対象外遷移で公式表示へ戻す',()=>{
 const f=uiFixture(sidebarHtml,{async selectGroup(){}}),settings=f.core.readSettings({...groups(['ComfyUI'])}),url='https://note.com/topic/education_learning';
 const aside=f.doc.querySelector('aside'),original=aside.children[0],article=f.doc.querySelector('article');
 f.ui.update(settings,url);const menu=aside.children[0];assert.equal(menu.querySelector('a').textContent,'フォロー中のTL');assert.equal(menu.querySelectorAll('button').length,4);
 assert.equal(menu.querySelector('ul').querySelector('a').href,f.core.tagUrl('ComfyUI'));assert.equal(menu.querySelector('[data-tag-add]'),null);assert.equal(article.isConnected,true);
 for(const [state,target] of [[{...settings,enabled:false},url],[{...settings,legacyMode:true},url],[settings,'https://note.com/topic']]){
  f.ui.update(state,target);assert.equal(aside.children.length,1);assert.equal(aside.children[0],original);assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),false);
  f.ui.update(settings,url);
 }
});

test('トピックからの背景操作はグループ選択だけ許可し、タグ追加は応答付きで拒否',async()=>{
 const f=fixture();let handler,answer;
 const port={onInstalled(){},onStartup(){},onAction(){},onMessage(fn){handler=fn;},isHomeSender:()=>false,isNoteSender:()=>true,currentMenuPage:async()=>({type:'topic'})};
 const context=vm.createContext({console,HikikomoriNoteBackgroundPlatform:port,HikikomoriNoteRouting:{createController:()=>f.controller}});
 vm.runInContext(source('src/background.js'),context);await flush();
 handler({type:'select-tag-group',patch:{groupId:'group2'}},{},value=>{answer=value;});await flush();assert.equal(answer.ok,true);assert.equal(f.stored.selectedTagGroupId,'group2');
 const writes=f.writes;handler({type:'add-current-tag',patch:{groupId:'group2',selectionRevision:1}},{},value=>{answer=value;});await flush();assert.equal(answer.code,'CONFLICT');assert.equal(f.writes,writes);
});

const searchHeaderHtml='<header data-header-state="navbar"><form role="search" action="/search"><div data-name="Field"><div><div data-name="TextFieldBase"><input type="search" name="q" aria-label="キーワードやクリエイターで検索"></div></div></div></form></header>';
function searchClearFixture(html=searchHeaderHtml){
 const f=uiFixture(html);
 f.win.HTMLInputElement=class {set value(value){this._nativeValue=value;}};
 f.win.Event=class {constructor(type,options){this.type=type;Object.assign(this,options);}};
 for(const input of f.doc.querySelectorAll('input')){
  input._nativeValue='';input.trackedWrites=0;
  Object.defineProperty(input,'value',{get(){return this._nativeValue;},set(value){this.trackedWrites++;this._nativeValue=value;}});
 }
 return f;
}

test('ヘッダーの検索クリアは値がある場合だけ表示。標準setterとinput通知で消しフォーカスを戻す',()=>{
 const f=searchClearFixture(),input=f.doc.querySelector('input'),settings=f.core.readSettings({...groups()});
 f.ui.update(settings,'https://note.com/search?q=AI');const button=f.doc.querySelector('button'),form=f.doc.querySelector('form');
 assert.equal(button.hidden,true);assert.equal(form.hasAttribute('data-hikikomori-note-search-clear-layout'),false);
 input.value='AI';input.fire('input');assert.equal(button.hidden,false);assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-label'),'検索欄をクリア');assert.ok(button.querySelector('svg'));
 let inputs=0,submits=0;input.addEventListener('input',event=>{inputs++;assert.equal(event.bubbles,true);});form.addEventListener('submit',()=>{submits++;});
 const writes=input.trackedWrites;const event=button.fire('click');
 assert.equal(input.value,'');assert.equal(input.trackedWrites,writes);assert.equal(inputs,1);assert.equal(submits,0);assert.equal(event.defaultPrevented,true);assert.equal(f.doc.activeElement,input);assert.equal(button.hidden,true);
});

test('ヘッダー検索クリアは重度でも利用可能、IME中は無効、OFF・停止で公式フォームへ復元',()=>{
 const f=searchClearFixture(),input=f.doc.querySelector('input'),settings=f.core.readSettings({...groups(),legacyMode:true});input.value='日本語';
 f.ui.update(settings,'https://note.com/ruminar');const button=f.doc.querySelector('button');input.fire('compositionstart');assert.equal(button.disabled,true);
 button.fire('click');assert.equal(input.value,'日本語');input.fire('compositionend');assert.equal(button.disabled,false);
 f.ui.update({...settings,enabled:false},'https://note.com/ruminar');assert.equal(button.isConnected,false);assert.equal(input.value,'日本語');assert.equal(input.listeners.input.length,0);assert.equal(f.doc.querySelector('form').hasAttribute('data-hikikomori-note-search-clear-layout'),false);
 f.ui.update(settings,'https://note.com/ruminar');assert.ok(f.doc.querySelector('button'));f.ui.stop();assert.equal(f.doc.querySelector('button'),null);
});

test('本文検索・未確認のヘッダー構造・外部送信フォームにはクリアボタンを追加しない',()=>{
 for(const html of [searchHeaderHtml.replace('<header data-header-state="navbar">','<main>').replace('</header>','</main>'),searchHeaderHtml.replace('action="/search"','action="https://other.test/search"'),searchHeaderHtml.replace('data-name="TextFieldBase"','data-name="unknown"'),searchHeaderHtml.replace('type="search"','type="password"')]){
  const f=searchClearFixture(html);f.ui.update(f.core.readSettings({...groups()}),'https://note.com/search');assert.equal(f.doc.querySelector('button'),null);
 }
});

test('検索欄の後挿入・差し替え・値のプログラム変更に対応し、重複ボタンや古いイベントを残さない',()=>{
 const f=searchClearFixture(),input=f.doc.querySelector('input'),settings=f.core.readSettings({...groups()});
 f.ui.update(settings,'https://note.com/search');input.value='AI';f.ui.update(settings,'https://note.com/search');assert.equal(f.doc.querySelector('button').hidden,false);
 f.ui.update(settings,'https://note.com/search');assert.equal(f.doc.querySelectorAll('button').length,1);
 const replacement=f.doc.createElement('input');for(const name of ['type','name','aria-label'])replacement.setAttribute(name,input.getAttribute(name));replacement.value='ComfyUI';const parent=input.parentElement;input.remove();parent.append(replacement);
 f.ui.update(settings,'https://note.com/search');assert.equal(f.doc.querySelectorAll('button').length,1);assert.equal(input.listeners.input.length,0);assert.equal(f.doc.querySelector('button').hidden,false);
});

test('新規保存領域は空の4グループで開始し、読込では書かず最初の設定保存で現行形式を保存',async()=>{
 const context=vm.createContext({URL,console});for(const file of ['src/common.js','src/routing.js'])vm.runInContext(source(file),context);
 let stored,writes=0;const controller=context.HikikomoriNoteRouting.createController({load:async()=>stored,store:async value=>{stored=plain(value);writes++;},setRules:async()=>{}});
 const state=await controller.getState();assert.equal(writes,0);assert.deepEqual(plain(state.tagGroups),settingsData().tagGroups);assert.equal(state.selectedTagGroupId,'group1');assert.equal(context.HikikomoriNote.settingsKey,'hikikomoriNote.settings.v2');
 await controller.save({enabled:false});assert.equal(writes,1);assert.equal(stored.enabled,false);assert.equal(stored.tagSchemaVersion,2);assert.deepEqual(stored.tagGroups,settingsData().tagGroups);
 const defaults=context.HikikomoriNote.defaultSettings();defaults.tagGroups[0].tags.push('X');assert.equal(context.HikikomoriNote.defaultSettings().tagGroups[0].tags.length,0);
});

test('幅のある記事画面は本文外の固定帰還リンクを1つだけ追加し、幅・余白・モード・離脱で除去',()=>{
 const f=uiFixture('<body><article id="note-article"><div id="note-body"></div></article></body>');
 f.doc.body=f.doc.querySelector('body');const article=f.doc.getElementById('note-article');let left=270;
 article.getBoundingClientRect=()=>({left,width:620,top:-500,height:3000});
 const settings=f.core.readSettings({...groups(),}),url='https://note.com/ruminar/n/n36b92cdcd987?x=1#body';
 const links=()=>f.doc.querySelectorAll('[data-hikikomori-note-owned]');
 f.ui.update(settings,url);assert.equal(links().length,1);assert.equal(links()[0].textContent,'フォロー中のTL');assert.equal(links()[0].href,'https://note.com/following');assert.equal(links()[0].parentElement,f.doc.body);assert.equal(article.children.length,1);
 f.ui.update(settings,url);assert.equal(links().length,1);
 f.win.wide=false;f.ui.update(settings,url);assert.equal(links().length,0);f.win.wide=true;
 left=220;f.ui.update(settings,url);assert.equal(links().length,0);left=270;
 for(const patch of [{enabled:false},{legacyMode:true}]){f.ui.update(settings,url);f.ui.update({...settings,...patch},url);assert.equal(links().length,0);}
 f.ui.update(settings,url);f.ui.update(settings,'https://note.com/ruminar');assert.equal(links().length,0);
 f.ui.update(settings,url);f.ui.stop();assert.equal(links().length,0);
});

test('記事URLでも本文領域が未挿入・非表示の場合や編集画面では固定ボタンを出さない',()=>{
 const f=uiFixture('<body></body>');f.doc.body=f.doc.querySelector('body');const settings=f.core.readSettings({...groups(),});
 f.ui.update(settings,'https://note.com/ruminar/n/n123');assert.equal(f.doc.body.children.length,0);
 const article=f.doc.createElement('article');article.setAttribute('id','note-article');f.doc.body.append(article);
 article.getBoundingClientRect=()=>({left:270,width:0});f.ui.update(settings,'https://note.com/ruminar/n/n123');assert.equal(f.doc.body.children.length,1);
 article.getBoundingClientRect=()=>({left:270,width:620});f.ui.update(settings,'https://note.com/ruminar/n/n123/edit');assert.equal(f.doc.body.children.length,1);
});

const authorHeaderHtml='<div id="author-header"><a href="https://note.com/ruminar"><span data-name="avatar"><img src="https://assets.st-note.com/profile.jpg"></span></a><div><a id="author-name" href="https://note.com/ruminar"></a><div><time></time></div></div></div>';
function authorFixture(){
 const f=uiFixture('<body><article id="note-article">'+authorHeaderHtml+'<div id="note-body"></div></article></body>');
 f.doc.body=f.doc.querySelector('body');f.doc.getElementById('author-name').textContent='るみなー先生';
 f.doc.getElementById('note-article').getBoundingClientRect=()=>({left:270,width:620});
 return f;
}
test('記事作者の名前・アイコンをTLの下の独立リンクへ表示し、元の欄を保持。更新・削除・復帰に追随',()=>{
 const f=authorFixture(),settings=f.core.readSettings({...groups(),}),url='https://note.com/ruminar/n/n123';
 const author=()=>f.doc.querySelector('[class="hikikomori-note-article-author"]');
 f.ui.update(settings,url);const link=author();assert.equal(link.href,'https://note.com/ruminar');assert.equal(link.textContent,'るみなー先生');assert.equal(link.querySelector('img').getAttribute('src'),'https://assets.st-note.com/profile.jpg');assert.equal(link.getAttribute('aria-label'),'るみなー先生のクリエーターページ');
 assert.equal(f.doc.body.children[1].textContent,'フォロー中のTL');assert.equal(f.doc.body.children[2],link);assert.equal(f.doc.getElementById('author-header').isConnected,true);
 f.ui.update(settings,url);assert.equal(author(),link);
 f.doc.getElementById('author-name').textContent='新しい表示名';f.ui.update(settings,url);assert.equal(author().textContent,'新しい表示名');
 f.doc.getElementById('author-header').remove();f.ui.update(settings,url);assert.equal(author(),null);assert.equal(f.doc.querySelector('[class="hikikomori-note-article-following"]').isConnected,true);
});

test('作者リンクはURLの作者と一致する記事上部だけ。本文内の同形欄・外部リンクをコピーしない',()=>{
 const f=authorFixture(),settings=f.core.readSettings({...groups(),}),url='https://note.com/ruminar/n/n123';
 const author=()=>f.doc.querySelector('[class="hikikomori-note-article-author"]');
 const header=f.doc.getElementById('author-header');f.doc.getElementById('note-body').append(header);f.ui.update(settings,url);assert.equal(author(),null);
 header.remove();f.doc.getElementById('note-article').prepend(header);
 f.doc.getElementById('author-name').href='https://other.test/ruminar';f.ui.update(settings,url);assert.equal(author(),null);
 f.doc.getElementById('author-name').href='https://note.com/ruminar';header.querySelector('img').setAttribute('src','https://other.test/image.jpg');f.ui.update(settings,url);assert.equal(author().textContent,'るみなー先生');assert.equal(author().querySelector('img'),null);
 f.ui.update(settings,'https://note.com/other_user/n/n456');assert.equal(author(),null);
});

test('作者固定リンクも狭幅・左余白不足・OFF・重度・SPA離脱・停止で除去する',()=>{
 const f=authorFixture(),settings=f.core.readSettings({...groups(),}),url='https://note.com/ruminar/n/n123';
 const author=()=>f.doc.querySelector('[class="hikikomori-note-article-author"]');
 for(const patch of [{enabled:false},{legacyMode:true}]){f.ui.update(settings,url);assert.ok(author());f.ui.update({...settings,...patch},url);assert.equal(author(),null);}
 f.ui.update(settings,url);f.win.wide=false;f.ui.update(settings,url);assert.equal(author(),null);f.win.wide=true;
 f.doc.getElementById('note-article').getBoundingClientRect=()=>({left:200,width:620});f.ui.update(settings,url);assert.equal(author(),null);
 f.doc.getElementById('note-article').getBoundingClientRect=()=>({left:270,width:620});f.ui.update(settings,url);assert.ok(author());
 f.ui.update(settings,'https://note.com/search');assert.equal(author(),null);f.ui.update(settings,url);f.ui.stop();assert.equal(author(),null);
});

test('検索URLは検索語・対象・並び順・末尾スラッシュに関わらず専用種別。別パスと外部は対象外',()=>{
 const {core}=fixture();
 for(const url of ['https://note.com/search','https://note.com/search/?q=きのころ&context=note&mode=search#results','https://note.com/search?context=user&q=AI'])assert.equal(core.pageKind(url).type,'search');
 for(const url of ['https://note.com/search/other','https://note.com/searching/child','https://other.test/search?q=AI'])assert.equal(core.pageKind(url),null);
});

test('検索の左メニューだけを差し替え、検索フォーム・結果タブを維持。タグ追加なし、OFFと重度で復帰',()=>{
 const f=uiFixture(sidebarHtml+'<form id="search-form"><input></form><nav id="search-tabs"><a href="/search?context=user"></a></nav>'),settings=f.core.readSettings({...groups(),...groups(['AI'])});
 const aside=f.doc.querySelector('aside'),original=aside.children[0],form=f.doc.getElementById('search-form'),tabs=f.doc.getElementById('search-tabs'),article=f.doc.querySelector('article');
 for(const url of ['https://note.com/search','https://note.com/search?q=きのころ&context=note&mode=search']){
  f.ui.update(settings,url);assert.equal(aside.children.length,2);assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),true);
  const links=aside.children[0].querySelectorAll('a');assert.equal(links[0].textContent,'フォロー中のTL');assert.equal(links[1].href,'https://note.com/search?q=%23AI&context=note&mode=search&sort=new');
  assert.equal(aside.querySelector('[data-tag-add]'),null);assert.equal(form.isConnected,true);assert.equal(tabs.isConnected,true);assert.equal(article.isConnected,true);
  assert.equal(tabs.hasAttribute('data-hikikomori-note-menu-hidden'),false);
  for(const patch of [{enabled:false},{legacyMode:true}]){f.ui.update({...settings,...patch},url);assert.equal(aside.children.length,1);assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),false);}
 }
 f.ui.update(settings,'https://note.com/search');f.ui.update(settings,'https://note.com/settings');assert.equal(aside.children.length,1);
 const unknown=uiFixture('<aside class="sticky w-[11.375rem]"><nav></nav></aside>');unknown.ui.update(settings,'https://note.com/search');assert.equal(unknown.doc.querySelector('aside').children.length,1);
});
test('実DOM境界に一致するasideだけ差し替え、モード/OFF/記事遷移で公式UIを復帰',()=>{
 const f=uiFixture(sidebarHtml),settings=f.core.readSettings({...groups(),...groups(['A'])});const aside=f.doc.querySelector('aside'),original=aside.children[0],article=f.doc.querySelector('article');
 f.ui.update(settings,'https://note.com/tag/A?mode=new');assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),true);assert.equal(aside.children.length,2);
 assert.equal(aside.children[0].querySelector('[aria-current="page"]').textContent,'# A');
 f.ui.update(settings,'https://note.com/tag/A');assert.equal(aside.children.length,2);
 f.ui.update({...settings,legacyMode:true},'https://note.com/tag/A');assert.equal(aside.children.length,1);assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),false);
 f.ui.update(settings,'https://note.com/following');assert.equal(aside.children[0].querySelector('[aria-current="page"]').textContent,'フォロー中のTL');
 f.ui.update({...settings,enabled:false},'https://note.com/following');assert.equal(aside.children.length,1);
 f.ui.update(settings,'https://note.com/tag/A');f.ui.update(settings,'https://note.com/user/n/id');assert.equal(aside.children.length,1);assert.equal(article.parentElement.tagName,'MAIN');
});
test('DOM再生成後の公式メニューも処理し、構造不一致なら推測で非表示にしない',()=>{
 const f=uiFixture(sidebarHtml),settings=f.core.readSettings({...groups(),});const aside=f.doc.querySelector('aside');
 f.ui.update(settings,'https://note.com/tag/A');const later=f.doc.createElement('div');aside.append(later);f.ui.update(settings,'https://note.com/tag/A');assert.equal(later.hasAttribute('data-hikikomori-note-menu-hidden'),true);
 aside.className='changed';f.ui.update(settings,'https://note.com/tag/A');assert.equal(later.hasAttribute('data-hikikomori-note-menu-hidden'),false);assert.equal(aside.children.length,2);
});
test('プロフィール情報の先頭に幅を問わず追加し、非表示領域やモードでは解除',()=>{
 const f=uiFixture('<aside class="w-full lg:w-96"><div><button data-name="avatar"></button><h1></h1><a href="/ruminar/followings"></a></div></aside>'),settings=f.core.readSettings({...groups(),});const aside=f.doc.querySelector('aside');
 f.ui.update(settings,'https://note.com/ruminar/all');assert.equal(aside.children[0].textContent,'フォロー中のTL');
 assert.equal(aside.children[0].classList.contains('hikikomori-note-profile-navigation'),true);
 f.ui.update(settings,'https://note.com/ruminar/all');assert.equal(aside.children.length,2);
 for(const page of ['followings','followers']){
  f.ui.update(settings,`https://note.com/ruminar/${page}?page=2`);
  assert.equal(aside.children.length,2);assert.equal(aside.children[0].textContent,'フォロー中のTL');
  assert.equal(aside.children[0].querySelector('a').href,'https://note.com/following');
 }
 f.win.wide=false;f.ui.update(settings,'https://note.com/ruminar');assert.equal(aside.children.length,2);
 aside.width=0;f.ui.update(settings,'https://note.com/ruminar');assert.equal(aside.children.length,1);
 aside.width=180;
 f.win.wide=true;f.ui.update(settings,'https://note.com/ruminar');f.ui.update({...settings,legacyMode:true},'https://note.com/ruminar');assert.equal(aside.children.length,1);
 f.ui.update(settings,'https://note.com/ruminar/n/article');assert.equal(aside.children.length,1);
});
test('タグ・プロフィール判定は予約パスや記事・外部URL・壊れたエンコードを除外',()=>{
 const {core}=fixture();
 for(const url of ['https://note.com/settings','https://note.com/dashboard','https://note.com/ruminar/n/id','https://other.test/ruminar','https://note.com/tag/%xx'])assert.equal(core.pageKind(url),null);
 assert.equal(core.pageKind('https://note.com/hashtag/AI?mode=new').tag,'AI');assert.equal(core.pageKind('https://note.com/ruminar/likes').type,'profile');
 for(const user of ['ruminar','other_user'])for(const page of ['followings','followers'])assert.equal(core.pageKind(`https://note.com/${user}/${page}?page=2`).user,user);
});
test('タグの確認済み関連商品sectionだけを隠し、サイドバーなしでもOFF・モード・離脱で復帰',()=>{
 const f=uiFixture('<section id="product"><h2 class="sr-only"></h2><div data-aicn-thing-card="true"></div></section><section id="other"><h2></h2></section><article></article>');
 const product=f.doc.getElementById('product'),other=f.doc.getElementById('other');product.querySelector('h2').textContent='関連商品';other.querySelector('h2').textContent='関連キーワード';
 const settings=f.core.readSettings({...groups(),}),marker='data-hikikomori-note-product-hidden';
 f.ui.update(settings,'https://note.com/tag/ComfyUI?mode=new');assert.equal(product.hasAttribute(marker),true);assert.equal(other.hasAttribute(marker),false);
 for(const override of [{enabled:false},{legacyMode:true}]){f.ui.update({...settings,...override},'https://note.com/tag/ComfyUI');assert.equal(product.hasAttribute(marker),false);f.ui.update(settings,'https://note.com/tag/ComfyUI');assert.equal(product.hasAttribute(marker),true);}
 f.ui.update(settings,'https://note.com/ruminar/n/article');assert.equal(product.hasAttribute(marker),false);
 f.ui.update(settings,'https://note.com/hashtag/ComfyUI');f.ui.stop();assert.equal(product.hasAttribute(marker),false);
});
test('後挿入の商品枠に追随し、見出し・構造が違う枠や記事本文を隠さない',()=>{
 const f=uiFixture('<section id="region"><h2 class="sr-only"></h2></section>'),settings=f.core.readSettings({...groups(),}),section=f.doc.getElementById('region'),marker='data-hikikomori-note-product-hidden';
 section.querySelector('h2').textContent='関連商品';f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
 const card=f.doc.createElement('div');card.setAttribute('data-testid','aicn-thing-card');section.append(card);
 f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),true);
 section.querySelector('h2').textContent='記事';f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
 section.querySelector('h2').textContent='関連商品';section.append(f.doc.createElement('article'));f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
});

test('記事おすすめ設定は既定で表示。型検証・再起動・OFF・タグ操作でも保存値を維持',async()=>{
 const f=fixture({...groups(['A'])});
 assert.equal((await f.controller.getState()).hideArticleRecommendations,false);
 await assert.rejects(f.controller.save({hideArticleRecommendations:'true'}));assert.equal(f.writes,0);
 await f.controller.save({hideArticleRecommendations:true});
 await f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'B'});
 await f.controller.save({legacyMode:true,enabled:false});
 assert.equal((await f.restart().getState()).hideArticleRecommendations,true);assert.deepEqual(f.stored.tagGroups[0].tags,['A','B']);assert.equal(f.rules.length,0);
});

test('記事おすすめ設定の保存失敗は確定せず、設定UIの未保存値を保って再試行できる',async()=>{
 const f=homeFixture({saveError:true});await flush();const n=f.nodes;
 const checkbox=n.get('hide-article-recommendations');assert.equal(checkbox.checked,false);
 checkbox.checked=true;checkbox.fire('change');n.get('settings').fire('submit');await flush();
 assert.notEqual(f.state.hideArticleRecommendations,true);assert.equal(checkbox.checked,true);assert.match(n.get('status').textContent,/save failed/);
 f.options.saveError=false;n.get('settings').fire('submit');await flush();
 assert.equal(f.state.hideArticleRecommendations,true);assert.deepEqual(f.patches,[{hideArticleRecommendations:true},{hideArticleRecommendations:true}]);
});

test('別タブの記事おすすめ設定を同期し、モードでも表示。未保存入力は部分保存する',async()=>{
 const f=homeFixture({state:{legacyMode:true}});await flush();const n=f.nodes,checkbox=n.get('hide-article-recommendations');
 assert.equal(checkbox.disabled,false);f.changed({hideArticleRecommendations:true});assert.equal(checkbox.checked,true);
 checkbox.checked=false;checkbox.fire('change');f.changed({noteUserId:'remote_user',hideArticleRecommendations:true});
 assert.equal(checkbox.checked,false);n.get('settings').fire('submit');await flush();
 assert.deepEqual(f.patches,[{hideArticleRecommendations:false}]);assert.equal(f.state.noteUserId,'remote_user');assert.equal(f.state.legacyMode,true);
});

const recommendationHtml='<div class="pt-6 px-4 md:px-0"><div><h2></h2></div><aside aria-label="記事"></aside></div>';
const articleUrl='https://note.com/ruminar/n/n36b92cdcd987';
const recommendationMarker='data-hikikomori-note-recommendations-hidden';

test('有料記事設定は既定OFF。型検証・保存・再起動と他設定の維持',async()=>{
 const f=fixture();assert.equal((await f.controller.getState()).hidePaidArticles,false);
 await assert.rejects(f.controller.save({hidePaidArticles:'true'}));assert.equal(f.writes,0);
 await f.controller.save({hidePaidArticles:true});await f.controller.save({legacyMode:true,enabled:false});
 assert.equal((await f.restart().getState()).hidePaidArticles,true);
 f.options.fail=true;await assert.rejects(f.controller.save({hidePaidArticles:false}));assert.equal(f.stored.hidePaidArticles,true);
});

test('有料記事設定UIは未保存値を維持し、保存成功後に同期、失敗時には確定しない',async()=>{
 const f=homeFixture({saveError:true});await flush();const n=f.nodes,checkbox=n.get('hide-paid-articles');
 assert.equal(checkbox.checked,false);checkbox.checked=true;checkbox.fire('change');n.get('settings').fire('submit');await flush();
 assert.equal(f.state.hidePaidArticles,false);assert.equal(checkbox.checked,true);
 f.options.saveError=false;n.get('settings').fire('submit');await flush();assert.equal(f.state.hidePaidArticles,true);
 f.changed({hidePaidArticles:false});assert.equal(checkbox.checked,false);
});

const paidCardHtml='<div class="grid-rows-subgrid"><div class="flex"><a class="absolute inset-0" aria-label="記事" title="記事" href="https://note.com/ai_urawaza_lab/n/n1cefb1215779"></a><div><h3></h3><div><div><span class="text-text-success text-sm"></span></div></div></div></div></div>';
const paidMarker='data-hikikomori-note-paid-hidden';
function paidFixture(){const f=uiFixture(paidCardHtml);f.doc.querySelector('span').textContent='¥300';return f;}

test('価格付き記事カードを両モードで隠し、OFF・購入済み一覧へのSPA遷移・停止で復元',()=>{
 for(const legacyMode of [false,true]){
  const f=paidFixture(),card=f.doc.root.children[0],settings=f.core.readSettings({...groups(),legacyMode,hidePaidArticles:true});
  f.ui.update({...settings,hidePaidArticles:false},'https://note.com/search?q=AI');assert.equal(card.hasAttribute(paidMarker),false);
  f.ui.update(settings,'https://note.com/search?q=AI');assert.equal(card.hasAttribute(paidMarker),true);
  for(const url of ['https://note.com/notes/purchased','https://note.com/notes/purchased?mode=new','https://note.com/notes/purchased/']){
   f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),false);
  }
  f.ui.update(settings,'https://note.com/following');assert.equal(card.hasAttribute(paidMarker),true);
  f.ui.update({...settings,enabled:false},'https://note.com/following');assert.equal(card.hasAttribute(paidMarker),false);
  f.ui.update(settings,'https://note.com/ruminar');assert.equal(card.hasAttribute(paidMarker),true);
  f.ui.stop();assert.equal(card.hasAttribute(paidMarker),false);
 }
});

test('無料・価格不明・本文中の価格・商品・不明なカード構造を隠さない',()=>{
 for(const value of ['無料','300円','¥0','¥300から','¥300 月額','おすすめ商品 ¥300']){
  const f=paidFixture();f.doc.querySelector('span').textContent=value;
  f.ui.update(f.core.readSettings({...groups(),hidePaidArticles:true}),'https://note.com/search');assert.equal(f.doc.root.children[0].hasAttribute(paidMarker),false);
 }
 for(const change of [f=>f.doc.querySelector('a').href='https://amazon.co.jp/item',f=>f.doc.querySelector('h3').remove(),f=>f.doc.root.children[0].className='unknown',f=>{const article=f.doc.createElement('article');article.append(f.doc.root.children[0]);f.doc.root.append(article);},f=>f.doc.querySelector('span').className='unknown']){
  const f=paidFixture(),card=f.doc.root.children[0];change(f);f.ui.update(f.core.readSettings({...groups(),hidePaidArticles:true}),'https://note.com/search');assert.equal(card.hasAttribute(paidMarker),false);
 }
});

test('後から追加された価格・カードをDOM更新時だけ再判定し、価格の消失で復元',()=>{
 const f=paidFixture(),card=f.doc.root.children[0],settings=f.core.readSettings({...groups(),hidePaidArticles:true});
 f.doc.querySelector('span').textContent='無料';f.ui.update(settings,'https://note.com/search');assert.equal(card.hasAttribute(paidMarker),false);
 f.doc.querySelector('span').textContent='¥1,200';f.ui.invalidatePaidCards();f.ui.update(settings,'https://note.com/search');assert.equal(card.hasAttribute(paidMarker),true);
 f.doc.querySelector('span').textContent='無料';f.ui.invalidatePaidCards();f.ui.update(settings,'https://note.com/search');assert.equal(card.hasAttribute(paidMarker),false);
 const added=f.doc.createElement('div');added.className='grid-rows-subgrid';const inner=f.doc.createElement('div');added.append(inner);
 const a=f.doc.createElement('a');a.className='absolute inset-0';a.href='https://note.com/ruminar/n/n123';a.setAttribute('title','記事');a.setAttribute('aria-label','記事');
 const price=f.doc.createElement('span');price.className='text-text-success';price.textContent='¥500';inner.append(a,f.doc.createElement('h3'),price);f.doc.root.append(added);
 f.ui.invalidatePaidCards();f.ui.update(settings,'https://note.com/search');assert.equal(added.hasAttribute(paidMarker),true);
});

test('非表示は提供HTMLの一覧アイテム外枠まで。無料カードや一覧全体を隠さず購入済み画面で復元',()=>{
 const f=uiFixture('<div class="grid"><div><div class="mb-0 w-full min-w-0 border-b-0 pb-0"><div class="contents">'+paidCardHtml+'</div></div></div><div id="free"></div></div>');
 const grid=f.doc.root.children[0],item=grid.children[0],free=grid.children[1],price=f.doc.querySelector('span');price.textContent='¥300';
 const settings=f.core.readSettings({...groups(),hidePaidArticles:true});
 f.ui.update(settings,'https://note.com/search');assert.equal(item.hasAttribute(paidMarker),true);
 assert.equal(grid.hasAttribute(paidMarker),false);assert.equal(free.hasAttribute(paidMarker),false);
 f.ui.update(settings,'https://note.com/notes/purchased');assert.equal(item.hasAttribute(paidMarker),false);
 f.ui.update(settings,'https://note.com/search');assert.equal(item.hasAttribute(paidMarker),true);
 price.textContent='無料';f.ui.invalidatePaidCards();f.ui.update(settings,'https://note.com/search');assert.equal(item.hasAttribute(paidMarker),false);
 price.textContent='¥300';f.ui.invalidatePaidCards();f.ui.update(settings,'https://note.com/search');f.ui.stop();assert.equal(item.hasAttribute(paidMarker),false);
});
test('記事おすすめ枠だけを両モードで隠し、設定解除・全体OFF・画面離脱・停止で戻す',()=>{
 const f=uiFixture('<article id="note-article"><h2></h2></article><section aria-labelledby="comment"><h2></h2></section>'+recommendationHtml);
 const article=f.doc.getElementById('note-article'),comment=f.doc.querySelector('section'),region=f.doc.root.children.at(-1);
 for(const h of f.doc.querySelectorAll('h2'))h.textContent='あなたへのおすすめ';
 const settings=f.core.readSettings({...groups(),hideArticleRecommendations:true});
 f.ui.update({...settings,hideArticleRecommendations:false},articleUrl);assert.equal(region.hasAttribute(recommendationMarker),false);
 for(const legacyMode of [false,true]){
  f.ui.update({...settings,legacyMode},articleUrl+'?x=1#comments');assert.equal(region.hasAttribute(recommendationMarker),true);
  assert.equal(article.hasAttribute(recommendationMarker),false);assert.equal(comment.hasAttribute(recommendationMarker),false);
  for(const override of [{enabled:false},{hideArticleRecommendations:false}]){
   f.ui.update({...settings,legacyMode,...override},articleUrl);assert.equal(region.hasAttribute(recommendationMarker),false);
   f.ui.update({...settings,legacyMode},articleUrl);
  }
 }
 f.ui.update(settings,'https://note.com/tag/A');assert.equal(region.hasAttribute(recommendationMarker),false);
 f.ui.update(settings,articleUrl);f.ui.stop();assert.equal(region.hasAttribute(recommendationMarker),false);
});

test('後挿入・構造変更に追随し、記事本文内の同形枠や別サイトは対象外',()=>{
 const f=uiFixture('<article>'+recommendationHtml+'</article><div id="note-body">'+recommendationHtml+'</div><div id="later"></div>');
 for(const h of f.doc.querySelectorAll('h2'))h.textContent='あなたへのおすすめ';
 const settings=f.core.readSettings({...groups(),hideArticleRecommendations:true});
 f.ui.update(settings,articleUrl);assert.equal(f.doc.querySelectorAll('['+recommendationMarker+']').length,0);
 const region=documentFromHtml(recommendationHtml).root.children[0];region.querySelector('h2').textContent='あなたへのおすすめ';
 f.doc.getElementById('later').append(region);f.ui.update(settings,articleUrl);assert.equal(region.hasAttribute(recommendationMarker),true);
 region.querySelector('h2').textContent='コメント';f.ui.update(settings,articleUrl);assert.equal(region.hasAttribute(recommendationMarker),false);
 region.querySelector('h2').textContent='あなたへのおすすめ';region.querySelector('aside').setAttribute('aria-label','その他');f.ui.update(settings,articleUrl);assert.equal(region.hasAttribute(recommendationMarker),false);
 region.querySelector('aside').setAttribute('aria-label','記事');
 for(const url of ['https://other.test/ruminar/n/n123','https://note.com/ruminar','https://note.com/ruminar/n/n123/edit','invalid']){
  f.ui.update(settings,url);assert.equal(region.hasAttribute(recommendationMarker),false);
 }
});

test('タグページからの追加も同じキューで末尾へ保存し、重複・OFF・モード・保存失敗を拒否',async()=>{
 const f=fixture({...groups(['A'])});
 await Promise.all([f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'みじんこ123'},{requireEnabled:true}),f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'B'})]);
 assert.deepEqual(f.stored.tagGroups[0].tags,['A','みじんこ123','B']);
 await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'みじんこ123'},{requireEnabled:true}),{code:'CONFLICT'});
 await f.controller.save({enabled:false});await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'C'},{requireEnabled:true}),{code:'DISABLED'});
 await f.controller.save({enabled:true,legacyMode:true});await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'C'},{requireEnabled:true}),{code:'LEGACY_MODE'});
 await f.controller.save({legacyMode:false});f.options.fail=true;
 await assert.rejects(f.controller.tag({groupId:'group1',type:'ADD_TAG',tag:'C'},{requireEnabled:true}));assert.deepEqual(f.stored.tagGroups[0].tags,['A','みじんこ123','B']);
});

test('コンテンツ送信元は自拡張・note・最上位タブだけ。現在のタブURLを安全にデコード',async()=>{
 let tab;
 const context=vm.createContext({URL,chrome:{runtime:{id:'self',getURL:file=>'chrome-extension://self/'+file},tabs:{get:async id=>{assert.equal(id,12);return tab;}}}});
 vm.runInContext(source('src/common.js'),context);vm.runInContext(source('src/platform/browser-api.js'),context);
 const check=context.HikikomoriNoteBackgroundPlatform.currentMenuPage;
 const sender={id:'self',frameId:0,tab:{id:12},url:'https://note.com/hashtag/%E3%81%BF%E3%81%98%E3%82%93%E3%81%93123?mode=new'};
 tab={url:sender.url};assert.equal((await check(sender,sender.url)).tag,'みじんこ123');
 for(const patch of [{id:'other'},{frameId:1},{tab:undefined},{url:'https://other.test/tag/A'}])assert.equal(await check({...sender,...patch},sender.url),null);
 for(const url of ['https://note.com/ruminar','https://note.com/tag/%xx','https://other.test/tag/A']){tab={url};assert.equal(await check(sender,url),null);}
});

test('背景処理は表示中のタグだけを追加し、コンテンツからの任意タグ・削除・設定保存を許可しない',async()=>{
 const f=fixture();let handler;
 const port={onInstalled(){},onStartup(){},onAction(){},onMessage(fn){handler=fn;},isHomeSender:()=>false,isNoteSender:sender=>sender.url.startsWith('https://note.com/'),currentMenuPage:async()=>({type:'tag',tag:'実際のタグ'})};
 const context=vm.createContext({console,HikikomoriNoteBackgroundPlatform:port,HikikomoriNoteRouting:{createController:()=>f.controller}});
 vm.runInContext(source('src/background.js'),context);await flush();const sender={url:'https://note.com/tag/実際のタグ'};let answer;
 for(const type of ['tag-operation','save-settings','get-state'])assert.equal(handler({type,patch:{groupId:'group1',type:'REMOVE_TAG',tag:'A'}},sender,()=>{}),false);
 assert.equal(handler({type:'add-current-tag'},{url:'https://other.test/tag/A'},()=>{}),false);
 assert.equal(handler({type:'add-current-tag',patch:{tag:'偽のタグ',groupId:'group1',selectionRevision:0}},sender,value=>{answer=value;}),true);await flush();
 assert.equal(answer.ok,true);assert.deepEqual(f.stored.tagGroups[0].tags,['実際のタグ']);
 await f.controller.save({enabled:false});handler({type:'add-current-tag',patch:{groupId:'group1',selectionRevision:0}},sender,value=>{answer=value;});await flush();assert.equal(answer.code,'DISABLED');
});

test('表示中の日本語タグを左メニューで追加し、二重クリックを止めて登録済みを同期',async()=>{
 let complete,calls=0;const url='https://note.com/hashtag/%E3%81%BF%E3%81%98%E3%82%93%E3%81%93123';
 const f=uiFixture(sidebarHtml,{async addCurrentTag(){calls++;await new Promise(resolve=>{complete=resolve;});settings=f.core.readSettings({...groups(),...groups(['みじんこ123'])});f.ui.update(settings,url);}});
 let settings=f.core.readSettings({...groups(),});f.ui.update(settings,url);
 const button=f.doc.querySelector('[data-tag-add]');assert.match(button.getAttribute('aria-label'),/みじんこ123/);assert.equal(button.disabled,false);
 button.onclick();button.onclick();assert.equal(calls,1);assert.equal(f.doc.querySelector('[data-tag-add]').disabled,true);
 complete();await flush();assert.equal(f.doc.querySelector('[data-tag-add]'),null);
 assert.equal(f.doc.querySelector('[aria-current="page"]').href,'https://note.com/search?q=%23%E3%81%BF%E3%81%98%E3%82%93%E3%81%93123&context=note&mode=search&sort=new');
 f.ui.update(f.core.readSettings({...groups(),}),url);assert.equal(f.doc.querySelector('[data-tag-add]').disabled,false);
 for(const target of ['https://note.com/following','https://note.com/ruminar/n/n123']){f.ui.update(settings,target);assert.equal(f.doc.querySelector('[data-tag-add]'),null);}
});

test('追加結果未確認では自動再送せず、再確認が成功するまで別タグでも追加を停止',async()=>{
 let calls=0,refreshes=0;const f=uiFixture(sidebarHtml,{async addCurrentTag(){calls++;throw Object.assign(Error('保存結果未確認'),{code:'UNCONFIRMED'});},async refresh(){refreshes++;}}),settings=f.core.readSettings({...groups(),});
 f.ui.update(settings,'https://note.com/tag/A');f.doc.querySelector('[data-tag-add]').onclick();await flush();
 assert.equal(f.doc.querySelector('[data-tag-add]').disabled,true);assert.equal(calls,1);
 f.ui.update(settings,'https://note.com/tag/B');assert.equal(f.doc.querySelector('[data-tag-add]').disabled,true);assert.equal(calls,1);
 f.doc.querySelectorAll('button').find(button=>button.textContent==='状態を再確認').onclick();await flush();assert.equal(refreshes,1);assert.equal(f.doc.querySelector('[data-tag-add]').disabled,false);
});

test('既知の追加失敗は表示して再試行可能。破損タグ・空タグ・OFF・重度では登録しない',async()=>{
 let calls=0;const f=uiFixture(sidebarHtml,{async addCurrentTag(){calls++;throw Error('保存失敗');}}),settings=f.core.readSettings({...groups(),});
 f.ui.update(settings,'https://note.com/tag/A');f.doc.querySelector('[data-tag-add]').onclick();await flush();
 assert.equal(f.doc.querySelector('[data-tag-add]').disabled,false);assert.match(f.doc.root.textContent,/保存失敗/);
 f.ui.update(f.core.readSettings({...groups(),...groups(['A',null])}),'https://note.com/tag/B');assert.equal(f.doc.querySelector('[data-tag-add]').disabled,true);
 f.ui.update(settings,'https://note.com/tag/%23');assert.equal(f.doc.querySelector('[data-tag-add]').disabled,true);
 for(const patch of [{enabled:false},{legacyMode:true}]){f.ui.update({...settings,...patch},'https://note.com/tag/A');assert.equal(f.doc.querySelector('[data-tag-add]'),null);}
 assert.equal(calls,1);
});

test('現行グループ形式の破損はrawを保持して変更停止',async()=>{
 for(const patch of [{tagSchemaVersion:9,tagGroups:[]},{tagGroups:[]},{tagSchemaVersion:2,tagGroups:[]}]){
  const initial={...settingsData(),...patch},f=fixture(initial);const state=await f.controller.getState();assert.ok(state.tagWarning);assert.deepEqual(f.stored,initial);
  await assert.rejects(f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'X'}),{code:'INVALID_TAGS'});
  await f.controller.save({confirmNoteLogoClick:true});for(const key of ['tagSchemaVersion','tagGroups','selectedTagGroupId','groupSelectionRevision','tagGroupsRevision'])assert.deepEqual(f.stored[key],initial[key]);
 }
});

test('グループ選択と別グループへの同時追加は互いに上書きせず、同一タグを各枠に登録可能',async()=>{
 const f=fixture({...groups(['A'])});await f.controller.getState();
 await Promise.all([f.controller.tag({type:'SELECT_TAG_GROUP',groupId:'group2'}),f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'B'}),f.controller.tag({type:'ADD_TAG',groupId:'group2',tag:'A'})]);
 assert.equal(f.stored.selectedTagGroupId,'group2');assert.deepEqual(f.stored.tagGroups[0].tags,['A','B']);assert.deepEqual(f.stored.tagGroups[1].tags,['A']);
 await assert.rejects(f.controller.tag({type:'ADD_TAG',groupId:'group2',tag:'A'}),{code:'CONFLICT'});
 const state=await f.restart().getState();assert.equal(state.selectedTagGroupId,'group2');assert.equal(state.groupSelectionRevision,1);
});

test('グループ間移動は一度の保存。移動先重複・保存失敗で元タグを失わない',async()=>{
 const f=fixture({...groups(['A','B'])});await f.controller.getState();const before=f.writes;
 await f.controller.tag({type:'TRANSFER_TAG',groupId:'group1',targetGroupId:'group2',tag:'A'});assert.equal(f.writes,before+1);assert.deepEqual(f.stored.tagGroups[0].tags,['B']);assert.deepEqual(f.stored.tagGroups[1].tags,['A']);
 await f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'A'});await assert.rejects(f.controller.tag({type:'TRANSFER_TAG',groupId:'group1',targetGroupId:'group2',tag:'A'}),{code:'CONFLICT'});
 f.options.fail=true;await assert.rejects(f.controller.tag({type:'TRANSFER_TAG',groupId:'group1',targetGroupId:'group2',tag:'B'}));assert.deepEqual(f.stored.tagGroups[0].tags,['B','A']);assert.deepEqual(f.stored.tagGroups[1].tags,['A']);
});

test('改名は入力検証とexpectedName競合を確認し、不正操作・グループ配列保存を拒否',async()=>{
 const f=fixture();await f.controller.getState();
 await f.controller.tag({type:'RENAME_TAG_GROUP',groupId:'group2',name:' 技術系 ',expectedName:''});assert.equal(f.stored.tagGroups[1].name,'技術系');
 await assert.rejects(f.controller.tag({type:'RENAME_TAG_GROUP',groupId:'group2',name:'創作',expectedName:''}),{code:'CONFLICT'});
 for(const name of ['a\nb','x'.repeat(41),'\ud800'])await assert.rejects(f.controller.tag({type:'RENAME_TAG_GROUP',groupId:'group2',name,expectedName:'技術系'}));
 await assert.rejects(f.controller.tag({type:'ADD_TAG',tag:'X'}));await assert.rejects(f.controller.save({tagGroups:[]}));assert.equal(f.stored.tagGroups[1].name,'技術系');
});

test('選択①→②→①でもタグページの古い選択番号を拒否し、現在グループへだけ追加',async()=>{
 const f=fixture();await f.controller.getState();await f.controller.tag({type:'SELECT_TAG_GROUP',groupId:'group2'});await f.controller.tag({type:'SELECT_TAG_GROUP',groupId:'group1'});
 await assert.rejects(f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'X'},{requireEnabled:true,selectionRevision:0}),{code:'CONFLICT'});
 await f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'X'},{requireEnabled:true,selectionRevision:2});assert.deepEqual(f.stored.tagGroups[0].tags,['X']);
});

test('ホームの4番号・改名・グループ別入力保持・移動操作を実ソースで検証',async()=>{
 const f=homeFixture({state:{...groups(['A'])}});await flush();const n=f.nodes;
 assert.equal(n.get('edit-groups').querySelectorAll('button').length,4);n.get('tag-input').value='①の途中';
 n.get('edit-groups').querySelectorAll('button')[1].onclick();await flush();assert.equal(f.state.selectedTagGroupId,'group2');assert.equal(n.get('tag-input').value,'');
 n.get('tag-input').value='②の途中';n.get('group-name').value='技術系';n.get('group-name').fire('input');n.get('group-name-form').fire('submit');await flush();assert.equal(f.state.tagGroups[1].name,'技術系');
 n.get('edit-groups').querySelectorAll('button')[0].onclick();await flush();assert.equal(n.get('tag-input').value,'①の途中');
 const row=n.get('edit-tags').children[0];row.querySelector('select').value='group2';row.children.at(-1).onclick();await flush();assert.deepEqual(f.state.tagGroups[0].tags,[]);assert.deepEqual(f.state.tagGroups[1].tags,['A']);
 n.get('edit-groups').querySelectorAll('button')[1].onclick();await flush();assert.equal(n.get('tag-input').value,'②の途中');assert.equal(n.get('group-name').value,'技術系');assert.deepEqual(f.moves,[]);
});

test('サイドバーのグループ選択はページ遷移せず保存結果を反映し、追加に選択IDとrevisionを送る',async()=>{
 let settings,added;const f=uiFixture(sidebarHtml,{async selectGroup(groupId){settings={...settings,tagSchemaVersion:2,selectedTagGroupId:groupId,groupSelectionRevision:1};f.ui.update(settings,'https://note.com/tag/A');},async addCurrentTag(...args){added=args;}});
 settings=f.core.readSettings({...groups(),});f.ui.update(settings,'https://note.com/tag/A');f.doc.querySelector('[data-group-id="group2"]').onclick();await flush();
 assert.equal(f.doc.querySelector('[data-group-id="group2"]').getAttribute('aria-pressed'),'true');f.doc.querySelector('[data-tag-add]').onclick();await flush();assert.deepEqual(added,['group2',1]);
});

test('ロゴ識別は公式headerのnote SVGだけ。本文内・通常ホームリンクは除外',()=>{
 const f=uiFixture('<header data-header-state="navbar"><a id="logo" href="/"><svg role="img" aria-label="note"></svg></a><a id="other" href="/"></a></header><article><header data-header-state="navbar"><a id="fake" href="/"><svg role="img" aria-label="note"></svg></a></header></article>');
 assert.equal(f.isLogo(f.doc.getElementById('logo')),true);assert.equal(f.isLogo(f.doc.getElementById('other')),false);assert.equal(f.isLogo(f.doc.getElementById('fake')),false);
});

test('選択IDだけの破損は番号選択で修復し、壊れたrevisionは保存せず停止',async()=>{
 const f=fixture({...groups(['A'])});await f.controller.getState();const raw=plain(f.stored);
 const broken=fixture({...raw,selectedTagGroupId:'missing'});assert.equal((await broken.controller.getState()).groupSelectionInvalid,true);
 await assert.rejects(broken.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'X'}),{code:'CONFLICT'});
 await broken.controller.tag({type:'SELECT_TAG_GROUP',groupId:'group2'});assert.equal(broken.stored.selectedTagGroupId,'group2');assert.deepEqual(broken.stored.tagGroups,raw.tagGroups);
 const invalid=fixture({...raw,tagGroupsRevision:-1});await assert.rejects(invalid.controller.tag({type:'SELECT_TAG_GROUP',groupId:'group2'}),{code:'INVALID_TAGS'});assert.equal(invalid.writes,0);
});

test('検索サイドバーでもグループ選択の結果未確認を案内し、再確認で操作復帰',async()=>{
 const f=uiFixture(sidebarHtml,{async selectGroup(){throw Object.assign(Error('選択結果未確認'),{code:'UNCONFIRMED'});},async refresh(){}}),settings=f.core.readSettings({...groups(),});
 f.ui.update(settings,'https://note.com/search?q=AI');f.doc.querySelector('[data-group-id="group2"]').onclick();await flush();
 assert.match(f.doc.root.textContent,/選択結果未確認/);assert.equal(f.doc.querySelector('[data-group-id="group1"]').disabled,true);
 f.doc.querySelectorAll('button').find(button=>button.textContent==='状態を再確認').onclick();await flush();assert.equal(f.doc.querySelector('[data-group-id="group1"]').disabled,false);
});

test('noteのグループ選択は現在の共通メニュー対象URLとトップフレームを確認',async()=>{
 let tab;
 const context=vm.createContext({URL,chrome:{runtime:{id:'self',getURL:file=>'chrome-extension://self/'+file},tabs:{get:async()=>tab}}});
 vm.runInContext(source('src/common.js'),context);vm.runInContext(source('src/platform/browser-api.js'),context);
 const check=context.HikikomoriNoteBackgroundPlatform.currentMenuPage,sender={id:'self',frameId:0,tab:{id:1},url:'https://note.com/ruminar'};
 for(const url of ['https://note.com/following','https://note.com/tag/AI','https://note.com/search?q=AI','https://note.com/topic/education_learning']){tab={url};assert.ok(await check(sender,url));}
 for(const url of ['https://note.com/ruminar','https://note.com/ruminar/n/n123','https://other.test/search']){tab={url};assert.equal(await check(sender,url),null);}
 tab={url:'https://note.com/search'};
 for(const patch of [{id:'other'},{frameId:1}])assert.equal(await check({...sender,...patch},tab.url),null);
});

test('検索→hashtag→tagのSPA遷移後、古いsender.urlでも現在タグを登録しグループを選べる',async()=>{
 const f=fixture();let handler,answer;
 const pageUrl='https://note.com/tag/ComfyUI';
 const context=vm.createContext({URL,console,location:{href:pageUrl},chrome:{
  runtime:{id:'self',getURL:file=>'chrome-extension://self/'+file,onMessage:{addListener:fn=>{handler=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  action:{onClicked:{addListener(){}}},tabs:{get:async()=>({url:pageUrl})}
 }});
 for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
 context.HikikomoriNoteRouting={createController:()=>f.controller};vm.runInContext(source('src/background.js'),context);await flush();
 const sender={id:'self',frameId:0,tab:{id:1},url:'https://note.com/search?q=ComfyUI&context=note&mode=search'};
 const send=async(type,patch)=>{answer=undefined;assert.equal(handler({type,patch},sender,value=>{answer=value;}),true);assert.equal(answer,undefined);await flush();return answer;};
 assert.equal((await send('select-tag-group',{pageUrl,groupId:'group2'})).ok,true);
 assert.equal((await send('add-current-tag',{pageUrl,groupId:'group2',selectionRevision:1,tag:'偽タグ'})).ok,true);
 assert.deepEqual(f.stored.tagGroups[1].tags,['ComfyUI']);
 const writes=f.writes;
 assert.equal((await send('add-current-tag',{pageUrl:'https://note.com/tag/AI',groupId:'group2',selectionRevision:1})).code,'CONFLICT');
 assert.equal(f.writes,writes);
});

test('現在URLの不一致・遷移中・閉じたタブは登録対象とせず、タブ取得失敗も処理する',async()=>{
 let tab={url:'https://note.com/tag/ComfyUI'},fail=false;
 const context=vm.createContext({URL,chrome:{runtime:{id:'self'},tabs:{get:async()=>{if(fail)throw Error('closed');return tab;}}}});
 for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
 const check=context.HikikomoriNoteBackgroundPlatform.currentMenuPage,sender={id:'self',frameId:0,tab:{id:1},url:'https://note.com/hashtag/ComfyUI'};
 for(const pageUrl of [undefined,'invalid','https://note.com/tag/AI','https://other.test/tag/ComfyUI'])assert.equal(await check(sender,pageUrl),null);
 tab.pendingUrl='https://note.com/tag/AI';assert.equal(await check(sender,tab.url),null);
 delete tab.pendingUrl;fail=true;assert.equal(await check(sender,tab.url),null);
 tab={};fail=false;assert.equal(await check(sender,'https://note.com/tag/ComfyUI'),null);
});

test('コンテンツ操作はクリック時のURLを送信し、次のSPA遷移では新しいURLを使う',async()=>{
 const sent=[],location={href:'https://note.com/hashtag/ComfyUI'};
 const context=vm.createContext({URL,location,chrome:{runtime:{id:'self',sendMessage:async message=>{sent.push(plain(message));return {ok:true,settings:{}};}}}});
 for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
 await context.HikikomoriNotePlatform.addCurrentTag('group1',0);location.href='https://note.com/tag/AI';await context.HikikomoriNotePlatform.selectGroup('group2');
 assert.equal(sent[0].patch.pageUrl,'https://note.com/hashtag/ComfyUI');assert.equal(sent[1].patch.pageUrl,location.href);
});
