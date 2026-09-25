// The playground page: the text, the dialect and its options, the grammar
// editor, and the results the parser worker (playground/worker.js) renders.
//
// The page keeps its state in one object, sends the whole of it to the
// worker whenever it changes, and draws whatever answer comes back. The
// worker caches the dialect, the parse and each rendering, so asking again
// for what it already has costs little. At most one run is in flight; a
// change while one runs waits for it, unless the run has gone on long
// enough to be worth stopping, in which case the worker is replaced.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const bundled = self.gencmuGrammars;

  // How long a run whose answer is no longer wanted may go on before its
  // worker is replaced. Most parses take tens of milliseconds, and a new
  // worker needs about as long again to start, so waiting is usually cheaper.
  const RESTART_AFTER = 200;
  // Pauses after typing before parsing: in the text, and in a grammar, where
  // an edited document must be read again with the notation grammar.
  const TEXT_DELAY = 150;
  const GRAMMAR_DELAY = 400;

  // ---- Documents and dialects ---------------------------------------------

  // The first heading of a Markdown document, without a processing
  // instruction at its end.
  function firstHeading(markdown) {
    const match = /^#\s+(.*)$/m.exec(markdown || "");
    return match ? match[1].replace(/\s*<\?.*\?>\s*$/, "").trim() : "";
  }

  // A path relative to a document, resolved and normalized, as the library
  // resolves a pipeline's links.
  function resolvePath(from, relative) {
    const parts = from.split("/").slice(0, -1);
    for (const part of relative.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  }

  // The stages of a pipeline document and their documents' paths: the same
  // reading as the library's (design, "Pipelines"), but forgiving, so that
  // the editor can list the documents of a pipeline that has an error.
  function pipelineStages(path, markdown) {
    const stages = [];
    for (const raw of (markdown || "").split(/\r\n|\r|\n/)) {
      const line = raw.replace(/\s+$/, "");
      const marker = /<\?([a-z]+)(?:\s+([^?]*?))?\s*\?>$/.exec(line);
      if (!marker) continue;
      if (marker[1] === "stage") stages.push({ name: (marker[2] || "").trim() || "?", documents: [] });
      else if (marker[1] === "grammar" && stages.length) {
        const link = /\[[^\]]*\]\(([^\s()\\]+)\)/.exec(line.slice(0, marker.index));
        if (link) stages[stages.length - 1].documents.push(resolvePath(path, link[1]));
      }
    }
    return stages;
  }

  const DIALECT_ORDER = ["cll-ebnf", "bpfk", "experimental", "zantufa", "notation"];
  const dialectName = (path) => path.replace(/^dialects\//, "").replace(/\.md$/, "");
  const dialectPaths = Object.keys(bundled).filter((path) => /^dialects\/[^/]+\.md$/.test(path)).sort((a, b) => {
    const rank = (path) => { const index = DIALECT_ORDER.indexOf(dialectName(path)); return index < 0 ? DIALECT_ORDER.length : index; };
    return rank(a) - rank(b) || (a < b ? -1 : 1);
  });

  const EXAMPLES = [
    { label: "A sentence", text: "mi klama le zarci", dialect: "cll-ebnf" },
    { label: "Elided terminators", text: "lo lojbo cu tavla fi lo nu mi klama le zarci .i do pu tavla mi", dialect: "cll-ebnf" },
    { label: "A text the syntax rejects", text: "mi klama le le", dialect: "cll-ebnf" },
    { label: "The eraser sa, with auto features", text: "mi klama sa do", dialect: "cll-ebnf" },
    { label: "Cyrillic orthography", text: "ми клама ле зарши", dialect: "cll-ebnf" },
    { label: "An elided terminator the PEG reading forbids (BPFK)", text: "le lojbo se farvi le loglo gi'enai mintu ja dunli le logla", dialect: "bpfk" },
    { label: "A tie in the words stage (BPFK)", text: "ko na krici fi locesyselmanci", dialect: "bpfk" },
    { label: "Ambiguous beyond elision (experimental, elision-only on)", text: "la olivian na klama", dialect: "experimental", elision: "on" },
    { label: "A rule in jbogenbau", text: "%rule sumti-tail\n  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1", dialect: "notation" },
  ];

  // ---- State ----------------------------------------------------------------

  const state = {
    text: $("input").value,
    dialect: dialectPaths.includes("dialects/cll-ebnf.md") ? "dialects/cll-ebnf.md" : dialectPaths[0],
    // The features the page turns on, and those it turns off among the
    // ones the dialect turns on.
    features: new Set(),
    without: new Set(),
    autoFeatures: true,
    elision: "",
    until: "",
    tab: "brackets",
    showElided: false,
    pretty: true,
    tokenStage: "",
    trace: { stage: "", position: 0 },
    open: null,
  };
  // What the worker said about each dialect: its stages and features.
  const infos = new Map();
  // The last answer shown, and the document the worker is reading now.
  let shown = null;
  let reading = null;

  // The text and options live in the URL's fragment, so that a link or a
  // reload brings them back. Grammar edits do not: download them.
  const TABS = ["brackets", "tree", "json", "canonical", "tokens", "trace", "audit"];
  function loadFragment() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("text")) state.text = params.get("text");
    const dialect = params.get("dialect");
    if (dialect && dialectPaths.includes(`dialects/${dialect}.md`)) state.dialect = `dialects/${dialect}.md`;
    if (params.get("features")) state.features = new Set(params.get("features").split(",").filter(Boolean));
    if (params.get("without")) state.without = new Set(params.get("without").split(",").filter(Boolean));
    if (params.get("auto") === "off") state.autoFeatures = false;
    if (["on", "off"].includes(params.get("elision"))) state.elision = params.get("elision");
    if (params.get("until")) state.until = params.get("until");
    if (TABS.includes(params.get("view"))) state.tab = params.get("view");
  }
  let fragmentTimer = 0;
  function saveFragment() {
    clearTimeout(fragmentTimer);
    fragmentTimer = setTimeout(() => {
      const params = new URLSearchParams();
      params.set("text", state.text);
      params.set("dialect", dialectName(state.dialect));
      if (state.features.size) params.set("features", [...state.features].join(","));
      if (state.without.size) params.set("without", [...state.without].join(","));
      if (!state.autoFeatures) params.set("auto", "off");
      if (state.elision) params.set("elision", state.elision);
      if (state.until) params.set("until", state.until);
      if (state.tab !== "brackets") params.set("view", state.tab);
      const hash = "#" + params.toString().replace(/\+/g, "%20");
      try {
        history.replaceState(null, "", hash);
      } catch {
        // Some browsers refuse replaceState on file:// URLs.
        try { location.replace(hash); } catch { /* keep going without it */ }
      }
    }, 300);
  }

  // ---- Status -----------------------------------------------------------------

  const status = $("status");
  function setStatus(kind, text) {
    status.dataset.state = kind;
    $("status-text").textContent = text;
  }
  // The page is busy from a change until the answer for it is shown: the
  // result is marked stale and the status stops saying Ready at once, so
  // that the result of an earlier text is never shown as the current one.
  // The spinner and the dimming appear only after a moment (style.css), so
  // that fast parses while typing do not make the page flicker.
  function setBusy(busy) {
    if (busy) {
      $("result").setAttribute("aria-busy", "true");
      describePhase();
    } else {
      $("result").removeAttribute("aria-busy");
    }
  }
  function describePhase() {
    const running = job.running;
    const phase = running ? running.phase : "waiting";
    let text = "Parsing…";
    if (phase === "waiting") text = "Working…";
    else if (phase === "starting") text = workerReady ? "Working…" : "Starting the parser…";
    else if (phase === "loading") text = `Loading the ${dialectName(running.path || state.dialect)} dialect…`;
    else if (phase === "reading") text = `Reading ${running.path} with the notation grammar…`;
    else if (phase === "rendering") text = "Rendering…";
    else if (phase === "tracing") text = "Tracing…";
    setStatus("busy", text);
  }

  // ---- The worker ---------------------------------------------------------

  const timings = { workerReady: null, runs: [], restarts: 0 };
  let workerReady = false;
  let nextId = 1;
  const job = { running: null, pending: false, timer: 0, debounce: 0 };
  // Every change to the state starts a new generation, and an answer is
  // shown only if it is for the current one: an answer that arrives after
  // the text or an option changed would show the old result under the new
  // controls.
  let generation = 0;
  let shownGeneration = -1;
  let client;

  function startWorker() {
    workerReady = false;
    client.start();
  }

  function currentRequest() {
    const info = infos.get(state.dialect);
    let trace = null;
    if (state.tab === "trace" && info) {
      if (!info.stages.some((stage) => stage.name === state.trace.stage)) state.trace.stage = defaultTraceStage(info);
      trace = { stage: state.trace.stage, position: state.trace.position };
    }
    let view;
    if (state.tab === "canonical") view = { format: "canonical", pretty: state.pretty };
    else if (state.tab === "tokens") view = { format: "tokens", stage: state.tokenStage };
    else if (state.tab === "tree" || state.tab === "json") view = { format: state.tab };
    else view = { format: "brackets", showElided: state.showElided };
    return {
      dialect: state.dialect,
      text: state.text,
      features: [...state.features],
      withoutFeatures: [...state.without],
      autoFeatures: state.autoFeatures,
      until: state.until || null,
      elisionOnly: state.elision === "" ? null : state.elision === "on",
      view,
      trace,
      audit: state.tab === "audit",
    };
  }

  // The state changed: ask for it, now or after a pause.
  function schedule(delay) {
    generation++;
    clearTimeout(job.debounce);
    saveFragment();
    setBusy(true);
    if (delay) job.debounce = setTimeout(dispatch, delay);
    else dispatch();
  }

  function dispatch() {
    if (shownGeneration === generation) {
      setBusy(false);
      return;
    }
    if (!job.running) return send();
    // The run already asks for the current state.
    if (job.running.generation === generation) return;
    job.pending = true;
    considerRestart();
  }

  // The documents a run of the selected dialect reads.
  function neededDocuments() {
    return new Set([state.dialect, ...pipelineStages(state.dialect, client.text(state.dialect)).flatMap((stage) => stage.documents)]);
  }

  // A run whose answer is no longer wanted goes on if it is reading a
  // document the next run needs too, unchanged since, or if it has barely
  // started; otherwise its worker is replaced.
  function considerRestart() {
    const running = job.running;
    clearTimeout(job.timer);
    if (!running || !job.pending) return;
    if (running.phase === "reading" && neededDocuments().has(running.path) &&
        client.revision(running.path) === running.revisions.get(running.path)) return;
    const elapsed = performance.now() - running.started;
    if (elapsed < RESTART_AFTER) {
      job.timer = setTimeout(considerRestart, RESTART_AFTER - elapsed);
      return;
    }
    job.running = null;
    timings.restarts++;
    startWorker();
    send();
  }

  function send() {
    const id = nextId++;
    job.running = {
      id, generation, started: performance.now(), phase: "starting", path: null,
      revisions: new Map(client.revisions),
    };
    job.pending = false;
    client.run(id, currentRequest());
    setBusy(true);
  }

  function onWorkerMessage(message) {
    const running = job.running;
    switch (message.kind) {
      case "ready":
        workerReady = true;
        timings.workerReady = performance.now() - client.startedAt;
        $("version").textContent = `library ${message.version}`;
        break;
      case "phase":
        if (!running || message.id !== running.id) break;
        running.phase = message.phase;
        running.path = message.path;
        reading = message.phase === "reading" ? message.path : null;
        if (reading) renderDocuments();
        if ($("result").hasAttribute("aria-busy")) describePhase();
        considerRestart();
        break;
      case "result": {
        if (!running || message.id !== running.id) break;
        timings.runs.push({ total: performance.now() - running.started, worker: message.ms, parse: message.parseMs });
        finishRun(running.generation === generation);
        // Remembering the dialect's stages may change the state, when the
        // last stage asked for is not one of them.
        remember(message);
        // An answer for an earlier state is not shown; the run for the
        // current one is on its way, and the page stays busy until it comes.
        if (running.generation === generation) show(message);
        break;
      }
      case "failed":
        finishRun(true);
        showFailure(`The parser failed, which is a bug in gencmu:\n${message.message}`);
        break;
      case "crashed":
        // A worker that died, of memory most likely, is replaced for the
        // next run; this one's answer is lost.
        job.running = null;
        job.pending = false;
        reading = null;
        setBusy(false);
        showFailure(`The parser worker stopped: ${message.message}. A new one is started for the next change.`);
        startWorker();
        break;
    }
  }

  function finishRun(current) {
    clearTimeout(job.timer);
    job.running = null;
    if (reading) {
      reading = null;
      renderDocuments();
    }
    if (job.pending) send();
    else if (current) setBusy(false);
  }

  // ---- Drawing helpers ------------------------------------------------------

  function element(tag, attributes, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  // Text in which every mention of a grammar document, with its line and
  // column when given, is a button that opens it in the editor there.
  function linkified(text) {
    const fragment = document.createDocumentFragment();
    const pattern = /((?:[a-z0-9-]+\/)+[a-z0-9-]+\.md)(?::(\d+)(?::(\d+))?)?/g;
    let at = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (!(match[1] in bundled) && !client.edits.has(match[1])) continue;
      fragment.append(text.slice(at, match.index));
      const [, path, line, column] = match;
      fragment.append(element("button", {
        type: "button", class: "link", text: match[0],
        title: `Open ${path}${line ? ` at line ${line}` : ""} in the editor`,
        onclick: () => openDocument(path, line ? Number(line) : 0, column ? Number(column) : 1),
      }));
      at = match.index + match[0].length;
    }
    fragment.append(text.slice(at));
    return fragment;
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const ms = (value) => (value < 10 ? value.toFixed(1) : Math.round(value)) + " ms";

  // ---- The answer -------------------------------------------------------------

  // What an answer says about its dialect is worth keeping even when the
  // answer itself is out of date.
  function remember(message) {
    if (!message.info) return;
    const before = JSON.stringify(infos.get(message.dialect) || null);
    infos.set(message.dialect, message.info);
    if (message.dialect === state.dialect && before !== JSON.stringify(message.info)) {
      renderOptions();
      if (state.until && !message.info.stages.some((stage) => stage.name === state.until)) {
        state.until = "";
        renderOptions();
        schedule(0);
      }
    }
  }

  function show(message) {
    shown = message;
    shownGeneration = generation;
    setBusy(false);
    $("result").dataset.for = message.text;
    $("result").dataset.dialect = dialectName(message.dialect);
    renderSummary(message);
    renderDiagnostics(message);
    renderOutput(message);
    renderDocuments();
    renderDocumentError();
    if (message.loadError) setStatus("ready", "The dialect has a grammar error");
    else if (message.parseError) setStatus("ready", "The parser could not run");
    else setStatus("ready", "Ready");
    // A trace asked for before the dialect's stages were known.
    if (state.tab === "trace" && !message.trace && message.info) schedule(0);
  }

  function showFailure(text) {
    setStatus("error", "Error");
    const diagnostics = $("diagnostics");
    diagnostics.replaceChildren(element("div", { class: "box bad", role: "alert" },
      element("h3", { text: "Something went wrong" }), element("pre", { text })));
  }

  function renderSummary(message) {
    const summary = $("summary");
    const info = message.info || infos.get(message.dialect);
    const badge = (kind, text) => element("span", { class: `badge ${kind}`, text });
    let verdict;
    if (message.loadError) verdict = badge("bad", "grammar error");
    else if (message.parseError) verdict = badge("bad", "error");
    else if (message.parse.ok) {
      const warned = message.parse.warnings.length;
      verdict = message.parse.ties.length ? badge("warn", "accepted, with a tie")
        : badge("good", warned ? `accepted, with ${plural(warned, "warning")}` : "accepted");
    }
    else if (message.parse.error.kind === "rejected") verdict = badge("bad", `rejected by the ${message.parse.error.stage} stage`);
    else if (message.parse.error.kind === "ambiguous") verdict = badge("bad", `ambiguous in the ${message.parse.error.stage} stage`);
    else verdict = badge("bad", `grammar error in the ${message.parse.error.stage || "?"} stage`);
    const chips = [];
    const reports = message.parse ? message.parse.stages : [];
    for (const stage of info ? info.stages : reports) {
      const report = reports.find((each) => each.name === stage.name);
      let kind = "idle";
      let detail = message.loadError ? "not loaded" : "not run";
      if (report && report.error) {
        kind = "bad";
        detail = report.error;
      } else if (report) {
        kind = report.verdict === "tie" ? "warn" : "good";
        // The last stage hands on its tree; its tokens are usually none.
        const last = info && stage === info.stages[info.stages.length - 1];
        detail = report.verdict + (last && !report.output ? "" : ` · ${plural(report.output, "token")}`);
      }
      if (chips.length) chips.push(element("span", { class: "arrow", "aria-hidden": "true", text: "→" }));
      chips.push(element("span", { class: `stage ${kind}` }, element("strong", { text: stage.name }), " ", detail));
    }
    const used = message.parse ? message.parse.features : [];
    const features = element("p", { class: "features-used" }, used.length ? ["Features: ", used.map((name, index) => [index ? ", " : "",
      element("code", { text: name }), (message.autoFeatures || []).includes(name) ? " (auto)" : ""])] : "No features.");
    summary.replaceChildren(...[element("div", { class: "verdict" }, verdict), element("div", { class: "stages", "aria-label": "Stages" }, chips),
      message.parse ? features : null].filter(Boolean));
    // The parse's own time; the run's, which includes loading the dialect
    // and rendering, or nothing much when the parse was cached, on hover.
    $("timing").textContent = message.parseMs !== undefined ? `parsed in ${ms(message.parseMs)}` : "";
    $("timing").title = message.ms !== undefined ? `this answer took the worker ${ms(message.ms)}` : "";
  }

  function renderDiagnostics(message) {
    const boxes = [];
    if (message.loadError) {
      const error = message.loadError;
      const at = error.document ? element("button", {
        type: "button", class: "small",
        text: `Open ${error.document}${error.line ? ` at ${error.line}:${error.column || 1}` : ""}`,
        onclick: () => openDocument(error.document, error.line || 0, error.column || 1),
      }) : null;
      boxes.push(element("div", { class: "box bad", role: "alert" },
        element("h3", { text: `The ${dialectName(message.dialect)} dialect could not be loaded` }),
        element("pre", {}, linkified(error.message)), at));
    }
    if (message.parseError) {
      boxes.push(element("div", { class: "box bad", role: "alert" },
        element("h3", { text: "The parser could not run" }), element("pre", {}, linkified(message.parseError.message))));
    }
    const parse = message.parse;
    if (parse && parse.error) {
      const error = parse.error;
      const titles = { rejected: "Rejected", ambiguous: "Ambiguous", grammar: "A grammar error while parsing" };
      const actions = [];
      if (error.kind === "rejected" && error.stage) {
        actions.push(element("button", {
          type: "button", class: "small", text: `Trace the ${error.stage} stage here`,
          onclick: () => {
            state.trace = { stage: error.stage, position: error.token === null ? 0 : error.token };
            selectTab("trace", true);
          },
        }));
      }
      boxes.push(element("div", { class: "box bad", id: "explanation" },
        element("h3", { text: titles[error.kind] || "Not accepted" }),
        element("pre", { class: "explanation" }, linkified(parse.explanation)), actions));
    }
    if (parse && parse.warnings.length) {
      boxes.push(element("div", { class: "box warn" },
        element("h3", { text: parse.warnings.length === 1 ? "A warning" : `${parse.warnings.length} warnings` }),
        element("pre", { class: "explanation", text: parse.warningsText })));
    }
    for (const tie of parse ? parse.ties : []) {
      boxes.push(element("div", { class: "box warn" },
        element("h3", { text: `A tie in the ${tie.stage} stage` }),
        element("pre", { class: "explanation" }, tie.summary),
        element("dl", { class: "readings" },
          element("dt", { text: "chosen" }), element("dd", {}, element("code", { text: tie.chosen })),
          element("dt", { text: "other" }), element("dd", {}, element("code", { text: tie.other }))),
        element("details", { class: "tie-trees" },
          element("summary", { text: "Both trees, side by side" }),
          element("div", { class: "side-by-side" },
            element("figure", {}, element("figcaption", { text: "chosen" }), element("pre", { text: tie.chosenTree })),
            element("figure", {}, element("figcaption", { text: "other" }), element("pre", { text: tie.otherTree })))),
        element("p", { class: "hint", text: tie.advice })));
    }
    $("diagnostics").replaceChildren(...boxes);
  }

  function renderOutput(message) {
    const output = $("output");
    const empty = (text) => element("p", { class: "empty", text });
    if (message.loadError || message.parseError) {
      output.replaceChildren(empty("No result: see the error above."));
      return;
    }
    const noTree = () => {
      const error = message.parse.error;
      return empty(error ? `No tree: the ${error.stage} stage did not accept the text. The Tokens tab shows what the stages before it handed on.` : "No tree.");
    };
    const withCopy = (text) => [
      element("div", { class: "copy-row" }, element("button", { type: "button", class: "small", text: "Copy", onclick: (event) => copy(text, event.target) })),
      element("pre", { class: "result-text", tabindex: "0", text }),
    ];
    if (state.tab === "audit") {
      output.replaceChildren(message.audit === undefined ? empty("…") :
        element("pre", { class: "result-text", tabindex: "0" }, linkified(message.audit)));
      return;
    }
    if (state.tab === "trace") {
      renderTrace(message.trace);
      return;
    }
    const result = message.output;
    if (!result || (result.format !== state.tab && !(state.tab === "brackets" && result.format === "brackets"))) {
      output.replaceChildren(empty("…"));
      return;
    }
    if (result.format === "tokens") {
      renderTokens(result);
      return;
    }
    if (result.text === "" && result.format !== "canonical") output.replaceChildren(noTree());
    else output.replaceChildren(...withCopy(result.text));
  }

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  }

  function renderTokens(result) {
    state.tokenStage = result.stage || "";
    const group = $("token-stages");
    group.replaceChildren(...result.stages.map((stage) => element("button", {
      type: "button", role: "radio", class: "small", "aria-checked": String(stage.name === result.stage),
      text: `${stage.name}${stage.count === null ? "" : ` (${stage.count})`}`,
      onclick: () => {
        state.tokenStage = stage.name;
        schedule(0);
      },
    })));
    if (!result.rows.length) {
      $("output").replaceChildren(element("p", { class: "empty", text: `The ${result.stage} stage handed on no tokens${result.error ? ` (${result.error})` : ""}.` }));
      return;
    }
    const header = element("tr", {}, ["#", "text", "phonemes", "span", "source", "tags"].map((title) => element("th", { scope: "col", text: title })));
    const rows = result.rows.map((row) => element("tr", {},
      element("td", { class: "num", text: String(row.index) }),
      element("td", {}, element("code", { text: JSON.stringify(row.text) })),
      element("td", {}, element("code", { text: row.phonemes })),
      element("td", { class: "num", text: row.span }),
      element("td", { class: "num", text: row.source }),
      element("td", { class: "tags" },
        row.tags.split(" ").filter(Boolean).map((tag) => element("span", {
          class: tag.startsWith("?") ? "tag weak" : "tag", title: tag.startsWith("?") ? "weak" : "strong", text: tag.replace(/^\?/, ""),
        })),
        row.insertedBy ? element("span", { class: "muted", text: ` inserted by ${row.insertedBy}` }) : null)));
    const note = result.total > result.rows.length ? element("p", { class: "hint", text: `The first ${result.rows.length} of ${result.total} tokens.` }) : null;
    $("output").replaceChildren(...[
      element("p", { class: "hint", text: `What the ${result.stage} stage handed on. A faded tag is weak.` }),
      element("div", { class: "table-wrap" }, element("table", { class: "tokens" }, element("thead", {}, header), element("tbody", {}, rows))), note,
    ].filter(Boolean));
  }

  function renderTrace(trace) {
    const picker = $("trace-picker");
    if (!trace) {
      picker.replaceChildren();
      $("output").replaceChildren(element("p", { class: "empty", text: "…" }));
      return;
    }
    $("trace-stage").value = trace.stage;
    if (trace.error) {
      picker.replaceChildren();
      $("output").replaceChildren(element("pre", { class: "result-text" }, linkified(trace.error)));
      return;
    }
    state.trace.position = trace.position;
    $("trace-position").value = String(trace.position);
    $("trace-position").max = String(trace.count);
    // The stage's input around the position, with a gap between each two
    // tokens to pick.
    const items = [];
    if (trace.from > 0) items.push(element("span", { class: "muted", text: "…" }));
    const gap = (position) => element("button", {
      type: "button", class: "gap", "aria-pressed": String(position === trace.position),
      "aria-label": `position ${position}`, title: `position ${position}`,
      onclick: () => {
        state.trace.position = position;
        schedule(0);
      },
    });
    trace.tokens.forEach((token, index) => {
      items.push(gap(trace.from + index));
      items.push(element("span", { class: "token", text: token.replace(/\s/g, "␣") || "∅" }));
    });
    items.push(gap(trace.from + trace.tokens.length));
    if (trace.from + trace.tokens.length < trace.count) items.push(element("span", { class: "muted", text: "…" }));
    picker.replaceChildren(...items);
    $("output").replaceChildren(element("pre", { class: "result-text", tabindex: "0", text: trace.text }));
  }

  // ---- Options ------------------------------------------------------------

  function defaultTraceStage(info) {
    const error = shown && shown.parse && shown.parse.error;
    if (error && error.stage && info.stages.some((stage) => stage.name === error.stage)) return error.stage;
    return info.stages[info.stages.length - 1].name;
  }

  function renderOptions() {
    $("dialect").value = state.dialect;
    $("auto-features").checked = state.autoFeatures;
    $("elision").value = state.elision;
    $("show-elided").checked = state.showElided;
    $("pretty-json").checked = state.pretty;
    const info = infos.get(state.dialect);
    const features = $("features");
    if (!info) {
      features.replaceChildren(element("span", { class: "muted", text: "loading…" }));
      return;
    }
    if (!info.features.length) features.replaceChildren(element("span", { class: "muted", text: "none: no grammar of this dialect is guarded on a feature" }));
    else {
      features.replaceChildren(...info.features.map((feature) => {
        const name = feature.name;
        const on = feature.default ? !state.without.has(name) : state.features.has(name);
        const auto = name === "sa-su" && feature.kind === "gate" && state.autoFeatures && !on && !state.without.has(name);
        const title = (feature.kind === "warning" ? "A warning: while it is on, a parse that uses this addition says where" : "A gate: while it is on, the grammar has this construct") +
          (feature.default ? "; the dialect turns it on" : "");
        return element("label", { class: "chip" + (feature.default ? " fixed" : ""), title },
          element("input", {
            type: "checkbox", value: name, checked: on,
            onchange: (event) => {
              // A switch records only a departure from the dialect's default,
              // and a name is never in both lists, which the library refuses:
              // another dialect may have put it in the other one.
              state.features.delete(name);
              state.without.delete(name);
              if (feature.default && !event.target.checked) state.without.add(name);
              else if (!feature.default && event.target.checked) state.features.add(name);
              renderOptions();
              schedule(0);
            },
          }),
          " ", name, element("small", { text: feature.kind === "warning" ? " warning" : "" }),
          feature.default ? element("small", { text: " dialect" }) : null, auto ? element("small", { text: " auto", title: "Auto features switch it on for a text that needs it" }) : null);
      }));
    }
    const until = $("until");
    until.replaceChildren(element("option", { value: "", text: "the last stage" }),
      ...info.stages.slice(0, -1).map((stage) => element("option", { value: stage.name, text: stage.name })));
    until.value = state.until;
    const strict = info.stages.filter((stage) => stage.elisionOnly).map((stage) => stage.name);
    $("elision").options[0].textContent = `grammar's own (${strict.length ? "on for " + strict.join(", ") : "off"})`;
    const traceStage = $("trace-stage");
    traceStage.replaceChildren(...info.stages.map((stage) => element("option", { value: stage.name, text: stage.name })));
    if (state.trace.stage) traceStage.value = state.trace.stage;
  }

  // ---- Tabs ---------------------------------------------------------------

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(name, focus) {
    state.tab = name;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    $("output-panel").setAttribute("aria-labelledby", `tab-${name}`);
    for (const controls of $("tab-controls").children) controls.hidden = controls.dataset.for !== name;
    if (shown) renderOutput(Object.assign({}, shown, { output: null, trace: null, audit: undefined }));
    schedule(0);
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab, false));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      selectTab(next.dataset.tab, true);
    });
  }

  // ---- The grammar editor ---------------------------------------------------

  const editor = $("doc-text");
  const normalized = (text) => (text || "").replace(/\r\n?/g, "\n");
  const isEdited = (path) => client.edits.has(path);

  // The documents of the selected dialect, stage by stage, and the edited
  // documents of other dialects.
  function renderDocuments() {
    const stages = pipelineStages(state.dialect, client.text(state.dialect));
    const error = shown && shown.loadError && shown.dialect === state.dialect ? shown.loadError.document : null;
    const button = (path) => {
      const classes = ["doc"];
      if (isEdited(path)) classes.push("edited");
      if (path === error) classes.push("error");
      if (path === reading) classes.push("reading");
      const missing = client.text(path) === undefined;
      const notes = [isEdited(path) ? "edited" : "", path === error ? "has an error" : "", path === reading ? "being read" : "", missing ? "missing" : ""].filter(Boolean);
      return element("button", {
        type: "button", class: classes.join(" "), "aria-pressed": String(path === state.open), disabled: missing,
        title: (firstHeading(client.text(path)) || path) + (notes.length ? ` (${notes.join(", ")})` : ""),
        "aria-label": path + (notes.length ? `, ${notes.join(", ")}` : ""),
        onclick: () => openDocument(path, 0, 1),
      }, path.replace(/\.md$/, ""));
    };
    const groups = [element("div", { class: "doc-group" }, element("span", { class: "doc-stage", text: "pipeline" }), button(state.dialect))];
    for (const stage of stages) {
      groups.push(element("div", { class: "doc-group" }, element("span", { class: "doc-stage", text: stage.name }), stage.documents.map(button)));
    }
    $("documents").replaceChildren(...groups);
    const listed = new Set([state.dialect, ...stages.flatMap((stage) => stage.documents)]);
    const elsewhere = [...client.edits.keys()].filter((path) => !listed.has(path));
    const note = $("edited-elsewhere");
    note.hidden = !elsewhere.length;
    note.replaceChildren("Also edited, outside this dialect: ", ...elsewhere.flatMap((path, index) => [index ? ", " : "", element("button", {
      type: "button", class: "link", text: path, onclick: () => openDocument(path, 0, 1),
    })]));
    const count = client.edits.size;
    $("download-all").disabled = !count;
    $("download-all").textContent = count ? `Download edited (${count})` : "Download edited";
    renderDocumentState();
  }

  function renderDocumentState() {
    if (!state.open) return;
    const path = state.open;
    $("doc-path").textContent = path;
    $("doc-state").textContent = path === reading ? "being read…" : isEdited(path) ? "edited" : "as bundled";
    $("doc-state").className = "doc-state" + (isEdited(path) ? " edited" : "");
    $("doc-reset").disabled = !isEdited(path);
  }

  function openDocument(path, line, column) {
    state.open = path;
    $("doc-editor").hidden = false;
    editor.value = normalized(client.text(path));
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    renderDocuments();
    renderGutter();
    renderDocumentError();
    renderCursor();
    $("doc-editor").scrollIntoView({ block: "nearest" });
    if (line) jumpTo(line, column);
  }

  // Moves the editor's cursor to a line and column, counted in code points
  // as the library counts them, and scrolls it into view.
  function jumpTo(line, column) {
    const value = editor.value;
    let offset = 0;
    for (let current = 1; current < line; current++) {
      const next = value.indexOf("\n", offset);
      if (next < 0) break;
      offset = next + 1;
    }
    for (let current = 1; current < column && offset < value.length && value[offset] !== "\n"; current++) {
      offset += value.codePointAt(offset) > 0xffff ? 2 : 1;
    }
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(offset, offset);
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 3);
    const charWidth = (parseFloat(style.fontSize) || 13) * 0.6;
    editor.scrollLeft = Math.max(0, (column - 1) * charWidth - editor.clientWidth / 2);
    syncGutter();
    renderCursor();
  }

  // The line numbers beside the editor, with the error's line marked.
  let gutterLines = -1;
  let gutterError = null;
  function renderGutter() {
    const lines = editor.value.split("\n").length;
    const error = documentError();
    const errorLine = error && error.line ? error.line : null;
    if (lines === gutterLines && errorLine === gutterError) return;
    gutterLines = lines;
    gutterError = errorLine;
    const gutter = $("gutter");
    const numbers = (from, to) => { let text = ""; for (let n = from; n <= to; n++) text += n + "\n"; return text; };
    if (errorLine && errorLine <= lines) {
      gutter.replaceChildren(numbers(1, errorLine - 1), element("mark", { text: String(errorLine) }), "\n" + numbers(errorLine + 1, lines));
    } else {
      gutter.textContent = numbers(1, lines);
    }
    syncGutter();
  }
  function syncGutter() {
    $("gutter").scrollTop = editor.scrollTop;
  }

  function renderCursor() {
    const before = editor.value.slice(0, editor.selectionStart);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.split("\n").length;
    const column = [...before.slice(lineStart)].length + 1;
    $("doc-cursor").textContent = `line ${line}, column ${column}`;
  }

  // The load error of the shown answer, if it is in the open document.
  function documentError() {
    const error = shown && shown.loadError;
    return error && state.open && error.document === state.open ? error : null;
  }
  function renderDocumentError() {
    renderGutter();
    const error = documentError();
    const box = $("doc-error");
    box.hidden = !error;
    if (!error) {
      box.replaceChildren();
      return;
    }
    box.replaceChildren(element("span", { text: error.message }));
    if (error.line) {
      box.append(" ", element("button", {
        type: "button", class: "small", text: `Go to ${error.line}:${error.column || 1}`,
        onclick: () => jumpTo(error.line, error.column || 1),
      }));
    }
  }

  editor.addEventListener("input", () => {
    const path = state.open;
    if (!path) return;
    const bundledText = bundled[path];
    client.setDocument(path, bundledText !== undefined && normalized(bundledText) === editor.value ? bundledText : editor.value);
    renderGutter();
    renderCursor();
    renderDocuments();
    schedule(GRAMMAR_DELAY);
  });
  editor.addEventListener("scroll", syncGutter);
  for (const kind of ["keyup", "click", "select", "focus"]) editor.addEventListener(kind, renderCursor);
  // A tab key in the editor moves the focus, as everywhere else on the page;
  // grammar documents are indented with spaces.

  $("doc-reset").addEventListener("click", () => {
    const path = state.open;
    if (!path || bundled[path] === undefined) return;
    client.setDocument(path, bundled[path]);
    openDocument(path, 0, 1);
    schedule(0);
  });
  $("doc-close").addEventListener("click", () => {
    state.open = null;
    $("doc-editor").hidden = true;
    renderDocuments();
  });

  // A download of one document, named after its path so that the several
  // cll.md documents stay apart: words/cll.md is words--cll.md.
  function download(path) {
    const blob = new Blob([client.text(path)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a", { href: url, download: path.replace(/\//g, "--") });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $("doc-download").addEventListener("click", () => state.open && download(state.open));
  $("download-all").addEventListener("click", () => {
    // One file per document, a moment apart, since some browsers drop
    // downloads started together.
    [...client.edits.keys()].forEach((path, index) => setTimeout(() => download(path), index * 300));
  });
  window.addEventListener("beforeunload", (event) => {
    if (!client.edits.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // ---- Controls ---------------------------------------------------------------

  function initControls() {
    const dialect = $("dialect");
    dialect.replaceChildren(...dialectPaths.map((path) => element("option", {
      value: path, text: `${dialectName(path)}: ${firstHeading(bundled[path]).replace(/^The\s+/i, "").replace(/\s+dialect$/i, "")}`,
    })));
    const examples = $("examples");
    EXAMPLES.forEach((example, index) => examples.append(element("option", { value: String(index), text: example.label })));
    examples.addEventListener("change", () => {
      const example = EXAMPLES[Number(examples.value)];
      examples.value = "";
      if (!example) return;
      state.text = example.text;
      $("input").value = example.text;
      state.dialect = `dialects/${example.dialect}.md`;
      state.elision = example.elision || "";
      state.until = "";
      renderOptions();
      renderDocuments();
      schedule(0);
    });
    $("input").value = state.text;
    $("input").addEventListener("input", () => {
      state.text = $("input").value;
      schedule(TEXT_DELAY);
    });
    dialect.addEventListener("change", () => {
      state.dialect = dialect.value;
      state.until = "";
      state.trace.stage = "";
      renderOptions();
      renderDocuments();
      schedule(0);
    });
    $("auto-features").addEventListener("change", (event) => {
      state.autoFeatures = event.target.checked;
      renderOptions();
      schedule(0);
    });
    $("elision").addEventListener("change", (event) => {
      state.elision = event.target.value;
      schedule(0);
    });
    $("until").addEventListener("change", (event) => {
      state.until = event.target.value;
      schedule(0);
    });
    $("show-elided").addEventListener("change", (event) => {
      state.showElided = event.target.checked;
      schedule(0);
    });
    $("pretty-json").addEventListener("change", (event) => {
      state.pretty = event.target.checked;
      schedule(0);
    });
    $("trace-stage").addEventListener("change", (event) => {
      state.trace = { stage: event.target.value, position: 0 };
      schedule(0);
    });
    $("trace-position").addEventListener("change", (event) => {
      state.trace.position = Math.max(0, Number(event.target.value) || 0);
      schedule(0);
    });
    $("trace-back").addEventListener("click", () => {
      state.trace.position = Math.max(0, state.trace.position - 1);
      schedule(0);
    });
    $("trace-next").addEventListener("click", () => {
      state.trace.position += 1;
      schedule(0);
    });
  }

  // ---- Start --------------------------------------------------------------------

  loadFragment();
  initControls();
  renderOptions();
  try {
    client = new self.ParserWorker(bundled, onWorkerMessage);
    renderDocuments();
    startWorker();
  } catch (error) {
    setStatus("error", `The parser worker could not start: ${error.message}`);
    return;
  }
  selectTab(state.tab, false);
  // For tests and for measuring from the console.
  self.playground = { state, timings, client, schedule };
})();
