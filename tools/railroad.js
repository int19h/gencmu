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
import { leafTest } from "../lib/js/src/patterns.js";
import { Grammar } from "../lib/js/src/grammar.js";
import { DOM_FORMAT } from "../lib/js/src/dom.js";

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
 * A ranked group keeps its option numbers inside one frame.
 * @param {Piece[]} branches
 * @returns {Piece}
 */
export function rankedChoice(branches) {
  const body = choice(branches.map((branch, index) => sequence([label(String(index + 1)), branch])));
  const framed = {
    width: body.width + 2 * GAP, up: body.up + GAP, down: body.down + GAP, height: body.height,
    /** @param {number} x @param {number} y @param {string[]} out */
    draw(x, y, out) {
      out.push(`<g class="ranked-choice"><rect class="rank-frame" x="${n(x + GAP / 2)}" y="${n(y - body.up - GAP / 2)}" width="${n(body.width + GAP)}" height="${n(body.up + body.height + body.down + GAP)}" rx="4"/>`);
      out.push(path(`M${n(x)} ${n(y)}h${GAP}`));
      body.draw(x + GAP, y, out);
      out.push(path(`M${n(x + GAP + body.width)} ${n(y + body.height)}h${GAP}`));
      out.push("</g>");
    },
  };
  return sequence([label("≻ same span"), framed]);
}
/**
 * The width that a note needs on the track, from where it begins, 4 pixels
 * in, to 4 pixels before its end.
 * @param {string | undefined} note
 */
const noteWidth = (note) => (note ? Math.ceil(length(note) * LABEL_CHAR_WIDTH) + 8 : 0);

/**
 * An optional: its content on the track, and a bypass over it. `note`
 * labels the bypass, as the route of an elided terminator. The piece is
 * wide enough for the note.
 * @param {Piece} item
 * @param {string} [note]
 * @returns {Piece}
 */
export function optional(item, note) {
  const inner = Math.max(item.width, noteWidth(note));
  const width = inner + 4 * RADIUS;
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
 * A path's data reflected across the vertical line x = axis / 2. The paths
 * of this file use only M, m, H, h, V, v and a, and a reflected arc turns
 * the other way.
 * @param {string} d
 * @param {number} axis twice the x of the line
 */
function reflectPath(d, axis) {
  return d.replace(/([MmHhVva])([^MmHhVva]*)/g, (_, command, args) => {
    const v = args.trim().split(/[ ,]+/).map(Number);
    if (command === "M") return `M${n(axis - v[0])} ${n(v[1])}`;
    if (command === "m") return `m${n(-v[0])} ${n(v[1])}`;
    if (command === "H") return `H${n(axis - v[0])}`;
    if (command === "h") return `h${n(-v[0])}`;
    if (command === "a") return `a${v[0]} ${v[1]} ${v[2]} ${v[3]} ${1 - v[4]} ${n(-v[5])} ${n(v[6])}`;
    return command + args;
  });
}

/**
 * An element of a drawing reflected across the vertical line x = axis / 2.
 * A box and its text keep their size, and a text stays upright: only where
 * it stands changes.
 * @param {string} element
 * @param {number} axis
 */
function reflect(element, axis) {
  if (element.startsWith("<path ")) return element.replace(/ d="([^"]*)"/, (_, d) => ` d="${reflectPath(d, axis)}"`);
  if (element.startsWith("<g ")) {
    return element
      .replace(/<rect x="([-\d.]+)"([^>]*) width="([\d.]+)"/, (_, x, rest, width) => `<rect x="${n(axis - Number(x) - Number(width))}"${rest} width="${width}"`)
      .replace(/<text x="([-\d.]+)"/, (_, x) => `<text x="${n(axis - Number(x))}"`);
  }
  // A note, whose text begins at its x.
  return element.replace(/ x="([-\d.]+)"(.*?) textLength="([\d.]+)"/, (_, x, rest, textLength) => ` x="${n(axis - Number(x) - Number(textLength))}"${rest} textLength="${textLength}"`);
}

/**
 * A piece for a track that runs from right to left, such as a separator on
 * the way back of a loop. It enters at its right, at (width, 0), and leaves
 * at its left, at (0, height). Its parts stand in the order of that track,
 * so the first part read stands at the right, and every text stays upright.
 * @param {Piece} piece
 * @returns {Piece}
 */
export function reversed(piece) {
  return {
    width: piece.width, up: piece.up, down: piece.down, height: piece.height,
    draw(x, y, out) {
      /** @type {string[]} */
      const drawn = [];
      piece.draw(x, y, drawn);
      for (const element of drawn) out.push(reflect(element, 2 * x + piece.width));
    },
  };
}

/**
 * One or more of an item: the item on the track, and a loop back under it,
 * through the separator if there is one. The loop runs from right to left,
 * so the separator is drawn reversed: the track reaches its right end first.
 * `note` labels the loop, as the kind of a chain.
 * @param {Piece} item
 * @param {Piece} [separator]
 * @param {string} [note]
 * @returns {Piece}
 */
export function repeat(item, separator, note) {
  const inner = Math.max(item.width, separator ? separator.width : 0, noteWidth(note));
  const width = inner + 4 * RADIUS;
  // The loop runs this far below the item's exit, and the separator, which
  // can continue on rows of its own, leaves it `fall` lower again.
  const drop = Math.max(item.down + GAP + (separator ? separator.up : 0), 2 * RADIUS);
  const fall = separator ? separator.height : 0;
  const below = separator ? separator.down : 0;
  return {
    width, up: item.up, down: drop + fall + below + (note ? LABEL_HEIGHT : 0), height: item.height,
    draw(x, y, out) {
      const exit = y + item.height;
      const loop = exit + drop;
      out.push(path(`M${n(x)} ${n(y)}h${2 * RADIUS}`));
      item.draw(x + 2 * RADIUS, y, out);
      out.push(path(`M${n(x + 2 * RADIUS + item.width)} ${n(exit)}H${n(x + width)}`));
      const right = x + width - 2 * RADIUS;
      let back = `M${n(right)} ${n(exit)}${turn(RADIUS, RADIUS, true)}V${n(loop - RADIUS)}${turn(-RADIUS, RADIUS, true)}`;
      if (separator) {
        // The separator stands on the loop, centred, with the track on
        // either side of it.
        const start = x + 2 * RADIUS + (inner - separator.width) / 2;
        out.push(path(`${back}H${n(start + separator.width)}`));
        reversed(separator).draw(start, loop, out);
        back = `M${n(start)} ${n(loop + fall)}`;
      }
      out.push(path(`${back}H${n(x + 2 * RADIUS)}${turn(-RADIUS, -RADIUS, true)}V${n(y + RADIUS)}${turn(RADIUS, -RADIUS, true)}`));
      if (note) out.push(`<text class="label" x="${n(x + 2 * RADIUS + 4)}" y="${n(loop + fall + below + LABEL_HEIGHT - 2)}"${fit(note, LABEL_CHAR_WIDTH)}>${escape(note)}</text>`);
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
 * The elidable optionals of a rule whose terminator has a test, in the
 * order of a walk of its alternatives, each item before its parts. Only for
 * these can the test forbid the omission (engine §3.8, the omission
 * predicate).
 * @param {any} rule
 * @returns {any[]}
 */
export function testedElisions(rule) {
  const found = [];
  /** @param {any} expr */
  const visit = (expr) => {
    if (!expr || typeof expr !== "object") return;
    if (Array.isArray(expr)) {
      for (const item of expr) visit(item);
      return;
    }
    if ("optional" in expr && expr.elidable) {
      const first = "seq" in expr.optional ? expr.optional.seq[0] : expr.optional;
      if ("test" in first) found.push(expr);
    }
    for (const key of ["seq", "choice", "ranked", "and", "optional", "repeat", "separator", "expr"]) if (key in expr) visit(expr[key]);
  };
  for (const alternative of rule.alternatives) visit(alternative.expr);
  return found;
}

/**
 * Whether a term refers to a constant anywhere in it.
 * @param {unknown} term
 * @returns {boolean}
 */
function holdsConstant(term) {
  if (!term || typeof term !== "object") return false;
  if (Array.isArray(term)) return term.some(holdsConstant);
  return "const" in term || Object.values(term).some(holdsConstant);
}

/**
 * What the omission predicate of the engine gives for each elidable optional
 * whose terminator has a test (engine §3.8), in every stage of the given
 * pipelines that reads its document. The predicate tests the omitted
 * terminator: the sound of an `=` test, or no sound, and the tag set of the
 * terminator alone. So the answer depends only on the test's value. That
 * value is a closed term, which holds no classify, capture or guard
 * (docs/notation.md, "Constants"). Only a constant in it takes a value from
 * the stage, so only then does this load the dialect: a constant can have
 * another value in each stage that reads the document. Any other value is
 * the same in every stage, and is evaluated once, with no stage. With no
 * such optional in `documents`, this reads nothing at all.
 * @param {{unicode: any, pipeline: (path: string) => {stages: {documents: {path: string, dom: any}[]}[]}, dialect: (path: string) => {stages: {grammar: any}[]}}} loader
 * @param {string[]} pipelines the pipeline documents' paths
 * @param {Map<string, {rules: any[]}>} documents the DOM of each grammar
 *   document, by its path under grammars/
 * @returns {Map<string, Map<number, Set<boolean>[]>>} by document, then by
 *   the index of the rule: one set of answers for each of its
 *   testedElisions, in order
 */
export function elisionOutcomes(loader, pipelines, documents) {
  /** @type {Map<string, Map<number, Set<boolean>[]>>} */
  const outcomes = new Map();
  const tested = [...documents].filter(([, dom]) => dom.rules.some((/** @type {any} */ rule) => testedElisions(rule).length > 0)).map(([document]) => document);
  if (tested.length === 0) return outcomes;
  const candidates = new Set(tested);
  // The grammar of no stage, for a value without constants: a stage needs
  // a rule text and its ambiguity resolution, and it holds nothing else.
  // Its Unicode table, for a range, is the one that every stage shares.
  const stageless = new Grammar("diagrams", [{ path: "diagrams", dom: { format: DOM_FORMAT, rules: [{ name: "text", op: "define", flags: [], alternatives: [{ guards: [], expr: { empty: true } }], conditions: [], at: [1, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [1, 1] }], constants: [], classifiers: [], implications: [] } }], loader.unicode);
  for (const pipeline of pipelines) {
    const { stages } = loader.pipeline(pipeline);
    /** @type {{stages: {grammar: any}[]} | null} */
    let dialect = null;
    stages.forEach((stage, index) => {
      for (const { path: document, dom } of stage.documents) {
        if (!candidates.has(document)) continue;
        dom.rules.forEach((/** @type {any} */ rule, /** @type {number} */ ruleIndex) => {
          testedElisions(rule).forEach((optional, ordinal) => {
            const first = "seq" in optional.optional ? optional.optional.seq[0] : optional.optional;
            const grammar = holdsConstant(first.value) ? (dialect ??= loader.dialect(pipeline)).stages[index].grammar : stageless;
            const test = grammar.symbolTest(first, document, { document, line: rule.at[0], column: rule.at[1] });
            const terminal = "terminal" in first.expr ? first.expr.terminal : first.expr.ref;
            const held = leafTest({ test: test.op, value: test.sound !== undefined ? { string: test.sound } : { set: test.tags } }, test.op === "=" ? test.sound : "", new Set([terminal]));
            if (!outcomes.has(document)) outcomes.set(document, new Map());
            const byRule = /** @type {Map<number, Set<boolean>[]>} */ (outcomes.get(document));
            if (!byRule.has(ruleIndex)) byRule.set(ruleIndex, []);
            const answers = /** @type {Set<boolean>[]} */ (byRule.get(ruleIndex));
            (answers[ordinal] ??= new Set()).add(held);
          });
        });
      }
    });
  }
  return outcomes;
}

/**
 * The Omission of one rule, from its answers in elisionOutcomes.
 * @param {any} rule
 * @param {Set<boolean>[] | undefined} answers
 * @returns {Omission}
 */
export function omissionOf(rule, answers) {
  const tested = testedElisions(rule);
  return (optional) => {
    const found = answers?.[tested.indexOf(optional)];
    return found && found.size === 1 ? [...found][0] : null;
  };
}

/**
 * Whether the engine may omit the terminator of an elidable optional: true
 * or false where every stage that reads the rule agrees, null where they
 * differ or where nothing says. An optional whose terminator has no test
 * may always be omitted.
 * @typedef {(optional: any) => boolean | null} Omission
 */

/** @type {Omission} */
const unknownOmission = () => null;

/**
 * The diagram of an expression of the DOM (docs/engine.md, §9), no wider
 * than `limit` where its sequences can wrap. Each construct that frames its
 * parts takes the room of its frame from the limit of the parts.
 * @param {any} expr
 * @param {number} [limit]
 * @param {Omission} [omission]
 * @returns {Piece}
 */
export function expressionPiece(expr, limit = MAX_WIDTH, omission = unknownOmission) {
  const inside = limit - 4 * RADIUS;
  /** @param {any} part */
  const framed = (part) => expressionPiece(part, inside, omission);
  if ("seq" in expr) return wrapped(expr.seq.map(framed), limit);
  if ("choice" in expr) return choice(expr.choice.map(framed));
  if ("ranked" in expr) {
    const room = inside - label("≻ same span").width - 3 * GAP - label(String(expr.ranked.length)).width;
    return rankedChoice(expr.ranked.map((/** @type {any} */ option) => expressionPiece(option, room, omission)));
  }
  // A & B & C reads any non-empty subsequence in order. So it is the choice
  // of where the subsequence begins, each item after that being optional.
  if ("and" in expr) {
    return choice(expr.and.map((/** @type {any} */ item, /** @type {number} */ index) => wrapped([
      expressionPiece(item, inside - 4 * RADIUS, omission),
      ...expr.and.slice(index + 1).map((/** @type {any} */ rest) => optional(expressionPiece(rest, inside - 8 * RADIUS, omission))),
    ], inside)));
  }
  if ("optional" in expr) {
    if (!expr.elidable) return optional(framed(expr.optional));
    // The terminator's test can forbid its omission (engine §3.8): then
    // only the written route is left.
    const first = "seq" in expr.optional ? expr.optional.seq[0] : expr.optional;
    const allowed = "test" in first ? omission(expr) : true;
    if (allowed === false) return expressionPiece(expr.optional, limit, omission);
    const kind = expr.maximal ? "elided, maximal" : "elided";
    return optional(framed(expr.optional), allowed ? kind : `${kind}, where its test allows`);
  }
  if ("repeat" in expr) {
    const note = expr.chain ? `${expr.chain} chain` : undefined;
    return repeat(framed(expr.repeat), expr.separator ? framed(expr.separator) : undefined, note);
  }
  // A capture names a part for the clauses, and changes nothing that the
  // rule reads.
  if ("capture" in expr) return expressionPiece(expr.expr, limit, omission);
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
 * @param {Omission} [omission]
 * @returns {Piece}
 */
export function rulePiece(rule, omission = unknownOmission) {
  // With several alternatives, the choice's frame takes its room.
  const limit = rule.alternatives.length > 1 ? MAX_WIDTH - 4 * RADIUS : MAX_WIDTH;
  return choice(rule.alternatives.map((/** @type {any} */ alternative) => {
    if (!alternative.guards.length) return expressionPiece(alternative.expr, limit, omission);
    const guards = label(guardText(alternative.guards));
    return sequence([guards, expressionPiece(alternative.expr, limit - guards.width - GAP, omission)]);
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

/** The note beside the name of a rule that has conditions. */
export const CONDITIONS_NOTE = "conditions apply";
/** The legend below a rule that contains a ranked choice. */
export const RANKED_NOTE = "Only a qualified option over the same span removes lower options.";

/** @param {any} rule */
function hasRankedChoice(rule) {
  const pending = rule.alternatives.map((/** @type {any} */ alternative) => alternative.expr);
  while (pending.length) {
    const expression = pending.pop();
    if (Array.isArray(expression)) {for (const child of expression) pending.push(child);continue;}
    if (!expression || typeof expression !== "object") continue;
    if ("ranked" in expression) return true;
    for (const key of ["seq", "choice", "and", "optional", "repeat", "separator", "expr"]) if (key in expression) pending.push(expression[key]);
  }
  return false;
}

/**
 * The SVG file of a rule: its name, then the track from a start mark to an
 * end mark through its alternatives. A rule with conditions has a note
 * beside its name, since a condition can reject a reading that the track
 * shows.
 * @param {any} rule
 * @param {Omission} [omission]
 * @returns {string}
 */
export function ruleSvg(rule, omission = unknownOmission) {
  const body = rulePiece(rule, omission);
  const mark = 10;
  const titleWidth = length(rule.name) * CHAR_WIDTH;
  const conditioned = rule.conditions.length > 0;
  const ranked = hasRankedChoice(rule);
  const heading = titleWidth + (conditioned ? 2 * GAP + length(CONDITIONS_NOTE) * LABEL_CHAR_WIDTH : 0);
  const width = Math.ceil(Math.max(MARGIN * 2 + mark * 2 + body.width, MARGIN * 2 + heading, ranked ? MARGIN * 2 + length(RANKED_NOTE) * LABEL_CHAR_WIDTH : 0));
  const y = MARGIN + TITLE_HEIGHT + Math.max(body.up, BOX_HALF);
  const bottom = y + body.height + Math.max(body.down, BOX_HALF);
  const height = Math.ceil(bottom + MARGIN + (ranked ? GAP + LABEL_HEIGHT : 0));
  /** @type {string[]} */
  const out = [];
  out.push(`<text class="title" x="${MARGIN}" y="${MARGIN + FONT_SIZE}"${fit(rule.name, CHAR_WIDTH)}>${escape(rule.name)}</text>`);
  if (conditioned) out.push(`<text class="label" x="${n(MARGIN + titleWidth + 2 * GAP)}" y="${MARGIN + FONT_SIZE}"${fit(CONDITIONS_NOTE, LABEL_CHAR_WIDTH)}>${CONDITIONS_NOTE}</text>`);
  // The start and end marks: a double bar, as most railroad diagrams draw
  // them.
  out.push(path(`M${MARGIN} ${n(y - 8)}v16m4 -16v16M${MARGIN + 4} ${n(y)}h${mark - 4}`));
  body.draw(MARGIN + mark, y, out);
  const end = MARGIN + mark + body.width;
  const exit = y + body.height;
  out.push(path(`M${n(end)} ${n(exit)}h${mark - 4}m0 -8v16m4 -16v16`));
  if (ranked) out.push(`<text class="label" x="${MARGIN}" y="${n(bottom + GAP + LABEL_HEIGHT - 4)}"${fit(RANKED_NOTE, LABEL_CHAR_WIDTH)}>${RANKED_NOTE}</text>`);
  const style = STYLE + (ranked ? ".rank-frame{fill:none;stroke:#777;stroke-width:1;stroke-dasharray:3 3}" : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`Railroad diagram of the rule ${rule.name}`)}">\n<style>${style}</style>\n<rect width="100%" height="100%" fill="#fff"/>\n${out.join("\n")}\n</svg>\n`;
}

// ---- The diagrams in the grammar documents ---------------------------------

/** Where the SVG files of the grammar documents' diagrams go. */
export const DIAGRAMS = "docs/diagrams";

/**
 * How the first line of a generated element begins. tools/sync.js owns
 * every element outside a fenced block that begins so, and no line that a
 * person writes does: the documents hold no other HTML
 * (tools/prose-lines.js).
 */
export const DIAGRAM_START = "<details><summary>Railroad diagram";

/** How each line of a generated element after its first begins. */
const IMAGE_START = "<p><img ";

/** The last line of a generated element. */
const DIAGRAM_END = "</details>";

/** The longest summary, in characters as shown, that names every rule. */
export const SUMMARY_LIMIT = 72;

/**
 * Whether the lines of an HTML block are those of one generated element:
 * its summary line, a line for each image, and its end.
 * @param {string[]} lines
 */
export function isDiagramElement(lines) {
  return lines.length >= 3 && lines[0].startsWith(DIAGRAM_START) && lines[lines.length - 1] === DIAGRAM_END && lines.slice(1, -1).every((line) => line.startsWith(IMAGE_START));
}

/**
 * The summary of a block's diagrams: "Railroad diagram of" its one rule,
 * or "Railroad diagrams of" its rules, named once each. A summary that
 * would be longer than SUMMARY_LIMIT names the first and the last rule.
 * @param {string[]} names the names of the block's rules, in order
 * @returns {string} the summary's HTML
 */
export function diagramSummary(names) {
  const unique = [...new Set(names)];
  const code = (/** @type {string} */ name) => `<code>${escape(name)}</code>`;
  if (names.length === 1) return `Railroad diagram of ${code(names[0])}`;
  const listed = (/** @type {(name: string) => string} */ show) => (unique.length === 1 ? show(unique[0]) : `${unique.slice(0, -1).map(show).join(", ")} and ${show(unique[unique.length - 1])}`);
  if (`Railroad diagrams of ${listed((name) => name)}`.length <= SUMMARY_LIMIT) return `Railroad diagrams of ${listed(code)}`;
  return `Railroad diagrams of the ${unique.length} rules from ${code(unique[0])} to ${code(unique[unique.length - 1])}`;
}

/**
 * The generated element of a block of rules: a collapsed `<details>` whose
 * summary names the rules, and which holds the SVG file of each rule, in
 * their order, each on a line of its own. Each drawing gives its rule's
 * name above its track.
 * @param {{name: string, source: string}[]} diagrams each rule's name, and
 *   its SVG file relative to the document
 * @returns {string[]} the element's lines
 */
export function diagramElement(diagrams) {
  return [
    `<details><summary>${diagramSummary(diagrams.map((diagram) => diagram.name))}</summary>`,
    ...diagrams.map(({ name, source }) => `${IMAGE_START}src="${escape(source)}" alt="Railroad diagram of the rule ${escape(name)}"></p>`),
    DIAGRAM_END,
  ];
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
 * The lines of a document and the line ending after each, as the
 * libraries' reader divides them (lib/js/src/markdown.js): at CR LF, CR or
 * LF. The last line has none.
 * @param {string} markdown
 * @returns {{lines: string[], ends: string[]}}
 */
export function documentLines(markdown) {
  const parts = markdown.split(/(\r\n|\r|\n)/);
  const lines = [];
  const ends = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push(parts[index]);
    ends.push(parts[index + 1] ?? "");
  }
  return { lines, ends };
}

/**
 * The fenced blocks of a Markdown document, found as the libraries' reader
 * finds them (lib/js/src/markdown.js): the lines of each block's opening
 * and closing fences, counted from 0, and whether it is a grammar block. A
 * block with no closing fence ends after the last line.
 * @param {string[]} lines the document's lines, without their endings
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
 * The lines that sync.js owns in a document, counted from 0: each
 * generated element outside the fenced blocks. An element begins with a
 * line that begins with DIAGRAM_START, and takes in the image lines after
 * it, up to and with its end line. A line of any other kind ends it, and
 * is not owned.
 * @param {string[]} lines the document's lines, without their endings
 * @returns {boolean[]}
 */
export function ownedLines(lines) {
  const inside = new Array(lines.length).fill(false);
  for (const { start, end } of fencedBlocks(lines)) inside.fill(true, start, end + 1);
  const owned = new Array(lines.length).fill(false);
  for (let index = 0; index < lines.length; index++) {
    if (inside[index] || !lines[index].startsWith(DIAGRAM_START)) continue;
    owned[index] = true;
    while (index + 1 < lines.length && lines[index + 1].startsWith(IMAGE_START)) owned[++index] = true;
    if (index + 1 < lines.length && lines[index + 1] === DIAGRAM_END) owned[++index] = true;
  }
  return owned;
}

/**
 * A grammar document with the diagrams of its rules in place, and the SVG
 * file of each rule by its path in the repository. After each grammar
 * block that states rules come a blank line and one generated element,
 * which shows the diagrams of the block's rules in their order.
 *
 * This removes every generated element (ownedLines), and the blank line
 * before each, then writes them again. So the diagram of a rule that is
 * gone goes too, and every other line stays as it is, with its line
 * ending. A new line takes the document's first line ending.
 * @param {string} file the document's path under grammars/
 * @param {string} markdown the document
 * @param {{rules: any[]}} dom the document's DOM
 * @param {Map<number, Set<boolean>[]>} [outcomes] the answers of the
 *   omission predicate for the document's rules, from elisionOutcomes
 * @returns {{text: string, files: Map<string, string>}} the document, and
 *   the SVG files
 */
export function withDiagrams(file, markdown, dom, outcomes = new Map()) {
  const { lines, ends } = documentLines(markdown);
  const newline = ends.find((end) => end !== "") ?? "\n";
  const blocks = fencedBlocks(lines);
  const generated = ownedLines(lines);
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

  // The diagrams of each grammar block, by the line of its closing fence.
  // The rules come in the order of the document, and so do the blocks.
  const directory = diagramDirectory(file);
  const up = "../".repeat(file.split("/").length);
  const names = diagramNames(dom.rules);
  const grammarBlocks = blocks.filter((block) => block.grammar);
  /** @type {Map<number, {name: string, source: string}[]>} */
  const after = new Map();
  const files = new Map();
  let at = 0;
  dom.rules.forEach((rule, index) => {
    const line = rule.at[0] - 1;
    while (at < grammarBlocks.length && grammarBlocks[at].end < line) at++;
    const block = grammarBlocks[at];
    if (!block || !(block.start < line)) throw new Error(`${file}:${rule.at[0]}: the rule ${rule.name} stands in no jbogenbau block`);
    // The generated element stands at the top level, so a block of rules
    // in a list item, which indents its fences, would end the list.
    if (/^ /.test(lines[block.start])) throw new Error(`${file}:${block.start + 1}: a jbogenbau block with rules is indented, as in a list item; put it at the top level, where its railroad diagrams can follow it`);
    const svg = `${directory}/${names[index]}.svg`;
    files.set(svg, ruleSvg(rule, omissionOf(rule, outcomes.get(index))));
    if (!after.has(block.end)) after.set(block.end, []);
    /** @type {{name: string, source: string}[]} */ (after.get(block.end)).push({ name: rule.name, source: up + svg });
  });

  /** @type {string[]} */
  const out = [];
  /** @param {string} line @param {string} end */
  const emit = (line, end) => out.push(line + end);
  for (let index = 0; index < lines.length; index++) {
    if (!keep[index]) continue;
    const diagrams = after.get(index);
    if (!diagrams) {
      emit(lines[index], ends[index]);
      continue;
    }
    // After the closing fence, a blank line and the element. An HTML block
    // runs to the next blank line, so one follows it, unless the document
    // ends there. A document that ends with no line ending still does.
    emit(lines[index], ends[index] || newline);
    emit("", newline);
    const element = diagramElement(diagrams);
    let next = index + 1;
    while (next < lines.length && !keep[next]) next++;
    element.forEach((line, position) => emit(line, position < element.length - 1 || next < lines.length ? newline : ""));
    if (next < lines.length && lines[next] !== "") emit("", newline);
  }
  return { text: out.join(""), files };
}
