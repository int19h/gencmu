// The format 50 loader: the bundle of notation 50, its bootstrap, the
// reader of grammar documents, and pipelines that parse text.

import { GencmuError } from "../errors.js";
import { extractGrammarText, resolvePath } from "../markdown.js";
import { splicePipeline } from "../splice.js";
import { Grammar } from "../grammar.js";
import { withNativeMethods } from "../dom.js";
import { UnicodeTable } from "../unicode.js";
import { PROPERTY_CATALOG } from "../unicode-property-catalog.js";
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
 * supplied DOM. The record table checks the members, positions and operand
 * forms of each record, as the reader writes them.
 * @param {any} dom
 * @param {any} path
 * @param {any} unicode
 */
export function validateStoredDom(dom, path, unicode) {
  validateDocument50(dom, { document: path, unicode });
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
        // An instance binding, `%rule a = t(…)`, with its format 50 call,
        // which the bridge keeps beside the document.
        if (/** @type {any} */ (rule).instance) {
          const instances = bridged.get(run.path)?.instances50 ?? [];
          const at = JSON.stringify(rule.at);
          const instance = instances.find((/** @type {any} */ item) => item.name === rule.name && JSON.stringify(item.at) === at);
          if (instance) written.push({ rule: instance, document: run.path });
          continue;
        }
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
      // A rule is a key reader where a test reads its keys, or where its keys
      // flow into the keys of a key reader.
      const readers = new Set(documents.flatMap(document => [...document.keyReaders]));
      /** @type {Map<string, Set<string>>} */
      const sources = new Map();
      for (const document of documents) {
        for (const [rule, names] of document.tagSources) sources.set(rule, new Set([...(sources.get(rule) ?? []), ...names]));
      }
      // A key read through a parameter, the marker @template:param, reads the
      // rules that the actual of that parameter binds in each call.
      /** @type {Map<string, string[]>} */
      const params = new Map();
      /** @type {Map<string, string[][][]>} */
      const calls = new Map();
      for (const document of documents) {
        for (const [template, names] of document.templateParams) params.set(template, names);
        for (const { template, actuals } of document.templateCalls) {
          if (!calls.has(template)) calls.set(template, []);
          calls.get(template)?.push(actuals);
        }
      }
      /** @param {string} name */
      const reached = name => {
        const marker = /^@(.+):([^:]+)$/.exec(name);
        if (!marker) return [...sources.get(name) ?? []];
        const index = params.get(marker[1])?.indexOf(marker[2]) ?? -1;
        return index < 0 ? [] : (calls.get(marker[1]) ?? []).flatMap(actuals => actuals[index] ?? []);
      };
      const pending = [...readers];
      while (pending.length) {
        for (const source of reached(/** @type {string} */ (pending.pop()))) {
          if (!readers.has(source)) {
            readers.add(source);
            pending.push(source);
          }
        }
      }
      // The certificates read the terms of each key reader.
      const certificateFailures = [...checker.payloadRefinement(written), ...interfaceFailures, ...checker.certificates(written, readers)];
      for (const document of documents) if (document.deferred.length) throw document.deferred[0];
      for (const document of documents) {
        for (const [rule, error] of document.untranslated) if (readers.has(rule)) throw error;
      }
      // The recognizer reads the final version of a constant in the whole
      // stage, so a placeholder in one document hides it from every read.
      // A read of a constant reads each constant that its definition refers to.
      const opaque = new Set(documents.flatMap(document => [...document.opaque]));
      /** @type {Map<string, Set<string>>} */
      const deps = new Map();
      for (const document of documents) {
        for (const [name, names] of document.constantDeps) deps.set(name, new Set([...(deps.get(name) ?? []), ...names]));
      }
      // A fold of a constant from one document reads an earlier version where
      // another document of the stage has a version of it.
      for (const document of documents) {
        for (const [name, error] of document.foldedConstants) {
          if (documents.some(other => other !== document && other.definedConstants.has(name))) throw error;
        }
      }
      // A read of the run-time value tag of a payload needs every write of
      // the key in the stage to give that tag.
      const untagged = new Set(documents.flatMap(document => [...document.untaggedPayloads]));
      for (const document of documents) {
        for (const [key, error] of document.nativeReads) if (untagged.has(key)) throw error;
      }
      for (const document of documents) {
        for (const [name, error] of document.constantReads) {
          const seen = new Set([name]);
          const pending = [name];
          while (pending.length) {
            const next = /** @type {string} */ (pending.pop());
            if (opaque.has(next)) throw error;
            for (const dep of deps.get(next) ?? []) if (!seen.has(dep)) seen.add(dep), pending.push(dep);
          }
        }
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
      const grammar = runs => withNativeMethods(() => new Grammar(stage.name, runs, this.unicode));
      const made = new Stage50(stage.name, stage.documents, origins, constants, grammar);
      made.loweringErrors = certificateFailures;
      made.featureDeclarations = stage.documents.flatMap(run => run.dom.directives
        .filter(directive => directive.name === "features")
        .map(directive => ({ directive, document: run.path })));
      checkConstants(constants);
      for (const { directive, document } of made.featureDeclarations) {
        for (const condition of directive.conditions50 ?? []) checkFeatureCondition(condition, constants, document);
      }
      return made;
    });
    checkFeatures(stages, spliced.features);
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
    // The caller chooses on the parse whether earlier stages keep their
    // full trees in the result (errata 3.2, answer 2).
    if (options.stageTrees !== undefined && options.stageTrees !== "compact" && options.stageTrees !== "all") {
      throw new GencmuError("usage", `stageTrees must be "compact" or "all", not ${JSON.stringify(options.stageTrees)}`);
    }
    if (options.until !== undefined) {
      last = this.stages.findIndex((/** @type {any} */ stage) => stage.name === options.until);
      if (last < 0) throw new GencmuError("usage", `no stage is named ${JSON.stringify(options.until)}`);
    }
    const stages = [];
    let tokens = origin;
    // The first stage reads every canonical Unicode membership that the
    // table supports, whatever the text holds, and the user keys of
    // supplied tokens (engine §2).
    let inputKeys = new Set([...originKeys(unicode),
      ...origin.flatMap(token => token.props.keys().filter(key => key !== "value" && key !== "image"))]);
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
    if (failedStage?.error.kind === "ambiguous" && failedStage.readingOwn) {
      // A tie collects the first reading, then what the second adds. A
      // carried report counts once. An own report is new only beyond the
      // number of equal reports that the first reading gave (engine §12.1).
      const carried = new Set();
      /** @type {Map<string, number>} */
      const seen = new Map();
      failedStage.readings.forEach((/** @type {any} */ reading, /** @type {number} */ index) => {
        /** @type {Map<string, number>} */
        const own = new Map();
        for (const { kind, diagnostic } of readingCollection(reading, failedStage.input, failedStage.readingOwn[index])) {
          if (diagnostic.own) {
            const key = kind + JSON.stringify(diagnostic.record);
            const count = (own.get(key) ?? 0) + 1;
            own.set(key, count);
            if (count <= (seen.get(key) ?? 0)) continue;
            collected[kind].push(diagnostic.record);
          } else {
            if (carried.has(diagnostic.record)) continue;
            carried.add(diagnostic.record);
            collected[kind].push(diagnostic.record);
          }
        }
        for (const [key, count] of own) seen.set(key, Math.max(seen.get(key) ?? 0, count));
      });
      if (collected.errors.length) failedStage.error.errors = collected.errors;
      if (collected.warnings.length) failedStage.error.warnings = collected.warnings;
    }
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
      stageTrees: options.stageTrees ?? "compact",
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

/** @type {WeakMap<UnicodeTable, string[]>} */
const originKeyCache = new WeakMap();

/**
 * The canonical Unicode memberships that the origin producer can supply
 * with this table: each canonical tag of the catalog that the table
 * supports. Aliases are not canonical, so they are left out.
 * @param {UnicodeTable} unicode
 */
function originKeys(unicode) {
  let keys = originKeyCache.get(unicode);
  if (!keys) {
    keys = Object.keys(PROPERTY_CATALOG.tags).filter(tag => unicode.canonicalTag(tag) === tag);
    originKeyCache.set(unicode, keys);
  }
  return keys;
}

/**
 * The reports of one reading in preorder (engine §12.1): each live rule
 * node supplies its own reports, and each live input leaf the reports
 * that its token carries. Erased subtrees supply nothing.
 * @param {any} root
 * @param {any[]} input the input tokens of the stage
 * @param {{kind: string, node: any, diagnostic: any}[]} own
 * @returns {{kind: string, diagnostic: {own: boolean, record: any}}[]}
 */
function readingCollection(root, input, own) {
  /** @type {Map<any, {kind: string, diagnostic: any}[]>} */
  const byNode = new Map();
  for (const entry of own) {
    if (!byNode.has(entry.node)) byNode.set(entry.node, []);
    /** @type {any[]} */ (byNode.get(entry.node)).push(entry);
  }
  const result = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.erased) continue;
    for (const entry of byNode.get(node) ?? []) result.push({ kind: entry.kind, diagnostic: { own: true, record: entry.diagnostic } });
    if (node.kind === "token") {
      for (const kind of ["errors", "warnings"]) for (const record of input[node.token][kind] ?? []) result.push({ kind, diagnostic: { own: false, record } });
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return result;
}

/**
 * The checks of features across the stages of a pipeline (engine §13), as
 * format 49 makes them. A name is a gate, a warning or an error code, and
 * never two of these. A stage cannot declare a feature with %features that
 * an earlier stage tests.
 * @param {any[]} stages
 * @param {string[]} declared the features that the pipeline declares
 */
function checkFeatures(stages, declared) {
  /** @type {Map<string, string>} */
  const kinds = new Map();
  for (const stage of stages) {
    const grammar = stage.probe;
    const roles = [];
    for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
      const where = { ...alternative.at, stage: stage.name };
      for (const gate of alternative.gates) roles.push({ name: gate.feature, kind: gate.kind, where });
      if (alternative.clauses.error) roles.push({ name: rule.name, kind: "error", where });
      if (alternative.clauses.warning) roles.push({ name: rule.name, kind: "warning", where });
    }
    for (const { path: document, classifier } of grammar.classifierItems) for (const entry of classifier.entries) for (const gate of entry.gates) {
      roles.push({ name: gate.feature, kind: gate.kind, where: { document, line: entry.at[0], column: entry.at[1], stage: stage.name } });
    }
    for (const { name, kind, where } of roles) {
      const known = kinds.get(name);
      if (known !== undefined && known !== kind) {
        const category = known === "error" || kind === "error" ? "name" : "feature";
        throw new GencmuError("grammar", `the ${category} ${name} is used both as ${known} and ${kind}`, where);
      }
      kinds.set(name, kind);
    }
  }
  /** @type {Map<string, string>} */
  const tested = new Map();
  const local = [];
  for (const stage of stages) {
    const grammar = stage.probe;
    for (const { path: document, directive } of grammar.featureItems) for (const name of directive.args) {
      local.push(name);
      if (tested.has(name)) {
        throw new GencmuError("grammar", `${document}:${directive.at[0]}: stage ${tested.get(name)} tests local feature ${name}`,
          { document, line: directive.at[0], column: directive.at[1], stage: stage.name });
      }
    }
    for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
      for (const gate of alternative.gates) if (!tested.has(gate.feature)) tested.set(gate.feature, stage.name);
      if (alternative.clauses.warning && !tested.has(rule.name)) tested.set(rule.name, stage.name);
    }
    for (const name of grammar.classifierGates) if (!tested.has(name)) tested.set(name, stage.name);
  }
  for (const name of [...declared, ...local]) if (kinds.get(name) === "error") throw new GencmuError("grammar", `%features cannot name error code ${name}`);
}

// The methods that a %features condition cannot use: queries, neighbors,
// context beyond the input, restoration, verbatim text and classifiers.
const FEATURE_FORBIDDEN = new Set(["parse", "error-free", "followed-by", "preceded-by", "starts-input", "ends-input",
  "onward", "following-tokens", "preceding-tokens", "verbatim-text", "without-elision", "without-elision-except", "classify"]);

/**
 * A %features condition reads the whole input once (part 3 §11). It can
 * read input strings, source, token slices, key sets, token bags and pure
 * functions of these and of closed constants. The check covers branches
 * that cannot run too.
 * @param {any} condition
 * @param {Map<string, any[]>} constants the constants of the stage
 * @param {string} document
 */
function checkFeatureCondition(condition, constants, document) {
  /**
   * @param {string} description
   * @param {any} node
   * @returns {never}
   */
  const fail = (description, node) => {
    const at = node?.at;
    const place = at ? document + ":" + at[0] + ":" + at[1] : document;
    throw new GencmuError("grammar", place + ": a %features condition cannot " + description,
      { document, ...(at ? { line: at[0], column: at[1] } : {}) });
  };
  const closedString = (/** @type {any} */ node) => closedText(node, constants);
  /** @type {any[]} */
  const stack = [condition];
  /** @type {Set<string>} */
  const bound = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node.method !== undefined && FEATURE_FORBIDDEN.has(node.method)) fail("use ." + node.method, node);
    if (node.op === "≅" || node.op === "≇") fail("compare with " + node.op, node);
    if (node.capture !== undefined && node.capture !== "" && !bound.has(node.capture)) fail("read the capture $" + node.capture, node);
    if (node.const !== undefined && !constants.has(node.const)) fail("read $" + node.const + ", which is not defined", node);
    if (node.method === "split" && closedString(node.args?.[0]) === "") fail("split with an empty delimiter", node);
    if (node.lambda !== undefined && node.lambda !== "") bound.add(node.lambda);
    for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") stack.push(value);
  }
}

/**
 * The string that a closed expression of literals, constants and `++`
 * gives, or undefined for any other expression. A constant reads its last
 * version, or the version before `before` within a redefinition.
 * @param {any} node
 * @param {Map<string, any[]>} constants
 * @param {any} [before] the version that holds the expression
 * @returns {string | undefined}
 */
function closedText(node, constants, before) {
  if (!node || typeof node !== "object") return undefined;
  if (node.string !== undefined) return node.string;
  if (node.const !== undefined) {
    const versions = constants.get(node.const) ?? [];
    const index = before ? versions.indexOf(before) : -1;
    const version = index > 0 && versions[index].record.name === node.const ? versions[index - 1] : versions.at(-1);
    if (!version || version === before) return undefined;
    return closedText(version.record.value, constants, version);
  }
  if (node.concat) {
    let text = "";
    for (const part of node.concat) {
      const piece = closedText(part, constants, before);
      if (piece === undefined) return undefined;
      text += piece;
    }
    return text;
  }
  return undefined;
}

/**
 * The checks of the constants of a stage at load (part 3 §11): each
 * constant that a constant reads exists, and a split of a closed
 * expression has a delimiter that is not empty.
 * @param {Map<string, any[]>} constants
 */
function checkConstants(constants) {
  for (const versions of constants.values()) for (const version of versions) {
    const { record, document } = version;
    /**
     * @param {string} description
     * @param {any} at
     * @returns {never}
     */
    const fail = (description, at) => {
      throw new GencmuError("grammar", (at ? document + ":" + at[0] + ":" + at[1] : document) + ": " + description,
        { document, ...(at ? { line: at[0], column: at[1] } : {}) });
    };
    /** @type {any[]} */
    const stack = [record.value];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      if (node.const !== undefined && node.const !== "INPUTS" && !constants.has(node.const)) fail("the constant $" + node.const + " is not defined", node.at);
      if (node.method === "split" && closedText(node.args?.[0], constants, version) === "") fail(".split() has an empty delimiter", record.at);
      for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") stack.push(value);
    }
  }
}
