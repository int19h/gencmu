// The railroad diagrams of the grammar documents' rules, which
// tools/sync.js writes under docs/diagrams/ and shows in the documents
// (tools/railroad.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DIAGRAMS, MAX_WIDTH, diagramLine, diagramNames, fencedBlocks, ruleSvg, withDiagrams } from "../../../tools/railroad.js";
import { proseLineProblems } from "../../../tools/prose-lines.js";
import { extractGrammarText } from "../src/markdown.js";
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

test("each rule has a file of its own", () => {
  assert.deepEqual(diagramNames([{ name: "#" }, { name: "unit" }, { name: "text" }, { name: "unit" }, { name: "unit" }]), ["_hash", "unit", "text", "unit.2", "unit.3"]);
  assert.deepEqual(diagramNames([{ name: "a-b" }, { name: "a-B" }]), ["a-b", "a-B.2"]);
});

/** The generated lines of a document. @param {string} file @param {string} markdown */
const placed = (file, markdown) => withDiagrams(file, markdown, loader.readDocument(markdown, file));
/** The line of a rule's diagram in syntax/x.md. @param {string} name @param {string} [file] */
const line = (name, file = name === "#" ? "_hash" : name) => diagramLine(name, `../../docs/diagrams/syntax/x/${file}.svg`);

test("each block of rules is followed by the diagrams of its rules, in their order", () => {
  const markdown = "# A grammar\n\nIntro.\n\n```jbogenbau\n%rule # [{A}]\n```\n\n## First part\n\n```jbogenbau\n%rule text b {c}\n%rule b B\n```\nA paragraph right after the block.\n\n```\n%rule not-grammar X\n```\n\n```jbogenbau\n%rule c C\n%extend-rule c D\n```\n";
  const { text, files } = placed("syntax/x.md", markdown);
  assert.equal(text, [
    "# A grammar", "", "Intro.", "", "```jbogenbau", "%rule # [{A}]", "```", "", line("#"), "",
    "## First part", "", "```jbogenbau", "%rule text b {c}", "%rule b B", "```", "", line("text"), line("b"), "", "A paragraph right after the block.", "",
    "```", "%rule not-grammar X", "```", "",
    "```jbogenbau", "%rule c C", "%extend-rule c D", "```", "", line("c"), line("c", "c.2"), "",
  ].join("\n"));
  assert.deepEqual([...files.keys()], ["#", "text", "b", "c", "c.2"].map((name) => `${DIAGRAMS}/syntax/x/${name === "#" ? "_hash" : name}.svg`));
  assert.match(line("text"), /^<details><summary>Railroad diagram of <code>text<\/code><\/summary><img src="\.\.\/\.\.\/docs\/diagrams\/syntax\/x\/text\.svg" alt="Railroad diagram of the rule text"><\/details>$/);
  // The reader reads the same grammar, and the Markdown checks pass.
  assert.equal(extractGrammarText(text, "x.md").text, extractGrammarText(markdown, "x.md").text);
  assert.deepEqual(proseLineProblems(text, "x.md"), []);
});

test("placing the diagrams again changes nothing, and keeps the lines a person wrote", () => {
  const markdown = "# X\n\nIntro.\n\n```jbogenbau\n%rule a B\n%rule b C\n```\n\nText.\n\n```jbogenbau\n%rule c D\n```";
  const once = placed("syntax/x.md", markdown).text;
  assert.equal(placed("syntax/x.md", once).text, once);
  // A hand edit to the prose and the blocks stays, and the diagrams follow the rules.
  const edited = once.replace("Text.", "Other text.").replace("%rule b C", "%rule renamed C\n%rule added E");
  const { text, lines } = placed("syntax/x.md", edited);
  assert.equal(text, ["# X", "", "Intro.", "", "```jbogenbau", "%rule a B", "%rule renamed C", "%rule added E", "```", "", line("a"), line("renamed"), line("added"), "", "Other text.", "", "```jbogenbau", "%rule c D", "```", "", line("c")].join("\n"));
  // Each line of the edited document but a generated one is still there, and the map finds it.
  const after = text.split("\n");
  edited.split("\n").forEach((line, index) => {
    const moved = lines[index + 1];
    // A generated line goes, and so does the blank line before it.
    if (moved === null) assert.ok(line.startsWith("<details>") || (line === "" && edited.split("\n")[index + 1].startsWith("<details>")));
    else assert.equal(after[moved - 1], line);
  });
});

test("a diagram of a rule that is gone goes, wherever its line stands", () => {
  const stray = diagramLine("gone", "../../docs/diagrams/syntax/x/gone.svg");
  const markdown = `# X\n\n${stray}\n\nIntro.\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${line("a")}\n${stray}\n\nText.\n\n${stray}\n`;
  assert.equal(placed("syntax/x.md", markdown).text, `# X\n\nIntro.\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${line("a")}\n\nText.\n`);
  // A document with no rules keeps none, and a line in a fenced block is not one.
  const fenced = `# X\n\n\`\`\`\n${stray}\n\`\`\`\n`;
  assert.equal(placed("syntax/x.md", `${fenced}\n${stray}\n`).text, fenced);
  assert.deepEqual(fencedBlocks(fenced.split("\n")), [{ start: 2, end: 4, grammar: false }]);
});

test("a block of rules in a list item is an error, since its diagrams would end the list", () => {
  assert.throws(() => placed("syntax/x.md", "# X\n\n- An item\n\n  ```jbogenbau\n  %rule a B\n  ```\n"), /x\.md:5: a jbogenbau block with rules is indented/);
});

test("every bundled document shows each of its rules' diagrams, and each diagram is shown", () => {
  const compiled = JSON.parse(fs.readFileSync(path.join(repository, "grammars", "compiled.json"), "utf8"));
  const shown = new Set();
  for (const [file, { dom }] of Object.entries(compiled.documents)) {
    const markdown = fs.readFileSync(path.join(repository, "grammars", file), "utf8");
    const sources = [...markdown.matchAll(/^<details><summary>Railroad diagram of <code>([^<]*)<\/code><\/summary><img src="([^"]*)"/gm)];
    assert.deepEqual(sources.map((match) => match[1]), dom.rules.map((/** @type {any} */ rule) => rule.name), file);
    for (const [, , source] of sources) {
      const svg = path.posix.normalize(path.posix.join("grammars", path.posix.dirname(file), source));
      assert.ok(fs.existsSync(path.join(repository, svg)), `${file}: ${source}`);
      shown.add(svg);
    }
  }
  /** @param {string} directory @returns {string[]} */
  const svgs = (directory) => fs.readdirSync(path.join(repository, directory), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? svgs(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]));
  assert.deepEqual(svgs(DIAGRAMS).filter((file) => !shown.has(file)), []);
});
