// Package-relative keys shared by resource loading and generation.
export const BOOTSTRAP_PATH = "data/preparsed/gencmu.json";
export const NOTATION_PATH = "grammars/dialects/notation.md";

/** @param {string} document @returns {string | undefined} */
export function preparsedPath(document) {
  if (!document.startsWith("grammars/")) return undefined;
  const family = document.split("/")[1];
  // The family move replaces these stage directories in the next step.
  if (document === NOTATION_PATH || family === "notation") return BOOTSTRAP_PATH;
  if (["dialects", "phonemes", "words", "indicators", "syntax"].includes(family)) return "data/preparsed/lojban.json";
  return /^[a-z0-9][a-z0-9-]*$/.test(family) ? `data/preparsed/${family}.json` : undefined;
}
