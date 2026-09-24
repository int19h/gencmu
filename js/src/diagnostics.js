// Diagnostics for people: what went wrong with a text or a grammar, said in
// the grammar's own terms. The CLI and the playground print these; nothing
// here changes what a parse computes.

import { GencmuError } from "./errors.js";
import { ParseContext, recognize, expectedAt } from "./earley.js";
import { nodeBrackets, nodeTree } from "./output.js";
import { compareCodePoints } from "./tags.js";
import { termVariables } from "./grammar.js";

/**
 * @import { Action, Condition, Expr, ParseResult, ResultNode, Span, StageReport, TagSet, Term, Argument, Production } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { Dialect } from "./dialect.js"
 * @import { TraceEvent } from "./earley.js"
 * @import { StitchedAlternative } from "./grammar.js"
 */

// ---- Where in the text --------------------------------------------------

/**
 * The line of the text holding a source range, and a caret line under the
 * range: at least one caret, at the end of the line for an empty range.
 * @param {string} text
 * @param {Span} source code point range
 * @returns {{line: number, column: number, excerpt: string}}
 */
export function sourceExcerpt(text, source) {
  const characters = [...text];
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < source[0] && index < characters.length; index++) {
    const character = characters[index];
    if (character === "\n" || (character === "\r" && characters[index + 1] !== "\n")) {
      line++;
      lineStart = index + 1;
    }
  }
  let lineEnd = lineStart;
  while (lineEnd < characters.length && characters[lineEnd] !== "\n" && characters[lineEnd] !== "\r") lineEnd++;
  const shown = characters.slice(lineStart, lineEnd).join("").replace(/\t/g, " ");
  const column = source[0] - lineStart + 1;
  const width = Math.max(1, Math.min(source[1], lineEnd) - source[0]);
  const gutter = `${line} | `;
  const excerpt = `${gutter}${shown}\n${" ".repeat(gutter.length - 2)}| ${" ".repeat(column - 1)}${"^".repeat(width)}`;
  return { line, column, excerpt };
}

/**
 * @param {string} text
 * @returns {string}
 */
function quoted(text) {
  return JSON.stringify(text);
}

// ---- Errors -------------------------------------------------------------

/**
 * A result's error explained: for a rejection, the stage, the line with a
 * caret under the token the stage could not read, and what could have come
 * there, grouped by the rules that could have read it; for an ambiguous
 * text, its two readings; for a grammar error, where. Empty for a result
 * with no error.
 * @param {ParseResult} result
 * @returns {string}
 */
export function explainError(result) {
  const error = result.error;
  if (!error) return "";
  const lines = [];
  if (error.kind === "rejected") {
    const report = result.stages.find((stage) => stage.name === error.stage);
    const tokens = (report && report.input) || [];
    const at = error.token === undefined ? tokens.length : error.token;
    const what = at < tokens.length ? `at ${quoted(tokens[at].text)}` : "at the end of the text";
    lines.push(`The ${error.stage} stage cannot read the text ${what}:`);
    if (error.source) lines.push(sourceExcerpt(result.text, error.source).excerpt);
    const byRule = new Map();
    for (const expectation of error.expected || []) {
      for (const rule of expectation.rules) {
        if (!byRule.has(rule)) byRule.set(rule, []);
        byRule.get(rule).push(expectation.terminal);
      }
    }
    if (byRule.size === 0) lines.push("Nothing could have continued there.");
    else {
      lines.push("What could have come there, by the rule that would have read it:");
      for (const rule of [...byRule.keys()].sort(compareCodePoints)) lines.push(`  ${rule}: ${byRule.get(rule).join(", ")}`);
    }
  } else if (error.kind === "ambiguous") {
    const report = result.stages.find((stage) => stage.name === error.stage);
    const tokens = (report && report.input) || [];
    lines.push(`The ${error.stage} stage's text is ambiguous even with every elided terminator written out,`);
    lines.push("so the ambiguity is not about terminators (elision-only). Two readings:");
    for (const reading of error.readings || []) lines.push("  " + nodeBrackets(reading, tokens, { showElided: true }));
  } else {
    const where = error.document ? `${error.document}${error.line ? `:${error.line}:${error.column}` : ""}: ` : "";
    lines.push(`A grammar error${error.stage ? ` in the ${error.stage} stage` : ""}: ${where}${error.message}`);
  }
  return lines.join("\n");
}

// ---- Ties ----------------------------------------------------------------

/**
 * @param {Action | null} action
 * @param {Token[]} tokens
 * @returns {string}
 */
function describeAction(action, tokens) {
  if (!action) return "ends there";
  if (action.kind === "read") return `reads ${quoted(tokens[action.token] ? tokens[action.token].text : "")} as ${action.terminal}`;
  const production = action.item.production;
  const rule = production.helper ? `part of ${production.owner}` : production.lhs;
  return `closes ${rule} over tokens ${action.item.origin} to ${action.item.end}`;
}

/**
 * Two blocks of text side by side.
 * @param {string} left
 * @param {string} right
 * @param {string} leftTitle
 * @param {string} rightTitle
 * @returns {string}
 */
function sideBySide(left, right, leftTitle, rightTitle) {
  const a = [leftTitle, ...left.split("\n")];
  const b = [rightTitle, ...right.split("\n")];
  const width = Math.max(...a.map((line) => [...line].length)) + 3;
  const out = [];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const line = a[index] || "";
    out.push(line + " ".repeat(width - [...line].length) + (b[index] || ""));
  }
  return out.map((line) => line.replace(/\s+$/, "")).join("\n");
}

/**
 * The ties of a result explained, stage by stage: where the two readings
 * first differ, both readings as brackets, and both trees side by side.
 * Empty when no stage ties.
 * @param {ParseResult} result
 * @returns {string}
 */
export function explainTies(result) {
  const blocks = [];
  for (const stage of result.stages) {
    if (stage.verdict !== "tie") continue;
    const tokens = stage.input || [];
    const [chosen, tied] = stage.witness;
    const action = chosen || tied;
    const at = action ? (action.kind === "read" ? action.token : action.item.end) : 0;
    const lines = [`The ${stage.name} stage is ambiguous: its grammar reads the text two ways, which first differ here:`];
    if (tokens.length) {
      const token = tokens[Math.min(at, tokens.length - 1)];
      /** @type {Span} */
      const source = at < tokens.length ? token.source : [token.source[1], token.source[1]];
      lines.push(sourceExcerpt(result.text, source).excerpt);
    }
    lines.push(`  the chosen reading ${describeAction(chosen, tokens)}`);
    lines.push(`  the other reading ${describeAction(tied, tokens)}`);
    if (stage.tree) {
      lines.push(`  chosen: ${nodeBrackets(stage.tree, tokens, { showElided: true })}`);
      lines.push(`  other:  ${nodeBrackets(stage.tied, tokens, { showElided: true })}`);
      lines.push("");
      lines.push(sideBySide(nodeTree(stage.tree, tokens), nodeTree(stage.tied, tokens), "chosen", "other"));
    }
    lines.push("The grammar should say which reading it means; until it does, the first in the canonical order is used.");
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

// ---- Tokens --------------------------------------------------------------

/**
 * @param {TagSet} tags
 * @returns {string}
 */
function tagList(tags) {
  return [...tags.keys()].sort(compareCodePoints).map((tag) => (tags.get(tag) ? tag : `?${tag}`)).join(" ");
}

/**
 * The tokens each stage handed on, or one stage's, as a table.
 * @param {ParseResult} result
 * @param {string} [stageName]
 * @returns {string}
 */
export function tokenTable(result, stageName) {
  const blocks = [];
  for (const stage of result.stages) {
    if (stageName && stage.name !== stageName) continue;
    if (!stage.output) {
      blocks.push(`${stage.name}: no tokens (${stage.error ? stage.error.kind : "not run"})`);
      continue;
    }
    const rows = stage.output.map((token, index) => [String(index), quoted(token.text), quoted(token.phonemes || ""),
      `${token.span[0]}-${token.span[1]}`, `${token.source[0]}-${token.source[1]}`, tagList(token.tags) + (token.insertedBy ? `  (inserted by ${token.insertedBy})` : "")]);
    const header = ["#", "text", "phonemes", "span", "source", "tags"];
    const widths = header.map((title, column) => Math.max([...title].length, ...rows.map((row) => [...row[column]].length)));
    /** @type {(row: string[]) => string} */
    const format = (row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell + " ".repeat(widths[column] - [...cell].length))).join("  ");
    blocks.push([`${stage.name}: ${stage.output.length} tokens, ${stage.verdict}`, format(header), ...rows.map(format)].join("\n"));
  }
  return blocks.join("\n\n");
}

// ---- The notation, printed back ------------------------------------------

/**
 * @param {Argument} term
 * @returns {string}
 */
export function formatTerm(term) {
  if ("rule" in term) return term.rule;
  if ("literal" in term) return /^\/.\/$/u.test(term.literal) ? term.literal : quoted(term.literal);
  if ("weak" in term) return `?${quoted(term.weak)}`;
  if ("emptySet" in term) return "∅";
  if ("union" in term) return term.union.map(formatTerm).join(" ∪ ");
  if ("intersection" in term) return term.intersection.map((item) => ("union" in item ? `(${formatTerm(item)})` : formatTerm(item))).join(" ∩ ");
  if ("call" in term) return `${term.call}(${term.args.map(formatTerm).join(", ")})`;
  return `$${term.capture}`;
}

/**
 * @param {Condition} condition
 * @returns {string}
 */
export function formatCondition(condition) {
  if ("any" in condition) return condition.any.map(formatCondition).join(" ∨ ");
  if ("all" in condition) return condition.all.map((item) => ("any" in item ? `(${formatCondition(item)})` : formatCondition(item))).join(" ∧ ");
  if ("not" in condition) return `¬(${formatCondition(condition.not)})`;
  if ("matches" in condition) return `matches(${formatTerm(condition.matches)}, ${condition.rule})`;
  return `${formatTerm(condition.left)} ${condition.op} ${formatTerm(condition.right)}`;
}

/**
 * A production with a dot, its captures shown, a helper as the rule it
 * belongs to.
 * @param {Production} production
 * @param {number} dot
 * @returns {string}
 */
export function formatItem(production, dot) {
  const symbols = production.rhs.map((symbol, index) => {
    const name = symbol.name.includes("·") ? `‹${symbol.name.split("·")[0]} part›` : symbol.name;
    const capture = production.captures.find((entry) => entry.index === index && !entry.name.startsWith("\u0000"));
    return capture ? `$${capture.name}(${name})` : name;
  });
  symbols.splice(dot, 0, "•");
  const lhs = production.helper ? `‹${production.owner} part›` : production.lhs;
  return `${lhs} ≔ ${symbols.join(" ")}`;
}

// ---- Audit ---------------------------------------------------------------

/**
 * The rules an expression refers to.
 * @param {Expr} expr
 * @param {Set<string>} into
 */
function referencedRules(expr, into) {
  const stack = [expr];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("ref" in current) into.add(current.ref);
    else if ("seq" in current) stack.push(...current.seq);
    else if ("choice" in current) stack.push(...current.choice);
    else if ("and" in current) stack.push(...current.and);
    else if ("optional" in current) stack.push(current.optional);
    else if ("repeat" in current) stack.push(current.repeat);
    else if ("capture" in current) stack.push(current.expr);
  }
}

/**
 * @param {unknown} node
 * @param {Set<string>} into
 */
function namedRules(node, into) {
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (!current || typeof current !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (current);
    if (typeof record.rule === "string") into.add(record.rule);
    for (const value of Object.values(record)) if (value && typeof value === "object") stack.push(value);
  }
}

/**
 * @typedef {object} StageAudit
 * @property {string} name
 * @property {string} resolution
 * @property {number} rules
 * @property {string[]} unreachable rules no derivation of `text` can reach
 * @property {{kind: string, rule: string, document: string, previous: string}[]} changes
 * @property {{rule: string, document: string, condition: string}[]} idleConditions conditions no
 *   alternative of their definition captures every part of
 * @property {{rule: string, document: string, erased: string}[]} idleErasures erasures, `$ <>` or
 *   `$x <>`, of what could never emit anything anyway and never lies inside an emitted token
 */

/**
 * The top-level items of an alternative's expression.
 * @param {Expr} expr
 * @returns {Expr[]}
 */
function topItems(expr) {
  return "seq" in expr ? expr.seq : [expr];
}

/**
 * Which rules of a stage could emit a token when walked (engine §11): one
 * with an alternative that emits something itself, or walks a part that
 * could.
 * @param {Map<string, StitchedAlternative[]>} alternativesByRule
 * @returns {Set<string>}
 */
function emittingRules(alternativesByRule) {
  const emitting = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, alternatives] of alternativesByRule) {
      if (emitting.has(name)) continue;
      if (alternatives.some((alternative) => alternativeEmits(alternative, emitting))) {
        emitting.add(name);
        changed = true;
      }
    }
  }
  return emitting;
}

/**
 * An alternative's emission items, less those naming captures it lacks
 * (engine §3.6).
 * @param {StitchedAlternative} alternative
 * @returns {import("./types.js").EmitItem[]}
 */
function effectiveItems(alternative) {
  const captured = new Set(topItems(alternative.expr).flatMap((item) => ("capture" in item ? [item.capture] : [])));
  return (alternative.clauses.emit ? alternative.clauses.emit.items : [])
    .filter((item) => item.capture === undefined || item.capture === "" || captured.has(item.capture));
}

/**
 * Which rules could lie inside an emitted token, where what they read is
 * part of the token's phonemes unless they are erased (engine §5): those
 * under a part emitted as a token, through everything not erased.
 * @param {Map<string, StitchedAlternative[]>} alternativesByRule
 * @returns {Set<string>}
 */
function soundingRules(alternativesByRule) {
  const inside = new Set();
  /** @type {string[]} */
  const pending = [];
  /** @type {(part: Expr) => void} */
  const reach = (part) => {
    /** @type {Set<string>} */
    const found = new Set();
    referencedRules(part, found);
    for (const name of found) {
      if (!inside.has(name)) {
        inside.add(name);
        pending.push(name);
      }
    }
  };
  /** @type {(alternative: StitchedAlternative, all: boolean) => void} */
  const reachParts = (alternative, all) => {
    const items = effectiveItems(alternative);
    if (items.length > 0 && items[0].capture === "") {
      // A token whose tags name its phoneme sounds as that phoneme, whatever
      // lies under it (engine §5).
      const fixed = items.every((item) => namesPhoneme(effectiveTerm(item.tags, alternative) || effectiveTerm(alternative.tags || alternative.clauses.tags, alternative)));
      // Inside a token an ancestor emits, the ancestor's phonemes come from
      // what lies under it, whatever this token's tags say.
      if (!items[0].erase && (all || !fixed)) topItems(alternative.expr).forEach(reach);
      return;
    }
    const erased = new Set(items.flatMap((item) => (item.erase && item.capture ? [item.capture] : [])));
    const emitted = new Set(items.flatMap((item) => (!item.erase && item.capture ? [item.capture] : [])));
    const fixed = new Set(items.flatMap((item) => (!item.erase && item.capture && namesPhoneme(effectiveTerm(item.tags, alternative)) ? [item.capture] : [])));
    for (const part of topItems(alternative.expr)) {
      const name = "capture" in part ? part.capture : null;
      if (name !== null && (erased.has(name) || (!all && fixed.has(name)))) continue;
      if (all || (name !== null && emitted.has(name))) reach(part);
    }
  };
  for (const alternatives of alternativesByRule.values()) for (const alternative of alternatives) reachParts(alternative, false);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    for (const alternative of alternativesByRule.get(name) || []) reachParts(alternative, true);
  }
  return inside;
}

/**
 * A tag term as it applies to an alternative: none if it names a capture
 * the alternative lacks, since lowering then drops it (engine §3.6).
 * @param {Term | undefined} term
 * @param {StitchedAlternative} alternative
 * @returns {Term | undefined}
 */
function effectiveTerm(term, alternative) {
  if (!term) return undefined;
  const captured = new Set(["", ...topItems(alternative.expr).flatMap((item) => ("capture" in item ? [item.capture] : []))]);
  return termVariables(term).every((name) => captured.has(name)) ? term : undefined;
}

/**
 * Whether a tag term certainly holds a strong phoneme tag, which fixes the
 * phonemes of a token it tags (engine §5).
 * @param {Term | undefined} term
 * @returns {boolean}
 */
function namesPhoneme(term) {
  if (!term) return false;
  if ("literal" in term) return [...term.literal].length === 3 && term.literal.startsWith("/") && term.literal.endsWith("/");
  if ("union" in term) return term.union.some(namesPhoneme);
  return false;
}

/**
 * Whether an alternative could emit a token, given the rules that could.
 * @param {StitchedAlternative} alternative
 * @param {Set<string>} emitting
 * @returns {boolean}
 */
function alternativeEmits(alternative, emitting) {
  const top = topItems(alternative.expr);
  const items = effectiveItems(alternative);
  if (items.length > 0 && items[0].capture === "") return !items[0].erase;
  if (items.some((item) => item.insert !== undefined || (item.capture !== undefined && !item.erase))) return true;
  const erased = new Set(items.flatMap((item) => (item.erase && item.capture ? [item.capture] : [])));
  /** @type {Set<string>} */
  const walked = new Set();
  for (const item of top) if (!("capture" in item && erased.has(item.capture))) referencedRules(item, walked);
  return [...walked].some((name) => emitting.has(name));
}

/**
 * What a grammar author should know about a dialect's grammars: per stage,
 * the rules nothing reaches, every rule a later document replaced or
 * extended, and conditions that never apply.
 * @param {Dialect} dialect
 * @returns {StageAudit[]}
 */
export function audit(dialect) {
  return dialect.stages.map((stage) => {
    const grammar = stage.grammar;
    const resolution = grammar.resolution;
    const reachable = new Set(["text"]);
    const pending = ["text"];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const rule = grammar.rules.get(name);
      if (!rule) continue;
      const found = new Set();
      for (const alternative of rule.alternatives) {
        referencedRules(alternative.expr, found);
        // Rules named in clauses count only where the clause applies to the
        // alternative: a condition that names a capture the alternative
        // lacks never runs for it (engine §3.6).
        const top = "seq" in alternative.expr ? alternative.expr.seq : [alternative.expr];
        const captured = new Set(["", ...top.flatMap((item) => ("capture" in item ? [item.capture] : []))]);
        /** @type {(clause: unknown) => boolean} */
        const applies = (clause) => termVariables(/** @type {Condition} */ (clause)).every((variable) => captured.has(variable));
        const clauses = alternative.clauses;
        // An alternative's own tags replace the rule's (engine §3.6).
        const tags = alternative.tags || clauses.tags;
        namedRules([tags, clauses.emit, ...clauses.conditions].filter((clause) => clause && applies(clause)), found);
      }
      for (const next of found) {
        if (!reachable.has(next) && grammar.rules.has(next)) {
          reachable.add(next);
          pending.push(next);
        }
      }
    }
    /** @type {{rule: string, document: string, condition: string}[]} */
    const idleConditions = [];
    for (const rule of grammar.rules.values()) {
      /** @type {Map<object, StitchedAlternative[]>} */
      const byDefinition = new Map();
      for (const alternative of rule.alternatives) {
        if (!byDefinition.has(alternative.clauses)) byDefinition.set(alternative.clauses, []);
        /** @type {StitchedAlternative[]} */ (byDefinition.get(alternative.clauses)).push(alternative);
      }
      for (const [clauses, alternatives] of byDefinition) {
        const captured = alternatives.map((alternative) => {
          const top = "seq" in alternative.expr ? alternative.expr.seq : [alternative.expr];
          return new Set(["", ...top.flatMap((item) => ("capture" in item ? [item.capture] : []))]);
        });
        for (const condition of /** @type {{conditions: Condition[]}} */ (clauses).conditions) {
          const needs = termVariables(condition);
          if (!captured.some((names) => needs.every((name) => names.has(name)))) {
            idleConditions.push({ rule: rule.name, document: alternatives[0].document, condition: formatCondition(condition) });
          }
        }
      }
    }
    // An erasure says nothing if what it erases could never emit and never
    // lies inside an emitted token, whose phonemes it would leave out
    // (engine §5, §11).
    const byRule = new Map([...grammar.rules].map(([name, rule]) => [name, rule.alternatives]));
    const emitting = emittingRules(byRule);
    const sounding = soundingRules(byRule);
    /** @type {{rule: string, document: string, erased: string}[]} */
    const idleErasures = [];
    /** @type {Set<object>} */
    const seen = new Set();
    for (const rule of grammar.rules.values()) {
      for (const alternative of rule.alternatives) {
        const emit = alternative.clauses.emit;
        if (!emit || seen.has(alternative.clauses)) continue;
        const siblings = rule.alternatives.filter((other) => other.clauses === alternative.clauses);
        seen.add(alternative.clauses);
        for (const item of emit.items) {
          if (!item.erase || item.capture === undefined) continue;
          /** @type {Set<string>} */
          const reached = new Set();
          for (const sibling of siblings) {
            for (const part of topItems(sibling.expr)) {
              if (item.capture === "" || ("capture" in part && part.capture === item.capture)) referencedRules(part, reached);
            }
          }
          if (!sounding.has(rule.name) && ![...reached].some((name) => emitting.has(name))) {
            idleErasures.push({ rule: rule.name, document: alternative.document, erased: item.capture === "" ? "$" : `$${item.capture}` });
          }
        }
      }
    }
    return {
      name: stage.name,
      resolution: resolution ? `${resolution.lean}${resolution.elisionOnly ? " elision-only" : ""}` : "none",
      rules: grammar.rules.size,
      unreachable: [...grammar.rules.keys()].filter((name) => !reachable.has(name)).sort(compareCodePoints),
      changes: grammar.changes.slice(),
      idleConditions,
      idleErasures,
    };
  });
}

/**
 * An audit as text.
 * @param {StageAudit[]} stages
 * @returns {string}
 */
export function formatAudit(stages) {
  const blocks = [];
  for (const stage of stages) {
    const lines = [`${stage.name}: ${stage.rules} rules, ${stage.resolution}`];
    if (stage.unreachable.length) lines.push(`  unreachable from text: ${stage.unreachable.join(", ")}`);
    for (const change of stage.changes) lines.push(`  ${change.rule} ${change.kind} by ${change.document} (defined in ${change.previous})`);
    for (const idle of stage.idleConditions) lines.push(`  a condition of ${idle.rule} in ${idle.document} applies to no alternative: ${idle.condition}`);
    for (const idle of stage.idleErasures) lines.push(`  ${idle.rule} in ${idle.document} erases ${idle.erased}, which could never emit anything or sound inside a token`);
    if (lines.length === 1) lines.push("  nothing to report");
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

// ---- Trace ---------------------------------------------------------------

/**
 * @typedef {object} Trace
 * @property {string} stage
 * @property {number} position the position between input tokens traced
 * @property {Token[]} tokens the stage's input
 * @property {TraceEvent[]} events
 * @property {{terminal: string, rules: string[]}[]} expected terminals items at the position could read
 */

/**
 * What one stage's recognizer did at one position of its input: which items
 * it predicted, advanced and completed there, and which advances a
 * condition refused, with the condition. This is the tool for "why does my
 * grammar not accept this text here".
 * @param {Dialect} dialect
 * @param {string} text
 * @param {{stage: string, position: number, features?: Iterable<string>, autoFeatures?: boolean}} options
 * @returns {Trace}
 */
export function trace(dialect, text, options) {
  const index = dialect.stages.findIndex((stage) => stage.name === options.stage);
  if (index < 0) throw new GencmuError("usage", `no stage is named ${options.stage}`);
  // The parse the caller would get up to that stage, so that the traced
  // stage reads the same tokens under the same features, auto features
  // included.
  const run = dialect.parse(text, { features: options.features, autoFeatures: options.autoFeatures, until: options.stage });
  const report = run.stages[index];
  if (!report || !report.input) throw new GencmuError("usage", `the ${options.stage} stage is not reached: ${explainError(run)}`);
  const tokens = report.input;
  const features = new Set(run.features);
  const stage = dialect.stages[index];
  const lowered = stage.grammar.lower(features, false);
  const context = new ParseContext(lowered, tokens, [...text], dialect.loader.unicode);
  const position = Math.max(0, Math.min(options.position, tokens.length));
  context.trace = { position, events: [], depth: 0 };
  const chart = recognize(context, "text", 0, tokens.length);
  return { stage: stage.name, position, tokens, events: context.trace.events, expected: expectedAt(chart, position) };
}

/**
 * A trace as text.
 * @param {Trace} traced
 * @returns {string}
 */
export function formatTrace(traced) {
  const { tokens, position } = traced;
  const before = position > 0 ? quoted(tokens[position - 1].text) : "the start";
  const after = position < tokens.length ? quoted(tokens[position].text) : "the end";
  const lines = [`The ${traced.stage} stage at position ${position}, after ${before} and before ${after}:`];
  const order = ["completed", "advanced", "predicted", "dropped"];
  for (const kind of order) {
    // An optional's or a repetition's empty step is noise here.
    const events = traced.events.filter((event) => event.kind === kind &&
      !(kind === "completed" && event.production.helper && event.production.rhs.length === 0));
    if (!events.length) continue;
    lines.push(`${kind}:`);
    for (const event of events) {
      const item = formatItem(event.production, event.kind === "dropped" ? event.dot + 1 : event.dot);
      const span = event.kind === "dropped" ? "" : `  [${event.origin}..${position}]`;
      lines.push(`  ${item}${span}${event.condition ? `\n      refused: ${formatCondition(event.condition)}` : ""}`);
    }
  }
  if (traced.expected.length) {
    lines.push("could read next:");
    for (const expectation of traced.expected) lines.push(`  ${expectation.terminal} (${expectation.rules.join(", ")})`);
  } else {
    lines.push("could read nothing next");
  }
  return lines.join("\n");
}
