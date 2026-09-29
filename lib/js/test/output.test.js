// The tree rendering for people (docs/output.md), on trees built by hand, so
// that a case can have sources out of text order (engine §1) or labels that
// the bundled grammars never make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeTree, Token } from "../src/index.js";

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
