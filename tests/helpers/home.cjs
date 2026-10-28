"use strict";
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {documentFromHtml}=require('./dom.cjs');
const settings=require('./settings.cjs');
const root=path.resolve(__dirname,'../..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
module.exports=function homeFixture(options={}) {
 const document=documentFromHtml(source('home.html')),nodes=document.nodes,moves=[],patches=[],copies=[],confirmations=[];
 let state={...settings(),noteUserId:'ruminar',...options.state},subscriber;
 const c=vm.createContext({URL,console,document,confirm:message=>{confirmations.push(message);return options.confirm?.(message) ?? true;},navigator:{clipboard:{writeText:async text=>{if(options.copyError)throw Error("copy failed");copies.push(text);}}},location:{assign:url=>moves.push(url),hash:options.hash??''}});
 vm.runInContext(source('src/common.js'),c);vm.runInContext(source('src/routing.js'),c);
 const controller=c.HikikomoriNoteRouting.createController({load:async()=>state,setRules:async()=>{},store:async next=>{await options.saveGate;if(options.saveError)throw new Error('save failed');state=plain(next);if(options.notifyOnStore)subscriber?.(state);}});
 c.HikikomoriNotePlatform={goBackUnrestricted:()=>moves.push("back"),getState:async()=>{if(options.stateError)throw new Error('state failed');return controller.getState();},save:async patch=>{patches.push(plain(patch));return controller.save(patch);},importSettings:async patch=>{if(options.importUnconfirmed)throw Object.assign(new Error("保存結果未確認"),{code:"UNCONFIRMED"});return controller.importSettings(patch);},tag:async operation=>{if(options.unconfirmed)throw Object.assign(new Error('保存結果未確認'),{code:'UNCONFIRMED'});return controller.tag(operation);},subscribe:fn=>{subscriber=fn;}};
 vm.runInContext(source('src/home.js'),c);
 return {c,document,nodes,moves,patches,copies,confirmations,options,get state(){return state;},changed(value){state={...state,...value};subscriber?.(state);}};
};
