"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const homeFixture=require('./helpers/home.cjs');
const {documentFromHtml}=require('./helpers/dom.cjs');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial={},options={}) {
 let stored=initial,rules=[],writes=0;
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
 assert.equal(core.tagUrl('a/b?# x'),'https://note.com/tag/a%2Fb%3F%23%20x?mode=new');
});
test('旧設定を移行し、タグ・モードがない場合もユーザー名とOFFを維持',async()=>{
 const f=fixture({enabled:false,noteUserId:'ruminar',dashboardDisabled:true});
 const settings=await f.controller.getState();
 assert.equal(settings.legacyMode,false);assert.deepEqual(plain(settings.favoriteTags),[]);assert.equal(settings.enabled,false);assert.equal(settings.dashboardDisabled,true);
 assert.equal(f.writes,0);
});
test('異なる2タブの追加と通常設定保存を直列化し、11件以上も保持',async()=>{
 const f=fixture({noteUserId:'ruminar'});
 await Promise.all([...Array.from({length:15},(_,i)=>f.controller.tag({type:'ADD_TAG',tag:`tag${i}`})),f.controller.save({dashboardDisabled:true}),f.controller.save({enabled:false})]);
 assert.equal(f.stored.favoriteTags.length,15);assert.equal(f.stored.dashboardDisabled,true);assert.equal(f.stored.enabled,false);assert.equal(f.stored.noteUserId,'ruminar');
});
test('同じタグの同時追加は1件だけ保存し、完全一致だけ重複とする',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.controller.tag({type:'ADD_TAG',tag:'AI'}),f.controller.tag({type:'ADD_TAG',tag:'AI'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONFLICT');
 await f.controller.tag({type:'ADD_TAG',tag:'ＡＩ'});await f.controller.tag({type:'ADD_TAG',tag:'ai'});
 assert.deepEqual(f.stored.favoriteTags,['AI','ＡＩ','ai']);
});
test('移動はタグ名・移動先を最新配列へ適用し、移動先削除の競合で保存しない',async()=>{
 const f=fixture({favoriteTags:['A','B','C']});
 await f.controller.tag({type:'REMOVE_TAG',tag:'B'});
 await assert.rejects(f.controller.tag({type:'MOVE_TAG',tag:'A',beforeTag:'B'}),{code:'CONFLICT'});
 assert.deepEqual(f.stored.favoriteTags,['A','C']);assert.equal(f.writes,1);
 await f.controller.tag({type:'MOVE_TAG',tag:'A',beforeTag:null});assert.deepEqual(f.stored.favoriteTags,['C','A']);
 await f.controller.tag({type:'MOVE_TAG',tag:'A',beforeTag:'C'});assert.deepEqual(f.stored.favoriteTags,['A','C']);
});
test('不正保存値は正常な項目を残して報告し、他設定の保存でも元データを消さない',async()=>{
 for(const tags of [['A',null,'A','','B'],{broken:true}]) {
  const f=fixture({favoriteTags:tags,noteUserId:'ruminar'});const settings=await f.controller.getState();
  assert.ok(settings.tagWarning);assert.deepEqual(plain(settings.favoriteTags),Array.isArray(tags)?['A','B']:[]);
  await assert.rejects(f.controller.tag({type:'ADD_TAG',tag:'C'}),{code:'INVALID_TAGS'});
  await f.controller.save({legacyMode:true});assert.deepEqual(f.stored.favoriteTags,tags);assert.equal(f.stored.noteUserId,'ruminar');
 }
});
test('配列の一括保存・不正なモード型・未知の操作を受け付けない',async()=>{
 const f=fixture();
 for(const patch of [{favoriteTags:['A']},{legacyMode:'true'}])await assert.rejects(f.controller.save(patch));
 for(const operation of [{type:'BOGUS',tag:'A'},{type:'ADD_TAG',tag:null},{type:'MOVE_TAG',tag:'A',index:2}])await assert.rejects(f.controller.tag(operation));
 assert.equal(f.writes,0);
});
test('モード変更とタグ操作は同じキュー。先の保存を保持し後のタグ操作を拒否',async()=>{
 const f=fixture({favoriteTags:['A']});
 const results=await Promise.allSettled([f.controller.tag({type:'ADD_TAG',tag:'B'}),f.controller.save({legacyMode:true}),f.controller.tag({type:'ADD_TAG',tag:'C'})]);
 assert.equal(results[2].reason.code,'LEGACY_MODE');assert.deepEqual(f.stored.favoriteTags,['A','B']);
 await f.controller.save({enabled:false});assert.equal(f.stored.legacyMode,true);assert.equal(f.rules.length,0);
 await f.controller.save({enabled:true,dashboardDisabled:true});assert.equal(f.stored.legacyMode,true);assert.equal(f.rules.length,4);
 await f.controller.save({legacyMode:false});assert.deepEqual(f.stored.favoriteTags,['A','B']);
});
test('保存失敗ではタグ・モードを確定せず、背景再起動後は保存状態から再開',async()=>{
 const f=fixture({favoriteTags:['A']},{fail:true});
 await assert.rejects(f.controller.tag({type:'ADD_TAG',tag:'B'}));await assert.rejects(f.controller.save({legacyMode:true}));
 assert.deepEqual(f.stored,{favoriteTags:['A']});f.options.fail=false;
 await f.restart().tag({type:'ADD_TAG',tag:'C'});assert.deepEqual(f.stored.favoriteTags,['A','C']);
});
test('通常の3タブ、重度モードの設定先頭、自分のページとキャッチコピーの切替',async()=>{
 const f=homeFixture({state:{favoriteTags:['A']}});await flush();const n=f.nodes;
 assert.equal(n.get('panel-main').hidden,false);assert.equal(n.get('quick-access').parentElement,n.get('quick-slot'));
 assert.equal(n.get('panel-main').contains(n.get('quick-access')),true);assert.equal(n.get('profile').textContent,'ruminarのページ');
 assert.equal(source('home.html').includes('フォロー中のTL'),true);assert.equal(f.document.querySelector('h2'),null);assert.equal(n.has('user-status'),false);
 assert.equal(n.get('legacy-intro').hidden,true);
 n.get('tab-tags').onclick();n.get('tag-input').value='入力途中';n.get('tag-input').focus();
 f.changed({legacyMode:true});
 assert.equal(n.get('tab-main').hidden,true);assert.equal(n.get('tab-tags').hidden,true);assert.equal(n.get('panel-settings').hidden,false);
 assert.equal(n.get('quick-access').parentElement,n.get('legacy-quick-slot'));assert.equal(n.get('following').hidden,true);assert.equal(n.get('legacy-intro').hidden,false);
 assert.equal(n.get('profile').href,'https://note.com/ruminar');assert.equal(n.get('tag-input').value,'入力途中');assert.equal(f.document.activeElement,n.get('tab-settings'));
 assert.equal(n.get('main-tags').children.length,0);assert.equal(n.get('edit-tags').children.length,0);
 f.changed({legacyMode:false});assert.equal(n.get('tab-main').hidden,false);assert.equal(n.get('following').hidden,false);assert.equal(n.get('legacy-intro').hidden,true);assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('main-tags').children.length,1);
});
test('重度モードで新規表示してもメインを表示せず、解除操作は同じ設定保存を使う',async()=>{
 const f=homeFixture({state:{legacyMode:true,favoriteTags:['A']}});await flush();const n=f.nodes;
 assert.equal(n.get('panel-main').hidden,true);assert.equal(n.get('panel-settings').hidden,false);
 n.get('legacy-mode').checked=false;n.get('legacy-mode').fire('change');n.get('settings').fire('submit');await flush();
 assert.deepEqual(f.patches,[{legacyMode:false}]);assert.deepEqual(f.state.favoriteTags,['A']);
});
test('別タブの更新は編集中タグと既存設定の未保存入力を消さない',async()=>{
 const f=homeFixture();await flush();const n=f.nodes;
 n.get('tag-input').value='Comfy';n.get('note-user').value='draft_user';n.get('note-user').fire('input');
 f.changed({favoriteTags:['A'],noteUserId:'remote_user',dashboardDisabled:true});
 assert.equal(n.get('tag-input').value,'Comfy');assert.equal(n.get('note-user').value,'draft_user');assert.equal(n.get('dashboard-disabled').checked,true);
 n.get('settings').fire('submit');await flush();assert.deepEqual(f.patches,[{noteUserId:'draft_user'}]);assert.equal(f.state.dashboardDisabled,true);
});
test('背景処理からの破損データ診断を表示し、正常項目は残すがタグ編集は停止',async()=>{
 const f=homeFixture({state:{favoriteTags:['A',null,'B']}});await flush();const n=f.nodes;
 assert.equal(n.get('tag-warning').hidden,false);assert.match(n.get('tag-warning').textContent,/異常/);
 assert.equal(n.get('tag-input').disabled,true);assert.equal(n.get('add-tag').disabled,true);assert.equal(n.get('main-tags').children.length,2);
 assert.equal(n.get('edit-tags').children[0].draggable,false);assert.equal(n.get('edit-tags').children[0].children.at(-1).disabled,true);
 n.get('legacy-mode').checked=true;n.get('legacy-mode').fire('change');n.get('settings').fire('submit');await flush();
 assert.deepEqual(f.state.favoriteTags,['A',null,'B']);assert.equal(n.get('tag-warning').hidden,false);
});
test('追加保存中に入力を変えても消さず、保存中の別タグ操作を受け付けない',async()=>{
 let resolve;const f=homeFixture({saveGate:new Promise(done=>{resolve=done;})});await flush();const n=f.nodes;
 n.get('tag-input').value='A';n.get('tag-form').fire('submit');n.get('tag-input').value='B';n.get('tag-form').fire('submit');
 assert.equal(n.get('add-tag').disabled,true);resolve();await flush();assert.deepEqual(f.state.favoriteTags,['A']);assert.equal(n.get('tag-input').value,'B');
});
test('結果未確認時はタグ操作を止め、再取得するまで自動再送も成功表示もしない',async()=>{
 const f=homeFixture({unconfirmed:true});await flush();const n=f.nodes;
 n.get('tag-input').value='A';n.get('tag-form').fire('submit');await flush();
 assert.equal(n.get('add-tag').disabled,true);assert.match(n.get('status').textContent,/未確認/);assert.equal(n.get('tag-input').value,'A');assert.deepEqual(f.state.favoriteTags,[]);
 assert.equal(n.get('panel-settings').hidden,false);assert.equal(n.get('settings').contains(n.get('retry')),true);
 f.options.unconfirmed=false;n.get('retry').onclick();await flush();assert.equal(n.get('add-tag').disabled,false);assert.deepEqual(f.state.favoriteTags,[]);
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
 const f=homeFixture({state:{favoriteTags:['A','B','C']}});await flush();const n=f.nodes;
 n.get('edit-tags').children[1].children[1].onclick();await flush();assert.deepEqual(f.state.favoriteTags,['B','A','C']);
 const rows=n.get('edit-tags').children;rows[2].fire('dragstart',{dataTransfer:{setData(){}}});rows[0].fire('drop');await flush();assert.deepEqual(f.state.favoriteTags,['C','B','A']);
 const moved=n.get('edit-tags').children;moved[0].fire('dragstart',{dataTransfer:{setData(){}}});moved[2].fire('drop',{clientY:39});await flush();assert.deepEqual(f.state.favoriteTags,['B','A','C']);
 n.get('tabs').fire('keydown',{key:'End'});assert.equal(n.get('panel-settings').hidden,false);assert.equal(f.document.activeElement,n.get('tab-settings'));
});
function uiFixture(html){const doc=documentFromHtml(html);const win={matchMedia:()=>({matches:win.wide}),wide:true,getComputedStyle:()=>({display:'block'})};const context=vm.createContext({URL,console});vm.runInContext(source('src/common.js'),context);vm.runInContext(source('src/note-ui.js'),context);return {doc,win,core:context.HikikomoriNote,ui:context.HikikomoriNoteUi.create(doc,win)};}
const sidebarHtml='<aside class="sticky w-[11.375rem]"><div><nav aria-label="急上昇"></nav></div></aside><main><article></article></main>';
test('実DOM境界に一致するasideだけ差し替え、モード/OFF/記事遷移で公式UIを復帰',()=>{
 const f=uiFixture(sidebarHtml),settings=f.core.readSettings({favoriteTags:['A']});const aside=f.doc.querySelector('aside'),original=aside.children[0],article=f.doc.querySelector('article');
 f.ui.update(settings,'https://note.com/tag/A?mode=new');assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),true);assert.equal(aside.children.length,2);
 assert.equal(aside.children[0].querySelector('[aria-current="page"]').textContent,'# A');
 f.ui.update(settings,'https://note.com/tag/A');assert.equal(aside.children.length,2);
 f.ui.update({...settings,legacyMode:true},'https://note.com/tag/A');assert.equal(aside.children.length,1);assert.equal(original.hasAttribute('data-hikikomori-note-menu-hidden'),false);
 f.ui.update(settings,'https://note.com/following');assert.equal(aside.children[0].querySelector('[aria-current="page"]').textContent,'フォロー中のTL');
 f.ui.update({...settings,enabled:false},'https://note.com/following');assert.equal(aside.children.length,1);
 f.ui.update(settings,'https://note.com/tag/A');f.ui.update(settings,'https://note.com/user/n/id');assert.equal(aside.children.length,1);assert.equal(article.parentElement.tagName,'MAIN');
});
test('DOM再生成後の公式メニューも処理し、構造不一致なら推測で非表示にしない',()=>{
 const f=uiFixture(sidebarHtml),settings=f.core.readSettings({});const aside=f.doc.querySelector('aside');
 f.ui.update(settings,'https://note.com/tag/A');const later=f.doc.createElement('div');aside.append(later);f.ui.update(settings,'https://note.com/tag/A');assert.equal(later.hasAttribute('data-hikikomori-note-menu-hidden'),true);
 aside.className='changed';f.ui.update(settings,'https://note.com/tag/A');assert.equal(later.hasAttribute('data-hikikomori-note-menu-hidden'),false);assert.equal(aside.children.length,2);
});
test('プロフィール情報の先頭に幅を問わず追加し、非表示領域やモードでは解除',()=>{
 const f=uiFixture('<aside class="w-full lg:w-96"><div><button data-name="avatar"></button><h1></h1><a href="/ruminar/followings"></a></div></aside>'),settings=f.core.readSettings({});const aside=f.doc.querySelector('aside');
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
 const settings=f.core.readSettings({}),marker='data-hikikomori-note-product-hidden';
 f.ui.update(settings,'https://note.com/tag/ComfyUI?mode=new');assert.equal(product.hasAttribute(marker),true);assert.equal(other.hasAttribute(marker),false);
 for(const override of [{enabled:false},{legacyMode:true}]){f.ui.update({...settings,...override},'https://note.com/tag/ComfyUI');assert.equal(product.hasAttribute(marker),false);f.ui.update(settings,'https://note.com/tag/ComfyUI');assert.equal(product.hasAttribute(marker),true);}
 f.ui.update(settings,'https://note.com/ruminar/n/article');assert.equal(product.hasAttribute(marker),false);
 f.ui.update(settings,'https://note.com/hashtag/ComfyUI');f.ui.stop();assert.equal(product.hasAttribute(marker),false);
});
test('後挿入の商品枠に追随し、見出し・構造が違う枠や記事本文を隠さない',()=>{
 const f=uiFixture('<section id="region"><h2 class="sr-only"></h2></section>'),settings=f.core.readSettings({}),section=f.doc.getElementById('region'),marker='data-hikikomori-note-product-hidden';
 section.querySelector('h2').textContent='関連商品';f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
 const card=f.doc.createElement('div');card.setAttribute('data-testid','aicn-thing-card');section.append(card);
 f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),true);
 section.querySelector('h2').textContent='記事';f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
 section.querySelector('h2').textContent='関連商品';section.append(f.doc.createElement('article'));f.ui.update(settings,'https://note.com/tag/A');assert.equal(section.hasAttribute(marker),false);
});

test('記事おすすめ設定は既定で表示。型検証・再起動・OFF・タグ操作でも保存値を維持',async()=>{
 const f=fixture({favoriteTags:['A']});
 assert.equal((await f.controller.getState()).hideArticleRecommendations,false);
 await assert.rejects(f.controller.save({hideArticleRecommendations:'true'}));assert.equal(f.writes,0);
 await f.controller.save({hideArticleRecommendations:true});
 await f.controller.tag({type:'ADD_TAG',tag:'B'});
 await f.controller.save({legacyMode:true,enabled:false});
 assert.equal((await f.restart().getState()).hideArticleRecommendations,true);assert.deepEqual(f.stored.favoriteTags,['A','B']);assert.equal(f.rules.length,0);
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
test('記事おすすめ枠だけを両モードで隠し、設定解除・全体OFF・画面離脱・停止で戻す',()=>{
 const f=uiFixture('<article id="note-article"><h2></h2></article><section aria-labelledby="comment"><h2></h2></section>'+recommendationHtml);
 const article=f.doc.getElementById('note-article'),comment=f.doc.querySelector('section'),region=f.doc.root.children.at(-1);
 for(const h of f.doc.querySelectorAll('h2'))h.textContent='あなたへのおすすめ';
 const settings=f.core.readSettings({hideArticleRecommendations:true});
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
 const settings=f.core.readSettings({hideArticleRecommendations:true});
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
