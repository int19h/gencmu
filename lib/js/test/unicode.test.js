// The character table of grammars/unicode.txt (engine §1): the records can
// stand in any order, and a caller's table can leave scalar values out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGrammarFile } from "./shared.js";
import { UnicodeTable } from "../src/unicode.js";
import { loadDialectSources } from "../src/node.js";

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
      assert.equal(reversed.lowercase(text), bundled.lowercase(text), `U+${code.toString(16)}`);
    }
  }
  assert.equal(reversed.category(0x61), "Ll");
  assert.equal(reversed.category(0x41), "Lu");
});

test("a scalar value that a table omits is Cn, without White_Space or a lowercase mapping", () => {
  const table = new UnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n");
  assert.equal(table.category(0x41), "Lu");
  assert.equal(table.category(0x61), "Cn");
  assert.equal(table.category(0x10ffff), "Cn");
  assert.equal(table.category(0x0), "Cn");
  assert.equal(table.category(0xd800), "Cs");
  assert.ok(table.hasProperty("Cn", 0x61) && table.hasProperty("C", 0x61));
  assert.ok(!table.hasProperty("L", 0x61) && !table.hasProperty("Cs", 0x61));
  assert.ok(!table.isWhiteSpace(0x20) && !table.isWhiteSpace(0x9) && !table.hasProperty("White_Space", 0x20));
  assert.equal(table.lowercase("AB"), "AB");
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
  assert.ok(!loadDialectSources(sources("'\\p{L}'"), "p.md").parse("a", options).ok);
  assert.ok(loadDialectSources(sources("'\\p{Cn}'"), "p.md").parse("a", options).ok);
  const { "unicode.txt": _, ...bundled } = sources("'\\p{L}'");
  assert.ok(loadDialectSources(bundled, "p.md").parse("a", options).ok);
});
