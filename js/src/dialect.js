// Dialects: loading pipeline documents and their grammars, reading grammar
// documents with the notation dialect (engine §8), and running a text
// through the stages (engine §13).

import { GencmuError } from "./errors.js";
import { Grammar } from "./grammar.js";
import { Stage } from "./stage.js";
import { treeToDom } from "./reader.js";
import { extractGrammarText, readPipeline, resolvePath, splitLines } from "./markdown.js";
import { characterTokens, Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
import { tagSet } from "./tags.js";

export const DOM_FORMAT = 1;

// Resources: a function from a path relative to the grammars root to its
// text, or undefined. The bundled grammars, a directory on disk and a map
// held in memory are all resources.
export class Loader {
  constructor(read) {
    this.read = read;
    this.unicode = new UnicodeTable(this.need("unicode.txt"));
    const bootstrap = JSON.parse(this.need("notation/bootstrap.json"));
    this.bootstrapHash = fnv1a64(this.need("notation/bootstrap.json"));
    this.notation = new Dialect("dialects/notation.md", bootstrap.stages.map((stage) =>
      new Stage(stage.name, new Grammar(stage.name, stage.documents.map((document) => ({ path: document.path, dom: document.dom }))))), this);
    this.compiled = new Map();
    const compiled = this.read("compiled.json");
    if (compiled !== undefined) {
      const data = JSON.parse(compiled);
      if (data.format === DOM_FORMAT && data.bootstrap === this.bootstrapHash) {
        for (const [path, entry] of Object.entries(data.documents)) this.compiled.set(path, entry);
      }
    }
    this.cache = new Map();
  }

  need(path) {
    const text = this.read(path);
    if (text === undefined) throw new GencmuError("grammar", `${path} was not found`, { document: path });
    return text;
  }

  // The DOM of a grammar document, from the cache when its text, the
  // bootstrap and the format all match, else read with the notation.
  documentDom(path) {
    const text = this.need(path);
    const hash = fnv1a64(text);
    const key = `${path}\u0000${hash}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = this.compiled.get(path);
    let dom;
    if (entry && entry.hash === hash) dom = entry.dom;
    else dom = this.readDocument(text, path);
    this.cache.set(key, dom);
    return dom;
  }

  // Reads a grammar document's Markdown into its DOM with the notation.
  readDocument(markdown, path) {
    const { text, positions } = extractGrammarText(markdown, path);
    const run = this.notation.parse(text, { features: new Set() });
    const positionOf = (token) => positions[token.source[0]] || positions[positions.length - 1] || [1, 1];
    if (!run.ok) {
      const error = run.error;
      const source = error.source || [0, 0];
      const [line, column] = positions[source[0]] || (positions.length ? positions[positions.length - 1] : [1, 1]);
      throw new GencmuError("grammar", `${path}:${line}:${column}: ${error.message}`, { document: path, line, column });
    }
    const syntax = run.stages[run.stages.length - 1];
    return treeToDom(syntax.tree, syntax.input, positionOf, path);
  }

  // A dialect from its pipeline document's path.
  dialect(path) {
    const markdown = this.need(path);
    const stages = readPipeline(markdown, path).map((stage) => new Stage(stage.name,
      new Grammar(stage.name, stage.documents.map((document) => {
        const documentPath = resolvePath(path, document);
        return { path: documentPath, dom: this.documentDom(documentPath) };
      }))));
    return new Dialect(path, stages, this);
  }
}

export class Dialect {
  constructor(path, stages, loader) {
    this.path = path;
    this.stages = stages;
    this.loader = loader;
  }

  // Parses a text. Options: features (a Set), autoFeatures, until (a stage
  // name), elisionOnly (true, false, or null for the grammar's own).
  parse(text, options = {}) {
    let features = new Set(options.features || []);
    if (options.autoFeatures && !features.has("sa-su") && this.stages.some((stage) => stage.name === "words")) {
      const probe = this.run(text, { ...options, features, until: "words" }, null);
      const words = probe.stages[probe.stages.length - 1];
      const needs = !words || words.name !== "words" || words.error || containsWord(words.tree, words.input, ["sa", "su"]);
      if (needs) features = new Set([...features, "sa-su"]);
      else if (options.until === "words") return probe;
      else return this.run(text, { ...options, features }, probe);
    }
    return this.run(text, { ...options, features }, null);
  }

  // Runs the stages, continuing a probe's stages where it stopped.
  run(text, options, continued) {
    const sourceText = [...text];
    const stages = continued ? continued.stages.slice() : [];
    let tokens = options.tokens || characterTokens(text, this.loader.unicode);
    if (continued) tokens = stages[stages.length - 1].output;
    const last = options.until ? this.stages.findIndex((stage) => stage.name === options.until) : this.stages.length - 1;
    if (last < 0) throw new GencmuError("grammar", `no stage is named ${options.until}`);
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
      tokens = report.output;
    }
    const final = stages[stages.length - 1];
    const error = stages.find((stage) => stage.error);
    const result = {
      ok: !error && stages.length === last + 1,
      stages,
      tree: error ? null : final.tree,
      error: error ? locate(error.error, text) : null,
      text,
    };
    return result;
  }
}

function containsWord(tree, tokens, words) {
  if (!tree) return false;
  if (tree.kind === "rule" && tree.rule === "word") {
    let phonemes = "";
    for (let index = tree.span[0]; index < tree.span[1]; index++) phonemes += tokens[index].phonemes || "";
    if (words.includes(phonemes)) return true;
  }
  return (tree.children || []).some((child) => containsWord(child, tokens, words));
}

// Adds the line and column of an error's source position.
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
export function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

void splitLines; void Token; void tagSet;
