"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {documentFromHtml}=require('./helpers/dom.cjs'),homeFixture=require('./helpers/home.cjs');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(){const c=vm.createContext({URL,console});for(const name of ['common','routing','tag-discovery','articles','note-ui'])vm.runInContext(source(`src/${name}.js`),c);return {c,core:c.HikikomoriNote,discovery:c.HikikomoriNoteTagDiscovery};}
function storage(initial){const f=runtime();let raw=initial||f.core.defaultSettings(),writes=0;const options={};const controller=f.c.HikikomoriNoteRouting.createController({load:async()=>raw,store:async value=>{if(options.fail)throw Error('保存失敗');writes++;raw=plain(value);},setRules:async()=>{}});return {...f,controller,options,get raw(){return raw;},get writes(){return writes;}};}
function dialogFixture(options={}){
 const f=storage(options.initial),doc=documentFromHtml();doc.body=doc.root;let calls=0;
 const dialog=f.discovery.createDialog(doc,{save:async(groupId,tags,position)=>{calls++;await options.gate;if(options.unconfirmed)throw Object.assign(Error('結果不明'),{code:'UNCONFIRMED'});return f.controller.tag({type:'ADD_TAGS',groupId,tags,position});},refresh:()=>f.controller.getState()});
 dialog.open(options.tags||['A','B'],f.core.readSettings(f.raw));
 const buttons=()=>doc.querySelectorAll('button');
 return {...f,doc,dialog,buttons,find:text=>buttons().find(b=>b.textContent===text),get calls(){return calls;},get raw(){return f.raw;},get writes(){return f.writes;}};
}
test('提案文は角括弧・通常表記・隣接・改行・日本語・重複を解析する',()=>{
 const {discovery}=runtime();
 assert.deepEqual(plain(discovery.extract('[#マッチョ茶道][#半透明ハイキング]\n[#不老不死デコポン]\n説明 #AI #AI、#C++\n[# (茶道) ]')) ,['マッチョ茶道','半透明ハイキング','不老不死デコポン','AI','C++','茶道']);
 assert.deepEqual(plain(discovery.extract('説明だけ、@作者 &記事 # 見出し https://note.com/#偽タグ foo#bar `#コード`\n```js\n#コード2\n```\n[リンク](https://x.test/#リンク先)')),[]);
 assert.deepEqual(plain(discovery.extract('[#<img src=x onerror=alert(1)>] #安全')),['安全']);
 assert.deepEqual(plain(discovery.extract('```text\n[#茶道][#散歩]\n```')),['茶道','散歩']);
 assert.throws(()=>discovery.extract('a'.repeat(1048577)),/以内/);
});
test('ユーザーIDは明示形式からだけ抽出し、タグと混ぜても入力順を保つ',()=>{
 const {discovery}=runtime();
 assert.deepEqual(plain(discovery.extract('#先頭 [@First_ID][#小説]\n[@first_id]\n[@Second]\n@bare [@not valid] [@settings] [@日本語] [@link](https://note.com/link)')),[
  '先頭',{type:'user',userId:'First_ID',displayName:''},'小説',{type:'user',userId:'Second',displayName:''}
 ]);
});
test('共有テキストは同じタグに戻せる候補だけを元の順序で出力する',()=>{
 const {discovery}=runtime();
 const result=discovery.shareList(['長い タグ','途中]まで','(括弧あり)','C++','改行\nタグ','www.example.test','x'.repeat(1048576),'小説'],'tag');
 assert.equal(result.skipped,5);
 assert.equal(result.count,3);
 assert.deepEqual(plain(discovery.extract(result.text)),['長い タグ','C++','小説']);
});
test('お気に入りのコピーは選択中のグループと種類に限り、空欄とコピー失敗を扱う',async()=>{
 const initial=runtime().core.defaultSettings();
 initial.tagSchemaVersion=4;
 initial.tagGroups[0].tags=['Tag','その他',{type:'user',userId:'example',displayName:'共有しない名前'},{type:'magazine',userId:'mag_owner',magazineId:'m123',displayName:'マガジン'}];
 initial.tagGroups[1].tags=[{type:'user',userId:'second',displayName:''}];
 const f=homeFixture({state:initial,hash:'#tags'});await flush();
 const tags=f.nodes.get('copy-group-tags'),users=f.nodes.get('copy-group-users'),status=f.nodes.get('favorite-operation-status');
 assert.equal(tags.disabled,false);
 assert.equal(users.disabled,false);
 assert.equal(tags.getAttribute('title'),'このグループのタグをコピー');
 await tags.onclick();
 assert.equal(status.textContent,'タグを2件クリップボードにコピーしました。');
 await users.onclick();
 assert.deepEqual(f.copies,['[#Tag]\n[#その他]','[@example]']);
 f.nodes.get('edit-groups').querySelector('[data-group-id="group2"]').onclick();
 await flush();
 assert.equal(tags.disabled,true);
 await tags.onclick();
 await users.onclick();
 assert.deepEqual(f.copies,['[#Tag]\n[#その他]','[@example]','[@second]']);
 f.options.copyError=true;
 await users.onclick();
 assert.equal(users.disabled,false);
 assert.match(status.textContent,/コピーできませんでした/);
 assert.deepEqual(f.state.tagGroups,plain(initial.tagGroups));
});
test('プロンプトは保存済み全グループのタグだけを含み、空でも追記して使える',()=>{
 const {discovery,core}=runtime(),settings=core.defaultSettings();
 settings.tagGroups[0].tags=['AI',{type:'user',userId:'secret_user',displayName:'秘密作者'}];
 settings.tagGroups.push({id:'group5',name:'',tags:['隠れたタグ','AI',{type:'article',title:'秘密記事',url:'https://note.com/secret/n/n123',articleId:'n123'}]});
 const text=discovery.prompt(settings);assert.equal((text.match(/\[#AI\]/g)||[]).length,1);assert.ok(text.includes('[#隠れたタグ]'));assert.ok(!text.includes('secret'));assert.ok(!text.includes('秘密'));assert.match(discovery.prompt(core.defaultSettings()),/追記/);
});
test('一括保存は1回で既存5種類を維持し、登録済みを除いて追記・移行できる',async()=>{
 const f=storage(),s=f.raw;
 s.tagGroups[0].tags=['A',{type:'user',userId:'test',displayName:''},{type:'magazine',userId:'test',magazineId:'m123',displayName:''},{type:'membership',userId:'test',displayName:''},{type:'article',articleId:'n123',url:'https://note.com/test/n/n123',title:'題'}];s.tagSchemaVersion=6;
 const before=plain(s.tagGroups[0].tags);const result=await f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['A',' B ','#C']});
 assert.equal(f.writes,1);assert.deepEqual(plain(result.bulkTagReport),{added:2,duplicates:1,skipped:0});assert.deepEqual(f.raw.tagGroups[0].tags,[...before,'B','C']);
 const imported=f.core.parseSettingsExport(f.core.exportSettings(result));assert.deepEqual(plain(imported.tagGroups[0].tags),f.raw.tagGroups[0].tags);
 const dup=await f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['A','B']});assert.equal(dup.bulkTagReport.added,0);assert.equal(f.writes,1);
});
test('一括保存の同時操作・失敗・非表示グループ・モード制限・容量上限を守る',async()=>{
 const f=storage();await Promise.all([f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['A','B']}),f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['B','C']})]);assert.deepEqual(f.raw.tagGroups[0].tags,['A','B','C']);
 f.options.fail=true;await assert.rejects(f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['D']}));assert.deepEqual(f.raw.tagGroups[0].tags,['A','B','C']);f.options.fail=false;
 await assert.rejects(f.controller.tag({type:'ADD_TAGS',groupId:'group8',tags:['X']}),{code:'MODE_RESTRICTED'});
 await f.controller.save({mode:'normal-double'});await f.controller.tag({type:'ADD_TAGS',groupId:'group8',tags:['X']});assert.deepEqual(f.raw.tagGroups[7].tags,['X']);
 await f.controller.save({mode:'social'});await assert.rejects(f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['D']}),{code:'MODE_RESTRICTED'});
 const g=storage();g.raw.tagGroups[0].tags=['x'.repeat(500000)];const result=await g.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['y'.repeat(550000),'small']});
 assert.ok(result.bulkTagReport.skipped>0);assert.ok(g.raw.tagGroups[0].tags.includes('small'));assert.ok(JSON.stringify(g.raw).length<=1048576);
});
test('共通ダイアログは全OFFで開き選択・全ON/OFF・登録数と保存結果を表示する',async()=>{
 const initial=runtime().core.defaultSettings();initial.tagGroups[0].tags=['X','Y'];
 const f=dialogFixture({initial});const count=f.doc.querySelector('[aria-live="polite"]');
 assert.equal(count.textContent,'0 / 2件選択');assert.equal(f.find('選択した0件を登録').disabled,true);assert.equal(f.find('先頭に追加'),undefined);assert.equal(f.find('末尾に追加'),undefined);
 const candidates=f.doc.querySelectorAll('[data-tag-candidate]');assert.ok(candidates.every(b=>b.getAttribute('aria-pressed')==='false'));
 candidates[1].onclick();assert.equal(count.textContent,'1 / 2件選択');assert.equal(f.find('選択した1件を登録').disabled,false);
 f.find('すべてON').onclick();assert.equal(count.textContent,'2 / 2件選択');f.find('すべてOFF').onclick();assert.equal(f.find('選択した0件を登録').disabled,true);
 candidates[1].onclick();candidates[0].onclick();
 await f.find('選択した2件を登録').onclick({ctrlKey:true});
 assert.equal(f.writes,1);assert.deepEqual(f.raw.tagGroups[0].tags,['A','B','X','Y']);assert.match(f.doc.querySelector('[role="status"]').textContent,/2件追加/);
 assert.equal(count.textContent,'0 / 2件選択');assert.equal(f.find('選択した0件を登録').disabled,true);
 f.dialog.open(['C'],f.core.readSettings(f.raw));assert.equal(f.doc.querySelectorAll('dialog').length,1);assert.equal(f.doc.querySelector('[data-tag-candidate]').getAttribute('aria-pressed'),'false');
});
test('384件の候補があっても全選択・登録先・登録・閉じるは候補一覧より前にある',async()=>{
 const tags=Array.from({length:384},(_,i)=>`候補${i+1}`), f=dialogFixture({tags});
 const dialog=f.doc.querySelector('dialog'),list=f.doc.querySelector('[class="hikikomori-note-tag-candidates"]');
 const select=f.doc.querySelector('select'),count=f.doc.querySelector('[aria-live="polite"]'),close=f.find('閉じる');
 const all=f.find('すべてON'),save=f.find('選択した0件を登録');
 assert.equal(dialog.children.at(-1),list);
 for(const control of [select,count,close,all,save,f.doc.querySelector('[role="status"]')]) assert.equal(list.contains(control),false);
 assert.equal(f.doc.activeElement,all);
 all.onclick();assert.equal(count.textContent,'384 / 384件選択');
 select.value='group2';select.onchange();await save.onclick();
 assert.deepEqual(f.raw.tagGroups[1].tags,tags);
 close.onclick();assert.equal(dialog.hidden,true);
});
test('ダイアログは連打を止め、結果不明では再確認まで再送せず、無効な保存先を選べない',async()=>{
 let release;const options={gate:new Promise(r=>release=r),unconfirmed:true},f=dialogFixture(options);
 f.find('すべてON').onclick();const save=f.find('選択した2件を登録'),pending=save.onclick();save.onclick({shiftKey:true});assert.equal(f.calls,1);assert.equal(save.disabled,true);release();await pending;
 assert.equal(save.disabled,true);assert.equal(f.find('状態を再確認').hidden,false);options.unconfirmed=false;await f.find('状態を再確認').onclick();assert.equal(save.disabled,false);
 await save.onclick();assert.equal(f.calls,2);f.dialog.update({...f.core.readSettings(f.raw),mode:'social'});assert.equal(f.find('選択した0件を登録').disabled,true);
});
test('設定のタグ登録支援は同じダイアログで保存し、プロンプトをクリップボードだけにコピーする',async()=>{
 const initial=runtime().core.defaultSettings();initial.tagGroups[0].tags=['既存タグ'];
 const f=homeFixture({state:initial});await flush();const n=f.nodes;n.get('nav-discovery').onclick();assert.equal(n.get('panel-discovery').hidden,false);
 n.get('tag-discovery-text').value='[#茶道][#散歩]';n.get('tag-discovery-check').onclick();const doc=f.document;
 doc.querySelectorAll('button').find(b=>b.textContent==='すべてON').onclick();await doc.querySelectorAll('button').find(b=>b.textContent==='選択した2件を登録').onclick({shiftKey:true});
 assert.deepEqual(f.state.tagGroups[0].tags,['茶道','散歩','既存タグ']);assert.ok(n.get('edit-tags').querySelectorAll('a').length>=2);
 await n.get('tag-discovery-copy').onclick();assert.match(f.copies.at(-1),/\[#茶道\]/);assert.deepEqual(f.moves,[]);
 doc.querySelectorAll('button').find(b=>b.textContent==='閉じる').onclick();n.get('tag-discovery-text').value='普通の文章';n.get('tag-discovery-check').onclick();assert.match(n.get('tag-discovery-status').textContent,/\[#タグ名\]/);
 f.options.copyError=true;await n.get('tag-discovery-copy').onclick();assert.match(n.get('tag-discovery-status').textContent,/コピーできません/);
});
test('専用ホームは対象外モードでタグ登録支援を隠し、開いていた一括登録を閉じる',async()=>{
 for(const [mode,panel] of [['severe','intro'],['social','settings']]){
  const initial=homeFixture({hash:'#discovery',state:{mode}});await flush();
  assert.equal(initial.nodes.get('nav-discovery').hidden,true);
  initial.nodes.get('nav-discovery').onclick();
  assert.equal(initial.nodes.get('panel-discovery').hidden,true);
  assert.equal(initial.nodes.get('panel-'+panel).hidden,false);

  const f=homeFixture(),n=f.nodes;await flush();
  n.get('nav-discovery').onclick();
  n.get('tag-discovery-text').value='[#茶道]';
  n.get('tag-discovery-check').focus();
  n.get('tag-discovery-check').onclick();
  const dialog=f.document.querySelector('[class="hikikomori-note-tag-dialog"]');
  assert.equal(dialog.hidden,false);
  f.changed({mode});
  assert.equal(dialog.hidden,true);
  assert.equal(n.get('nav-discovery').hidden,true);
  assert.equal(n.get('panel-discovery').hidden,true);
  assert.equal(n.get('panel-'+panel).hidden,false);
  assert.equal(f.document.activeElement,n.get('nav-settings'));
  f.changed({mode:'normal-double'});
  assert.equal(n.get('nav-discovery').hidden,false);
  n.get('nav-discovery').onclick();
  assert.equal(n.get('panel-discovery').hidden,false);
  assert.equal(n.get('tag-discovery-text').value,'[#茶道]');
 }
});
test('設定からタグとユーザーを同じグループに一括登録し、既存の名前とJSON形式を維持する',async()=>{
 const initial=runtime().core.defaultSettings();
 const savedUser={type:'user',userId:'Owner',displayName:'保存済み'};
 initial.tagSchemaVersion=3;
 initial.tagGroups[1].tags=['既存タグ',savedUser];
 const f=homeFixture({state:initial,hash:'#discovery'});await flush();
 const n=f.nodes,doc=f.document;
 n.get('tag-discovery-text').value='[@new_user][#小説][@owner][@other_user]';
 n.get('tag-discovery-check').onclick();
 const dialog=doc.querySelector('[class="hikikomori-note-tag-dialog"]');
 const candidates=dialog.querySelectorAll('[data-tag-candidate], [data-user-candidate]');
 assert.deepEqual(candidates.map(button=>button.textContent),['＠new_user','#小説','＠owner','＠other_user']);
 assert.ok(candidates.every(button=>button.getAttribute('aria-pressed')==='false'));
 const select=dialog.querySelector('select');select.value='group2';select.onchange();
 const button=text=>dialog.querySelectorAll('button').find(item=>item.textContent===text);
 button('すべてON').onclick();
 await button('選択した4件を登録').onclick({ctrlKey:true});
 const expected=[{type:'user',userId:'new_user',displayName:''},'小説',{type:'user',userId:'other_user',displayName:''},'既存タグ',savedUser];
 assert.deepEqual(f.state.tagGroups[1].tags,expected);
 assert.deepEqual(f.state.tagGroups[0].tags,[]);
 assert.match(dialog.querySelector('[role="status"]').textContent,/3件追加・1件登録済み/);
 const core=f.c.HikikomoriNote;
 assert.deepEqual(plain(core.parseSettingsExport(core.exportSettings(core.readSettings(f.state))).tagGroups[1].tags),expected);
 await n.get('tag-discovery-copy').onclick();
 assert.doesNotMatch(f.copies.at(-1),/new_user|other_user|Owner/);
});
function articleFixture(bulkAddTags=async()=>{throw Error('not used');}){
 const f=runtime(),doc=documentFromHtml('<link rel="canonical" href="https://note.com/test/n/n123"><article id="note-article"><div data-note-key="n123"><h1></h1><div id="note-body"><p></p><ul data-testid="hashtag-list"><li><a data-name="Tag" href="/hashtag/body" id="body-tag"></a></li></ul></div></div><div id="hashtag-accordion"><ul data-testid="hashtag-list" id="real-tags"><li><a data-name="Tag" href="/hashtag/AI" id="real-tag"></a></li></ul></div><section><a href="/hashtag/contest" id="contest"></a></section></article><aside><ul data-testid="hashtag-list"><li><a data-name="Tag" href="/hashtag/other"></a></li></ul></aside>');
 doc.body=doc.root;doc.querySelector('h1').textContent='題';doc.getElementById('real-tag').textContent='#AI';doc.getElementById('body-tag').textContent='#body';doc.getElementById('contest').textContent='#contest';doc.getElementById('note-article').getBoundingClientRect=()=>({left:240,width:700});
 const url='https://note.com/test/n/n123',win={location:{href:url},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),matchMedia:()=>({matches:true})};
 const ui=f.c.HikikomoriNoteUi.create(doc,win,{copyArticle:async()=>{},bulkAddTags});return {...f,doc,url,win,ui};
}
test('記事の専用タグだけ取得し、本文・募集・別記事・外部・URL不一致を混入させない',()=>{
 const f=articleFixture();assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),['AI']);
 f.doc.getElementById('real-tag').setAttribute('href','https://other.test/hashtag/AI');assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),[]);
 f.doc.getElementById('real-tag').setAttribute('href','/hashtag/AI');assert.throws(()=>f.discovery.articleTags(f.doc,'https://note.com/test/n/n456'),/一致/);
 f.doc.getElementById('real-tags').remove();assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),[]);
});
test('記事タグはPCと狭幅の専用一覧を重複除去し、1件・0件も扱う',()=>{
 const f=articleFixture(),article=f.doc.getElementById('note-article'),mobile=f.doc.createElement('div'),list=f.doc.createElement('ul'),item=f.doc.createElement('li'),link=f.doc.createElement('a');
 mobile.setAttribute('data-testid','hashtag-mobile-view');list.setAttribute('data-testid','hashtag-list');link.setAttribute('data-name','Tag');link.setAttribute('href','/hashtag/AI');link.textContent='#AI';item.append(link);list.append(item);mobile.append(list);article.append(mobile);
 assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),['AI']);f.doc.getElementById('hashtag-accordion').remove();assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),['AI']);
 mobile.remove();assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),[]);
});
test('社会復帰noteによる新着検索URLへの書き換え後も、記事の実タグを取得する',()=>{
 const f=articleFixture(),link=f.doc.getElementById('real-tag');
 link.setAttribute('href',f.core.tagUrl('AI'));assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),['AI']);
 link.setAttribute('href','https://note.com/search?q=%23AI&context=note&mode=search&sort=new');
 f.doc.getElementById('body-tag').setAttribute('href',f.core.tagUrl('body'));assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),['AI']);
 for(const href of ['https://other.test/search?q=%23AI&context=note','/search?q=AI&context=note','/search?q=%23Other&context=note','/search?q=%23AI&context=circle','/search?q=%23AI&q=%23Other&context=note','/search?q=from%3A%40author&context=note']){
  link.setAttribute('href',href);assert.deepEqual(plain(f.discovery.articleTags(f.doc,f.url)),[],href);
 }
});
test('記事ボタンは全文取得の直下、共通ダイアログから追加位置を渡し、SPAとOFF・停止で閉じる',async()=>{
 const back=storage(),calls=[];
 const f=articleFixture(async(groupId,tags,url,position)=>{calls.push([url,position]);return back.controller.tag({type:'ADD_TAGS',groupId,tags,position});});
 back.raw.tagGroups[0].tags=['Existing'];
 const settings=back.core.readSettings(back.raw);f.ui.update(settings,f.url);
 const button=f.doc.querySelector('[data-hikikomori-note-article-tags]'),siblings=button.parentElement.children;
 assert.equal(siblings[siblings.indexOf(button)-1].textContent,'記事全文を取得');button.onclick();assert.equal(f.doc.querySelector('dialog').hidden,false);
 assert.equal(f.doc.querySelector('[data-tag-candidate]').textContent,'#AI');assert.equal(f.doc.querySelector('[data-tag-candidate]').getAttribute('aria-pressed'),'false');
 f.doc.querySelector('[data-tag-candidate]').onclick();await f.doc.querySelectorAll('button').find(b=>b.textContent==='選択した1件を登録').onclick();
 assert.deepEqual(calls,[[f.url,'end']]);assert.deepEqual(back.raw.tagGroups[0].tags,['Existing','AI']);
 f.ui.update({...settings,enabled:false},f.url);assert.equal(f.doc.querySelector('dialog').hidden,true);f.ui.update(settings,f.url);f.doc.querySelector('[data-hikikomori-note-article-tags]').onclick();
 f.ui.update(settings,'https://note.com/test/n/n456');assert.equal(f.doc.querySelector('dialog').hidden,true);f.ui.stop();assert.equal(f.doc.querySelector('dialog'),null);
});
test('記事メニューは対象外モードでタグ確認だけを外し、開いていたダイアログを閉じる',()=>{
 const f=articleFixture(),settings=f.core.defaultSettings();
 const tagButton=()=>f.doc.querySelector('[data-hikikomori-note-article-tags]');
 f.ui.update({...settings,mode:'severe'},f.url);
 assert.equal(tagButton(),null);
 const copy=f.doc.querySelectorAll('button').find(b=>b.textContent==='記事全文を取得');
 assert.ok(copy);
 for(const mode of ['social','severe']){
  f.ui.update({...settings,mode:'normal-double'},f.url);
  const button=tagButton();
  assert.ok(button);button.onclick();
  const dialog=f.doc.querySelector('dialog');
  assert.equal(dialog.hidden,false);
  f.ui.update({...settings,mode},f.url);
  assert.equal(tagButton(),null);
  assert.equal(dialog.hidden,true);
  assert.equal(copy.isConnected,true);
  button.onclick();
  assert.equal(dialog.hidden,true);
 }
});
test('背景メッセージは専用ホームと現在記事だけを許可し、保存直前の遷移も拒否する',async()=>{
 const f=storage();let handler,current=true,checks=0,changeDuringSave=false;
 const port={onInstalled(){},onStartup(){},onAction(){},onMessage(fn){handler=fn;},isHomeSender:s=>s.home===true,isNoteSender:s=>s.note===true,
  async currentAuthorPage(sender,url){checks++;return current&&url==='https://note.com/test/n/n123'&&!(changeDuringSave&&checks>1)?{type:'article',user:'test'}:null;}};
 const context=vm.createContext({console,HikikomoriNote:f.core,HikikomoriNoteBackgroundPlatform:port,HikikomoriNoteRouting:{createController:()=>f.controller}});vm.runInContext(source('src/background.js'),context);await flush();
 const send=(patch,sender)=>new Promise(resolve=>{if(!handler({type:'bulk-add-tags',patch},sender,resolve))resolve(false);});
 assert.equal(await send({groupId:'group1',tags:['A']},{}),false);
 assert.equal((await send({groupId:'group1',tags:['A']},{home:true})).ok,true);
 assert.equal((await send({groupId:'group1',tags:['B','A','C'],position:'start',pageUrl:'https://note.com/test/n/n123'},{note:true})).ok,true);
 assert.deepEqual(f.raw.tagGroups[0].tags,['B','C','A']);
 assert.equal((await send({groupId:'group1',tags:['D'],position:'end'},{home:true})).ok,true);
 assert.deepEqual(f.raw.tagGroups[0].tags,['B','C','A','D']);
 assert.equal((await send({groupId:'group1',tags:['E'],position:'middle'},{home:true})).ok,false);
 assert.equal((await send({groupId:'group1',tags:['C'],pageUrl:'https://note.com/test'},{note:true})).code,'CONFLICT');
 checks=0;changeDuringSave=true;const writes=f.writes;
 assert.equal((await send({groupId:'group1',tags:['AfterNavigation'],position:'start',pageUrl:'https://note.com/test/n/n123'},{note:true})).code,'CONFLICT');assert.equal(f.writes,writes);
});
test('共通ダイアログは8グループ・外部変更・閉じた後の保存結果を扱い、安全に文字描画する',async()=>{
 const r=runtime(),initial=r.core.readSettings({...r.core.defaultSettings(),mode:'normal-double'}),f=dialogFixture({initial,tags:['<img src=x onerror=alert(1)>']});
 assert.equal(f.doc.querySelector('select').children.length,8);assert.equal(f.doc.querySelector('[data-tag-candidate]').textContent,'#<img src=x onerror=alert(1)>');assert.equal(f.doc.querySelector('img'),null);
 const select=f.doc.querySelector('select');select.value='group8';select.onchange();f.find('すべてON').onclick();await f.find('選択した1件を登録').onclick();assert.deepEqual(f.raw.tagGroups[7].tags,['<img src=x onerror=alert(1)>']);
 f.dialog.update({...f.core.readSettings(f.raw),mode:'normal'});assert.equal(select.children.length,4);assert.equal(select.value,'group1');
 f.dialog.update({...f.core.readSettings(f.raw),tagWarning:'破損'});assert.equal(f.find('すべてON').disabled,true);
 let release;const g=dialogFixture({gate:new Promise(r=>release=r)});g.find('すべてON').onclick();const pending=g.find('選択した2件を登録').onclick();g.dialog.close();release();await pending;assert.equal(g.doc.querySelector('dialog').hidden,true);
});
test('一括結果は入力内の重複と不正候補も件数に反映し、無効化・競合では変更しない',async()=>{
 const f=storage(),result=await f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['A','#A','  ','B']});assert.deepEqual(plain(result.bulkTagReport),{added:2,duplicates:1,skipped:1});
 const writes=f.writes;await assert.rejects(f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['C']},{validateCurrent:async()=>false}),{code:'CONFLICT'});assert.equal(f.writes,writes);
 await f.controller.save({enabled:false});await assert.rejects(f.controller.tag({type:'ADD_TAGS',groupId:'group1',tags:['C']},{requireEnabled:true}),{code:'DISABLED'});assert.deepEqual(f.raw.tagGroups[0].tags,['A','B']);
});
test('一括登録のブラウザAPIはホームではURLなし、記事では開始元URLを送る',async()=>{
 const messages=[],api={runtime:{id:'test',async sendMessage(message){messages.push(plain(message));return {ok:true,settings:{bulkTagReport:{added:1,duplicates:0,skipped:0}}};}}};
 const c=vm.createContext({URL,console,browser:api});vm.runInContext(source('src/common.js'),c);vm.runInContext(source('src/platform/browser-api.js'),c);
 await c.HikikomoriNotePlatform.bulkAddTags('group1',['A'],undefined,'start');await c.HikikomoriNotePlatform.bulkAddTags('group2',['B'],'https://note.com/test/n/n123','end');
 assert.deepEqual(messages,[{type:'bulk-add-tags',patch:{groupId:'group1',tags:['A'],position:'start'}},{type:'bulk-add-tags',patch:{groupId:'group2',tags:['B'],pageUrl:'https://note.com/test/n/n123',position:'end'}}]);
});
