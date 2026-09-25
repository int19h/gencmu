// Dialects: loading pipeline documents and their grammars, reading grammar
// documents with the notation dialect (engine §8), and running a text
// through the stages (engine §13).

import { GencmuError } from "./errors.js";
import { Grammar } from "./grammar.js";
import { Stage } from "./stage.js";
import { treeToDom } from "./reader.js";
import { extractGrammarText, readPipeline, resolvePath } from "./markdown.js";
import { characterTokens, Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
import { someNode } from "./walk.js";
import { compareCodePoints } from "./tags.js";
import { domProblem, isDom, DOM_FORMAT, DOM_MAX_DEPTH } from "./dom.js";

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
    const bootstrap = readBootstrap(this.need("notation/bootstrap.json"));
    this.bootstrapHash = fnv1a64(this.need("notation/bootstrap.json"));
    this.notation = new Dialect("dialects/notation.md", bootstrap.stages.map((stage) =>
      new Stage(stage.name, new Grammar(stage.name, stage.documents.map((document) => ({ path: document.path, dom: document.dom }))))), this);
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
          if (entry && typeof entry.hash === "string" && isDom(entry.dom)) this.compiled.set(path, entry);
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
    const text = this.read(path);
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
    const hash = fnv1a64(text);
    const key = `${path}\u0000${hash}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const entry = this.compiled.get(path);
    let dom;
    if (entry && entry.hash === hash) dom = entry.dom;
    else dom = this.readDocument(text, path);
    this.cache.set(key, dom);
    return dom;
  }

  /**
   * Reads a grammar document's Markdown into its DOM with the notation.
   * @param {string} markdown
   * @param {string} path
   * @returns {GrammarDom}
   */
  readDocument(markdown, path) {
    const { text, positions } = extractGrammarText(markdown, path);
    const run = this.notation.parse(text, { features: new Set() });
    /** @type {(token: Token) => import("./types.js").Position} */
    const positionOf = (token) => positions[token.source[0]] || positions[positions.length - 1] || [1, 1];
    if (!run.ok) {
      const error = /** @type {ParseError} */ (run.error);
      const source = error.source || [0, 0];
      const [line, column] = positions[source[0]] || (positions.length ? positions[positions.length - 1] : [1, 1]);
      throw new GencmuError("grammar", `${path}:${line}:${column}: ${error.message}`, { document: path, line, column });
    }
    const syntax = run.stages[run.stages.length - 1];
    /** @type {GrammarDom} */
    let dom;
    try {
      dom = treeToDom(/** @type {ResultNode} */ (syntax.tree), syntax.input || [], positionOf, path);
    } catch (error) {
      if (error instanceof RangeError) throw new GencmuError("grammar", `${path}: nested too deeply`, { document: path });
      throw error;
    }
    // The bound on nesting is the same for a document read here as for a
    // precompiled DOM (engine §9).
    if (domProblem(dom) === "nested too deeply") {
      // Reported at the rule that holds it, the first too deep.
      const rule = dom.rules.find((candidate) => domProblem({ ...dom, rules: [candidate], directives: [] }) === "nested too deeply");
      const [line, column] = rule ? rule.at : [1, 1];
      throw new GencmuError("grammar", `${path}:${line}:${column}: an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`, { document: path, line, column });
    }
    return dom;
  }

  /**
   * A dialect from its pipeline document's path.
   * @param {string} path
   * @returns {Dialect}
   */
  dialect(path) {
    const markdown = this.need(path);
    const pipeline = readPipeline(markdown, path);
    const stages = pipeline.stages.map((stage) => new Stage(stage.name,
      new Grammar(stage.name, stage.documents.map((document) => {
        const documentPath = resolvePath(path, document);
        return { path: documentPath, dom: this.documentDom(documentPath) };
      }))));
    return new Dialect(path, stages, this, pipeline.features);
  }
}

/**
 * A dialect's features (engine §13): every name a guard of any stage uses,
 * and every name the pipeline's `<?features?>` declares, in code point
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
    for (const rule of stage.grammar.rules.values()) {
      for (const alternative of rule.alternatives) {
        for (const guard of alternative.guards) {
          const known = kinds.get(guard.feature);
          if (known !== undefined && known !== guard.kind) {
            throw new GencmuError("grammar", `${path}: the feature ${guard.feature} is used both as a gate and as a warning`, { document: path });
          }
          kinds.set(guard.feature, guard.kind);
        }
      }
    }
  }
  const names = [...new Set([...kinds.keys(), ...declared])].sort(compareCodePoints);
  return names.map((name) => ({ name, kind: kinds.get(name) || "gate", default: declared.includes(name) }));
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
    // The features on are the pipeline's, with the caller's added and the
    // caller's turned off removed (engine §13).
    const on = [...(options.features || [])];
    const off = new Set(options.withoutFeatures || []);
    const both = on.find((name) => off.has(name));
    if (both !== undefined) throw new GencmuError("usage", `the feature ${both} is named both to turn on and to turn off`);
    let features = new Set([...this.declared, ...on].filter((name) => !off.has(name)));
    const wordsAt = this.stages.findIndex((stage) => stage.name === "words");
    const untilAt = options.until === undefined ? this.stages.length - 1 : this.stages.findIndex((stage) => stage.name === options.until);
    // The probe is for a run that reaches the words stage (engine §13).
    // Only a dialect that has sa-su as a gate adds it by itself (engine §13).
    const gated = this.features.some((feature) => feature.name === "sa-su" && feature.kind === "gate");
    if (options.autoFeatures !== false && gated && !features.has("sa-su") && !off.has("sa-su") && wordsAt >= 0 && untilAt >= wordsAt) {
      const probe = this.run(text, { ...options, features, until: "words" }, null);
      const words = probe.stages[probe.stages.length - 1];
      const needs = !words || words.name !== "words" || words.error || containsWord(words.tree, words.input, ["sa", "su"]);
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
    const last = options.until ? this.stages.findIndex((stage) => stage.name === options.until) : this.stages.length - 1;
    if (last < 0) throw new GencmuError("usage", `no stage is named ${options.until}`);
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
 * @param {ResultNode | null} tree
 * @param {Token[] | undefined} tokens
 * @param {string[]} words
 * @returns {boolean}
 */
function containsWord(tree, tokens, words) {
  if (!tree || !tokens) return false;
  return someNode(tree, (node) => {
    if (node.kind !== "rule" || node.rule !== "word") return false;
    let phonemes = "";
    for (let index = node.span[0]; index < node.span[1]; index++) phonemes += tokens[index].phonemes || "";
    return words.includes(phonemes);
  });
}

// Adds the line and column of an error's source position.
/**
 * The notation dialect's DOM from bootstrap.json, or a grammar error saying
 * what is wrong with it.
 * @param {string} text
 * @returns {{stages: {name: string, documents: {path: string, dom: GrammarDom}[]}[]}}
 */
function readBootstrap(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GencmuError("grammar", `notation/bootstrap.json is not JSON: ${/** @type {Error} */ (error).message}`, { document: "notation/bootstrap.json" });
  }
  const stages = data && data.format === DOM_FORMAT && Array.isArray(data.stages) ? data.stages : null;
  if (!stages || stages.length === 0) throw new GencmuError("grammar", "notation/bootstrap.json has no stages", { document: "notation/bootstrap.json" });
  for (const stage of stages) {
    if (!stage || typeof stage.name !== "string" || !Array.isArray(stage.documents) || stage.documents.length === 0) {
      throw new GencmuError("grammar", "notation/bootstrap.json has a malformed stage", { document: "notation/bootstrap.json" });
    }
    for (const document of stage.documents) {
      const problem = document && typeof document.path === "string" ? domProblem(document.dom) : "a document without a path";
      if (problem) throw new GencmuError("grammar", `notation/bootstrap.json: ${problem}`, { document: "notation/bootstrap.json" });
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

