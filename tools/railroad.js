// Railroad diagrams of the grammar documents' rules (docs/design.md,
// "Railroad diagrams"). tools/sync.js writes one SVG file for each rule of
// each grammar document, and one Markdown page for each document that shows
// them, under docs/diagrams/. The drawing comes from the document's DOM, as
// the libraries' reader gives it, so a diagram shows what gencmu reads.
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

// ---- The diagram pages ------------------------------------------------------

/** Where the diagrams of the grammar documents go. */
export const DIAGRAMS = "docs/diagrams";

/**
 * The headings of a Markdown document outside its fenced blocks, each with
 * its line (counted from 1), level and text. The grammar documents write
 * ATX headings only (docs/design.md, "Documents").
 * @param {string} markdown
 * @returns {{line: number, level: number, text: string}[]}
 */
export function headings(markdown) {
  const result = [];
  /** @type {string | null} */
  let fence = null;
  markdown.split(/\r\n|\n|\r/).forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
      return;
    }
    if (marker) {
      fence = marker[1];
      return;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading) result.push({ line: index + 1, level: heading[1].length, text: heading[2] ?? "" });
  });
  return result;
}

/**
 * The anchor that GitHub gives a heading: its text without markup and
 * punctuation, in lower case, with hyphens for spaces. A repeated anchor
 * takes -1, -2 and so on, in the order of the document.
 * @param {string[]} texts the texts of all the document's headings, in order
 * @returns {string[]}
 */
export function anchors(texts) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return texts.map((text) => {
    const plain = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");
    const base = plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  });
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
 * The page of a grammar document's diagrams, and its directory, from the
 * document's path under grammars/, such as `syntax/cll.md`.
 * @param {string} file
 */
export function diagramPaths(file) {
  const stem = file.replace(/\.md$/, "");
  return { page: `${DIAGRAMS}/${stem}.md`, directory: `${DIAGRAMS}/${stem}` };
}

/**
 * What the diagram of a rule leaves out, and how the rule is stated, as a
 * sentence or two for the page. Empty when there is nothing to say.
 * @param {any} rule
 * @returns {string}
 */
export function ruleNote(rule) {
  const sentences = [];
  if (rule.op === "redefine") sentences.push("`%redefine-rule` replaces a rule of an earlier document.");
  if (rule.op === "extend") sentences.push("`%extend-rule` adds these alternatives to a rule of an earlier document.");
  if (rule.flags.length) sentences.push(`Its flag is ${rule.flags.map((/** @type {string} */ flag) => `\`${flag}\``).join(" and ")}.`);
  const left = [];
  if (rule.tags !== undefined || rule.alternatives.some((/** @type {any} */ alternative) => alternative.tags !== undefined)) left.push("tags");
  if (rule.conditions.length) left.push("conditions");
  if (rule.emit !== undefined) left.push("emission");
  if (rule.opaque) left.push("`%opaque`");
  if (left.length) sentences.push(`The diagram leaves out its ${left.length > 1 ? `${left.slice(0, -1).join(", ")} and ${left[left.length - 1]}` : left[0]}.`);
  return sentences.join(" ");
}

/**
 * The diagrams of one grammar document: a page that shows each rule under
 * the heading of the document's section that states it, and the SVG file of
 * each rule, by its path in the repository.
 * @param {string} file the document's path under grammars/
 * @param {string} markdown the document
 * @param {{rules: any[]}} dom the document's DOM
 * @returns {Map<string, string>} each generated file's path and text
 */
export function documentDiagrams(file, markdown, dom) {
  const { page, directory } = diagramPaths(file);
  const files = new Map();
  if (dom.rules.length === 0) return files;
  const depth = page.split("/").length - 1;
  const source = `${"../".repeat(depth)}grammars/${file}`;
  const local = directory.slice(directory.lastIndexOf("/") + 1);
  const found = headings(markdown);
  const slugs = anchors(found.map((heading) => heading.text));
  const title = found.find((heading) => heading.level === 1)?.text ?? file;
  const lines = [
    `# ${title}: railroad diagrams`,
    "",
    `These are the rules of [${title}](${source}), one diagram for each rule, in the order of the document.`,
    "",
    "`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.",
    "",
    `[Railroad diagrams](${"../".repeat(depth - 1)}design.md#railroad-diagrams) in the design document explains how to read them.`,
  ];
  const names = diagramNames(dom.rules);
  let section = -2;
  // The section of a rule is the last heading before its line. The rules
  // come in the order of the document, so one pass over the headings finds
  // every rule's.
  let at = -1;
  dom.rules.forEach((rule, index) => {
    while (at + 1 < found.length && found[at + 1].line < rule.at[0]) at++;
    if (at !== section) {
      section = at;
      const heading = at >= 0 ? found[at] : null;
      // The rules before the first section stand under the document's
      // title, its introduction.
      if (heading && heading.level > 1) lines.push("", `## ${heading.text}`, "", `These rules are in [this section of the document](${source}#${slugs[at]}).`);
      else lines.push("", "## Introduction", "", `These rules are in [the introduction of the document](${source}).`);
    }
    lines.push("", `### \`${rule.name}\``);
    const note = ruleNote(rule);
    if (note) lines.push("", note);
    lines.push("", `![The rule ${rule.name}](${local}/${names[index]}.svg)`);
    files.set(`${directory}/${names[index]}.svg`, ruleSvg(rule));
  });
  files.set(page, lines.join("\n") + "\n");
  return files;
}
