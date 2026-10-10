// The railroad diagrams of the grammar documents' rules, which
// tools/sync.js writes under docs/diagrams/ and shows in the documents
// (tools/railroad.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CONDITIONS_NOTE, RANKED_NOTE, DIAGRAMS, MAX_WIDTH, SUMMARY_LIMIT, diagramElement, diagramNames, diagramSummary, documentLines, elisionOutcomes, testedElisions, fencedBlocks, omissionOf, ownedLines, ruleSvg, withDiagrams } from "../../../tools/railroad.js";
import { Loader } from "../src/node.js";
import { proseLineProblems } from "../../../tools/prose-lines.js";
import { extractGrammarText } from "../src/markdown.js";
import { loaderWith, readGrammarFile, repository } from "./shared.js";

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

test("ranked diagrams number whole options and keep ordinary forks inside their rank", () => {
  const drawing = svg("%rule r ME (a B ≻ (c | D) ≻ ε) Z");
  assert.deepEqual(boxes(drawing), ["terminal:ME", "rule:a", "terminal:B", "rule:c", "terminal:D", "terminal:Z"]);
  assert.deepEqual(notes(drawing), ["≻ same span", "1", "2", "3", RANKED_NOTE]);
  assert.equal((drawing.match(/class="ranked-choice"/g) ?? []).length, 1);
  assert.deepEqual(readings(drawing), ["ME Z", "ME a B Z", "ME c Z", "ME D Z"].sort());
  assert.deepEqual(canvasProblems(drawing), []);
  assert.deepEqual(strandedTrack(drawing), []);
});

test("nested ranks have separate frames and traverse tested elisions", () => {
  const drawing = svg("%rule r ((a ≻ B) C ≻ D)");
  assert.equal((drawing.match(/class="ranked-choice"/g) ?? []).length, 2);
  assert.deepEqual(notes(drawing), ["≻ same span", "1", "≻ same span", "1", "2", "2", RANKED_NOTE]);
  assert.deepEqual(readings(drawing), ["a C", "B C", "D"].sort());
  assert.deepEqual(canvasProblems(drawing), []);
  assert.deepEqual(strandedTrack(drawing), []);
  assert.equal(testedElisions(rules("%rule r (A [+T⊇T] ≻ B [+U⊇U])")[0]).length, 2);
  const long = Array.from({length:40}, (_, index) => `rule-number-${index}`).join(" ");
  for (const body of [`(${long} ≻ B)`, `[(A ≻ (${long} ≻ C))]`, `{Q \\ (A ≻ B)}`]) {
    const nested = svg(`%rule r ${body}`);
    assert.deepEqual(canvasProblems(nested), [], body);
    assert.deepEqual(strandedTrack(nested), [], body);
    assert.ok(Number(/width="(\d+)"/.exec(nested)[1]) <= MAX_WIDTH + 40, body);
  }
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
 * The points that a drawing's paths pass through, its boxes and the extent
 * of its texts, read from the SVG. The paths use only M, m, H, h, V, v and
 * a. A text has its width in textLength, and stands from its x, or around
 * it where the style centres it.
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
  const texts = [...drawing.matchAll(/<text (?:class="(\w+)" )?x="([-\d.]+)" y="([-\d.]+)" textLength="([\d.]+)"[^>]*>([^<]*)</g)].map(([, kind, x, y, length, text]) => {
    const [left, size] = kind === "label" ? [Number(x), 12] : kind === "title" ? [Number(x), 14] : [Number(x) - Number(length) / 2, 14];
    // A glyph reaches about 0.8 em above its baseline and 0.25 em below it.
    return { text: unescape(text), left, right: left + Number(length), top: Number(y) - 0.8 * size, bottom: Number(y) + 0.25 * size };
  });
  const [width, height] = /width="(\d+)" height="(\d+)"/.exec(drawing).slice(1).map(Number);
  return { points, rects, texts, width, height };
}

/**
 * Where a drawing leaves its canvas, or puts one box over another.
 * @param {string} drawing
 * @returns {string[]}
 */
function canvasProblems(drawing) {
  const { points, rects, texts, width, height } = geometry(drawing);
  const problems = [];
  for (const [x, y] of points) if (!(x >= 0 && x <= width && y >= 0 && y <= height)) problems.push(`(${x}, ${y}) is off its ${width}×${height} canvas`);
  for (const [x, y, w, h] of rects) if (!(x >= 0 && x + w <= width && y >= 0 && y + h <= height)) problems.push(`a box at (${x}, ${y}) is off its canvas`);
  for (const text of texts) if (!(text.left >= 0 && text.right <= width && text.top >= 0 && text.bottom <= height)) problems.push(`the text ${text.text} is off its canvas`);
  // Sorted by their left edges, a box can overlap only one that begins
  // before it ends.
  const sorted = [...rects].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j][0] < sorted[i][0] + sorted[i][2]; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      if (!(a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1])) problems.push("two boxes overlap");
    }
  }
  return problems;
}

/** The headings of the track, as unit steps on the screen. */
const EAST = [1, 0], SOUTH = [0, 1], WEST = [-1, 0], NORTH = [0, -1];

/**
 * The heading at each end of a quarter turn, from the signs of its steps
 * and its sweep: a sweep of 1 turns clockwise on the screen.
 * @param {number} dx @param {number} dy @param {number} sweep
 */
function arcHeadings(dx, dy, sweep) {
  if (sweep === 1) return dx > 0 ? (dy > 0 ? [EAST, SOUTH] : [NORTH, EAST]) : (dy > 0 ? [SOUTH, WEST] : [WEST, NORTH]);
  return dx > 0 ? (dy > 0 ? [SOUTH, EAST] : [EAST, NORTH]) : (dy > 0 ? [WEST, SOUTH] : [NORTH, WEST]);
}

/**
 * The track of a drawing, read back from its SVG as a train would follow
 * it. Each piece of a path is an edge from where it starts, with the
 * heading it starts with, to where it ends, with the heading it ends with,
 * in the direction the path is drawn. A box is an edge across it in either
 * direction, and reads its text. A train goes on from an edge only to an
 * edge that starts where it stopped, with the same heading, so it never
 * turns sharply. The marks at the two ends give the start and the end.
 * @param {string} drawing
 */
function trackOf(drawing) {
  /** @type {[number, number][]} */
  const points = [];
  // Rounding to 0.1 in each number of the file moves a point by a little.
  const point = (/** @type {number} */ x, /** @type {number} */ y) => {
    const found = points.findIndex(([px, py]) => Math.abs(px - x) < 0.35 && Math.abs(py - y) < 0.35);
    if (found >= 0) return found;
    points.push([x, y]);
    return points.length - 1;
  };
  /** @type {{from: [number, number], to: [number, number], start: number[], end: number[], text?: string, line: boolean}[]} */
  const pieces = [];
  const paths = [...drawing.matchAll(/<path d="([^"]*)"/g)].map((match) => match[1]);
  const marks = [paths[0], paths[paths.length - 1]];
  for (const d of paths.slice(1, -1)) {
    let x = 0, y = 0;
    for (const [, command, args] of d.matchAll(/([MmHhVva])([^MmHhVva]*)/g)) {
      const v = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
      const from = /** @type {[number, number]} */ ([x, y]);
      if (command === "M") [x, y] = v;
      else if (command === "m") { x += v[0]; y += v[1]; }
      else if (command === "H" || command === "h") x = command === "H" ? v[0] : x + v[0];
      else if (command === "V" || command === "v") y = command === "V" ? v[0] : y + v[0];
      else { x += v[5]; y += v[6]; }
      if (command === "M" || command === "m" || (x === from[0] && y === from[1])) continue;
      if (command === "a") {
        const [start, end] = arcHeadings(v[5], v[6], v[4]);
        pieces.push({ from, to: [x, y], start, end, line: false });
      } else {
        const heading = [Math.sign(x - from[0]), Math.sign(y - from[1])];
        pieces.push({ from, to: [x, y], start: heading, end: heading, line: true });
      }
    }
  }
  for (const [, x, y, w, h, text] of drawing.matchAll(/<g class="(?:rule|terminal)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*\/><text[^>]*>([^<]*)<\/text><\/g>/g)) {
    const [left, top, width, height] = [x, y, w, h].map(Number);
    const label = unescape(text);
    pieces.push({ from: [left, top + height / 2], to: [left + width, top + height / 2], start: EAST, end: EAST, text: label, line: false });
    pieces.push({ from: [left + width, top + height / 2], to: [left, top + height / 2], start: WEST, end: WEST, text: label, line: false });
  }
  const [sx, sy] = /** @type {RegExpExecArray} */ (/M([\d.]+) ([\d.]+)h6$/.exec(marks[0])).slice(1).map(Number);
  const [ex, ey] = /** @type {RegExpExecArray} */ (/^M([\d.]+) ([\d.]+)h6/.exec(marks[1])).slice(1).map(Number);
  pieces.push({ from: [sx, sy], to: [sx + 6, sy], start: EAST, end: EAST, line: true });
  pieces.push({ from: [ex, ey], to: [ex + 6, ey], start: EAST, end: EAST, line: true });
  // A track can leave a straight piece in its middle, as the loop of braces
  // leaves the track after the item: such a piece is two pieces there.
  const ends = pieces.flatMap((piece) => [piece.from, piece.to]);
  const split = [];
  for (const piece of pieces) {
    if (!piece.line) {
      split.push(piece);
      continue;
    }
    const along = (/** @type {[number, number]} */ [x, y]) => (piece.start[0] ? (x - piece.from[0]) * piece.start[0] : (y - piece.from[1]) * piece.start[1]);
    const length = along(piece.to);
    const inside = ends.filter(([x, y]) => (piece.start[0] ? Math.abs(y - piece.from[1]) < 0.35 : Math.abs(x - piece.from[0]) < 0.35) && along([x, y]) > 0.35 && along([x, y]) < length - 0.35);
    const cuts = [piece.from, ...inside.sort((a, b) => along(a) - along(b)), piece.to];
    for (let index = 1; index < cuts.length; index++) split.push({ ...piece, from: cuts[index - 1], to: cuts[index] });
  }
  /** @param {number[]} heading */
  const way = (heading) => `${heading[0]},${heading[1]}`;
  const edges = split.map((piece) => ({ from: `${point(...piece.from)}:${way(piece.start)}`, to: `${point(...piece.to)}:${way(piece.end)}`, text: piece.text }));
  /** @type {Map<string, typeof edges>} */
  const leaving = new Map();
  for (const edge of edges) {
    if (!leaving.has(edge.from)) leaving.set(edge.from, []);
    /** @type {typeof edges} */ (leaving.get(edge.from)).push(edge);
  }
  return { edges, leaving, start: `${point(sx, sy)}:${way(EAST)}`, end: `${point(ex + 6, ey)}:${way(EAST)}` };
}

/**
 * The readings of a drawing: the texts of the boxes along each way from
 * the start to the end that passes at most `most` boxes, sorted.
 * @param {string} drawing
 * @param {number} [most]
 * @returns {string[]}
 */
function readings(drawing, most = 7) {
  const { leaving, start, end } = trackOf(drawing);
  const found = new Set();
  /** @param {string} at @param {string[]} read @param {Set<string>} since the states since the last box */
  const go = (at, read, since) => {
    if (at === end) found.add(read.join(" "));
    for (const edge of leaving.get(at) ?? []) {
      if (edge.text !== undefined) {
        if (read.length < most) go(edge.to, [...read, edge.text], new Set([edge.to]));
      } else if (!since.has(edge.to)) {
        go(edge.to, read, new Set([...since, edge.to]));
      }
    }
  };
  go(start, [], new Set([start]));
  return [...found].sort();
}

/**
 * The places where a drawing's track goes nowhere: an edge that no way
 * from the start reaches, or from which no way leads to the end.
 * @param {string} drawing
 * @returns {string[]}
 */
function strandedTrack(drawing) {
  const { edges, leaving, start, end } = trackOf(drawing);
  const forward = new Set([start]);
  for (const queue = [start]; queue.length;) {
    for (const edge of leaving.get(/** @type {string} */ (queue.pop())) ?? []) if (!forward.has(edge.to)) forward.add(edge.to), queue.push(edge.to);
  }
  const backward = new Set([end]);
  for (let grew = true; grew;) {
    grew = false;
    for (const edge of edges) if (backward.has(edge.to) && !backward.has(edge.from)) backward.add(edge.from), (grew = true);
  }
  // A box can be crossed one way only, so each box needs one way of the two.
  /** @type {Map<string, boolean>} */
  const boxes = new Map();
  const problems = [];
  for (const edge of edges) {
    const used = forward.has(edge.from) && backward.has(edge.to);
    if (edge.text !== undefined) {
      const box = `${edge.text} between points ${[edge.from, edge.to].map((state) => state.split(":")[0]).sort().join(" and ")}`;
      boxes.set(box, (boxes.get(box) ?? false) || used);
    }
    else if (!used) problems.push(`a piece of track from ${edge.from} to ${edge.to}`);
  }
  for (const [box, used] of boxes) if (!used) problems.push(`the box ${box}`);
  return problems;
}

test("the track reads what the rule reads, in the order it reads it", () => {
  assert.deepEqual(readings(svg("%rule r A")), ["A"]);
  assert.deepEqual(readings(svg("%rule r [A] B")), ["A B", "B"]);
  assert.deepEqual(readings(svg("%rule r A | B C | ε")), ["", "A", "B C"]);
  assert.deepEqual(readings(svg("%rule r {A}"), 3), ["A", "A A", "A A A"]);
  assert.deepEqual(readings(svg("%rule r [{A}] B"), 3), ["A A B", "A B", "B"]);
  assert.deepEqual(readings(svg("%rule r A & B & C")), ["A", "A B", "A B C", "A C", "B", "B C", "C"]);
  assert.deepEqual(readings(svg("%rule r ¬f? A | f? g! B")), ["A", "B"]);
  assert.deepEqual(readings(svg("%rule r [+KU] A")), ["A", "KU A"]);
  // A chain reads the same words as a list.
  assert.deepEqual(readings(svg("%rule r {... A \\ B}"), 5), ["A", "A B A", "A B A B A"]);
  assert.deepEqual(readings(svg("%rule r {A ... \\ B}"), 5), ["A", "A B A", "A B A B A"]);
});

test("a separator reads in its own order on the way back of the loop", () => {
  // {A \ B C} reads A B C A, never A C B A.
  assert.deepEqual(readings(svg("%rule r {A \\ B C}")), ["A", "A B C A", "A B C A B C A"]);
  assert.deepEqual(readings(svg("%rule r {A \\ [B] C}"), 5), ["A", "A B C A", "A C A", "A C A C A"]);
  assert.deepEqual(readings(svg("%rule r {A \\ (B C | D [E])}"), 4), ["A", "A B C A", "A D A", "A D E A"]);
  // Braces inside the separator turn back again, so their own separator
  // reads from left to right on the screen, and in order on the track.
  assert.deepEqual(readings(svg("%rule r {A \\ {B \\ C D}}"), 6), ["A", "A B A", "A B A B A", "A B C D B A"]);
  // Every text stays upright: a reversed box keeps its text in its middle.
  for (const [, x, width, middle] of svg("%rule r {A \\ B C}").matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"[^>]*\/><text x="([-\d.]+)"/g)) assert.equal(Number(middle), Number(x) + Number(width) / 2);
});

test("a separator that continues on several rows keeps its rows on the canvas and on the track", () => {
  const parts = Array.from({ length: 20 }, (_, index) => `SEPARATOR${index}`);
  const drawing = svg(`%rule r {A \\ ${parts.join(" ")}}`);
  assert.deepEqual(canvasProblems(drawing), []);
  assert.deepEqual(readings(drawing, 22), ["A", ["A", ...parts, "A"].join(" ")]);
  assert.deepEqual(strandedTrack(drawing), []);
  const long = Array.from({ length: 40 }, (_, index) => `rule-number-${index}`);
  assert.deepEqual(readings(svg(`%rule r ${long.join(" ")}`), 40), [long.join(" ")]);
});

test("a note is never wider than its canvas", () => {
  for (const body of ["%rule r [++T]", "%rule r [+T]", "%rule r {... A}", "%rule r {A ...}", "%rule r ¬long-feature-name? A", "%rule r A\n%conditions phonemes($) = \"b\""]) {
    assert.deepEqual(canvasProblems(svg(body)), [], body);
  }
});

test("the omission of a tested terminator is drawn as the engine allows it", () => {
  // The engine tests the omitted terminator as the tag set of its class
  // alone, and no sound (engine §3.8).
  const sources = (body) => ({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": `# g\n\n\`\`\`jbogenbau\n%ambiguity-resolution greedy\n%const $K KU\n${body}\n\`\`\`\n` });
  /** @param {string} body */
  const drawn = (body) => {
    const files = sources(body);
    const rule = loaderWith(files).readDocument(files["g.md"], "g.md").rules[0];
    const outcomes = elisionOutcomes(new Loader((relative) => files[relative] ?? readGrammarFile(relative)), ["p.md"], new Map([["g.md", { rules: [rule] }]]));
    return ruleSvg(rule, omissionOf(rule, outcomes.get("g.md")?.get(rule.at.join(":"))));
  };
  assert.deepEqual(readings(drawn("%rule text A [+KU⊇~ku]")), ["A KU⊇~ku"]);
  assert.deepEqual(notes(drawn("%rule text A [+KU⊇~ku]")), []);
  assert.deepEqual(readings(drawn("%rule text A [+KU⊇KU]")), ["A", "A KU⊇KU"]);
  assert.deepEqual(readings(drawn("%rule text A [++KU⊇$K]")), ["A", "A KU⊇$K"]);
  assert.deepEqual(notes(drawn("%rule text A [++KU⊇$K]")), ["elided, maximal"]);
  assert.deepEqual(readings(drawn('%rule text A [+KU="ku"]')), ["A", 'A KU="ku"']);
  assert.deepEqual(readings(drawn('%rule text A [+KU≠""]')), ['A KU≠""']);
  // Without the stages that read the rule, the drawing keeps the route and
  // says that the test decides.
  assert.deepEqual(notes(svg("%rule r A [+KU⊇~ku]")), ["elided, where its test allows"]);
});

test("the omission predicate loads a dialect only for a test whose value holds a constant", () => {
  const pipeline = "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n";
  /**
   * What elisionOutcomes answers for the first rule of g.md, and what it
   * asked the loader for.
   * @param {string} body
   */
  const ask = (body) => {
    const files = { "p.md": pipeline, "g.md": `# g\n\n\`\`\`jbogenbau\n%ambiguity-resolution greedy\n%const $K KU\n${body}\n\`\`\`\n` };
    const inner = new Loader((relative) => files[relative] ?? readGrammarFile(relative));
    const calls = { pipeline: 0, dialect: 0 };
    const counting = { unicode: inner.unicode, pipeline: (/** @type {string} */ file) => (calls.pipeline++, inner.pipeline(file)), dialect: (/** @type {string} */ file) => (calls.dialect++, inner.dialect(file)) };
    const rule = loaderWith(files).readDocument(files["g.md"], "g.md").rules[0];
    const answers = elisionOutcomes(counting, ["p.md"], new Map([["g.md", { rules: [rule] }]])).get("g.md")?.get(rule.at.join(":"));
    return { answers: answers?.map((set) => [...set]), calls };
  };
  // No tested terminator: nothing is read.
  assert.deepEqual(ask("%rule text A [+KU]"), { answers: undefined, calls: { pipeline: 0, dialect: 0 } });
  // Tests without constants are answered with no dialect.
  assert.deepEqual(ask('%rule text A [+KU⊇~ku] [+KU⊇KU] [+KU="ku"]'), { answers: [[false], [true], [true]], calls: { pipeline: 1, dialect: 0 } });
  // A constant takes its value from the stage.
  assert.deepEqual(ask("%rule text A [+KU⊇~ku] [+KU⊇$K]"), { answers: [[false], [true]], calls: { pipeline: 1, dialect: 1 } });
  assert.equal(testedElisions(rules("%rule b A [+KU⊇~ku] [+KU] [+KU⊇KU]")[0]).length, 2);
});

test("a rule with conditions says so beside its name, and an extension that adds them too", () => {
  const [plain, conditioned, extended] = rules('%rule a B\n%rule c $d(D)\n%conditions phonemes($d) = "d"\n%extend-rule a E\n%conditions phonemes($) = "e"');
  assert.deepEqual(notes(ruleSvg(plain)), []);
  assert.deepEqual(notes(ruleSvg(conditioned)), [CONDITIONS_NOTE]);
  assert.deepEqual(notes(ruleSvg(extended)), [CONDITIONS_NOTE]);
});

test("every diagram of the bundled grammars stays on its canvas, has no stranded track, and no two of its boxes overlap", () => {
  const compiled = JSON.parse(fs.readFileSync(path.join(repository, "grammars", "compiled.json"), "utf8"));
  let count = 0;
  for (const [file, { dom }] of Object.entries(compiled.documents)) {
    for (const rule of dom.rules) {
      const drawing = ruleSvg(rule);
      assert.deepEqual(canvasProblems(drawing), [], `${file} ${rule.name}`);
      assert.deepEqual(strandedTrack(drawing), [], `${file} ${rule.name}`);
      count++;
    }
  }
  assert.ok(count > 1000);
});

test("each rule has a file of its own", () => {
  assert.deepEqual(diagramNames([{ name: "#" }, { name: "unit" }, { name: "text" }, { name: "unit" }, { name: "unit" }]), ["_hash", "unit", "text", "unit.2", "unit.3"]);
  assert.deepEqual(diagramNames([{ name: "a-b" }, { name: "a-B" }]), ["a-b", "a-B.2"]);
});

/** A document with its diagrams in place. @param {string} file @param {string} markdown */
const placed = (file, markdown) => withDiagrams(file, markdown, loader.readDocument(markdown, file));
/**
 * The generated element of a block of syntax/x.md, as lines.
 * @param {...string} names the rules of the block, as `name` or `name=file`
 */
const element = (...names) => diagramElement(names.map((entry) => {
  const [name, file = name === "#" ? "_hash" : name] = entry.split("=");
  return { name, source: `../../docs/diagrams/syntax/x/${file}.svg` };
}));

test("each block of rules is followed by one element that holds the diagrams of its rules, in their order", () => {
  const markdown = "# A grammar\n\nIntro.\n\n```jbogenbau\n%rule # [{A}]\n```\n\n## First part\n\n```jbogenbau\n%rule text b {c}\n%rule b B\n```\nA paragraph right after the block.\n\n```\n%rule not-grammar X\n```\n\n```jbogenbau\n%rule c C\n%extend-rule c D\n```\n";
  const { text, files } = placed("syntax/x.md", markdown);
  assert.equal(text, [
    "# A grammar", "", "Intro.", "", "```jbogenbau", "%rule # [{A}]", "```", "", ...element("#"), "",
    "## First part", "", "```jbogenbau", "%rule text b {c}", "%rule b B", "```", "", ...element("text", "b"), "", "A paragraph right after the block.", "",
    "```", "%rule not-grammar X", "```", "",
    "```jbogenbau", "%rule c C", "%extend-rule c D", "```", "", ...element("c", "c=c.2"), "",
  ].join("\n"));
  assert.deepEqual([...files.keys()], ["#", "text", "b", "c", "c.2"].map((name) => `${DIAGRAMS}/syntax/x/${name === "#" ? "_hash" : name}.svg`));
  assert.deepEqual(element("text", "b"), [
    "<details><summary>Railroad diagrams of <code>text</code> and <code>b</code></summary>",
    '<p><img src="../../docs/diagrams/syntax/x/text.svg" alt="Railroad diagram of the rule text"></p>',
    '<p><img src="../../docs/diagrams/syntax/x/b.svg" alt="Railroad diagram of the rule b"></p>',
    "</details>",
  ]);
  // The reader reads the same grammar, and the Markdown checks pass.
  assert.equal(extractGrammarText(text, "x.md").text, extractGrammarText(markdown, "x.md").text);
  assert.deepEqual(proseLineProblems(text, "x.md"), []);
});

test("a summary names the rules of its block, or the first and the last where they are too many", () => {
  assert.equal(diagramSummary(["sumti"]), "Railroad diagram of <code>sumti</code>");
  assert.equal(diagramSummary(["c", "c"]), "Railroad diagrams of <code>c</code>");
  assert.equal(diagramSummary(["a", "b", "c"]), "Railroad diagrams of <code>a</code>, <code>b</code> and <code>c</code>");
  const many = Array.from({ length: 12 }, (_, index) => `rule-${index}`);
  assert.equal(diagramSummary(many), "Railroad diagrams of the 12 rules from <code>rule-0</code> to <code>rule-11</code>");
  // A summary that names every rule shows no more than SUMMARY_LIMIT characters.
  for (let count = 1; count < many.length; count++) {
    const summary = diagramSummary(many.slice(0, count));
    if (!summary.includes(" rules from ")) assert.ok(summary.replace(/<\/?code>/g, "").length <= SUMMARY_LIMIT, summary);
  }
});

test("placing the diagrams again changes nothing, and keeps the lines a person wrote", () => {
  const markdown = "# X\n\nIntro.\n\n```jbogenbau\n%rule a B\n%rule b C\n```\n\nText.\n\n```jbogenbau\n%rule c D\n```";
  const once = placed("syntax/x.md", markdown).text;
  assert.equal(placed("syntax/x.md", once).text, once);
  // A hand edit to the prose and the blocks stays, and the diagrams follow the rules.
  const edited = once.replace("Text.", "Other text.").replace("%rule b C", "%rule renamed C\n%rule added E");
  const { text } = placed("syntax/x.md", edited);
  assert.equal(text, ["# X", "", "Intro.", "", "```jbogenbau", "%rule a B", "%rule renamed C", "%rule added E", "```", "", ...element("a", "renamed", "added"), "", "Other text.", "", "```jbogenbau", "%rule c D", "```", "", ...element("c")].join("\n"));
  // A line written right after an element is no part of it, and stays.
  const appended = once.replace("</details>\n\nText.", "</details>\nA line right after.\n\nText.");
  assert.match(placed("syntax/x.md", appended).text, /<\/details>\n\nA line right after\.\n\nText\./);
});

test("a document with CR LF line endings keeps them, and its fences and owned lines are found as with LF", () => {
  const markdown = "# X\n\nIntro.\n\n```jbogenbau\n%rule a B\n```\n\nText.\n";
  const lf = placed("syntax/x.md", markdown).text;
  const crlf = placed("syntax/x.md", markdown.replace(/\n/g, "\r\n")).text;
  assert.equal(crlf, lf.replace(/\n/g, "\r\n"));
  assert.equal(placed("syntax/x.md", crlf).text, crlf);
  // A fenced example that looks like an element stays, with or without rules.
  const fenced = `# X\r\n\r\n\`\`\`text\r\n${element("a").join("\r\n")}\r\n\`\`\`\r\n`;
  assert.equal(withDiagrams("syntax/x.md", fenced, { rules: [] }).text, fenced);
  assert.equal(placed("syntax/x.md", `${fenced}\r\n\`\`\`jbogenbau\r\n%rule a B\r\n\`\`\`\r\n`).text, `${fenced}\r\n\`\`\`jbogenbau\r\n%rule a B\r\n\`\`\`\r\n\r\n${element("a").join("\r\n")}\r\n`);
  assert.deepEqual(ownedLines(documentLines(fenced).lines), new Array(8).fill(false));
  // A line keeps its own ending where a document mixes them.
  const mixed = "# X\r\n\r\n```jbogenbau\n%rule a B\n```\r\nText.\n";
  assert.equal(placed("syntax/x.md", mixed).text, `# X\r\n\r\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\r\n\r\n${element("a").join("\r\n")}\r\n\r\nText.\n`);
});

test("a diagram of a rule that is gone goes, wherever its element stands", () => {
  const stray = element("gone").join("\n");
  const markdown = `# X\n\n${stray}\n\nIntro.\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${element("a").join("\n")}\n${stray}\n\nText.\n\n${stray}\n`;
  assert.equal(placed("syntax/x.md", markdown).text, `# X\n\nIntro.\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${element("a").join("\n")}\n\nText.\n`);
  // An element of the format before, one line for each rule, goes as well.
  const old = '<details><summary>Railroad diagram of <code>a</code></summary><img src="a.svg" alt="Railroad diagram of the rule a"></details>';
  assert.equal(placed("syntax/x.md", `# X\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${old}\n${old}\n`).text, `# X\n\n\`\`\`jbogenbau\n%rule a B\n\`\`\`\n\n${element("a").join("\n")}\n`);
  // A document with no rules keeps none, and a line in a fenced block is not one.
  const fenced = `# X\n\n\`\`\`\n${stray}\n\`\`\`\n`;
  assert.equal(placed("syntax/x.md", `${fenced}\n${stray}\n`).text, fenced);
  assert.deepEqual(fencedBlocks(fenced.split("\n")), [{ start: 2, end: 6, grammar: false }]);
});

test("a block of rules in a list item is an error, since its diagrams would end the list", () => {
  assert.throws(() => placed("syntax/x.md", "# X\n\n- An item\n\n  ```jbogenbau\n  %rule a B\n  ```\n"), /x\.md:5: a jbogenbau block with rules is indented/);
});

test("every bundled document shows each of its rules' diagrams, and each diagram is shown", () => {
  const compiled = JSON.parse(fs.readFileSync(path.join(repository, "grammars", "compiled.json"), "utf8"));
  const shown = new Set();
  for (const [file, { dom }] of Object.entries(compiled.documents)) {
    const markdown = fs.readFileSync(path.join(repository, "grammars", file), "utf8");
    const sources = [...markdown.matchAll(/^<p><img src="([^"]*)" alt="Railroad diagram of the rule ([^"]*)"><\/p>$/gm)];
    assert.deepEqual(sources.map((match) => match[2]), dom.rules.map((/** @type {any} */ rule) => rule.name), file);
    for (const [, source] of sources) {
      const svg = path.posix.normalize(path.posix.join("grammars", path.posix.dirname(file), source));
      assert.ok(fs.existsSync(path.join(repository, svg)), `${file}: ${source}`);
      shown.add(svg);
    }
  }
  /** @param {string} directory @returns {string[]} */
  const svgs = (directory) => fs.readdirSync(path.join(repository, directory), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? svgs(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]));
  assert.deepEqual(svgs(DIAGRAMS).filter((file) => !shown.has(file)), []);
});

test("diagram omission answers follow source positions across stage switches and independent DOM reads", () => {
  const files = { "p.md": block("%stage a\n%ambiguity-resolution greedy\n%rule text A [+T⊇~x]\n" +
    "%stage b\n%ambiguity-resolution greedy\n%rule text B [+U⊇U]\n" +
    "%extend-stage a\n%rule later A [+V⊇V]") };
  const inner = new Loader(relative => files[relative] ?? readGrammarFile(relative));
  // sync.js reads the DOM separately from the loader's pipeline cache.
  const dom = inner.readDocument(files["p.md"], "p.md");
  const answers = elisionOutcomes(inner, ["p.md"], new Map([["p.md", dom]])).get("p.md");
  const drawn = withDiagrams("p.md", files["p.md"], dom, answers).files;
  const drawings = [...drawn.values()];
  assert.deepEqual(notes(drawings[0]), []);
  assert.deepEqual(notes(drawings[1]), ["elided"]);
  assert.deepEqual(notes(drawings[2]), ["elided"]);
  assert.deepEqual([...answers.keys()].sort(), dom.rules.map(rule => rule.at.join(":")).sort());
});
