"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const homeFixture=require('./helpers/home.cjs');
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
function backend(patch={}){
 const c=vm.createContext({URL,console});for(const f of ['common','routing'])vm.runInContext(fs.readFileSync(path.join(__dirname,`../src/${f}.js`),'utf8'),c);
 const core=c.HikikomoriNote;let state={...plain(core.defaultSettings()),...patch},writes=0,ruleCalls=0,fail=false,rules=[];
 const controller=c.HikikomoriNoteRouting.createController({load:async()=>state,store:async v=>{if(fail)throw Error('write failed');state=plain(v);writes++;},setRules:async v=>{rules=plain(v);ruleCalls++;}});
 return{core,controller,get state(){return state;},get writes(){return writes;},get ruleCalls(){return ruleCalls;},get rules(){return rules;},set fail(v){fail=v;},async load(json){return controller.importSettings({json:typeof json==='string'?json:JSON.stringify(json),expectedToken:core.settingsToken(core.readSettings(state))});}};
}
const tag={type:'tag',tag:'SampleTag'},user={type:'user',userId:'sample_author',displayName:'Sample Author'},magazine={type:'magazine',userId:'sample_author',magazineId:'m123abc',displayName:'Sample Magazine'},membership={type:'membership',userId:'sample_author',displayName:'Sample Membership'};
// Synthetic values only: matches the supplied export structure, not its personal settings.
const sample={format:'oshaberi-note-settings',schemaVersion:1,settings:{enabled:true,dashboardDisabled:true,hideArticleRecommendations:true,hidePaidArticles:true,keepNoteHeaderVisible:true,hideLikeCounts:true,noteUserId:'sample_owner',tagGroups:[{id:'group1',name:'',items:[user,tag,{type:'tag',tag:'AnotherTag'}]},{id:'group2',name:'',items:[]},{id:'group3',name:'',items:[{type:'tag',tag:'SampleA'},{type:'tag',tag:'SampleB'}]},{id:'group4',name:'',items:[]}],selectedTagGroupId:'group1',authorDisplayRules:[],theme:'system',ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'sample-model',ollamaSystemPrompt:'not to be imported'}};
test('テーマは初期system、古い保存値の読取だけでは保存せず不正値もsystemへ縮退',async()=>{
 const f=backend();delete f.state.theme;assert.equal((await f.controller.getState()).theme,'system');assert.equal(f.writes,0);assert.equal(Object.hasOwn(f.state,'theme'),false);
 for(const theme of [null,42,'auto',''])assert.equal(f.core.readSettings({...f.state,theme}).theme,'system');
 for(const theme of ['system','dark','light']){await f.controller.save({theme});assert.equal(f.state.theme,theme);assert.equal((await f.controller.getState()).theme,theme);}
 for(const theme of [null,'auto',false])await assert.rejects(f.controller.save({theme}));
});
test('全モード・OFFでテーマを復元し、別画面通知で配色を更新し未保存の選択は保持',async()=>{
 for(const mode of ['normal','severe','social'])for(const enabled of [true,false]){
  const f=homeFixture({state:{theme:'dark',mode,enabled}});await flush();assert.equal(f.document.querySelector('html').getAttribute('data-theme'),'dark');assert.equal(f.nodes.get('theme').value,'dark');
  f.nodes.get('theme').value='light';f.nodes.get('theme').fire('change');assert.equal(f.document.querySelector('html').getAttribute('data-theme'),'dark');
  f.changed({theme:'system'});assert.equal(f.document.querySelector('html').getAttribute('data-theme'),'system');assert.equal(f.nodes.get('theme').value,'light');
  f.nodes.get('settings').fire('submit');await flush();assert.equal(f.state.theme,'light');assert.equal(f.document.querySelector('html').getAttribute('data-theme'),'light');
  const peer=homeFixture({state:{theme:'system'}});await flush();peer.changed({theme:f.state.theme});assert.equal(peer.nodes.get('theme').value,'light');assert.equal(peer.document.querySelector('html').getAttribute('data-theme'),'light');
 }
});
test('テーマ保存失敗では配色・保存値を変えず未保存の選択を残す',async()=>{
 const f=homeFixture({saveError:true,state:{theme:'dark'}});await flush();f.nodes.get('theme').value='light';f.nodes.get('theme').fire('change');f.nodes.get('settings').fire('submit');await flush();assert.equal(f.state.theme,'dark');assert.equal(f.document.querySelector('html').getAttribute('data-theme'),'dark');assert.equal(f.nodes.get('theme').value,'light');
});
test('systemはCSSメディア問い合わせで追従し、公式ページ用CSSへテーマを追加しない',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/home.css'),'utf8');assert.match(css,/@media \(prefers-color-scheme: dark\)/);assert.match(css,/:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)/);assert.match(css,/input, select, textarea \{ color: var\(--text\); background: var\(--surface\)/);assert.match(css,/dialog \{[^}]*color: var\(--text\); background: var\(--surface\)/);assert.equal(fs.readFileSync(path.join(__dirname,'../src/content.css'),'utf8').includes('data-theme'),false);
});
test('テーマ付き確認dialogはキャンセル・実行・Escapeを扱い、取り込み結果もテーマを反映',async()=>{
 const f=homeFixture();await flush();const n=f.nodes,d=n.get('confirm-dialog');d.showModal=()=>{d.open=true;};d.close=()=>{d.open=false;};n.get('settings-json').value='{"theme":"dark"}';n.get('settings-json').fire('input');
 const cancel=n.get('import-settings').onclick();await flush();assert.equal(d.open,true);assert.equal(f.document.activeElement,n.get('confirm-cancel'));n.get('confirm-cancel').onclick();await cancel;assert.notEqual(f.state.theme,'dark');
 const escape=n.get('import-settings').onclick();await flush();d.oncancel({preventDefault(){}});await escape;assert.equal(d.open,false);
 const accept=n.get('import-settings').onclick();await flush();n.get('confirm-accept').onclick();await accept;await flush();assert.equal(f.state.theme,'dark');assert.match(n.get('transfer-report').textContent,/適用した項目/);assert.match(n.get('transfer-report').textContent,/theme/);
});
test('匿名化サンプルの共通設定を取り込み、modeとロゴ設定は省略なので維持',async()=>{
 const f=backend({mode:'severe',noteLogoBrowserBack:true,theme:'dark'});const result=await f.load(sample);assert.equal(f.state.mode,'severe');assert.equal(f.state.noteLogoBrowserBack,true);assert.equal(f.state.theme,'system');assert.equal(f.state.hideLikeCounts,true);assert.equal(f.state.noteUserId,'sample_owner');assert.deepEqual(f.state.tagGroups[0].tags,[user,'SampleTag','AnotherTag']);assert.deepEqual(f.state.tagGroups[2].tags,['SampleA','SampleB']);assert.equal(f.state.tagSchemaVersion,3);assert.equal(f.writes,1);
 assert.deepEqual(plain(result.importReport.ignored).map(x=>x.path),['ollamaUrl','ollamaModel','ollamaSystemPrompt']);const exported=f.core.exportSettings(f.core.readSettings(f.state));assert.equal(exported.includes('ollama'),false);assert.equal(exported.includes('not to be imported'),false);assert.equal(Object.hasOwn(f.state,'importReport'),false);
});
test('形式名・版番号の省略と未知版・独自ラッパーは値の解釈を妨げない',async()=>{
 for(const json of [{theme:'dark'},{settings:{theme:'dark'}},{format:'other',schemaVersion:999,settings:{theme:'dark'}},{format:null,schemaVersion:'next',theme:'dark'}]){const f=backend();await f.load(json);assert.equal(f.state.theme,'dark');}
});
test('false・空文字・空配列を適用し、省略項目を維持する',async()=>{
 const f=backend({enabled:true,noteUserId:'old_user',theme:'dark',mode:'social',hidePaidArticles:true,authorDisplayRules:[{userId:'author',displayName:'Author',action:'allow'}]});f.state.tagGroups[0]={id:'group1',name:'Keep Name',tags:['Keep']};f.state.tagGroups[1].tags=['Other'];await f.load({enabled:false,noteUserId:'',authorDisplayRules:[],tagGroups:[{id:'group1',name:'',items:[]}]});assert.equal(f.state.enabled,false);assert.equal(f.state.noteUserId,'');assert.equal(f.state.theme,'dark');assert.equal(f.state.mode,'social');assert.equal(f.state.hidePaidArticles,true);assert.deepEqual(f.state.authorDisplayRules,[]);assert.deepEqual(f.state.tagGroups[0].tags,[]);assert.equal(f.state.tagGroups[0].name,'');assert.deepEqual(f.state.tagGroups[1].tags,['Other']);
});
test('明示tagGroups空配列は全グループのお気に入りを解除し名前は維持',async()=>{
 const f=backend();f.state.tagGroups.forEach(g=>{g.tags=['keep'];g.name='Keep';});await f.load({tagGroups:[]});assert.ok(f.state.tagGroups.every(g=>g.tags.length===0&&g.name==='Keep'));
});
test('不正なスカラーだけを無視し、未知項目や内部番号を保持しない',async()=>{
 const f=backend({theme:'dark',mode:'social',noteUserId:'keep_user',hidePaidArticles:true});const r=await f.load({theme:'auto',mode:false,noteUserId:3,hidePaidArticles:'false',hideLikeCounts:true,selectedTagGroupId:'group9',enabled:false,extra:{hello:1},tagGroupsRevision:999,ollamaUrl:'https://example.invalid'});assert.equal(f.state.theme,'dark');assert.equal(f.state.mode,'social');assert.equal(f.state.noteUserId,'keep_user');assert.equal(f.state.hidePaidArticles,true);assert.equal(f.state.hideLikeCounts,true);assert.equal(f.state.enabled,false);assert.equal(f.state.tagGroupsRevision,1);assert.equal(r.importReport.ignored.length,8);assert.equal(Object.hasOwn(f.state,'extra'),false);
});
test('お気に入り4種類を順序どおり対応し、不正・重複・未知プロパティだけを無視',async()=>{
 const f=backend();const r=await f.load({tagGroups:[{id:'group2',name:'Second',items:[tag,user,{...magazine,extra:true},membership,{...user,userId:'SAMPLE_AUTHOR'},{type:'tag',tag:''},{type:'other'}]}]});assert.deepEqual(f.state.tagGroups[1].tags,['SampleTag',user,magazine,membership]);assert.equal(f.state.tagSchemaVersion,5);assert.equal(r.importReport.ignored.length,4);assert.equal(f.state.selectedTagGroupId,'group1');assert.equal(f.state.tagGroups[1].name,'Second');
 const out=JSON.parse(f.core.exportSettings(f.core.readSettings(f.state)));assert.equal(out.schemaVersion,7);assert.equal(out.settings.theme,'system');assert.deepEqual(out.settings.tagGroups[1].items,[tag,user,magazine,membership]);assert.deepEqual(plain(f.core.parseSettingsExport(JSON.stringify(out)).tagGroups[1].tags),f.state.tagGroups[1].tags);
});
test('全件不正の非空配列では既存一覧を維持し、グループ名の有効変更だけを適用',async()=>{
 const rule={userId:'keep_author',displayName:'Keep',action:'allow'},f=backend({authorDisplayRules:[rule]});f.state.tagGroups[0].tags=['Keep'];const r=await f.load({tagGroups:[{id:'group1',name:'New',items:[null,{type:'bad'}]}],authorDisplayRules:[{userId:'settings',displayName:'',action:'allow'}]});assert.deepEqual(f.state.tagGroups[0].tags,['Keep']);assert.equal(f.state.tagGroups[0].name,'New');assert.deepEqual(f.state.authorDisplayRules,[rule]);assert.ok(r.importReport.ignored.some(x=>x.reason.includes('現在値を維持')));
});
test('グループIDで対応し、重複・未知IDとitems優先を報告する',async()=>{
 const f=backend();const r=await f.load({tagGroups:[{id:'group4',items:[tag],tags:['ignored']},{id:'group4',items:[]},{id:'group9',items:[]}],selectedTagGroupId:'group4'});assert.deepEqual(f.state.tagGroups[3].tags,['SampleTag']);assert.equal(f.state.selectedTagGroupId,'group4');assert.equal(r.importReport.ignored.length,3);
});
test('作者ルールの許可・非表示を受け取り、重複・不正actionを無視する',async()=>{
 const f=backend();const r=await f.load({authorDisplayRules:[{userId:'author_a',displayName:'A',action:'hide'},{userId:'author_b',displayName:'B',action:'allow'},{userId:'AUTHOR_A',displayName:'Dup',action:'allow'},{userId:'author_c',displayName:'C',action:'block'}]});assert.deepEqual(f.state.authorDisplayRules.map(x=>x.action),['hide','allow']);assert.equal(r.importReport.ignored.length,2);
});
test('旧形式1〜7はtags・legacyModeの変換を維持し、省略フラグを初期化しない',async()=>{
 for(let version=1;version<=7;version++){
  const f=backend({theme:'dark',hideLikeCounts:true,keepNoteHeaderVisible:true,mode:'social'}),settings={tagGroups:[{id:'group1',name:'',...(version<5?{tags:['Old']}:{items:[{type:'tag',tag:'Old'}]})}],...(version<3?{legacyMode:true}:{mode:'normal'})};await f.load({format:'hikikomori-note-settings',schemaVersion:version,settings});assert.equal(f.state.mode,version<3?'severe':'normal');assert.equal(f.state.theme,'dark');assert.equal(f.state.hideLikeCounts,true);assert.equal(f.state.keepNoteHeaderVisible,true);assert.deepEqual(f.state.tagGroups[0].tags,['Old']);
 }
});
test('mode明示時はlegacyModeを使わず、不正modeも現在値を維持',async()=>{
 for(const mode of ['normal','invalid']){const f=backend({mode:'social'});await f.load({mode,legacyMode:true});assert.equal(f.state.mode,mode==='normal'?'normal':'social');}
});
test('壊れたJSON・配列ルート・不正settings・上限超過は保存もルール変更もしない',async()=>{
 for(const text of ['{','null','[]','{"settings":null}','{"settings":[]}',' '.repeat(1048577)]){const f=backend(),before=plain(f.state);await assert.rejects(f.load(text));assert.deepEqual(f.state,before);assert.equal(f.writes,0);assert.equal(f.ruleCalls,0);}
});
test('有効項目なしでは保存しない。無視理由は返し未知データを保持しない',async()=>{
 const f=backend();for(const json of [{},{theme:42},{ollamaModel:'private'}]){const r=await f.load(json);assert.equal(r.importReport.applied.length,0);assert.equal(f.writes,0);assert.equal(f.ruleCalls,0);}
});
test('競合トークンにはテーマも含め、保存キュー内で変更を検知する',async()=>{
 const f=backend(),token=f.core.settingsToken(f.core.readSettings(f.state));await f.controller.save({theme:'dark'});await assert.rejects(f.controller.importSettings({json:'{"hideLikeCounts":true}',expectedToken:token}),e=>e.code==='CONFLICT');assert.equal(f.state.theme,'dark');assert.equal(f.state.hideLikeCounts,false);
});
test('取り込み保存失敗は旧配色・値を維持し、転送ルールを復旧',async()=>{
 const f=backend({theme:'dark'}),before=plain(f.state);f.fail=true;await assert.rejects(f.load({theme:'light',enabled:false}),/write failed/);assert.deepEqual(f.state,before);assert.equal(f.rules.length,2);assert.equal(f.writes,0);
});
test('UIに適用・無視の理由を表示し、クリアはJSONと結果だけを消す',async()=>{
 const f=homeFixture({state:{theme:'light'}});await flush();const n=f.nodes;n.get('settings-json').value=JSON.stringify({theme:'dark',hidePaidArticles:'wrong',ollamaSystemPrompt:'<script>secret</script>'});n.get('settings-json').fire('input');assert.match(n.get('transfer-report').textContent,/適用予定/);assert.match(n.get('transfer-report').textContent,/hidePaidArticles/);assert.equal(n.get('transfer-report').textContent.includes('secret'),false);await n.get('import-settings').onclick();await flush();assert.equal(f.state.theme,'dark');assert.match(n.get('transfer-report').textContent,/適用した項目/);assert.match(n.get('transfer-report').textContent,/ollamaSystemPrompt/);assert.equal(Object.hasOwn(f.state,'importReport'),false);const saved=plain(f.state);n.get('clear-settings-json').onclick();assert.equal(n.get('transfer-report').textContent,'');assert.deepEqual(f.state,saved);
});
test('UIの適用項目なしと壊れたJSONは読込不可。プレビューは別タブ変更後に再計算する',async()=>{
 const f=homeFixture();await flush();const n=f.nodes;for(const json of ['{}','{"theme":false}','{']){n.get('settings-json').value=json;n.get('settings-json').fire('input');assert.equal(n.get('import-settings').disabled,true);}
 n.get('settings-json').value='{"hideLikeCounts":true}';n.get('settings-json').fire('input');f.changed({theme:'dark'});await n.get('import-settings').onclick();await flush();assert.equal(f.state.theme,'dark');assert.equal(f.state.hideLikeCounts,true);
});
test('入力の__proto__と未知入れ子の値でプロトタイプや保存値を汚染しない',async()=>{
 const f=backend();await f.load('{"theme":"dark","__proto__":{"polluted":true},"tagGroups":[{"id":"group1","items":[{"type":"user","userId":"author_a","displayName":"A","__proto__":{"x":1}}]}]}');assert.equal({}.polluted,undefined);assert.equal(Object.hasOwn(f.state,'__proto__'),false);assert.deepEqual(f.state.tagGroups[0].tags,[{type:'user',userId:'author_a',displayName:'A'}]);
});
