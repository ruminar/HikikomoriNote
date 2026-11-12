"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {documentFromHtml}=require('./helpers/dom.cjs'),homeFixture=require('./helpers/home.cjs');
const source=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
const item={type:'article',articleId:'n123',url:'https://note.com/sample_author/n/n123',title:'Sample Article'};
function backend(initial={}){
 const c=vm.createContext({URL,console});for(const n of ['common','routing'])vm.runInContext(source(`src/${n}.js`),c);const core=c.HikikomoriNote;let state={...plain(core.defaultSettings()),...initial},writes=0,fail=false,gate;
 const controller=c.HikikomoriNoteRouting.createController({load:async()=>state,setRules:async()=>{},store:async v=>{await gate;if(fail)throw Error('write failed');state=plain(v);writes++;}});
 return{c,core,controller,get state(){return state;},get writes(){return writes;},set fail(v){fail=v;},set gate(v){gate=v;},add:(groupId='group1',value=item,options={})=>controller.tag({type:'ADD_ARTICLE',groupId,...Object.fromEntries(Object.entries(value).filter(([k])=>k!=='type'))},{requireEnabled:true,currentArticleId:value.articleId,currentArticleUrl:value.url,validateCurrent:async()=>true,...options})};
}
function articleUi(options={}){
 const f=backend();for(const n of ['articles','note-ui'])vm.runInContext(source(`src/${n}.js`),f.c);
 const doc=documentFromHtml('<header data-header-state="navbar"><div><a href="https://note.com/"><svg role="img" aria-label="note"></svg></a></div></header><article id="note-article"><div data-note-key="n123"><h1 id="title"></h1><div><a href="https://note.com/sample_author" id="author"><span data-name="avatar"></span></a><time datetime="2026-11-12"></time></div><div id="note-body" data-name="body"><p id="body"></p></div></div></article>');doc.body=doc.root;
 doc.getElementById('title').textContent=item.title;doc.getElementById('body').textContent='ARTICLE_BODY_MUST_NOT_BE_STORED';doc.getElementById('author').textContent='Author';const avatar=doc.createElement('span');avatar.setAttribute('data-name','avatar');doc.getElementById('author').append(avatar);
 doc.getElementById('note-article').getBoundingClientRect=()=>({left:options.left??270,width:640});
 const win={AbortController,matchMedia:q=>({matches:q.includes('max-width')?options.wide===false:options.wide!==false}),getComputedStyle:n=>({display:n.hidden?'none':'block',visibility:'visible'})};let url=item.url,patch={},calls=[];
 const update=(next=url,nextPatch=patch)=>{url=next;patch=nextPatch;ui.update({...f.core.readSettings(f.state),...patch},url);};
 const ui=f.c.HikikomoriNoteUi.create(doc,win,{copyArticle:async()=>{},addCurrentArticle:async(groupId,articleId,canonical,title)=>{calls.push({groupId,articleId,url:canonical,title});if(options.unconfirmed)throw Object.assign(Error('unknown'),{code:'UNCONFIRMED'});await f.add(groupId,{type:'article',articleId,url:canonical,title});update();},refresh:async()=>{options.unconfirmed=false;}});update();
 return{...f,backend:f,doc,win,options,ui,update,calls,get block(){return doc.querySelector('[class~="hikikomori-note-article-favorite-profile"]');},get toggle(){return doc.querySelector('[class="hikikomori-note-article-following-row"]')?.querySelector('button');},get select(){return this.block?.querySelector('select');},get add(){return this.block?.querySelectorAll('button')[0];}};
}

test('記事は公開URL・ID・タイトルだけで正規化し、&ラベルと記事IDキーを使う',()=>{
 const {core}=backend();assert.deepEqual(plain(core.articleAddress(item.url+'/?magazine_key=m123&secret=value#part')),{articleId:'n123',url:item.url});assert.deepEqual(plain(core.favorite(item)),item);assert.equal(core.favoriteLabel(item),'&Sample Article');assert.equal(core.favoriteKey(item),'article:n123');assert.equal(core.favoriteUrl(item),item.url);
 for(const patch of [{url:'https://outside.test/a'},{url:'http://note.com/sample_author/n/n123'},{url:'https://u:p@note.com/sample_author/n/n123'},{url:'https://note.com/preview/n123'},{url:item.url+'?private=1'},{articleId:'nOther'},{title:''},{title:' x '},{title:'x\ny'},{title:'x'.repeat(501)},{title:'\ud800'},{body:'secret'}])assert.throws(()=>core.favoriteArticle({...item,...patch}));
});
test('旧保存2〜5は読取のみで維持し、記事追加で6へ上げ既存お気に入り・設定を保持する',async()=>{
 const values=['Tag',{type:'user',userId:'sample_author',displayName:'Author'},{type:'magazine',userId:'sample_author',magazineId:'m1',displayName:'Magazine'},{type:'membership',userId:'sample_author',displayName:'Membership'}];
 for(const version of [2,3,4,5]){const f=backend({tagSchemaVersion:version,theme:'dark',hideLikeCounts:true});f.state.tagGroups[0].tags=values.slice(0,version-1);await f.controller.getState();assert.equal(f.writes,0);await f.add();assert.equal(f.state.tagSchemaVersion,6);assert.deepEqual(f.state.tagGroups[0].tags,[...values.slice(0,version-1),item]);assert.equal(f.state.theme,'dark');assert.equal(f.state.hideLikeCounts,true);assert.ok(!f.core.readSettings(f.state).tagWarning);assert.ok(!JSON.stringify(f.state).includes('ARTICLE_BODY'));}
});
test('記事IDの重複は全グループで拒否し、URL作者・タイトルが異なっても同じ記事とする',async()=>{
 const f=backend();await f.add('group1');for(const duplicate of [item,{...item,url:'https://note.com/another_author/n/n123',title:'Changed title'}])await assert.rejects(f.add('group2',duplicate),/既に登録/);assert.equal(f.writes,1);
});
test('記事は既存の並べ替え・グループ移動・削除で操作し、他種別を保持する',async()=>{
 const f=backend();await f.controller.tag({type:'ADD_TAG',groupId:'group1',tag:'Tag'});await f.add();await f.controller.tag({type:'MOVE_TAG',groupId:'group1',tag:item,beforeTag:'Tag'});assert.deepEqual(f.state.tagGroups[0].tags,[item,'Tag']);
 await f.controller.tag({type:'TRANSFER_TAG',groupId:'group1',targetGroupId:'group4',tag:item});assert.deepEqual(f.state.tagGroups[0].tags,['Tag']);assert.deepEqual(f.state.tagGroups[3].tags,[item]);await f.controller.tag({type:'REMOVE_TAG',groupId:'group4',tag:item});assert.deepEqual(f.state.tagGroups[3].tags,[]);assert.equal(f.state.tagSchemaVersion,6);
});
test('記事は現在ページの検証・保存直前の競合・モード・OFF・保存失敗を保護する',async()=>{
 const f=backend();await assert.rejects(f.controller.tag({type:'ADD_ARTICLE',groupId:'group1',articleId:item.articleId,url:item.url,title:item.title}),/記事ページ/);await assert.rejects(f.add('group1',item,{validateCurrent:async()=>false}),/変わりました/);assert.equal(f.writes,0);f.fail=true;await assert.rejects(f.add(),/write failed/);assert.equal(f.writes,0);assert.equal(f.state.tagGroups[0].tags.length,0);
 for(const initial of [{enabled:false},{mode:'severe'},{mode:'social'}]){const g=backend(initial);await assert.rejects(g.add());assert.equal(g.writes,0);}
});
test('保存内の重複記事・不正記事は編集を止め、元データを上書きしない',async()=>{
 for(const invalid of [{...item,articleId:'nBad'},item]){const f=backend({tagSchemaVersion:6});f.state.tagGroups[0].tags=[item];f.state.tagGroups[1].tags=[invalid];const before=JSON.stringify(f.state);assert.ok((await f.controller.getState()).tagWarning);await assert.rejects(f.add('group3'));assert.equal(JSON.stringify(f.state),before);assert.equal(f.writes,0);}
});
test('5種類を形式8で書き出して往復し、省略された設定は維持する',async()=>{
 const f=backend({theme:'dark'});await f.add();f.state.tagGroups[1].tags=['Tag',{type:'user',userId:'writer',displayName:'Writer'},{type:'magazine',userId:'writer',magazineId:'m1',displayName:'M'},{type:'membership',userId:'writer',displayName:'S'}];const json=f.core.exportSettings(f.core.readSettings(f.state)),document=JSON.parse(json);assert.equal(document.schemaVersion,8);assert.deepEqual(document.settings.tagGroups[0].items,[item]);
 const g=backend();await g.controller.importSettings({json,expectedToken:g.core.settingsToken(g.core.readSettings(g.state))});assert.deepEqual(g.state.tagGroups,f.state.tagGroups);assert.equal(g.state.tagSchemaVersion,6);assert.equal(g.state.theme,'dark');
 const parsed=f.core.inspectSettingsImport('{"hideLikeCounts":true}',f.core.readSettings(f.state));assert.deepEqual(plain(parsed.settings.tagGroups),f.state.tagGroups);assert.equal(parsed.settings.theme,'dark');
});
test('形式・版番号省略や未知版でも記事を解釈し、不正・未知・重複だけを報告する',()=>{
 const f=backend(),base={tagGroups:[{id:'group1',items:[item,{...item,title:'duplicate'},{...item,articleId:'nWrong'},{type:'unknown'},{type:'tag',tag:'Tag'}]}]};
 for(const doc of [base,{format:'unknown',schemaVersion:999,settings:base},{schemaVersion:1,settings:base}]){const r=f.core.inspectSettingsImport(JSON.stringify(doc));assert.deepEqual(plain(r.settings.tagGroups[0].tags),[item,'Tag']);assert.ok(r.ignored.length>=3);}
 const bad=f.core.inspectSettingsImport(JSON.stringify({tagGroups:[{id:'group1',items:[{...item,body:'DROP_ME'}]}]}));assert.deepEqual(plain(bad.settings.tagGroups[0].tags),[item]);assert.ok(bad.ignored.some(x=>x.path.endsWith('.body')));assert.ok(!JSON.stringify(bad.settings).includes('DROP_ME'));
});
test('JSONのグループ間重複は省略された現在値を優先し、全設定を拒否せず理由を表示する',async()=>{
 const f=backend();await f.add('group4');const r=f.core.inspectSettingsImport(JSON.stringify({tagGroups:[{id:'group1',items:[item,{type:'tag',tag:'New'}]}]}),f.core.readSettings(f.state));assert.deepEqual(plain(r.settings.tagGroups[0].tags),['New']);assert.deepEqual(plain(r.settings.tagGroups[3].tags),[item]);assert.ok(r.ignored.some(x=>x.reason.includes('別グループ')));
 const full=f.core.inspectSettingsImport(JSON.stringify({tagGroups:[{id:'group1',items:[item]},{id:'group2',items:[item]}]}));assert.deepEqual(plain(full.settings.tagGroups[0].tags),[item]);assert.deepEqual(plain(full.settings.tagGroups[1].tags),[]);
});
test('設定画面は&タイトルを安全に表示し、既存の削除・並べ替え・移動ボタンを使う',async()=>{
 const f=backend({tagSchemaVersion:6});f.state.tagGroups[0].tags=['Tag',{...item,title:'<script>text</script>'}];const h=homeFixture({hash:'#tags',state:f.state});await flush();const rows=h.nodes.get('edit-tags').children;assert.equal(rows[1].querySelector('a').textContent,'&<script>text</script>');assert.equal(rows[1].querySelector('a').href,item.url);assert.equal(rows[1].querySelector('a').getAttribute('target'),'_self');assert.equal(rows[1].querySelector('script'),null);assert.ok(rows[1].querySelector('select'));assert.ok(rows[1].querySelectorAll('button').length>=3);
});
test('記事ページの&はTLの前、4グループから登録して本文を保存せず登録済みになる',async()=>{
 const f=articleUi();assert.equal(f.toggle.textContent,'&');assert.equal(f.toggle.parentElement.children[0],f.toggle);assert.equal(f.block.hidden,true);f.toggle.onclick();assert.equal(f.block.hidden,false);assert.equal(f.toggle.getAttribute('aria-expanded'),'true');assert.equal(f.select.children.length,5);
 f.select.value='group3';f.select.onchange();assert.equal(f.add.disabled,false);await f.add.onclick();assert.deepEqual(f.backend.state.tagGroups[2].tags,[item]);assert.ok(!JSON.stringify(f.backend.state).includes('ARTICLE_BODY_MUST_NOT_BE_STORED'));assert.equal(f.add.disabled,true);assert.match(f.add.textContent,/登録済み/);assert.equal(f.calls.length,1);
 f.block.fire('keydown',{key:'Escape'});assert.equal(f.block.hidden,true);
});
test('記事登録フォームは狭幅でも&＋TLの先頭行に置き、幅変更で選択・開閉を維持する',()=>{
 const options={wide:false},f=articleUi(options),toggle=f.toggle,block=f.block;f.doc.querySelector('[class="hikikomori-note-mobile-toggle"]').onclick();toggle.onclick();f.select.value='group2';f.select.onchange();assert.equal(f.toggle,toggle);assert.equal(block.parentElement.className,'hikikomori-note-article-mobile');assert.equal(block.parentElement.children[0],toggle.parentElement);
 options.wide=true;f.update();assert.equal(f.toggle,toggle);assert.equal(f.block,block);assert.equal(f.select.value,'group2');assert.equal(block.hidden,false);assert.equal(block.parentElement,f.doc.body);options.wide=false;f.update();assert.equal(f.block,block);assert.equal(block.hidden,false);
});
test('非記事・プレビュー・URL/DOM不一致・タイトル不明・OFF・モード変更・停止では登録しない',()=>{
 const f=articleUi();for(const [url,patch] of [[item.url,{enabled:false}],[item.url,{mode:'severe'}],[item.url,{mode:'social'}],['https://note.com/preview/n123',{}],['https://note.com/search',{}],['https://note.com/sample_author/n/nOther',{}]]){f.update(url,patch);assert.equal(Boolean(f.toggle),false);assert.equal(Boolean(f.block),false);}
 f.doc.getElementById('title').textContent='';f.update(item.url,{});assert.equal(Boolean(f.block),false);f.doc.getElementById('title').textContent=item.title;f.update();assert.ok(f.block);f.ui.stop();assert.equal(Boolean(f.block),false);assert.equal(Boolean(f.toggle),false);
});
test('保存結果不明は自動再送せず状態再確認を出し、リトライ後に登録できる',async()=>{
 const options={unconfirmed:true},f=articleUi(options);f.toggle.onclick();f.select.value='group1';f.select.onchange();await f.add.onclick();assert.equal(f.add.disabled,true);assert.equal(f.calls.length,1);await f.add.onclick();assert.equal(f.calls.length,1);const refresh=f.block.querySelectorAll('button')[1];assert.equal(refresh.hidden,false);await refresh.onclick();assert.equal(f.add.disabled,false);await f.add.onclick();assert.equal(f.backend.writes,1);
});


test('現在記事の取得は送信元・フレーム・遷移中URLを照合し、queryを保存URLから除く',async()=>{
 let tab={url:item.url+'?magazine_key=m1#part'};const c=vm.createContext({URL,chrome:{runtime:{id:'self'},tabs:{get:async()=>tab}}});for(const n of ['common','platform/browser-api'])vm.runInContext(source(`src/${n}.js`),c);
 const check=c.HikikomoriNoteBackgroundPlatform.currentArticlePage,sender={id:'self',frameId:0,url:item.url,tab:{id:1}};assert.deepEqual(plain(await check(sender,tab.url)),{articleId:item.articleId,url:item.url});
 for(const bad of [{...sender,id:'other'},{...sender,frameId:1},{...sender,url:'https://outside.test/'},{...sender,tab:{}}])assert.equal(await check(bad,tab.url),null);
 assert.equal(await check(sender,item.url),null);tab.pendingUrl=item.url+'/other';assert.equal(await check(sender,tab.url),null);tab={url:'https://note.com/preview/n123'};assert.equal(await check(sender,tab.url),null);tab={url:'https://u:p@note.com/sample_author/n/n123'};assert.equal(await check(sender,tab.url),null);
});
test('記事登録メッセージはIDと正規URLを検証し、保存直前の移動や拡張ページの偽装登録を拒否する',async()=>{
 const f=backend();let handler,checks=0,changed=false;const port={onInstalled(){},onStartup(){},onAction(){},onMessage(fn){handler=fn;},isHomeSender:s=>s.home===true,isNoteSender:s=>s.note===true,currentArticlePage:async()=>{checks++;return{articleId:changed&&checks>1?'nOther':item.articleId,url:item.url};}};
 const c=vm.createContext({console,HikikomoriNoteBackgroundPlatform:port,HikikomoriNoteRouting:{createController:()=>f.controller}});vm.runInContext(source('src/background.js'),c);await flush();
 const patch={groupId:'group1',articleId:item.articleId,url:item.url,title:item.title,pageUrl:item.url};const send=(p=patch,sender={note:true},type='add-current-article')=>new Promise(resolve=>{if(handler({type,patch:p},sender,resolve)===false)resolve(null);});
 assert.equal(await send(patch,{home:true}),null);assert.equal(await send(patch,{note:false}),null);assert.equal((await send({...patch,articleId:'nOther'})).ok,false);assert.equal((await send({...patch,url:'https://note.com/another/n/n123'})).ok,false);assert.equal(f.writes,0);
 checks=0;changed=true;assert.equal((await send()).ok,false);assert.equal(f.writes,0);checks=0;changed=false;assert.equal((await send()).ok,true);assert.equal(f.writes,1);
 const fresh=backend();const options={requireEnabled:true,currentArticleId:item.articleId,currentArticleUrl:item.url,validateCurrent:async()=>false};await assert.rejects(fresh.add('group1',item,options));assert.equal(fresh.writes,0);
 assert.equal((await send({type:'ADD_ARTICLE',groupId:'group2',articleId:item.articleId,url:item.url,title:item.title},{home:true},'tag-operation')).ok,false);
});
test('記事のお気に入りはnoteメニューで別タブの元記事リンクとして表示される',()=>{
 const f=backend({tagSchemaVersion:6});f.state.tagGroups[0].tags=[item];vm.runInContext(source('src/note-ui.js'),f.c);const doc=documentFromHtml('<aside class="sticky w-[11.375rem]"><div><nav aria-label="急上昇"></nav></div></aside><main></main>');const ui=f.c.HikikomoriNoteUi.create(doc,{matchMedia:()=>({matches:false}),getComputedStyle:()=>({display:'block'})},{});ui.update(f.core.readSettings(f.state),'https://note.com/search?q=tag');
 const link=doc.querySelector('ul').querySelector('a');assert.equal(link.textContent,'&Sample Article');assert.equal(link.href,item.url);assert.equal(link.getAttribute('target'),'_blank');assert.equal(link.getAttribute('rel'),'noopener noreferrer');assert.ok(!link.getAttribute('title').includes('undefined'));
});
test('設定画面の既存操作から記事を上下移動・別グループへ移動・削除できる',async()=>{
 const f=backend({tagSchemaVersion:6});f.state.tagGroups[0].tags=['Tag',item];const h=homeFixture({hash:'#tags',state:f.state});await flush();const rows=()=>h.nodes.get('edit-tags').children;rows()[1].querySelectorAll('button')[0].onclick();await flush();assert.deepEqual(h.state.tagGroups[0].tags,[item,'Tag']);
 rows()[0].querySelector('select').value='group3';rows()[0].querySelectorAll('button').find(b=>b.textContent==='移動').onclick();await flush();assert.deepEqual(h.state.tagGroups[2].tags,[item]);assert.deepEqual(h.state.tagGroups[0].tags,['Tag']);
 const groupButtons=h.document.querySelectorAll('button[data-group-id="group3"]');groupButtons[0].onclick();await flush();rows()[0].querySelectorAll('button').find(b=>b.textContent==='削除').onclick();await flush();assert.deepEqual(h.state.tagGroups[2].tags,[]);
});


test('別グループへの同時登録も書込キューで1件だけ保存する',async()=>{
 const f=backend();const answers=await Promise.allSettled([f.add('group1'),f.add('group4')]);assert.equal(answers.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.writes,1);assert.equal(f.state.tagGroups.flatMap(g=>g.tags).length,1);
});
test('記事タイトル変更を次の登録に反映し、追跡パラメータや本文は保存しない',async()=>{
 const f=articleUi();f.doc.getElementById('title').textContent='Updated title';f.update(item.url+'?tracking=secret#section');f.toggle.onclick();f.select.value='group1';f.select.onchange();await f.add.onclick();assert.equal(f.calls[0].title,'Updated title');assert.equal(f.calls[0].url,item.url);assert.ok(!JSON.stringify(f.backend.state).includes('secret'));
 f.select.value='group4';f.select.onchange();assert.equal(f.add.disabled,true);assert.match(f.add.textContent,/グループ1に登録済み/);
});


test('記事なしの書き出しは形式7を維持し、記事を削除しても従来の相互移行を妨げない',async()=>{
 const f=backend();assert.equal(JSON.parse(f.core.exportSettings(f.core.readSettings(f.state))).schemaVersion,7);await f.add();assert.equal(JSON.parse(f.core.exportSettings(f.core.readSettings(f.state))).schemaVersion,8);await f.controller.tag({type:'REMOVE_TAG',groupId:'group1',tag:item});assert.equal(JSON.parse(f.core.exportSettings(f.core.readSettings(f.state))).schemaVersion,7);
});


test('おしゃべりnote形式1の記事と共通設定を読み込み、専用設定を取り込まない',()=>{
 const f=backend(),r=f.core.inspectSettingsImport(JSON.stringify({format:'oshaberi-note-settings',schemaVersion:1,settings:{theme:'dark',tagGroups:[{id:'group2',name:'Articles',items:[item]}],ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'synthetic-model',ollamaSystemPrompt:'not-imported'}}));assert.deepEqual(plain(r.settings.tagGroups[1].tags),[item]);assert.equal(r.settings.theme,'dark');assert.equal(Object.hasOwn(r.settings,'ollamaUrl'),false);assert.equal(r.ignored.filter(x=>x.path.startsWith('ollama')).length,3);
 const json=f.core.exportSettings({...f.core.defaultSettings(),...r.settings,tagSchemaVersion:6});assert.equal(JSON.parse(json).schemaVersion,8);
});
