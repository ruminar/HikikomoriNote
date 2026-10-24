"use strict";
class Element {
  constructor(tag, document) { this.tagName=tag.toUpperCase(); this.ownerDocument=document; this.children=[]; this.parentElement=null; this.attributes=new Map(); this.dataset={}; this.listeners={}; this.value=""; this.checked=false; this.disabled=false; this.hidden=false; this.nodeType=1; this.width=180; this._text=""; }
  set textContent(text) { this.replaceChildren(); this._text=String(text); }
  get textContent() { return this._text+this.children.map(child=>child.textContent).join(""); }
  get className() { return this.getAttribute("class")||""; } set className(value){this.setAttribute("class",value);}
  get classList(){return {contains:value=>this.className.split(/\s+/).includes(value)};}
  get isConnected(){return this===this.ownerDocument.root||Boolean(this.parentElement?.isConnected);}
  get href(){return this.getAttribute("href") ? new URL(this.getAttribute("href"),"https://note.com").href : "";} set href(value){this.setAttribute("href",value);}
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==="id")this.ownerDocument.nodes.set(String(value),this);if(key==="hidden")this.hidden=true;}
  getAttribute(key){return this.attributes.get(key)??null;}
  hasAttribute(key){return this.attributes.has(key);}
  removeAttribute(key){this.attributes.delete(key);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}}
  append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
  prepend(child){child.remove();child.parentElement=this;this.children.unshift(child);}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text="";this.append(...children);}
  contains(child){return child===this||this.children.some(node=>node.contains(child));}
  matches(selector){const match=/^([\w-]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);return !!match&&(!match[1]||this.tagName===match[1].toUpperCase())&&(!match[2]||(this.hasAttribute(match[2])&&(match[3]===undefined||this.getAttribute(match[2])===match[3])));}
  querySelectorAll(selector){const list=[];for(const child of this.children){if(selector.split(",").some(s=>child.matches(s.trim())))list.push(child);list.push(...child.querySelectorAll(selector));}return list;}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
  removeEventListener(type,listener){this.listeners[type]=(this.listeners[type]??[]).filter(fn=>fn!==listener);}
  fire(type,event={}){event.target??=this;event.preventDefault??=()=>{event.defaultPrevented=true;};event.stopPropagation??=()=>{};for(const fn of this.listeners[type]??[])fn(event);this[`on${type}`]?.(event);return event;}
  focus(){this.ownerDocument.activeElement=this;this.focused=true;}
  getBoundingClientRect(){return {width:this.width,x:0,top:0,height:40};}
}
function documentFromHtml(html="") {
 const doc={nodes:new Map(),activeElement:null,createElement(tag){return new Element(tag,this);},getElementById(id){return this.nodes.get(id);},querySelectorAll(selector){return this.root.querySelectorAll(selector);},querySelector(selector){return this.root.querySelector(selector);}};
 doc.root=doc.createElement("document");const stack=[doc.root];
 for(const match of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)){
  if(match[0].startsWith("</")){if(stack.length>1)stack.pop();continue;}
  const node=doc.createElement(match[1]);
  for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)){node.setAttribute(attr[1],attr[2]??"");if(attr[1]==="disabled")node.disabled=true;}
  stack.at(-1).append(node);
  if(!["input","meta","link","hr","br","img"].includes(match[1]))stack.push(node);
 }
 return doc;
}
module.exports={documentFromHtml};
