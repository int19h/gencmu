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

export function createTransitionCompiler(read = file => readFile(path.join(root, file))) {
  const bundled = file => readFile(path.join(root, file));
  const loader = new Loader(bundled);
  const transition = loader.pipeline("tools/transition/pipeline.md");
  const unicodePath = "data/unicode/unicode.txt";
  const propertiesPath = "data/unicode/unicode-properties.txt";
  const bundledUnicode = bundled(unicodePath);
  const bundledProperties = bundled(propertiesPath);
  const sourceUnicode = read(unicodePath) ?? bundledUnicode;
  const sourceProperties = read(propertiesPath) ?? bundledProperties;
  const customCore = sourceUnicode !== bundledUnicode;
  // The old reader needs the bundled table to load the compiler's own source.
  // The source being compiled can use a table supplied with that source.
  const unicode = customCore || sourceProperties !== bundledProperties
    ? new UnicodeTable(sourceUnicode, customCore && sourceProperties === bundledProperties ? undefined : sourceProperties)
    : loader.unicode;
  const pipeline = unicode === loader.unicode ? transition
    : new Pipeline(transition.path, transition.stages, { unicode });
  const need = file => {
    const bundledNames = "data/unicode/unicode-names.txt";
    const text = read(file) ?? (file === bundledNames || file === "data/unicode/unicode-names-reference.txt"
      ? bundled(bundledNames) : undefined);
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

  function compilePipeline(entry) {
    const documents = new Map();
    const active = new Set();
    const visit = (document, inherited) => {
      if (active.has(document)) throw new GencmuError("grammar", "include cycle", { document });
      const compiled = documentEntry(need(document), document, inherited);
      const previous = documents.get(document);
      if (previous && JSON.stringify(previous) !== JSON.stringify(compiled)) {
        throw new GencmuError("grammar", "this include produces different records in two names scopes", { document });
      }
      if (previous) return;
      documents.set(document, compiled);
      active.add(document);
      const names = [...inherited, ...compiled.dom.directives.filter(item => item.name === "names")
        .map(item => resolvePath(document, item.args[0]))];
      for (const directive of compiled.dom.directives) {
        if (directive.name === "include") visit(resolvePath(document, directive.args[0]), names);
      }
      active.delete(document);
    };
    visit(entry, []);
    return Object.fromEntries([...documents].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  return { compileDocument, compilePipeline, documentEntry, unicode };
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
  const read = resource => readFile(path.join(base, resource)) ?? readFile(path.join(root, resource));
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
