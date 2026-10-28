// Package-relative keys shared by resource loading and generation.
export const BOOTSTRAP_PATH = "data/preparsed/gencmu.json";
export const NOTATION_PATH = "grammars/gencmu/jbogenbau/pipeline.md";

/** @param {string} name @returns {boolean} */
export function validPipelineName(name) {
  const segments = name.split("/");
  return segments.length >= 2 && segments.every(validSegment);
}

/** @param {string} segment */
function validSegment(segment) {
  return /^[a-z0-9][a-z0-9-]*$/.exec(segment)?.[0] === segment;
}

/**
 * Lists valid pipeline names without reading their documents.
 * @param {Map<string,string> | Record<string,string>} [sources]
 * @returns {string[]}
 */
export function bundledPipelines(sources) {
  const paths = sources instanceof Map ? [...sources.keys()] : Object.keys(sources ?? {});
  return paths.filter(path => path.startsWith("grammars/") && path.endsWith("/pipeline.md"))
    .map(path => path.slice("grammars/".length, -"/pipeline.md".length))
    .filter(validPipelineName).sort();
}

/** @param {string} document @returns {string | undefined} */
export function preparsedPath(document) {
  if (!document.startsWith("grammars/")) return undefined;
  const rest = document.slice("grammars/".length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) return undefined;
  const family = rest.slice(0, slash);
  return validSegment(family) ? `data/preparsed/${family}.json` : undefined;
}
