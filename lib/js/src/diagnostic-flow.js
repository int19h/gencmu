import {NO_DIAGNOSTICS} from "./tokens.js";
// Diagnostic identity, reporting collections, and emission owners (§11.5, §12.1).
import {diagnosticRecord} from './measures.js';

/** @typedef {import('./types.js').Derivation} Derivation */
/** @typedef {import('./types.js').ParseWarning} Diagnostic */
/** @typedef {{errors:Diagnostic[],warnings:Diagnostic[]}} DiagnosticLists */
/** @typedef {{node:Derivation,diagnostic:Diagnostic,kind:'errors'|'warnings',own:boolean}} DiagnosticEvent */
/** @typedef {{parent:Derivation|null,erased:boolean,scope:EmissionScope}} NodeInfo */
/** @typedef {{root:Derivation,rows:Carrier[],carrier:Carrier|null,unowned:DiagnosticLists}} EmissionScope */
/** @typedef {{token:import('./tokens.js').AttachedToken,span:import('./types.js').Span,part:Derivation|null,emission:Derivation,scope:EmissionScope,support:import('./types.js').Span|null,own:DiagnosticLists,groups:(EmissionScope|import('./tokens.js').AttachedToken)[]}} Carrier */

/** @returns {DiagnosticLists} */
export function emptyDiagnostics(){return {errors:[],warnings:[]};}
/** @param {Diagnostic} diagnostic */
export function diagnosticIdentity(diagnostic){return diagnosticRecord(diagnostic).identity;}

/** @param {DiagnosticLists[]} lists @returns {DiagnosticLists} */
export function joinDiagnostics(lists){
  const result=emptyDiagnostics();
  for(const kind of /** @type {const} */(['errors','warnings'])){
    const seen=new Set();
    for(const list of lists)for(const diagnostic of list[kind]){
      const identity=diagnosticIdentity(diagnostic);
      if(!seen.has(identity)){seen.add(identity);result[kind].push(diagnostic);}
    }
  }
  return result;
}

/** @param {import('./tokens.js').Token[]} tokens @param {number} [end] */
export function inputDiagnostics(tokens,end=tokens.length){
  return joinDiagnostics(tokens.slice(0,end).map(token=>({errors:token.errors,warnings:token.warnings})));
}

/** @param {Diagnostic[]} list */
function ordered(list){
  return list.slice().sort((left,right)=>{
    const a=/** @type {{stageOrder?:number,ordinal?:number}} */(diagnosticIdentity(left));
    const b=/** @type {{stageOrder?:number,ordinal?:number}} */(diagnosticIdentity(right));
    return (a.stageOrder??0)-(b.stageOrder??0)||(a.ordinal??0)-(b.ordinal??0);
  });
}

/** @param {Diagnostic} diagnostic */
function objectKey(diagnostic){
  return JSON.stringify([diagnostic.stage,diagnostic.code,diagnostic.rule,diagnostic.span,diagnostic.source,diagnostic.message,/** @type {any} */(diagnostic).rejection??null]);
}

/** @param {DiagnosticEvent[]} first @param {DiagnosticEvent[]} second @returns {DiagnosticLists} */
export function tiedDiagnostics(first,second){
  const result=emptyDiagnostics();
  for(const kind of /** @type {const} */(['errors','warnings'])){
    const carried=new Set(),counts=new Map(),later=new Map();
    for(const [reading,events] of [first,second].entries())for(const event of events){
      if(event.kind!==kind)continue;
      const diagnostic=event.diagnostic;
      if(!event.own){
        const id=diagnosticIdentity(diagnostic);if(carried.has(id))continue;carried.add(id);
      }else{
        const key=objectKey(diagnostic),table=reading===0?counts:later,n=(table.get(key)??0)+1;
        table.set(key,n);if(reading===1&&n<=(counts.get(key)??0))continue;
      }
      result[kind].push(diagnostic);
    }
  }
  return result;
}

export class DiagnosticFlow {
  /** @param {Derivation} root @param {import('./tokens.js').Token[]} input */
  constructor(root,input){
    this.root=root;this.input=input;
    /** @type {Map<Derivation,NodeInfo>} */ this.nodes=new Map();
    /** @type {Derivation[]} */ this.order=[];
    /** @type {Map<Derivation,DiagnosticEvent>} */ this.own=new Map();
    /** @type {DiagnosticEvent[]} */ this.evaluated=[];
    /** @type {Map<Derivation,EmissionScope>} */ this.scopeRoots=new Map();
    /** @type {WeakMap<object,Carrier>} */ this.carriers=new WeakMap();
    this.main=/** @type {EmissionScope} */({root,rows:[],carrier:null,unowned:emptyDiagnostics()});
    this.scopes=[this.main];
    /** @type {Map<EmissionScope,EmissionScope>} */ this.reportGroups=new Map();
    const live=new Array(input.length).fill(0);
    const pending=[{node:root,parent:/** @type {Derivation|null} */(null),erased:false}];
    while(pending.length){
      const {node,parent,erased:outer}=/** @type {NonNullable<ReturnType<typeof pending.pop>>} */(pending.pop());
      const erased=outer||!('read'in node)&&node.production.erased;
      this.nodes.set(node,{parent,erased,scope:this.main});this.order.push(node);
      if('read'in node){if(!erased)live[node.read.token]=1;}
      else for(let index=node.children.length-1;index>=0;index--)pending.push({node:node.children[index],parent:node,erased});
    }
    this.prefix=[0];for(const bit of live)this.prefix.push(this.prefix[this.prefix.length-1]+bit);
    this.next=new Array(input.length+1);this.next[input.length]=input.length;
    for(let index=input.length-1;index>=0;index--)this.next[index]=live[index]?index:this.next[index+1];
    this.previous=[0];for(let index=0;index<input.length;index++)this.previous.push(live[index]?index+1:this.previous[index]);
  }
  /** @param {Derivation} node @returns {NodeInfo} */
  info(node){const info=this.nodes.get(node);if(!info)throw new Error('An emission part requires its chosen occurrence.');return info;}
  /** @param {Derivation} node @param {Diagnostic} diagnostic @param {'errors'|'warnings'} kind */
  add(node,diagnostic,kind){
    const event={node,diagnostic,kind,own:true};this.own.set(node,event);this.evaluated.push(event);
  }
  /** @returns {DiagnosticLists} */
  messages(){
    const result=emptyDiagnostics();for(const event of this.evaluated)result[event.kind].push(event.diagnostic);return result;
  }
  /** Surviving chosen preorder, before output-node omission. @returns {DiagnosticEvent[]} */
  events(){
    const result=[];
    for(const node of this.order){
      if(this.info(node).erased)continue;
      const own=this.own.get(node);if(own)result.push(own);
      if('read'in node)for(const kind of /** @type {const} */(['errors','warnings']))for(const diagnostic of this.input[node.read.token][kind])result.push({node,diagnostic,kind,own:false});
    }
    return result;
  }
  /** @returns {DiagnosticLists} */
  collected(){
    const result=emptyDiagnostics(),events=this.events(),groups=new Map(),seen=new Set();
    for(const event of events){
      const group=this.reportGroups.get(this.info(event.node).scope);
      if(group){const list=groups.get(group)??emptyDiagnostics();list[event.kind].push(event.diagnostic);groups.set(group,list);}
    }
    for(const event of events){
      const group=this.reportGroups.get(this.info(event.node).scope);
      if(!group){result[event.kind].push(event.diagnostic);continue;}
      if(seen.has(group))continue;
      seen.add(group);
      const list=joinDiagnostics([groups.get(group)]);
      for(const kind of /** @type {const} */(['errors','warnings']))for(const diagnostic of ordered(list[kind]))result[kind].push(diagnostic);
    }
    return joinDiagnostics([result]);
  }
  /** @param {Derivation} root @returns {EmissionScope} */
  attachment(root){
    const scope={root,rows:[],carrier:null,unowned:emptyDiagnostics()};
    this.scopeRoots.set(root,scope);this.scopes.push(scope);return scope;
  }
  /** @param {number} start @param {number} end */
  count(start,end){return this.prefix[end]-this.prefix[start];}
  /** @param {import('./tokens.js').Token} token @param {Derivation|null} part @param {Derivation} emission @param {EmissionScope} scope */
  emitted(token,part,emission,scope){
    const support=part&&this.count(part.start,part.end)?/** @type {import('./types.js').Span} */([this.next[part.start],this.previous[part.end]]):null;
    const row={token,span:token.span,part,emission,scope,support,own:emptyDiagnostics(),groups:[]};
    scope.rows.push(row);this.carriers.set(token,row);return row;
  }
  /** @param {object} original @param {import('./tokens.js').AttachedToken} copy */
  attached(original,copy){const row=this.carriers.get(original);if(row){row.token=copy;this.carriers.set(copy,row);}}
  /** @param {import('./tokens.js').Token} token @param {EmissionScope[]} before @param {EmissionScope[]} after @param {import('./tokens.js').AttachedToken[]} inheritedBefore @param {import('./tokens.js').AttachedToken[]} inheritedAfter */
  attachments(token,before,after,inheritedBefore,inheritedAfter){
    const row=this.carriers.get(token);if(!row)throw new Error('An attachment requires its emitted carrier.');row.groups=[...before,...inheritedBefore,...inheritedAfter,...after];
    for(const scope of [...before,...after])scope.carrier=row;
  }
  /** @param {EmissionScope} scope @returns {DiagnosticLists} */
  all(scope){
    const joined=joinDiagnostics([scope.unowned,...scope.rows.map(row=>({errors:row.token.errors,warnings:row.token.warnings}))]);
    return {errors:ordered(joined.errors),warnings:ordered(joined.warnings)};
  }
  /** @returns {DiagnosticLists} */
  assign(){
    for(const node of this.order){
      const info=this.info(node),parent=info.parent?this.info(info.parent).scope:this.main;
      info.scope=this.scopeRoots.get(node)??parent;
      if(info.scope!==parent)this.reportGroups.set(info.scope,this.reportGroups.get(parent)??info.scope);
    }
    const buckets=new Map(),emissions=new Map(),nearest=new Map();
    for(const event of this.events()){
      const scope=this.info(event.node).scope,list=buckets.get(scope)??[];list.push(event);buckets.set(scope,list);
    }
    for(const scope of this.scopes)for(const row of scope.rows){const list=emissions.get(row.emission)??[];list.push(row);emissions.set(row.emission,list);}
    for(const node of this.order){
      const info=this.info(node),rows=emissions.get(node);
      nearest.set(node,rows?.length?rows:info.parent&&this.info(info.parent).scope===info.scope?nearest.get(info.parent):null);
    }
    for(const scope of this.scopes){
      const supported=/** @type {(Carrier & {support:import("./types.js").Span})[]} */(scope.rows.filter(row=>row.support!==null));
      /** @param {Derivation} node */
      const owner=node=>{
        if(this.count(node.start,node.end)){
          let low=0,high=supported.length;
          while(low<high){const mid=(low+high)>>>1;if(supported[mid].support[1]<=node.start)low=mid+1;else high=mid;}
          const row=supported[low];
          if(row&&row.support[0]<node.end&&this.count(Math.max(node.start,row.support[0]),Math.min(node.end,row.support[1])))return row;
        }
        const rows=nearest.get(node);
        if(rows?.length){
          let low=0,high=rows.length;
          while(low<high){const mid=(low+high)>>>1;if((rows[mid].support??rows[mid].span)[1]<node.start)low=mid+1;else high=mid;}
          return rows[low]??rows[rows.length-1];
        }
        let low=0,high=scope.rows.length;
        while(low<high){const mid=(low+high)>>>1;if(scope.rows[mid].span[0]<node.start)low=mid+1;else high=mid;}
        return scope.rows[low]??scope.rows[scope.rows.length-1]??null;
      };
      for(const event of buckets.get(scope)??[]){
        const row=owner(event.node);(row?row.own:scope.unowned)[event.kind].push(event.diagnostic);
      }
    }
    for(const scope of this.scopes.slice().reverse())for(const row of scope.rows){
      const groups=row.groups.map(group=>'rows'in group?this.all(group):{errors:group.errors,warnings:group.warnings});
      for(const kind of /** @type {const} */(['errors','warnings'])){
        const displayed=new Set(groups.flatMap(group=>group[kind].map(diagnosticIdentity)));
        const own=ordered(row.own[kind].filter(diagnostic=>!displayed.has(diagnosticIdentity(diagnostic))));
        const list=joinDiagnostics([{errors:kind==='errors'?own:[],warnings:kind==='warnings'?own:[]},...groups])[kind];
        row.token[kind]=list.length?list:NO_DIAGNOSTICS;
      }
    }
    return this.main.unowned;
  }
}

// The pipeline reads these collections without retaining a packed forest.
/** @type {WeakMap<object,{collected:DiagnosticLists,evaluated:DiagnosticLists}>} */
export const stageDiagnostics=new WeakMap();
