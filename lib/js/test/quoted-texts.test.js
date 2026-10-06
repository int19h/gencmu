// The quoted Lojban texts of the grammar documents that tools/quoted-texts.js
// finds, how it reads its allow-list, and what it reports on a small
// repository (tests/README.md, "Quoted texts").
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinearWork } from "./linear.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repository as repositoryRoot } from "./shared.js";
import { sourceLoader } from "../../../tools/grammar-sources.js";
import { CHECKED_DIALECTS, checkedDocuments, dialectNames, documentDialects, namedDialects, proseOf, quotedText, quotedTextProblems, quotedTexts, quotingPlaces, readAllowList, rejectionWindows, roleProblem, showsRole, uncheckedReasons, wordLabels, hasNodeWithWords, runStarts } from "../../../tools/quoted-texts.js";

test("a quoted text has two words or more, each with a Lojban letter", () => {
  assert.equal(quotedText("mi  klama\tle zarci"), "mi klama le zarci");
  assert.equal(quotedText("li zy du li ma'o fy. xy."), "li zy du li ma'o fy. xy.");
  assert.equal(quotedText(".i ja nai"), ".i ja nai");
  assert.equal(quotedText("le zarci"), "le zarci");
  // One word, a gap, words with no letter, rule names, tokens and notation.
  assert.equal(quotedText("zarci"), null);
  assert.equal(quotedText("mi klama ..."), null);
  assert.equal(quotedText("mi … klama"), null);
  assert.equal(quotedText(". . ."), null);
  assert.equal(quotedText(", , ,"), null);
  assert.equal(quotedText("mi . klama"), null);
  assert.equal(quotedText("bridi-tail-1 gihek bridi-tail-2"), null);
  assert.equal(quotedText("VAU ke'e brode"), null);
  assert.equal(quotedText("[VAU #] le zarci"), null);
});

test("code blocks hold no quoted text", () => {
  const markdown = [
    "Prose with `mi klama le zarci` and `zarci`.",
    "```jbogenbau",
    "text = `mi klama le zarci`",
    "```",
    "  ~~~",
    "  `do klama le zarci`",
    "  ~~~",
    "More, ``lo nu broda`` and `ko'a broda ko'e`.",
  ].join("\n");
  assert.deepEqual(quotedTexts(markdown).map(({ text, line }) => ({ text, line })), [
    { text: "mi klama le zarci", line: 1 },
    { text: "lo nu broda", line: 8 },
    { text: "ko'a broda ko'e", line: 8 },
  ]);
});

test("a line that begins with a code span of three backticks opens no fence", () => {
  // After backticks, a fence's info string holds no backtick, so this line
  // is prose, and so is the text after it.
  const markdown = "```mi klama le zarci``` is a text.\n\nSo is `do klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ text, line }) => ({ text, line })), [
    { text: "mi klama le zarci", line: 1 },
    { text: "do klama le zarci", line: 3 },
  ]);
});

test("a block names the dialects whose names stand as words in its prose", () => {
  assert.deepEqual(namedDialects("The bpfk dialect rejects it."), ["bpfk"]);
  assert.deepEqual(namedDialects("The cll-ebnf and bpfk dialects, and the experimental dialect"), ["cll-ebnf", "bpfk", "experimental"]);
  assert.deepEqual(namedDialects("In cll-ebnf and bpfk, it parses."), ["cll-ebnf", "bpfk"]);
  assert.deepEqual(namedDialects("the experimental layer"), ["experimental"]);
  assert.deepEqual(namedDialects("a bpfk-like reading, zantufas and xbpfk"), []);
  // A code span and a link target name nothing; the text of a link does.
  const markdown = [
    "Here `li zy du li ma'o fy. xy.` parses. The bpfk dialect rejects it.",
    "",
    "And `mi klama le zarci`, which `the bpfk dialect` quotes, as [this](bpfk.md) does.",
    "",
    "The [cll-ebnf](cll-ebnf.md) dialect reads `do klama le zarci`.",
  ].join("\n");
  // The span `the bpfk dialect` is itself a quoted text.
  assert.deepEqual(quotedTexts(markdown).map(({ dialects }) => dialects), [["bpfk"], [], [], ["cll-ebnf"]]);
});

test("a list item is the scope of a dialect name, whatever its blank lines", () => {
  const markdown = "- The bpfk dialect rejects this one.\n\n  Here `mi klama le zarci` parses.\n- And `do klama le zarci` too.\n";
  assert.deepEqual(quotedTexts(markdown).map(({ dialects }) => dialects), [["bpfk"], []]);
  // A name counts in any case, as a word of its own.
  assert.deepEqual(namedDialects("The Zantufa dialect, and Experimental"), ["zantufa", "experimental"]);
});

test("a name in a nested item scopes only that item, and a parent's name scopes its nested items", () => {
  assert.deepEqual(quotedTexts("- `mi klama le zarci` parses.\n  - The bpfk dialect rejects `do klama le zarci`.\n").map(({ dialects }) => dialects), [[], ["bpfk"]]);
  assert.deepEqual(quotedTexts("- In bpfk:\n  - `mi klama le zarci` parses.\n").map(({ dialects }) => dialects), [["bpfk"]]);
  // A list inside another container of the item, such as a block quote, is
  // nested too, and the enclosing item still scopes what it holds.
  assert.deepEqual(quotedTexts("- `li zy du li ma'o fy. xy.` parses.\n\n  > - The bpfk dialect is discussed here.\n").map(({ dialects }) => dialects), [[]]);
  assert.deepEqual(quotedTexts("- In bpfk:\n\n  > - `mi klama le zarci` parses.\n").map(({ dialects }) => dialects), [["bpfk"]]);
  assert.deepEqual(quotedTexts("- `mi klama le zarci` parses.\n\n  > The bpfk dialect is discussed here.\n").map(({ dialects }) => dialects), [["bpfk"]]);
});

test("the checked documents are those that the CLL pipelines include, at any depth", () => {
  assert.deepEqual(CHECKED_DIALECTS, ["cll-ebnf", "bpfk"]);
  assert.deepEqual(dialectNames(), ["bpfk", "cll-ebnf", "experimental", "zantufa"]);
  const documents = checkedDocuments();
  assert.deepEqual(documents.get("grammars/syntax/cll.md"), ["bpfk", "cll-ebnf"]);
  assert.deepEqual(documents.get("grammars/words/shapes.md"), ["cll-ebnf"]);
  assert.deepEqual(documents.get("grammars/dialects/bpfk.md"), ["bpfk"]);
  assert.equal(documents.has("grammars/syntax/experimental.md"), false);
  assert.deepEqual(documentDialects().get("grammars/syntax/cll.md").sort(), ["bpfk", "cll-ebnf", "experimental"]);
});

test("an allow-list entry names its document, and a reason or the cases that show it in their roles", () => {
  const { entries, problems } = readAllowList([
    "# a comment",
    "",
    "mi .e do # grammars/syntax/cll.md # the shape of a sumti connection",
    "na'e ka'e # grammars/syntax/cll.md = simple-tense-modal adhoc.a reject adhoc.a.bpfk",
    "mi .e do # grammars/syntax/cll.md # twice",
    "mi .e do # the shape, with no document",
    "le zarci",
    "le zarci # grammars/syntax/cll.md = adhoc.b",
  ].join("\n"));
  assert.deepEqual(entries.slice(0, 2), [
    { text: "mi .e do", document: "grammars/syntax/cll.md", line: 3, reason: "the shape of a sumti connection" },
    { text: "na'e ka'e", document: "grammars/syntax/cll.md", line: 4, cases: [{ role: "simple-tense-modal", id: "adhoc.a" }, { role: "reject", id: "adhoc.a.bpfk" }] },
  ]);
  assert.deepEqual(problems.map((problem) => problem.split(":")[1]), ["5", "6", "7", "8", "8"]);
  // A role with no id after it, at the end or before another role.
  assert.deepEqual(readAllowList("pu ki # grammars/syntax/cll.md = simple-tense-modal adhoc.a adhoc.a.bpfk reject\nna'e ka'e # grammars/syntax/cll.md = reject words adhoc.b\n").problems, [
    "tests/quoted-allow.txt:1: the role reject has no case id after it",
    "tests/quoted-allow.txt:2: the role reject has no case id after it",
  ]);
});

/**
 * A repository whose cll-ebnf and bpfk dialects include
 * grammars/syntax/s.md, which includes grammars/syntax/t.md, with the given
 * documents, cases and allow-list. The DOMs say what each document
 * includes, as tools/sync.js reads them.
 */
function repository({ document, nested = "# T\n", cases, allow = "", dialects = {}, core = null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-texts-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
  };
  write("grammars/dialects/cll-ebnf.md", "# A dialect\n");
  write("grammars/dialects/bpfk.md", "# A dialect\n");
  for (const [name, text] of Object.entries(dialects)) write(`grammars/dialects/${name}`, text);
  write("grammars/syntax/s.md", document);
  write("grammars/syntax/t.md", nested);
  write("tests/corpus/adhoc.jsonl", cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  write("tests/quoted-allow.txt", allow);
  if (core) write("tests/core.txt", core.join("\n") + "\n");
  const include = (target) => ({ directives: [{ name: "stage", args: ["syntax"] }, { name: "include", args: [target] }] });
  const doms = new Map([
    ["dialects/cll-ebnf.md", include("../syntax/s.md")],
    ["dialects/bpfk.md", include("../syntax/s.md")],
    ["syntax/s.md", include("t.md")],
    ["syntax/t.md", { directives: [] }],
  ]);
  return { base, doms };
}

const loader = sourceLoader(repositoryRoot);

const both = (id, text, brackets, bpfk = brackets, at = undefined) => [
  { id, text, dialect: "cll-ebnf", expect: "accept", brackets },
  { id: `${id}.bpfk`, text, dialect: "bpfk", ...(bpfk ? { expect: "accept", brackets: bpfk } : { expect: "reject", at }) },
];
const cases = [
  ...both("a.klama", "mi klama le zarci", "(mi [klama {le zarci}])"),
  ...both("a.kahe", "mi na'e ka'e klama", "(mi [{na'e ka'e} klama])"),
  ...both("a.lerfu", "pa xy. cu barda", "([pa xy] cu barda)", null, 3),
];

test("quotedTextProblems reports unpinned texts, needless entries and missing dialects", () => {
  const { base: clean, doms } = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n\nA shape: `mi .e do`.\n",
    nested: "# T\n\nAnd `mi klama le zarci` once more.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.kahe.bpfk\nmi .e do # grammars/syntax/s.md # a shape\n",
    dialects: { "notation.md": "# Notation\n" },
  });
  // The fixture has no grammars of its own, so the cases of `=` entries
  // parse with the repository's source grammars.
  const scope = { loader, doms, unchecked: { "grammars/dialects/notation.md": "a test" } };
  assert.deepEqual(quotedTextProblems(clean, scope), []);
  // A failing case names the lines that quote its text, and those of a
  // fragment that an entry pins with it.
  const places = quotingPlaces(clean, doms);
  assert.deepEqual(places.get("a.klama.bpfk"), ["grammars/syntax/s.md:3", "grammars/syntax/t.md:3"]);
  assert.deepEqual(places.get("a.kahe"), ["grammars/syntax/s.md:3"]);

  const { base: broken } = repository({
    document: "# S\n\nHere `do klama le zarci` parses.\n\nAnd `na'e ka'e` is one unit.\n\nIn zantufa, `mi klama le zarci` parses.\n\nNumbers hold lerfu, as `pa xy.` does.\n\nHere `pa xy. cu barda` parses.\n",
    cases: [...cases, { id: "a.do", text: "do klama le zarci", dialect: "cll-ebnf", expect: "accept" }],
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.klama\nmi .e do # grammars/syntax/s.md # a shape\npa xy. # grammars/syntax/s.md = number a.lerfu reject a.lerfu.bpfk\n",
    dialects: { "zantufa.md": "# Zantufa\n" },
  });
  assert.deepEqual(quotedTextProblems(broken, { loader, doms, unchecked: { "grammars/dialects/zantufa.md": "a test" } }).map((problem) => problem.replace(/;.*/, "")), [
    "grammars/syntax/s.md:3: `do klama le zarci` is pinned by no case of bpfk",
    "tests/quoted-allow.txt:1: neither the text nor the words of a.klama hold `na'e ka'e`",
    "grammars/syntax/s.md:5: `na'e ka'e` is held by no listed case of bpfk (tests/quoted-allow.txt:1)",
    "grammars/syntax/s.md:7: `mi klama le zarci` is pinned by no case of zantufa",
    // The fixture claims a split acceptance that both CLL dialects reject.
    "tests/quoted-allow.txt:3: a.lerfu does not show `pa xy.` as one number: its dialect rejects it",
    "tests/quoted-allow.txt:3: a.lerfu.bpfk does not show `pa xy.` as a rejected text: its rejection stops at 10, outside the text and the word after it",
    "grammars/syntax/s.md:9: `pa xy.` is held by no listed case of bpfk or of cll-ebnf (tests/quoted-allow.txt:3)",
    // The dialects read the text apart, and the line names neither.
    "grammars/syntax/s.md:11: `pa xy. cu barda` reads differently in cll-ebnf and bpfk, and its line names no dialect",
    "tests/quoted-allow.txt:2: `mi .e do` is not needed: grammars/syntax/s.md does not quote it unpinned",
  ]);

  // Every case that pins a quoted text is in the core sample.
  const { base: outside } = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.kahe.bpfk\n",
    core: ["a.klama", "a.kahe"],
  });
  assert.deepEqual(quotedTextProblems(outside, { loader, doms, unchecked: {} }), [
    "grammars/syntax/s.md:3: a.klama.bpfk pins a quoted text and is not in tests/core.txt",
    "tests/quoted-allow.txt:1: a.kahe.bpfk pins a quoted text and is not in tests/core.txt",
  ]);

  // A grammar document that no checked dialect includes, with no reason in
  // UNCHECKED, and a reason for a document that is not there.
  const { base: unlisted } = repository({ document: "# S\n", cases, dialects: { "new.md": "# New\n" } });
  assert.deepEqual(quotedTextProblems(unlisted, { loader, doms, unchecked: { "grammars/gone.md": "a test" } }).map((problem) => problem.split(":")[0]), ["grammars/dialects/new.md", "grammars/gone.md"]);
});

test("a words role compares the labels of tokens, which stand together in the case's text", () => {
  assert.deepEqual(wordLabels(".i la djim.bu, mi"), ["i", "la", "djim bu", "mi"]);
  const shows = (dialect, text, fragment) => showsRole({ text, dialect }, "words", fragment, new Map(), loader);
  // A direct name letteral and an erased region inside that letteral.
  assert.equal(shows("cll-ebnf", "la .djim. bu", "la djim.bu"), true);
  assert.equal(shows("cll-ebnf", "la .djim. mi si bu", "la djim.bu"), true);
  // SA leaves its erased region outside the replacement unit.
  assert.equal(shows("cll-ebnf", "ladjan. sa .djim. bu", "la djim.bu"), false);
  // Inside `lo'u ... le'u`, `bu` does nothing: three words, not two.
  assert.equal(shows("cll-ebnf", "lo'u la .djim. bu le'u", "la djim.bu"), false);
  // A stage before the word stage, and an attachment between the tokens.
  assert.equal(shows("bpfk", "kyyykerlo", "ky yy kerlo"), true);
  assert.equal(shows("bpfk", "mi ui klama", "mi klama"), true);
  // Erased words between the tokens are not theirs.
  assert.match(roleProblem({ text: "mi do si klama", dialect: "cll-ebnf" }, "words", "mi klama", new Map(), loader), /other words of its text between them/);
});

test("a reject role stops at the quoted text or the word after it", () => {
  // Positions in code points: `ла` is two of them.
  assert.deepEqual(rejectionWindows("ла mi klama .i bo naku zo'u", ".i bo"), [[12, 22]]);
  assert.deepEqual(rejectionWindows("mi klama .i bo", ".i bo"), [[9, 14]]);
  assert.deepEqual(rejectionWindows("mi .i boi", ".i bo"), []);
  const c = { text: "mi klama .i bo naku zo'u do klama", dialect: "cll-ebnf", at: 25 };
  const shows = (fragment, at = c.at) => showsRole({ ...c, at }, "reject", fragment, new Map(), loader);
  // The rejection stops at `do`, after the prenex.
  assert.equal(shows("naku zo'u"), true);
  assert.equal(shows(".i bo"), false);
  // The stored `at` and the parsed error both count.
  assert.match(roleProblem({ ...c, at: 20 }, "reject", "naku", new Map(), loader), /rejection stops at 25/);
  assert.match(roleProblem({ ...c, at: 9 }, "reject", "naku zo'u", new Map(), loader), /`at` is 9/);
});

test("an entry names its lines where its document quotes the text on several", () => {
  const { entries, problems } = readAllowList([
    "na'e bo # grammars/syntax/cll.md:225,386 # the shape of a NAhE sumti",
    "na'e bo # grammars/syntax/cll.md:386 # twice for a line",
    "na'e bo # grammars/syntax/cll.md # once with no lines",
  ].join("\n"));
  assert.deepEqual(entries[0].lines, [225, 386]);
  assert.equal(entries[2].lines, undefined);
  assert.deepEqual(problems, ["tests/quoted-allow.txt:2: `na'e bo` is listed twice for grammars/syntax/cll.md:386"]);

  const document = "# S\n\nHere `na'e ka'e` is one unit.\n\nAnd `na'e ka'e` again.\n\nA shape: `mi .e do`.\n\nThe shape `mi .e do` once more.\n";
  const { base, doms } = repository({
    document,
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md:3 = simple-tense-modal a.kahe a.kahe.bpfk\nna'e ka'e # grammars/syntax/s.md:5 # a test\nmi .e do # grammars/syntax/s.md # a shape\n",
  });
  assert.deepEqual(quotedTextProblems(base, { loader, doms, unchecked: {} }), [
    "tests/quoted-allow.txt:3: `mi .e do` is quoted unpinned on lines 7, 9 of grammars/syntax/s.md; name the lines that the entry covers, as grammars/syntax/s.md:7,9",
  ]);
  // A failing case names only the lines of its entry.
  assert.deepEqual(quotingPlaces(base, doms).get("a.kahe"), ["grammars/syntax/s.md:3"]);
  const { base: needless } = repository({
    document,
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md:3,5,7 = simple-tense-modal a.kahe a.kahe.bpfk\nmi .e do # grammars/syntax/s.md:7,9 # a shape\n",
  });
  assert.deepEqual(quotedTextProblems(needless, { loader, doms, unchecked: {} }), [
    "tests/quoted-allow.txt:1: `na'e ka'e` is not needed on grammars/syntax/s.md:7, which does not quote it unpinned",
  ]);
});

test("each needed dialect has one reading, from its pins and from the cases of an entry", () => {
  // A third dialect's name does not speak for the two that disagree.
  const { base, doms } = repository({
    document: "# S\n\nIn experimental, `pa xy. cu barda` parses.\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n",
    cases: [
      ...cases,
      { id: "a.lerfu.experimental", text: "pa xy. cu barda", dialect: "experimental", expect: "accept", brackets: "([pa xy] cu barda)" },
      // A whole text of the fragment's words in one dialect does not retire
      // the entry there.
      { id: "a.kahe-alone", text: "na'e ka'e", dialect: "cll-ebnf", expect: "reject", at: 0 },
    ],
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe.bpfk\n",
    dialects: { "experimental.md": "# Experimental\n" },
  });
  assert.deepEqual(quotedTextProblems(base, { loader, doms, unchecked: { "grammars/dialects/experimental.md": "a test" } }), [
    "grammars/syntax/s.md:3: `pa xy. cu barda` reads differently in cll-ebnf and bpfk, and its line names only experimental; say which dialect the sentence is about",
    "grammars/syntax/s.md:5: `na'e ka'e` is held by no listed case of cll-ebnf (tests/quoted-allow.txt:1)",
  ]);
});

test("a document that only unchecked dialects include has a derived reason", () => {
  const { base, doms } = repository({ document: "# S\n", cases, dialects: { "zantufa.md": "# Zantufa\n" } });
  fs.writeFileSync(path.join(base, "grammars", "syntax", "z.md"), "# Z\n");
  const more = new Map([...doms, ["dialects/zantufa.md", { directives: [{ name: "include", args: ["../syntax/z.md"] }, { name: "include", args: ["../syntax/t.md"] }] }], ["syntax/z.md", { directives: [] }]]);
  const unchecked = { "grammars/dialects/zantufa.md": "a test" };
  assert.deepEqual(Object.fromEntries(uncheckedReasons(base, more, undefined, unchecked)), {
    "grammars/dialects/zantufa.md": "a test",
    "grammars/syntax/z.md": "included only by the zantufa dialect",
  });
  assert.deepEqual(quotedTextProblems(base, { loader, doms: more, unchecked }), []);
  // A hand-written reason for such a document is not needed.
  assert.deepEqual(quotedTextProblems(base, { loader, doms: more, unchecked: { ...unchecked, "grammars/syntax/z.md": "only Zantufa" } }), [
    "grammars/syntax/z.md: included only by the zantufa dialect, which is its reason, so UNCHECKED in tools/quoted-texts.js does not need it",
  ]);
});

test("an include resolves as the pipeline resolves it", () => {
  // A `..` above the grammars drops out, as lib/js/src/markdown.js resolvePath does.
  const { base, doms } = repository({ document: "# S\n", cases });
  const include = (target) => ({ directives: [{ name: "include", args: [target] }] });
  const climbing = new Map([...doms, ["dialects/cll-ebnf.md", include("../../syntax/s.md")]]);
  assert.deepEqual(documentDialects(base, climbing).get("grammars/syntax/s.md"), ["bpfk", "cll-ebnf"]);
});

test("a chain of 20,000 includes gives its last document the dialect on an ordinary stack", () => {
  // The walk keeps the chain in a stack of its own, so the call stack does
  // not bound its length.
  const { base, doms } = repository({ document: "# S\n", cases });
  const depth = 20000;
  const include = (target) => ({ directives: [{ name: "include", args: [target] }] });
  const chained = new Map([...doms, ["dialects/cll-ebnf.md", include("../chain/c0.md")]]);
  for (let index = 0; index < depth; index++) chained.set(`chain/c${index}.md`, include(`c${index + 1}.md`));
  chained.set(`chain/c${depth}.md`, { directives: [] });
  assert.deepEqual(documentDialects(base, chained).get(`grammars/chain/c${depth}.md`), ["cll-ebnf"]);
});

test("the prose of a block nested 20,000 deep is read on an ordinary stack", () => {
  const depth = 20000;
  /** @type {any} */
  let node = { type: "text", value: "deep" };
  for (let index = 0; index < depth; index++) node = { type: "emphasis", children: [{ type: "text", value: "a" }, node, { type: "inlineCode", value: "x" }] };
  assert.equal(proseOf(node), "a".repeat(depth) + "deep" + " ".repeat(depth));
});

test("the check reads the repository's source grammars, not the bundled copies", () => {
  // A copy of the repository's grammars in which the sources differ from
  // the bundled grammars and grammars/compiled.json: a rule has another
  // name, and the bpfk pipeline includes one more document.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-sources-"));
  fs.cpSync(path.join(repositoryRoot, "grammars"), path.join(base, "grammars"), { recursive: true });
  const syntax = path.join(base, "grammars", "syntax", "cll.md");
  fs.writeFileSync(syntax, fs.readFileSync(syntax, "utf8").replace(/\bsimple-tense-modal\b(?!-)/g, "simple-tense-modal-renamed"));
  const bpfk = path.join(base, "grammars", "dialects", "bpfk.md");
  fs.writeFileSync(bpfk, fs.readFileSync(bpfk, "utf8").replace('%include "../syntax/cll.md"', '%include "../syntax/cll.md"\n  %include "../words/lohai.md"'));
  const c = { text: "mi pu ki klama", dialect: "cll-ebnf" };
  const changed = sourceLoader(base);
  assert.equal(showsRole(c, "simple-tense-modal", "pu ki", new Map(), changed), false);
  assert.equal(showsRole(c, "simple-tense-modal-renamed", "pu ki", new Map(), changed), true);
  assert.equal(showsRole(c, "simple-tense-modal", "pu ki", new Map(), loader), true);
  // The include graph comes from the sources too.
  assert.ok(documentDialects(base).get("grammars/words/lohai.md").includes("bpfk"));
  assert.ok(!documentDialects().get("grammars/words/lohai.md").includes("bpfk"));
});

test("a node of a rule is found by its words, also in a tree where the rule nests as deep as the text is long", () => {
  /** @param {number} n */
  const chain = (n) => {
    const input = Array.from({ length: n }, (_, index) => ({ label: index % 5 === 4 ? " " : `w${index}` }));
    /** @type {any} */
    let tree = { kind: "token", token: 0 };
    for (let index = 1; index < n; index++) tree = { kind: "rule", rule: "chain", children: [tree, { kind: "token", token: index }] };
    return { tree, input, words: input.map((token) => token.label).filter((label) => label.trim()) };
  };
  const small = chain(12);
  assert.ok(hasNodeWithWords(small.tree, small.input, "chain", small.words.join(" ")));
  assert.ok(hasNodeWithWords(small.tree, small.input, "chain", small.words.slice(0, 3).join(" ")));
  assert.ok(!hasNodeWithWords(small.tree, small.input, "chain", small.words.slice(1, 4).join(" ")));
  assert.ok(!hasNodeWithWords(small.tree, small.input, "other", small.words.join(" ")));
  assertLinearWork("hasNodeWithWords", 20000, (n) => {
    const { tree, input } = chain(n);
    return () => assert.ok(!hasNodeWithWords(tree, input, "chain", "no such words"));
  }, ["walkSteps"]);
});

test("runs of words are found where the naive search finds them, and in linear work", () => {
  let seed = 3;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 5000; round++) {
    const haystack = Array.from({ length: Math.floor(random() * 12) }, () => (random() < 0.5 ? "a" : "b"));
    const needle = Array.from({ length: 1 + Math.floor(random() * 4) }, () => (random() < 0.5 ? "a" : "b"));
    const naive = [];
    for (let first = 0; first + needle.length <= haystack.length; first++) if (needle.every((word, index) => haystack[first + index] === word)) naive.push(first);
    assert.deepEqual(runStarts(haystack, needle), naive, `${haystack} in ${needle}`);
  }
  assertLinearWork("rejectionWindows and wordLabels", 4000, (n) => {
    const caseText = Array(n).fill("a").join(" ");
    const text = Array(n / 2).fill("a").join(" ");
    const word = `a${".".repeat(n)}b`;
    // A long word, and long runs of stops at either end of a word.
    const long = "x".repeat(n);
    const trimmed = `${",".repeat(n)}a${".".repeat(n)}`;
    return () => {
      assert.equal(rejectionWindows(caseText, text).length, n / 2 + 1);
      assert.deepEqual(rejectionWindows(`${long} a`, "a"), [[n + 1, n + 2]]);
      assert.deepEqual(wordLabels(word), [`a${" ".repeat(n)}b`]);
      assert.deepEqual(wordLabels(trimmed), ["a"]);
    };
  }, ["text"]);
});
