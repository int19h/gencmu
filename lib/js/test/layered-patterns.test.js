import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PatternMachine } from '../src/patterns.js';
import { layeredPatternProblem, layeredPatternText } from '../src/pattern-shapes.js';

const cases = JSON.parse(fs.readFileSync(new URL('../../../tests/layered-patterns.json', import.meta.url), 'utf8'));

function observe(machine, tree) {
  if (tree.seal) return machine.seal;
  if (tree.terminal) return machine.node(null,machine.empty,{terminal:tree.terminal,value:tree.value,tags:new Set(tree.tags)});
  let children = machine.empty;
  for (const child of tree.children) children = machine.concat(children,observe(machine,child));
  return machine.node(tree.name,children);
}

function term(n) {
  if (n.name || n.terminal) return n.name ?? n.terminal;
  if (n.param) return '@'+n.param;
  if (n.call) return n.call+'('+n.args.map(term).join(', ')+')';
  if (n.pattern) return layeredPatternText(n.pattern,term);
  if (n.const) return '$'+n.const;
  if ('string' in n) return JSON.stringify(n.string);
  if (n.tag) return n.tag;
  if (n.requirements) return '<'+n.requirements.map(r=>(r.negated?'¬':'')+term(r.value)).join(' ')+'>';
  throw new Error('unhandled term '+JSON.stringify(n));
}

for (const c of cases.matching) test('layered matching: '+c.description, () => {
  const machine = new PatternMachine([c.pattern]);
  assert.equal(machine.matches(observe(machine,c.tree),c.pattern),c.expected);
});
for (const c of cases.printing) test('layered printing: '+c.description, () => {
  assert.equal(layeredPatternText(c.pattern,term),c.text);
});
for (const c of cases.shapes) test('layered shape: '+c.description, () => {
  const problem = layeredPatternProblem(c.pattern);
  assert.equal(problem === null,c.valid,String(problem));
});

test('layered pattern depth counts constructors and shares sibling depths', () => {
  let p = {name:'a',at:[1,1]};
  for (let i=0;i<256;i++) p={path:'descendant',pattern:p};
  assert.equal(layeredPatternProblem(p),null);
  assert.equal(layeredPatternProblem({path:'descendant',pattern:p}),'nested too deeply');
  const wide = {any:true,children:Array.from({length:1000},()=>({child:{name:'a',at:[1,1]}}))};
  assert.equal(layeredPatternProblem(wide,{depth:254}),null);
  assert.equal(layeredPatternProblem(wide,{depth:255}),'nested too deeply');
  const siblings = {any:true,children:Array.from({length:1000},()=>({siblings:true}))};
  assert.equal(layeredPatternProblem(siblings,{depth:255}),null);
  assert.equal(layeredPatternProblem(siblings,{depth:256}),'nested too deeply');
});

test('a layered child repeat retains finitely many states for long input', () => {
  const pattern={any:true,children:[{repeat:[{child:{terminal:'A',at:[1,1]}}]}]};
  const machine=new PatternMachine([pattern]);
  const a=observe(machine,{terminal:'A',value:'a',tags:['A']});
  let prefix=machine.empty;
  for(let i=0;i<1000;i++) {
    prefix=machine.concat(prefix,a);
    assert.equal(machine.matches(machine.node('list',prefix),pattern),true);
  }
  assert.ok(machine.states.length<10,`${machine.states.length} structural states`);
});
