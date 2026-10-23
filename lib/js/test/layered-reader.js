// A candidate bootstrap exercises the new reader before the format switch.
import fs from 'node:fs';
import { GencmuError } from '../src/errors.js';
import { layeredPatternText } from '../src/pattern-shapes.js';
import { Loader } from '../src/dialect.js';
import { treeToDom } from '../src/reader.js';
import { extractGrammarText } from '../src/markdown.js';
import { readDocument, readSyntaxTree } from '../../../tools/bootstrap-reader.js';
import { readGrammarFile } from './shared.js';

const fixture=fs.readFileSync(new URL('../../../tests/fixtures/layered-patterns/syntax.md',import.meta.url),'utf8');
export const bootstrap=JSON.parse(readGrammarFile('notation/bootstrap.json'));
for(const stage of bootstrap.stages) for(const document of stage.documents) {
  let text=readGrammarFile(document.path);
  if(document.path==='notation/syntax.md') text=text.slice(0,text.indexOf('## Tree patterns'))+fixture+text.slice(text.indexOf('## Directives'));
  if(document.path==='notation/lexical.md') text=text.replace('%rule symbol\n','%rule symbol\n  | "«" | "»" | "·"\n');
  document.dom=readDocument(text,document.path);
}
// Native reader probes replace only these recognition rules in the bootstrap.
export function recognitionRules() {
  const result={};
  for(const stage of bootstrap.stages) for(const document of stage.documents) {
    if(stage.name==='lexical') result.lexical=document.dom.rules.find(rule=>rule.name==='symbol');
    if(stage.name==='syntax') result.syntax=document.dom.rules.filter(rule=>rule.name.startsWith('pattern-')||rule.name.startsWith('child-')).map((rule,index)=>({...rule,at:[1000000+index,1]}));
  }
  return result;
}
const loader=new Loader(file=>file==='compiled.json' ? undefined : file==='notation/bootstrap.json' ? JSON.stringify(bootstrap) : readGrammarFile(file));
const cases=JSON.parse(fs.readFileSync(new URL('../../../tests/layered-pattern-reader.json',import.meta.url),'utf8'));
export const prefix='%rule probe('+cases.parameters.map(name=>'@'+name).join(', ')+') A\n%conditions $ ≅ ';
export const document=pattern=>'```jbogenbau\n'+prefix+pattern+'\n```';
const path='layered-reader.md';

export function engineRead(pattern,omit=[]) {
  const source=document(pattern);
  const {text,positions}=extractGrammarText(source,path);
  const result=loader.notation.parse(text,{features:new Set()});
  if(!result.ok) {
    if(result.error.kind!=='rejected') throw new Error('the candidate notation returned '+result.error.kind);
    const offset=result.error.source[0];
    return {error:{phase:result.error.stage,line:positions[offset][0],column:positions[offset][1]}};
  }
  const syntax=result.stages.at(-1);
  omitTokens(syntax.tree,syntax.input,omit);
  return convert(syntax.tree,syntax.input,token=>positions[token.source[0]],loader.unicode);
}
export function handRead(pattern,omit=[]) {
  let syntax;
  try { syntax=readSyntaxTree(document(pattern),path,true); }
  catch(error) { if(!(error instanceof GencmuError)) throw error; return {error:{phase:'syntax',...error.where}}; }
  omitTokens(syntax.tree,syntax.tokens,omit);
  return convert(syntax.tree,syntax.tokens,syntax.positionOf,syntax.unicode);
}
function omitTokens(root,tokens,omitted) {
  if(!omitted.length) return;
  const omit=new Set(omitted), pending=[root];
  while(pending.length) {
    const node=pending.pop();
    if(node.kind!=='rule') continue;
    node.children=node.children.filter(child=>child.kind!=='token' || !omit.has(tokens[child.token].value));
    for(const child of node.children) pending.push(child);
  }
}
function convert(tree,tokens,positionOf,unicode) {
  try {
    const dom=treeToDom(tree,tokens,positionOf,path,unicode);
    return {pattern:dom.rules[0].conditions[0].right.pattern};
  } catch(error) { if(!(error instanceof GencmuError)) throw error; return {error:{phase:'reader',...error.where,message:error.message}}; }
}
export function withoutPositions(node) {
  return JSON.parse(JSON.stringify(node,(key,value)=>key==='at'?undefined:value));
}
export function term(node) {
  for(const key of ['name','terminal','tag']) if(key in node) return node[key];
  if(node.param) return '@'+node.param;
  if(node.const) return '$'+node.const;
  if('string' in node) return JSON.stringify(node.string);
  if(node.call) return node.call+'('+node.args.map(term).join(', ')+')';
  if(node.requirements) return '<'+node.requirements.map(r=>(r.negated?'¬':'')+term(r.value)).join(' ')+'>';
  if(node.pattern) return printPattern(node.pattern);
  throw new Error('unhandled reader fixture term');
}
export const printPattern=pattern=>layeredPatternText(pattern,term);
