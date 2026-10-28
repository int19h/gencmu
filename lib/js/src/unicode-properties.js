import { GencmuError } from "./errors.js";
import { PROPERTY_CATALOG } from "./unicode-property-catalog.js";

/** @typedef {{first:number,last:number,values:string[],line:number}} PropertyRange */
/** @typedef {{kind:string,values:Set<string>,defaults:string[],ranges:PropertyRange[],line:number}} PropertyData */

/** @param {number | undefined} line @returns {never} */
function propertyResourceError(line) {
  throw new GencmuError("grammar", "the property record is invalid", {document:"data/unicode/unicode-properties.txt", ...(line === undefined ? {} : {line})});
}

/**
 * Inspect a complete companion before any notation or cache use (engine §1).
 * @param {string} text
 * @param {{version:string|null,versionCount:number}} core
 * @returns {Map<string,PropertyData>}
 */
export function readProperties(text, core) {
  /** @type {Map<string,PropertyData>} */
  const properties = new Map();
  /** @type {{fields:string[],line:number}[]} */
  const pending = [];
  let header = false;
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const fields = (index < lines.length - 1 ? raw.replace(/\r$/, "") : raw).split(/[ \t]+/).filter(Boolean);
    if (!fields.length) continue;
    const fail = () => propertyResourceError(line);
    if (!header) {
      if (fields.length !== 2 || fields[0] !== "unicode-properties" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(fields[1])
        || core.versionCount !== 1 || core.version !== fields[1]) fail();
      header = true;
      continue;
    }
    const [kind, name] = fields;
    if (!Object.hasOwn(PROPERTY_CATALOG.types, name) || PROPERTY_CATALOG.core.includes(name)) fail();
    if (["binary", "enumerated", "multiple"].includes(kind)) {
      if (kind !== PROPERTY_CATALOG.types[name] || properties.has(name)
        || (kind === "binary" ? fields.length !== 2 : kind === "enumerated" ? fields.length !== 3 : fields.length < 3)) fail();
      const defaults = fields.slice(2).sort();
      if (new Set(defaults).size !== defaults.length) fail();
      properties.set(name, {kind, values:new Set(), defaults, ranges:[], line});
    } else if (kind === "value" || kind === "range") pending.push({fields,line});
    else fail();
  }
  if (!header) propertyResourceError(undefined);
  for (const {fields, line} of pending) {
    const fail = () => propertyResourceError(line);
    const [kind, name] = fields;
    const property = properties.get(name);
    if (!property) propertyResourceError(line);
    if (kind === "value") {
      if (fields.length !== 3 || property.kind === "binary" || !PROPERTY_CATALOG.values[name].includes(fields[2])
        || property.values.has(fields[2])) fail();
      property.values.add(fields[2]);
    } else {
      if (property.kind === "binary" ? fields.length !== 4 : property.kind === "enumerated" ? fields.length !== 5 : fields.length < 5) fail();
      /** @param {string} field */
      const code = field => {
        if (!/^[0-9a-fA-F]+$/.test(field)) fail();
        const digits = field.replace(/^0+/, "");
        if (digits.length > 6) fail();
        const value = Number.parseInt(digits || "0",16);
        if (value > 0x10ffff) fail();
        return value;
      };
      const first = code(fields[2]), last = code(fields[3]);
      if (first > last || first <= 0xdfff && last >= 0xd800) fail();
      const values = property.kind === "binary" ? ["Yes"] : fields.slice(4).sort();
      if (new Set(values).size !== values.length) fail();
      property.ranges.push({first,last,values,line});
    }
  }
  for (const property of properties.values()) {
    if (property.defaults.some(value => !property.values.has(value))) propertyResourceError(property.line);
    property.ranges.sort((a,b) => a.first - b.first || a.last - b.last || a.line - b.line);
    /** @type {PropertyRange[]} */
    const merged = [];
    for (const range of property.ranges) {
      if (property.kind !== "binary" && range.values.some(value => !property.values.has(value))) propertyResourceError(range.line);
      const previous = merged.at(-1);
      const equal = previous && previous.values.length === range.values.length && previous.values.every((value,i) => value === range.values[i]);
      if (previous && range.first <= previous.last && !equal) propertyResourceError(range.line);
      if (previous && range.first <= previous.last + 1 && equal) previous.last = Math.max(previous.last, range.last);
      else merged.push(range);
    }
    property.ranges = merged;
  }
  return properties;
}
