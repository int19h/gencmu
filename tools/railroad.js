// Railroad diagrams of the grammar documents' rules (docs/design.md,
// "Railroad diagrams"). tools/sync.js writes one SVG file for each rule of
// each grammar document under docs/diagrams/, and shows each one in the
// document, under the block that states the rule (withDiagrams). The
// drawing comes from the document's DOM, as the libraries' reader gives it,
// so a diagram shows what gencmu reads.
//
// The layout follows the usual railroad conventions. A track enters every
// piece at its left and leaves at its right. A choice hangs its other
// branches below its first. An optional passes over its content on a
// bypass. A repetition loops back under its item, through the separator if
// it has one. A sequence too wide for MAX_WIDTH continues on the next row.
// The SVG is plain text with fixed sizes and no fonts to measure, so the
// same DOM always gives the same file.
import { formatTerm } from "../lib/js/src/diagnostics.js";

/** The width, in pixels, beyond which a sequence continues on a new row. */
export const MAX_WIDTH = 800;

const FONT_SIZE = 14;
// A monospace character is 0.6 em wide in the common monospace fonts, so a
// box's width needs no font at hand.
const CHAR_WIDTH = 8.4;
const LABEL_SIZE = 12;
const LABEL_CHAR_WIDTH = 7.2;
const BOX_HALF = 12;
const BOX_PADDING = 8;
const RADIUS = 10;
const GAP = 10;
const LABEL_HEIGHT = 16;
const MARGIN = 10;
const TITLE_HEIGHT = 24;

/**
 * A laid-out piece of a diagram. The track enters at (0, 0) and leaves at
 * (width, height). `up` is how far the piece reaches above its entry, and
 * `down` how far it reaches below its exit. `draw` writes the piece's SVG
 * elements with its entry at (x, y).
 * @typedef {{width: number, up: number, down: number, height: number, draw: (x: number, y: number, out: string[]) => void}} Piece
 */

/** @param {string} text */
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** @param {string} text */
const length = (text) => [...text].length;
/** @param {number} n */
const n = (n) => String(Math.round(n * 10) / 10);
// A text drawn at the width its characters are given, whatever the font
// that shows it: a symbol that the monospace font lacks, such as ⊉, comes
// from another font, and could otherwise run out of its box.
/** @param {string} text @param {number} width */
const fit = (text, width) => ` textLength="${n(length(text) * width)}" lengthAdjust="spacingAndGlyphs"`;
/** @param {string} d */
const path = (d) => `<path d="${d}"/>`;
// A quarter turn of the track, from heading along one axis to heading
// along the other: a right turn sweeps clockwise on the screen.
/** @param {number} dx @param {number} dy @param {boolean} right */
const turn = (dx, dy, right) => `a${RADIUS} ${RADIUS} 0 0 ${right ? 1 : 0} ${n(dx)} ${n(dy)}`;

/**
 * A box with its text: rounded for a terminal, square for a rule.
 * @param {string} text
 * @param {boolean} terminal
 * @returns {Piece}
 */
export function box(text, terminal) {
  const width = Math.ceil(length(text) * CHAR_WIDTH) + 2 * BOX_PADDING;
  return {
    width, up: BOX_HALF, down: BOX_HALF, height: 0,
    draw(x, y, out) {
      out.push(`<g class="${terminal ? "terminal" : "rule"}"><rect x="${n(x)}" y="${n(y - BOX_HALF)}" width="${width}" height="${2 * BOX_HALF}" rx="${terminal ? BOX_HALF : 0}"/><text x="${n(x + width / 2)}" y="${n(y + 5)}"${fit(text, CHAR_WIDTH)}>${escape(text)}</text></g>`);
    },
  };
}

/**
 * A plain stretch of track, which reads nothing.
 * @param {number} [width]
 * @returns {Piece}
 */
export function skip(width = 0) {
  return { width, up: 0, down: 0, height: 0, draw: (x, y, out) => { if (width) out.push(path(`M${n(x)} ${n(y)}h${n(width)}`)); } };
}

/**
 * A note over the track, such as the guards of an alternative.
 * @param {string} text
 * @returns {Piece}
 */
export function label(text) {
  const width = Math.ceil(length(text) * LABEL_CHAR_WIDTH) + 8;
  return {
    width, up: LABEL_HEIGHT, down: 0, height: 0,
    draw(x, y, out) {
      out.push(path(`M${n(x)} ${n(y)}h${n(width)}`));
      out.push(`<text class="label" x="${n(x + 4)}" y="${n(y - 5)}"${fit(text, LABEL_CHAR_WIDTH)}>${escape(text)}</text>`);
    },
  };
}

/**
 * Pieces one after another, on one row.
 * @param {Piece[]} items
 * @returns {Piece}
 */
export function sequence(items) {
  if (items.length === 0) return skip();
  if (items.length === 1) return items[0];
  let x = 0, entry = 0, top = 0, bottom = 0;
  /** @type {{x: number, entry: number, item: Piece}[]} */
  const placed = [];
  for (const item of items) {
    if (placed.length) x += GAP;
    placed.push({ x, entry, item });
    top = Math.min(top, entry - item.up);
    entry += item.height;
    bottom = Math.max(bottom, entry + item.down);
    x += item.width;
  }
  return {
    width: x, up: -top, down: bottom - entry, height: entry,
    draw(x0, y0, out) {
      placed.forEach(({ x, entry, item }, index) => {
        if (index) out.push(path(`M${n(x0 + x - GAP)} ${n(y0 + entry)}h${GAP}`));
        item.draw(x0 + x, y0 + entry, out);
      });
    },
  };
}

/**
 * A sequence that continues on new rows where it is wider than `limit`.
 * Each row but the first begins at the left again, and the track runs back
 * under the row before it. The rows, with the track that joins them, are
 * no wider than `limit`, unless one item is.
 * @param {Piece[]} items
 * @param {number} [limit]
 * @returns {Piece}
 */
export function wrapped(items, limit = MAX_WIDTH) {
  const one = sequence(items);
  if (one.width <= limit) return one;
  const inner = limit - 4 * RADIUS;
  /** @type {Piece[][]} */
  const rows = [[]];
  let width = 0;
  for (const item of items) {
    const row = rows[rows.length - 1];
    if (row.length && width + GAP + item.width > inner) {
      rows.push([item]);
      width = item.width;
    } else {
      width += (row.length ? GAP : 0) + item.width;
      row.push(item);
    }
  }
  return rows.length === 1 ? one : stack(rows.map(sequence));
}

/**
 * Rows of track, each continuing the one before it.
 * @param {Piece[]} rows
 * @returns {Piece}
 */
export function stack(rows) {
  const inner = rows.reduce((widest, row) => Math.max(widest, row.width), 0);
  const width = inner + 4 * RADIUS;
  /** @type {number[]} */
  const entries = [0];
  for (let index = 1; index < rows.length; index++) {
    const before = rows[index - 1];
    const back = entries[index - 1] + before.height + before.down + GAP;
    entries.push(back + Math.max(2 * RADIUS, GAP + rows[index].up));
  }
  const last = rows.length - 1;
  return {
    width, up: rows[0].up, down: rows[last].down, height: entries[last] + rows[last].height,
    draw(x, y, out) {
      out.push(path(`M${n(x)} ${n(y)}h${2 * RADIUS}`));
      rows.forEach((row, index) => {
        const entry = y + entries[index];
        row.draw(x + 2 * RADIUS, entry, out);
        const exit = entry + row.height;
        const end = x + 2 * RADIUS + row.width;
        if (index === last) {
          out.push(path(`M${n(end)} ${n(exit)}H${n(x + width)}`));
          return;
        }
        const back = exit + row.down + GAP;
        const next = y + entries[index + 1];
        out.push(path(`M${n(end)} ${n(exit)}H${n(x + 2 * RADIUS + inner)}${turn(RADIUS, RADIUS, true)}V${n(back - RADIUS)}${turn(-RADIUS, RADIUS, true)}H${n(x + 2 * RADIUS)}${turn(-RADIUS, RADIUS, false)}V${n(next - RADIUS)}${turn(RADIUS, RADIUS, false)}`));
      });
    },
  };
}

/**
 * Branches of a choice: the first on the track, the others below it.
 * @param {Piece[]} branches
 * @returns {Piece}
 */
export function choice(branches) {
  if (branches.length === 1) return branches[0];
  const inner = branches.reduce((widest, branch) => Math.max(widest, branch.width), 0);
  const width = inner + 4 * RADIUS;
  const first = branches[0];
  /** @type {number[]} */
  const entries = [0];
  let bottom = first.height + first.down;
  for (const branch of branches.slice(1)) {
    const entry = Math.max(bottom + GAP + branch.up, 2 * RADIUS, first.height + 2 * RADIUS - branch.height);
    entries.push(entry);
    bottom = entry + branch.height + branch.down;
  }
  return {
    width, up: first.up, down: bottom - first.height, height: first.height,
    draw(x, y, out) {
      const exit = y + first.height;
      branches.forEach((branch, index) => {
        const entry = y + entries[index];
        const end = entry + branch.height;
        if (index === 0) {
          out.push(path(`M${n(x)} ${n(y)}h${2 * RADIUS}`));
        } else {
          out.push(path(`M${n(x)} ${n(y)}${turn(RADIUS, RADIUS, true)}V${n(entry - RADIUS)}${turn(RADIUS, RADIUS, false)}`));
        }
        branch.draw(x + 2 * RADIUS, entry, out);
        if (index === 0) {
          out.push(path(`M${n(x + 2 * RADIUS + branch.width)} ${n(end)}H${n(x + width)}`));
        } else {
          out.push(path(`M${n(x + 2 * RADIUS + branch.width)} ${n(end)}H${n(x + width - 2 * RADIUS)}${turn(RADIUS, -RADIUS, false)}V${n(exit + RADIUS)}${turn(RADIUS, -RADIUS, true)}`));
        }
      });
    },
  };
}

/**
 * An optional: its content on the track, and a bypass over it. `note`
 * labels the bypass, as the route of an elided terminator.
 * @param {Piece} item
 * @param {string} [note]
 * @returns {Piece}
 */
export function optional(item, note) {
  const width = item.width + 4 * RADIUS;
  const rise = Math.max(item.up + GAP, 2 * RADIUS);
  return {
    width, up: rise + (note ? LABEL_HEIGHT : 0), down: item.down, height: item.height,
    draw(x, y, out) {
      const exit = y + item.height;
      out.push(path(`M${n(x)} ${n(y)}h${2 * RADIUS}`));
      item.draw(x + 2 * RADIUS, y, out);
      out.push(path(`M${n(x + 2 * RADIUS + item.width)} ${n(exit)}H${n(x + width)}`));
      out.push(path(`M${n(x)} ${n(y)}${turn(RADIUS, -RADIUS, false)}V${n(y - rise + RADIUS)}${turn(RADIUS, -RADIUS, true)}H${n(x + width - 2 * RADIUS)}${turn(RADIUS, RADIUS, true)}V${n(exit - RADIUS)}${turn(RADIUS, RADIUS, false)}`));
      if (note) out.push(`<text class="label" x="${n(x + 2 * RADIUS + 4)}" y="${n(y - rise - 5)}"${fit(note, LABEL_CHAR_WIDTH)}>${escape(note)}</text>`);
    },
  };
}

/**
 * One or more of an item: the item on the track, and a loop back under it,
 * through the separator if there is one. `note` labels the loop, as the
 * kind of a chain.
 * @param {Piece} item
 * @param {Piece} [separator]
 * @param {string} [note]
 * @returns {Piece}
 */
export function repeat(item, separator, note) {
  const inner = Math.max(item.width, separator ? separator.width : 0);
  const width = inner + 4 * RADIUS;
  const drop = Math.max(item.down + GAP + (separator ? separator.up : 0), 2 * RADIUS);
  const below = separator ? separator.down : 0;
  return {
    width, up: item.up, down: drop + below + (note ? LABEL_HEIGHT : 0), height: item.height,
    draw(x, y, out) {
      const exit = y + item.height;
      const loop = exit + drop;
      out.push(path(`M${n(x)} ${n(y)}h${2 * RADIUS}`));
      item.draw(x + 2 * RADIUS, y, out);
      out.push(path(`M${n(x + 2 * RADIUS + item.width)} ${n(exit)}H${n(x + width)}`));
      const right = x + width - 2 * RADIUS;
      let back = `M${n(right)} ${n(exit)}${turn(RADIUS, RADIUS, true)}V${n(loop - RADIUS)}${turn(-RADIUS, RADIUS, true)}`;
      if (separator) {
        // The separator is read on the way back, so its box stands on the
        // loop, centred, with the track on either side of it.
        const start = x + 2 * RADIUS + (inner - separator.width) / 2;
        out.push(path(`${back}H${n(start + separator.width)}`));
        separator.draw(start, loop, out);
        back = `M${n(start)} ${n(loop)}`;
      }
      out.push(path(`${back}H${n(x + 2 * RADIUS)}${turn(-RADIUS, -RADIUS, true)}V${n(y + RADIUS)}${turn(RADIUS, -RADIUS, true)}`));
      if (note) out.push(`<text class="label" x="${n(x + 2 * RADIUS + 4)}" y="${n(loop + below + LABEL_HEIGHT - 2)}"${fit(note, LABEL_CHAR_WIDTH)}>${escape(note)}</text>`);
    },
  };
}

/**
 * The text of a symbol as the notation writes it: an identifier tag whose
 * name begins with a lower-case letter needs its `~`.
 * @param {any} expr
 * @returns {string}
 */
function symbolText(expr) {
  if (typeof expr.ref === "string") return expr.ref;
  if ("terminal" in expr) return /^[a-z]/.test(expr.terminal) ? `~${expr.terminal}` : expr.terminal;
  if ("range" in expr) return `${expr.range[0]}..${expr.range[1]}`;
  if ("property" in expr) return `'\\p{${expr.property}}'`;
  throw new Error(`not a symbol: ${JSON.stringify(expr)}`);
}

/**
 * Whether a symbol is a terminal: anything but a reference to a rule. A
 * reference whose name begins with a capital is a terminal (docs/notation.md,
 * "Names and terminals").
 * @param {any} expr
 */
const isTerminal = (expr) => typeof expr.ref !== "string" || /^[A-Z]/.test(expr.ref);

/**
 * A test as the notation writes it after its symbol, such as `="la"` or
 * `⊇(UI ∪ CAI)`.
 * @param {any} expr
 * @returns {string}
 */
export function testText(expr) {
  const value = formatTerm(expr.value);
  const set = ["union", "intersection", "difference", "if"].some((key) => key in expr.value) ? `(${value})` : value;
  if (expr.test === "∩=∅" || expr.test === "∩≠∅") return `∩${set}${expr.test.slice(1)}`;
  if (expr.test === "=" || expr.test === "≠") return `${expr.test}${value}`;
  return `${expr.test}${set}`;
}

/**
 * The diagram of an expression of the DOM (docs/engine.md, §9), no wider
 * than `limit` where its sequences can wrap. Each construct that frames its
 * parts takes the room of its frame from the limit of the parts.
 * @param {any} expr
 * @param {number} [limit]
 * @returns {Piece}
 */
export function expressionPiece(expr, limit = MAX_WIDTH) {
  const inside = limit - 4 * RADIUS;
  /** @param {any} part */
  const framed = (part) => expressionPiece(part, inside);
  if ("seq" in expr) return wrapped(expr.seq.map(framed), limit);
  if ("choice" in expr) return choice(expr.choice.map(framed));
  // A & B & C reads any non-empty subsequence in order. So it is the choice
  // of where the subsequence begins, each item after that being optional.
  if ("and" in expr) {
    return choice(expr.and.map((/** @type {any} */ item, /** @type {number} */ index) => wrapped([
      expressionPiece(item, inside - 4 * RADIUS),
      ...expr.and.slice(index + 1).map((/** @type {any} */ rest) => optional(expressionPiece(rest, inside - 8 * RADIUS))),
    ], inside)));
  }
  if ("optional" in expr) return optional(framed(expr.optional), expr.elidable ? (expr.maximal ? "elided, maximal" : "elided") : undefined);
  if ("repeat" in expr) {
    const note = expr.chain ? `${expr.chain} chain` : undefined;
    return repeat(framed(expr.repeat), expr.separator ? framed(expr.separator) : undefined, note);
  }
  // A capture names a part for the clauses, and changes nothing that the
  // rule reads.
  if ("capture" in expr) return expressionPiece(expr.expr, limit);
  if ("test" in expr) return box(symbolText(expr.expr) + testText(expr), isTerminal(expr.expr));
  if (expr.empty === true) return skip();
  return box(symbolText(expr), isTerminal(expr));
}

/**
 * The guards of an alternative as the notation writes them.
 * @param {any[]} guards
 * @returns {string}
 */
export function guardText(guards) {
  return guards.map((guard) => `${guard.negated ? "¬" : ""}${guard.feature}${guard.kind === "warning" ? "!" : "?"}`).join(" ");
}

/**
 * The diagram of a rule's alternatives: a choice of them, each led by its
 * guards.
 * @param {any} rule
 * @returns {Piece}
 */
export function rulePiece(rule) {
  // With several alternatives, the choice's frame takes its room.
  const limit = rule.alternatives.length > 1 ? MAX_WIDTH - 4 * RADIUS : MAX_WIDTH;
  return choice(rule.alternatives.map((/** @type {any} */ alternative) => {
    if (!alternative.guards.length) return expressionPiece(alternative.expr, limit);
    const guards = label(guardText(alternative.guards));
    return sequence([guards, expressionPiece(alternative.expr, limit - guards.width - GAP)]);
  }));
}

const STYLE = [
    "path{fill:none;stroke:#333;stroke-width:1.5}",
  ".rule rect{fill:#e8eefc;stroke:#333;stroke-width:1.5}",
  ".terminal rect{fill:#fdf6d8;stroke:#333;stroke-width:1.5}",
  `text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;font-size:${FONT_SIZE}px;fill:#111;text-anchor:middle}`,
  `text.label{font-size:${LABEL_SIZE}px;font-style:italic;fill:#555;text-anchor:start}`,
  "text.title{font-weight:bold;text-anchor:start}",
].join("");

/**
 * The SVG file of a rule: its name, then the track from a start mark to an
 * end mark through its alternatives.
 * @param {any} rule
 * @returns {string}
 */
export function ruleSvg(rule) {
  const body = rulePiece(rule);
  const mark = 10;
  const width = Math.ceil(Math.max(MARGIN * 2 + mark * 2 + body.width, MARGIN * 2 + length(rule.name) * CHAR_WIDTH));
  const y = MARGIN + TITLE_HEIGHT + Math.max(body.up, BOX_HALF);
  const height = Math.ceil(y + body.height + Math.max(body.down, BOX_HALF) + MARGIN);
  /** @type {string[]} */
  const out = [];
  out.push(`<text class="title" x="${MARGIN}" y="${MARGIN + FONT_SIZE}">${escape(rule.name)}</text>`);
  // The start and end marks: a double bar, as most railroad diagrams draw
  // them.
  out.push(path(`M${MARGIN} ${n(y - 8)}v16m4 -16v16M${MARGIN + 4} ${n(y)}h${mark - 4}`));
  body.draw(MARGIN + mark, y, out);
  const end = MARGIN + mark + body.width;
  const exit = y + body.height;
  out.push(path(`M${n(end)} ${n(exit)}h${mark - 4}m0 -8v16m4 -16v16`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`Railroad diagram of the rule ${rule.name}`)}">\n<style>${STYLE}</style>\n<rect width="100%" height="100%" fill="#fff"/>\n${out.join("\n")}\n</svg>\n`;
}

// ---- The diagrams in the grammar documents ---------------------------------

/** Where the SVG files of the grammar documents' diagrams go. */
export const DIAGRAMS = "docs/diagrams";

/**
 * How a generated line begins. tools/sync.js owns every line outside a
 * fenced block that begins so, and no line that a person writes does: the
 * documents hold no other HTML (tools/prose-lines.js).
 */
export const DIAGRAM_LINE_START = "<details><summary>Railroad diagram of ";

/**
 * The generated line of a rule: a collapsed `<details>` element that shows
 * the rule's SVG file.
 * @param {string} name the rule's name
 * @param {string} source the SVG file, relative to the document
 * @returns {string}
 */
export function diagramLine(name, source) {
  return `${DIAGRAM_LINE_START}<code>${escape(name)}</code></summary><img src="${escape(source)}" alt="Railroad diagram of the rule ${escape(name)}"></details>`;
}

/**
 * The file name of each rule's diagram, in the order of the rules. A name
 * is the rule's own, and `#` is `_hash`. A rule that a document states more
 * than once, such as one defined and then extended, takes .2, .3 and so on.
 * Names that differ only in case also do, for file systems that ignore
 * case. No rule name has a period or begins with `_`, so no two rules share
 * a file.
 * @param {{name: string}[]} rules
 * @returns {string[]}
 */
export function diagramNames(rules) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return rules.map((rule) => {
    const base = rule.name === "#" ? "_hash" : rule.name;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count > 1 ? `${base}.${count}` : base;
  });
}

/**
 * The directory of a grammar document's SVG files, from the document's
 * path under grammars/, such as `syntax/cll.md`.
 * @param {string} file
 */
export const diagramDirectory = (file) => `${DIAGRAMS}/${file.replace(/\.md$/, "")}`;

/**
 * The fenced blocks of a Markdown document, found as the libraries' reader
 * finds them (lib/js/src/markdown.js): the lines of each block's opening
 * and closing fences, counted from 0, and whether it is a grammar block. A
 * block with no closing fence ends after the last line.
 * @param {string[]} lines
 * @returns {{start: number, end: number, grammar: boolean}[]}
 */
export function fencedBlocks(lines) {
  const blocks = [];
  /** @type {{start: number, fence: string, grammar: boolean} | null} */
  let open = null;
  lines.forEach((line, index) => {
    if (open === null) {
      // A backtick fence's info string has no backtick (CommonMark).
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) open = { start: index, fence: fence[1], grammar: fence[2].trim() === "jbogenbau" };
      return;
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
      blocks.push({ start: open.start, end: index, grammar: open.grammar });
      open = null;
    }
  });
  if (open) blocks.push({ start: open.start, end: lines.length, grammar: open.grammar });
  return blocks;
}

/**
 * A grammar document with the diagrams of its rules in place, and the SVG
 * file of each rule by its path in the repository. After each grammar
 * block that states rules come a blank line and one generated line for
 * each of those rules, in their order.
 *
 * The generated lines are the lines outside fenced blocks that begin with
 * DIAGRAM_LINE_START. This removes them all, and the blank line before each
 * run of them, then writes them again. So the diagram of a rule that is gone
 * goes too, and every other line stays as it is.
 * @param {string} file the document's path under grammars/
 * @param {string} markdown the document
 * @param {{rules: any[]}} dom the document's DOM
 * @returns {{text: string, lines: (number | null)[], files: Map<string, string>}}
 *   the document; the line where each line of `markdown` now stands, by its
 *   line number (both counted from 1), or null for a generated line; and
 *   the SVG files
 */
export function withDiagrams(file, markdown, dom) {
  const lines = markdown.split("\n");
  const blocks = fencedBlocks(lines);
  const inside = new Array(lines.length).fill(false);
  for (const { start, end } of blocks) inside.fill(true, start, end + 1);
  const generated = lines.map((line, index) => !inside[index] && line.startsWith(DIAGRAM_LINE_START));
  const keep = generated.map((line) => !line);
  for (let first = 0; first < lines.length; first++) {
    if (!generated[first] || (first > 0 && generated[first - 1])) continue;
    let last = first;
    while (last + 1 < lines.length && generated[last + 1]) last++;
    // The blank line before a run goes when a blank line, the start or the
    // end of the document stands on the run's other side, so the run
    // leaves one blank line behind it, and joins no two blocks.
    const blankAfter = last + 1 === lines.length || lines[last + 1] === "";
    const blankBefore = first < 2 || (lines[first - 2] === "" && keep[first - 2]);
    if (first > 0 && lines[first - 1] === "" && (blankAfter || blankBefore)) keep[first - 1] = false;
  }

  // The generated lines after each grammar block, by the line of its
  // closing fence. The rules come in the order of the document, and so do
  // the blocks.
  const directory = diagramDirectory(file);
  const up = "../".repeat(file.split("/").length);
  const names = diagramNames(dom.rules);
  const grammarBlocks = blocks.filter((block) => block.grammar);
  /** @type {Map<number, string[]>} */
  const after = new Map();
  const files = new Map();
  let at = 0;
  dom.rules.forEach((rule, index) => {
    const line = rule.at[0] - 1;
    while (at < grammarBlocks.length && grammarBlocks[at].end < line) at++;
    const block = grammarBlocks[at];
    if (!block || !(block.start < line)) throw new Error(`${file}:${rule.at[0]}: the rule ${rule.name} stands in no jbogenbau block`);
    // The generated lines stand at the top level, so a block of rules in a
    // list item, which indents its fences, would end the list.
    if (/^ /.test(lines[block.start])) throw new Error(`${file}:${block.start + 1}: a jbogenbau block with rules is indented, as in a list item; put it at the top level, where its railroad diagrams can follow it`);
    const svg = `${directory}/${names[index]}.svg`;
    files.set(svg, ruleSvg(rule));
    if (!after.has(block.end)) after.set(block.end, []);
    /** @type {string[]} */ (after.get(block.end)).push(diagramLine(rule.name, up + svg));
  });

  const out = [];
  /** @type {(number | null)[]} */
  const moved = [null];
  for (let index = 0; index < lines.length; index++) {
    moved.push(keep[index] ? out.length + 1 : null);
    if (!keep[index]) continue;
    out.push(lines[index]);
    const diagrams = after.get(index);
    if (!diagrams) continue;
    out.push("");
    for (const diagram of diagrams) out.push(diagram);
    // An HTML block runs to the next blank line, so one follows it.
    let next = index + 1;
    while (next < lines.length && !keep[next]) next++;
    if (next < lines.length && lines[next] !== "") out.push("");
  }
  return { text: out.join("\n"), lines: moved, files };
}
