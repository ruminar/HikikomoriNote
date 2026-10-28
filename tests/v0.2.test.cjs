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
test('左メニューでタグ管理と設定を切替。重度では設定入口とキャッチコピーだけにする',async()=>{
 const f=homeFixture({state:{...groups(['A'])}});await flush();const n=f.nodes;
 assert.match(n.get('mode').textContent,/通常モード（ひとみしりモード）/);
 assert.equal(n.get('panel-tags').hidden,false);assert.equal(n.get('nav-tags').getAttribute('aria-current'),'page');
 for(const id of ['tabs','tab-main','panel-main','quick-access','main-tags'])assert.equal(n.has(id),false);
 assert.equal(n.get('home-menu').contains(n.get('nav-settings')),true);assert.equal(n.get('home-menu').contains(n.get('following')),false);
 n.get('nav-settings').onclick();assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('panel-tags').hidden,true);
 n.get('nav-tags').onclick();n.get('tag-input').value='入力途中';n.get('tag-input').focus();
 f.changed({legacyMode:true});assert.match(n.get('mode').textContent,/重度ひきこもりモード/);
 assert.equal(n.get('nav-tags').hidden,true);assert.equal(n.get('page-links').hidden,false);assert.equal(n.get('following').hidden,true);assert.equal(n.get('profile').href,'https://note.com/ruminar');assert.equal(n.get('profile').hidden,false);
 assert.equal(n.get('panel-intro').hidden,false);assert.equal(n.get('panel-settings').hidden,true);assert.equal(n.get('panel-tags').hidden,true);
 assert.equal(n.get('tag-input').value,'入力途中');assert.equal(f.document.activeElement,n.get('nav-settings'));assert.equal(n.get('edit-tags').children.length,0);
 n.get('nav-settings').onclick();assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('panel-intro').hidden,false);
 f.changed({legacyMode:false});assert.equal(n.get('nav-tags').hidden,false);assert.equal(n.get('following').hidden,false);assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('edit-tags').children.length,1);
 f.changed({enabled:false,legacyMode:true});assert.match(n.get('mode').textContent,/拡張OFF：通常のnote/);assert.doesNotMatch(n.get('mode').textContent,/ひきこもりモード|ひとみしりモード/);
});

test('重度の初期表示はキャッチコピーだけ。設定から解除しタグ一覧を保持する',async()=>{
 const f=homeFixture({state:{legacyMode:true,...groups(['A'])}});await flush();const n=f.nodes;
 assert.equal(n.get('panel-intro').hidden,false);assert.equal(n.get('panel-settings').hidden,true);assert.equal(n.get('nav-tags').hidden,true);
 assert.equal(n.get('panel-intro').querySelector('form'),null);assert.equal(n.get('panel-intro').querySelector('p').className,'catchphrase');
 n.get('nav-settings').onclick();assert.equal(n.get('panel-settings').hidden,false);
 assert.equal(n.get('panel-intro').hidden,false);
 n.get('legacy-mode').checked=false;n.get('legacy-mode').fire('change');n.get('settings').fire('submit');await flush();
 assert.equal(n.get('panel-intro').hidden,true);
 assert.deepEqual(f.patches,[{legacyMode:false}]);assert.deepEqual(f.state.tagGroups[0].tags,['A']);assert.equal(n.get('nav-tags').hidden,false);
 f.changed({noteUserId:'other_user',enabled:false});assert.equal(n.get('profile').href,'https://note.com/other_user');assert.equal(n.get('page-links').hidden,false);
 f.changed({noteUserId:'',legacyMode:true});assert.equal(n.get('profile').getAttribute('href'),'#settings');assert.equal(n.get('profile').getAttribute('aria-disabled'),null);assert.equal(n.get('profile').hidden,false);
});

test('未設定の自分のページから設定とユーザー名欄へ移り、保存せず入力途中の文字も保持',async()=>{
 for(const state of [{noteUserId:''},{noteUserId:'',legacyMode:true},{noteUserId:'',enabled:false}]){
  const f=homeFixture({state});await flush();const n=f.nodes,link=n.get('profile');
  assert.equal(link.getAttribute('href'),'#settings');assert.equal(link.getAttribute('aria-disabled'),null);
  n.get('note-user').value='入力途中';n.get('note-user').fire('input');
  const event=link.fire('click');assert.equal(event.defaultPrevented,true);assert.equal(n.get('panel-settings').hidden,false);
  assert.equal(n.get('nav-settings').getAttribute('aria-current'),'page');assert.equal(f.document.activeElement,n.get('note-user'));
  assert.equal(n.get('note-user').value,'入力途中');assert.deepEqual(f.patches,[]);assert.deepEqual(f.moves,[]);
  f.changed({noteUserId:'ruminar'});assert.equal(link.href,'https://note.com/ruminar');assert.equal(link.fire('click').defaultPrevented,undefined);
 }
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
 assert.equal(n.get('tag-input').disabled,true);assert.equal(n.get('add-tag').disabled,true);assert.equal(n.get('edit-tags').children.length,2);
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
 assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('home-menu').hidden,false);
 assert.equal(n.get('retry').disabled,false);assert.equal(n.get('save').disabled,true);
 assert.equal(n.get('save').parentElement,n.get('retry').parentElement);assert.equal(n.get('retry').getAttribute('type'),'button');
 f.options.stateError=false;n.get('retry').onclick();await flush();
 assert.equal(n.get('save').disabled,false);assert.equal(n.get('nav-tags').hidden,false);
 assert.equal(n.get('profile').href,'https://note.com/ruminar');
});
test('上下ボタンとドラッグの移動を保存し、キーボードで左メニューを選択できる',async()=>{
 const f=homeFixture({state:{...groups(['A','B','C'])}});await flush();const n=f.nodes;
 n.get('edit-tags').children[1].children[1].onclick();await flush();assert.deepEqual(f.state.tagGroups[0].tags,['B','A','C']);
 const rows=n.get('edit-tags').children;rows[2].fire('dragstart',{dataTransfer:{setData(){}}});rows[0].fire('drop');await flush();assert.deepEqual(f.state.tagGroups[0].tags,['C','B','A']);
 const moved=n.get('edit-tags').children;moved[0].fire('dragstart',{dataTransfer:{setData(){}}});moved[2].fire('drop',{clientY:39});await flush();assert.deepEqual(f.state.tagGroups[0].tags,['B','A','C']);
 n.get('home-menu').fire('keydown',{key:'End'});assert.equal(n.get('panel-settings').hidden,false);assert.equal(f.document.activeElement,n.get('nav-settings'));
});
function uiFixture(html,actions){const doc=documentFromHtml(html);const win={matchMedia:()=>({matches:win.wide}),wide:true,getComputedStyle:()=>({display:'block'})};const context=vm.createContext({URL,console});vm.runInContext(source('src/common.js'),context);vm.runInContext(source('src/note-ui.js'),context);return {doc,win,core:context.HikikomoriNote,isLogo:context.HikikomoriNoteUi.isOfficialHeaderLogo,ui:context.HikikomoriNoteUi.create(doc,win,{settingsUrl:()=>"chrome-extension://self/home.html",...actions})};}
const sidebarHtml='<aside class="sticky w-[11.375rem]"><div><nav aria-label="急上昇"></nav></div></aside><main><article></article></main>';

const streamingLayout='<div class="min-h-screen lg:grid lg:grid-cols-[202px_minmax(0,1fr)]"><div class="py-4"></div><main id="main-content"><div class="py-4"></div></main></div>';
test('ローダーしかないSSR親へクラスを付け、後から現れる公式asideにも引き継ぐ',()=>{
 const f=uiFixture(streamingLayout),layout=f.doc.root.children[0],url='https://note.com/following',settings=f.core.readSettings({...groups()});
 assert.equal(f.doc.querySelector('aside'),null);f.ui.prepareSidebar(url);assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),true);
 assert.equal(f.doc.querySelector('main').classList.contains('hikikomori-note-navigation-root'),false);
 const aside=f.doc.createElement('aside');aside.className='sticky w-[11.375rem]';const outer=f.doc.createElement('div'),official=f.doc.createElement('div');official.className='flex flex-col gap-4';outer.append(official);aside.append(outer);layout.append(aside);
 f.ui.update(settings,url);assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),true);assert.equal(aside.children.length,1);
 const nav=f.doc.createElement('nav');nav.setAttribute('aria-label','急上昇');official.append(nav);f.ui.update(settings,url);
 assert.equal(aside.children[0].hasAttribute('data-hikikomori-note-owned'),true);assert.equal(aside.children[0].classList.contains('flex'),false);assert.equal(f.doc.querySelector('main').isConnected,true);
});

test('先行ルートのクラスはOFF・重度・対象外・親の交換・停止で片付ける',()=>{
 const f=uiFixture(streamingLayout),layout=f.doc.root.children[0],url='https://note.com/search',settings=f.core.readSettings({...groups()});
 for(const next of [{...settings,enabled:false},{...settings,legacyMode:true}]){
  f.ui.prepareSidebar(url);assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),true);f.ui.update(next,url);assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),false);
 }
 f.ui.update(settings,url);f.ui.update(settings,'https://note.com/ruminar');assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),false);
 f.ui.prepareSidebar(url);layout.remove();f.ui.prepareSidebar(url,settings);assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),false);
 f.doc.root.append(layout);f.ui.prepareSidebar(url);f.ui.stop();assert.equal(layout.classList.contains('hikikomori-note-navigation-root'),false);assert.equal(layout.classList.contains('min-h-screen'),true);
});

test('rem表記・lg:contentsと検索のlg:blockラッパーでも共通レイアウトを先行制御する',()=>{
 for(const wrapperClass of ['hidden lg:contents','hidden lg:block']) for(const path of ['/following','/hashtag/ComfyUI','/tag/ComfyUI','/search?q=%23ComfyUI&context=note','/topic/education_learning']){
  const f=uiFixture('<div class="min-h-screen lg:grid lg:grid-cols-[12.625rem_minmax(0,1fr)]"><div class="'+wrapperClass+'"><div class="py-4"></div></div><main id="main-content"><div class="py-4"></div></main></div>');
  const root=f.doc.root.children[0],wrapper=root.children[0],url='https://note.com'+path,settings=f.core.readSettings({...groups()});
  f.ui.prepareSidebar(url);assert.equal(root.classList.contains('hikikomori-note-navigation-root'),true);
  const aside=f.doc.createElement('aside');aside.className='sticky w-[11.375rem]';const outer=f.doc.createElement('div'),official=f.doc.createElement('div'),nav=f.doc.createElement('nav');official.className='flex flex-col gap-4';nav.setAttribute('aria-label','急上昇');official.append(nav);outer.append(official);aside.append(outer);wrapper.append(aside);
  f.ui.update(settings,url);assert.equal(aside.children[0].hasAttribute('data-hikikomori-note-owned'),true);assert.equal(f.doc.querySelector('main').hasAttribute('data-hikikomori-note-menu-hidden'),false);
  f.ui.update({...settings,enabled:false},url);assert.equal(root.classList.contains('hikikomori-note-navigation-root'),false);
 }
});

test('お気に入りの#検索は全検索対象でハイライトを維持し、検索語の変更で切り替える',()=>{
 const f=uiFixture(sidebarHtml),settings=f.core.readSettings({...groups(['るみなー先生','ComfyUI'])});
 const current=()=>f.doc.querySelector('aside').querySelector('[aria-current="page"]');
 f.ui.update(settings,f.core.tagUrl('るみなー先生'));assert.equal(current().textContent,'# るみなー先生');
 f.ui.update(settings,f.core.tagUrl('ComfyUI'));assert.equal(current().textContent,'# ComfyUI');
 f.ui.update(settings,'https://note.com/search?q=%23ComfyUI&context=note&sort=popular');assert.equal(current().textContent,'# ComfyUI');
 for(const context of ['note','magazine','user','circle']){
  f.ui.update(settings,`https://note.com/search?context=${context}&q=${encodeURIComponent('#るみなー先生')}`);assert.equal(current().textContent,'# るみなー先生');assert.equal(f.doc.querySelector('[data-tag-add]'),null);
 }
 for(const url of ['https://note.com/search?q=ComfyUI&context=note','https://note.com/search?q=ComfyUI&context=user','https://note.com/search?q=%23ComfyUI%20%23AI&context=note','https://note.com/search?q=%23Other&context=note']){
  f.ui.update(settings,url);assert.equal(current(),null);assert.equal(f.doc.querySelector('[data-tag-add]'),null);
 }
 f.ui.update(settings,'https://note.com/tag/ComfyUI');assert.equal(current().textContent,'# ComfyUI');
});

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

test('公式の固定作者プロフィールを追加ボタンの下へずらし、後挿入・作者なし・OFF等で復元',()=>{
 const f=authorFixture(),settings=f.core.readSettings(groups()),url='https://note.com/ruminar/n/n123';
 const container=f.doc.createElement('div');container.className='fixed top-24 left-8 max-[1124px]:hidden print:hidden';container.setAttribute('style','padding: 0');
 const profile=f.doc.createElement('div');profile.setAttribute('data-testid','side-creator-profile');profile.setAttribute('aria-hidden','false');
 const follow=f.doc.createElement('button');profile.append(follow);container.append(profile);
 f.ui.update(settings,url);f.doc.body.append(container);f.ui.update(settings,url);
 const marker='data-hikikomori-note-side-profile-offset';assert.equal(container.getAttribute(marker),'author');assert.equal(follow.isConnected,true);assert.equal(profile.parentElement,container);assert.equal(container.getAttribute('style'),'padding: 0');
 f.doc.getElementById('author-header').remove();f.ui.update(settings,url);assert.equal(container.getAttribute(marker),'following');
 for(const patch of [{enabled:false},{legacyMode:true}]){f.ui.update({...settings,...patch},url);assert.equal(container.hasAttribute(marker),false);f.ui.update(settings,url);}
 f.win.wide=false;f.ui.update(settings,url);assert.equal(container.hasAttribute(marker),false);f.win.wide=true;
 f.ui.update(settings,url);f.ui.update(settings,'https://note.com/search');assert.equal(container.hasAttribute(marker),false);
 f.ui.update(settings,url);container.remove();f.ui.update(settings,url);assert.equal(container.hasAttribute(marker),false);
 f.doc.body.append(container);f.ui.update(settings,url);f.ui.stop();assert.equal(container.hasAttribute(marker),false);assert.equal(container.getAttribute('style'),'padding: 0');
});

test('公式プロフィールでも本文内や未確認の固定枠は移動しない',()=>{
 const f=authorFixture(),settings=f.core.readSettings(groups()),url='https://note.com/ruminar/n/n123';
 for(const [parent,classes] of [[f.doc.getElementById('note-body'),'fixed top-24 left-8'],[f.doc.body,'fixed top-24 right-8']]){
  const container=f.doc.createElement('div');container.className=classes;const profile=f.doc.createElement('div');profile.setAttribute('data-testid','side-creator-profile');container.append(profile);parent.append(container);
  f.ui.update(settings,url);assert.equal(container.hasAttribute('data-hikikomori-note-side-profile-offset'),false);
 }
});

test('プレビューURLはnoteの正しい記事パスだけを対象にし、通常記事の判定を広げない',()=>{
 const {core}=fixture();
 for(const url of ['https://note.com/preview/n123','https://note.com/preview/n123/?prev_access_key=test-only#body']){
  assert.equal(core.isPreviewArticle(url),true);assert.equal(core.isArticle(url),false);
 }
 for(const url of ['https://other.test/preview/n123','http://note.com/preview/n123','https://note.com/preview','https://note.com/preview/n123/edit','https://note.com/preview/not-an-id','broken'])assert.equal(core.isPreviewArticle(url),false);
});

test('プレビューの作者を本文外のアバターと名前から特定し、動的な挿入・切り替えに対応',()=>{
 const f=authorFixture(),settings=f.core.readSettings(groups()),url='https://note.com/preview/n123?prev_access_key=test-only';
 const author=()=>f.doc.querySelector('[class="hikikomori-note-article-author"]');
 f.ui.update(settings,url);const first=author();assert.equal(first.href,'https://note.com/ruminar');
 assert.equal(first.textContent,'るみなー先生');assert.equal(f.doc.querySelector('[class="hikikomori-note-article-following"]').href,'https://note.com/following');
 f.ui.update(settings,url);assert.equal(author(),first);
 const header=f.doc.getElementById('author-header');header.remove();f.ui.update(settings,url);assert.equal(author(),null);
 f.doc.getElementById('note-article').prepend(header);
 for(const a of header.querySelectorAll('a[href]'))a.href='https://note.com/other_user';
 f.doc.getElementById('author-name').textContent='別の作者';f.ui.update(settings,'https://note.com/preview/n456');
 assert.equal(author().href,'https://note.com/other_user');assert.equal(author().textContent,'別の作者');
 f.doc.getElementById('note-body').append(header);f.ui.update(settings,url);assert.equal(author(),null);
});

test('プレビューも狭幅・余白不足・重度・OFF・離脱で固定リンクを除去し、不正な作者リンクは使わない',()=>{
 const f=authorFixture(),settings=f.core.readSettings(groups()),url='https://note.com/preview/n123';
 const following=()=>f.doc.querySelector('[class="hikikomori-note-article-following"]');
 const author=()=>f.doc.querySelector('[class="hikikomori-note-article-author"]');
 for(const patch of [{enabled:false},{legacyMode:true}]){
  f.ui.update(settings,url);assert.ok(author());f.ui.update({...settings,...patch},url);assert.equal(author(),null);assert.equal(following(),null);
 }
 f.win.wide=false;f.ui.update(settings,url);assert.equal(following(),null);f.win.wide=true;
 const article=f.doc.getElementById('note-article');article.getBoundingClientRect=()=>({left:200,width:620});f.ui.update(settings,url);assert.equal(following(),null);
 article.getBoundingClientRect=()=>({left:270,width:620});
 for(const bad of ['https://other.test/ruminar','https://note.com/search','https://note.com/ruminar/n/n999']){
  for(const a of f.doc.getElementById('author-header').querySelectorAll('a[href]'))a.href=bad;
  f.ui.update(settings,url);assert.ok(following());assert.equal(author(),null);
 }
 f.ui.update(settings,'https://note.com/search');assert.equal(following(),null);
 f.ui.update(settings,url);f.ui.stop();assert.equal(following(),null);
});

const logoHeaderHtml='<header data-header-state="navbar"><div><a href="/" target="_self"><svg role="img" aria-label="note"></svg></a></div></header>';
test('設定ONで公式ロゴ横に歯車を追加。重度・左メニューなしでも使え、OFFで撤去',()=>{
 for(const legacyMode of [false,true]){
  const f=uiFixture(logoHeaderHtml+sidebarHtml),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true,legacyMode});
  f.ui.update(settings,'https://note.com/search');const parent=f.doc.querySelector('header').children[0],gear=parent.children[1];
  assert.equal(gear.getAttribute('aria-label'),'設定画面を表示');assert.equal(gear.href,'chrome-extension://self/home.html');assert.ok(gear.querySelector('svg'));assert.equal(parent.children[0].href,'https://note.com/');
  assert.equal(parent.hasAttribute('data-hikikomori-note-logo-settings-layout'),true);
  const aside=f.doc.querySelector('aside');assert.equal(aside.querySelector('[class="hikikomori-note-navigation-settings"]'),null);
  f.ui.update(settings,'https://note.com/settings');assert.equal(gear.isConnected,true);assert.equal(parent.children.length,2);
  f.ui.update({...settings,noteLogoBrowserBack:false},'https://note.com/settings');assert.equal(gear.isConnected,false);assert.equal(parent.hasAttribute('data-hikikomori-note-logo-settings-layout'),false);
  f.ui.update(settings,'https://note.com/settings');f.ui.update({...settings,enabled:false},'https://note.com/settings');assert.equal(parent.children.length,1);
 }
});

test('ダッシュボード・設定の本体と配下では管理ヘッダーロゴを認識し歯車を表示',()=>{
 const logo='<a href="/"><svg role="img" aria-label="note"></svg></a>';
 for(const html of ['<header>'+logo+'</header>','<header><div>'+logo+'</div></header>']){
  for(const url of ['https://note.com/dashboard','https://note.com/dashboard/','https://note.com/dashboard/suggestions','https://note.com/dashboard/sales/report?year=2026','https://note.com/settings','https://note.com/settings/','https://note.com/settings/account','https://note.com/settings/account/notifications/','https://note.com/user_verification','https://note.com/user_verification/?test=1']){
   const f=uiFixture(html),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true,legacyMode:true});
   const anchor=f.doc.querySelector('a');assert.equal(f.isLogo(anchor,url),true);
   f.ui.update(settings,url);const gear=f.doc.querySelector('[class="hikikomori-note-header-settings"]');assert.ok(gear);assert.equal(gear.href,'chrome-extension://self/home.html');
   f.ui.update(settings,url);assert.equal(f.doc.querySelectorAll('[class="hikikomori-note-header-settings"]').length,1);
   f.ui.update({...settings,noteLogoBrowserBack:false},url);assert.equal(gear.isConnected,false);
   f.ui.update(settings,url);f.ui.update({...settings,enabled:false},url);assert.equal(f.doc.querySelector('[class="hikikomori-note-header-settings"]'),null);
   f.ui.update(settings,url);f.ui.update(settings,'https://note.com/search');assert.equal(f.doc.querySelector('[class="hikikomori-note-header-settings"]'),null);
  }
 }
});

test('管理画面ヘッダーの追加対応は対象パスと公式ロゴだけで、本文・外部・類似パスを除外',()=>{
 const html='<header><a href="/"><svg role="img" aria-label="note"></svg></a></header>';
 for(const url of ['https://other.test/settings/account','https://note.com/dashboarding','https://note.com/settings-other/account','https://note.com/user_verification_other','https://note.com/user_verification/other','https://note.com/login','https://note.com/search']){
  const f=uiFixture(html),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true});
  assert.equal(f.isLogo(f.doc.querySelector('a'),url),false);f.ui.update(settings,url);assert.equal(f.doc.querySelector('[class="hikikomori-note-header-settings"]'),null);
 }
 for(const content of ['<article>'+html+'</article>',html.replace('aria-label="note"','aria-label="other"'),html.replace('href="/"','href="https://other.test/"')]){
  const f=uiFixture(content);assert.equal(f.isLogo(f.doc.querySelector('a'),'https://note.com/settings/account'),false);
 }
});

test('ロゴ戻り先がない・API未対応なら矢印用属性を付け、履歴・設定・DOM変更で解除',()=>{
 const marker='data-hikikomori-note-logo-back-unavailable';
 for(const [html,url] of [[logoHeaderHtml,'https://note.com/search'],['<header><a href="/"><svg role="img" aria-label="note"></svg></a></header>','https://note.com/settings/account']]){
  const f=uiFixture(html),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true});const logo=f.doc.querySelector('a');
  f.ui.update(settings,url);assert.equal(logo.hasAttribute(marker),true);
  const gear=f.doc.querySelector('[class="hikikomori-note-header-settings"]');assert.equal(gear.hasAttribute(marker),false);
  f.win.navigation={canGoBack:true,back(){}};f.ui.update(settings,url);assert.equal(logo.hasAttribute(marker),false);
  f.win.navigation.canGoBack=false;f.ui.update(settings,url);assert.equal(logo.hasAttribute(marker),true);
  f.ui.update({...settings,legacyMode:true},url);assert.equal(logo.hasAttribute(marker),true);
  for(const patch of [{enabled:false},{noteLogoBrowserBack:false}]){
   f.ui.update({...settings,...patch},url);assert.equal(logo.hasAttribute(marker),false);f.ui.update(settings,url);
  }
  logo.remove();f.ui.update(settings,url);assert.equal(logo.hasAttribute(marker),false);
  f.doc.querySelector('header').append(logo);f.ui.update(settings,url);assert.equal(logo.hasAttribute(marker),true);
  f.ui.stop();assert.equal(logo.hasAttribute(marker),false);
 }
});

test('記事のTL・作者に設定リンクを追加せず、ロゴ設定ONでも固定位置をずらさない',()=>{
 const f=authorFixture(),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true}),url='https://note.com/ruminar/n/n123';
 f.ui.update(settings,url);assert.equal(f.doc.querySelector('[class="hikikomori-note-article-settings"]'),null);
 for(const name of ['following','author'])assert.equal(f.doc.querySelector(`[class="hikikomori-note-article-${name}"]`).hasAttribute('data-hikikomori-note-settings-offset'),false);
 assert.equal(f.doc.querySelectorAll('[data-hikikomori-note-owned]').length,2);
});

test('公式ロゴが差し替われば歯車も付け直し、未確認のロゴ親構造には挿入しない',()=>{
 const f=uiFixture(logoHeaderHtml),settings=f.core.readSettings({...groups(),noteLogoBrowserBack:true});f.ui.update(settings,'https://note.com/search');
 const parent=f.doc.querySelector('header').children[0],logo=parent.children[0],oldGear=parent.children[1];
 logo.remove();const replacement=f.doc.createElement('a');replacement.href='/';const svg=f.doc.createElement('svg');svg.setAttribute('role','img');svg.setAttribute('aria-label','note');replacement.append(svg);parent.append(replacement);
 f.ui.update(settings,'https://note.com/search');assert.equal(oldGear.isConnected,false);assert.equal(parent.children.length,2);assert.equal(parent.children[0],replacement);
 f.ui.stop();assert.equal(parent.children.length,1);assert.equal(parent.hasAttribute('data-hikikomori-note-logo-settings-layout'),false);
 const unknown=uiFixture(logoHeaderHtml);unknown.doc.querySelector('header').children[0].append(unknown.doc.createElement('button'));
 unknown.ui.update(unknown.core.readSettings({...groups(),noteLogoBrowserBack:true}),'https://note.com/search');assert.equal(unknown.doc.querySelector('[class="hikikomori-note-header-settings"]'),null);
});

test('専用ホームの左メニューで設定を開き、#settingsは重度でも設定を直接表示する',async()=>{
 const f=homeFixture();await flush();assert.equal(f.nodes.get('panel-tags').hidden,false);
 f.nodes.get('nav-settings').onclick();assert.equal(f.nodes.get('panel-settings').hidden,false);assert.equal(f.nodes.get('nav-settings').getAttribute('aria-current'),'page');
 for(const legacyMode of [false,true]){
  const direct=homeFixture({hash:'#settings',state:{legacyMode}});await flush();assert.equal(direct.nodes.get('panel-settings').hidden,false);assert.equal(direct.nodes.get('panel-tags').hidden,true);assert.equal(direct.nodes.get('panel-intro').hidden,!legacyMode);
 }
});

test('ロゴ戻る設定は初期OFF・保存再起動と他タブ同期。失敗時は従来値を維持',async()=>{
 const f=homeFixture();await flush();const input=f.nodes.get('note-logo-browser-back');assert.equal(input.checked,false);
 input.checked=true;input.fire('change');f.nodes.get('settings').fire('submit');await flush();assert.equal(f.state.noteLogoBrowserBack,true);
 f.changed({noteLogoBrowserBack:false});assert.equal(input.checked,false);
 const saved=fixture();await saved.controller.save({noteLogoBrowserBack:true});assert.equal((await saved.restart().getState()).noteLogoBrowserBack,true);
 saved.options.fail=true;await assert.rejects(saved.controller.save({noteLogoBrowserBack:false}));assert.equal(saved.stored.noteLogoBrowserBack,true);
 await assert.rejects(saved.controller.save({confirmNoteLogoClick:true}));
});

test('専用ホームの戻るボタンは自分のページの上。通常・重度・OFFでも設定保存なしに戻る',async()=>{
 for(const state of [{},{legacyMode:true},{enabled:false}]){
  const f=homeFixture({state});await flush();const links=f.nodes.get('page-links');
  assert.equal(links.hidden,false);assert.equal(links.children[0],f.nodes.get('previous-page'));assert.equal(links.children[1],f.nodes.get('profile'));
  assert.equal(f.nodes.get('previous-page').getAttribute('type'),'button');f.nodes.get('previous-page').onclick();
  assert.deepEqual(f.moves,['back']);assert.deepEqual(f.patches,[]);
 }
});

test('専用ホーム用の戻るAPIはオリジン判定なしにhistory.backを1回呼ぶ',()=>{
 let calls=0;const context=vm.createContext({URL,chrome:{runtime:{id:'self'}},history:{back(){calls++;}},navigation:{get canGoBack(){assert.fail('オリジン判定しない');}}});
 for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
 context.HikikomoriNotePlatform.goBackUnrestricted();assert.equal(calls,1);
});

test('Navigation APIで同一オリジンへ戻れる場合だけbackし、完了まで成功扱いにしない',async()=>{
 let calls=0,finish;const navigation={canGoBack:true,back(){calls++;return {finished:new Promise(resolve=>{finish=resolve;}),committed:Promise.resolve()};}};
 const context=vm.createContext({URL,chrome:{runtime:{id:'self'}},navigation,history:{back(){assert.fail('history.backは禁止');}}});
 for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
 let done=false;const result=context.HikikomoriNotePlatform.goBack().then(value=>{done=true;return value;});assert.equal(calls,1);await flush();assert.equal(done,false);finish();assert.equal(await result,true);
});

test('Navigation APIなし・外部直前履歴・同期例外・完了失敗はfalse。履歴URLを参照しない',async()=>{
 for(const navigation of [undefined,{canGoBack:false,back(){assert.fail('外部へ戻さない');}},{canGoBack:true},{get canGoBack(){throw Error('unsupported');}},{canGoBack:true,back(){throw Error('failed');}},{canGoBack:true,back(){return {committed:Promise.reject(Error('failed')),finished:Promise.reject(Error('failed'))};}}]){
  const context=vm.createContext({URL,chrome:{runtime:{id:'self'}},navigation,history:{back(){assert.fail('history.backは禁止');}}});
  for(const file of ['src/common.js','src/platform/browser-api.js'])vm.runInContext(source(file),context);
  assert.equal(await context.HikikomoriNotePlatform.goBack(),false);
 }
});

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

const membershipLockPath='M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2Z';
function membershipFixture(){
 const f=paidFixture();f.doc.querySelector('span').remove();
 const svg=f.doc.createElement('svg'),path=f.doc.createElement('path');path.setAttribute('d',membershipLockPath);svg.append(path);f.doc.querySelector('h3').append(svg);
 return {f,svg,path,card:f.doc.root.children[0]};
}
test('価格のない鍵付きメンバーシップ記事も両モードで余白ごと隠し、購入済み・OFF・設定解除で復元',()=>{
 for(const legacyMode of [false,true]){
  const {f,card}=membershipFixture(),settings=f.core.readSettings({...groups(),hidePaidArticles:true,legacyMode});
  const wrapper=f.doc.createElement('div');wrapper.className='contents';card.remove();wrapper.append(card);f.doc.root.append(wrapper);
  const url='https://note.com/search?q=%23ComfyUI&context=note&mode=search&sort=new';
  f.ui.update({...settings,hidePaidArticles:false},url);assert.equal(wrapper.hasAttribute(paidMarker),false);
  f.ui.update(settings,url);assert.equal(wrapper.hasAttribute(paidMarker),true);assert.equal(card.hasAttribute(paidMarker),false);
  f.ui.update(settings,'https://note.com/notes/purchased?mode=new');assert.equal(wrapper.hasAttribute(paidMarker),false);
  f.ui.update(settings,url);f.ui.update({...settings,enabled:false},url);assert.equal(wrapper.hasAttribute(paidMarker),false);
  f.ui.update(settings,url);f.ui.stop();assert.equal(wrapper.hasAttribute(paidMarker),false);
 }
});
test('鍵の後挿入・除去を再評価し、タイトル以外の鍵・絵文字・未知のアイコンは隠さない',()=>{
 const {f,svg,path,card}=membershipFixture(),settings=f.core.readSettings({...groups(),hidePaidArticles:true}),url='https://note.com/search';
 svg.remove();f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),false);
 f.doc.querySelector('h3').append(svg);f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),true);
 svg.remove();card.append(svg);f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),false);
 f.doc.querySelector('h3').append(svg);path.setAttribute('d','unknown');f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),false);
 svg.remove();f.doc.querySelector('h3').textContent='🔒タイトル';f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),false);
 const bad=membershipFixture();bad.f.doc.querySelector('a').href='https://other.test/article';bad.f.ui.update(settings,url);assert.equal(bad.card.hasAttribute(paidMarker),false);
 const body=membershipFixture(),article=body.f.doc.createElement('article');body.card.remove();article.append(body.card);body.f.doc.root.append(article);body.f.ui.update(settings,url);assert.equal(body.card.hasAttribute(paidMarker),false);
});

test('割引価格の¥300〜・全角波線・入れ子の通貨記号も判定し、購入済み一覧と解除では復元',()=>{
 for(const amount of ['300〜','300～','1,200〜',' 300 〜 ']){
  const f=paidFixture(),card=f.doc.root.children[0],price=f.doc.querySelector('span'),settings=f.core.readSettings({...groups(),hidePaidArticles:true});
  const symbol=f.doc.createElement('span');symbol.textContent='¥';const value=f.doc.createElement('span');value.textContent=amount;price.replaceChildren(symbol,value);
  const badge=f.doc.createElement('span');badge.textContent='割引あり';price.parentElement.append(badge);
  const url='https://note.com/search?q=%23ComfyUI&context=note&mode=search&sort=new';
  f.ui.update(settings,url);assert.equal(card.hasAttribute(paidMarker),true);
  f.ui.update(settings,'https://note.com/notes/purchased');assert.equal(card.hasAttribute(paidMarker),false);
  f.ui.update(settings,url);f.ui.update({...settings,hidePaidArticles:false},url);assert.equal(card.hasAttribute(paidMarker),false);
 }
});

test('無料・価格不明・本文中の価格・商品・不明なカード構造を隠さない',()=>{
 for(const value of ['無料','300円','¥0','¥0〜','¥〜','¥300〜月額','¥300から','¥300 月額','おすすめ商品 ¥300']){
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
  await f.controller.save({noteLogoBrowserBack:true});for(const key of ['tagSchemaVersion','tagGroups','selectedTagGroupId','groupSelectionRevision','tagGroupsRevision'])assert.deepEqual(f.stored[key],initial[key]);
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

const tipHtml='<div class="mx-4 mt-6 mb-4 empty:hidden"><div><section class="flex flex-col bg-surface-quaternary"><h2></h2><div><span></span></div><button type="button" data-name="Button"><span></span></button></section></div></div>';
function tipFixture(){const f=uiFixture(tipHtml);f.doc.querySelector('h2').textContent='いいなと思ったら応援しよう！';f.doc.querySelector('button').textContent='チップで応援する';return f;}
test('有料記事非表示でチップ枠も両モードで余白ごと隠し、設定解除・OFF・画面移動・停止で復元',()=>{
 for(const legacyMode of [false,true]){
  const f=tipFixture(),container=f.doc.root.children[0],marker='data-hikikomori-note-tip-hidden',url='https://note.com/ichigo_mon/n/n123';
  const settings=f.core.readSettings({...groups(),hidePaidArticles:true,legacyMode});
  f.ui.update({...settings,hidePaidArticles:false},url);assert.equal(container.hasAttribute(marker),false);
  f.ui.update(settings,url);assert.equal(container.hasAttribute(marker),true);
  f.ui.update({...settings,enabled:false},url);assert.equal(container.hasAttribute(marker),false);
  f.ui.update(settings,url);f.ui.update(settings,'https://note.com/search');assert.equal(container.hasAttribute(marker),false);
  f.ui.update(settings,url);f.ui.update(settings,'https://note.com/notes/purchased');assert.equal(container.hasAttribute(marker),false);
  f.ui.update(settings,'https://note.com/preview/n123');assert.equal(container.hasAttribute(marker),true);
  f.ui.stop();assert.equal(container.hasAttribute(marker),false);assert.equal(f.doc.querySelector('button').textContent,'チップで応援する');
 }
});
test('チップ枠の後挿入・構造変更に追従し、本文や不明な枠・他のボタンを誤って隠さない',()=>{
 const f=tipFixture(),container=f.doc.root.children[0],marker='data-hikikomori-note-tip-hidden',url='https://note.com/ruminar/n/n123',settings=f.core.readSettings({...groups(),hidePaidArticles:true});
 container.remove();f.ui.update(settings,url);f.doc.root.append(container);f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(container.hasAttribute(marker),true);
 f.doc.querySelector('button').textContent='別のボタン';f.ui.invalidatePaidCards();f.ui.update(settings,url);assert.equal(container.hasAttribute(marker),false);
 for(const change of [f=>f.doc.querySelector('h2').textContent='記事の見出し',f=>f.doc.querySelector('section').className='unknown',f=>{const body=f.doc.createElement('div');body.setAttribute('id','note-body');const wrapper=f.doc.root.children[0];wrapper.remove();body.append(wrapper);f.doc.root.append(body);}]){
  const other=tipFixture(),wrapper=other.doc.root.children[0];change(other);other.ui.update(settings,url);assert.equal(wrapper.hasAttribute(marker),false);assert.equal(other.doc.querySelector('section').hasAttribute(marker),false);
 }
});

test('おすすめが未挿入でも記事の親へ先行クラスを付け、OFF・離脱・親の差し替え・停止で除去',()=>{
 const f=uiFixture('<div id="article-root"><article id="note-article"><div id="note-body"></div></article></div>');
 const settings=f.core.readSettings({...groups(),hideArticleRecommendations:true}),url='https://note.com/ruminar/n/n123',root=f.doc.getElementById('article-root'),marker='hikikomori-note-recommendations-root';
 f.ui.update(settings,url);assert.equal(root.classList.contains(marker),true);assert.equal(f.doc.getElementById('note-body').classList.contains(marker),false);
 f.ui.update({...settings,legacyMode:true},url);assert.equal(root.classList.contains(marker),true);
 for(const patch of [{enabled:false},{hideArticleRecommendations:false}]){f.ui.update({...settings,...patch},url);assert.equal(root.classList.contains(marker),false);f.ui.update(settings,url);}
 f.ui.update(settings,'https://note.com/search');assert.equal(root.classList.contains(marker),false);f.ui.update(settings,url);
 const next=f.doc.createElement('div');next.append(f.doc.getElementById('note-article'));f.doc.root.append(next);f.ui.update(settings,url);assert.equal(root.classList.contains(marker),false);assert.equal(next.classList.contains(marker),true);
 f.ui.stop();assert.equal(next.classList.contains(marker),false);
});
test('ラベルなしの新しいおすすめasideも隠し、本文・コメントや未知のasideは維持',()=>{
 const f=uiFixture('<div class="pt-6"><div><h2></h2></div><aside class="p-8" aria-busy="true"></aside></div>');
 const section=f.doc.root.children[0],heading=f.doc.querySelector('h2'),aside=f.doc.querySelector('aside'),settings=f.core.readSettings({...groups(),hideArticleRecommendations:true}),url='https://note.com/ruminar/n/n123';
 heading.textContent='あなたへのおすすめ';f.ui.update(settings,url);assert.equal(section.hasAttribute(recommendationMarker),true);
 aside.setAttribute('aria-busy','false');f.ui.update(settings,url);assert.equal(section.hasAttribute(recommendationMarker),true);
 aside.className='unknown';f.ui.update(settings,url);assert.equal(section.hasAttribute(recommendationMarker),false);
 heading.textContent='コメント';aside.className='p-8';f.ui.update(settings,url);assert.equal(section.hasAttribute(recommendationMarker),false);
});
