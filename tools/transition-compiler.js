#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Loader } from "../lib/js/src/node.js";
import { Pipeline } from "../lib/js/src/pipeline.js";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { extractGrammarText, resolvePath } from "../lib/js/src/markdown.js";
import { GencmuError } from "../lib/js/src/errors.js";
import { NamesScope } from "../lib/js/src/unicode-names.js";
import { DocumentStrings } from "../lib/js/src/string-escapes.js";
import { fnv1a64 } from "../lib/js/src/hash.js";
import { compareCodePoints } from "../lib/js/src/tags.js";
import { DomBuilder } from "./transition/dom.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function readFile(file) {
  try {
    return decode.decode(fs.readFileSync(file));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function createTransitionCompiler(read) {
  const bundled = file => readFile(path.join(root, file));
  const loader = new Loader(bundled);
  const transition = loader.pipeline("tools/transition/pipeline.md");
  const unicodePath = "data/unicode/unicode.txt";
  const propertiesPath = "data/unicode/unicode-properties.txt";
  const sourceUnicode = read?.(unicodePath);
  const sourceProperties = read?.(propertiesPath);
  // The old reader needs the bundled table to load the compiler's own source.
  // The source being compiled can use a table supplied with that source.
  const unicode = sourceUnicode !== undefined || sourceProperties !== undefined
    ? new UnicodeTable(sourceUnicode ?? bundled(unicodePath), sourceProperties)
    : loader.unicode;
  const pipeline = unicode === loader.unicode ? transition
    : new Pipeline(transition.path, transition.stages, { unicode });
  const resource = file => {
    const bundledNames = "data/unicode/unicode-names.txt";
    return read?.(file) ?? (file === bundledNames || file === "data/unicode/unicode-names-reference.txt"
      ? bundled(bundledNames) : undefined);
  };
  const need = file => {
    const text = resource(file);
    if (text === undefined) throw new GencmuError("grammar", "the resource was not found", { document: file });
    return text;
  };
  const compileDocument = (markdown, document = "grammar.md", inherited = []) => {
    return documentEntry(markdown, document, inherited).dom;
  };

  function documentEntry(markdown, document, inherited = []) {
    const { text, positions } = extractGrammarText(markdown, document, unicode);
    const position = offset => positions[offset] ?? positions.at(-1) ?? [1, 1];
    const names = new NamesScope(need, unicode, inherited);
    const strings = new DocumentStrings(document, unicode, names, position);
    const result = pipeline.run(text, { features: new Set(), inspectLexical: tokens => strings.inspect(tokens) });
    if (!result.ok) {
      const error = result.error;
      if (error.kind === "ambiguous") {
        throw new GencmuError("grammar", error.message, { document, stage: error.stage });
      }
      const [line, column] = position(error.source?.[0] ?? 0);
      throw new GencmuError("grammar", error.message, { document, line, column, stage: error.stage });
    }
    const syntax = result.stages.at(-1);
    const dom = new DomBuilder(syntax.input, position, document, unicode, strings).build(syntax.tree);
    return { hash: fnv1a64(markdown), ...(names.dependencies && { names: names.dependencies }), dom };
  }

  function pipelineReadings(entry) {
    const documents = new Map();
    const active = [];
    const reached = new Set();
    const target = (document, directive) => {
      try {
        return resolvePath(document, directive.args[0]);
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        throw new GencmuError(error.kind, error.description,
          { document, line: directive.at[0], column: directive.at[1] });
      }
    };
    const visit = (document, inherited, from) => {
      const chain = () => [...active, document].join(" → ");
      if (active.includes(document)) {
        throw new GencmuError("grammar", `${document} includes itself (${chain()})`, from);
      }
      const identity = JSON.stringify([document, inherited]);
      if (reached.has(identity)) return;
      const text = read ? read(document) : bundled(document);
      if (text === undefined) {
        throw new GencmuError("grammar", `${document} was not found (${chain()})`, from ?? { document });
      }
      const compiled = documentEntry(text, document, inherited);
      reached.add(identity);
      if (!documents.has(document)) documents.set(document, []);
      documents.get(document).push({ inherited, entry: compiled });
      active.push(document);
      const names = [...inherited, ...compiled.dom.directives.filter(item => item.name === "names")
        .map(item => target(document, item))];
      const scope = [...new Set(names)].sort(compareCodePoints);
      for (const directive of compiled.dom.directives) {
        if (directive.name === "include") visit(target(document, directive), scope,
          { document, line: directive.at[0], column: directive.at[1] });
      }
      active.pop();
    };
    visit(entry, []);
    return new Map([...documents].sort(([a], [b]) => compareCodePoints(a, b)));
  }

  function compilePipeline(entry) {
    return Object.fromEntries([...pipelineReadings(entry)].map(([file, readings]) => {
      const first = readings[0].entry;
      return [file, readings.every(reading => JSON.stringify(reading.entry) === JSON.stringify(first)) ?
        first : { readings }];
    }));
  }
  return { compileDocument, compilePipeline, pipelineReadings, documentEntry, unicode };
}

function main() {
  const [kind, file, ...extra] = process.argv.slice(2);
  if (!["document", "pipeline"].includes(kind) || !file || extra.length) {
    throw new Error("usage: node tools/transition-compiler.js (document|pipeline) FILE");
  }
  const absolute = path.resolve(file);
  const relative = path.relative(root, absolute);
  const base = relative.startsWith("../") ? path.dirname(absolute) : root;
  const key = path.relative(base, absolute);
  const read = resource => readFile(path.join(base, resource));
  const compiler = createTransitionCompiler(read);
  const text = read(key);
  if (text === undefined) throw new Error(`${file}: the document was not found`);
  const result = kind === "document" ? compiler.compileDocument(text, key) : compiler.compilePipeline(key);
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
