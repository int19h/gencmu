// The tree rendering for people (docs/output.md), on trees built by hand, so
// that a case can have sources out of text order (engine §1) or labels that
// the bundled grammars never make.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nodeTree, Token } from "../src/index.js";
import { loadDialectSources, toTree, displayValue, prettyJson, toBrackets, tokenTable, nodeBrackets } from "../src/node.js";
import { grammars, runEngineCase } from "./shared.js";

/**
 * A rule `text` over one token node per token, in the order given.
 * @param {Token[]} tokens
 */
const flat = (tokens) => ({
  kind: /** @type {"rule"} */ ("rule"), rule: "text", span: [0, tokens.length], source: [0, 0], tags: new Set(),
  children: tokens.map((token, index) => ({
    kind: /** @type {"token"} */ ("token"), terminal: "W", token: index, span: [index, index + 1], source: token.source,
  })),
});

/**
 * @param {[number, number]} source
 * @param {string} text
 * @param {string} [label]
 */
const token = (source, text, label = text) => new Token(new Set(["W"]), [0, 1], source, text, null, undefined, label);

test("a rule's tokens are on one line only if nothing between their least start and greatest end breaks it", () => {
  // Sources need not follow text order (engine §1): here the first token
  // reads `b`, on the second line, and the second reads `a`, on the first.
  const tokens = [token([2, 3], "b"), token([0, 1], "a")];
  assert.equal(nodeTree(flat(tokens), tokens, "a\nb"), 'text\n  W "b"\n  W "a"');
  assert.equal(nodeTree(flat(tokens), tokens, "a b"), "text · b a");
});

test("a label with a line break is never summarized, even from source on one line", () => {
  // A token can have a label with a line break although its source has
  // none, as a token that a caller supplies can.
  const tokens = [token([0, 1], "a", "\n")];
  assert.equal(nodeTree(flat(tokens), tokens, "a"), 'text\n  W "\\n"');
  assert.equal(nodeTree(flat(tokens), tokens), 'text\n  W "\\n"');
  const carriage = [token([0, 1], "a", "x\ry")];
  assert.equal(nodeTree(flat(carriage), carriage, "a"), 'text\n  W "x\\ry"');
});

// Attachments in the renderings (docs/output.md), over a two-stage pipeline
// whose first stage attaches `b` before a word and `i`, with `n` after it,
// after the word.

const block = (text) => "```jbogenbau\n%ambiguity-resolution greedy\n" + text + "\n```\n";
const attaching = (second) => loadDialectSources({
  "unicode.txt": fs.readFileSync(path.join(grammars, "unicode.txt"), "utf8"),
  "notation/bootstrap.json": fs.readFileSync(path.join(grammars, "notation", "bootstrap.json"), "utf8"),
  "p.md": "```jbogenbau\n%stage a\n%include \"a.md\"\n%stage b\n%include \"b.md\"\n```\n",
  "a.md": block(`%rule text item ...
%rule item | $w(word) | $b(bb) $w(word) | $w(word) $a(ind) | $b(bb) $w(word) $a(ind)
%emits ($b) $w ($a)
%rule word 'w' <~before> | 'z' <Z> | 'x' <X ∪ ~mark>
%rule bb 'b' <B> %emits $
%rule ind | $u(uu) | $u(uu) $n(nn)
%emits $u ($n)
%rule uu 'i' <I ∪ UI ∪ ~mark>
%rule nn 'n' %emits $ <~low>`),
  "b.md": block(second),
}, "p.md");

test("the tree shows a token's attachments under it, and never summarizes a rule over one", () => {
  const dialect = attaching("%rule text pair ...\n%rule pair ~before Z | X");
  const result = dialect.parse("bwinz", {});
  assert.equal(result.ok, true);
  assert.equal(toTree(result), [
    "text › pair",
    '  before "w"',
    '    ◂ B "b"',
    '    ▸ I ∪ UI "i"',
    '      ▸ "n"',
    '  Z "z"',
  ].join("\n"));
  // A rule over tokens without attachments keeps its summary.
  assert.equal(toTree(dialect.parse("wz", {})), "text › pair · w z");
});

test("the display JSON writes a token with attachments with fixed members, so a terminal named before cannot collide", () => {
  const dialect = attaching("%rule text ~before ...");
  const value = displayValue(dialect.parse("bwinw", {}));
  assert.deepEqual(value, { text: [
    { terminal: "before", label: "w", before: [{ classes: ["B"], label: "b" }], after: [{ classes: ["I", "UI"], label: "i", after: [{ label: "n" }] }] },
    { before: "w" },
  ] });
  assert.match(prettyJson(value), /"terminal": "before"/);
});

test("the brackets, the tied tree and the token table show the same attachments", () => {
  const dialect = attaching("%rule text a | b\n%rule a ~before\n%rule b ~before");
  const result = dialect.parse("bwi", {});
  assert.equal(result.stages[1].verdict, "tie");
  const tokens = /** @type {any} */ (result.stages[1].input);
  assert.equal(toBrackets(result), "(b w i)");
  assert.equal(nodeBrackets(/** @type {any} */ (result.stages[1].tied), tokens), "(b w i)");
  assert.match(tokenTable(result, "a"), /attached: ◂ B "b", ▸ I ∪ UI "i"/);
});

test("of two errors in one item, the before-attachment's comes first (engine §11)", () => {
  const testCase = JSON.parse(fs.readFileSync(path.join(grammars, "..", "tests", "engine", "attach-error-order.json"), "utf8"));
  const outcome = runEngineCase(testCase);
  assert.match(outcome.result.error.message, /two phoneme tags/);
});

test("an inserted token's error comes after an earlier attachment's (engine §11)", () => {
  const testCase = JSON.parse(fs.readFileSync(path.join(grammars, "..", "tests", "engine", "attach-error-insert-order.json"), "utf8"));
  const outcome = runEngineCase(testCase);
  assert.match(outcome.result.error.message, /tag\("\?"\)/);
});

// A result owns its tag sets. A stage can put a set that its grammar holds
// on a token or a rule node, so a result that shared it would let a caller
// change later parses.
test("a change to a result's tag sets changes no later parse", () => {
  const block = (text) => "```jbogenbau\n" + text + "\n```\n";
  const cases = {
    "the tree's tags": ["%stage first\n%ambiguity-resolution greedy\n%const $K X\n%rule text 'a' <$K>\n%emits $\n%stage last\n%ambiguity-resolution greedy\n%rule text X",
      (result) => result.stages[0].tree.tags.clear()],
    "an emitted token's tags": ["%stage a\n%ambiguity-resolution greedy\n%const $K X\n%rule text $w('a')\n%emits $w <$K>\n%stage b\n%ambiguity-resolution greedy\n%rule text X",
      (result) => result.stages[0].output[0].tags.clear()],
    "a classifier's classes": ["%stage a\n%ambiguity-resolution greedy\n%classifier c\n  \"a\" ∈ X\n%rule text $w('a') <classify(text($w), c)>\n%emits $\n%stage b\n%ambiguity-resolution greedy\n%rule text X",
      (result) => result.stages[0].tree.tags.clear()],
    "a range's tags": ["%stage a\n%ambiguity-resolution greedy\n%rule text $w('a') <'a'..'b'>\n%emits $\n%stage b\n%ambiguity-resolution greedy\n%rule text 'a'",
      (result) => result.stages[0].tree.tags.clear()],
    "the tied tree's tags": ["%stage first\n%ambiguity-resolution greedy\n%const $K X\n%rule text x | y\n%rule x 'a' <$K>\n%emits $\n%rule y 'a' <$K>\n%emits $\n%stage last\n%ambiguity-resolution greedy\n%rule text X",
      (result) => result.stages[0].tied.children[0].tags.clear()],
  };
  for (const [name, [grammar, change]] of Object.entries(cases)) {
    const dialect = loadDialectSources({ "p.md": block(grammar) }, "p.md");
    const first = dialect.parse("a", { autoFeatures: false });
    assert.equal(first.ok, true, name);
    change(first);
    assert.equal(dialect.parse("a", { autoFeatures: false }).ok, true, name);
  }
});

test("a result does not share the tag sets of the caller's tokens", () => {
  const dialect = loadDialectSources({ "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n```\n" }, "p.md");
  const tags = new Set(["A"]);
  const result = dialect.parse("a", { tokens: [new Token(tags, [0, 1], [0, 1], "a", null, undefined)], autoFeatures: false });
  assert.equal(result.ok, true);
  tags.add("B");
  assert.deepEqual([...result.stages[0].input[0].tags], ["A"]);
});

test("a chain of attachments as deep as a long text parses", () => {
  const dialect = loadDialectSources({ "p.md": "```jbogenbau\n%stage a\n%ambiguity-resolution greedy\n%rule text chain\n%rule chain $c(chain) $w('a') %emits ($c) $w <W>\n%extend-rule chain 'b' %emits $ <W>\n%stage b\n%ambiguity-resolution greedy\n%rule text W\n```\n" }, "p.md");
  assert.equal(dialect.parse("b" + "a".repeat(10000)).ok, true);
});

test("a result and the caller's tokens share no positions", () => {
  const dialect = loadDialectSources({ "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n```\n" }, "p.md");
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  const result = dialect.parse("a", { tokens: [token], autoFeatures: false });
  // The caller changes its token: the result stays as it was.
  token.span[1] = 99;
  token.source[0] = 99;
  assert.deepEqual([result.stages[0].input[0].span, result.stages[0].input[0].source], [[0, 1], [0, 1]]);
  // The caller changes the result: its token stays as it was.
  token.span[1] = 1;
  token.source[0] = 0;
  result.stages[0].input[0].span[1] = 42;
  result.stages[0].input[0].source[0] = 42;
  result.stages[0].input[0].tags.add("B");
  assert.deepEqual([token.span, token.source, [...token.tags]], [[0, 1], [0, 1], ["A"]]);
});

test("a stage report holds no chart item and no parse context, and a change to its witness changes no later parse", () => {
  const dialect = loadDialectSources({ "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text x | y\n%rule x 'a'\n%rule y 'a'\n```\n" }, "p.md");
  const first = dialect.parse("a", { autoFeatures: false });
  const stage = first.stages[0];
  assert.equal(stage.verdict, "tie");
  assert.deepEqual(stage.witness, [
    { kind: "close", rule: "x", production: 2, helper: false, span: [0, 1] },
    { kind: "close", rule: "y", production: 3, helper: false, span: [0, 1] },
  ]);
  assert.ok(!("context" in stage) && !("derivation" in stage));
  const json = JSON.stringify(first.stages.map((stage) => stage.witness));
  for (const action of stage.witness) {
    if (action && action.kind === "close") {
      action.span.length = 0;
      action.production = -1;
    }
  }
  const again = dialect.parse("a", { autoFeatures: false });
  assert.equal(again.ok, true);
  assert.equal(JSON.stringify(again.stages.map((stage) => stage.witness)), json);
});
