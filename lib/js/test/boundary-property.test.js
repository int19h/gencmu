// Both boundary prototypes, exercised against the reference recognizer.
// The generator below is exact: an unsigned 32-bit LCG, four rules, two
// terminals, two or three alternatives, and zero to three symbols. The
// advanced sweeps cover acyclic and cyclic calls. Both include empty
// productions, and the cyclic sweeps include repeated same-span invocations.
import {test} from "node:test";
import assert from "node:assert/strict";
import {loadEngineCase,caseTokens} from "./shared.js";
import {ParseContext,recognize,rootItems} from "../src/earley.js";
import {RankedAdmission} from "../src/ranked-admission.js";

const LIMIT = 3000;
const TOO_MANY = new Error("enumeration budget");
function random(seed) {
  let state = seed >>> 0;
  return n => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return Math.floor(state / 2**32 * n); };
}
const names = ["r0","r1","r2","r3"], terminals = ["A","B"];
const group = symbol => Array.isArray(symbol);
function generate(next,advanced,cyclic = !advanced) {
  return names.map((name,index) => Array.from({length:2+next(2)},() => {
    const pool = [...(cyclic ? names : names.slice(index+1)),...terminals,...terminals,...terminals];
    const symbol = () => pool[next(pool.length)];
    const symbols = Array.from({length:next(4)},() => advanced && next(6) === 0
      ? Array.from({length:2},() => Array.from({length:next(3)},symbol)) : symbol());
    const receivers = ["$",...symbols.flatMap((s,i) => group(s) ? [] : [i])];
    const items = Array.from({length:next(3) === 0 ? 1+next(2) : 0},() => ({
      receiver:receivers[next(receivers.length)],positive:!!next(2),direction:next(2) ? "f" : "p",
      targets:Array.from(new Set(Array.from({length:advanced ? 1+next(2) : 1},() => [...names,...terminals][next(6)]))),
      guard:advanced ? next(4) : 0,
      emission:advanced && next(5) === 0,
    }));
    return {symbols,items};
  }));
}
function spell(grammar) {
  const refs = new Set();
  for (const productions of grammar) for (const p of productions) for (const symbol of p.symbols) {
    if (group(symbol)) for (const option of symbol) for (const s of option) refs.add(s);
    else refs.add(symbol);
  }
  // All generated targets are made reachable without changing inputs of
  // up to four tokens: this otherwise unused branch starts with Z.
  let text = "%ambiguity-resolution greedy\n%rule text r0 | Z r0 r1 r2 r3 A B\n";
  grammar.forEach((productions,r) => productions.forEach((p,k) => {
    const body = p.symbols.map((s,i) => group(s) ? `(${s.map(option => option.join(" ") || "ε").join(" ≻ ")})` : `$c${i}:${s}`).join(" ") || "ε";
    // Odd records the parity of empty named productions under this node.
    // A ranked option seals that observation, as prototype 2 does.
    const parts = p.symbols.flatMap((s,i) => group(s) ? [] : [`($c${i}.tags ∩ Odd)`]);
    let parity = p.symbols.length ? "∅" : "Odd";
    for (const part of parts) parity = `((${parity} ∖ ${part}) ∪ (${part} ∖ ${parity}))`;
    text += `%${k ? "extend-rule" : "rule"} ${names[r]} :: ${parity}\n  | ${body}\n`;
    const conditions = p.items.filter(item => !item.emission).map(item => {
      const receiver = item.receiver === "$" ? "$" : `$c${item.receiver}`;
      const atom = `${receiver}.${item.direction === "f" ? "followed-by" : "preceded-by"}(${item.targets.join(" | ")})`;
      const literal = `${item.positive ? "" : "¬"}${atom}`;
      const guard = item.guard === 1 ? `${receiver}.value = ""` : item.guard === 2 ? `Odd ⊆ ${receiver}.tags` : item.guard === 3 ? `Odd ⊈ ${receiver}.tags` : null;
      return guard ? `${guard} ∨ ${literal}` : literal;
    });
    if (conditions.length) text += `%conditions\n  ${conditions.join(",\n  ")}\n`;
    // These atoms have no effect on recognition, even inside ranked options.
    const emissions = p.items.filter(item => item.emission);
    if (emissions.length) text += `%emits $ :: ${emissions.map(item => `($.${item.direction === "f" ? "followed-by" : "preceded-by"}(${item.targets.join(" | ")}) ⟹ Emission)`).join(" ∪ ")}\n`;
  }));
  return text;
}
function enumerate(grammar,input) {
  let budget = 30000;
  const spend = () => { if (--budget < 0) throw TOO_MANY; };
  const sequence = (symbols,start,end,open,parentSpan) => {
    if (!symbols.length) return start === end ? [[]] : [];
    const [symbol,...rest] = symbols, result = [];
    for (let middle=start;middle<=end;middle++) {
      const context = start === parentSpan[0] && middle === parentSpan[1] ? open : new Set();
      const heads = group(symbol) ? symbol.flatMap((option,index) => sequence(option,start,middle,context,[start,middle]).map(children => ({name:null,start,end:middle,children,option:index,options:symbol,context})))
        : names.includes(symbol) ? derive(symbol,start,middle,context)
        : middle === start+1 && input[start] === symbol ? [{name:symbol,start,end:middle,children:[],token:true}] : [];
      if (!heads.length) continue;
      const tails = sequence(rest,middle,end,open,parentSpan);
      for (const head of heads) for (const tail of tails) { spend();result.push([head,...tail]); }
      if (result.length>LIMIT) throw TOO_MANY;
    }
    return result;
  };
  const derive = (name,start,end,open) => {
    const key = `${name}/${start}/${end}`;
    if (open.has(key)) return [];
    const inside = new Set([...open,key]);
    const result = grammar[names.indexOf(name)].flatMap((p,production) => sequence(p.symbols,start,end,inside,[start,end]).map(children => ({name,start,end,children,production})));
    if (result.length>LIMIT) throw TOO_MANY;
    return result;
  };
  const trees = derive("r0",0,input.length,new Set());
  return {trees,sequence};
}
const walk = (node,fn) => {fn(node);for (const child of node.children) walk(child,fn);};
const parity = node => node.token || node.name === null ? 0 : (node.children.length === 0 ? 1 : node.children.reduce((n,c) => n+parity(c),0)) % 2;
function ownLiterals(grammar,node) {
  const result = [];
  if (!names.includes(node.name)) return result;
  const production = grammar[names.indexOf(node.name)][node.production];
  for (const item of production.items) {
    if (item.emission) continue;
    const receiver = item.receiver === "$" ? node : node.children[item.receiver];
    if (item.guard === 1 && receiver.start === receiver.end || item.guard === 2 && parity(receiver) || item.guard === 3 && !parity(receiver)) continue;
    result.push({...item,at:item.direction === "f" ? receiver.end : receiver.start});
  }
  return result;
}
function literals(grammar,root) {
  const result = [];
  walk(root,node => {for (const literal of ownLiterals(grammar,node)) result.push(literal);});
  return result;
}
function nodes(root) {
  const result=[];
  walk(root,n => {if(n.name !== null && n.start<n.end)result.push(n);});
  return result;
}
const hit = (literal,offers) => offers.some(n => literal.targets.includes(n.name) && (literal.direction === "f" ? n.start : n.end) === literal.at);
function oracle(grammar,input,enumerated,coverage) {
  const forward=new Set(),backward=new Set();
  for(const productions of grammar)for(const p of productions)for(const item of p.items)if(!item.emission)for(const target of item.targets)(item.direction === "f" ? forward : backward).add(target);
  // Direct subtree inspection, independent of BoundaryRecords. An open
  // fact records only literals and demanded edge names, with no provenance.
  const record = node => {
    const ns=nodes(node),ls=literals(grammar,node),start=[],end=[];
    for(const l of ls) {
      if(node.start<l.at && l.at<node.end) {if(hit(l,ns)!==l.positive)return null;continue;}
      if((l.at===node.start && l.direction === "f" || l.at===node.end && l.direction === "p") && hit(l,ns)) {if(!l.positive)return null;continue;}
      (l.at===node.start && node.start<node.end ? start : end).push(l);
    }
    return {empty:node.start===node.end,start,end,first:ns.filter(n=>n.start===node.start && forward.has(n.name)),last:ns.filter(n=>n.end===node.end && backward.has(n.name))};
  };
  const literalKey=l=>[l.direction,l.positive,[...l.targets].sort()];
  const setKey=ls=>[...new Set(ls.map(l=>JSON.stringify(literalKey(l))))].sort();
  const offerKey=ns=>[...new Set(ns.map(n=>n.name))].sort();
  const qualify = (prefix,option,parent,index) => {
    const r=record(option);if(!r || !admitted(option))return null;
    const ns=prefix.flatMap(nodes),ls=prefix.flatMap(n=>literals(grammar,n)),nonempty=prefix.some(n=>n.start<n.end);
    const last=ns.filter(n=>n.end===option.start && backward.has(n.name));
    if(r.empty) {
      const left=[];
      for(const l of r.end) {if(nonempty && l.direction === "p" && hit(l,last)) {if(!l.positive)return null;}else left.push(l);}
      return JSON.stringify(["E",setKey(left)]);
    }
    // The named rule can put its own condition on a prefix capture.
    // Such a literal belongs to the prefix before this group too.
    const inherited=ownLiterals(grammar,parent).filter(l=>typeof l.receiver === "number" && l.receiver<index);
    const pending=[...ls,...inherited].filter(l=>l.at===option.start && l.direction === "f");
    for(const l of [...pending,...r.start]) {
      const h=hit(l,l.direction === "f" ? r.first : last);
      if(h && !l.positive || nonempty && !h && l.positive)return null;
    }
    return JSON.stringify(nonempty ? ["N",setKey(r.end),offerKey(r.last)] : ["N",setKey(r.start.filter(l=>!hit(l,r.first))),offerKey(r.first),setKey(r.end),offerKey(r.last)]);
  };
  const dominates = (higher,lower) => {
    if(higher===null)return false;
    const h=JSON.parse(higher),l=JSON.parse(lower);
    if(h.length!==l.length || h[0]!==l[0])return false;
    const subset=(a,b)=>a.every(literal=>b.includes(literal));
    if(!subset(h[1],l[1]))return false;
    if(h[0]==="E")return true;
    if(JSON.stringify(h[2])!==JSON.stringify(l[2]))return false;
    return h.length===3 || subset(h[3],l[3]) && JSON.stringify(h[4])===JSON.stringify(l[4]);
  };
  const admitted = node => {
    for(let i=0;i<node.children.length;i++) {
      const child=node.children[i];
      if(!admitted(child))return false;
      if(child.name!==null)continue;
      const prefix=node.children.slice(0,i),key=qualify(prefix,child,node,i);
      if(key===null)return false;
      for(let index=0;index<child.option;index++)for(const children of enumerated.sequence(child.options[index],child.start,child.end,child.context,[child.start,child.end])) {
        const higher=qualify(prefix,{...child,children,option:index},node,i);
        if(dominates(higher,key)) {
          if(higher!==key)coverage.strict++;
          return false;
        }
      }
    }
    return true;
  };
  return enumerated.trees.filter(root => {
    const ns=nodes(root);
    return literals(grammar,root).every(l=>hit(l,ns)===l.positive) && admitted(root);
  }).length;
}
// Count actual proof edges without the ranker's cap of two. The advanced
// generator also includes cycles, so every count retains its exact active
// same-span named-rule context for admission.
function forestCount(chart) {
  const ranked=chart.context.lowered.ranked;
  const admission=ranked.groups.length ? new RankedAdmission(chart,ranked) : null;
  const memo=new Map();
  const count=(item,open=new Set())=>{
    const cycle=`${item.production.lhs}/${item.origin}/${item.end}`;
    const named=item.complete && !item.production.helper;
    if(named && open.has(cycle))return 0;
    const inner=named ? new Set([...open,cycle]) : open;
    const context=[...open].sort().join(";");
    const remembered=memo.get(item);
    if(remembered?.has(context))return remembered.get(context);
    const edgeCount=edge=>edge.kind === "seed" ? 1 : edge.kind === "scan" ? count(edge.previous,inner) : count(edge.previous,inner)*count(edge.child,inner);
    let mask=null;
    if(admission?.at.has(item))mask=admission.compute(item,child=>({all:count(child,inner)>0}),context);
    let total=0;
    for(const [index,edge]of item.edges.entries())if(!mask || mask.has(index))total+=edgeCount(edge);
    let results=memo.get(item);if(!results)memo.set(item,results=new Map());
    results.set(context,total);
    return total;
  };
  return rootItems(chart,"text").reduce((n,root)=>n+count(admission?.forest?.plain.get(root) ?? root),0);
}
for(const {advanced,cyclic,rounds,seed} of [
  {advanced:false,cyclic:true,rounds:300,seed:0x197001},
  {advanced:true,cyclic:false,rounds:250,seed:0x197002},
  {advanced:true,cyclic:true,rounds:100,seed:0x197003},
])test(`boundary prototype ${advanced ? 2 : 1}, ${cyclic ? "cyclic" : "acyclic"}, agrees with full enumeration`,t=>{
  const next=random(seed);
  let checked=0,filtered=0,rejected=0,skipped=0;
  const coverage={strict:0};
  for(let round=0;round<rounds;round++) {
    const grammar=generate(next,advanced,cyclic),source=spell(grammar);
    const loaded=loadEngineCase({grammar:source});
    assert.equal(loaded.loadError,undefined,source);
    const stage=loaded.pipeline.stages[0],lowered=stage.grammar.lower(new Set());
    for(let length=0;length<=4;length++)for(let bits=0;bits<2**length;bits++) {
      const input=Array.from({length},(_,i)=>terminals[bits>>i&1]);
      let expected,raw;
      try {const all=enumerate(grammar,input);raw=all.trees.length;expected=oracle(grammar,input,all,coverage);}catch(error){if(error!==TOO_MANY)throw error;skipped++;continue;}
      const {tokens,text}=caseTokens(input.map(t=>({text:t.toLowerCase(),tags:[t]})));
      const context=new ParseContext(lowered,tokens,[...text],loaded.pipeline.loader.unicode);
      const chart=recognize(context,"text",0,tokens.length),actual=forestCount(chart);
      assert.equal(actual,expected,`${source}\ninput ${input.join(" ")} round ${round}`);
      checked++;filtered+=expected>0 && expected<raw;rejected+=raw>0 && expected===0;
    }
  }
  t.diagnostic(JSON.stringify({checked,filtered,rejected,skipped,strictExclusions:coverage.strict}));
  if(advanced)assert.ok(coverage.strict>0,"the generator must cover strict subset dominance");
  assert.ok(checked>rounds*15 && filtered>5 && rejected>5,JSON.stringify({checked,filtered,rejected,skipped}));
});
