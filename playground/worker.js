// The playground's parser worker, and the page's handle on it.
//
// The worker uses a Blob script built from the library and worker code.
// Grammar documents arrive as a map. Names files arrive only after the
// loader requests them, so a matching bundled cache needs no names fetch.
// The page fetches resources relative to its own URL.
//
// Everything heavy happens in the worker, and everything it sends back is a
// string or shallow plain data: a book chapter's tree is thousands of levels
// deep, and handing such an object to structured clone can overflow its
// stack. So the worker renders brackets, trees, JSON, tables and
// explanations itself, with the library's non-recursive renderers.
//
// Protocol, page to worker:
//   { kind: "init", sources, preparsed }  the documents, path to text, and
//       DOMs already read in an earlier worker, path to { hash, dom }
//   { kind: "set", path, text }          a document changed (text null: gone)
//   { kind: "run", id, request }         parse and render; see `run` below
//   { kind: "names", id, resources }     fetched resource text, or path/error
// Worker to page:
//   { kind: "ready", version, ms }       after init
//   { kind: "phase", id, phase, path }   what a run is doing: "loading" a
//       pipeline, "reading" a document with the notation, "parsing", "rendering"
//   { kind: "need-names", id, path }    names text required to resume loading
//   { kind: "dom", path, hash, names, dom }     a document just read, for the page
//       to hand to the next worker if this one is ever replaced
//   { kind: "result", id, ... }          a run's answer
//   { kind: "failed", id, message }      a run that threw, which is a bug;
//       id null: a message that is not a run threw, such as "init"
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
    // Pipelines by full pipeline name: { pipeline, info, audit } or { error }.
    const pipelines = new Map();
    // The last parse, kept so that switching the output format, tracing or
    // auditing does not parse the text again.
    let last = null;
    let runId = null;
    const pendingNames = new Map();
    const namesErrors = new Map();
    class NeedNames extends Error {
      constructor(path) { super(path); this.path = path; }
    }

    const post = (message) => scope.postMessage(message);
    const phase = (name, path) => post({ kind: "phase", id: runId, phase: name, path: path || null });

    function init(message) {
      const started = now();
      sources = new Map(Object.entries(message.sources));
      pendingNames.clear();
      namesErrors.clear();
      // One Loader for the worker's life: it caches every document's DOM by
      // path and text hash, so a document read once is not read again.
      loader = gencmu.loaderFromSources(sources);
      // The worker owns this map and updates it for edits and fetched names.
      loader.read = path => sources.get(path);
      loader.namesOverride = path => sources.has(path);
      loader.needNames = (path) => {
        if (sources.has(path)) return loader.need(path);
        if (namesErrors.has(path)) throw new gencmu.GencmuError("grammar", namesErrors.get(path), { document: path });
        throw new NeedNames(path);
      };
      for (const [path, entry] of Object.entries(message.preparsed || {})) {
        loader.usePreparsed({ format: entry.dom.format, bootstrap: entry.bootstrap, unicode: entry.unicode, properties: entry.properties, bundledNames: loader.bundledNames, documents: { [path]: entry } });
      }
      // Reading a document that data/preparsed/FAMILY.json does not hold goes through the
      // notation grammar and can take seconds; say so, and hand the DOM back.
      const read = loader.readDocument.bind(loader);
      loader.readDocument = (markdown, path, deferEmission, inherited) => {
        phase("reading", path);
        const dom = read(markdown, path, deferEmission, inherited);
        post({ kind: "dom", path, hash: gencmu.fnv1a64(markdown), bootstrap: loader.bootstrapHash, unicode: loader.unicodeHash, properties: loader.propertiesHash, names: loader.namesDependencies.get(dom), dom });
        return dom;
      };
      // Send inspected directives for source reads and cache hits alike. The editor
      // uses their decoded include operands, including inherited names.
      const document = loader.documentDom.bind(loader);
      loader.documentDom = (path, inherited) => {
        const dom = document(path, inherited);
        post({ kind: "directives", id: runId, path, inherited: inherited || [], directives: dom.directives });
        return dom;
      };
      pipelines.clear();
      last = null;
      post({ kind: "ready", version: gencmu.version, ms: now() - started });
    }

    function setDocument(path, text) {
      namesErrors.delete(path);
      if (text === null) sources.delete(path);
      else sources.set(path, text);
      version++;
      pipelines.clear();
      last = null;
      // Forget this document's earlier DOMs; the bundled one stays in
      // data/preparsed/FAMILY.json, so resetting a document costs nothing.
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

    function loadPipeline(name) {
      let entry = pipelines.get(name);
      if (entry) return entry;
      const path = `grammars/${name}/pipeline.md`;
      phase("loading", path);
      try {
        const pipeline = loader.pipeline(path);
        const ruleLocations = {};
        for (const stage of pipeline.stages) {
          const byRule = {};
          for (const [ruleName, rule] of stage.grammar.rules) {
            if (rule.at && !byRule[ruleName]) {
              byRule[ruleName] = {
                document: rule.at.document,
                line: rule.at.line,
                column: rule.at.column || 1,
                stage: stage.name,
              };
            }
          }
          ruleLocations[stage.name] = byRule;
        }
        entry = {
          pipeline,
          info: {
            path,
            stages: pipeline.stages.map((stage) => ({
              name: stage.name,
              lean: stage.grammar.resolution ? stage.grammar.resolution.lean : null,
              elisionOnly: !!(stage.grammar.resolution && stage.grammar.resolution.elisionOnly),
            })),
            // Each feature a switch can change: its name, whether it is a
            // gate or a warning, and whether the pipeline turns it on.
            features: pipeline.features.map((feature) => ({ name: feature.name, kind: feature.kind, default: feature.default })),
            ruleLocations,
          },
        };
      } catch (error) {
        if (error instanceof NeedNames) throw error;
        entry = { error: describeError(error) };
      }
      pipelines.set(name, entry);
      return entry;
    }

    function parse(entry, request) {
      const key = JSON.stringify([version, request.pipeline, request.text, request.features, request.withoutFeatures, request.until, request.elisionOnly]);
      if (last && last.key === key) return last;
      phase("parsing");
      const started = now();
      const result = entry.pipeline.parse(request.text, {
        features: request.features,
        withoutFeatures: request.withoutFeatures,
        until: request.until || undefined,
        elisionOnly: request.elisionOnly,
      });
      const ms = now() - started;
      last = { key, result, ms, summary: summarize(result, entry.pipeline), renders: new Map(), traces: new Map() };
      return last;
    }

    function lineIndex(text) {
      const characters = [...text];
      const breaks = [];
      for (let index = 0; index < characters.length; index++) {
        const character = characters[index];
        if (character === "\n" || (character === "\r" && characters[index + 1] !== "\n")) breaks.push(index);
      }
      return { characters, breaks };
    }

    function positionAt({ breaks }, offset) {
      let low = 0;
      let high = breaks.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (breaks[middle] < offset) low = middle + 1;
        else high = middle;
      }
      const lineStart = low === 0 ? 0 : breaks[low - 1] + 1;
      return { line: low + 1, column: offset - lineStart + 1, lineStart };
    }

    function excerptAt({ characters, breaks }, source) {
      const { line, column, lineStart } = positionAt({ characters, breaks }, source[0]);
      let lineEnd = lineStart;
      while (lineEnd < characters.length && characters[lineEnd] !== "\n" && characters[lineEnd] !== "\r") {
        lineEnd++;
      }
      const shown = characters.slice(lineStart, lineEnd).join("").replace(/\t/g, " ");
      const width = Math.max(1, Math.min(source[1], lineEnd) - source[0]);
      const gutter = `${line} | `;
      const excerpt = `${gutter}${shown}\n${" ".repeat(gutter.length - 2)}| ${" ".repeat(column - 1)}${"^".repeat(width)}`;
      return { line, column, excerpt };
    }

    function attachmentDiagnosticOwners(result) {
      const owners = new Map();
      for (const stage of result.stages ?? []) {
        const pending = (stage.output ?? []).map((token, index) => ({ token, path: `token ${index}`, attached: false }));
        while (pending.length) {
          const { token, path, attached } = pending.pop();
          if (attached) {
            for (const diagnostic of [...(token.errors ?? []), ...(token.warnings ?? [])]) {
              owners.set(diagnostic, `Display owner: ${path} in the ${stage.name} stage.`);
            }
          }
          for (const side of ["before", "after"]) {
            const list = token[side] || [];
            for (let index = list.length - 1; index >= 0; index--) {
              pending.push({ token: list[index], path: `${side} attachment ${index} of ${path}`, attached: true });
            }
          }
        }
      }
      return owners;
    }

    function withAttachments(rootToken, make) {
      const made = make(rootToken);
      const stack = [{ token: rootToken, fill: made.fill }];
      for (let task = stack.pop(); task !== undefined; task = stack.pop()) {
        const values = [[], []];
        [task.token.before || [], task.token.after || []].forEach((list, side) => {
          for (const attachment of list) {
            const inner = make(attachment);
            values[side].push(inner.value);
            stack.push({ token: attachment, fill: inner.fill });
          }
        });
        task.fill(values[0], values[1]);
      }
      return made.value;
    }

    function foldTree(rootNode, leaf, rule) {
      const stack = [];
      let value;
      let pending = rootNode;
      for (;;) {
        if (pending !== null) {
          if (pending.kind === "rule") {
            stack.push({ node: pending, next: 0, values: [] });
            pending = null;
          } else {
            value = leaf(pending);
            pending = null;
            if (stack.length === 0) return value;
            stack[stack.length - 1].values.push(value);
          }
          continue;
        }
        const frame = stack[stack.length - 1];
        if (frame.next < frame.node.children.length) {
          pending = frame.node.children[frame.next++];
          continue;
        }
        stack.pop();
        value = rule(frame.node, frame.values);
        if (stack.length === 0) return value;
        stack[stack.length - 1].values.push(value);
      }
    }

    function nodeBracketSpans(rootNode, tokens, options = {}) {
      if (!rootNode) return [];
      const tokenFlat = (token) => withAttachments(token, (current) => {
        if ((!current.before || current.before.length === 0) && (!current.after || current.after.length === 0)) {
          return { value: { leaf: current.image, kind: "" }, fill: () => {} };
        }
        const group = [];
        return {
          value: { group },
          fill: (before, after) => {
            for (const flat of before) group.push(flat);
            group.push({ leaf: current.image, kind: "" });
            for (const flat of after) group.push(flat);
          },
        };
      });
      const flat = foldTree(
        rootNode,
        (leaf) => (leaf.kind === "token"
          ? (leaf.token >= 0 && leaf.token < tokens.length ? tokenFlat(tokens[leaf.token]) : { leaf: "", kind: "" })
          : options.showElided
            ? { leaf: `⟨${leaf.terminal.replace(/[A-Z]/g, (char) => char.toLowerCase())}⟩`, kind: "el" }
            : null),
        (_rule, values) => {
          const children = values.filter((child) => child !== null);
          if (children.length === 0) return null;
          if (children.length === 1) return children[0];
          return { group: children };
        }
      );
      if (!flat) return [];
      const spans = [];
      const pushSpan = (kind, text) => {
        if (!text) return;
        if (kind === "" && spans.length > 0 && spans[spans.length - 1][0] === "") {
          spans[spans.length - 1][1] += text;
        } else {
          spans.push([kind, text]);
        }
      };
      const stack = [{ node: flat, depth: 0, next: -1 }];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const node = frame.node;
        if ("leaf" in node) {
          pushSpan(node.kind, node.leaf);
          stack.pop();
          continue;
        }
        const [open, close] = [["(", ")"], ["[", "]"], ["{", "}"]][frame.depth % 3];
        const cls = ["b1", "b2", "b3"][frame.depth % 3];
        if (frame.next < 0) {
          pushSpan(cls, open);
          frame.next = 0;
        }
        if (frame.next < node.group.length) {
          if (frame.next > 0) pushSpan("", " ");
          stack.push({ node: node.group[frame.next++], depth: frame.depth + 1, next: -1 });
          continue;
        }
        pushSpan(cls, close);
        stack.pop();
      }
      return spans;
    }

    function summarize(result, pipeline) {
      const error = result.error;
      const hasDiagnostics = (error && (error.source || (error.errors && error.errors.length > 0))) ||
        (result.warnings && result.warnings.length > 0);
      const lines = hasDiagnostics ? lineIndex(result.text) : null;
      const owners = ((error && error.errors && error.errors.length > 0) || (result.warnings && result.warnings.length > 0))
        ? attachmentDiagnosticOwners(result)
        : new Map();
      let errorDetails = null;
      if (error) {
        const stageName = error.stage || null;
        const stageReport = stageName ? result.stages.find((s) => s.name === stageName) : null;
        const stageObj = pipeline && stageName ? pipeline.stages.find((s) => s.name === stageName) : null;
        const rulesMap = stageObj && stageObj.grammar ? stageObj.grammar.rules : null;

        let found = null;
        const tokIdx = error.token === undefined ? null : error.token;
        if (tokIdx !== null && stageReport && Array.isArray(stageReport.input)) {
          if (tokIdx < stageReport.input.length) {
            const tok = stageReport.input[tokIdx];
            found = {
              text: tok.text,
              value: tok.value || "",
              image: tok.image || "",
              tags: tok.tags ? [...tok.tags] : [],
              span: tok.span ? [tok.span[0], tok.span[1]] : null,
              source: tok.source ? [tok.source[0], tok.source[1]] : null,
            };
          } else {
            found = { endOfInput: true, count: stageReport.input.length };
          }
        }

        let expectedByRule = null;
        if (error.expected) {
          const byRule = new Map();
          for (const exp of error.expected) {
            for (const rName of exp.rules || []) {
              let list = byRule.get(rName);
              if (!list) {
                list = [];
                byRule.set(rName, list);
              }
              list.push(exp.terminal);
            }
          }
          expectedByRule = [...byRule.entries()].map(([rule, terminals]) => {
            const rInfo = rulesMap ? rulesMap.get(rule) : null;
            return {
              rule,
              terminals,
              at: rInfo && rInfo.at ? { document: rInfo.at.document, line: rInfo.at.line, column: rInfo.at.column || 1 } : null,
            };
          });
        }

        let boundary = null;
        if (error.boundary) {
          const rInfo = rulesMap && error.boundary.rule ? rulesMap.get(error.boundary.rule) : null;
          boundary = {
            rule: error.boundary.rule,
            condition: error.boundary.condition,
            at: error.boundary.at,
            location: rInfo && rInfo.at ? { document: rInfo.at.document, line: rInfo.at.line, column: rInfo.at.column || 1 } : null,
          };
        }

        const errors = (error.errors || []).map((diagnostic) => ({
          stage: diagnostic.stage,
          rule: diagnostic.rule,
          code: diagnostic.code,
          message: diagnostic.message,
          owner: owners.get(diagnostic) || null,
          excerpt: lines && diagnostic.source ? excerptAt(lines, diagnostic.source).excerpt : null,
          rejection: diagnostic.rejection
            ? {
                token: diagnostic.rejection.token,
                line: diagnostic.rejection.line,
                column: diagnostic.rejection.column,
                excerpt: lines && diagnostic.rejection.source ? excerptAt(lines, diagnostic.rejection.source).excerpt : null,
                expected: (diagnostic.rejection.expected || []).map((exp) => ({
                  terminal: exp.terminal,
                  rules: [...(exp.rules || [])],
                })),
              }
            : null,
        }));

        errorDetails = {
          kind: error.kind,
          feature: error.feature || null,
          reason: error.reason || null,
          stage: stageName,
          token: tokIdx,
          source: error.source ? [error.source[0], error.source[1]] : null,
          excerpt: lines && error.source ? excerptAt(lines, error.source).excerpt : null,
          line: error.line || null,
          column: error.column || null,
          document: error.document || null,
          message: error.message,
          found,
          expectedByRule,
          boundary,
          errors,
        };
      }
      const explanation = gencmu.explainError(result);
      if (errorDetails && errorDetails.expectedByRule) {
        errorDetails.expectedByRule.sort((a, b) => {
          const af = a.rule === "free" ? 1 : 0;
          const bf = b.rule === "free" ? 1 : 0;
          return af - bf || b.terminals.length - a.terminals.length || (a.rule < b.rule ? -1 : 1);
        });
      }
      return {
        ok: result.ok,
        text: result.text,
        features: result.features || [],
        warnings: (result.warnings || []).map((warning) => ({
          stage: warning.stage,
          rule: warning.rule,
          code: warning.code,
          message: warning.message,
          owner: owners.get(warning) || null,
          excerpt: lines && warning.source ? excerptAt(lines, warning.source).excerpt : null,
        })),
        warningsText: gencmu.explainWarnings(result),
        stages: result.stages.map((stage) => ({
          name: stage.name,
          verdict: stage.verdict,
          error: stage.error ? stage.error.kind : null,
          input: stage.input ? stage.input.length : 0,
          output: stage.output ? stage.output.length : null,
        })),
        error: errorDetails,
        explanation,
        ties: result.stages.filter((stage) => stage.verdict === "tie" || (stage.error && stage.error.kind === "ambiguous")).map((stage) => tieView(result, stage)),
      };
    }

    // A tie as the page shows it: explainTies's account of where the two
    // readings first differ, then both readings, as brackets, trees, and JSON,
    // for the page to lay side by side. The readings are in the stage's
    // error.
    function tieView(result, stage) {
      const tokens = stage.input || [];
      const reason = (stage.error && stage.error.reason) || "tie";
      const text = reason === "tie"
        ? gencmu.explainTies({ text: result.text, stages: [stage] })
        : gencmu.explainError({ ...result, error: { ...stage.error, errors: [] } });
      const cut = reason === "tie" ? text.indexOf("\n  first: ") : -1;
      const end = reason === "tie" ? text.lastIndexOf("\n") : -1;
      let firstDiff = "";
      let secondDiff = "";
      if (cut >= 0 && end > cut) {
        const mid = text.slice(cut + 1, end);
        for (const line of mid.split("\n")) {
          const m1 = /^\s*first:\s+(.*)$/.exec(line);
          if (m1) firstDiff = m1[1];
          const m2 = /^\s*second:\s+(.*)$/.exec(line);
          if (m2) secondDiff = m2[1];
        }
      }
      const readings = (stage.error && stage.error.readings) || [];
      const brackets = (node, showElided) => node ? gencmu.nodeBrackets(node, tokens, { showElided }) : "";
      const spansOf = (node, showElided) => node ? nodeBracketSpans(node, tokens, { showElided }) : [];
      const tree = (node) => node ? gencmu.nodeTree(node, tokens, result.text) : "";
      const jsonText = (node) => {
        if (!node) return "";
        const val = gencmu.displayValue({ ...result, stages: [stage], tree: node, error: null });
        return val === null ? "" : gencmu.prettyJson(val);
      };
      const canonicalText = (node) => {
        if (!node) return "";
        return gencmu.prettyJson(
          gencmu.resultJson({ ...result, stages: [], tree: node, error: null, warnings: [] }).tree
        );
      };
      return {
        stage: stage.name,
        reason,
        summary: cut < 0 ? text : text.slice(0, cut),
        firstDiff,
        secondDiff,
        advice: end < 0 ? "" : text.slice(end + 1),
        first: brackets(readings[0], true),
        second: brackets(readings[1], true),
        firstPlain: brackets(readings[0], false),
        secondPlain: brackets(readings[1], false),
        firstSpans: spansOf(readings[0], true),
        secondSpans: spansOf(readings[1], true),
        firstPlainSpans: spansOf(readings[0], false),
        secondPlainSpans: spansOf(readings[1], false),
        firstTree: tree(readings[0]),
        secondTree: tree(readings[1]),
        firstJson: jsonText(readings[0]),
        secondJson: jsonText(readings[1]),
        firstCanonical: canonicalText(readings[0]),
        secondCanonical: canonicalText(readings[1]),
      };
    }

    // The most rows of one stage's tokens sent to the page: a table of a
    // hundred thousand phonemes helps nobody and slows the page.
    const TOKEN_ROWS = 3000;

    // A rendering of the tree says whether there is one: brackets render a
    // tree with no tokens as nothing (docs/output.md), so an empty text does
    // not mean that there is no tree.
    function render(parsed, view) {
      const key = JSON.stringify(view);
      const cached = parsed.renders.get(key);
      if (cached) return cached;
      phase("rendering");
      const result = parsed.result;
      let output;
      switch (view.format) {
        case "tree":
          output = { format: "tree", tree: !!result.tree, text: gencmu.toTree(result) };
          break;
        case "json": {
          const value = gencmu.displayValue(result);
          output = { format: "json", tree: !!result.tree, text: value === null ? "" : gencmu.prettyJson(value) };
          break;
        }
        case "canonical":
          output = { format: "canonical", text: gencmu.prettyJson(gencmu.resultJson(result)) };
          break;
        case "tokens": {
          const stages = result.stages.map((stage) => ({ name: stage.name, verdict: stage.verdict, count: stage.output ? stage.output.length : null }));
          const stage = result.stages.find((each) => each.name === view.stage) ||
            result.stages.find((each) => each.name === "words" && each.output) || result.stages[0];
          const tokens = (stage && stage.output) || [];
          // Canonical tokens keep every attachment field. Send those lists
          // as text, so deeply nested attachments never enter structured clone.
          const selected = stage ? gencmu.resultJson({ ...result, tree: null, error: null, warnings: [],
            stages: [{ ...stage, output: tokens.slice(0, TOKEN_ROWS) }] }).stages[0].output : [];
          const rows = selected.map((token, index) => ({
            index,
            text: token.text,
            value: token.value,
            image: token.image,
            span: token.span[0] + "–" + token.span[1],
            source: token.source[0] + "–" + token.source[1],
            errors: (token.errors || []).map((d) => typeof d === "string" ? d : d.code),
            warnings: (token.warnings || []).map((d) => typeof d === "string" ? d : d.code),
            tags: token.tags,
            insertedBy: token.insertedBy || "",
            before: gencmu.compactJson(token.before || []),
            after: gencmu.compactJson(token.after || []),
          }));
          output = {
            format: "tokens", stages, stage: stage ? stage.name : null, rows, total: tokens.length,
            error: stage && stage.error ? stage.error.kind : null,
          };
          break;
        }
        default: {
          const finalTokens = result.stages.at(-1)?.input || [];
          const spans = result.tree ? nodeBracketSpans(result.tree, finalTokens, { showElided: !!view.showElided }) : [];
          output = {
            format: "brackets",
            tree: !!result.tree,
            text: gencmu.toBrackets(result, { showElided: !!view.showElided }),
            spans,
          };
        }
      }
      parsed.renders.set(key, output);
      return output;
    }

    function runTrace(entry, parsed, request) {
      let traceSpec = request.trace;
      if (traceSpec.toRejection) {
        const err = parsed.summary && parsed.summary.error;
        const stages = entry.pipeline.stages;
        const stage = (err && err.stage && stages.some((s) => s.name === err.stage))
          ? err.stage
          : (traceSpec.stage || stages[stages.length - 1].name);
        const position = (err && err.token !== null && err.token !== undefined)
          ? err.token
          : (traceSpec.position || 0);
        traceSpec = { stage, position };
      }
      const key = JSON.stringify(traceSpec);
      const cached = parsed.traces.get(key);
      if (cached) return cached;
      phase("tracing");
      let answer;
      try {
        const traced = gencmu.trace(entry.pipeline, request.text, {
          stage: traceSpec.stage, position: traceSpec.position,
          features: request.features, withoutFeatures: request.withoutFeatures, elisionOnly: request.elisionOnly,
        });
        // The tokens around the position, for the page's picker.
        const from = Math.max(0, traced.position - 40);
        const to = Math.min(traced.tokens.length, traced.position + 40);
        const text = gencmu.formatTrace(traced);
        const origEvents = traced.events;
        const origExpected = traced.expected;
        const sections = {};
        try {
          traced.expected = [];
          for (const kind of ["completed", "advanced", "predicted", "dropped"]) {
            const events = origEvents.filter((event) =>
              event.kind === kind &&
              !(kind === "completed" && event.production.helper && event.production.rhs.length === 0)
            );
            sections[kind] = events.map((event) => {
              traced.events = [event];
              const itemLines = gencmu.formatTrace(traced).split("\n");
              const lhs = event.production.helper ? `‹${event.production.owner} part›` : event.production.lhs;
              const span = event.kind === "dropped" ? "" : `[${event.origin}..${traced.position}]`;
              const rawLine = itemLines[2] || "";
              const prefix = `  ${lhs} ≔ `;
              const suffix = span ? `  ${span}` : "";
              const rhs = rawLine.slice(prefix.length, suffix ? rawLine.length - suffix.length : rawLine.length);
              const refused = itemLines.length > 4 ? itemLines.slice(3, -1).map((l) => l.trim()).join("\n") : "";
              return { lhs, rhs, span, refused };
            });
          }
        } finally {
          traced.events = origEvents;
          traced.expected = origExpected;
        }
        const expected = origExpected.map((exp) => ({
          terminal: exp.terminal,
          rules: exp.rules.slice(),
        }));
        answer = {
          stage: traced.stage,
          position: traced.position,
          count: traced.tokens.length,
          from,
          tokens: traced.tokens.slice(from, to).map((token) => token.text),
          header: text.split("\n", 1)[0] || "",
          sections,
          expected,
          text,
        };
      } catch (error) {
        answer = { stage: traceSpec.stage, position: traceSpec.position, error: String(error.message || error) };
      }
      parsed.traces.set(key, answer);
      return answer;
    }

    // One run: load the pipeline, parse the text, render what the page shows.
    //
    // request: { pipeline: full pipeline name, text, features: string[], withoutFeatures: string[], until,
    //   elisionOnly: null | boolean, view: { format, showElided,
    //   stage }, trace: null | { stage: string | null, position, toRejection?: boolean }, audit: boolean }
    //
    // A trace whose stage is null gets no trace but traceNeedsStages: true,
    // once the text is parsed. Only that answer tells the page to ask again.
    // An answer with an error has no trace and no such flag, so that the
    // page does not ask again for a run that fails in the same way.
    function run(id, request) {
      runId = id;
      const started = now();
      const entry = loadPipeline(request.pipeline);
      const answer = { kind: "result", id, text: request.text, pipeline: request.pipeline, info: entry.info || null, loadError: entry.error || null };
      if (request.locateRule) {
        let found = null;
        const doc = request.locateRule.document || null;
        const name = request.locateRule.name;
        for (const stage of entry.pipeline?.stages || []) {
          const rule = stage.grammar.rules.get(name);
          if (!rule) continue;
          if (doc) {
            const alt = rule.alternatives.find((a) => a.document === doc);
            if (alt && alt.at) {
              found = alt.at;
              break;
            }
            if (rule.at && rule.at.document === doc) {
              found = rule.at;
              break;
            }
          }
          if (!found && rule.at) {
            found = rule.at;
          }
        }
        answer.ruleLocation = found;
      }
      if (entry.error) return Object.assign(answer, { ms: now() - started });
      let parsed;
      try {
        parsed = parse(entry, request);
      } catch (error) {
        return Object.assign(answer, { parseError: describeError(error), ms: now() - started });
      }
      answer.parse = parsed.summary;
      answer.parseMs = parsed.ms;
      answer.output = render(parsed, request.view);
      // A trace asked for before the page knew the pipeline's stages names
      // none. This answer names them, and says that the page can ask again.
      if (request.trace && request.trace.stage === null && !request.trace.toRejection) answer.traceNeedsStages = true;
      else if (request.trace) answer.trace = runTrace(entry, parsed, request);
      if (request.audit) {
        if (entry.audit === undefined) entry.audit = gencmu.formatAudit(gencmu.audit(entry.pipeline));
        answer.audit = entry.audit;
      }
      answer.ms = now() - started;
      return answer;
    }

    function resumeRun(id, request) {
      try { post(run(id, request)); }
      catch (error) {
        if (!(error instanceof NeedNames)) throw error;
        pendingNames.set(id, request);
        post({ kind: "need-names", id, path: error.path });
      }
    }

    scope.onmessage = (event) => {
      const message = event.data;
      try {
        if (message.kind === "init") init(message);
        else if (message.kind === "set") setDocument(message.path, message.text);
        else if (message.kind === "run") resumeRun(message.id, message.request);
        else if (message.kind === "names") {
          for (const [path,text] of Object.entries(message.resources || {})) {
            if (!sources.has(path)) sources.set(path,text);
          }
          if (message.error) namesErrors.set(message.path,message.error);
          const request = pendingNames.get(message.id);
          if (request) {
            pendingNames.delete(message.id);
            resumeRun(message.id,request);
          }
        }
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
      this.documentDirectives = new Map();
      this.namesResources = new Map();
      this.namesFetches = new Map();
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
        if (message.kind === "dom") {
          this.doms.set(message.path, { hash: message.hash, bootstrap: message.bootstrap, unicode: message.unicode, properties: message.properties,
            ...(message.names === undefined ? {} : { names: message.names }), dom: message.dom });
        } else if (message.kind === "directives") {
          if (message.id === this.runId && this.unsent.size === 0) {
            this.documentDirectives.set(JSON.stringify([message.path, message.inherited]), message.directives);
            this.listener({kind:"documents"});
          }
        }
        else if (message.kind === "need-names") this.supplyNames(worker, message);
        else this.listener(message);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (this.worker === worker) this.listener({ kind: "crashed", message: event.message || "the parser worker stopped" });
      };
      const sources = Object.assign({}, this.bundled);
      for (const [path,text] of this.namesResources) if (!Object.hasOwn(this.bundled,path)) sources[path] = text;
      for (const [path, text] of this.edits) sources[path] = text;
      const preparsed = {};
      for (const [path, entry] of this.doms) if (this.edits.has(path)) preparsed[path] = entry;
      this.unsent.clear();
      worker.postMessage({ kind: "init", sources, preparsed });
    }

    async supplyNames(worker, message) {
      const path = message.path;
      const resource = path === "data/unicode/unicode-names-reference.txt" ? "data/unicode/unicode-names.txt" : path;
      try {
        if (!this.namesFetches.has(resource)) {
          const url = new URL(resource.split("/").map(encodeURIComponent).join("/"), root.location.href);
          const fetching = root.fetch(url).then(async response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await response.arrayBuffer());
          });
          this.namesFetches.set(resource,fetching);
        }
        const text = await this.namesFetches.get(resource);
        const resources = resource === "data/unicode/unicode-names.txt"
          ? { "data/unicode/unicode-names.txt": text, "data/unicode/unicode-names-reference.txt": text } : { [path]: text };
        for (const [key,value] of Object.entries(resources)) this.namesResources.set(key,value);
        if (this.worker === worker) worker.postMessage({ kind: "names", id: message.id, resources });
      } catch (error) {
        this.namesFetches.delete(resource);
        if (this.worker === worker) worker.postMessage({ kind: "names", id: message.id, path,
          error: `${path}: cannot load the names resource: ${error.message}` });
      }
    }

    /** Stops the running worker; the next `start` makes a new one. */
    stop() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
    }

    /** The text of a document as the parser sees it. */
    text(path) {
      return this.edits.has(path) ? this.edits.get(path) : this.bundled[path];
    }

    /** Changes a document; the bundled text itself clears the edit. */
    setDocument(path, text) {
      // An edited preamble can change inherited names in other documents.
      this.documentDirectives.clear();
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
      this.runId = id;
      for (const path of this.unsent) this.worker.postMessage({ kind: "set", path, text: this.text(path) === undefined ? null : this.text(path) });
      this.unsent.clear();
      this.worker.postMessage({ kind: "run", id, request });
    }
  }

  root.ParserWorker = ParserWorker;
})(self);
