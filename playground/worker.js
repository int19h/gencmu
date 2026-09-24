// Builds the parser worker from sources already loaded in the page, so that
// nothing is fetched: this is what lets the playground run from file://.
//
// Protocol: the page sends { id, kind: "load", sources } with the grammar
// documents as a map from path to text, which the playground's editor may
// have changed, and { id, kind: "parse", text, options }, where options hold
// the dialect and features. The worker answers { id, result } or
// { id, error }.
(function (root) {
  "use strict";
  function workerSource() {
    return [
      "var gencmu = (" + root.gencmuFactory.toString() + ")();",
      "self.onmessage = function (event) {",
      "  var request = event.data;",
      "  try {",
      "    var result = request.kind === 'load'",
      "      ? gencmu.load(request.sources)",
      "      : gencmu.parse(request.text, request.options);",
      "    self.postMessage({ id: request.id, result: result });",
      "  } catch (error) {",
      "    self.postMessage({ id: request.id, error: String(error && error.stack || error) });",
      "  }",
      "};",
    ].join("\n");
  }
  function startParserWorker() {
    const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    const worker = new Worker(url);
    let next = 0;
    const pending = new Map();
    worker.onerror = (event) => {
      event.preventDefault();
      const error = new Error(`parser worker failed: ${event.message || "unknown error"}`);
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      pending.delete(id);
      if (entry) error ? entry.reject(new Error(error)) : entry.resolve(result);
    };
    function send(message) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(Object.assign({ id }, message));
      });
    }
    return {
      load: (sources) => send({ kind: "load", sources }),
      parse: (text, options) => send({ kind: "parse", text, options }),
    };
  }
  root.startParserWorker = startParserWorker;
})(self);
