// Package-relative keys shared by resource loading and generation.
export const BOOTSTRAP_PATH = "data/preparsed/gencmu.json";
export const NOTATION_PATH = "grammars/gencmu/jbogenbau/pipeline.md";

/** @param {string} document @returns {string | undefined} */
export function preparsedPath(document) {
  if (!document.startsWith("grammars/")) return undefined;
  const rest = document.slice("grammars/".length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) return undefined;
  const family = rest.slice(0, slash);
  return /^[a-z0-9][a-z0-9-]*$/.test(family) ? `data/preparsed/${family}.json` : undefined;
}
