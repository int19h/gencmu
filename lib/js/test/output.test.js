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
