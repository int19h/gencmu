// The playground's parser worker, and the page's handle on it.
//
// The worker is built from sources already loaded in the page, so that
// nothing is fetched: this is what lets the playground run from file://. Its
// script is the text of `gencmuFactory` (dist/gencmu.js) followed by the text
// of `workerMain` below, turned into a Blob URL; the grammar documents are
// posted to it as a map from path to text.
//
// Everything heavy happens in the worker, and everything it sends back is a
// string or shallow plain data: a book chapter's tree is thousands of levels
// deep, and handing such an object to structured clone can overflow its
// stack. So the worker renders brackets, trees, JSON, tables and
// explanations itself, with the library's non-recursive renderers.
//
// Protocol, page to worker:
//   { kind: "init", sources, compiled }  the documents, path to text, and
//       DOMs already read in an earlier worker, path to { hash, dom }
//   { kind: "set", path, text }          a document changed (text null: gone)
//   { kind: "run", id, request }         parse and render; see `run` below
// Worker to page:
//   { kind: "ready", version, ms }       after init
//   { kind: "phase", id, phase, path }   what a run is doing: "loading" a
//       dialect, "reading" a document with the notation, "parsing", "rendering"
//   { kind: "dom", path, hash, dom }     a document just read, for the page
//       to hand to the next worker if this one is ever replaced
//   { kind: "result", id, ... }          a run's answer
//   { kind: "failed", id, message }      a run that threw, which is a bug
(function (root) {
  "use strict";

  // ---- The worker's side --------------------------------------------------
  //
  // This function is never called in the page: its text is the body of the
  // worker, where `scope` is the worker's global and `gencmu` the library.
  // It may use nothing from the page.
  function workerMain(scope, gencmu) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    let sources = new Map();
    let loader = null;
    // Bumped whenever a document changes, so that cached results go stale.
    let version = 0;
    // Dialects by pipeline path: { dialect, info, audit } or { error }.
    const dialects = new Map();
    // The last parse, kept so that switching the output format, tracing or
    // auditing does not parse the text again.
    let last = null;
    let runId = null;

    const post = (message) => scope.postMessage(message);
    const phase = (name, path) => post({ kind: "phase", id: runId, phase: name, path: path || null });

    function init(message) {
      const started = now();
      sources = new Map(Object.entries(message.sources));
      // One Loader for the worker's life: it caches every document's DOM by
      // path and text hash, so a document read once is not read again.
      loader = gencmu.loaderFromSources(sources);
      for (const [path, entry] of Object.entries(message.compiled || {})) loader.compiled.set(path, entry);
      // Reading a document that compiled.json does not hold goes through the
      // notation grammar and can take seconds; say so, and hand the DOM back.
      const read = loader.readDocument.bind(loader);
      loader.readDocument = (markdown, path) => {
        phase("reading", path);
        const dom = read(markdown, path);
        post({ kind: "dom", path, hash: gencmu.fnv1a64(markdown), dom });
        return dom;
      };
      dialects.clear();
      last = null;
      post({ kind: "ready", version: gencmu.version, ms: now() - started });
    }

    function setDocument(path, text) {
      if (text === null) sources.delete(path);
      else sources.set(path, text);
      version++;
      dialects.clear();
      last = null;
      // Forget this document's earlier DOMs; the bundled one stays in
      // compiled.json, so resetting a document costs nothing.
      for (const key of [...loader.cache.keys()]) if (key.startsWith(path + "\u0000")) loader.cache.delete(key);
    }

    // A thrown error as plain data, with where it happened when known.
    function describeError(error) {
      const where = (error && error.where) || {};
      return {
        kind: error && error.name === "GencmuError" ? error.kind : "internal",
        message: String((error && error.message) || error),
        document: where.document || null,
        line: where.line || null,
        column: where.column || null,
        stage: where.stage || null,
      };
    }

    function loadDialect(path) {
      let entry = dialects.get(path);
      if (entry) return entry;
      phase("loading", path);
      try {
        const dialect = loader.dialect(path);
        // The features a switch can change: every feature an alternative of
        // the dialect's grammars is guarded on, with @f or @¬f.
        const guarded = new Set();
        for (const stage of dialect.stages) {
          for (const rule of stage.grammar.rules.values()) {
            for (const alternative of rule.alternatives) for (const guard of alternative.guards || []) guarded.add(guard.feature);
          }
        }
        entry = {
          dialect,
          info: {
            path,
            stages: dialect.stages.map((stage) => ({
              name: stage.name,
              lean: stage.grammar.resolution ? stage.grammar.resolution.lean : null,
              elisionOnly: !!(stage.grammar.resolution && stage.grammar.resolution.elisionOnly),
            })),
            features: [...guarded].sort(),
            dialectFeatures: dialect.features.slice(),
          },
        };
      } catch (error) {
        entry = { error: describeError(error) };
      }
      dialects.set(path, entry);
      return entry;
    }

    function parse(entry, request) {
      const key = JSON.stringify([version, request.dialect, request.text, request.features, request.autoFeatures, request.until, request.elisionOnly]);
      if (last && last.key === key) return last;
      phase("parsing");
      const started = now();
      const result = entry.dialect.parse(request.text, {
        features: request.features,
        autoFeatures: request.autoFeatures,
        until: request.until || undefined,
        elisionOnly: request.elisionOnly,
      });
      const ms = now() - started;
      last = { key, result, ms, summary: summarize(result), renders: new Map(), traces: new Map() };
      return last;
    }

    function summarize(result) {
      const error = result.error;
      return {
        ok: result.ok,
        text: result.text,
        features: result.features || [],
        stages: result.stages.map((stage) => ({
          name: stage.name,
          verdict: stage.verdict,
          error: stage.error ? stage.error.kind : null,
          input: stage.input ? stage.input.length : 0,
          output: stage.output ? stage.output.length : null,
        })),
        error: error ? {
          kind: error.kind, stage: error.stage || null, token: error.token === undefined ? null : error.token,
          line: error.line || null, column: error.column || null, message: error.message,
        } : null,
        explanation: gencmu.explainError(result),
        ties: result.stages.filter((stage) => stage.verdict === "tie").map((stage) => tieView(result, stage)),
      };
    }

    // A tie as the page shows it: explainTies's account of where the two
    // readings first differ, then both readings, as brackets and as trees,
    // for the page to lay side by side.
    function tieView(result, stage) {
      const tokens = stage.input || [];
      const text = gencmu.explainTies({ text: result.text, stages: [stage] });
      const cut = text.indexOf("\n  chosen: ");
      const end = text.lastIndexOf("\n");
      return {
        stage: stage.name,
        summary: cut < 0 ? text : text.slice(0, cut),
        advice: end < 0 ? "" : text.slice(end + 1),
        chosen: stage.tree ? gencmu.nodeBrackets(stage.tree, tokens, { showElided: true }) : "",
        other: stage.tied ? gencmu.nodeBrackets(stage.tied, tokens, { showElided: true }) : "",
        chosenTree: stage.tree ? gencmu.nodeTree(stage.tree, tokens) : "",
        otherTree: stage.tied ? gencmu.nodeTree(stage.tied, tokens) : "",
      };
    }

    // The most rows of one stage's tokens sent to the page: a table of a
    // hundred thousand phonemes helps nobody and slows the page.
    const TOKEN_ROWS = 3000;

    function render(parsed, view) {
      const key = JSON.stringify(view);
      const cached = parsed.renders.get(key);
      if (cached) return cached;
      phase("rendering");
      const result = parsed.result;
      let output;
      switch (view.format) {
        case "tree":
          output = { format: "tree", text: gencmu.toTree(result) };
          break;
        case "json": {
          const value = gencmu.displayValue(result);
          output = { format: "json", text: value === null ? "" : gencmu.prettyJson(value) };
          break;
        }
        case "canonical":
          output = { format: "canonical", text: view.pretty ? gencmu.prettyJson(gencmu.resultJson(result)) : gencmu.toJson(result) };
          break;
        case "tokens": {
          const stages = result.stages.map((stage) => ({ name: stage.name, verdict: stage.verdict, count: stage.output ? stage.output.length : null }));
          const stage = result.stages.find((each) => each.name === view.stage) ||
            result.stages.find((each) => each.name === "words" && each.output) || result.stages[0];
          const tokens = (stage && stage.output) || [];
          const rows = tokens.slice(0, TOKEN_ROWS).map((token, index) => ({
            index,
            text: token.text,
            phonemes: token.phonemes || "",
            span: token.span[0] + "–" + token.span[1],
            source: token.source[0] + "–" + token.source[1],
            tags: [...token.tags.keys()].sort().map((tag) => (token.tags.get(tag) ? tag : "?" + tag)).join(" "),
            insertedBy: token.insertedBy || "",
          }));
          output = {
            format: "tokens", stages, stage: stage ? stage.name : null, rows, total: tokens.length,
            error: stage && stage.error ? stage.error.kind : null,
          };
          break;
        }
        default:
          output = { format: "brackets", text: gencmu.toBrackets(result, { showElided: !!view.showElided }) };
      }
      parsed.renders.set(key, output);
      return output;
    }

    function runTrace(entry, parsed, request) {
      const key = JSON.stringify(request.trace);
      const cached = parsed.traces.get(key);
      if (cached) return cached;
      phase("tracing");
      let answer;
      try {
        const traced = gencmu.trace(entry.dialect, request.text, {
          stage: request.trace.stage, position: request.trace.position,
          features: request.features, autoFeatures: request.autoFeatures,
        });
        // The tokens around the position, for the page's picker.
        const from = Math.max(0, traced.position - 40);
        const to = Math.min(traced.tokens.length, traced.position + 40);
        answer = {
          stage: traced.stage, position: traced.position, count: traced.tokens.length,
          from, tokens: traced.tokens.slice(from, to).map((token) => token.text),
          text: gencmu.formatTrace(traced),
        };
      } catch (error) {
        answer = { stage: request.trace.stage, position: request.trace.position, error: String(error.message || error) };
      }
      parsed.traces.set(key, answer);
      return answer;
    }

    // One run: load the dialect, parse the text, render what the page shows.
    //
    // request: { dialect, text, features: string[], autoFeatures, until,
    //   elisionOnly: null | boolean, view: { format, showElided, pretty,
    //   stage }, trace: null | { stage, position }, audit: boolean }
    function run(id, request) {
      runId = id;
      const started = now();
      const entry = loadDialect(request.dialect);
      const answer = { kind: "result", id, text: request.text, dialect: request.dialect, info: entry.info || null, loadError: entry.error || null };
      if (entry.error) return Object.assign(answer, { ms: now() - started });
      let parsed;
      try {
        parsed = parse(entry, request);
      } catch (error) {
        return Object.assign(answer, { parseError: describeError(error), ms: now() - started });
      }
      answer.parse = parsed.summary;
      // The features auto features switched on for this text.
      answer.autoFeatures = parsed.summary.features.filter((name) =>
        !request.features.includes(name) && !entry.info.dialectFeatures.includes(name));
      answer.parseMs = parsed.ms;
      answer.output = render(parsed, request.view);
      if (request.trace) answer.trace = runTrace(entry, parsed, request);
      if (request.audit) {
        if (entry.audit === undefined) entry.audit = gencmu.formatAudit(gencmu.audit(entry.dialect));
        answer.audit = entry.audit;
      }
      answer.ms = now() - started;
      return answer;
    }

    scope.onmessage = (event) => {
      const message = event.data;
      try {
        if (message.kind === "init") init(message);
        else if (message.kind === "set") setDocument(message.path, message.text);
        else if (message.kind === "run") post(run(message.id, message.request));
      } catch (error) {
        post({ kind: "failed", id: message.id === undefined ? null : message.id, message: String((error && error.stack) || error) });
      }
    };
  }

  // ---- The page's side ----------------------------------------------------

  let blobUrl = null;
  function workerUrl() {
    if (!blobUrl) {
      const source = "\"use strict\";\n" +
        "var gencmu = (" + root.gencmuFactory.toString() + ")();\n" +
        "(" + workerMain.toString() + ")(self, gencmu);\n";
      blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    }
    return blobUrl;
  }

  // The page's handle on the worker. It keeps the documents the worker was
  // given, and the DOMs the worker read, so that it can replace a worker
  // that is busy with stale work by a new one at little cost: terminating a
  // worker is the only way to stop a parse, and a Blob worker is cheap to
  // start, but reading an edited lexicon again is not.
  class ParserWorker {
    /**
     * @param {Record<string, string>} bundled the grammar documents
     * @param {(message: object) => void} listener every message but "dom"
     */
    constructor(bundled, listener) {
      this.bundled = bundled;
      this.listener = listener;
      // Edited documents, path to text.
      this.edits = new Map();
      // The DOMs of edited documents the worker read, path to { hash, dom }.
      this.doms = new Map();
      // Edits the running worker has not been told of yet.
      this.unsent = new Set();
      // How many times each document was changed, so that a run can tell
      // whether the text it is reading is still the current one.
      this.revisions = new Map();
      this.worker = null;
      this.startedAt = 0;
    }

    /** Starts a worker, replacing the running one if there is one. */
    start() {
      if (this.worker) this.worker.terminate();
      const worker = new Worker(workerUrl());
      this.worker = worker;
      this.startedAt = performance.now();
      worker.onmessage = (event) => {
        if (this.worker !== worker) return;
        const message = event.data;
        if (message.kind === "dom") this.doms.set(message.path, { hash: message.hash, dom: message.dom });
        else this.listener(message);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.worker === worker) this.listener({ kind: "crashed", message: event.message || "the parser worker stopped" });
      };
      const sources = Object.assign({}, this.bundled);
      for (const [path, text] of this.edits) sources[path] = text;
      const compiled = {};
      for (const [path, entry] of this.doms) if (this.edits.has(path)) compiled[path] = entry;
      this.unsent.clear();
      worker.postMessage({ kind: "init", sources, compiled });
    }

    /** The text of a document as the parser sees it. */
    text(path) {
      return this.edits.has(path) ? this.edits.get(path) : this.bundled[path];
    }

    /** Changes a document; the bundled text itself clears the edit. */
    setDocument(path, text) {
      if (text === this.bundled[path]) this.edits.delete(path);
      else this.edits.set(path, text);
      this.unsent.add(path);
      this.revisions.set(path, this.revision(path) + 1);
    }

    /** How many times a document was changed. */
    revision(path) {
      return this.revisions.get(path) || 0;
    }

    /** Sends a run, after any edits the worker has not seen. */
    run(id, request) {
      for (const path of this.unsent) this.worker.postMessage({ kind: "set", path, text: this.text(path) === undefined ? null : this.text(path) });
      this.unsent.clear();
      this.worker.postMessage({ kind: "run", id, request });
    }
  }

  root.ParserWorker = ParserWorker;
})(self);
