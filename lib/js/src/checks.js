import {chosenBoundaries,chosenBoundary} from "./chosen-boundaries.js";
// Checks read a chosen derivation without affecting recognition or ranking.
import {PatternMachine} from './patterns.js';
import {clauseChildren} from './clause-walk.js';
import {bodyTarget,withoutBinders} from './query-forms.js';
import {holds,settled} from './earley.js';
import {StringWalk} from './strings.js';
import {hooks,countWork} from './testing.js';

const ABSENT_CHECK_VALUE=Symbol('absent check value');

export class ChosenChecks {
  /** @param {import('./diagnostic-flow.js').DiagnosticFlow} flow
   * @param {import('./earley.js').ParseContext} context @param {Set<string>} features
   * @param {import('./types.js').LoweredGrammar['checks']} checks */
  constructor(flow,context,features,checks) {
    this.flow=flow;this.context=context;this.features=features;
    this.checks=checks;
    const patterns=this.checks.map(check=>check.pattern);
    const pending=/** @type {any[]} */(this.checks.flatMap(check=>check.conditions));
    const demanded=new Set();
    while(pending.length) {
      const node=pending.pop();if(node?.pattern)patterns.push(node.pattern);
      if(['followed-by','preceded-by'].includes(node?.method))for(const target of node.args)demanded.add(target.rule??target.terminal);
      for(const child of clauseChildren(node))pending.push(child);
    }
    this.patterns=new PatternMachine(patterns);
    /** @type {Map<any,any>} */ this.nodes=new Map();
    /** @type {Map<string,number>} */ this.identities=new Map();
    this.boundaries=chosenBoundaries(flow.root,demanded);
    /** @type {any} */ this.current=null;
    /** @type {import("./types.js").Scope} */
    this.scope={capture:()=>this.checkValue({capture:''}),checkValue:term=>this.checkValue(term),
      checkPresence:term=>this.node(term)!==null,checkTerminal:()=>this.current.terminal??'',
      localReading:term=>this.localReading(term),boundary:atom=>this.boundary(atom)};
    this.strings=new StringWalk(context,()=>this.scope,false);
    // Flatten helpers directly into the final child lists. Retaining each
    // recursive helper's expanded list duplicates every earlier prefix.
    /** @type {any[]} */ const roots=[];
    /** @type {any[]} */ const nodes=[];
    const stack=[{derivation:flow.root,into:roots}];
    while(stack.length) {
      const {derivation,into}=/** @type {NonNullable<ReturnType<typeof stack.pop>>} */(stack.pop());
      if('read' in derivation) {
        const node={kind:'token',terminal:derivation.read.terminal,derivation,children:[]};
        into.push(node);nodes.push(node);continue;
      }
      const rule=derivation.production;
      if(rule.erased) {
        const seal={kind:'seal',derivation,children:[]};
        if(rule.helper){into.push(seal);nodes.push(seal);}
        else {const node={kind:'rule',name:rule.lhs,derivation,children:[seal],erased:true};into.push(node);nodes.push(node,seal);}
        continue;
      }
      if(rule.elided!==null && derivation.children.length===0) {
        const node={kind:'elided',terminal:rule.elided,derivation,children:[]};into.push(node);nodes.push(node);continue;
      }
      let children=into;
      if(!rule.helper) {
        const node={kind:'rule',name:rule.lhs,derivation,children:[]};into.push(node);nodes.push(node);children=node.children;
      }
      for(let index=derivation.children.length-1;index>=0;index--)stack.push({derivation:derivation.children[index],into:children});
    }
    for(const node of nodes.slice().reverse()) {
      node.children=node.children.filter((/** @type {any} */ child)=>child.kept);
      node.kept=node.kind!=='rule' || node.children.length>0 || node.derivation===flow.root;
      if(node.kept)this.make(node);
    }
    for(const node of nodes)if(node.kept)for(const [index,child] of node.children.entries()) {
      child.parent=node;child.index=index;
    }
  }

  /** @param {any} node @returns {any} */
  make(node) {
    const {derivation,children}=node,{context}=this;
    node.start=derivation.start;node.end=derivation.end;node.parent=null;node.index=0;
    node.tags=node.kind==='elided'?new Set([node.terminal]):'read' in derivation
      ?context.tokens[derivation.read.token].tags:context.interner.get(derivation.item.tagId);
    const values=()=>context.tokens.slice(node.start,node.end).map(token=>token.value);
    const identity=node.kind==='rule'?['rule',node.name,children.map((/** @type {any} */ child)=>child.identity)]
      :node.kind==='seal'?['seal',values()]:node.kind==='elided'?['elided',node.terminal]:['token',node.terminal,values()[0]];
    const key=JSON.stringify(identity);
    let id=this.identities.get(key);if(id===undefined){id=this.identities.size;this.identities.set(key,id);}
    node.identity=id;
    if(node.kind==='seal')node.structure=this.patterns.seal;
    else {
      let sequence=this.patterns.empty;
      for(const child of children)sequence=this.patterns.concat(sequence,child.structure);
      const leaf=node.kind==='rule'?null:{terminal:node.terminal,value:node.kind==='elided'?'':values()[0],
        tags:node.kind==='elided'?new Set([node.terminal,'_Elided']):node.tags};
      node.structure=this.patterns.node(node.name??null,sequence,leaf,node.tags,this.patterns.nodeValues?values().join(''):undefined);
      this.nodes.set(derivation,node);
    }
    return node;
  }

  /** Presence is the sole observation that accepts an absent node.
   * @param {any} term @returns {any|null} */
  node(term) {
    if('capture' in term)return this.current;
    const receiver=this.node(term.receiver);if(!receiver)return null;
    if(term.method==='parent')return receiver.parent;
    const siblings=receiver.parent?.children;
    const found=siblings?.[receiver.index+(term.method==='preceding-node'?-1:1)];
    return found && found.kind!=='seal'?found:null;
  }

  /** @param {any} term @returns {any} */
  checkValue(term) {
    if(term.method==='preceding-element') {
      const node=this.node(term.receiver);if(!node)throw ABSENT_CHECK_VALUE;
      const element=this.preceding(node);if(!element)throw ABSENT_CHECK_VALUE;
      return element;
    }
    const node=this.node(term);if(!node)throw ABSENT_CHECK_VALUE;
    return {start:node.start,end:node.end,tags:node.tags,patterns:this.patterns,structure:node.structure,treeIdentity:node.identity,node};
  }

  /** @param {any} node @returns {any|null} */
  preceding(node) {
    let child=node.derivation;
    for(;;) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      const parent=this.flow.info(child).parent;if(!parent || 'read' in parent)return null;
      const at=parent.children.indexOf(child);
      let sequence=parent.production.elements??[];
      const ancestors=[];
      let index=sequence.findIndex(element=>element.from<=at && at<element.to);
      if(index<0)return null;
      while(sequence[index].children) {
        const inner=/** @type {NonNullable<import("./elements.js").Element["children"]>} */(sequence[index].children);
        const found=inner.findIndex(element=>element.from<=at && at<element.to);
        if(found<0)break;
        ancestors.push({sequence,index});sequence=inner;index=found;
      }
      while(index===0 && ancestors.length)({sequence,index}=/** @type {NonNullable<ReturnType<typeof ancestors.pop>>} */(ancestors.pop()));
      if(index>0) {
        const element=sequence[index-1];
        const start=parent.children[element.from]?.start??parent.end;
        const end=element.to===element.from?start:parent.children[element.to-1].end;
        const expression=element.written??this.expression(element.symbol);
        return {start,end,expression};
      }
      if(!parent.production.helper || parent.production.spliceOf)return null;
      child=parent;
    }
  }

  /** @param {any} symbol @returns {any} */
  expression(symbol) {
    return symbol.expression??this.context.lowered.elementExpressions.get(symbol.name)??{ref:symbol.name};
  }

  /** @param {any} term @returns {{start:number,rule:string}} */
  localReading(term) {
    const value=this.checkValue(term);
    let expression=value.expression;
    if(!expression) {
      const derivation=value.node.derivation,parent=this.flow.info(derivation).parent;
      expression=parent && !('read' in parent)?this.expression(parent.production.rhs[parent.children.indexOf(derivation)])
        :{ref:derivation.production.lhs};
    }
    return {start:value.start,rule:bodyTarget(this.context.lowered,withoutBinders(expression))};
  }

  /** @param {any} atom @returns {boolean} */
  boundary(atom) {
    return chosenBoundary(this.boundaries,atom,this.checkValue(atom.receiver));
  }

  /** @param {any} derivation @param {Set<string>} suppressed */
  *at(derivation,suppressed) {
    const node=this.nodes.get(derivation);
    if(!node || this.flow.info(derivation).erased)return;
    this.current=node;
    for(const check of this.checks) {
      if(check.warning && (!this.features.has(check.name)||suppressed.has('_')||suppressed.has(check.name)))continue;
      if(!this.patterns.matches(node.structure,check.pattern))continue;
      let passes=true;
      for(const condition of check.conditions) {
        try {if(!settled(()=>holds(this.context,condition,this.scope))){passes=false;break;}}
        catch(error){if(error!==ABSENT_CHECK_VALUE)throw error;passes=false;break;}
      }
      if(passes)yield {check,message:this.strings.item(derivation,/** @type {import("./types.js").Recipe} */(check.error??check.warning),check),node};
    }
  }
}
