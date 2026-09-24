// Placeholder library for the file:// proof: the real bundle replaces it.
// The whole library lives inside one factory function, with no reference to
// anything outside it, so that the page can hand the factory's source to a
// worker built from a Blob, which fetches nothing. The bundler guarantees
// this for the real library; the worker reports the version it computed
// itself, which the smoke test checks.
(function (root) {
  "use strict";
  function gencmuFactory() {
    const version = "0.0.0-proof";
    let sources = {};
    return {
      version,
      load(documents) {
        sources = Object.assign({}, documents);
        return { documents: Object.keys(sources).length };
      },
      parse(text, options) {
        const words = text.split(/\s+/).filter(Boolean);
        return { ok: true, version, words, options: options || {}, documents: Object.keys(sources).length };
      },
    };
  }
  root.gencmuFactory = gencmuFactory;
  root.gencmu = gencmuFactory();
})(typeof self !== "undefined" ? self : this);
