// Load-time template expansion (engine §2.3). Source DOMs stay unresolved.
import { expandedDomProblem } from "./dom.js";
import { copyRankedLocation } from "./ranked.js";
import { copyRecipeLocation } from "./recipes.js";
import { copyBoundaryLocation } from "./boundary.js";
import { GencmuError } from "./errors.js";
import { stringName } from "./tags.js";
import { layeredPatternText, copyPatternLocation } from "./pattern-shapes.js";

import { hasUnresolved, argumentOfExpression, normalizeArgument, patternTerm, patternConstantNames, sourceKeys } from "./template-nodes.js";
export { hasUnresolved, argumentOfExpression, normalizeArgument } from "./template-nodes.js";

/** @param {any} node @returns {string[]} */
function orderedKeys(node) {
  const order = ['if', 'then', 'op', 'left', 'right', 'not', 'any', 'all', 'body', 'targets', 'requirements', 'negated', 'value', 'pattern', 'child', 'children', 'expr', 'repeat', 'separator', 'optional', 'seq', 'choice', 'ranked', 'and', 'union', 'intersection', 'difference', 'concat', 'items', 'tags', 'image', 'before', 'after'];
  return [...order.filter(key=>Object.hasOwn(node,key)), ...Object.keys(node).filter(key=>key!=='at' && !order.includes(key)).sort()];
}


/** @param {any} value @param {Set<string>} [patterns] @returns {any} */
function normalizeTemplateArgument(value, patterns = new Set()) {
  return normalizeArgument(value,(source,target)=>{
    copyRankedLocation(source,target);
    copyRecipeLocation(source,target);
    copyBoundaryLocation(source,target);
    copyPatternLocation(source,target);
  },patterns);
}

/** @param {any} test @returns {any} */
function distributeFamilyTest(test) {
  for(const key of ['union','intersection','difference']) if(test.expr?.[key]) {
    const result={ [key]:test.expr[key].map((/** @type {any} */ part)=>distributeFamilyTest({...test,expr:part})) };
    copyPatternLocation(test,result);
    return result;
  }
  return test;
}

/** @param {any} value @returns {any} */
function templateIdentity(value) {
  if(Array.isArray(value)) return value.map(templateIdentity);
  if(!value || typeof value!=="object") return value;
  return Object.fromEntries(Object.keys(value).filter((/** @type {any} */ k)=>k!=="at").sort().map((/** @type {any} */ k)=>[k,templateIdentity(value[k])]));
}

/** @param {any} root @returns {any[]} */
function templateNodes(root) {
  const found=[],pending=[root];
  while(pending.length) {
    const n=pending.pop();
    if(!n || typeof n!=="object") continue;
    if(!Array.isArray(n)) found.push(n);
    const children=(Array.isArray(n) ? n : sourceKeys(n).filter(k=>k!=="at").map(k=>n[k])).filter(v=>v && typeof v==="object");
    for(let i=children.length-1;i>=0;i--) pending.push(children[i]);
  }
  return found;
}

/** @param {any} value @param {any} unicode @returns {string} */
function templateQuoted(value,unicode) { return stringName(value,unicode); }

/** @param {any} n @param {any} unicode @returns {string} */
export function canonicalArgument(n,unicode) {
  const print=(/** @type {any} */ x)=>canonicalArgument(x,unicode);
  if(n.set instanceof Set) return [...n.set].sort().join(' ') || '∅';
  if(n.call) return `${n.call}(${n.args.map(print).join(", ")})`;
  if(n.param) return '@'+n.param;
  if(n.integer || n.classifier) return n.integer??n.classifier;
  if(n.rule || n.tag || n.terminal || n.ref || n.name) return n.rule??n.tag??n.terminal??n.ref??n.name;
  if(n.const || n.constant) return '$'+(n.const??n.constant);
  if('string' in n) return templateQuoted(n.string,unicode);
  if(n.literal) return print(n.literal);
  if(n.range) return n.range.map(print).join('..');
  if(n.wildcard) return '_';
  if(n.empty) return 'ε';
  if(n.emptySet) return '∅';
  if(n.requirements && !n.test) return '<'+n.requirements.flatMap((/** @type {any} */ x)=>x.value.set instanceof Set ? [...x.value.set].sort().map(tag=>(x.negated?'¬':'')+tag) : [(x.negated?'¬':'')+print(x.value)]).join(' ')+'>';
  if(n.targets) return n.targets.map(print).join(' | ');
  if(n.body) {
    const body=templateBodyText(n.body,unicode);
    return n.body.empty || n.body.optional || n.body.repeat ? body : '('+body+')';
  }
  if(n.test) return print(n.expr)+(n.test==='tags'?print({requirements:n.requirements}):n.test+print(n.value));
  if(n.pattern) return layeredPatternText(n.pattern,x=>canonicalArgument(x,unicode));
  if(n.concat || n.union || n.intersection || n.difference) {
    const key=/** @type {string} */ (['concat','union','intersection','difference'].find((/** @type {any} */ k)=>n[k]));
    const values=n[key];
    if(key==='union' && (values.every((/** @type {any} */ x)=>x.tag) || values.every((/** @type {any} */ x)=>'string' in x))) return values.map(print).join(' ');
    const op={concat:' ++ ',union:' ∪ ',intersection:' ∩ ',difference:' ∖ '}[key];
    return values.map((/** @type {any} */ x,/** @type {number} */ i)=>templateTermGroup(x,key,i)?'('+print(x)+')':print(x)).join(op);
  }
  if(n.method) {
    const receiver=print(n.receiver);
    const grouped=templateTermGroup(n.receiver,'method',0);
    return (grouped?'('+receiver+')':receiver)+'.'+n.method+(n.args.length?'('+n.args.map(print).join(['matches','begins','ends','followed-by','preceded-by'].includes(n.method)?' | ':', ')+')':'');
  }
  if(n.capture!==undefined) return '$'+n.capture;
  if(n.if) return (templateBooleanGroup(n.if,'if')?'('+print(n.if)+')':print(n.if))+' ⟹ '+print(n.then);
  if(n.op) return [n.left,n.right].map(x=>x.if?'('+print(x)+')':print(x)).join(' '+n.op+' ');
  if(n.not) return '¬'+(templateBooleanGroup(n.not,'not')?'('+print(n.not)+')':print(n.not));
  if(n.any || n.all) {
    const key=n.any?'any':'all';
    return n[key].map((/** @type {any} */ x)=>templateBooleanGroup(x,key)?'('+print(x)+')':print(x)).join(n.any?' ∨ ':' ∧ ');
  }
  if(n.splice) return "*"+print(n.splice);
  if(n.captured!==undefined) return '$'+n.captured;
  throw new Error('unprintable argument '+JSON.stringify(n));
}

/** @param {any} n @param {string} parent @param {number} index @returns {boolean} */
function templateTermGroup(n,parent,index) {
  if(n.if) return true;
  const key=['concat','union','intersection','difference'].find(k=>k in n);
  if(!key) return false;
  const run=key==='union' && (n.union.every((/** @type {any} */ x)=>x.tag) || n.union.every((/** @type {any} */ x)=>'string' in x));
  if(run) return parent==='intersection' || parent==='difference';
  /** @type {Record<string,number>} */
  const priority={union:1,difference:1,intersection:2,concat:3,method:4};
  return priority[key]<priority[parent] || (priority[key]===priority[parent] && (parent==='intersection' || index>0 && (parent==='union' || parent==='difference')));
}

/** @param {any} n @param {string} parent @returns {boolean} */
function templateBooleanGroup(n,parent) {
  const key=['if','any','all','not'].find(k=>k in n);
  if(!key) return false;
  /** @type {Record<string,number>} */
  const priority={if:1,any:2,all:3,not:4};
  return priority[key]<priority[parent] || priority[key]===priority[parent] && parent!=='not';
}

/** @param {any} n @param {any} unicode @param {string} [parent] @returns {string} */
function templateBodyText(n,unicode,parent='') {
  const key=['seq','and','choice','ranked'].find((/** @type {any} */ k)=>n[k]);
  if(key) {
    /** @type {Record<string,number>} */
    const priority={seq:3,and:2,choice:1,ranked:1};
    const text=n[key].map((/** @type {any} */ x)=>templateBodyText(x,unicode,key)).join({seq:' ',and:' & ',choice:' | ',ranked:' ≻ '}[key]);
    return parent && priority[key]<=priority[parent]?'('+text+')':text;
  }
  if(n.optional) {
    const parts = n.optional.seq ?? [n.optional];
    const head = templateBodyText(parts[0],unicode) + (n.default === undefined ? '' : ' ≝ ' + canonicalArgument(n.default,unicode));
    return '['+(n.elidable?'+':'')+[head,...parts.slice(1).map((/** @type {any} */ part)=>templateBodyText(part,unicode))].join(' ')+']';
  }
  if(n.repeat) return '{'+(n.chain==='left'?'... ':'')+templateBodyText(n.repeat,unicode)+(n.chain==='right'?' ...':'')+(n.separator?' / '+templateBodyText(n.separator,unicode):'')+'}';
  return canonicalArgument(n,unicode);
}

/** @param {any[]} documents @param {any} unicode @returns {any} */
export function expandTemplates(documents,unicode) {
  if(!documents.some((/** @type {any} */ d)=>hasUnresolved(d.dom))) return {documents,order:null,templates:[],instances:[]};
  const patterns=patternConstantNames(documents.flatMap(d=>d.dom.constants));
  const normalize=(/** @type {any} */ value)=>normalizeTemplateArgument(value,patterns);
  const templates=new Map(), names=new Map(), instances=new Map();
  /** @type {string[]} */ const slots=[];
  /** @type {any[]} */ const events=[];
  /** @type {any[]} */ const queue=[];
  /** @type {any[]} */ const extraEvents=[];
  /** @type {any[]} */ const sourceEvents=[];
  /** @type {(event:any,node:any,message:string)=>never} */
  const fail=(event,node,message)=>{
    const at=node?.at??event.rule.at;
    const context=event.origin ? `, in ${event.instance} called at ${event.origin.document}:${event.origin.at[0]}:${event.origin.at[1]}` : '';
    throw new GencmuError('grammar',`${event.path}:${at[0]}:${at[1]}: ${message}${context}`,{document:event.path,line:at[0],column:at[1],...(message.startsWith('unbounded-instantiation:')?{code:'unbounded-instantiation'}:{})});
  };
  let serial=0;
  for(const [inspectionRun, document] of documents.entries()) {
    const declarations=['rules','constants','directives','classifiers','implications'].flatMap(kind=>document.dom[kind].map((/** @type {any} */ rule)=>({kind,rule}))).sort((a,b)=>a.rule.at[0]-b.rule.at[0]||a.rule.at[1]-b.rule.at[1]);
    for(const {kind,rule} of declarations) {
    const event={path:document.path,rule,index:serial++,inspectionRun,kind:['rules','directives','constants','classifiers','implications'].indexOf(kind)};
    sourceEvents.push(event);
    if(kind!=='rules') {extraEvents.push(event);continue;}
    events.push(event);
    if(rule.params) {
      const previous=templates.get(rule.name);
      if(rule.op==='define') {
        if(previous || names.has(rule.name)) fail(event,rule,`duplicate template ${rule.name}`);
        templates.set(rule.name,{name:rule.name,arity:rule.params.length,events:[event],at:rule.at,path:event.path});
      } else {
        if(!previous || previous.arity!==rule.params.length) fail(event,rule,`template ${rule.name} requires an earlier declaration with the same arity`);
        previous.events.push(event);
      }
    } else if(!rule.args) {
      if(templates.has(rule.name)) fail(event,rule,'a template and an ordinary rule cannot share a name');
      const previous=names.get(rule.name);
      if(rule.op==='define') {
        if(previous) fail(event,rule,`duplicate rule ${rule.name}`);
        names.set(rule.name,{events:[event],binding:null});slots.push(rule.name);
      } else {
        if(!previous) fail(event,rule,`${rule.name} requires an earlier definition`);
        previous.events.push(event);
      }
    }
  }
  }
  // Inspect every definition, including discarded and uncalled definitions.
  const edges=new Map();
  for(const template of templates.values()) for(let i=0;i<template.arity;i++) edges.set(template.name+':'+i,[]);
  for(const event of sourceEvents) {
    const {rule}=event,params=rule.params??[];
    for(const n of templateNodes(rule)) {
      if(n.param && !params.includes(n.param)) fail(event,n,`undeclared parameter @${n.param}`);
      if(!n.call) continue;
      const target=templates.get(n.call);
      if(!target) fail(event,n,`unknown template ${n.call}`);
      if(n.args.length!==target.arity) fail(event,n,`template ${n.call} expects ${target.arity} arguments`);
      n.args.forEach((/** @type {any} */ arg,/** @type {number} */ i)=>{
        let normalized;
        for(const part of templateNodes(arg)) {
          if(part.capture!==undefined || part.captured!==undefined) fail(event,part,'an argument cannot read or declare captures');
          if(part.param && params.includes(part.param)) edges.get(rule.name+':'+params.indexOf(part.param))?.push({to:n.call+':'+i,growing:(normalized??=normalize(arg)).param!==part.param,event,node:n,argument:arg});
        }
      });
    }
  }
  // Every growing edge must lack a return path. Unchanged cycles are finite.
  for(const [from,list] of edges) for(const edge of list) if(edge.growing) {
    const pending=[{to:edge.to,previous:/** @type {any} */ (null)}],seen=new Set();
    while(pending.length) {
      const state=pending.pop();
      if(!state) break;
      if(state.to===from) {
        const steps=[];
        for(let step=state.previous;step;step=step.previous) steps.push(step);
        steps.reverse();
        const cycle=[{from,edge},...steps];
        const trail=cycle.map(({from,edge})=>`${from} → ${edge.to} at ${edge.event.path}:${edge.node.at[0]}:${edge.node.at[1]}`).join(' then ');
        fail(edge.event,edge.node,`unbounded-instantiation: ${trail}, growing argument ${canonicalArgument(edge.argument,unicode)}`);
      }
      if(seen.has(state.to)) continue;
      seen.add(state.to);
      for(const next of edges.get(state.to)??[]) pending.push({to:next.to,previous:{from:state.to,edge:next,previous:state.previous}});
    }
  }
  /** @type {(call:any,event:any,discover?:boolean)=>any} */
  const intern=(call,event,discover=false)=>{
    const signature=templates.get(call.call);
    if(!signature || !Array.isArray(call.args) || signature.arity!==call.args.length) fail(event,call,'an instance call requires the declared arity');
    const args=call.args.map(normalize);
    const normalized={call:call.call,args,at:call.at};
    const key=JSON.stringify(templateIdentity(normalized));
    if(!instances.has(key)) {
      const item={key,call:normalized,canonical:canonicalArgument(normalized,unicode),name:null,origin:{document:event.path,at:call.at},locals:[],definitions:[]};
      instances.set(key,item);
    }
    const instance=instances.get(key);
    if(discover && !instance.discovered) {
      instance.discovered=true;instance.origin={document:event.path,at:call.at};queue.push(instance);
    }
    return instance;
  };
  /** @type {(root:any,event:any,record?:typeof intern)=>void} */
  const discover=(root,event,record=intern)=>{
    /** @type {(n:any)=>void} */
  const visit=(/** @type {any} */ n)=>{
      if(!n || typeof n!=='object') return;
      if(Array.isArray(n)) { n.forEach(visit); return; }
      if(n.alternatives) {
        n.alternatives.forEach((/** @type {any} */ alternative,/** @type {number} */ index)=>{
          visit(alternative.expr);visit(alternative.tags);visit(alternative.value);visit(alternative.image);
          if(index===0) {
            visit(n.tags);visit(n.value);visit(n.image);visit(n.conditions);visit(n.error);visit(n.warning);visit(n.emit);
          }
        });
        return;
      }
      const children=n.method?[n.receiver,n.args]:n.call?[n.args]:orderedKeys(n).map(key=>n[key]);
      for(const value of children) {
        if(Array.isArray(value)) value.forEach(visit);else if(value && typeof value==='object') visit(value);
      }
      if(n.call && !templateNodes(n.args).some((/** @type {any} */ x)=>x.param)) record(n,event,true);
      if(n.call && n.children) visit(n.children);
    };
    visit(root);
  };
  // Resolve public-name edits at their written position, before final bindings.
  const current=new Map(),ordinary=new Map();
  for(const event of events) {
    const {rule}=event;
    if(rule.params) continue;
    if(rule.args) {
      const template=templates.get(rule.name);
      if(!template || template.events[0].index>=event.index) fail(event,rule,'an instance edit requires an earlier template');
      const instance=intern({call:rule.name,args:rule.args,at:rule.at},event);instance.locals.push(event);
      continue;
    }
    if(rule.instance) {
      const instance=intern(rule.instance,event),old=current.get(rule.name);
      if(instance.name && instance.name!==rule.name) fail(event,rule,'an instance has at most one public name');
      if(old===instance) fail(event,rule,'repeating an instance binding is invalid');
      if(old) {old.name=null;old.binding=null;}
      instance.name=rule.name;instance.binding={document:event.path,line:rule.at[0],column:rule.at[1]};current.set(rule.name,instance);ordinary.delete(rule.name);
    } else if(current.has(rule.name)) current.get(rule.name).locals.push(event);
    else {
      const list=ordinary.get(rule.name)??[];list.push(event);ordinary.set(rule.name,list);
    }
  }
  /** @type {(list:any[])=>any[]} */
  const retained=(/** @type {any} */ list)=>{
    let start=0;
    list.forEach((/** @type {any} */ event,/** @type {number} */ i)=>{if(event.rule.op!=='extend') start=i;});
    return list.slice(start);
  };
  const extraIndexes=new Set(extraEvents.map(event=>event.index));
  const retainedIndexes=new Set();
  /** @param {any[][]} histories */
  const rememberRetained=(...histories)=>{
    let first=0;
    for(const history of histories) for(const event of history) if(event.rule.op!=='extend') first=Math.max(first,event.index);
    for(const history of histories) for(const event of history) if(event.index>=first) retainedIndexes.add(event.index);
  };
  for(const template of templates.values()) rememberRetained(template.events);
  for(const history of ordinary.values()) rememberRetained(history);
  for(const instance of instances.values()) rememberRetained(templates.get(instance.call.call).events,instance.locals);
  // Complete the source pass before processing expanded definitions.
  for(const event of sourceEvents) {
    const rule=event.rule;
    if(extraIndexes.has(event.index)) {discover(rule,event);continue;}
    if(rule.instance) {discover(rule.instance,event);continue;}
    if(rule.args) discover({call:rule.name,args:rule.args,at:rule.at},event);
    if(retainedIndexes.has(event.index)) {
      const body={...rule};delete body.args;
      discover(body,event);
    }
  }
  /** @type {(arg:any,position:string,event:any,use:any)=>any} */
  const convert=(arg,position,event,use)=>{
    arg=normalize(arg);
    if(position==='arg') return arg;
    if(position==='expr') {
      if(arg.body) return arg.body;
      if(arg.targets) return {choice:arg.targets.map((/** @type {any} */ x)=>convert(x,'expr',event,use))};
      if(arg.rule || arg.tag || arg.terminal) return {ref:arg.rule??arg.tag??arg.terminal};
      if('string' in arg || arg.const) return {literal:arg};
      if(arg.call || arg.splice || arg.test || arg.range || arg.wildcard) return arg;
    } else if(position==='pattern') {
      if(arg.rule) return {name:arg.rule,at:use.at};
      if(arg.tag || arg.terminal) return {terminal:arg.tag??arg.terminal,at:use.at};
      if(arg.pattern) return arg.pattern;
      if('string' in arg) return {literal:arg,at:use.at};
      if(arg.const) return {constant:arg.const,at:use.at};
      if(arg.test) return {...arg,expr:convert(argumentOfExpression(arg.expr),'pattern',event,use)};
      if(arg.range || arg.wildcard || arg.call) return {...arg,at:use.at};
    } else if(position==='target') {
      if(arg.tag) return {terminal:arg.tag};
      if(arg.rule || arg.terminal || arg.call) return arg;
    } else if(position==='term' && !arg.body && !arg.targets && !arg.requirements && !arg.rule && !arg.call && !arg.splice && !arg.test && !arg.range && !arg.wildcard) return arg;
    fail(event,use,`argument ${canonicalArgument(arg,unicode)} is invalid at @${use.param} in ${position} position`);
  };
  /** @type {(root:any,env:Map<string,any>,event:any,position?:string)=>any} */
  const substitute=(root,env,event,position='term')=>{
    if(!root || typeof root!=='object') return root;
    if(Array.isArray(root)) return root.map((/** @type {any} */ x)=>substitute(x,env,event,position));
    if(root.param) {
      const converted=convert(env.get(root.param),position,event,root);
      if(position!=='pattern' || !root.exact && !('children' in root)) return converted;
      if(['union','intersection','difference','path'].some(key=>key in converted)) fail(event,root,'a compound pattern cannot carry node decorations');
      const result={...converted};
      if(root.exact) {
        if(converted.exact) fail(event,root,'an exact prefix conflicts with an argument prefix');
        result.exact=true;
      }
      if('children' in root) {
        if(!('name' in converted || 'call' in converted) || 'children' in converted) fail(event,root,'an attached list requires a rule test without children');
        result.children=substitute(root.children,env,event,'pattern-item');
      }
      return result;
    }
    /** @type {Record<string,any>} */
  const result={};
    for(const key of sourceKeys(root)) {
      const value=root[key];
      if(key==='at') {result.at=value;continue;}
      if(key==='args' && root.call) {result.args=value.map((/** @type {any} */ x)=>substitute(x,env,event,'arg'));continue;}
      if(key==='args' && root.method) {
        result.args=[];
        for(const arg of value) {
          const replacement=arg.param?env.get(arg.param):null;
          const query=['matches','begins','ends','followed-by','preceded-by'].includes(root.method);
          const target=query || ['tags','without-elision-except'].includes(root.method);
          if(query && replacement?.targets) {
            for(const target of replacement.targets) result.args.push(convert(target,'target',event,arg));
          }
          else result.args.push(substitute(arg,env,event,target?'target':'term'));
        }
        continue;
      }
      if(key==='requirements') {
        result.requirements=[];
        for(const requirement of value) {
          const replacement=requirement.value.param?env.get(requirement.value.param):null;
          if(replacement && Object.keys(replacement).length===1 && 'requirements' in replacement) {
            if(requirement.negated) fail(event,requirement.value,'a requirement list cannot replace a negated requirement');
            for(const entry of replacement.requirements) result.requirements.push(entry);
          } else result.requirements.push({...requirement,value:substitute(requirement.value,env,event,'term')});
        }
        continue;
      }
      if(key==='optional' && root.elidable) {
        let head=value.seq?value.seq[0]:value;
        while(head.test || head.capture) head=head.expr;
        if(head.param) {
          const arg=normalize(env.get(head.param));
          if(!arg.tag || !/^[A-Z]/.test(arg.tag) || Object.keys(arg).length!==1) fail(event,head,'an elidable parameter head requires one bare user tag');
        }
      }
      let next=position;
      if(['alternatives','conditions','error','warning','emit','tags','value','image','default','requirements','range','literal','concat','union','intersection','difference','left','right','receiver','if','then','not','all','any'].includes(key) && !(position==='pattern' && ['union','intersection','difference'].includes(key))) next='term';
      if(['seq','choice','ranked','and','optional','repeat','separator','splice'].includes(key) && position!=='pattern') next='expr';
      if(key==='expr') next=position==='pattern'?'pattern':'expr';
      if(key==='pattern' || key==='child') next='pattern';
      if(key==='children' || position==='pattern-item' && ['choice','optional','repeat','separator','splice'].includes(key)) next='pattern-item';
      result[key]=substitute(value,env,event,next);
      if(key==='default') {
        result[key]={...result[key]};
        copyRecipeLocation(value,result[key]);
      }
    }
    if(position==='pattern' && result.test && result.expr?.exact) {
      if(result.exact) {let use=root.expr;while(use.expr) use=use.expr;fail(event,use,'an exact prefix conflicts with an argument prefix');}
      result.exact=true;
      const {exact,...expr}=result.expr;
      result.expr=expr;
    }
    if(result.concat) result.concat=result.concat.flatMap((/** @type {any} */ x)=>x.concat??[x]);
    if(result.union) result.union=result.union.flatMap((/** @type {any} */ x)=>x.union??[x]);
    if((position==='pattern' || patternTerm(result,patterns)) && result.intersection) result.intersection=result.intersection.flatMap((/** @type {any} */ x)=>x.intersection??[x]);
    copyRankedLocation(root,result);
    copyRecipeLocation(root,result);
    copyBoundaryLocation(root,result);
    copyPatternLocation(root,result);
    return result;
  };
  // ARG preserves its category while parameters nested in another call bind.
  // Calls in expanded definitions stay structural until the complete queue exists.
  for(let cursor=0;cursor<queue.length;cursor++) {
    const instance=queue[cursor],template=templates.get(instance.call.call);
    const applicable=[...template.events,...instance.locals].sort((a,b)=>a.index-b.index);
    for(const event of applicable) {
      const env=new Map((event.rule.params??[]).map((/** @type {string} */ name,/** @type {number} */ i)=>[name,instance.call.args[i]]));
      const body={...event.rule};delete body.params;delete body.args;delete body.instance;
      body.name=instance.name??instance.canonical;
      const expanded=substitute(body,env,{...event,origin:instance.origin,instance:instance.canonical});
      const problem=expandedDomProblem({format:documents[0].dom.format,rules:[expanded],directives:[],constants:[],classifiers:[],implications:[]},unicode,true);
      if(problem) fail({...event,origin:instance.origin,instance:instance.canonical},expanded,`rule ${expanded.name}: ${problem}`);
      instance.definitions.push({...event,origin:instance.origin,instance:instance.canonical,rule:expanded});
    }
    for(const event of retained(instance.definitions)) discover(event.rule,event);
  }
  const validationKeys=new Set(instances.keys());
  /** @type {any[]} */
  const validationQueue=[];
  /** @type {typeof intern} */
  const validateCall=(call,event)=>{
    const normalized={call:call.call,args:normalize(call.args),at:call.at};
    const key=JSON.stringify(templateIdentity(normalized));
    if(!validationKeys.has(key)) {
      validationKeys.add(key);
      validationQueue.push({call:normalized,origin:{document:event.path,at:call.at}});
    }
  };
  for(const event of events) if(!event.rule.params && !event.rule.args && !event.rule.instance) discover(event.rule,event,validateCall);
  for(const instance of queue) for(const event of instance.definitions) discover(event.rule,event,validateCall);
  /** @type {any[]} */
  const validationDefinitions=[];
  for(let cursor=0;cursor<validationQueue.length;cursor++) {
    const {call,origin}=validationQueue[cursor],name=canonicalArgument(call,unicode);
    for(const event of templates.get(call.call).events) {
      const env=new Map(event.rule.params.map((/** @type {string} */ parameter,/** @type {number} */ i)=>[parameter,call.args[i]]));
      const body={...event.rule,name};delete body.params;
      const context={...event,origin,instance:name};
      const expanded=substitute(body,env,context);
      const problem=expandedDomProblem({format:documents[0].dom.format,rules:[expanded],directives:[],constants:[],classifiers:[],implications:[]},unicode,true);
      if(problem) fail(context,expanded,`rule ${expanded.name}: ${problem}`);
      const definition={...context,rule:expanded};
      validationDefinitions.push(definition);
      discover(expanded,definition,validateCall);
    }
  }
  /** @type {(instance:any)=>string} */
  const effective=(/** @type {any} */ instance)=>instance.name??instance.canonical;
  /** @type {(root:any,event:any,position?:string)=>any} */
  const rewrite=(root,event,position='term')=>{
    if(!root || typeof root!=='object') return root;
    if(Array.isArray(root)) return root.map((/** @type {any} */ x)=>rewrite(x,event,position));
    if(root.call) {
      const instance=instances.get(JSON.stringify(templateIdentity(normalize({call:root.call,args:root.args,at:root.at}))));
      const name=instance?effective(instance):canonicalArgument(root,unicode);
      return position==='pattern'?{name,...(root.exact?{exact:true}:{}),...(root.children?{children:rewrite(root.children,event,'pattern-item')}:{ }),at:root.at}:position==='expr'?{ref:name}:{rule:name};
    }
    if(position==='pattern' && root.name && templates.has(root.name)) {
      const members=queue.filter((/** @type {any} */ x)=>x.call.call===root.name).map((/** @type {any} */ x)=>({...root,name:effective(x),...(root.children?{children:rewrite(root.children,event,'pattern-item')}:{})}));
      return members.length===1?members[0]:members.length?{union:members}:{difference:[{name:'text',at:root.at,...(root.exact?{exact:true}:{})},{name:'text',at:root.at,...(root.exact?{exact:true}:{})}]};
    }
    if(root.ref && templates.has(root.ref) || root.rule && templates.has(root.rule)) fail(event,root,'a bare template reference must name one instance');
    /** @type {Record<string,any>} */
  const result={};
    for(const [key,value] of Object.entries(root)) {
      let next=position;
      if(['alternatives','conditions','error','warning','emit','tags','value','image','default','left','right','receiver','range','literal','args'].includes(key)) next='term';
      if(['seq','choice','ranked','and','optional','repeat','separator','expr','splice'].includes(key) && position!=='pattern') next='expr';
      if(key==='pattern' || key==='child') next='pattern';
      if(key==='children' || position==='pattern-item' && ['choice','optional','repeat','separator','splice'].includes(key)) next='pattern-item';
      result[key]=key==='at'?value:rewrite(value,event,next);
    }
    copyRankedLocation(root,result);
    copyRecipeLocation(root,result);
    copyBoundaryLocation(root,result);
    copyPatternLocation(root,result);
    if(position==='pattern' && result.test) return distributeFamilyTest(result);
    if(position==='pattern') for(const key of ['union','intersection']) if(result[key]) result[key]=result[key].flatMap((/** @type {any} */ part)=>part[key]??[part]);
    return result;
  };
  /** @type {any[]} */
  const argumentsToCheck=[];
  /** @param {any} argument @param {any} event */
  const inspectArgument=(argument,event)=>{
    const parts=templateNodes(argument),references=parts.filter(n=>n.const || n.constant);
    if(!references.length) return;
    const owner={path:event.path,kind:event.kind??0,origin:event.origin,instance:event.instance,inspectionRun:rewrittenDefinitions.get(event)?.inspectionRun??event.inspectionRun,at:event.rule.at,position:references[0].at};
    const add=(/** @type {any} */ term,tags=false)=>argumentsToCheck.push({...owner,term:rewrite(term,event),tags});
    const arg=normalize(argument);
    if(arg.body || arg.splice || arg.test || arg.range || arg.wildcard) {
      const rule={...(parts.some(n=>n.param)?{params:event.rule.params}:{}),name:extraIndexes.has(event.index)?'text':event.rule.name,op:'define',conditions:[],alternatives:[{guards:[],expr:rewrite(arg.body??arg,event,'expr')}],at:event.rule.at};
      argumentsToCheck.push({...owner,rule,fragment:true});
    } else if(arg.requirements) {
      for(const requirement of arg.requirements) add(requirement.value,true);
    } else if(!arg.call && !arg.rule && !arg.targets) add(arg);
  };
  /** @param {any} event */
  const inspectArguments=event=>{
    for(const node of templateNodes(event.rule)) if(node.call || node.name && node.args && node.op) {
      for(const argument of node.args) inspectArgument(argument,event);
    }
  };
  const validation=[],rewrittenDefinitions=new Map();
  let nextInspectionRun=documents.length;
  /** @param {any} event @param {any} [rule] */
  const rewriteDefinition=(event,rule=event.rule)=>{
    const rewritten={...event,rule:rewrite(rule,event),inspectionRun:event.origin ? nextInspectionRun++ : event.inspectionRun};
    validation.push(rewritten);
    rewrittenDefinitions.set(event,rewritten);
  };
  for(const event of events) {
    if(event.rule.params) validation.push(event);
    else if(!event.rule.args && !event.rule.instance) rewriteDefinition(event);
  }
  for(const instance of queue) for(const event of instance.definitions) rewriteDefinition(event,{...event.rule,name:effective(instance)});
  for(const event of validationDefinitions) rewriteDefinition(event);
  for(const event of sourceEvents) inspectArguments(event);
  for(const instance of queue) for(const event of instance.definitions) inspectArguments(event);
  for(const event of validationDefinitions) inspectArguments(event);
  for(const event of [...validation,...argumentsToCheck.filter(argument=>argument.rule)]) {
    if(event.rule.params) continue;
    const problem=expandedDomProblem({format:documents[0].dom.format,rules:[event.rule],directives:[],constants:[],classifiers:[],implications:[]},unicode,true);
    if(problem) fail(event,event.rule,problem);
  }
  const output=[];
  for(const list of ordinary.values()) for(const event of list) output.push(rewrittenDefinitions.get(event));
  for(const instance of queue) for(const event of instance.definitions) output.push(rewrittenDefinitions.get(event));
  const expandedDocs=documents.map((/** @type {any} */ d,inspectionRun)=>({...d,inspectionRun,dom:{...d.dom,rules:[],...Object.fromEntries(['constants','directives','classifiers','implications'].map(key=>[key,d.dom[key].map((/** @type {any} */ item)=>rewrite(item,{path:d.path,rule:item}))]))}}));
  for(const event of output) expandedDocs.push({path:event.path,inspectionRun:event.inspectionRun,dom:{format:documents[0].dom.format,rules:[event.rule],directives:[],constants:[],classifiers:[],implications:[]}});
  return {documents:expandedDocs,validation,argumentsToCheck,order:[...slots.filter((/** @type {any} */ n)=>current.has(n)||ordinary.has(n)),...queue.filter((/** @type {any} */ x)=>!x.name).map(effective)],templates:[...templates.values()],instances:queue};
}

/** @param {any} grammar @returns {{templates:any[],instances:any[]}} */
export function templateAudit(grammar) {
  const position=(/** @type {any} */ event)=>({document:event.path,line:event.rule.at[0],column:event.rule.at[1]});
  const positions=new Map([...grammar.rules.keys()].map((name,index)=>[name,index]));
  const templatesByName=new Map(grammar.templates.map((/** @type {any} */ template)=>[template.name,template]));
  const ordered=grammar.instances.slice().sort((/** @type {any} */ a,/** @type {any} */ b)=>(positions.get(a.name??a.canonical)??-1)-(positions.get(b.name??b.canonical)??-1));
  const usedTemplates=new Set(ordered.map((/** @type {any} */ instance)=>instance.call.call));
  const byName=new Map(ordered.filter((/** @type {any} */ item)=>item.name).map((/** @type {any} */ item)=>[item.name,item]));
  const aliases=(/** @type {any} */ a,/** @type {any} */ b)=>{
    /** @type {(a:any,b:any)=>boolean} */
    const same=(a,b)=>{
      const an=a?.rule??a?.ref??a?.name,bn=b?.rule??b?.ref??b?.name;
      const expand=(/** @type {any} */ node,/** @type {any} */ instance)=>({...instance.call,...Object.fromEntries(Object.entries(node).filter(([key])=>!['rule','ref','name'].includes(key)))});
      if(an && byName.has(an) && b?.call) {
        if(byName.get(an).key!==JSON.stringify(templateIdentity(normalizeArgument({call:b.call,args:b.args})))) return false;
        a=expand(a,byName.get(an));
      }
      if(bn && byName.has(bn) && a?.call) {
        if(byName.get(bn).key!==JSON.stringify(templateIdentity(normalizeArgument({call:a.call,args:a.args})))) return false;
        b=expand(b,byName.get(bn));
      }
      if(Array.isArray(a)||Array.isArray(b)) return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>same(x,b[i]));
      if(!a||!b||typeof a!=='object'||typeof b!=='object') return a===b;
      const ka=Object.keys(a).filter(k=>k!=='at'),kb=Object.keys(b).filter(k=>k!=='at');
      return ka.length===kb.length&&ka.every(k=>kb.includes(k)&&same(a[k],b[k]));
    };
    return same(a,b);
  };
  return {
    templates:grammar.templates.map((/** @type {any} */ template)=>{
      const used=new Set();
      let first=0;
      template.events.forEach((/** @type {any} */ event,/** @type {number} */ i)=>{if(event.rule.op!=='extend') first=i;});
      for(const event of template.events.slice(first)) for(const node of templateNodes(event.rule)) if(node.param) used.add(event.rule.params.indexOf(node.param));
      return {template:template.name,parameters:template.events[0].rule.params.slice(),document:template.path,line:template.at[0],column:template.at[1],notes:[
        ...template.events[0].rule.params.flatMap((/** @type {string} */ parameter,/** @type {number} */ i)=>used.has(i)?[]:[{kind:'unused-parameter',parameter}]),
        ...(usedTemplates.has(template.name)?[]:[{kind:'uncalled-template'}])
      ]};
    }),
    instances:ordered.map((/** @type {any} */ instance)=>{
      const eventIndexes=new Set(templatesByName.get(instance.call.call).events.map((/** @type {any} */ e)=>e.index));
      const events=instance.definitions.map((/** @type {any} */ event)=>{
        return {scope:eventIndexes.has(event.index)?'template':'instance',op:event.rule.op,...position(event)};
      });
      const twins=ordered.filter((/** @type {any} */ other)=>other!==instance&&other.call.call===instance.call.call&&aliases(other.call.args,instance.call.args)).map((/** @type {any} */ other)=>other.name??other.canonical);
      return {template:instance.call.call,arguments:templateIdentity(instance.call.args),name:instance.name??instance.canonical,binding:instance.binding??null,firstCall:{document:instance.origin.document,line:instance.origin.at[0],column:instance.origin.at[1]},events,notes:twins.length?[{kind:'argument-alias-twin',instances:twins}]:[]};
    })
  };
}
