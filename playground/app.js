(function () {
  "use strict";
  const input = document.getElementById("input");
  const output = document.getElementById("output");
  const status = document.getElementById("status");
  let parser;
  try {
    parser = startParserWorker();
  } catch (error) {
    status.textContent = "worker failed: " + error;
    status.dataset.state = "error";
    return;
  }
  const loaded = parser.load(self.gencmuGrammars);
  async function run() {
    try {
      await loaded;
      const result = await parser.parse(input.value, { dialect: "cll", features: [] });
      output.textContent = JSON.stringify(result, null, 2);
      status.textContent = "ready";
      status.dataset.state = "ready";
    } catch (error) {
      status.textContent = "parse failed: " + error.message;
      status.dataset.state = "error";
    }
  }
  input.addEventListener("input", run);
  run();
})();
