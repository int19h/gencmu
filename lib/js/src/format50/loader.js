// The format 50 loader: the bundle of notation 50, its bootstrap, the
// reader of grammar documents, and pipelines that parse text.

import { GencmuError } from "../errors.js";
import { extractGrammarText, resolvePath } from "../markdown.js";
import { splicePipeline } from "../splice.js";
import { Grammar } from "../grammar.js";
import { UnicodeTable } from "../unicode.js";
import { NamesScope } from "../unicode-names.js";
import { DocumentStrings } from "../string-escapes.js";
import { characterTokens } from "../tokens.js";
import { fnv1a64 } from "../hash.js";
import { compareCodePoints } from "../tags.js";
import { BARE, Bag, valued } from "./bag.js";
import { bridgeDocument, isVisibleKey, alternativeKey } from "./bridge.js";
import { Stage50, Token50 } from "./stage.js";
import { DomBuilder } from "./walk.js";
import { validateDocument50 } from "./validate.js";
import { StageCheck } from "./check.js";
import { retainRenderContext } from "./render.js";

/** The bundle of notation 50 in the package. */
export const BUNDLE_50 = Object.freeze({
  format: 50,
  sourceRoot: "grammars50",
  notation: "grammars50/gencmu/jbogenbau/pipeline.md",
  bootstrap: "data/preparsed50/gencmu.json",
  cacheRoot: "data/preparsed50",
});

const UNICODE_PATH = "data/unicode/unicode.txt";
const PROPERTIES_PATH = "data/unicode/unicode-properties.txt";
const NAMES_PATH = "data/unicode/unicode-names.txt";

/**
 * Reads the bootstrap: the DOMs of the notation pipeline.
 * @param {string} text
 * @returns {Map<string, any>} each document's entry
 * @param {any} unicode
 */
export function readBootstrap50(text, unicode) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GencmuError("grammar", `${BUNDLE_50.bootstrap} is not JSON: ${/** @type {Error} */ (error).message}`, { document: BUNDLE_50.bootstrap });
  }
  if (!data || data.format !== 50 || !data.documents || typeof data.documents !== "object" || Array.isArray(data.documents)) {
    throw new GencmuError("grammar", "the bootstrap requires a document map of format 50", { document: BUNDLE_50.bootstrap });
  }
  const documents = new Map();
  for (const [path, entry] of Object.entries(data.documents)) {
    if (!entry || typeof entry.hash !== "string" || !entry.dom || entry.dom.format !== 50) {
      throw new GencmuError("grammar", `the bootstrap's entry for ${path} is malformed`, { document: BUNDLE_50.bootstrap });
    }
    validateDocument50(entry.dom, { document: path, unicode });
    documents.set(path, entry);
  }
  return documents;
}

/**
 * Validates a DOM that did not come from the reader: a cache entry or a
 * supplied DOM. Every template argument record carries its position.
 * @param {any} dom
 * @param {any} path
 * @param {any} unicode
 */
export function validateStoredDom(dom, path, unicode) {
  validateDocument50(dom, { document: path, unicode });
  /** @param {any} node */
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.call !== undefined && Array.isArray(node.args) || Array.isArray(node.args) && node.op !== undefined && node.alternatives) {
      for (const arg of node.args) {
        if (!arg || typeof arg !== "object" || !Array.isArray(arg.at)) {
          throw new GencmuError("grammar", `the DOM of ${path} has a template argument record without its position`, { document: path });
        }
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };
  visit(dom);
}

export class Loader50 {
  /**
   * @param {(path: string) => string | undefined} read
   */
  constructor(read) {
    this.read = read;
    const unicodeText = this.need(UNICODE_PATH);
    this.unicode = new UnicodeTable(unicodeText, read(PROPERTIES_PATH));
    this.bootstrapText = this.need(BUNDLE_50.bootstrap);
    this.bootstrap = readBootstrap50(this.bootstrapText, this.unicode);
    /** @type {Pipeline50 | null} */
    this.notationPipeline = null;
    /** @type {Map<string, any>} */
    this.documents = new Map();
    /** @type {Map<string, any>} the optional cache entries by document */
    this.preparsed = new Map();
    /** @type {Set<string>} the cache files read so far */
    this.preparsedFiles = new Set();
    /** @type {Map<string, any>} the DOMs that a caller supplies by document */
    this.supplied = new Map();
    /** @type {string[]} the documents whose DOM came from a cache entry */
    this.cacheHits = [];
    this.bootstrapHash = fnv1a64(this.bootstrapText);
    this.unicodeHash = fnv1a64(unicodeText);
    const properties = read(PROPERTIES_PATH);
    this.propertiesHash = properties === undefined ? null : fnv1a64(properties);
  }

  /** @param {any} path */
  need(path) {
    const text = this.read(path);
    if (text === undefined) throw new GencmuError("grammar", `${path} was not found`, { document: path });
    return text;
  }

  /** The notation reader, built from the bootstrap alone. */
  notation() {
    if (this.notationPipeline === null) {
      this.notationPipeline = this.build(BUNDLE_50.notation, (/** @type {any} */ path) => this.bootstrap.get(path)?.dom);
    }
    return this.notationPipeline;
  }

  /**
   * Reads one grammar document with the notation reader (engine §8, §9).
   * @param {string} markdown
   * @param {string} path
   * @param {string[]} [inherited] the names resources of the including documents
   * @returns {{hash: string, names?: any, dom: any}}
   */
  readDocument(markdown, path, inherited = []) {
    const unicode = this.unicode;
    const { text, positions } = extractGrammarText(markdown, path, unicode);
    /** @param {any} offset */
    const position = offset => positions[offset] ?? positions.at(-1) ?? [1, 1];
    const names = new NamesScope(file => this.namesResource(file), unicode, inherited);
    const strings = new DocumentStrings(path, unicode, names, position);
    const result = this.notation().parse(text, {
      /** @param {any} tokens */
      inspectLexical: tokens => strings.inspect(tokens.map((/** @type {any} */ token) => token.recognizerToken())),
    });
    if (!result.ok) {
      const error = result.error;
      if (error.kind === "ambiguous") throw new GencmuError("grammar", error.message, { document: path, stage: error.stage });
      const token = error.token !== undefined ? result.stages.at(-1).input[error.token] : undefined;
      const [line, column] = position(token?.source[0] ?? (error.token === undefined ? 0 : [...text].length));
      throw new GencmuError("grammar", error.message, { document: path, line, column, stage: error.stage });
    }
    const syntax = result.stages.at(-1);
    const dom = new DomBuilder(syntax.input, position, path, unicode, strings).build(syntax.root);
    return { hash: fnv1a64(markdown), ...(names.dependencies && { names: names.dependencies }), dom };
  }

  /** @param {any} file */
  namesResource(file) {
    const text = this.read(file) ?? (file === "data/unicode/unicode-names-reference.txt" ? this.read(NAMES_PATH) : undefined);
    if (text === undefined) throw new GencmuError("grammar", "the resource was not found", { document: file });
    return text;
  }

  /**
   * The DOM of a document, read from its source.
   * @param {any} path
   * @param {any} inherited
   */
  documentDom(path, inherited) {
    const key = JSON.stringify([path, inherited]);
    if (!this.documents.has(key)) this.documents.set(key, this.findDom(path, inherited));
    return this.documents.get(key);
  }

  /**
   * @param {any} path
   * @param {any} inherited
   */
  findDom(path, inherited) {
    if (this.supplied.has(path)) return this.supplied.get(path);
    const text = this.read(path);
    if (text === undefined) return undefined;
    this.loadPreparsed(path);
    const entry = this.preparsed.get(path);
    if (entry && entry.hash === fnv1a64(text)) {
      try {
        validateStoredDom(entry.dom, path, this.unicode);
        this.cacheHits.push(path);
        return entry.dom;
      } catch (error) {
        // An entry that fails validation is a miss, and the source is read.
        if (!(error instanceof GencmuError)) throw error;
      }
    }
    return this.readDocument(text, path, inherited).dom;
  }

  /**
   * Uses the entries of an optional cache whose fingerprints match this
   * loader: the bootstrap, the Unicode table, its properties and the format.
   * @param {any} data
   */
  usePreparsed(data) {
    if (!data || data.format !== 50 || data.bootstrap !== this.bootstrapHash || data.unicode !== this.unicodeHash ||
        !Object.hasOwn(data, "properties") || data.properties !== this.propertiesHash ||
        !data.documents || typeof data.documents !== "object") return;
    for (const [path, entry] of Object.entries(data.documents)) {
      if (entry && typeof entry.hash === "string" && entry.dom && !this.preparsed.has(path)) this.preparsed.set(path, entry);
    }
  }

  // The optional cache of a document's family under the cache root.
  /** @param {any} path */
  loadPreparsed(path) {
    const parts = path.split("/");
    if (parts[0] !== BUNDLE_50.sourceRoot || parts.length < 3) return;
    const file = `${BUNDLE_50.cacheRoot}/${parts[1]}.json`;
    if (file === BUNDLE_50.bootstrap || this.preparsedFiles.has(file)) return;
    this.preparsedFiles.add(file);
    try {
      const text = this.read(file);
      if (text !== undefined) this.usePreparsed(JSON.parse(text));
    } catch (error) {
      // An unreadable optional cache supplies no entries.
    }
  }

  /**
   * Supplies the DOM of a document in place of its source.
   * @param {string} path
   * @param {string} json the DOM as JSON
   */
  supplyDom(path, json) {
    let dom;
    try {
      dom = JSON.parse(json);
    } catch (error) {
      throw new GencmuError("grammar", `the supplied DOM of ${path} is not JSON: ${/** @type {Error} */ (error).message}`, { document: path });
    }
    if (!dom || dom.format !== 50) throw new GencmuError("grammar", `the supplied DOM of ${path} is not of format 50`, { document: path });
    validateStoredDom(dom, path, this.unicode);
    this.supplied.set(path, dom);
  }

  /**
   * A pipeline from its pipeline document.
   * @param {string} path
   */
  pipeline(path) {
    return this.build(path, (/** @type {any} */ document, /** @type {any} */ inherited) => this.documentDom(document, inherited));
  }

  /**
   * @param {any} path
   * @param {any} domOf
   */
  build(path, domOf) {
    const origins = new Map();
    const bridged = new Map();
    const spliced = splicePipeline(path, (document, inherited) => {
      const dom = domOf(document, inherited);
      if (!dom) return undefined;
      const lowered = bridgeDocument(dom, document, origins);
      bridged.set(document, lowered);
      return lowered;
    });
    // The inferred states of the keys that each stage hands on.
    /** @type {Map<string, Set<string>> | null} */
    let inputStates = null;
    const stages = spliced.stages.map(stage => {
      // A bag term whose keys have no tag term is legal only where no
      // recognizer test of the stage reads the keys of its rule.
      const documents = [...new Set(stage.documents.map(run => run.path))].map(document => bridged.get(document));
      const written = [];
      for (const run of stage.documents) for (const rule of run.dom.rules) {
        if (!rule.alternatives?.length) continue;
        const origin = origins.get(rule.params ? `template:${rule.name}#0` : alternativeKey(run.path, rule.at, 0));
        if (origin) written.push({ rule: origin.rule, document: run.path });
      }
      const stageConstants = new Map();
      for (const run of stage.documents) for (const placeholder of run.dom.constants) {
        const { constant, document } = origins.get(/** @type {any} */ (placeholder).origin50);
        if (!stageConstants.has(constant.name)) stageConstants.set(constant.name, []);
        stageConstants.get(constant.name).push({ record: constant, document });
      }
      const checker = new StageCheck(stageConstants);
      checker.check(written);
      const interfaceFailures = inputStates ? checker.inputRefinement(written, inputStates) : [];
      inputStates = checker.outputStates(written, inputStates);
      const certificateFailures = [...checker.payloadRefinement(written), ...interfaceFailures, ...checker.certificates(written)];
      for (const document of documents) if (document.deferred.length) throw document.deferred[0];
      const readers = new Set(documents.flatMap(document => [...document.keyReaders]));
      for (const document of documents) {
        for (const [rule, error] of document.untranslated) if (readers.has(rule)) throw error;
      }
      const constants = new Map();
      for (const run of stage.documents) {
        for (const placeholder of run.dom.constants) {
          const { constant, document } = origins.get(/** @type {any} */ (placeholder).origin50);
          if (!constants.has(constant.name)) constants.set(constant.name, []);
          constants.get(constant.name).push({ record: constant, document });
        }
      }
      /** @param {any} runs */
      const grammar = runs => new Grammar(stage.name, runs, this.unicode);
      const made = new Stage50(stage.name, stage.documents, origins, constants, grammar);
      made.loweringErrors = certificateFailures;
      made.featureDeclarations = stage.documents.flatMap(run => run.dom.directives
        .filter(directive => directive.name === "features")
        .map(directive => ({ directive, document: run.path })));
      return made;
    });
    return new Pipeline50(path, stages, this, spliced.features);
  }
}

export class Pipeline50 {
  /**
   * @param {any} path
   * @param {any} stages
   * @param {any} loader
   * @param {any} declared
   */
  constructor(path, stages, loader, declared) {
    this.path = path;
    this.stages = stages;
    this.loader = loader;
    this.declared = declared;
  }

  /**
   * Parses a text.
   * @param {string} text
   * @param {any} [options]
   */
  parse(text, options = {}) {
    const unicode = this.loader.unicode;
    const sourceText = [...text];
    const origin = options.tokens ? callerTokens(options.tokens, text, unicode) : characterTokens(text, unicode).map(token =>
      new Token50({
        text: token.text, span: token.span, source: token.source,
        props: Bag.from(/** @type {[string, import("./bag.js").Entry][]} */ ([...[...token.tags].map(key => [key, BARE]),
          ["image", valued(token.image)], ["value", valued(token.value)]]).sort((a, b) => compareCodePoints(a[0], b[0]))),
      }));
    const on = [...(options.features ?? [])];
    const off = new Set(options.withoutFeatures ?? []);
    const both = on.find(name => off.has(name));
    if (both !== undefined) throw new GencmuError("usage", `the feature ${both} is named both to turn on and to turn off`);
    const features = new Set([...this.declared, ...on].filter(name => !off.has(name)));
    let last = this.stages.length - 1;
    if (options.until !== undefined) {
      last = this.stages.findIndex((/** @type {any} */ stage) => stage.name === options.until);
      if (last < 0) throw new GencmuError("usage", `no stage is named ${JSON.stringify(options.until)}`);
    }
    const stages = [];
    let tokens = origin;
    let inputKeys = new Set(origin.flatMap(token => token.props.keys().filter(key => key !== "value" && key !== "image")));
    for (let index = 0; index <= last; index++) {
      const stage = this.stages[index];
      const conflict = stage.declareFeatures(tokens, sourceText, features, off, inputKeys);
      const report = conflict ?? stage.run(tokens, sourceText, unicode, { features, inputKeys, elisionOnly: options.elisionOnly });
      report.input = tokens;
      report.inputIndex = index - 1;
      stages.push(report);
      if (report.error) break;
      if (index === 0 && report.output) options.inspectLexical?.(report.output);
      if (index === last) break;
      if (!report.output) {
        report.error = { kind: "grammar", stage: stage.name, message: `the ${stage.name} stage has no $OUTPUTS, so it must be last` };
        break;
      }
      tokens = report.output;
      inputKeys = new Set([...report.outputKeys].filter(key => key !== "value" && key !== "image"));
    }
    // The reports that reach the reporting stage: those that its input
    // tokens carry through its live leaves, its own, and those that earlier
    // stages kept for want of a token (engine §12.1).
    /** @type {Record<string, any[]>} */
    const collected = { errors: [], warnings: [] };
    for (const stage of stages.slice(0, -1)) for (const kind of ["errors", "warnings"]) for (const diagnostic of stage[kind] ?? []) collected[kind].push(diagnostic);
    const reporting = stages.at(-1);
    if (reporting?.root && !reporting.error) {
      const live = new Set();
      const stack = [reporting.root];
      while (stack.length) {
        const node = stack.pop();
        if (node.erased) continue;
        if (node.kind === "token") live.add(node.token);
        for (const child of node.children) stack.push(child);
      }
      for (const index of [...live].sort((a, b) => a - b)) {
        for (const kind of ["errors", "warnings"]) for (const diagnostic of reporting.input[index][kind] ?? []) collected[kind].push(diagnostic);
      }
      for (const { kind, diagnostic } of reporting.own ?? []) collected[kind].push(diagnostic);
    }
    // A failed stage collects the reports of its input: through the
    // furthest token on a rejection, and all of it on other failures.
    const failedStage = stages.find(stage => stage.error);
    if (failedStage && failedStage.error.kind !== "ambiguous") {
      const end = failedStage.error.kind === "rejected" ? Math.min(failedStage.input.length, (failedStage.error.token ?? failedStage.input.length) + 1) : failedStage.input.length;
      for (const token of failedStage.input.slice(0, end)) {
        for (const kind of ["errors", "warnings"]) for (const diagnostic of token[kind] ?? []) collected[kind].push(diagnostic);
      }
      if (collected.errors.length) failedStage.error.errors = collected.errors;
      if (collected.warnings.length && failedStage.error.kind !== "reported") failedStage.error.warnings = collected.warnings;
    }
    if (!failedStage && stages.length === last + 1 && collected.errors.length) {
      reporting.error = { kind: "reported", stage: reporting.name, errors: collected.errors, message: "the chosen derivation reports errors" };
    }
    const failed = stages.find(stage => stage.error);
    const result = {
      format: 18,
      ok: !failed && stages.length === last + 1,
      text,
      origin,
      stages,
      tree: failed && failed.error.kind !== "reported" ? null : stages.length - 1,
      error: failed ? failed.error : null,
      warnings: collected.warnings,
      features: [...features].sort(compareCodePoints),
    };
    retainRenderContext(result, unicode);
    return result;
  }
}

/**
 * The tokens that a caller supplies instead of stage zero (docs/api.md).
 * @param {any[]} supplied
 * @param {string} text
 * @param {any} unicode
 */
function callerTokens(supplied, text, unicode) {
  if (!Array.isArray(supplied)) throw new GencmuError("usage", "tokens must be an array");
  const length = [...text].length;
  return supplied.map((token, index) => {
    if (!token || typeof token !== "object") throw new GencmuError("usage", `token ${index}: invalid input token`);
    const props = token.props ?? Object.fromEntries((token.tags ?? []).map((/** @type {any} */ tag) => [tag, true]));
    const entries = [];
    for (const [key, value] of Object.entries(props)) {
      if (key === "value" || key === "image") {
        if (typeof value !== "string") throw new GencmuError("usage", `token ${index}: ${key} must be a string`);
        continue;
      }
      if (value !== true) throw new GencmuError("usage", `token ${index}: the key ${key} cannot carry a value`);
      if (key === "_Elided") throw new GencmuError("usage", `token ${index}: _Elided is not a key`);
      const canonical = key.startsWith("_") ? unicode.canonicalTag(key) : key;
      if (canonical === undefined || canonical === null) throw new GencmuError("usage", `token ${index}: unsupported engine key ${key}`);
      entries.push([canonical, BARE]);
    }
    const tokenText = token.text;
    if (typeof tokenText !== "string") throw new GencmuError("usage", `token ${index}: text must be a string`);
    entries.push(["value", valued(props.value ?? token.value ?? tokenText)]);
    entries.push(["image", valued(props.image ?? token.image ?? tokenText)]);
    const span = token.span ?? [index, index + 1];
    const source = token.source ?? [0, Math.min(length, [...tokenText].length)];
    if (!(0 <= source[0] && source[0] <= source[1] && source[1] <= length)) {
      throw new GencmuError("usage", `token ${index}: the source ${JSON.stringify(source)} is not a range within a text of ${length} code points`);
    }
    const sorted = /** @type {[string, import("./bag.js").Entry][]} */ (entries.sort((a, b) => compareCodePoints(a[0], b[0])));
    return new Token50({ text: tokenText, props: Bag.from(sorted), span: [span[0], span[1]], source: [source[0], source[1]] });
  });
}

/**
 * The bootstrap file of a set of read documents, in the form that
 * `data/preparsed50/gencmu.json` uses.
 * @param {Map<string, any>} entries each document's entry
 * @param {(path: string) => string} read
 */
export function bootstrapText(entries, read, names = [NAMES_PATH]) {
  const header = {
    unicode: fnv1a64(read(UNICODE_PATH)),
    properties: fnv1a64(read(PROPERTIES_PATH)),
    bundledNames: Object.fromEntries([...names].sort(compareCodePoints).map(file => [file, fnv1a64(read(file))])),
  };
  const documents = Object.fromEntries([...entries].sort(([a], [b]) => compareCodePoints(a, b)));
  return JSON.stringify({ format: 50, ...header, documents }) + "\n";
}

export { isVisibleKey, resolvePath };
