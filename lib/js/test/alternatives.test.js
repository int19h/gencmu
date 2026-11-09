// The layout tools/sync.js requires of the top-level alternatives of a
// rule (tools/alternatives.js, docs/notation.md "Layout of the bundled
// grammars").
import { test } from "node:test";
import assert from "node:assert/strict";
import { alternativeLayouts, layoutProblems } from "../../../tools/alternatives.js";
import { loaderWith } from "./shared.js";

const loader = loaderWith({});
// A document of one block with `body` in it, fenced by `fence`.
const block = (body, fence = "```") => `# t\n\n${fence}jbogenbau\n${body}\n${fence.trim()}\n`;
/** @param {string} markdown */
const problems = (markdown) => layoutProblems(markdown, loader.readDocument(markdown, "t.md"), "t.md");
/** @param {string} markdown */
const layouts = (markdown) => alternativeLayouts(markdown, loader.readDocument(markdown, "t.md"), "t.md");

test("a sequence over several lines is not a choice", () => {
  const markdown = block("%rule x\n  a\n  b\n  c");
  assert.deepEqual(layouts(markdown)[0].alternatives.length, 1);
  assert.deepEqual(problems(markdown), []);
});

test("plain alternatives can stand one on each line, and a splice is a plain item", () => {
  assert.deepEqual(problems(block("%rule x\n  | a\n  | b\n  | c")), []);
  assert.deepEqual(problems(block("%extend-rule x\n  a |\n  b")), []);
  // A splice without a test is plain, so it can share a line and can
  // stand in a plain sequence.
  assert.deepEqual(problems(block("%rule x\n  | *a | b")), []);
  assert.deepEqual(problems(block("%rule x\n  | *a b\n  | c")), []);
  // Failing: a splice under a test is marked, so it cannot share a line.
  assert.deepEqual(problems(block("%rule x\n  | *a<T> | b")),
    ["t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"]);
  assert.deepEqual(problems(block("%rule x\n  | *a<T>\n  | b")), []);
});

test("an emoji rule name precedes its two alternatives", () => {
  for (const name of ["😀", "🆓"]) {
    const markdown = block(`%rule ${name}\n  | a\n  | b`);
    assert.deepEqual(layouts(markdown)[0].alternatives.map(alternative => alternative.text), ["a", "b"]);
    assert.deepEqual(problems(markdown), []);
  }
});

test("a rule that groups some of its symbols keeps its grouping", () => {
  const markdown = block("%rule x\n  | a | b\n  | c\n  | d");
  assert.deepEqual(layouts(markdown)[0].alternatives.map(({ text, lines }) => ({ text, lines })), [{ text: "a", lines: [5] }, { text: "b", lines: [5] }, { text: "c", lines: [6] }, { text: "d", lines: [7] }]);
  assert.deepEqual(problems(markdown), []);
});

test("a body can begin on the rule's own line", () => {
  assert.deepEqual(problems(block("%rule x a | b | c")), []);
  assert.deepEqual(problems(block("%rule x a\n  | b\n  | c")), []);
});

test("comments are not symbols, and a line of only a comment is not a line of the body", () => {
  const markdown = block("%rule x -- a | b\n  | a -- c | d\n  -- e | f\n  | g -- %rule y\n%rule y z");
  assert.deepEqual(layouts(markdown).map((rule) => rule.alternatives.map((alternative) => alternative.text)), [["a", "g"], ["z"]]);
  assert.deepEqual(problems(markdown), [
    "t.md:4: put a comment on its own lines, before the rule or alternative that it describes",
    "t.md:5: put a comment on its own lines, before the rule or alternative that it describes",
    "t.md:7: put a comment on its own lines, before the rule or alternative that it describes",
  ]);
});

test("plain items are references, strings, tag and engine tags, ε, parameters and _<T>", () => {
  const markdown = block("%rule x\n  | _General_Category_Letter\n  | ε\n  | 🆓\n  | Sound-0027-s\n  | \"x\"\n  | _<T>\n  | KOhA");
  assert.deepEqual(problems(markdown), []);
  // A range, another test, a capture, a group, a guard and a clause each
  // mark an alternative, so it cannot share a line with a plain one.
  for (const other of ["\"a\"..\"z\"", "LE=\"l|a\"", "UI <A B>", "$c:a", "(a | b)", "f? a", "a :: T", "[a]", "{a}", "a & b", "(a ≻ b)", "x(\"a\")", "_<T U>", "_"]) assert.deepEqual(problems(block(`%rule x
  | ${other} | b`)), ["t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"], other);
});

test("alternative recipes mark an alternative, so it stands on lines of its own", () => {
  const document = block('%rule x :- $.image\n  | "A"<Stressed> := "a"\n  | "E"<Stressed> := "e"');
  assert.deepEqual(problems(document), []);
  assert.deepEqual(problems(block('%rule x :- $.image\n  | "A"<Stressed> := "a" | "E"<Stressed> := "e"')),
    ['t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own']);
  assert.deepEqual(problems(block('%rule x\n  | "a" :- "A" | "e" :- "E"')),
    ['t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own']);
  assert.deepEqual(problems(block('%rule x\n  | "a" := "a" :- "A"\n  | "e" := "e" :- "E"')), []);
});

test("every fence that the reader accepts is read", () => {
  // A marked alternative that shares a line is read in every fence form.
  const expected = ["t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"];
  assert.deepEqual(problems(block("%rule x\n  | [a] b | c", "~~~")), expected);
  assert.deepEqual(problems(block("%rule x\n  | [a] b | c", "````")), expected);
  // A fence indented by up to three spaces, with the body indented under it.
  assert.deepEqual(problems(block("   %rule x\n     | [a] b | c", "   ```")), expected);
  // A later block of the same document, after prose.
  const two = "# t\n\n```jbogenbau\n%rule y a | b\n```\n\nProse.\n\n~~~~jbogenbau\n%rule x\n  | [a] b | c\n~~~~\n";
  assert.deepEqual(problems(two), ["t.md:11: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"]);
});

test("a line of the body holds at most 100 code points", () => {
  const fits = `  | ${Array(14).fill("abcd").join(" | ")}`;
  assert.equal(fits.length, 99);
  assert.deepEqual(problems(block(`%rule x
${fits}
  | a`)), []);
  assert.deepEqual(problems(block(`%rule x
${fits}bc
  | a`)), ["t.md:5: a line of %rule x holds 101 characters, more than 100"]);
  // An astral character is two UTF-16 units but one code point.
  const astral = `  | ${["abcdefg", ...Array(11).fill("abcd"), "\"𝔞\"", "\"𝔟\""].join(" | ")}`;
  assert.deepEqual([[...astral].length, astral.length], [100, 102]);
  assert.deepEqual(problems(block(`%rule x
${astral}
  | a`)), []);
  // The line of a rule with a clause, whose body is on the rule's own line.
  assert.deepEqual(problems(block(`%rule x :: T | ${"a".repeat(45)} | ${"b".repeat(45)}
`)), ["t.md:4: a line of %rule x holds 108 characters, more than 100"]);
});


test("a symbol longer than a line stands on its own line", () => {
  const long = "l".repeat(120);
  assert.deepEqual(problems(block(`%rule x
  | ${long}
  | a
  | b`)), ["t.md:5: a line of %rule x holds 124 characters, more than 100"]);
  // When no two symbols fit on a line, one per line is the only layout, and
  // only the long lines are reported.
  assert.deepEqual(problems(block(`%rule x
  | ${long}
  | ${long}`)), [
    "t.md:5: a line of %rule x holds 124 characters, more than 100",
    "t.md:6: a line of %rule x holds 124 characters, more than 100",
  ]);
});

// A union of tags, of more than `least` characters.
/** @param {number} least */
const union = (least) => {
  const tags = [];
  while (tags.join(" ").length <= least) tags.push(`T${tags.length}`);
  return tags.join(" ");
};

test("every line that a symbol occupies counts", () => {
  const long = union(120);
  const markdown = block(`%rule x
  | A<
    ${long}
  >
  | C`);
  assert.deepEqual(problems(markdown), [`t.md:6: a line of %rule x holds ${[...long].length + 4} characters, more than 100`]);
});


test("one plain alternative on each line passes the check", () => {
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
      else if (kind < 8) symbols.push(`"s${k}"`);
      else if (kind < 9) symbols.push(`r${"y".repeat(60 + next(50))}${k}`);
      else symbols.push("ε");
    }
    const sprawling = block(`%rule x
${symbols.map((symbol) => `  | ${symbol}`).join("\n")}`);
    // One plain alternative on each line is a layout that the check
    // accepts. Only the lines of a symbol that does not fit alone are
    // reported, for their length.
    const tooLong = symbols.map((symbol) => `  | ${symbol}`).filter((line) => [...line].length > 100);
    const after = problems(sprawling);
    assert.equal(after.length, tooLong.length, `${after.join("\n")}`);
    assert.ok(after.every((problem) => problem.includes("more than 100")), after.join("\n"));
  }
});



test("common tag clauses stay on the header and retain the body's leading bar", () => {
  const split = block("%rule x\n  ::\n  T\n  | a | b");
  assert.deepEqual(problems(split), ["t.md:4: put the common tag clause on the definition header"]);
  const compact = block("%rule x :: T\n  | a | b");
  assert.deepEqual(problems(compact), []);
  loader.readDocument(block("%rule x :: T\n  | a | b"), "t.md");
});

test("blank grammar layout excludes the contents of comments and strings", () => {
  assert.deepEqual(problems(block("%rule x a\n\n%emits\n  $")), ["t.md:6: remove the blank line before the definition clause"]);
  assert.deepEqual(problems(block("%rule x a\n\n\n%rule y b")), ["t.md:6: leave at most one blank line between grammar items"]);
  assert.deepEqual(problems(block("-- keep\n%rule x\n--\n--\n-- %emits\n--\n \"a\"")), []);
  assert.deepEqual(problems(block('%rule x "a :: %emits"')), []);
});

test("part 1: a marked alternative stands on lines of its own, and plain alternatives can share lines", () => {
  // Passing: each marked alternative is alone, and the plain ones share.
  assert.deepEqual(problems(block("%rule x\n  | [a] b\n  | c d | e\n  | (f | g) :: T")), []);
  assert.deepEqual(problems(block("%rule plain-vowel :: ∅\n  | (\"a\" | \"e\" | \"i\" | \"o\" | \"u\") :: Vowel\n  | \"y\"")), []);
  // Failing: a marked alternative shares a line with another alternative.
  assert.deepEqual(problems(block("%rule x\n  | [a] b | c")),
    ["t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"]);
  assert.deepEqual(problems(block("%rule x\n  | a | [b] c")),
    ["t.md:5: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"]);
  // A choice inside a group is one alternative, so its options can share.
  assert.deepEqual(problems(block("%rule x\n  | (a | b)\n  | c | d")), []);
});

test("part 1: plain alternatives can share lines or stand one on each line", () => {
  // Both forms pass, for single items and for sequences.
  assert.deepEqual(problems(block("%rule x\n  a b | c d")), []);
  assert.deepEqual(problems(block("%rule x\n  | a b\n  | c d | e f")), []);
  assert.deepEqual(problems(block("%rule x\n  | a b\n  | c d")), []);
  // A comment line does not count toward the 100 character limit.
  assert.deepEqual(problems(block(`%rule x
  -- ${"c".repeat(101)}
  | a | b`)), []);
});

test("part 1: no line of a rule body holds more than 100 characters", () => {
  // Passing is the first case of "a line of the body holds at most 100
  // code points". Failing, for a marked alternative as well:
  const long = "[a] " + "b".repeat(100);
  assert.deepEqual(problems(block(`%rule x\n  ${long}`)), [`t.md:5: a line of %rule x holds ${[...`  ${long}`].length} characters, more than 100`]);
});

test("a pattern child list does not split an alternative at its bars", () => {
  // The `|` inside « » belongs to the pattern child list, not to the body.
  assert.deepEqual(problems(block("%rule x\n  | \"a\" :: $ ≅ #« \"a\" | \"b\" » ⟹ T\n  | \"b\" :: V")), []);
  assert.deepEqual(problems(block("%rule x :: $ ≅ #« \"a\" | \"b\" » ⟹ T\n  | a | b")), []);
});

test("a comment inside an alternative does not make it marked, and its line does not count", () => {
  // Passing: the comment is whitespace between the items of a plain
  // sequence. Its punctuation does not mark the alternative either.
  assert.deepEqual(problems(block("%rule x\n  a\n    -- About [b].\n    b | c")), []);
  // Passing: a comment line inside an alternative does not count toward
  // the 100 character limit, however long it is.
  assert.deepEqual(problems(block(`%rule x
  a
  -- ${"c".repeat(101)}
    b`)), []);
  // Failing: an alternative that is marked for another reason still
  // cannot share a line, with a comment inside it.
  assert.deepEqual(problems(block("%rule x\n  [a]\n    -- About b.\n    b | c")),
    ["t.md:7: a marked alternative of %rule x shares its line with another alternative; put it on lines of its own"]);
  // Failing: a long line of code inside an alternative still counts.
  assert.deepEqual(problems(block(`%rule x
  a
    ${"b".repeat(101)}`)), ["t.md:6: a line of %rule x holds 105 characters, more than 100"]);
});

test("part 2: a comment stands on its own lines before the rule or alternative that it describes", () => {
  // Passing: a comment on a whole rule, and one on a single alternative.
  assert.deepEqual(problems(block("-- A glide.\n%rule glide\n  \"i\" | \"u\"")), []);
  assert.deepEqual(problems(block("%rule x\n  -- About b.\n  | a | b")), []);
  assert.deepEqual(problems(block("%rule x\n  | a\n  -- About b.\n  | b")), []);
  // Failing: a comment follows a rule header on the same line.
  assert.deepEqual(problems(block("%rule x -- About x.\n  a | b")),
    ["t.md:4: put a comment on its own lines, before the rule or alternative that it describes"]);
  // Failing: a comment follows an alternative on the same line.
  assert.deepEqual(problems(block("%rule x\n  | a -- About a.\n  | b")),
    ["t.md:5: put a comment on its own lines, before the rule or alternative that it describes"]);
});

test('parameter and instance heads ignore punctuation inside comments',()=>{
  for(const comment of [')','(','"',') " ( | %rule',')\n"\n(']) {
    for(const head of [`%rule choose(@X -- ${comment.replaceAll("\n", "\n-- ")}\n, @Y)`,`%redefine-rule choose("a" -- ${comment.replaceAll("\n", "\n-- ")}\n, "b")`]) {
      const markdown=block(head+'\n  A | B');
      assert.deepEqual(layouts(markdown)[0].alternatives.map(alternative=>alternative.text),['A','B']);
      assert.ok(problems(markdown).length >= 1 && problems(markdown).every((problem) => problem.includes("put a comment on its own lines")), problems(markdown).join("\n"));
    }
  }
});

test("clauses that start a new line stand in the column of the first clause", () => {
  // Passing: the section's form.
  assert.deepEqual(problems(block(
`%rule runs
  | $r:run :: $r.tags
  | $p:runs pause-token $r:run :: $r.tags ∪
                                  (RAhOI ⊆ $p.tags ∧ $r.matches(only-hesitation) ⟹ RAhOI)
                               := $r.value`)), []);
  // Failing: `:=` does not stand under `::`.
  assert.deepEqual(problems(block(
`%rule runs
  $p:runs pause-token $r:run :: $r.tags ∪
                                (RAhOI ⊆ $p.tags ∧ $r.matches(only-hesitation) ⟹ RAhOI)
                           := $r.value`)),
    ["t.md:7: a clause of %rule runs does not stand in the column of its first clause"]);
});

test("a tag term over several lines ends each line with its union sign", () => {
  // Passing: each line ends with `∪`, and the next operand stands in
  // the column of the first operand.
  assert.deepEqual(problems(block(
`%rule runs
  $p:runs pause-token $r:run :: $r.tags ∪
                                (RAhOI ⊆ $p.tags ∧ $r.matches(only-hesitation) ⟹ RAhOI)`)), []);
  // Failing: a line of the term does not end with `∪`, and the next
  // line starts with `∪`.
  assert.deepEqual(problems(block(
`%rule x
  $c:a :: Word
     ∪ $c.tags`)), ["t.md:5: a tag term of %rule x runs over several lines, and each line ends with its ∪",
    "t.md:6: a tag term of %rule x starts a line with ∪"]);
  // Failing: the next operand does not stand in the column of the first.
  assert.deepEqual(problems(block(
`%rule x
  $c:a :: Word ∪
      $c.tags`)), ["t.md:6: an operand of a tag term of %rule x does not stand in the column of its first operand"]);
});

test("a tag term with two or more expressions puts each on a line of its own", () => {
  // Passing: a run of tags and one expression share a line, and two
  // expressions stand one on each line.
  assert.deepEqual(problems(block("%rule x\n  $c:a :: Word Cmavo ∪ $c.tags")), []);
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b :: $c.tags ∪
               $d.tags`)), []);
  // Failing: two expressions share a line.
  assert.deepEqual(problems(block("%rule x\n  $c:a $d:b :: $c.tags ∪ $d.tags")),
    ["t.md:5: a tag term of %rule x has two or more expressions, and each expression stands on a line of its own"]);
});

test("a tag term lists bare tags first, then unguarded, then guarded expressions", () => {
  // Passing: one run of bare tags, one unguarded expression, and one
  // guarded expression, each expression on a line of its own.
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b :: Word Cmavo ∪ $c.tags ∪
               ($d.matches(aa) ⟹ T)`)), []);
  // A run of bare tags can share the line of the first of two
  // expressions. Only the start lines of the expressions count.
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b :: Word Cmavo ∪ $c.tags ∪
               $d.tags`)), []);
  // Failing: a bare tag after an expression.
  assert.deepEqual(problems(block("%rule x\n  $c:a :: $c.tags ∪ Word")),
    ["t.md:5: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions"]);
  // Failing: two runs of bare tags.
  assert.deepEqual(problems(block("%rule x\n  $c:a :: Word ∪ Cmavo")),
    ["t.md:5: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions"]);
  // Failing: a guarded expression before an unguarded one, on the
  // same line. On lines of their own, the two can stand in the order
  // of their meaning (see the test below).
  assert.deepEqual(problems(block("%rule x\n  $c:a $d:b :: ($c.matches(aa) ⟹ T) ∪ $d.tags")),
    ["t.md:5: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions",
     "t.md:5: a tag term of %rule x has two or more expressions, and each expression stands on a line of its own"]);
});

test("a comment inside a tag term is not an operand or a term line", () => {
  assert.deepEqual(problems(block(
`%rule x
  $c:a :: Word ∪
  -- About the expression.
          $c.tags`)), []);
});

test("operand positions count code points, not UTF-16 units", () => {
  // Passing: an astral character before the clause shifts no column.
  assert.deepEqual(problems(block(
`%rule x
  "𝔞" $c:a $d:b :: $c.tags ∪
                   $d.tags`)), []);
  // Failing: the second operand stands one column short.
  assert.deepEqual(problems(block(
`%rule x
  "𝔞" $c:a $d:b :: $c.tags ∪
                  $d.tags`)),
    ["t.md:6: an operand of a tag term of %rule x does not stand in the column of its first operand"]);
});

test("emission items follow the clause and tag-term rules", () => {
  // Passing: bare tags, an unguarded expression and a guarded
  // expression, each expression on a line of its own.
  assert.deepEqual(problems(block(
`%rule x
  $c:a
%emits
  $c :: Word ∪
        $c.tags ∪
        ($c.matches(aa) ⟹ T) := " "`)), []);
  // Failing: two expressions of an emission term share a line.
  assert.deepEqual(problems(block(
`%rule x
  a
%emits
  $ :: ($.matches(aa) ⟹ A) ∪ ($.matches(bb) ⟹ B)`)),
    ["t.md:7: a tag term of %rule x has two or more expressions, and each expression stands on a line of its own"]);
  // Failing: an emission term lists a bare tag after an expression.
  assert.deepEqual(problems(block(
`%rule x
  $c:a
%emits
  $c :: $c.tags ∪ Word`)),
    ["t.md:7: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions"]);
});

test("a long condition inside brackets ends each line with its operator", () => {
  // Passing: each line ends with its operator, and the next line
  // stands one column after the opening bracket.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∧
    $n.matches(bb) ∨
    $n.matches(cc))`)), []);
  // Failing: a line ends with no operator. The next line starts
  // with it instead.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa)
    ∧ $n.matches(bb))`)),
    ["t.md:7: a line inside brackets of %rule x does not end with its operator"]);
  // Failing: the next lines stand in the wrong column.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∧
     $n.matches(bb) ∨
     $n.matches(cc))`)),
    ["t.md:8: a line inside brackets of %rule x does not stand one column after the opening bracket",
     "t.md:9: a line inside brackets of %rule x does not stand one column after the opening bracket"]);
});

test("an emission item can start on the %emits line", () => {
  // Passing: an item on the directive line, in the fixed order.
  assert.deepEqual(problems(block(
`%rule x
  $c:a
%emits $c :: Word ∪ $c.tags`)), []);
  // Failing: a bare tag after an expression, on the directive line.
  assert.deepEqual(problems(block(
`%rule x
  $c:a
%emits $c :: $c.tags ∪ Word`)),
    ["t.md:6: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions"]);
  // Failing: two expressions share the directive line.
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b
%emits $c :: $c.tags ∪ $d.tags`)),
    ["t.md:6: a tag term of %rule x has two or more expressions, and each expression stands on a line of its own"]);
});

test("nested brackets are checked only on their own top-level lines", () => {
  // Passing: each continuation stands one column after its own
  // opening bracket.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∧
    ($n.matches(bb) ∨
     $n.matches(cc)))`)), []);
  // Failing: the inner continuation stands in the wrong column, and
  // the problem is reported once, not once per enclosing bracket.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∧
    ($n.matches(bb) ∨
   $n.matches(cc)))`)),
    ["t.md:9: a line inside brackets of %rule x does not stand one column after the opening bracket"]);
  // Failing: an inner line ends with no operator, reported once.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∧
    ($n.matches(bb)
     ∨ $n.matches(cc)))`)),
    ["t.md:8: a line inside brackets of %rule x does not end with its operator"]);
});

test("a bracketed subset condition is checked like any other condition", () => {
  // Passing: the continuation stands one column after the bracket.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.tags ⊆
    Word)`)), []);
  // Failing: the continuation stands in the wrong column.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.tags ⊆
 Word)`)),
    ["t.md:8: a line inside brackets of %rule x does not stand one column after the opening bracket"]);
});

test("the line limit covers every line of a grammar block", () => {
  // Passing: a long comment line does not count.
  assert.deepEqual(problems(block(`%rule x
  a
  -- ${"word ".repeat(30)}`)), []);
  // Failing: a long condition line counts, although it stands
  // outside the rule body.
  const line = `  $n.value = "${"a".repeat(90)}"`;
  assert.deepEqual(problems(block(`%rule x
  $n:a
%conditions
${line}`)), [`t.md:7: a line of a grammar block holds ${[...line].length} characters, more than 100`]);
  // Passing: a line that holds only one long string cannot break.
  assert.deepEqual(problems(block(`%classifier c
  "${"a".repeat(110)}"
    ∈ UI`)), []);
  // Failing: a long string with more on its line counts.
  const entry = `  "${"a".repeat(110)}" ∈ UI`;
  assert.deepEqual(problems(block(`%classifier c
${entry}`)), [`t.md:5: a line of a grammar block holds ${[...entry].length} characters, more than 100`]);
});

test("a sole alternative under a bare header stands without a leading bar", () => {
  // Passing: no bar under a bare header, and a bar under a header
  // with a clause.
  assert.deepEqual(problems(block("%rule x\n  a")), []);
  assert.deepEqual(problems(block("%rule x :: T\n  | a")), []);
  // Failing: a bar under a bare header.
  assert.deepEqual(problems(block("%rule x\n  | a")),
    ["t.md:5: a sole alternative of %rule x follows a leading | under a bare header"]);
});

test("expressions on lines of their own can stand in the order of their meaning", () => {
  // Passing: a guarded expression before the unguarded part that
  // carries its tag, each on a line of its own.
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b :: ($c.matches(aa) ⟹ First) ∪
               First ∩ $d.tags`)), []);
  // Failing: a bare tag after the expressions, even on its own line.
  assert.deepEqual(problems(block(
`%rule x
  $c:a $d:b :: ($c.matches(aa) ⟹ First) ∪
               Word`)),
    ["t.md:5: a tag term of %rule x lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions"]);
});

test("a wrapped part of a tighter operator stands deeper inside brackets", () => {
  // Passing: the conjunction under `∨` wraps deeper than its first
  // line, and the guard's right side returns to the bracket column.
  assert.deepEqual(problems(block(
`%rule x
  $n:a
%conditions
  ¬($n.matches(aa) ∨
    $n.matches(bb) ∧ $n.matches(cc) ∧
      $n.matches(dd) ⟹
    $n.matches(ee))`)), []);
});
