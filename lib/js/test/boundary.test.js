import {test} from "node:test";
import assert from "node:assert/strict";
import {loadEngineCase,runEngineCase,caseTokens,readGrammarFile} from "./shared.js";
import {Loader,fnv1a64} from "../src/node.js";
import {audit} from "../src/diagnostics.js";
import {ParseContext,recognize,rootItems} from "../src/earley.js";
import {hooks,newWork} from "../src/testing.js";
import {BoundaryRecords} from "../src/boundary.js";
import {Ranker} from "../src/rank.js";

const tokens = names => names.split(" ").map(t => ({text:t.toLowerCase(),tags:[t]}));
test("empty children leave the prefix's own literals pending (rule 2)",()=>{
  const machine = new BoundaryRecords([]);
  const atom={method:"preceded-by",receiver:{capture:""},args:[{terminal:"A"}]};
  machine.demand(atom);
  const negative=machine.literal(atom,false);
  const prefix=machine.append(machine.leaf("A",false),negative.bit);
  const got=machine.advance(prefix,machine.empty,()=>assert.fail("the prefix's literal settled early"));
  assert.equal(got.end,negative.bit);
});
test("the audit notes query rules and query-only targets without a load error",()=>{
  const grammar="%rule text $x:A B\n%conditions $x.onward.begins(w)\n%rule w u y\n%rule u A\n%conditions $.followed-by(y)\n%rule y B";
  const loaded=loadEngineCase({grammar});
  assert.equal(loaded.loadError,undefined);
  const notes=audit(loaded.dialect)[0].boundaryNotes;
  assert.ok(notes.some(n=>n.kind === "query-rule" && n.rule === "u" && n.query === "text"));
  assert.ok(notes.some(n=>n.kind === "query-target" && n.target === "y" && n.rule === "u"));
});
test("a boundary diagnostic counts conditions through extensions",()=>{
  const result=runEngineCase({grammar:"%rule text r | Y\n%rule r A\n%conditions $.starts-input, $.ends-input\n%extend-rule r B\n%conditions $.followed-by(Y)",tokens:tokens("B")}).json;
  assert.deepEqual(result.error.boundary,{rule:"r",condition:2,at:1});
});
test("a named completion owns its whole-span boundary condition after a ranked suffix",()=>{
  const grammar="%rule text X r | Y r\n%rule r C (a ≻ b)\n%conditions $.preceded-by(X)\n%rule a A\n%rule b A";
  assert.equal(runEngineCase({grammar,tokens:tokens("X C A")}).json.ok,true);
  assert.equal(runEngineCase({grammar,tokens:tokens("Y C A")}).json.error.kind,"rejected");
});
function measure(grammar,length,rank = false) {
  const loaded=loadEngineCase({grammar});assert.equal(loaded.loadError,undefined);
  const stage=loaded.dialect.stages[0],lowered=stage.grammar.lower(new Set());
  const input=caseTokens(Array.from({length},()=>({text:"a",tags:["A"]})));
  const context=new ParseContext(lowered,input.tokens,[...input.text],loaded.dialect.loader.unicode);
  const work=newWork(),start=performance.now();
  hooks.work=work;
  let chart;
  try {chart=recognize(context,"text",0,length);} finally {hooks.work=null;}
  const records=new Set();for(const set of chart.sets)if(set)for(const item of set.items)if(item.boundary)records.add(item.boundary.id);
  const milliseconds = performance.now()-start;
  const verdict = rank ? new Ranker(input.tokens,"none").rank(rootItems(chart,"text")).verdict : null;
  return {length,verdict,records:records.size,items:work.items,edges:work.packedEdges,
    contexts:work.summaryContexts,closeStates:work.closeStates,milliseconds,
    peakKiB:process.resourceUsage().maxRSS};
}
test("condition literals carry no spans on nested receivers, for one through sixteen tokens",t=>{
  const grammar="%rule text r [B]\n%rule r A [tail]\n%conditions ¬$.followed-by(B) ∨ $.starts-input\n%rule s A [tail]\n%rule tail r | s";
  const samples=Array.from({length:16},(_,index)=>measure(grammar,index+1,true));
  // The first input has no nested receiver. All later inputs use the same
  // finite states, independently of the exponentially many derivations.
  assert.equal(new Set(samples.slice(1).map(s=>s.records)).size,1,JSON.stringify(samples));
  assert.ok(samples.every(s=>s.records<=4));
  for (const sample of samples) assert.equal(sample.verdict,sample.length === 1 ? "unique" : "tie");
  t.diagnostic(JSON.stringify(samples));
});
test("aligned close observations and boundary records grow independently, through eight tokens",t=>{
  const source="%rule text $x:r [Z]\n%conditions $x.without-elision.matches(r)\n%rule r {u}\n%rule u A [+T] | A [+U]";
  const atom=source.replace("$x.without-elision.matches(r)","$x.without-elision.matches(r) ∧ ¬$x.followed-by(Z)");
  const samples=[];
  for(let length=1;length<=8;length++) {
    const plain=measure(source,length),bounded=measure(atom,length);
    samples.push({plain,bounded});
    assert.ok(bounded.items<=4*plain.items,JSON.stringify(samples));
    assert.ok(bounded.records<=4);
  }
  assert.equal(new Set(samples.map(s=>s.bounded.records)).size,1,JSON.stringify(samples));
  t.diagnostic(JSON.stringify(samples));
});

test("a ranked suffix keeps whole-rule dual evaluation before later ordinary failures",()=>{
  const grammar="%rule text X r\n%rule r C (a ≻ b)\n%conditions $.preceded-by(X) ⟹ $.matches(r), ¬$.starts-input\n%rule a A\n%rule b A";
  assert.equal(runEngineCase({grammar,tokens:tokens("X C A")}).json.error.kind,"grammar");
});

test("an unreachable target names the same source position with a cached DOM",()=>{
  for (const condition of ["$.followed-by(z)",
    "A ⊆ $OK ∧ $.followed-by(z)","$ ≅ @(A) ∧ $.followed-by(z)"]) {
    const documents={
      "p.md":"```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
      "g.md":`\`\`\`jbogenbau\n%ambiguity-resolution greedy\n%const $OK A\n%rule text a\n%rule a A\n%conditions ${condition}\n%rule z B\n\`\`\`\n`,
    };
    const read=path=>documents[path] ?? readGrammarFile(path);
    const uncached=new Loader(read);
    const dom=uncached.readDocument(documents["g.md"],"g.md");
    const cached=new Loader(read);
    cached.compiled.set("g.md",{hash:fnv1a64(documents["g.md"]),dom:JSON.parse(JSON.stringify(dom))});
    let first,second;
    try {uncached.dialect("p.md");} catch(error) {first=error;}
    try {cached.dialect("p.md");} catch(error) {second=error;}
    assert.deepEqual(second.where,first.where);
    assert.equal(first.where.line,6);
    assert.equal(first.where.column,("%conditions "+condition).indexOf("z")+1);
  }
});

test("query-only target notes distinguish the atoms of one rule",()=>{
  const grammar="%rule text $x:A B\n%conditions $x.onward.begins(w)\n%rule w u y\n%rule u $a:A\n%conditions $a.followed-by(y | B), $.followed-by(y)\n%rule y B";
  const loaded=loadEngineCase({grammar});
  assert.equal(loaded.loadError,undefined);
  const notes=audit(loaded.dialect)[0].boundaryNotes.filter(n=>n.kind === "query-target");
  assert.deepEqual(notes.map(n=>[n.rule,n.target,n.condition,n.receiver,n.method]),[
    ["u","y",0,"a","followed-by"],["u","y",1,"","followed-by"],
  ]);
  assert.deepEqual(notes[0].targets,["y","B"]);
  assert.ok(notes.every(n=>typeof n.document === "string" && n.line>0 && n.column>0));
});


test("admission reports each boundary split once",()=>{
  const grammar="%rule text (p ≻ q ≻ r) :: ∅ | B\n%rule p A\n%conditions ¬$.followed-by(B)\n%rule q A\n%rule r A";
  let observed = false;
  hooks.boundaryAdmission = splits=>{
    observed = true;
    assert.equal(new Set(splits.map(split=>split.entry)).size,splits.length);
  };
  try {runEngineCase({grammar,tokens:tokens("A")});}
  finally {hooks.boundaryAdmission = null;}
  assert.ok(observed);
});
