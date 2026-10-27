// Loading gencmu's grammars from disk in Node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, Pipeline } from "./pipeline.js";
import { bundledPipelines as sourcePipelines, validPipelineName } from "./resources.js";

export * from "./index.js";
import { GencmuError } from "./errors.js";

// The grammars shipped with the package, or, in a clone of the repository,
// the repository's own.
/** @returns {string} */
export function bundledGrammarsDirectory() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "grammars"), path.join(here, "..", "..", "..", "grammars")]) {
    if (fs.existsSync(path.join(candidate, "..", "data", "unicode", "unicode.txt"))) return candidate;
  }
  throw new Error("gencmu: no grammars directory next to the package");
}

// Strict UTF-8, which keeps a byte order mark as the character U+FEFF.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The offset of the first byte that does not begin a valid UTF-8 sequence,
 * or -1: for the message of a document that does not decode.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function invalidUtf8At(bytes) {
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i];
    if (lead < 0x80) {
      i++;
      continue;
    }
    let length = 0;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) length = 1;
    else if (lead >= 0xe0 && lead <= 0xef) {
      length = 2;
      if (lead === 0xe0) low = 0xa0;
      if (lead === 0xed) high = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      length = 3;
      if (lead === 0xf0) low = 0x90;
      if (lead === 0xf4) high = 0x8f;
    } else return i;
    for (let k = 1; k <= length; k++) {
      const byte = bytes[i + k];
      if (byte === undefined || byte < (k === 1 ? low : 0x80) || byte > (k === 1 ? high : 0xbf)) return i;
    }
    i += length + 1;
  }
  return -1;
}

/**
 * A file's text, decoded as strict UTF-8, or undefined when there is no
 * such file. Bytes that do not decode are a grammar error of the document,
 * found before anything hashes it or looks it up in data/preparsed/lojban.json
 * (engine §1). data/preparsed/lojban.json itself is only a cache, so bytes of it that do
 * not decode make it absent, a miss for every document.
 * @param {string} file
 * @param {string} document the path the loader knows the document by
 * @returns {string | undefined}
 */
function readUtf8(file, document) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT" || (document.startsWith("data/preparsed/") && document !== "data/preparsed/gencmu.json")) return undefined;
    throw error;
  }
  try {
    return utf8.decode(bytes);
  } catch {
    if (document.startsWith("data/preparsed/") && document !== "data/preparsed/gencmu.json") return undefined;
    throw new GencmuError("grammar", `${document}: the document is not valid UTF-8: an invalid byte sequence at byte ${invalidUtf8At(bytes)}`, { document });
  }
}

// A loader over a package root, the bundled one by default.
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export function loaderFromDirectory(directory = path.dirname(bundledGrammarsDirectory())) {
  return new Loader((relative) => {
    if (relative === "data/unicode/unicode-names-reference.txt") return readBundled("data/unicode/unicode-names.txt");
    const text = readUtf8(path.join(directory, relative.split("/").join(path.sep)), relative);
    if (relative === "data/unicode/unicode-properties.txt" && text === undefined && path.resolve(directory) === path.resolve(path.dirname(bundledGrammarsDirectory()))) {
      throw new GencmuError("grammar", "data/unicode/unicode-properties.txt is missing", {document:relative});
    }
    return text;
  },
    () => path.resolve(directory) !== path.resolve(path.dirname(bundledGrammarsDirectory())));
}

// The files a pipeline from disk or memory takes from the bundled grammars
// when it does not supply them.
const SHARED = ["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt", "data/unicode/unicode-names-reference.txt", "grammars/lojban/common/zbalermorna-names.txt", "data/preparsed/gencmu.json"];

/** @type {Map<string, string | undefined>} */
const bundled = new Map();
/**
 * @param {string} relative
 * @returns {string | undefined}
 */
function readBundled(relative) {
  if (relative === "data/unicode/unicode-names-reference.txt") relative = "data/unicode/unicode-names.txt";
  if (!bundled.has(relative)) {
    const directory = path.dirname(bundledGrammarsDirectory());
    const file = path.join(directory, relative.split("/").join(path.sep));
    bundled.set(relative, readUtf8(file, relative));
  }
  if (relative === "data/unicode/unicode-properties.txt" && bundled.get(relative) === undefined) throw new GencmuError("grammar", "data/unicode/unicode-properties.txt is missing", {document:relative});
  return bundled.get(relative);
}

/**
 * A bundled pipeline by name: `grammars/NAME/pipeline.md`.
 * @param {string} name
 * @returns {Pipeline}
 */
export function loadPipeline(name) {
  if (!validPipelineName(name) || !bundledPipelines().includes(name)) {
    throw new GencmuError("usage", `no bundled pipeline is named ${JSON.stringify(name)}`);
  }
  return loaderFromDirectory().pipeline(`grammars/${name}/pipeline.md`);
}

/**
 * Lists the package's pipelines, or those of a supplied source map.
 * @param {Map<string,string> | Record<string,string>} [sources]
 * @returns {string[]}
 */
export function bundledPipelines(sources) {
  if (sources !== undefined) return sourcePipelines(sources);
  const directory = bundledGrammarsDirectory();
  const files = fs.readdirSync(directory, {recursive:true, encoding:"utf8"})
    .filter(file => file.endsWith(path.sep + "pipeline.md") && fs.statSync(path.join(directory,file)).isFile());
  return sourcePipelines(new Map(files.map(file => [`grammars/${file.split(path.sep).join("/")}`, ""])));
}

/**
 * A pipeline from a pipeline document on disk; its grammar documents are
 * found relative to it, and the Unicode table and the bootstrap come from
 * the bundled grammars. Each document is known by its absolute path, with
 * `/` between the parts, so an error names the file wherever the process
 * runs.
 * @param {string} file
 * @returns {Pipeline}
 */
export function loadPipelineFile(file) {
  const absolute = path.resolve(file).split(path.sep).join("/");
  const loader = new Loader((key) => {
    if (key === "data/unicode/unicode-names-reference.txt") return readBundled(key);
    if (SHARED.includes(key) && key !== "data/unicode/unicode-names.txt" && key !== "grammars/lojban/common/zbalermorna-names.txt") return readBundled(key);
    return readUtf8(key.split("/").join(path.sep), key) ?? (SHARED.includes(key) ? readBundled(key) : undefined);
  }, key => {
    if (key === "data/unicode/unicode-names-reference.txt") return false;
    try { fs.statSync(key.split("/").join(path.sep)); return true; }
    catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT"; }
  });
  return loader.pipeline(absolute);
}

/**
 * A pipeline from documents held in memory, a map or a plain object from path
 * to text, and the path of the pipeline document among them. The Unicode
 * table, the bootstrap and the preparsed DOMs come from the bundled
 * grammars unless the map has its own.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Pipeline}
 */
export function loadPipelineSources(sources, pipelinePath) {
  const map = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new Loader((relative) => {
    if (map.has(relative)) return map.get(relative);
    if (relative === "data/unicode/unicode-properties.txt" && map.has("data/unicode/unicode.txt")) return undefined;
    return SHARED.includes(relative) || relative.startsWith("data/preparsed/") ? readBundled(relative) : undefined;
  }, relative => map.has(relative))
    .pipeline(pipelinePath);
}
