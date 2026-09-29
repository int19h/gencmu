// Loading gencmu's grammars from disk in Node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, Dialect } from "./dialect.js";

export * from "./index.js";
import { GencmuError } from "./errors.js";

// The grammars shipped with the package, or, in a clone of the repository,
// the repository's own.
/** @returns {string} */
export function bundledGrammarsDirectory() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "grammars"), path.join(here, "..", "..", "..", "grammars")]) {
    if (fs.existsSync(path.join(candidate, "unicode.txt"))) return candidate;
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
 * found before anything hashes it or looks it up in compiled.json
 * (engine §1). compiled.json itself is only a cache, so bytes of it that do
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
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return utf8.decode(bytes);
  } catch {
    if (document === "compiled.json") return undefined;
    throw new GencmuError("grammar", `${document}: the document is not valid UTF-8: an invalid byte sequence at byte ${invalidUtf8At(bytes)}`, { document });
  }
}

// A loader over a directory of grammars, the bundled one by default.
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export function loaderFromDirectory(directory = bundledGrammarsDirectory()) {
  return new Loader((relative) => readUtf8(path.join(directory, ...relative.split("/")), relative));
}

// The files a dialect from disk or memory takes from the bundled grammars
// when it does not supply them.
const SHARED = ["unicode.txt", "notation/bootstrap.json", "compiled.json"];

/** @type {Map<string, string | undefined>} */
const bundled = new Map();
/**
 * @param {string} relative
 * @returns {string | undefined}
 */
function readBundled(relative) {
  if (!bundled.has(relative)) {
    const file = path.join(bundledGrammarsDirectory(), ...relative.split("/"));
    bundled.set(relative, readUtf8(file, relative));
  }
  return bundled.get(relative);
}

/**
 * A bundled dialect by name: `grammars/dialects/NAME.md`.
 * @param {string} name
 * @returns {Dialect}
 */
export function loadDialect(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) throw new GencmuError("grammar", `no bundled dialect is named ${JSON.stringify(name)}`);
  return loaderFromDirectory().dialect(`dialects/${name}.md`);
}

/**
 * A dialect from a pipeline document on disk; its grammar documents are
 * found relative to it, and the Unicode table and the bootstrap come from
 * the bundled grammars.
 * @param {string} file
 * @returns {Dialect}
 */
export function loadDialectFile(file) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  const loader = new Loader((relative) => {
    if (SHARED.includes(relative)) return relative === "compiled.json" ? undefined : readBundled(relative);
    return readUtf8(path.join(root, ...relative.split("/")), relative);
  });
  return loader.dialect(path.relative(root, absolute).split(path.sep).join("/"));
}

/**
 * A dialect from documents held in memory, a map or a plain object from path
 * to text, and the path of the pipeline document among them. The Unicode
 * table, the bootstrap and the precompiled DOMs come from the bundled
 * grammars unless the map has its own.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Dialect}
 */
export function loadDialectSources(sources, pipelinePath) {
  const map = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new Loader((relative) => (map.has(relative) ? map.get(relative) : SHARED.includes(relative) ? readBundled(relative) : undefined))
    .dialect(pipelinePath);
}
