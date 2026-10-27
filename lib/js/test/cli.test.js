// The command line, run as a user runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

// No text ties in a bundled dialect, so the tie tests load the pipeline of a
// tied engine case from a directory of its documents. It ties on "wi" in its
// second stage, b.
function tiedPipeline() {
  const engineCase = JSON.parse(fs.readFileSync(new URL("../../../tests/engine/attach-tie.json", import.meta.url), "utf8"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-"));
  for (const [name, text] of Object.entries(engineCase.documents)) fs.writeFileSync(path.join(directory, name), text);
  return { pipelineFile: path.join(directory, engineCase.pipelineDocument), text: engineCase.input };
}

test("parse prints brackets and exits 0 for an accepted text", () => {
  const out = run("parse", "mi", "klama", "le", "zarci");
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), "(mi [klama {le zarci}])");
});

test("parse explains a rejection with a caret and exits 1", () => {
  const out = run("parse", "mi klama le le zarci");
  assert.equal(out.status, 1);
  assert.match(out.stderr, /The syntax stage cannot read the text at the end of the text/);
  assert.match(out.stderr, /\^/);
  assert.match(out.stderr, /sumti-6: KU/);
});

test("parse reads standard input and knows the other formats", () => {
  const tree = spawnSync(process.execPath, [cli, "parse", "--format", "tree"], { input: "mi klama\n", encoding: "utf8" });
  assert.equal(tree.status, 0);
  assert.match(tree.stdout, /tanru-unit-2 · klama/);
  const json = run("parse", "--format", "canonical", "mi");
  assert.equal(JSON.parse(json.stdout).ok, true);
  const tokens = run("parse", "--format", "tokens", "--until", "words", "m,I klAma");
  assert.equal(tokens.status, 0);
  assert.match(tokens.stdout, /words: 2 tokens/);
  assert.match(tokens.stdout, /#\s+text\s+value\s+image\s+span\s+source\s+tags/);
  assert.match(tokens.stdout, /"m,I"\s+"mi"\s+"mI"\s+0-1\s+0-3\s+Cmavo/);
  assert.match(tokens.stdout, /"klAma"\s+"klama"\s+"klAma"\s+2-3\s+4-9\s+BRIVLA/);
});

test("a tree keeps one node per line when a token's image spans lines (docs/output.md)", () => {
  const out = run("parse", "--dialect", "lojban/experimental", "--format", "tree", "zoi gy. Hello\nthere .gy.");
  assert.equal(out.status, 0);
  const lines = out.stdout.trimEnd().split("\n");
  assert.ok(lines.slice(1).every((line) => line.startsWith("  ")), out.stdout);
  assert.ok(lines.includes('    ZOI "zoi gy. Hello‹LF›there .gy"'), out.stdout);
});

test("a tree writes a rule's tokens after it only when they are on one line of source", () => {
  const split = run("parse", "--format", "tree", "la\nmark. klama").stdout.split("\n");
  assert.ok(split.some((line) => line.endsWith("sumti-6")), split.join("\n"));
  assert.ok(split.includes('    LA "la"') && split.includes('    CMEVLA "mark"'), split.join("\n"));
  const joined = run("parse", "--format", "tree", "la mark. klama").stdout;
  assert.match(joined, /sumti-6 · la mark\n/);
});

test("parse explains a tie on standard error, prints no tree and exits 1", () => {
  const tied = tiedPipeline();
  const out = run("parse", "--pipeline-file", tied.pipelineFile, tied.text);
  assert.equal(out.status, 1);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /The b stage is ambiguous/);
  assert.match(out.stderr, /^ {2}first: {2}\(/m);
  assert.match(out.stderr, /^ {2}second: \(/m);
});

test("trace shows what a stage did at a position", () => {
  const out = run("parse", "--trace", "syntax:2", "mi le le zarci");
  assert.equal(out.status, 1, "the text is rejected, whatever is traced");
  assert.match(out.stdout, /The syntax stage at position 2/);
  assert.match(out.stdout, /could read next:/);
});

test("trace accepts stage names with underscores (engine §9.1)", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-trace-"));
  try {
    const pipeline = path.join(directory, "p.md");
    fs.writeFileSync(pipeline, '```jbogenbau\n%stage with_underscore\n%ambiguity-resolution greedy\n%rule text "a"\n```\n');
    const out = run("parse", "--pipeline-file", pipeline, "--trace", "with_underscore:0", "a");
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /The with_underscore stage at position 0/);
    fs.appendFileSync(pipeline, '\n```jbogenbau\n%stage later\n%ambiguity-resolution greedy\n%rule text "a"\n```\n');
    const prefix = run("parse", "--pipeline-file", pipeline, "--until", "with_underscore", "--trace", "later:0", "a");
    assert.equal(prefix.status, 0, prefix.stderr);
    assert.match(prefix.stdout, /The later stage at position 0/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test("audit, dialects and test run", () => {
  assert.match(run("audit", "--dialect", "lojban/zantufa").stdout, /hesitation replaced by grammars\/lojban\/zantufa\/stream\.md/);
  assert.match(run("dialects").stdout, /^lojban\/cll\s+The CLL dialect, by its printed grammar$/m);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-")), "cases.jsonl");
  const accepted = { id: "a", text: "mi klama", dialect: "lojban/cll", expect: "accept", verdict: "unique", words: ["mi", "klama"], brackets: "(mi klama)" };
  // A tie is an ambiguous error, which the case pins with its kind and
  // reason (tests/README.md). The tied cases name no dialect, so they run
  // in the pipeline that the command names.
  const pipeline = tiedPipeline();
  const tied = { id: "d", text: pipeline.text, expect: "reject", stage: "b", error: { kind: "ambiguous", reason: "tie" }, ties: ["b"] };
  fs.writeFileSync(file, [accepted, { ...accepted, id: "b", expect: "reject" }, { ...accepted, id: "c", verdict: undefined }, tied, { ...tied, id: "e", error: undefined }]
    .map((c) => JSON.stringify(c)).join("\n") + "\n");
  const out = run("test", file, "--pipeline-file", pipeline.pipelineFile);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /e: error expected undefined, got \{"kind":"ambiguous","reason":"tie"\}/);
  assert.match(out.stdout, /b: expect expected "reject", got "accept"/);
  // A field the result has and the case lacks is a difference too.
  assert.match(out.stdout, /c: verdict expected undefined, got "unique"/);
  assert.match(out.stdout, /2 of 5 cases pass/);
});

test("trace reads the stage's input as the parse does, stage-local features included", () => {
  const out = run("parse", "--trace", "syntax:0", "mi sa do klama");
  assert.match(out.stdout, /after the start and before "do"/);
  assert.equal(out.status, 0);
  const rejected = run("parse", "--trace", "syntax:0", "mi le le zarci");
  assert.equal(rejected.status, 1);
  const unknown = run("parse", "--trace", "nonesuch:0", "mi");
  assert.equal(unknown.status, 2);
  assert.doesNotMatch(unknown.stderr, /at /);
});

test("a defect of the grammar found while parsing exits 2", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-"));
  fs.writeFileSync(path.join(directory, "p.md"), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n");
  fs.writeFileSync(path.join(directory, "g.md"), "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $a:x %conditions ¬$a.matches(text)\n%rule x \"a\"\n```\n");
  const out = run("parse", "--pipeline-file", path.join(directory, "p.md"), "a");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /A grammar error/);
});

test("mistakes of the command exit 2", () => {
  assert.equal(run("parse", "--until", "nonesuch", "mi").status, 2);
  assert.equal(run("parse", "--until", "", "mi").status, 2);
  assert.equal(run("parse", "--format", "nonesuch", "mi").status, 2);
  assert.equal(run("frobnicate").status, 2);
});

test("the CLI uses ordinary ranking after slot admission", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-slot-"));
  try {
    const rules = "%ambiguity-resolution lazy\n%rule text (favored ≻ disfavored) | neutral\n%rule favored \"a\" \"b\" \"c\" \"d\"\n%rule disfavored early \"c\" \"d\"\n%rule early \"a\" \"b\"\n%rule neutral middle \"d\"\n%rule middle \"a\" \"b\" \"c\"";
    fs.writeFileSync(path.join(directory,"p.md"),"```jbogenbau\n%stage main\n%include \"g.md\"\n```\n");
    fs.writeFileSync(path.join(directory,"g.md"),`\`\`\`jbogenbau
${rules}
\`\`\`
`);
    const out=run("parse","--format","canonical","--pipeline-file",path.join(directory,"p.md"),"abcd");
    assert.equal(out.status,0);
    const json=JSON.parse(out.stdout);
    assert.equal(json.format,15);
    assert.equal(json.stages[0].verdict,"resolved");
    assert.equal(json.tree.children[0].rule,"neutral");
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test("the CLI preserves structured ranked loading errors in JSON formats", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"gencmu-ranked-"));
  try {
    fs.writeFileSync(path.join(directory,"p.md"),'```jbogenbau\n%stage main\n%include "g.md"\n```\n');
    fs.writeFileSync(path.join(directory,"g.md"),"```jbogenbau\n%ambiguity-resolution late-elision\n%rule text Q ($x:a ≻ b) Z\n%emits $x\n%rule a X Y\n%rule b U V\n```\n");
    for (const format of ["json","canonical"]) {
      const out = run("parse","--format",format,"--pipeline-file",path.join(directory,"p.md"),"xy");
      assert.equal(out.status,2);
      const error = JSON.parse(out.stdout);
      assert.deepEqual(Object.keys(error),["kind","code","message","group","option","expression"]);
      assert.equal(error.code,"ranked-choice-export");
      assert.equal(error.group.rule,"text");
      assert.deepEqual(error.group.at,[3,20]);
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});


test("a disabled required feature is a failed result in canonical output and trace", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-"));
  try {
    const pipeline = path.join(directory, "p.md");
    fs.writeFileSync(pipeline, '```jbogenbau\n%stage main\n%features f\n%conditions $.value = "a"\n%ambiguity-resolution greedy\n%rule text f? "a"\n```\n');
    const canonical = run("parse", "--pipeline-file", pipeline, "--no-feature", "f", "--format", "canonical", "a");
    assert.equal(canonical.status, 1);
    const error = JSON.parse(canonical.stdout).error;
    assert.equal(error.kind, "feature-conflict");
    assert.equal(error.stage, "main");
    assert.equal(error.feature, "f");
    assert.doesNotMatch(canonical.stderr, /A grammar error/);
    const traced = run("parse", "--pipeline-file", pipeline, "--no-feature", "f", "--trace", "main:0", "a");
    assert.equal(traced.status, 1);
    assert.equal(traced.stdout, "");
    assert.match(traced.stderr, /requires disabled feature f/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("trace keeps every failure before recognition and prints no predictions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-trace-"));
  try {
    const pipeline = path.join(directory, "p.md");
    const failures = [
      ['%features f\n%conditions $.value.split($.tokens-after-first.value) = ∅\n%rule text "a"', /split has an empty delimiter/],
      ['%rule text {[A]}', /braces/],
    ];
    for (const [body, message] of failures) {
      fs.writeFileSync(pipeline, `\`\`\`jbogenbau\n%stage first\n%ambiguity-resolution greedy\n%rule text "a"\n%emits\n%stage x\n%ambiguity-resolution greedy\n${body}\n%stage later\n%ambiguity-resolution greedy\n%rule text "a"\n\`\`\`\n`);
      const plain = run("parse", "--pipeline-file", pipeline, "a");
      assert.equal(plain.status, 2, plain.stderr);
      assert.match(plain.stderr, message);
      for (const stage of ["x", "later"]) {
        const out = run("parse", "--pipeline-file", pipeline, "--trace", `${stage}:0`, "a");
        assert.equal(out.status, 2, out.stderr);
        assert.equal(out.stdout, "");
        assert.ok(out.stderr.includes(plain.stderr.trim()), out.stderr);
        assert.doesNotMatch(out.stderr, /predicted:|could read next:/);
      }
      const earlier = run("parse", "--pipeline-file", pipeline, "--trace", "first:0", "a");
      assert.equal(earlier.status, 2, earlier.stderr);
      assert.match(earlier.stdout, /The first stage at position 0/);
      assert.ok(earlier.stderr.includes(plain.stderr.trim()), earlier.stderr);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
