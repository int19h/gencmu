// Builds the parser worker from sources already loaded in the page, so that
// nothing is fetched: this is what lets the playground run from file://.
(function (root) {
  "use strict";
  function workerSource() {
    return [
      "var gencmuFactory = " + root.gencmuFactory.toString() + ";",
      "var gencmu = gencmuFactory();",
      "var gencmuGrammars = " + JSON.stringify(root.gencmuGrammars) + ";",
      "self.onmessage = function (event) {",
      "  var request = event.data;",
      "  try {",
      "    self.postMessage({ id: request.id, result: gencmu.parse(request.text, gencmuGrammars) });",
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
    return {
      parse(text) {
        const id = next++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, text });
        });
      },
    };
  }
  root.startParserWorker = startParserWorker;
})(self);
