import assert from "node:assert/strict";
import { DOM_FORMAT } from "../src/dom.js";
import { fnv1a64 } from "../src/pipeline.js";

export function notationCachePaths(loader, document, file, dom, load) {
  file = `grammars/test/${file}`;
  const envelope = {
    format: DOM_FORMAT, bootstrap: loader.bootstrapHash, unicode: loader.unicodeHash, properties: loader.propertiesHash,
    documents: {[file]: {hash: fnv1a64(document), dom}},
  };
  assert.deepEqual(load(undefined,file).documentDom(file), dom, "cold load");
  const cached = load(envelope,file);
  assert.deepEqual(cached.documentDom(file), dom, "matching cache");
  assert.equal(cached.preparsed.size, 1);
  for (const key of ["document", "bootstrap", "unicode", "format"]) {
    const stale = structuredClone(envelope);
    stale.documents[file].dom.rules[0].name = "cache-poison";
    if (key === "document") stale.documents[file].hash = fnv1a64("another document");
    else if (key === "format") stale.format = DOM_FORMAT - 1;
    else stale[key] = fnv1a64("another " + key);
    const missed = load(stale,file);
    assert.deepEqual(missed.documentDom(file), dom, `${key} mismatch`);
    assert.deepEqual(missed.documentDom(file), dom, `${key} mismatch after rereading`);
  }
}
