// The railroad diagrams of the grammar documents' rules, which
// tools/sync.js writes under docs/diagrams/ (tools/railroad.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MAX_WIDTH, anchors, diagramNames, documentDiagrams, headings, ruleNote, ruleSvg } from "../../../tools/railroad.js";
import { proseLineProblems } from "../../../tools/prose-lines.js";
import { inlineLinkTargets } from "../../../tools/links.js";
import { loaderWith, repository } from "./shared.js";

const loader = loaderWith({});
/** @param {string} body */
const block = (body) => `# t\n\n\`\`\`jbogenbau\n${body}\n\`\`\`\n`;
/** @param {string} body */
const rules = (body) => loader.readDocument(block(body), "t.md").rules;
/** The SVG of the first rule of a block. @param {string} body */
const svg = (body) => ruleSvg(rules(body)[0]);
/** The texts of the boxes of a drawing, in the order drawn. @param {string} drawing */
const boxes = (drawing) => [...drawing.matchAll(/<g class="(rule|terminal)">.*?<text[^>]*>([^<]*)<\/text><\/g>/g)].map((match) => `${match[1]}:${unescape(match[2])}`);
/** The notes over or under the track. @param {string} drawing */
const notes = (drawing) => [...drawing.matchAll(/<text class="label"[^>]*>([^<]*)<\/text>/g)].map((match) => unescape(match[1]));
/** @param {string} text */
const unescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("a rule is a box, a terminal is a rounded one, and a capture leaves no trace", () => {
  const drawing = svg("%rule r $a(A) b ~word ~KOhA 'x' /a/ $c('a'..'z') '\\p{L}' #");
  assert.deepEqual(boxes(drawing), ["terminal:A", "rule:b", "terminal:~word", "terminal:KOhA", "terminal:'x'", "terminal:/a/", "terminal:'a'..'z'", "terminal:'\\p{L}'", "rule:#"]);
  assert.doesNotMatch(drawing, /\$a|\$c/);
  assert.match(drawing, /<text class="title"[^>]*>r<\/text>/);
});

test("a tested symbol shows its test as the notation writes it", () => {
  const drawing = svg('%rule r LE="la" | x≠"s" | ~word⊇(UI ∪ CAI) | A⊉B | cmavo∩UI=∅ | B∩(C ∪ D)≠∅');
  assert.deepEqual(boxes(drawing), ['terminal:LE="la"', 'rule:x≠"s"', "terminal:~word⊇(UI ∪ CAI)", "terminal:A⊉B", "rule:cmavo∩UI=∅", "terminal:B∩(C ∪ D)≠∅"]);
});

test("an elidable optional labels its bypass, and a plain one does not", () => {
  assert.deepEqual(notes(svg("%rule r a [b] [+KU #] [++KEI]")), ["elided", "elided, maximal"]);
});

test("braces draw their item once, with the separator on the loop, and a chain says which", () => {
  assert.deepEqual(boxes(svg("%rule r {a \\ B}")), ["rule:a", "terminal:B"]);
  assert.deepEqual(notes(svg("%rule r {a \\ B}")), []);
  assert.deepEqual(notes(svg("%rule r {... a \\ B}")), ["left chain"]);
  assert.deepEqual(notes(svg("%rule r {a ... \\ B}")), ["right chain"]);
  assert.deepEqual(notes(svg("%rule r {... a}")), ["left chain"]);
  assert.deepEqual(boxes(svg("%rule r [{a}]")), ["rule:a"]);
});

test("A & B & C is the choice of where the subsequence begins, with the rest optional", () => {
  assert.deepEqual(boxes(svg("%rule r A & B & C")), ["terminal:A", "terminal:B", "terminal:C", "terminal:B", "terminal:C", "terminal:C"]);
});

test("ε is bare track, and guards lead their alternative", () => {
  assert.deepEqual(boxes(svg("%rule r ε | A")), ["terminal:A"]);
  assert.deepEqual(notes(svg("%rule r ¬f? A | f? g! B | C")), ["¬f?", "f? g!"]);
});

test("the same rule always gives the same file", () => {
  const body = "%rule r [A] {b \\ C} (d | E & F) [+KU #]";
  assert.equal(svg(body), svg(body));
});

test("a long sequence continues on new rows, no wider than the limit", () => {
  const long = Array.from({ length: 40 }, (_, index) => `rule-number-${index}`).join(" ");
  const width = Number(/width="(\d+)"/.exec(svg(`%rule r ${long}`))[1]);
  assert.ok(width <= MAX_WIDTH + 40, `${width}`);
  // Inside an optional, a choice and braces as well.
  for (const body of [`[${long}]`, `(${long} | A)`, `{${long}}`, `A & (${long})`]) {
    const nested = Number(/width="(\d+)"/.exec(svg(`%rule r ${body}`))[1]);
    assert.ok(nested <= MAX_WIDTH + 40, `${body.slice(0, 20)}: ${nested}`);
  }
});

/**
 * The points that a drawing's paths pass through, and its boxes, read from
 * the SVG. The paths use only M, m, H, h, V, v and a.
 * @param {string} drawing
 */
function geometry(drawing) {
  const points = [];
  for (const [, d] of drawing.matchAll(/<path d="([^"]*)"/g)) {
    let x = 0, y = 0;
    for (const [, command, args] of d.matchAll(/([MmHhVva])([^MmHhVva]*)/g)) {
      const numbers = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
      if (command === "M") [x, y] = numbers;
      else if (command === "m") { x += numbers[0]; y += numbers[1]; }
      else if (command === "H") x = numbers[0];
      else if (command === "h") x += numbers[0];
      else if (command === "V") y = numbers[0];
      else if (command === "v") y += numbers[0];
      else { x += numbers[5]; y += numbers[6]; }
      points.push([x, y]);
    }
  }
  const rects = [...drawing.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((match) => match.slice(1).map(Number));
  const [width, height] = /width="(\d+)" height="(\d+)"/.exec(drawing).slice(1).map(Number);
  return { points, rects, width, height };
}

test("every diagram of the bundled grammars stays on its canvas, and no two of its boxes overlap", () => {
  const compiled = JSON.parse(fs.readFileSync(path.join(repository, "grammars", "compiled.json"), "utf8"));
  let count = 0;
  for (const [file, { dom }] of Object.entries(compiled.documents)) {
    for (const rule of dom.rules) {
      const { points, rects, width, height } = geometry(ruleSvg(rule));
      for (const [x, y] of points) assert.ok(x >= 0 && x <= width && y >= 0 && y <= height, `${file} ${rule.name}: (${x}, ${y}) is off its ${width}×${height} canvas`);
      for (const [x, y, w, h] of rects) assert.ok(x >= 0 && x + w <= width && y >= 0 && y + h <= height, `${file} ${rule.name}: a box is off its canvas`);
      // Sorted by their left edges, a box can overlap only one that begins
      // before it ends.
      const sorted = [...rects].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length && sorted[j][0] < sorted[i][0] + sorted[i][2]; j++) {
          const [a, b] = [sorted[i], sorted[j]];
          assert.ok(a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1], `${file} ${rule.name}: two boxes overlap`);
        }
      }
      count++;
    }
  }
  assert.ok(count > 1000);
});

test("headings outside fenced blocks, with GitHub's anchors", () => {
  const markdown = "# Title\n\n## Indicators and `ba'e`\n\n```\n## not a heading\n```\n\n~~~~\n```\n# still not\n~~~~\n\n### Terms ###\n\n## Terms\n";
  const found = headings(markdown);
  assert.deepEqual(found, [{ line: 1, level: 1, text: "Title" }, { line: 3, level: 2, text: "Indicators and `ba'e`" }, { line: 14, level: 3, text: "Terms" }, { line: 16, level: 2, text: "Terms" }]);
  assert.deepEqual(anchors(found.map((heading) => heading.text)), ["title", "indicators-and-bae", "terms", "terms-1"]);
  assert.deepEqual(anchors(["Stage 1: phonemes", "The [CLL](x.md) grammar", "Erasure by `sa` and `su`"]), ["stage-1-phonemes", "the-cll-grammar", "erasure-by-sa-and-su"]);
});

test("each rule has a file of its own", () => {
  assert.deepEqual(diagramNames([{ name: "#" }, { name: "unit" }, { name: "text" }, { name: "unit" }, { name: "unit" }]), ["_hash", "unit", "text", "unit.2", "unit.3"]);
  assert.deepEqual(diagramNames([{ name: "a-b" }, { name: "a-B" }]), ["a-b", "a-B.2"]);
});

test("the page says how a rule is stated and what its diagram leaves out", () => {
  const [plain, flagged, extended] = rules("%rule a B\n%rule(leftmost-longest) c $d(D) <~x>\n%conditions phonemes($d) = \"d\"\n%emits $d\n%opaque\n%extend-rule a E");
  assert.equal(ruleNote(plain), "");
  assert.equal(ruleNote(flagged), "Its flag is `leftmost-longest`. The diagram leaves out its tags, conditions, emission and `%opaque`.");
  assert.equal(ruleNote(extended), "`%extend-rule` adds these alternatives to a rule of an earlier document.");
  const [redefined] = loader.readDocument(block("%redefine-rule a B\n%tags ~y"), "t.md").rules;
  assert.equal(ruleNote(redefined), "`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags.");
});

test("a document's page shows each rule under its section, and its links resolve", () => {
  const markdown = "# A grammar\n\nIntro.\n\n```jbogenbau\n%rule # [{A}]\n```\n\n## First part\n\n```jbogenbau\n%rule text b {c}\n%rule b B\n```\n\n## Second part\n\n```jbogenbau\n%rule c C\n```\n";
  const files = documentDiagrams("syntax/x.md", markdown, loader.readDocument(markdown, "syntax/x.md"));
  assert.deepEqual([...files.keys()], ["docs/diagrams/syntax/x/_hash.svg", "docs/diagrams/syntax/x/text.svg", "docs/diagrams/syntax/x/b.svg", "docs/diagrams/syntax/x/c.svg", "docs/diagrams/syntax/x.md"]);
  const page = files.get("docs/diagrams/syntax/x.md");
  assert.deepEqual(page.split("\n").filter((line) => line.startsWith("#")), ["# A grammar: railroad diagrams", "## Introduction", "### `#`", "## First part", "### `text`", "### `b`", "## Second part", "### `c`"]);
  assert.deepEqual(proseLineProblems(page, "x.md"), []);
  assert.deepEqual(inlineLinkTargets(page), ["../../../grammars/syntax/x.md", "../../design.md#railroad-diagrams", "../../../grammars/syntax/x.md", "../../../grammars/syntax/x.md#first-part", "../../../grammars/syntax/x.md#second-part"]);
  assert.match(page, /!\[The rule text\]\(x\/text\.svg\)/);
  assert.equal(documentDiagrams("syntax/y.md", "# Y\n", loader.readDocument("# Y\n", "syntax/y.md")).size, 0);
});

test("the bundled pages link to files and sections that exist", () => {
  const compiled = JSON.parse(fs.readFileSync(path.join(repository, "grammars", "compiled.json"), "utf8"));
  const design = anchors(headings(fs.readFileSync(path.join(repository, "docs", "design.md"), "utf8")).map((heading) => heading.text));
  for (const [file, { dom }] of Object.entries(compiled.documents)) {
    const markdown = fs.readFileSync(path.join(repository, "grammars", file), "utf8");
    const sections = anchors(headings(markdown).map((heading) => heading.text));
    const files = documentDiagrams(file, markdown, dom);
    const page = [...files.keys()].find((name) => name.endsWith(".md"));
    if (!page) continue;
    const text = files.get(page);
    for (const target of [...inlineLinkTargets(text), ...[...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])]) {
      const [relative, anchor] = target.split("#");
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page), relative));
      if (resolved.startsWith("docs/diagrams/")) assert.ok(files.has(resolved), `${page}: ${target}`);
      else assert.ok(fs.existsSync(path.join(repository, resolved)), `${page}: ${target}`);
      if (anchor && resolved === "docs/design.md") assert.ok(design.includes(anchor), `${page}: ${target}`);
      else if (anchor) assert.ok(sections.includes(anchor), `${page}: ${target}`);
    }
  }
});
