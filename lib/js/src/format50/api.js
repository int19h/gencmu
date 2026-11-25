// @ts-nocheck
// The entry points that select notation 50 (docs/api.md, "Loading a
// pipeline"). The unversioned entry points keep notation 49.

import { GencmuError } from "../errors.js";
import { checkSourceStrings } from "../pipeline.js";
import { validPipelineName } from "../resources.js";
import { Loader50, BUNDLE_50 } from "./loader.js";
import { resultJson50, decodeResult50 } from "./result.js";

/** Refuses a notation version that this library cannot load. */
export function requireNotation50(version) {
  if (version !== 50) throw new GencmuError("usage", `notation ${JSON.stringify(version)} is not supported by this loader factory`);
}

/** The bundled pipeline names of a list of resource paths. */
export function bundledPipelines50(paths) {
  const prefix = `${BUNDLE_50.sourceRoot}/`;
  return paths.filter(file => file.startsWith(prefix) && file.endsWith("/pipeline.md"))
    .map(file => file.slice(prefix.length, -"/pipeline.md".length))
    .filter(validPipelineName).sort();
}

/**
 * The loaders of notation 50 over documents held in memory.
 * @param {number} version
 */
export function portableLoaders(version) {
  requireNotation50(version);
  const loaderFromSources = sources => {
    const map = new Map(sources instanceof Map ? sources : Object.entries(sources));
    checkSourceStrings(map);
    return new Loader50(file => map.get(file));
  };
  return {
    notation: 50,
    loaderFromSources,
    loadPipelineSources: (sources, pipelinePath) => loaderFromSources(sources).pipeline(pipelinePath),
    resultJson: resultJson50,
    decodeResult: decodeResult50,
  };
}
