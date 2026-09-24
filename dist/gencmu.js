// Placeholder library for the file:// proof: the real bundle replaces it.
// The library is one factory function, so that the page can hand its source
// to a worker built from a Blob, which fetches nothing.
(function (root) {
  "use strict";
  function gencmuFactory() {
    return {
      version: "0.0.0-proof",
      parse(text, grammars) {
        const words = text.split(/\s+/).filter(Boolean);
        return { ok: true, words, documents: Object.keys(grammars || {}).length };
      },
    };
  }
  root.gencmuFactory = gencmuFactory;
  root.gencmu = gencmuFactory();
})(typeof self !== "undefined" ? self : this);
