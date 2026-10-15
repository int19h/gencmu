// The character table of grammars/unicode.txt (engine §1): the records can
// stand in any order, and a caller's table can leave scalar values out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGrammarFile } from "./shared.js";
import { UnicodeTable } from "../src/unicode.js";
import { characterTokens } from "../src/tokens.js";
import { loadDialectSources, GencmuError } from "../src/node.js";

const bundledText = /** @type {string} */ (readGrammarFile("unicode.txt"));

// Every code point next to a boundary of a record, where an unsorted search
// goes wrong first.
function boundaries() {
  const points = new Set();
  for (const line of bundledText.split("\n")) {
    for (const field of line.trim().split(/\s+/).slice(1)) {
      const value = parseInt(field, 16);
      if (Number.isNaN(value) || field.includes(".")) continue;
      for (const point of [value - 1, value, value + 1]) if (point >= 0 && point <= 0x10ffff) points.add(point);
    }
  }
  return [...points];
}

test("the records of a table give the same answers in any order", () => {
  const bundled = new UnicodeTable(bundledText);
  const reversed = new UnicodeTable(bundledText.trimEnd().split("\n").reverse().join("\n"));
  assert.equal(reversed.version, bundled.version);
  for (const code of boundaries()) {
    assert.equal(reversed.category(code), bundled.category(code), `U+${code.toString(16)}`);
    assert.equal(reversed.isWhiteSpace(code), bundled.isWhiteSpace(code), `U+${code.toString(16)}`);
    if (code < 0xd800 || code > 0xdfff) {
      const text = String.fromCodePoint(code);
      assert.deepEqual(characterTokens(text, reversed), characterTokens(text, bundled), `U+${code.toString(16)}`);
    }
  }
  assert.equal(reversed.category(0x61), "Ll");
  assert.equal(reversed.category(0x41), "Lu");
});

test("an omitted scalar stores Cn and C without whitespace and keeps its original strings", () => {
  const table = new UnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n");
  assert.equal(table.category(0x41), "Lu");
  assert.equal(table.category(0x61), "Cn");
  assert.equal(table.category(0x10ffff), "Cn");
  assert.equal(table.category(0x0), "Cn");
  assert.equal(table.category(0xd800), "Cs");
  const [a] = characterTokens("a", table);
  assert.deepEqual([...a.tags].sort(), ["_C", "_Cn"]);
  assert.deepEqual([a.value, a.image], ["a", "a"]);
  assert.ok(!table.isWhiteSpace(0x20) && !table.isWhiteSpace(0x9));
  assert.deepEqual(characterTokens("AB", table).map(token => [token.value, token.image]), [["A", "A"], ["B", "B"]]);
  assert.ok(!table.isMark(0x301));
});

test("a caller's table replaces the bundled one entirely (engine §1)", () => {
  // A table that knows no letters, only the white space that the notation
  // reads between tokens.
  const table = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n";
  const sources = (rule) => ({
    "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + rule + "\n```\n",
    "unicode.txt": table,
  });
  const options = { autoFeatures: false };
  assert.ok(!loadDialectSources(sources("_L"), "p.md").parse("a", options).ok);
  assert.ok(loadDialectSources(sources("_Cn"), "p.md").parse("a", options).ok);
  const { "unicode.txt": _, ...bundled } = sources("_L");
  assert.ok(loadDialectSources(bundled, "p.md").parse("a", options).ok);
});

test("a text or a document with a lone surrogate is a usage error (engine §1)", () => {
  const sources = (rule) => ({
    "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + rule + "\n```\n",
  });
  const usage = (error) => error instanceof GencmuError && error.kind === "usage";
  const options = { autoFeatures: false };
  // Each of these would read U+D800 if it became a character tag.
  for (const rule of ["_Cs", "_", "$_D7FF..$_E000", "[{character}]\n%rule character _"]) {
    const dialect = loadDialectSources(sources(rule), "p.md");
    for (const text of ["\uD800", "a\uDC00", "\uDBFF\uDBFF", "\uDFFF\uD800"]) {
      assert.throws(() => dialect.parse(text, options), usage, `${rule} over ${JSON.stringify(text)}`);
      assert.throws(() => dialect.parse(text, { ...options, tokens: [] }), usage);
    }
    // A surrogate pair is one scalar value, and no error.
    assert.doesNotThrow(() => dialect.parse("\uD83D\uDE00", options));
  }
  assert.ok(loadDialectSources(sources("_"), "p.md").parse("\uD83D\uDE00", options).ok);
  assert.throws(() => loadDialectSources(sources("\"\uD800\""), "p.md"), usage);
});


test("omitted decomposition and combining records have separate defaults", () => {
  const noClasses = new UnicodeTable("decompose 00E1 0061 0301\n");
  assert.equal(noClasses.decompose("ạ́"), "ạ́");
  assert.equal(noClasses.decompose("한"), "한");
  const noMappings = new UnicodeTable("combining 230 0301 0301\ncombining 220 0323 0323\n");
  assert.equal(noMappings.decompose("ạ́"), "ạ́");
  assert.equal(noMappings.decompose("ạ́"), "ạ́");
});
