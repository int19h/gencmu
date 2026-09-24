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
      const answer = await parser.parse(input.value, { dialect: "dialects/notation.md", features: [] });
      output.textContent = JSON.stringify({ version: answer.version, ok: answer.result.ok, brackets: answer.brackets }, null, 2) +
        "\n\n" + answer.tree;
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
