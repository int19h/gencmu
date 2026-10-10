// Dialects: loading pipeline documents and their grammars, reading grammar
// documents with the notation dialect (engine §8), and running a text
// through the stages (engine §13).

import { GencmuError } from "./errors.js";
import { Grammar } from "./grammar.js";
import { Stage } from "./stage.js";
import { treeToDom } from "./reader.js";
import { extractGrammarText } from "./markdown.js";
import { splicePipeline } from "./pipeline.js";
import { characterTokens, Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
import { someNode } from "./walk.js";
import { compareCodePoints, isName } from "./tags.js";
import { domProblem, isDom, DOM_FORMAT, DOM_MAX_DEPTH } from "./dom.js";
import { WorkBudget } from "./testing.js";
import { restoreRankedLocations, rankedSyntaxFailure } from "./ranked.js";

/** @import { Feature, GrammarDom, ParseError, ParseOptions, ParseResult, Resources, ResultNode, StageReport } from "./types.js" */


/**
 * A precompiled document of compiled.json.
 * @typedef {{hash: string, dom: GrammarDom}} CompiledEntry
 */

/**
 * The options one run of the stages takes.
 * @typedef {object} RunOptions
 * @property {Set<string>} features
 * @property {string} [until]
 * @property {boolean | null} [elisionOnly]
 * @property {Token[]} [tokens]
 */

// Resources: a function from a path relative to the grammars root to its
// text, or undefined. The bundled grammars, a directory on disk and a map
// held in memory are all resources.
export class Loader {
  /** @param {Resources} read */
  constructor(read) {
    this.read = read;
    this.unicode = new UnicodeTable(this.need("unicode.txt"));
    try {
      const bootstrapText = this.need("notation/bootstrap.json");
      const bootstrap = readBootstrap(bootstrapText, this.unicode);
      this.bootstrapHash = fnv1a64(bootstrapText);
      this.notation = new Dialect("dialects/notation.md", bootstrap.stages.map((stage) => {
        try {
          return new Stage(stage.name, new Grammar(stage.name, stage.documents.map((document) => ({ path: document.path, dom: document.dom })), this.unicode));
        } catch (error) {
          if (error instanceof GencmuError) error.where.stage = stage.name;
          throw error;
        }
      }), this);
      for (const stage of this.notation.stages) stage.grammar.lower(new Set());
    } catch (error) {
      if (error instanceof GencmuError) {
        const embedded = error.where.document;
        if (embedded && embedded !== "notation/bootstrap.json" && !error.message.includes(embedded)) {
          error.message += ` (embedded document: ${embedded})`;
        }
        error.where.document = "notation/bootstrap.json";
        const location = [error.where.document, error.where.line, error.where.column].filter((part) => part !== undefined).join(":");
        if (!error.message.startsWith(`${location}: `)) {
          const stage = error.where.stage ? `stage ${error.where.stage}: ` : "";
          error.message = `${location}: ${stage}${error.message}`;
        }
      }
      throw error;
    }
    /** @type {Map<string, CompiledEntry>} */
    this.compiled = new Map();
    // Precompiled DOMs are a cache: one that cannot be read, or an entry
    // that is not a DOM, is a miss, and the document is read instead.
    const compiled = this.read("compiled.json");
    if (compiled !== undefined) {
      let data;
      try {
        data = JSON.parse(compiled);
      } catch {
        data = null;
      }
      if (data && data.format === DOM_FORMAT && data.bootstrap === this.bootstrapHash && data.documents && typeof data.documents === "object") {
        for (const [path, entry] of Object.entries(data.documents)) {
          if (entry && typeof entry.hash === "string" && isDom(entry.dom, this.unicode)) this.compiled.set(path, entry);
        }
      }
    }
    /** @type {Map<string, GrammarDom>} */
    this.cache = new Map();
  }

  /**
   * A resource's text, or a grammar error when it is missing.
   * @param {string} path
   * @returns {string}
   */
  need(path) {
    let text;
    try { text = this.read(path); } catch (error) {
      if (path !== "notation/bootstrap.json" || error instanceof GencmuError) throw error;
      throw new GencmuError("grammar", `cannot read the bootstrap: ${error instanceof Error ? error.message : String(error)}`, { document: path }, { cause: error });
    }
    if (text === undefined) throw new GencmuError("grammar", `${path} was not found`, { document: path });
    return text;
  }

  /**
   * The DOM of a grammar document, from the cache when its text, the
   * bootstrap and the format all match, else read with the notation.
   * @param {string} path
   * @returns {GrammarDom}
   */
  documentDom(path) {
    const text = this.need(path);
    // A document is a sequence of scalar values, as a text is (engine §1).
    const surrogate = loneSurrogate(text);
    if (surrogate !== null) {
      throw new GencmuError("usage", `${path}: the document is not a sequence of Unicode scalar values: a lone surrogate U+${surrogate.code.toString(16).toUpperCase()} at code point ${surrogate.at}`, { document: path });
    }
    const hash = fnv1a64(text);
    const key = `${path}\u0000${hash}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const entry = this.compiled.get(path);
    let dom;
    if (entry && entry.hash === hash) {
      dom = entry.dom;
    }
    else dom = this.readDocument(text, path, true);
    this.cache.set(key, dom);
    return dom;
  }

  /**
   * Reads a grammar document's Markdown into its DOM with the notation.
   * @param {string} markdown
   * @param {string} path
   * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
   * @returns {GrammarDom}
   */
  readDocument(markdown, path, deferEmission = false) {
    const { text, positions } = extractGrammarText(markdown, path);
    const run = this.notation.parse(text, { features: new Set() });
    const retired = run.stages[0]?.output?.find(token => token.text === "%prefer");
    if (retired) {
      const [line,column] = positions[retired.source[0]] ?? [1,1];
      throw new GencmuError("grammar", `${path}:${line}:${column}: unknown directive %prefer; use an inline ranked choice (a ≻ b).`, {document:path,line,column});
    }
    /** @type {(token: Token) => import("./types.js").Position} */
    const positionOf = (token) => positions[token.source[0]] || positions[positions.length - 1] || [1, 1];
    if (!run.ok) {
      const error = /** @type {ParseError} */ (run.error);
      // An ambiguity has no single position, so it names the document
      // alone (engine §8).
      if (error.kind === "ambiguous") {
        throw new GencmuError("grammar", `${path}: the grammar text is ambiguous: the ${error.stage} stage of the notation reads it in two ways`, { document: path });
      }
      const source = error.source || [0, 0];
      const [line, column] = positions[source[0]] || (positions.length ? positions[positions.length - 1] : [1, 1]);
      const ranked = error.stage === "syntax" && rankedSyntaxFailure(/** @type {Token[]} */ (run.stages[0].output),error.token ?? 0);
      const message = ranked ? "Parenthesize the intended ranked choice, with at least two operands and one separator kind." : error.message;
      throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column, ...(ranked ? {code:"ranked-choice-syntax"} : {}) });
    }
    const syntax = run.stages[run.stages.length - 1];
    return domOfTree(/** @type {ResultNode} */ (syntax.tree), syntax.input || [], positionOf, path, this.unicode, deferEmission);
  }

  /**
   * A dialect from its pipeline document's path.
   * @param {string} path
   * @returns {Dialect}
   */
  dialect(path) {
    const pipeline = this.pipeline(path);
    const build = () => {
      const stages = pipeline.stages.map((stage) => new Stage(stage.name, new Grammar(stage.name, stage.documents, this.unicode), stage.changes));
      return new Dialect(path, stages, this, pipeline.features);
    };
    try { return build(); } catch (error) {
      if (!(error instanceof GencmuError) || !error.code?.startsWith("ranked-choice-") || !error.group?.document || error.group.at) throw error;
      // Only a diagnostic needs locations absent from a cached DOM.
      const document = error.group.document;
      const text = this.need(document);
      const dom = this.documentDom(document);
      const {text:body,positions} = extractGrammarText(text,document);
      const lexical = this.notation.parse(body,{features:new Set(),until:"lexical"});
      if (lexical.ok) restoreRankedLocations(dom,/** @type {Token[]} */ (lexical.stages[0].output),token => positions[token.source[0]] ?? [1,1]);
      // Rebuild from the same written DOMs to retain every diagnostic field.
      return build();
    }
  }

  /**
   * The stages of the pipeline document at `path`, each a list of runs of
   * one document's items, and the features the pipeline turns on (engine
   * §13).
   * @param {string} path
   * @returns {{stages: import("./pipeline.js").SplicedStage[], features: string[]}}
   */
  pipeline(path) {
    return splicePipeline(path, (documentPath) => (this.read(documentPath) === undefined ? undefined : this.documentDom(documentPath)));
  }
}

/**
 * A dialect's features (engine §13): every name a guard of any stage uses,
 * and every name the pipeline's `%features` declares, in code point
 * order. A name used both as a gate and as a warning is an error of the
 * dialect.
 * @param {string} path
 * @param {Stage[]} stages
 * @param {string[]} declared
 * @returns {Feature[]}
 */
function dialectFeatures(path, stages, declared) {
  /** @type {Map<string, "gate" | "warning">} */
  const kinds = new Map();
  for (const stage of stages) {
    // The guards of the stitched rules, and the gates of every classifier's
    // entries (engine §13).
    const guards = [...stage.grammar.rules.values()].flatMap((rule) => rule.alternatives.flatMap((alternative) =>
      alternative.guards.map((guard) => ({ guard, where: { ...alternative.at, stage: stage.name } }))));
    for (const { path: document, classifier } of stage.grammar.classifierItems) for (const entry of classifier.entries) for (const guard of entry.guards) {
      guards.push({ guard, where: { document, line: entry.at[0], column: entry.at[1], stage: stage.name } });
    }
    for (const { guard, where } of guards) {
      const known = kinds.get(guard.feature);
      if (known !== undefined && known !== guard.kind) {
        throw new GencmuError("grammar", `${where.document}:${where.line}:${where.column}: the feature ${guard.feature} is used both as a gate and as a warning`, where);
      }
      kinds.set(guard.feature, guard.kind);
    }
  }
  const names = [...new Set([...kinds.keys(), ...declared])].sort(compareCodePoints);
  const defaults = new Set(declared);
  return names.map((name) => ({ name, kind: kinds.get(name) || "gate", default: defaults.has(name) }));
}

/**
 * The index of the last stage to run. Only an absent until runs every
 * stage. Any other value, "" and null among them, must name a stage, or it
 * is a usage error (engine §13).
 * @param {{name: string}[]} stages
 * @param {string | null | undefined} until
 * @returns {number}
 */
function lastStage(stages, until) {
  if (until === undefined) return stages.length - 1;
  const index = stages.findIndex((stage) => stage.name === until);
  if (index < 0) throw new GencmuError("usage", `no stage is named ${JSON.stringify(until)}`);
  return index;
}

export class Dialect {
  /**
   * @param {string} path
   * @param {Stage[]} stages
   * @param {Loader} loader
   * @param {string[]} [declared] the features the pipeline turns on
   */
  constructor(path, stages, loader, declared = []) {
    this.path = path;
    this.stages = stages;
    this.loader = loader;
    this.declared = declared;
    /** @type {Feature[]} the dialect's features, with their kinds and defaults */
    this.features = dialectFeatures(path, stages, declared);
  }

  /**
   * Parses a text.
   * @param {string} text
   * @param {ParseOptions} [options]
   * @returns {ParseResult}
   */
  parse(text, options = {}) {
    // A text is a sequence of scalar values, so a lone surrogate is the
    // caller's mistake, refused before any character token (engine §1).
    const surrogate = loneSurrogate(text);
    if (surrogate !== null) {
      throw new GencmuError("usage", `the text is not a sequence of Unicode scalar values: a lone surrogate U+${surrogate.code.toString(16).toUpperCase()} at code point ${surrogate.at}`);
    }
    // A token that the caller supplies has its text as its label (engine §5).
    // It has no attachments: a list that is not empty is the caller's
    // mistake, and an empty one is dropped (docs/api.md). The parse copies
    // each token, its tags and its positions, so the caller's objects stay
    // as they are, and the result shares none of them.
    if (options.tokens) {
      const length = [...text].length;
      options.tokens.forEach((token, index) => {
        if ((token.before && token.before.length > 0) || (token.after && token.after.length > 0)) {
          throw new GencmuError("usage", `token ${index} has attachments, which a caller cannot supply`);
        }
        // A source counts code points of the text, and must lie within it.
        // Sources can overlap or lie out of order (engine §11). A span
        // counts tokens of the stage before, so only its order is checked
        // (docs/api.md).
        const [start, end] = token.source;
        if (!(0 <= start && start <= end && end <= length)) {
          throw new GencmuError("usage", `token ${index}: the source ${JSON.stringify(token.source)} is not a range within a text of ${length} code points`);
        }
        if (token.span && !(0 <= token.span[0] && token.span[0] <= token.span[1])) {
          throw new GencmuError("usage", `token ${index}: the span ${JSON.stringify(token.span)} is not a range of tokens: it starts below 0 or ends before it starts`);
        }
      });
      options = { ...options, tokens: options.tokens.map((token) =>
        new Token(new Set(token.tags), [token.span[0], token.span[1]], [token.source[0], token.source[1]], token.text, token.phonemes, token.insertedBy)) };
    }
    // The features on are the pipeline's, with the caller's added and the
    // caller's turned off removed (engine §13).
    const on = [...(options.features || [])];
    const off = new Set(options.withoutFeatures || []);
    const both = on.find((name) => off.has(name));
    if (both !== undefined) throw new GencmuError("usage", `the feature ${both} is named both to turn on and to turn off`);
    let features = new Set([...this.declared, ...on].filter((name) => !off.has(name)));
    const wordsAt = this.stages.findIndex((stage) => stage.name === "words");
    const untilAt = lastStage(this.stages, options.until);
    // The probe is for a run that reaches the words stage (engine §13).
    // Only a dialect that has sa-su as a gate adds it by itself (engine §13).
    const gated = this.features.some((feature) => feature.name === "sa-su" && feature.kind === "gate");
    if (options.autoFeatures !== false && gated && !features.has("sa-su") && !off.has("sa-su") && wordsAt >= 0 && untilAt >= wordsAt) {
      const probe = this.run(text, { ...options, features, until: "words" }, null);
      const words = probe.stages[probe.stages.length - 1];
      const needs = !words || words.name !== "words" || words.error || containsEraser(words.tree);
      if (needs) features = new Set([...features, "sa-su"]);
      else if (options.until === "words") return probe;
      else return this.run(text, { ...options, features }, probe);
    }
    return this.run(text, { ...options, features }, null);
  }

  /**
   * Runs the stages, continuing a probe's stages where it stopped.
   * @param {string} text
   * @param {RunOptions} options
   * @param {ParseResult | null} continued
   * @returns {ParseResult}
   */
  run(text, options, continued) {
    const sourceText = [...text];
    /** @type {StageReport[]} */
    const stages = continued ? continued.stages.slice() : [];
    let tokens = options.tokens || characterTokens(text, this.loader.unicode);
    if (continued) tokens = /** @type {Token[]} */ (stages[stages.length - 1].output);
    const last = lastStage(this.stages, options.until);
    for (let index = stages.length; index <= last; index++) {
      const stage = this.stages[index];
      const report = stage.run(tokens, sourceText, this.loader.unicode, {
        features: options.features,
        elisionOnly: options.elisionOnly,
        last: index === this.stages.length - 1,
      });
      report.input = tokens;
      stages.push(report);
      if (report.error) break;
      tokens = /** @type {Token[]} */ (report.output);
    }
    ownTags(stages.slice(continued ? continued.stages.length : 0));
    const final = stages[stages.length - 1];
    const error = stages.find((stage) => stage.error);
    const result = {
      ok: !error && stages.length === last + 1,
      stages,
      tree: error ? null : final.tree,
      error: error ? locate(/** @type {ParseError} */ (error.error), text) : null,
      warnings: stages.flatMap((stage) => stage.warnings || []),
      text,
      features: [...options.features].sort(),
    };
    return result;
  }
}

/**
 * Gives every token and rule node of the stages a tag set of its own. A
 * stage can put a set that its grammar holds on a token or a node: the
 * value of a constant, the classes of a classifier or the tags of a range.
 * A caller's token can also bring its own set. So a caller that changes a
 * result changes no later parse, and a later change to the caller's set
 * does not change the result.
 * @param {StageReport[]} stages
 */
function ownTags(stages) {
  /** @type {Set<object>} */
  const seen = new Set();
  // An explicit stack, since a chain of attachments can be as deep as a
  // long text is long.
  /** @type {(first: import("./tokens.js").AttachedToken) => void} */
  const ownToken = (first) => {
    const stack = [first];
    for (let token = stack.pop(); token !== undefined; token = stack.pop()) {
      if (seen.has(token)) continue;
      seen.add(token);
      token.tags = new Set(token.tags);
      for (const attached of token.before) stack.push(attached);
      for (const attached of token.after) stack.push(attached);
    }
  };
  /** @type {(root: ResultNode) => void} */
  const ownTree = (root) => {
    const stack = [root];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      if (node.kind !== "rule" || seen.has(node)) continue;
      seen.add(node);
      node.tags = new Set(node.tags);
      for (const child of node.children) stack.push(child);
    }
  };
  for (const stage of stages) {
    if (stage.input) stage.input.forEach(ownToken);
    if (stage.output) stage.output.forEach(ownToken);
    if (stage.tree) ownTree(stage.tree);
    if (stage.error && stage.error.readings) stage.error.readings.forEach(ownTree);
  }
}

/**
 * Whether a tree has a constituent of the rule `word` whose tag set has SA
 * or SU (engine §13).
 * @param {ResultNode | null | undefined} tree
 * @returns {boolean}
 */
function containsEraser(tree) {
  if (!tree) return false;
  return someNode(tree, (node) => node.kind === "rule" && node.rule === "word" && (node.tags.has("SA") || node.tags.has("SU")));
}

/**
 * A document's DOM from the notation's syntax tree of it: the reader's DOM,
 * held to the rules of a precompiled DOM, or a grammar error at its place
 * (engine §9). The hand-written reader of tools/bootstrap-reader.js reads
 * its own tree with it too.
 * @param {ResultNode} tree
 * @param {Token[]} tokens the syntax stage's input tokens
 * @param {(token: Token) => import("./types.js").Position} positionOf
 * @param {string} path
 * @param {UnicodeTable} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {GrammarDom}
 */
export function domOfTree(tree, tokens, positionOf, path, unicode, deferEmission = false) {
  /** @type {GrammarDom} */
  let dom;
  try {
    dom = treeToDom(tree, tokens, positionOf, path, unicode, deferEmission);
  } catch (error) {
    // A count past a test's budget must reach the test as itself, or the
    // reader's work would run on past the budget as an error of the grammar.
    if (error instanceof GencmuError || error instanceof WorkBudget) throw error;
    // Only a bootstrap that is not the notation's gives a tree that the
    // reader cannot read. That is an error of the grammar too.
    throw new GencmuError("grammar", `${path}: the notation's tree cannot be read as a grammar: ${error instanceof Error ? error.message : String(error)}`,
      { document: path }, { cause: error });
  }
  // A document read here is held to the rules of a precompiled DOM
  // (engine §9). A bootstrap that is not the notation's can give a DOM
  // that breaks them.
  const problem = domProblem(dom, unicode, deferEmission);
  if (problem === null) return dom;
  if (problem === "nested too deeply") {
    // Reported at the first item, a rule, a constant's definition or an
    // implication, that holds it, in the order of the document.
    const item = itemsAlone(dom).find((candidate) => domProblem(candidate.alone, unicode, deferEmission) === "nested too deeply");
    const [line, column] = item ? item.at : [1, 1];
    throw new GencmuError("grammar", `${path}:${line}:${column}: an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`, { document: path, line, column });
  }
  // Any other problem is reported at the first item that has it alone,
  // in the order of the document, or else at the document.
  const item = itemsAlone(dom).map((candidate) => ({ at: candidate.at, problem: domProblem(candidate.alone, unicode, deferEmission) }))
    .find((candidate) => candidate.problem !== null);
  if (!item) throw new GencmuError("grammar", `${path}: ${problem}`, { document: path, ...(problem.startsWith("ranked-choice-syntax:") ? {code:"ranked-choice-syntax"} : {}) });
  const [line, column] = item.at;
  throw new GencmuError("grammar", `${path}:${line}:${column}: ${item.problem}`, { document: path, line, column, ...(item.problem?.startsWith("ranked-choice-syntax:") ? {code:"ranked-choice-syntax"} : {}) });
}

// Adds the line and column of an error's source position.
/**
 * Each rule, constant definition and implication of a DOM, alone in a DOM
 * of its own, in the order of the document.
 * @param {GrammarDom} dom
 * @returns {{at: [number, number], alone: GrammarDom}[]}
 */
function itemsAlone(dom) {
  const none = { rules: [], directives: [], constants: [], classifiers: [], implications: [] };
  return [
    ...dom.rules.map((rule) => ({ at: rule.at, alone: { ...dom, ...none, rules: [rule] } })),
    ...dom.constants.map((constant) => ({ at: constant.at, alone: { ...dom, ...none, constants: [constant] } })),
    ...dom.implications.map((implication) => ({ at: implication.at, alone: { ...dom, ...none, implications: [implication] } })),
  ].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
}

/**
 * The notation dialect's DOM from bootstrap.json, or a grammar error saying
 * what is wrong with it.
 * @param {string} text
 * @param {UnicodeTable} unicode
 * @returns {{stages: {name: string, documents: {path: string, dom: GrammarDom}[]}[]}}
 */
function readBootstrap(text, unicode) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GencmuError("grammar", `notation/bootstrap.json is not JSON: ${/** @type {Error} */ (error).message}`, { document: "notation/bootstrap.json" });
  }
  const names = new Set();
  const stages = data && data.format === DOM_FORMAT && Array.isArray(data.stages) ? data.stages : null;
  if (!stages || stages.length === 0) throw new GencmuError("grammar", "notation/bootstrap.json has no stages", { document: "notation/bootstrap.json" });
  for (const stage of stages) {
    if (!stage || typeof stage.name !== "string" || !isName(stage.name) || !Array.isArray(stage.documents) || stage.documents.length === 0) {
      throw new GencmuError("grammar", "notation/bootstrap.json has a malformed stage", { document: "notation/bootstrap.json" });
    }
    if (names.has(stage.name)) throw new GencmuError("grammar", `notation/bootstrap.json: a second stage named ${stage.name}`, { document: "notation/bootstrap.json" });
    names.add(stage.name);
    for (const document of stage.documents) {
      const problem = document && typeof document.path === "string" ? domProblem(document.dom, unicode) : "a document without a path";
      if (problem) throw new GencmuError("grammar", `notation/bootstrap.json: ${problem}`, { document: "notation/bootstrap.json", ...(problem.startsWith("ranked-choice-syntax:") ? {code:"ranked-choice-syntax"} : {}) });
    }
  }
  for (const stage of stages) {
    if (!stage.documents.some((/** @type {{dom: GrammarDom}} */ document) => document.dom.rules.length > 0)) {
      throw new GencmuError("grammar", `stage ${stage.name} has no rules`, { stage: stage.name });
    }
  }
  return data;
}

/**
 * @param {ParseError} error
 * @param {string} text
 * @returns {ParseError}
 */
function locate(error, text) {
  if (!error.source) return error;
  const characters = [...text];
  let line = 1;
  let column = 1;
  for (let index = 0; index < error.source[0] && index < characters.length; index++) {
    const character = characters[index];
    if (character === "\n" || (character === "\r" && characters[index + 1] !== "\n")) {
      line++;
      column = 1;
    } else if (character !== "\r") {
      column++;
    }
  }
  return { ...error, line, column };
}

// FNV-1a over the text's UTF-8 bytes, 64 bits, as 16 hexadecimal digits:
// the hash that keys the precompiled DOMs in every library.
/**
 * @param {string} text
 * @returns {string}
 */
export function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * The first lone surrogate of a string, with its position in code points,
 * or null when the string is a sequence of scalar values.
 * @param {string} text
 * @returns {{code: number, at: number} | null}
 */
function loneSurrogate(text) {
  if (!/[\uD800-\uDFFF]/u.test(text)) return null;
  let at = 0;
  for (const character of text) {
    const code = /** @type {number} */ (character.codePointAt(0));
    if (code >= 0xd800 && code <= 0xdfff) return { code, at };
    at++;
  }
  return null;
}
