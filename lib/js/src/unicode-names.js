import { GencmuError } from "./errors.js";
import { PINNED_NAMES_HASH } from "./unicode-names-catalog.js";
import { compareCodePoints } from "./tags.js";

/** @typedef {{code:number, name:string, kind:string, line:number}} NameRecord */
/** @typedef {{kind:string, first:number, last:number, prefix:string, line:number}} NameAlgorithm */
/** @import { UnicodeTable } from "./unicode.js" */

/** @param {string} path @param {string} message @param {number} [line] @returns {never} */
function namesFailure(path, message, line) {
  throw new GencmuError("grammar", `${path}${line === undefined ? "" : `:${line}`}: ${message}`,
    {document:path, ...(line === undefined ? {} : {line})});
}

/** @param {string} field @param {string} path @param {number} line @returns {number} */
function namesScalar(field, path, line) {
  const digits = field.replace(/^0+/, "");
  if (!/^[0-9A-Fa-f]+$/.test(field) || digits.length > 6) namesFailure(path, "an invalid scalar", line);
  const code = Number.parseInt(digits || "0", 16);
  if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) namesFailure(path, "an invalid scalar", line);
  return code;
}

const NAMES_HANGUL_L = ["G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"];
const NAMES_HANGUL_V = ["A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU", "YI", "I"];
const NAMES_HANGUL_T = ["", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S", "SS", "NG", "J", "C", "K", "T", "P", "H"];

/** @param {NameAlgorithm} rule @param {number} code @returns {string} */
function algorithmName(rule, code) {
  if (rule.kind === "hex") return rule.prefix + code.toString(16).toUpperCase().padStart(4, "0");
  const offset = code - 0xac00;
  return "HANGUL SYLLABLE " + NAMES_HANGUL_L[Math.floor(offset / 588)]
    + NAMES_HANGUL_V[Math.floor(offset % 588 / 28)] + NAMES_HANGUL_T[offset % 28];
}

/** @param {NameAlgorithm} rule @param {string} name @returns {number | undefined} */
function algorithmLookup(rule, name) {
  if (rule.kind === "hex") {
    if (!name.startsWith(rule.prefix)) return undefined;
    const suffix = name.slice(rule.prefix.length);
    if (!/^[0-9A-F]{4,6}$/.test(suffix)) return undefined;
    const code = Number.parseInt(suffix, 16);
    return code >= rule.first && code <= rule.last && algorithmName(rule, code) === name ? code : undefined;
  }
  if (!name.startsWith("HANGUL SYLLABLE ")) return undefined;
  const suffix = name.slice(16);
  for (let l = 0; l < NAMES_HANGUL_L.length; l++) {
    for (let v = 0; v < NAMES_HANGUL_V.length; v++) {
      const prefix = NAMES_HANGUL_L[l] + NAMES_HANGUL_V[v];
      if (!suffix.startsWith(prefix)) continue;
      const t = NAMES_HANGUL_T.indexOf(suffix.slice(prefix.length));
      if (t >= 0) return 0xac00 + (l * 21 + v) * 28 + t;
    }
  }
  return undefined;
}

/** @param {NameRecord} record @returns {string} */
function namesAliasKey(record) { return JSON.stringify([record.kind, record.code, record.name]); }

// The catalog remains a resource. Only its small core subset lives in code.
export class UnicodeNames {
  /** @param {string} text @param {string} path @param {string} version */
  constructor(text, path, version) {
    this.path = path;
    /** @type {NameRecord[]} */
    this.records = [];
    /** @type {Map<string, number>} */
    this.names = new Map();
    /** @type {Map<number, NameRecord>} */
    this.formal = new Map();
    /** @type {Set<string>} */
    this.aliases = new Set();
    /** @type {Set<number>} */
    this.scalars = new Set();
    /** @type {NameAlgorithm[]} */
    this.algorithms = [];
    let header = false;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = index + 1;
      const raw = index < lines.length - 1 ? lines[index].replace(/\r$/, "") : lines[index];
      const fields = raw.split(/[ \t]+/).filter(Boolean);
      if (!fields.length) continue;
      if (!header) {
        if (fields.length !== 2 || fields[0] !== "unicode-names" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(fields[1]) || fields[1] !== version) {
          namesFailure(path, "the names header must match the core version", line);
        }
        header = true;
        continue;
      }
      if (fields[0] === "name" || fields[0] === "alias") {
        const alias = fields[0] === "alias", start = alias ? 3 : 2;
        const kind = alias ? fields[1] : "name";
        if (fields.length <= start || alias && !["correction", "control", "alternate", "figment", "abbreviation"].includes(kind)) {
          namesFailure(path, "an invalid name record", line);
        }
        const code = namesScalar(fields[start - 1], path, line), name = fields.slice(start).join(" ");
        if (!/^[A-Z0-9 -]+$/.test(name)) namesFailure(path, "an invalid name spelling", line);
        const record = {code, name, kind, line};
        if (alias) {
          const key = namesAliasKey(record);
          if (this.aliases.has(key)) namesFailure(path, "a duplicate alias record", line);
          this.aliases.add(key);
        } else {
          if (this.formal.has(code)) namesFailure(path, "a scalar has more than one formal name", line);
          this.formal.set(code, record);
        }
        if (this.names.has(name) && this.names.get(name) !== code) namesFailure(path, "a name identifies different scalars", line);
        this.names.set(name, code);
        this.scalars.add(code);
        this.records.push(record);
      } else if (fields[0] === "algorithm") {
        const kind = fields[1];
        if (!(kind === "hex" && fields.length >= 5 || kind === "hangul" && fields.length === 4)) namesFailure(path, "an invalid naming algorithm", line);
        const first = namesScalar(fields[2], path, line), last = namesScalar(fields[3], path, line);
        const prefix = kind === "hex" ? fields.slice(4).join(" ") : "HANGUL SYLLABLE ";
        if (first > last || first <= 0xdfff && last >= 0xd800 || !/^[A-Z0-9 -]+$/.test(prefix)
          || kind === "hangul" && (first !== 0xac00 || last !== 0xd7a3)) namesFailure(path, "an invalid naming algorithm", line);
        if (this.algorithms.some(rule => rule.kind === kind && rule.prefix === prefix && first <= rule.last && last >= rule.first)) {
          namesFailure(path, "overlapping naming algorithms", line);
        }
        this.algorithms.push({kind, first, last, prefix, line});
      } else namesFailure(path, "an unknown names record", line);
    }
    if (!header) namesFailure(path, "the names header is missing");
    for (const record of this.records) {
      for (const rule of this.algorithms) {
        if (record.kind === "name" && record.code >= rule.first && record.code <= rule.last) namesFailure(path, "an explicit name lies in an algorithmic range", record.line);
        const code = algorithmLookup(rule, record.name);
        if (code !== undefined && code !== record.code) namesFailure(path, "a name identifies different scalars", record.line);
      }
    }
  }

  /** @param {string} name @returns {number | undefined} */
  lookup(name) {
    if (this.names.has(name)) return this.names.get(name);
    for (const rule of this.algorithms) {
      const code = algorithmLookup(rule, name);
      if (code !== undefined) return code;
    }
    return undefined;
  }

  /** @param {number} code @returns {boolean} */
  hasScalar(code) { return this.scalars.has(code) || this.algorithms.some(rule => code >= rule.first && code <= rule.last); }

  /** @param {UnicodeNames} pinned @param {Map<string, number>} abbreviations @param {boolean} extra */
  inspect(pinned, abbreviations, extra) {
    for (const rule of this.algorithms) {
      if (extra || !pinned.algorithms.some(known => known.kind === rule.kind && known.first === rule.first && known.last === rule.last && known.prefix === rule.prefix)) {
        namesFailure(this.path, "an algorithm must retain its pinned rule and range", rule.line);
      }
    }
    for (const record of this.records) {
      if (record.kind !== "name") {
        if (extra || !pinned.aliases.has(namesAliasKey(record))) namesFailure(this.path, "an alias must retain its pinned kind, spelling, and scalar", record.line);
      } else if (!extra && pinned.formal.get(record.code)?.name === record.name) {
        continue;
      } else if (pinned.hasScalar(record.code) || pinned.lookup(record.name) !== undefined
        || !/^[A-Z][A-Z0-9 -]*$/.test(record.name) || abbreviations.has(record.name)) {
        namesFailure(this.path, "an added name must name an unnamed scalar without a reserved spelling", record.line);
      }
    }
  }
}

export class NamesScope {
  /**
   * @param {(path:string)=>string} read
   * @param {UnicodeTable} unicode
   * @param {(text:string)=>string} fingerprint
   * @param {Iterable<string>} [extras]
   */
  constructor(read, unicode, fingerprint, extras = []) {
    this.read = read;
    this.unicode = unicode;
    this.fingerprint = fingerprint;
    this.extras = [...new Set(extras)].sort(compareCodePoints);
    /** @type {UnicodeNames[] | null} */
    this.tables = null;
    /** @type {Record<string,string> | undefined} */
    this.dependencies = undefined;
  }

  load() {
    if (this.tables !== null) return;
    const version = this.unicode.version;
    if (this.unicode.versionCount !== 1 || version === null) namesFailure("unicode.txt", "names require exactly one Unicode version");
    const text = this.read("unicode-names.txt");
    const hash = this.fingerprint(text);
    const base = new UnicodeNames(text, "unicode-names.txt", version);
    const reference = hash === PINNED_NAMES_HASH ? text : this.read("unicode-names-reference.txt");
    if (this.fingerprint(reference) !== PINNED_NAMES_HASH) namesFailure("unicode-names-reference.txt", "the reference fingerprint differs from the pinned data");
    if (version !== "15.1.0") namesFailure("unicode-names-reference.txt", "the reference version differs from the selected names version");
    const pinned = hash === PINNED_NAMES_HASH ? base : new UnicodeNames(reference, "unicode-names-reference.txt", "15.1.0");
    base.inspect(pinned, this.unicode.abbreviations, false);
    const tables = [base];
    /** @type {Record<string,string>} */
    const dependencies = {"unicode-names.txt": hash};
    for (const path of this.extras) {
      const text = this.read(path), table = new UnicodeNames(text, path, version);
      table.inspect(pinned, this.unicode.abbreviations, true);
      for (const record of table.records) {
        for (const earlier of tables) {
          const code = earlier.lookup(record.name), formal = earlier.formal.get(record.code);
          if (code !== undefined && code !== record.code || formal && formal.name !== record.name) namesFailure(path, "names resources conflict", record.line);
        }
      }
      dependencies[path] = this.fingerprint(text);
      tables.push(table);
    }
    this.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => compareCodePoints(a, b)));
    this.tables = tables;
  }

  /** @param {string} name @param {boolean} [coreOnly] @returns {number | undefined} */
  lookup(name, coreOnly = false) {
    const core = this.unicode.abbreviations.get(name);
    if (core !== undefined || coreOnly) return core;
    this.load();
    for (const table of /** @type {UnicodeNames[]} */ (this.tables)) {
      const code = table.lookup(name);
      if (code !== undefined) return code;
    }
    return undefined;
  }
}
