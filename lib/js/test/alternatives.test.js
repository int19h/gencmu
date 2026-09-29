// The layout tools/sync.js requires of a rule whose alternatives are single
// symbols (tools/alternatives.js, docs/notation.md "Rules").
import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleRules, layoutProblems, suggestLayout } from "../../../tools/alternatives.js";
import { loaderWith } from "./shared.js";

const loader = loaderWith({});
// A document of one block with `body` in it, fenced by `fence`.
const block = (body, fence = "```") => `# t\n\n${fence}jbogenbau\n${body}\n${fence.trim()}\n`;
/** @param {string} markdown */
const problems = (markdown) => layoutProblems(markdown, loader.readDocument(markdown, "t.md"), "t.md");
/** @param {string} markdown */
const eligible = (markdown) => eligibleRules(markdown, loader.readDocument(markdown, "t.md"), "t.md");

test("a sequence over several lines is not a choice", () => {
  const markdown = block("%rule x\n  a\n  b\n  c");
  assert.deepEqual(eligible(markdown), []);
  assert.deepEqual(problems(markdown), []);
});

test("a rule of one symbol per line gets a suggested layout", () => {
  assert.deepEqual(problems(block("%rule x\n  | a\n  | b\n  | c")), ["t.md:4: %rule x puts one symbol on each of its 3 lines; write:\n  a | b | c"]);
  assert.deepEqual(problems(block("%extend-rule x\n  a |\n  b")), ["t.md:4: %extend-rule x puts one symbol on each of its 2 lines; write:\n  a | b"]);
});

test("a rule that groups some of its symbols keeps its grouping", () => {
  const markdown = block("%rule x\n  | a | b\n  | c\n  | d");
  assert.deepEqual(eligible(markdown).map((rule) => rule.symbols), [[{ text: "a", lines: [5] }, { text: "b", lines: [5] }, { text: "c", lines: [6] }, { text: "d", lines: [7] }]]);
  assert.deepEqual(problems(markdown), []);
});

test("a body can begin on the rule's own line", () => {
  assert.deepEqual(problems(block("%rule x a | b | c")), []);
  assert.deepEqual(problems(block("%rule x a\n  | b\n  | c")), ["t.md:4: %rule x puts one symbol on each of its 3 lines; write:\n  a | b | c"]);
});

test("comments are not symbols, and a line of only a comment is not a line of the body", () => {
  const markdown = block("%rule x (* a | b *)\n  | a (* c | d *)\n  (* e | f *)\n  | g (* %rule y *)\n%rule y z");
  assert.deepEqual(eligible(markdown).map((rule) => rule.symbols.map((symbol) => symbol.text)), [["a", "g"]]);
  assert.deepEqual(problems(markdown), ["t.md:4: %rule x puts one symbol on each of its 2 lines; write:\n  a | g"]);
});

test("ranges, properties, tested symbols, ε and # are single symbols", () => {
  const markdown = block("%rule x\n  | 'a'..'z'\n  | '\\p{L}'\n  | LE=\"l|a\"\n  | UI ⊇ (A ∪ B)\n  | ε\n  | #\n  | /'/\n  | 'x'");
  assert.deepEqual(problems(markdown), ["t.md:4: %rule x puts one symbol on each of its 8 lines; write:\n  'a'..'z' | '\\p{L}' | LE=\"l|a\" | UI ⊇ (A ∪ B) | ε | # | /'/ | 'x'"]);
  // A capture, a group of several alternatives and a guarded alternative are
  // not, nor is an alternative with tags of its own.
  for (const other of ["$c(a)", "(a | b)", "f? a", "a <~t>"]) assert.deepEqual(eligible(block(`%rule x\n  | ${other}\n  | b`)), [], other);
});

test("every fence that the reader accepts is read", () => {
  const expected = ["t.md:4: %rule x puts one symbol on each of its 2 lines; write:\n  a | b"];
  assert.deepEqual(problems(block("%rule x\n  | a\n  | b", "~~~")), expected);
  assert.deepEqual(problems(block("%rule x\n  | a\n  | b", "````")), expected);
  // A fence indented by up to three spaces, with the body indented under it.
  assert.deepEqual(problems(block("   %rule x\n     | a\n     | b", "   ```")),
    ["t.md:4: %rule x puts one symbol on each of its 2 lines; write:\n     a | b"]);
  // A later block of the same document, after prose.
  const two = "# t\n\n```jbogenbau\n%rule y a | b\n```\n\nProse.\n\n~~~~jbogenbau\n%rule x\n  | a\n  | b\n~~~~\n";
  assert.deepEqual(problems(two), ["t.md:10: %rule x puts one symbol on each of its 2 lines; write:\n  a | b"]);
});

test("a line of the body holds at most 100 code points", () => {
  const fits = `  | ${Array(14).fill("abcd").join(" | ")}`;
  assert.equal(fits.length, 99);
  assert.deepEqual(problems(block(`%rule x\n${fits}\n  | a`)), []);
  assert.deepEqual(problems(block(`%rule x\n${fits}bc\n  | a`)), ["t.md:5: a line of %rule x holds 101 characters, more than 100"]);
  // An astral character is two UTF-16 units but one code point.
  const astral = `  | ${["abcdefg", ...Array(11).fill("abcd"), "'𝔞'", "'𝔟'"].join(" | ")}`;
  assert.deepEqual([[...astral].length, astral.length], [100, 102]);
  assert.deepEqual(problems(block(`%rule x\n${astral}\n  | a`)), []);
  // The line of a rule with a clause, whose body is on the rule's own line.
  assert.deepEqual(problems(block(`%rule x ${"a".repeat(45)} | ${"b".repeat(45)}\n%tags ~t`)), ["t.md:4: a line of %rule x holds 101 characters, more than 100"]);
});

test("the suggested layout has the fewest lines, balanced by length", () => {
  const [a, b, c] = ["a".repeat(55), "b".repeat(40), "c"];
  // Three lines when balanced by the count of symbols, but two fit.
  assert.deepEqual(suggestLayout([a, b, c], "  "), [`  | ${a}`, `  | ${b} | ${c}`]);
  assert.deepEqual(suggestLayout([c, b, a], "  "), [`  | ${c} | ${b}`, `  | ${a}`]);
  // Of the splits into two lines, the one whose longest line is shortest.
  const names = ["x".repeat(30), "y".repeat(30), "z".repeat(30), "w".repeat(10)];
  assert.deepEqual(suggestLayout(names, "  "), [`  | ${names[0]} | ${names[1]}`, `  | ${names[2]} | ${names[3]}`]);
  assert.deepEqual(suggestLayout(["a", "b"], "  "), ["  a | b"]);
});

test("a symbol longer than a line stands on its own line", () => {
  const long = "l".repeat(120);
  assert.deepEqual(suggestLayout([long, "a", "b"], "  "), [`  | ${long}`, "  | a | b"]);
  assert.deepEqual(suggestLayout(["a", long, "b"], "  "), ["  | a", `  | ${long}`, "  | b"]);
  assert.deepEqual(problems(block(`%rule x\n  | ${long}\n  | a\n  | b`)), [
    "t.md:5: a line of %rule x holds 124 characters, more than 100",
    `t.md:4: %rule x puts one symbol on each of its 3 lines; write:\n  | ${long}\n  | a | b`,
  ]);
  // When no two symbols fit on a line, one per line is the only layout, and
  // only the long lines are reported.
  assert.deepEqual(problems(block(`%rule x\n  | ${long}\n  | ${long}`)), [
    "t.md:5: a line of %rule x holds 124 characters, more than 100",
    "t.md:6: a line of %rule x holds 124 characters, more than 100",
  ]);
});

// A union of tags, of more than `least` characters.
/** @param {number} least */
const union = (least) => {
  const tags = [];
  while (tags.join(" ∪ ").length <= least) tags.push(`T${tags.length}`);
  return tags.join(" ∪ ");
};

test("every line that a symbol occupies counts", () => {
  const long = union(120);
  const markdown = block(`%rule x\n  | A⊇(\n    ${long}\n  ) | C`);
  assert.deepEqual(eligible(markdown).map((rule) => rule.symbols.map((symbol) => symbol.lines)), [[[5, 6, 7], [7]]]);
  assert.deepEqual(problems(markdown), [`t.md:6: a line of %rule x holds ${[...long].length + 4} characters, more than 100`]);
});

test("a symbol over several lines keeps its line breaks in the suggestion", () => {
  const markdown = block("%rule x\n  | A⊇(\n    B\n  )\n  | C");
  const expected = "  | A⊇(\n    B\n  ) | C";
  assert.deepEqual(problems(markdown), [`t.md:4: %rule x puts one symbol on each of its 4 lines; write:\n${expected}`]);
  assert.deepEqual(problems(block(`%rule x\n${expected}`)), []);
  // A comment and a string inside a symbol stay as written.
  assert.deepEqual(suggestLayout(["A⊇(B (* one\n  two *) ∪ C)", "D=\"d\""], "  "), ["  | A⊇(B (* one", "  two *) ∪ C) | D=\"d\""]);
});

test("every suggestion passes the check", () => {
  // A small generator of rules, the same on every run.
  let seed = 7;
  const next = (/** @type {number} */ bound) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  for (let round = 0; round < 60; round++) {
    const symbols = [];
    const count = 2 + next(8);
    for (let k = 0; k < count; k++) {
      const kind = next(10);
      if (kind < 6) symbols.push(`r${"x".repeat(next(40))}${k}`);
      else if (kind < 8) symbols.push(`R${k}⊇(\n    ${union(next(90))}\n  )`);
      else if (kind < 9) symbols.push(`r${"y".repeat(60 + next(50))}${k}`);
      else symbols.push("ε");
    }
    const sprawling = block(`%rule x\n${symbols.map((symbol) => `  | ${symbol}`).join("\n")}`);
    const found = problems(sprawling).find((problem) => problem.includes("puts one symbol"));
    const suggestion = found ? found.split("\n").slice(1) : suggestLayout(symbols, "  ");
    // Laid out as suggested, the rule has no problem but the lines that are
    // too long, and those are lines of a symbol that does not fit alone.
    const tooLong = suggestion.filter((line) => [...line].length > 100);
    const after = problems(block(`%rule x\n${suggestion.join("\n")}`));
    assert.equal(after.length, tooLong.length, `${suggestion.join("\n")}\n${after.join("\n")}`);
    assert.ok(after.every((problem) => problem.includes("more than 100")), after.join("\n"));
    for (const line of tooLong) assert.equal(symbols.filter((symbol) => line.includes(symbol.split("\n")[0])).length, 1, line);
  }
});
