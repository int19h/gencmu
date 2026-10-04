// Diagnostics for people: what went wrong with a text or a grammar, said in
// the grammar's own terms. The CLI and the playground print these; nothing
// here changes what a parse computes.

import { GencmuError } from "./errors.js";
import { ParseContext, recognize, expectedAt, writtenSymbol } from "./earley.js";
import { attachmentText, nodeBrackets, nodeTree } from "./output.js";
import { compareCodePoints, isPhonemeTag } from "./tags.js";
import { simplify, capturesUsed, DOM_TRUE } from "./dom.js";

/**
 * @import { WitnessAction, Condition, Expr, ParseResult, ResultNode, Span, StageReport, TagSet, Term, Argument, Production } from "./types.js"
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
  } else if (error.kind === "ambiguous" && error.reason === "tie") {
    // A tie is explained where its two readings first differ.
    const report = result.stages.find((stage) => stage.name === error.stage);
    if (report) return explainTies({ text: result.text, stages: [report] });
    lines.push(`The ${error.stage} stage's text is ambiguous: it has two best readings, a tie.`);
  } else if (error.kind === "ambiguous") {
    const report = result.stages.find((stage) => stage.name === error.stage);
    const tokens = (report && report.input) || [];
    lines.push(`The ${error.stage} stage's text is ambiguous even with every elided terminator written out,`);
    lines.push("so the ambiguity is not about terminators (elision-only). Two readings:");
    for (const reading of error.readings || []) lines.push("  " + nodeBrackets(reading, tokens, { showElided: true }));
    // Two readings can show the same brackets, so the witness says where
    // they first differ (engine §7.10).
    if (error.witness) {
      lines.push("They first differ where:");
      lines.push(`  the first reading ${describeAction(error.witness[0], tokens)}`);
      lines.push(`  the second reading ${describeAction(error.witness[1], tokens)}`);
    }
  } else {
    const where = error.document ? `${error.document}${error.line ? `:${error.line}:${error.column}` : ""}: ` : "";
    lines.push(`A grammar error${error.stage ? ` in the ${error.stage} stage` : ""}: ${where}${error.message}`);
  }
  return lines.join("\n");
}

// ---- Ties ----------------------------------------------------------------

/**
 * @param {WitnessAction} action
 * @param {Token[]} tokens
 * @returns {string}
 */
function describeAction(action, tokens) {
  if (action.kind === "read") return `reads ${quoted(tokens[action.token] ? tokens[action.token].text : "")} as ${action.terminal}`;
  if (action.kind === "elided") return `reads the ${action.terminal} written back at position ${action.at}`;
  const rule = action.helper ? `part of ${action.rule}` : action.rule;
  return `closes ${rule} over tokens ${action.span[0]} to ${action.span[1]}`;
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
 * The tie of a result explained: where its two readings first differ, both
 * readings as brackets, and both trees side by side. A tie ends the run, so
 * at most one stage has one. Empty when no stage ties.
 * @param {{text: string, stages: StageReport[]}} result
 * @returns {string}
 */
export function explainTies(result) {
  const blocks = [];
  for (const stage of result.stages) {
    if (stage.verdict !== "tie") continue;
    const tokens = stage.input || [];
    const [first, second] = stage.witness;
    // A tie in a stage has no written-back terminator, so its actions are
    // reads and closes.
    const at = first.kind === "read" ? first.token : first.kind === "close" ? first.span[1] : 0;
    const lines = [`The ${stage.name} stage is ambiguous: its grammar reads the text in two ways, and no rule ranks one above the other.`,
      "They first differ here:"];
    if (tokens.length) {
      const token = tokens[Math.min(at, tokens.length - 1)];
      /** @type {Span} */
      const source = at < tokens.length ? token.source : [token.source[1], token.source[1]];
      lines.push(sourceExcerpt(result.text, source).excerpt);
    }
    lines.push(`  the first reading ${describeAction(first, tokens)}`);
    lines.push(`  the second reading ${describeAction(second, tokens)}`);
    // The readings are in the stage's error (engine §6).
    const readings = stage.error && stage.error.readings;
    if (readings && readings.length === 2) {
      lines.push(`  first:  ${nodeBrackets(readings[0], tokens, { showElided: true })}`);
      lines.push(`  second: ${nodeBrackets(readings[1], tokens, { showElided: true })}`);
      lines.push("");
      lines.push(sideBySide(nodeTree(readings[0], tokens, result.text), nodeTree(readings[1], tokens, result.text), "first", "second"));
    }
    lines.push("The grammar must say which reading it means. Until it does, the text is an error.");
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * Each warning of a result (engine §12) as the feature it names and an
 * excerpt of the text the warned constituent covers.
 * @param {ParseResult} result
 * @returns {string}
 */
export function explainWarnings(result) {
  return (result.warnings || []).map((warning) => [
    `Warning: the ${warning.stage} stage read this with the feature ${warning.feature}, in the rule ${warning.rule}:`,
    sourceExcerpt(result.text, warning.source).excerpt,
  ].join("\n")).join("\n\n");
}

// ---- Tokens --------------------------------------------------------------

/**
 * @param {TagSet} tags
 * @returns {string}
 */
function tagList(tags) {
  return [...tags].sort(compareCodePoints).join(" ");
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
    const rows = stage.output.map((token, index) => [String(index), quoted(token.text), quoted(token.phonemes || ""), quoted(token.label),
      `${token.span[0]}-${token.span[1]}`, `${token.source[0]}-${token.source[1]}`, tagList(token.tags) + (token.insertedBy ? `  (inserted by ${token.insertedBy})` : "") +
        (attachmentText(token) ? `  (attached: ${attachmentText(token)})` : "")]);
    const header = ["#", "text", "phonemes", "label", "span", "source", "tags"];
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
  if ("classifier" in term) return term.classifier;
  if ("string" in term) return quoted(term.string);
  // An identifier tag is a bare name with a capital, or ~name; a phoneme
  // or character tag is written as it is.
  if ("tag" in term) return /^[a-z]/.test(term.tag) ? `~${term.tag}` : term.tag;
  if ("range" in term) return `${term.range[0]}..${term.range[1]}`;
  if ("emptySet" in term) return "∅";
  if ("const" in term) return `$${term.const}`;
  /** @type {(item: Term) => string} */
  const grouped = (item) => ("union" in item || "difference" in item ? `(${formatTerm(item)})` : formatTerm(item));
  if ("union" in term) return term.union.map((item, index) => (index > 0 && "difference" in item ? grouped(item) : formatTerm(item))).join(" ∪ ");
  if ("difference" in term) return `${formatTerm(term.difference[0])} ∖ ${grouped(term.difference[1])}`;
  if ("intersection" in term) return term.intersection.map(grouped).join(" ∩ ");
  if ("call" in term) return `${term.call}(${term.args.map(formatTerm).join(", ")})`;
  if ("if" in term) return `(${formatCondition(term.if)} ⟹ ${formatTerm(term.then)})`;
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
  if ("captured" in condition) return `$${condition.captured}`;
  if ("if" in condition) return `(${formatCondition(condition.if)} ⟹ ${formatCondition(/** @type {Condition} */ (condition.then))})`;
  if ("matches" in condition) return `matches(${formatTerm(condition.matches)}, ${condition.rule})`;
  if ("begins" in condition) return `begins(${formatTerm(condition.begins)}, ${condition.rule})`;
  if ("initial" in condition) return `initial(${formatTerm(condition.initial)})`;
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
    const name = symbol.name.includes("·") ? `‹${symbol.name.split("·")[0]} part›` : writtenSymbol(symbol);
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
    else if ("seq" in current) for (const item of current.seq) stack.push(item);
    else if ("choice" in current) for (const item of current.choice) stack.push(item);
    else if ("and" in current) for (const item of current.and) stack.push(item);
    else if ("optional" in current) stack.push(current.optional);
    else if ("repeat" in current) {
      stack.push(current.repeat);
      if (current.separator !== undefined) stack.push(current.separator);
    }
    else if ("capture" in current || "test" in current) stack.push(current.expr);
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
 * @property {{rule: string, document: string}[]} idleErasures rules that emit `ε` although nothing
 *   under them could emit and no token could cover them
 * @property {Membership[]} memberships every membership of a key in a class
 *   that an entry of a classifier adds or removes, in the order of the
 *   first entry that touches it
 */

/**
 * Where the entries of a classifier add and remove one membership of a key
 * in a class, whatever the features (engine §2).
 * @typedef {object} Membership
 * @property {string} classifier
 * @property {string} key
 * @property {string} class
 * @property {{op: "∈" | "∉", gates: string, document: string, line: number, column: number}[]} changes
 *   each entry that adds (`∈`) or removes (`∉`) it, in stitching order, with
 *   its gates as written
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
 * Whether an alternative has a capture; every alternative has `$`.
 * @param {StitchedAlternative} alternative
 * @returns {(name: string) => boolean}
 */
function capturesOf(alternative) {
  const captured = new Set(["", ...topItems(alternative.expr).flatMap((item) => ("capture" in item ? [item.capture] : []))]);
  return (name) => captured.has(name);
}

/**
 * An alternative's emission items, less those naming captures it lacks
 * (engine §3.6), with their tag terms simplified for it.
 * @param {StitchedAlternative} alternative
 * @returns {import("./types.js").EmitItem[]}
 */
function effectiveItems(alternative) {
  const has = capturesOf(alternative);
  return (alternative.clauses.emit ? alternative.clauses.emit.items : [])
    .filter((item) => item.capture === undefined || has(item.capture))
    .map((item) => (item.tags ? { ...item, tags: simplify(item.tags, has) } : item));
}

/**
 * The tag terms of an alternative's constituent, simplified for it: its own
 * and its definition's %tags (engine §3.7).
 * @param {StitchedAlternative} alternative
 * @returns {Term[]}
 */
function constituentTerms(alternative) {
  const has = capturesOf(alternative);
  return [alternative.tags, alternative.clauses.tags].filter((term) => term !== undefined).map((term) => simplify(term, has));
}

/**
 * Which rules of a stage could emit a token (engine §11): one with an
 * alternative whose emission lists anything, or that
 * has no emission and walks a part that could.
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
 * Whether an alternative could emit a token, given the rules that could.
 * @param {StitchedAlternative} alternative
 * @param {Set<string>} emitting
 * @returns {boolean}
 */
function alternativeEmits(alternative, emitting) {
  if (alternative.clauses.emit) return effectiveItems(alternative).length > 0;
  /** @type {Set<string>} */
  const walked = new Set();
  for (const part of topItems(alternative.expr)) referencedRules(part, walked);
  return [...walked].some((name) => emitting.has(name));
}

/**
 * Which rules could sound inside an emitted token, where what they read is
 * part of the token's phonemes unless it does not count (engine §5): those
 * under a part emitted as a token whose tags do not name its phoneme, and
 * all that lies under them but what emits `ε`.
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
  // Where tokens are emitted: a token whose tags name its phoneme sounds as
  // that phoneme, whatever lies under it.
  for (const alternatives of alternativesByRule.values()) {
    for (const alternative of alternatives) {
      const items = effectiveItems(alternative);
      if (items.length > 0 && items[0].capture === "") {
        const fixed = items.every((item) => namesPhoneme(item.tags) || (!item.tags && constituentTerms(alternative).some(namesPhoneme)));
        if (!fixed) topItems(alternative.expr).forEach(reach);
        continue;
      }
      const emitted = new Set(items.flatMap((item) => (item.capture && !namesPhoneme(item.tags) ? [item.capture] : [])));
      for (const part of topItems(alternative.expr)) if ("capture" in part && emitted.has(part.capture)) reach(part);
    }
  }
  // Inside a token, everything counts but what emits `ε`, whatever any
  // token under it says of its own phonemes.
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    for (const alternative of alternativesByRule.get(name) || []) {
      const emit = alternative.clauses.emit;
      if (emit && emit.items.length === 0) continue;
      topItems(alternative.expr).forEach(reach);
    }
  }
  return inside;
}

/**
 * Whether a tag term certainly holds a phoneme tag, which fixes the
 * phonemes of a token it tags (engine §5).
 * @param {Term | undefined} term
 * @returns {boolean}
 */
function namesPhoneme(term) {
  if (!term) return false;
  if ("tag" in term) return isPhonemeTag(term.tag);
  if ("const" in term) return Boolean(term.value && "set" in term.value && [...term.value.set].some(isPhonemeTag));
  if ("union" in term) return term.union.some(namesPhoneme);
  return false;
}

/**
 * What a grammar author should know about a dialect's grammars: per stage,
 * the rules nothing reaches, every rule a later document replaced or
 * extended, and `%emits ε` that changes nothing.
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
        // alternative (engine §3.6).
        const has = capturesOf(alternative);
        const clauses = alternative.clauses;
        const conditions = clauses.conditions.map((condition) => simplify(condition, has))
          .filter((condition) => condition !== DOM_TRUE && capturesUsed(condition).every(has));
        namedRules([...constituentTerms(alternative), ...effectiveItems(alternative), ...conditions], found);
      }
      for (const next of found) {
        if (!reachable.has(next) && grammar.rules.has(next)) {
          reachable.add(next);
          pending.push(next);
        }
      }
    }
    // `%emits ε` says nothing if nothing under it could emit and no token
    // could cover it (engine §5, §11).
    const byRule = new Map([...grammar.rules].map(([name, rule]) => [name, rule.alternatives]));
    const emitting = emittingRules(byRule);
    const sounding = soundingRules(byRule);
    /** @type {{rule: string, document: string}[]} */
    const idleErasures = [];
    /** @type {Set<object>} */
    const seen = new Set();
    for (const rule of grammar.rules.values()) {
      for (const alternative of rule.alternatives) {
        const emit = alternative.clauses.emit;
        if (!emit || emit.items.length > 0 || seen.has(alternative.clauses)) continue;
        seen.add(alternative.clauses);
        /** @type {Set<string>} */
        const reached = new Set();
        for (const sibling of rule.alternatives.filter((other) => other.clauses === alternative.clauses)) {
          for (const part of topItems(sibling.expr)) referencedRules(part, reached);
        }
        if (!sounding.has(rule.name) && ![...reached].some((name) => emitting.has(name))) {
          idleErasures.push({ rule: rule.name, document: alternative.document });
        }
      }
    }
    // Where each membership of each classifier is added and removed.
    /** @type {Map<string, Membership>} */
    const memberships = new Map();
    for (const { path, classifier } of grammar.classifierItems) {
      for (const entry of classifier.entries) {
        const gates = entry.guards.map((guard) => `${guard.negated ? "¬" : ""}${guard.feature}?`).join(" ");
        for (const key of entry.keys) {
          const id = JSON.stringify([classifier.name, key, entry.class]);
          let membership = memberships.get(id);
          if (!membership) memberships.set(id, (membership = { classifier: classifier.name, key, class: entry.class, changes: [] }));
          membership.changes.push({ op: entry.op, gates, document: path, line: entry.at[0], column: entry.at[1] });
        }
      }
    }
    return {
      name: stage.name,
      resolution: resolution ? `${resolution.lean}${resolution.elisionOnly ? " elision-only" : ""}${resolution.maximal ? " maximal" : ""}` : "none",
      rules: grammar.rules.size,
      unreachable: [...grammar.rules.keys()].filter((name) => !reachable.has(name)).sort(compareCodePoints),
      changes: grammar.changes.slice(),
      idleErasures,
      memberships: [...memberships.values()],
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
    for (const idle of stage.idleErasures) lines.push(`  ${idle.rule} in ${idle.document} emits ε, although nothing under it could emit and no token could cover it`);
    // A classifier: how many memberships its entries make, and each one that
    // a gate guards or that more than one entry touches, with every place
    // that adds or removes it.
    /** @type {Map<string, Membership[]>} */
    const byClassifier = new Map();
    for (const membership of stage.memberships) {
      let list = byClassifier.get(membership.classifier);
      if (!list) byClassifier.set(membership.classifier, (list = []));
      list.push(membership);
    }
    for (const [name, list] of byClassifier) {
      const keys = new Set(list.map((membership) => membership.key)).size;
      lines.push(`  classifier ${name}: ${list.length} memberships of ${keys} keys`);
      for (const membership of list) {
        if (membership.changes.length === 1 && membership.changes[0].gates === "") continue;
        const places = membership.changes.map((change) =>
          `${change.op === "∈" ? "added" : "removed"} ${change.gates ? `under ${change.gates} ` : ""}at ${change.document}:${change.line}:${change.column}`);
        lines.push(`    ${JSON.stringify(membership.key)} ${membership.class}: ${places.join(", ")}`);
      }
    }
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
 * @param {{stage: string, position: number, features?: Iterable<string>, withoutFeatures?: Iterable<string>, autoFeatures?: boolean}} options
 * @returns {Trace}
 */
export function trace(dialect, text, options) {
  const index = dialect.stages.findIndex((stage) => stage.name === options.stage);
  if (index < 0) throw new GencmuError("usage", `no stage is named ${options.stage}`);
  // The parse the caller would get up to that stage, so that the traced
  // stage reads the same tokens under the same features, auto features
  // included.
  const run = dialect.parse(text, { features: options.features, withoutFeatures: options.withoutFeatures, autoFeatures: options.autoFeatures, until: options.stage });
  const report = run.stages[index];
  if (!report || !report.input) throw new GencmuError("usage", `the ${options.stage} stage is not reached: ${explainError(run)}`);
  const tokens = report.input;
  const features = new Set(run.features);
  const stage = dialect.stages[index];
  const lowered = stage.grammar.lower(features);
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
      const refused = event.test !== undefined ? `\n      refused: the test of ${writtenSymbol(event.production.rhs[event.dot])} does not hold of what it spans`
        : event.condition ? `\n      refused: ${formatCondition(event.condition)}` : "";
      lines.push(`  ${item}${span}${refused}`);
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
