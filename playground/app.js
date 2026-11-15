// The playground page: the text, the pipeline and its options, the grammar
// editor, and the results the parser worker (playground/worker.js) renders.
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const bundled = self.gencmuGrammars;

  let createEditor;
  if (self.gencmuEditor === "basic") {
    const basic = await import(new URL("playground/editor-basic.js", document.baseURI).href);
    createEditor = basic.createBasicEditor;
  } else {
    try {
      const full = await import(new URL("playground/editor-full.js", document.baseURI).href);
      createEditor = full.createFullEditor;
    } catch {
      const basic = await import(new URL("playground/editor-basic.js", document.baseURI).href);
      createEditor = basic.createBasicEditor;
    }
  }

  const LOGO_PARTS = [
    { id: "blue-under-upper", cx: 78, turn: "38.571428571429", jam: "3.086" },
    { id: "blue-over-lower", cx: 78, turn: "38.571428571429", jam: "3.086" },
    { id: "pink-over-upper", cx: 50, turn: "38.571428571429", jam: "3.086" },
    { id: "pink-under-lower", cx: 50, turn: "38.571428571429", jam: "3.086" },
    { id: "periwinkle-pinion", cx: 64, turn: "90.000000000000", jam: "7.200" },
  ];

  function setLogoMotion(motion) {
    const logoBtn = $("help-button");
    if (!logoBtn) return;
    logoBtn.dataset.motion = motion;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const part of LOGO_PARTS) {
      const pathEl = $(part.id);
      if (!pathEl) continue;
      pathEl.replaceChildren();
      if (reduce || motion === "still") continue;
      const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
      anim.setAttribute("attributeName", "transform");
      anim.setAttribute("type", "rotate");
      anim.setAttribute("repeatCount", "indefinite");
      if (motion === "turning") {
        anim.setAttribute("from", `0 ${part.cx} 64`);
        anim.setAttribute("to", `${part.turn} ${part.cx} 64`);
        anim.setAttribute("dur", "2s");
        anim.setAttribute("calcMode", "linear");
      } else if (motion === "jammed") {
        anim.setAttribute("values", `0 ${part.cx} 64;${part.jam} ${part.cx} 64;${part.jam} ${part.cx} 64;0 ${part.cx} 64`);
        anim.setAttribute("keyTimes", "0;0.45;0.55;1");
        anim.setAttribute("keySplines", "0.4 0 1 1;0 0 1 1;0.2 0 0.6 1");
        anim.setAttribute("calcMode", "spline");
        anim.setAttribute("dur", "0.7s");
      }
      pathEl.appendChild(anim);
    }
  }

  let busyTimer = 0;
  function setStatus(kind, text) {
    const status = $("status");
    status.dataset.state = kind;
    status.textContent = text;

    const errLink = $("topbar-error-link");
    const phaseEl = $("topbar-phase");
    clearTimeout(busyTimer);

    if (kind === "error") {
      setLogoMotion("jammed");
      if (errLink) errLink.hidden = false;
      if (phaseEl) phaseEl.hidden = true;
    } else if (kind === "loading" || kind === "busy") {
      if (errLink) errLink.hidden = true;
      if (!shown) {
        setLogoMotion("turning");
        if (phaseEl) {
          phaseEl.textContent = text;
          phaseEl.hidden = false;
        }
      } else {
        if (phaseEl && !phaseEl.hidden) {
          phaseEl.textContent = text;
        }
        busyTimer = setTimeout(() => {
          if (status.dataset.state === "loading" || status.dataset.state === "busy") {
            setLogoMotion("turning");
            if (phaseEl) {
              phaseEl.textContent = status.textContent;
              phaseEl.hidden = false;
            }
          }
        }, 150);
      }
    } else {
      setLogoMotion("still");
      if (errLink) errLink.hidden = true;
      if (phaseEl) phaseEl.hidden = true;
    }
  }

  try {
    const url = new URL("data/unicode/unicode-properties.txt", document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bundled["data/unicode/unicode-properties.txt"] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await response.arrayBuffer());
  } catch (error) {
    setStatus("error", `data/unicode/unicode-properties.txt did not load: ${error.message}`);
    return;
  }

  const RESTART_AFTER = 200;
  const TEXT_DELAY = 150;
  const GRAMMAR_DELAY = 400;

  // ---- Documents and pipelines ---------------------------------------------

  function firstHeading(markdown) {
    const match = /^#\s+(.*)$/m.exec(markdown || "");
    return match ? match[1].replace(/`([^`]*)`/g, "$1").trim() : "";
  }

  const pipelineOf = (path) =>
    self.gencmuPipeline.pipelineStages(
      path,
      (document) => client.text(document),
      (document, names) => client.documentDirectives.get(JSON.stringify([document, names]))
    );

  const pipelinePath = (name) => `grammars/${name}/pipeline.md`;
  const preferredPipelines = [
    "lojban/cll",
    "lojban/bpfk",
    "lojban/experimental",
    "lojban/zantufa",
    "lojban/examples/kihei",
    "eberban/refgram",
    "gencmu/jbogenbau",
  ];
  const pipelineNames = self.gencmu.bundledPipelines(bundled);
  pipelineNames.sort((a, b) => {
    const rank = (name) => {
      const index = preferredPipelines.indexOf(name);
      return index < 0 ? preferredPipelines.length : index;
    };
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  });

  function pipelineTitle(name) {
    const heading = firstHeading(bundled[pipelinePath(name)]);
    const cleaned = heading
      .replace(/^The\s+/i, "")
      .replace(/\bpipeline\b\s*/gi, "")
      .replace(/\s+,/g, ",")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "";
  }

  const preferredFamilies = ["lojban", "eberban", "gencmu"];
  const exampleFiles = Object.keys(bundled)
    .filter((key) => /^grammars\/[^/]+\/examples\.json$/.test(key))
    .sort((a, b) => {
      const fa = a.split("/")[1];
      const fb = b.split("/")[1];
      const ra = preferredFamilies.indexOf(fa);
      const rb = preferredFamilies.indexOf(fb);
      const rankA = ra < 0 ? preferredFamilies.length : ra;
      const rankB = rb < 0 ? preferredFamilies.length : rb;
      return rankA - rankB || (a < b ? -1 : a > b ? 1 : 0);
    });
  const allExamples = exampleFiles.flatMap((file) => {
    try {
      const parsed = JSON.parse(bundled[file]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  function resolveOpenDocument(pipelineName, docPath) {
    if (!docPath) return "";
    if (docPath.startsWith("grammars/")) return docPath;
    return self.gencmuPipeline.resolvePath(pipelinePath(pipelineName), docPath);
  }

  const { mergeExampleForPipeline } = self.gencmuPipeline;

  let exampleRule = null;
  let activeExample = null;
  let lastRuleLocation = null;

  // ---- State ---------------------------------------------------------------

  const state = {
    text: $("input").value,
    pipeline: pipelineNames.includes("lojban/cll") ? "lojban/cll" : pipelineNames[0],
    features: new Set(),
    without: new Set(),
    elision: "",
    until: "",
    tab: "brackets",
    showElided: true,
    canonical: false,
    tokenStage: "",
    trace: { stage: "", position: 0, toRejection: false },
    open: null,
    showAllRules: false,
    grammarHidden: false,
    phoneGrammarOpen: false,
  };

  const infos = new Map();
  let shown = null;
  let reading = null;

  const TABS = ["brackets", "tree", "json", "canonical", "tokens", "trace", "audit"];
  function loadFragment() {
    const raw = location.hash.slice(1);
    if (!raw) return;
    const params = new URLSearchParams(raw);
    let needsRepair = false;
    if (params.has("text")) state.text = params.get("text");
    const pipeline = params.get("pipeline");
    if (pipeline && pipelineNames.includes(pipeline)) state.pipeline = pipeline;
    if (params.get("features")) state.features = new Set(params.get("features").split(",").filter(Boolean));
    if (params.get("without")) state.without = new Set(params.get("without").split(",").filter(Boolean));
    if (["on", "off"].includes(params.get("elision"))) state.elision = params.get("elision");
    if (params.get("until")) state.until = params.get("until");
    const view = params.get("view");
    if (view === "canonical") {
      state.tab = "json";
      state.canonical = true;
    } else if (TABS.includes(view)) {
      state.tab = view;
    }
    if (params.get("canonical") === "1") state.canonical = true;
    if (params.get("elided") === "0") state.showElided = false;
    const tokParam = params.get("tokens");
    if (tokParam) {
      const stages = pipelineOf(pipelinePath(state.pipeline)).stages;
      if (stages.some((s) => s.name === tokParam)) {
        state.tokenStage = tokParam;
      } else {
        needsRepair = true;
      }
    }
    if (params.get("stage")) state.trace.stage = params.get("stage");
    if (params.has("pos")) {
      const pos = Number(params.get("pos"));
      if (Number.isInteger(pos) && pos >= 0) state.trace.position = pos;
    }
    if (needsRepair) flushFragment();
  }

  function buildFragment() {
    const params = new URLSearchParams();
    params.set("text", state.text);
    params.set("pipeline", state.pipeline);
    if (state.features.size) params.set("features", [...state.features].join(","));
    if (state.without.size) params.set("without", [...state.without].join(","));
    if (state.elision) params.set("elision", state.elision);
    if (state.until) params.set("until", state.until);
    if (state.tab === "json" && state.canonical) params.set("view", "canonical");
    else if (state.tab !== "brackets") params.set("view", state.tab);
    if (!state.showElided) params.set("elided", "0");
    if (state.canonical && state.tab !== "json") params.set("canonical", "1");
    if (state.tokenStage) params.set("tokens", state.tokenStage);
    if (state.trace.stage) params.set("stage", state.trace.stage);
    if (state.trace.position > 0) params.set("pos", String(state.trace.position));
    return "#" + params.toString().replace(/\+/g, "%20");
  }

  let fragmentTimer = 0;
  function flushFragment() {
    clearTimeout(fragmentTimer);
    fragmentTimer = 0;
    const hash = buildFragment();
    try {
      history.replaceState(null, "", hash);
    } catch {
      try { location.replace(hash); } catch { /* ignore */ }
    }
  }

  function saveFragment() {
    clearTimeout(fragmentTimer);
    fragmentTimer = setTimeout(flushFragment, 300);
  }

  // ---- Busy & Phase status -------------------------------------------------

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
    else if (phase === "loading") text = `Loading ${state.pipeline}…`;
    else if (phase === "reading") {
      const p = running.path || "";
      const fileName = p.slice(p.lastIndexOf("/") + 1);
      text = `Reading ${fileName}…`;
    } else if (phase === "rendering") text = "Rendering…";
    else if (phase === "tracing") text = "Tracing…";
    setStatus(workerReady ? "busy" : "loading", text);
  }

  // ---- Worker management ---------------------------------------------------

  const timings = { workerReady: null, runs: [], restarts: 0 };
  let workerReady = false;
  let nextId = 1;
  const job = { running: null, pending: false, timer: 0, debounce: 0 };
  let generation = 0;
  let shownGeneration = -1;
  const client = new self.ParserWorker(bundled, onWorkerMessage);

  function startWorker() {
    workerReady = false;
    client.start();
  }

  function currentRequest() {
    const info = infos.get(state.pipeline);
    let trace = null;
    if (state.tab === "trace" && info) {
      if (!info.stages.some((stage) => stage.name === state.trace.stage)) {
        state.trace.stage = defaultTraceStage(info);
      }
      trace = {
        stage: state.trace.stage,
        position: state.trace.position,
        ...(state.trace.toRejection ? { toRejection: true } : {}),
      };
    } else if (state.tab === "trace") {
      trace = {
        stage: null,
        position: state.trace.position,
        ...(state.trace.toRejection ? { toRejection: true } : {}),
      };
    }
    let view;
    if (state.tab === "json" && state.canonical) view = { format: "canonical" };
    else if (state.tab === "tokens") view = { format: "tokens", stage: state.tokenStage };
    else if (state.tab === "tree" || state.tab === "json") view = { format: state.tab };
    else view = { format: "brackets", showElided: state.showElided };

    return {
      pipeline: state.pipeline,
      text: state.text,
      features: [...state.features],
      withoutFeatures: [...state.without],
      until: state.until || null,
      elisionOnly: state.elision === "" ? null : state.elision === "on",
      view,
      trace,
      audit: state.tab === "audit",
      locateRule: exampleRule ? { document: exampleRule.document, name: exampleRule.rule } : null,
    };
  }

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
    if (job.running.generation === generation) return;
    job.pending = true;
    considerRestart();
  }

  function neededDocuments() {
    return new Set(pipelineOf(pipelinePath(state.pipeline)).documents);
  }

  function considerRestart() {
    const running = job.running;
    clearTimeout(job.timer);
    if (!running || !job.pending) return;
    if (
      running.phase === "reading" &&
      neededDocuments().has(running.path) &&
      client.revision(running.path) === running.revisions.get(running.path)
    ) {
      return;
    }
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
    if (!client.worker) startWorker();
    const id = nextId++;
    job.running = {
      id,
      generation,
      started: performance.now(),
      phase: "starting",
      path: null,
      revisions: new Map(client.revisions),
    };
    job.pending = false;
    client.run(id, currentRequest());
    setBusy(true);
  }

  function onWorkerMessage(message) {
    const running = job.running;
    switch (message.kind) {
      case "documents":
        renderDocuments();
        break;
      case "ready":
        workerReady = true;
        timings.workerReady = performance.now() - client.startedAt;
        $("version").textContent = `Library ${message.version}`;
        if ($("version-phone")) $("version-phone").textContent = `Library ${message.version}`;
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
        timings.runs.push({
          total: performance.now() - running.started,
          worker: message.ms,
          parse: message.parseMs,
        });
        remember(message);
        finishRun(running.generation === generation);
        if (running.generation === generation) {
          show(message);
          if (exampleRule) {
            const targetRule = exampleRule;
            exampleRule = null;
            const location = message.ruleLocation;
            if (location) {
              lastRuleLocation = location;
              openDocument(location.document, location.line, location.column);
              const actualDocLabel = `${shortLabel(location.document, pipelinePath(state.pipeline).replace(/pipeline\.md$/, ""))}.md`;
              showExampleNote({
                title: targetRule.title || "Example note",
                gloss: targetRule.gloss || "",
                text: targetRule.hint || "",
                ruleLink: {
                  label: `Open ${actualDocLabel} at ${targetRule.rule}`,
                  onClick: () => openDocument(location.document, location.line, location.column),
                },
              });
            } else {
              lastRuleLocation = null;
              showExampleNote({
                title: targetRule.title || "Example note",
                gloss: targetRule.gloss || "",
                text: `Cannot find rule ${targetRule.rule} in the active grammar. ${targetRule.hint || ""}`.trim(),
                ruleLink: null,
              });
            }
          }
        }
        break;
      }
      case "failed":
        if (message.id === null) {
          stopWorker(message.message);
          break;
        }
        if (!running || message.id !== running.id) break;
        finishRun(running.generation === generation);
        if (running.generation === generation) {
          showFailure(message.message);
        }
        break;
      case "crashed":
        stopWorker(message.message);
        break;
    }
  }

  function stopWorker(text) {
    clearTimeout(job.timer);
    job.running = null;
    job.pending = false;
    reading = null;
    setBusy(false);
    showFailure(text);
    workerReady = false;
    client.stop();
    renderDocuments();
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

  // ---- DOM helpers ---------------------------------------------------------

  function fill(node, children) {
    node.replaceChildren();
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
  }

  function element(tag, attributes, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  function linkified(text) {
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const mention of self.gencmuPipeline.documentMentions(text || "")) {
      const { path, line, column } = mention;
      if (!(path in bundled) && !client.edits.has(path)) continue;
      fragment.append(text.slice(at, mention.index));
      fragment.append(element("button", {
        type: "button",
        class: "link",
        text: mention.text,
        title: `Open ${path}${line ? ` at line ${line}` : ""} in the editor`,
        onclick: () => openDocument(path, line ? Number(line) : 0, column ? Number(column) : 1),
      }));
      at = mention.index + mention.text.length;
    }
    fragment.append((text || "").slice(at));
    return fragment;
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const ms = (value) => (value < 10 ? value.toFixed(1) : Math.round(value)) + " ms";

  // ---- Top bar overflow & phone mode ---------------------------------------

  let wasPhone = false;
  // The two minimums do not depend on the window size. They are measured
  // once, and again only when the stage row, the document list or the
  // fonts change.
  let cachedLeftMin = null;
  let cachedListMin = null;
  let leftMinDirty = true;
  let listMinDirty = true;
  let lastDevicePixelRatio = window.devicePixelRatio;

  function minContentWidth(element, clearMaxWidth = false) {
    const prevFlex = element.style.flex;
    const prevWidth = element.style.width;
    const prevMaxWidth = element.style.maxWidth;
    element.style.flex = "none";
    element.style.width = "min-content";
    if (clearMaxWidth) element.style.maxWidth = "none";
    const width = element.getBoundingClientRect().width;
    element.style.flex = prevFlex;
    element.style.width = prevWidth;
    element.style.maxWidth = prevMaxWidth;
    return width;
  }

  // Every fill of the stage row goes through here, so the stored left
  // minimum is always marked stale and the layout is decided again.
  function fillStageRow(chips) {
    leftMinDirty = true;
    fill($("stage-flow"), chips);
    updateTopBarOverflow();
  }

  function updateTopBarOverflow() {
    const app = $("app");
    const topbar = $("topbar");
    const phaseEl = $("topbar-phase");
    const workspace = $("workspace");
    const leftEl = document.querySelector(".left");
    const grammarEl = $("grammar-pane");

    app.classList.remove("phone");
    delete topbar.dataset.overflow;
    if (workspace) {
      workspace.classList.toggle("no-doc", !state.open);
      workspace.classList.remove("no-doc-stacked");
    }

    // The work width is the width inside the root element. In Chromium
    // documentElement.clientWidth does not subtract the stable gutter,
    // so the workspace width is the fixed one to compare against.
    const workW = workspace.clientWidth;

    // The left side's minimum is set only by #stage-flow. Every other
    // block of the left side is a size container, so measuring .left at
    // min-content in the desktop styles gives that minimum.
    if (leftMinDirty || cachedLeftMin === null) {
      cachedLeftMin = leftEl ? minContentWidth(leftEl) : 0;
      leftMinDirty = false;
    }
    const leftMin = cachedLeftMin;

    // With no document open, stack when the two minimums do not fit.
    // The comparison uses the measured minimums, not rendered widths.
    if (workspace && !state.open && !state.grammarHidden && leftEl && grammarEl) {
      if (listMinDirty || cachedListMin === null) {
        cachedListMin = minContentWidth(grammarEl, true);
        listMinDirty = false;
      }
      if (leftMin + cachedListMin > workW) {
        workspace.classList.add("no-doc-stacked");
      }
    }
    const leftTooNarrow = leftEl
      ? workW < leftMin + (state.grammarHidden ? 36 : 0)
      : false;

    let topBarOverflows = false;
    const phaseDisplay = phaseEl ? phaseEl.style.display : "";
    if (phaseEl) phaseEl.style.display = "none";

    const overflows = () => topbar.scrollWidth > topbar.clientWidth;
    if (overflows()) {
      topbar.dataset.overflow = "1";
      if (overflows()) {
        topbar.dataset.overflow = "2";
        if (overflows()) {
          topbar.dataset.overflow = "3";
          if (overflows()) {
            topBarOverflows = true;
          }
        }
      }
    }

    if (phaseEl) phaseEl.style.display = phaseDisplay;

    if (leftTooNarrow || topBarOverflows) {
      delete topbar.dataset.overflow;
      app.classList.add("phone");
      if (!wasPhone) {
        wasPhone = true;
        if (state.phoneGrammarOpen && !state.open) {
          openDocument(pipelinePath(state.pipeline), 0, 1);
        } else {
          updatePhoneGrammarState();
        }
      }
      updatePhoneTabsFade();
    } else if (wasPhone) {
      wasPhone = false;
      closeMenu("doc-more-actions", "doc-more-menu");
    }
  }

  function updatePhoneTabsFade() {
    const tabsEl = $("view-tabs");
    if (!tabsEl) return;
    const hasMore =
      tabsEl.scrollWidth > tabsEl.clientWidth + 4 &&
      tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 4;
    tabsEl.classList.toggle("more", hasMore);
  }

  function updateCodeBlockFade(pre) {
    if (!pre) return;
    const hasMore =
      pre.scrollWidth > pre.clientWidth + 2 &&
      pre.scrollLeft + pre.clientWidth < pre.scrollWidth - 2;
    pre.classList.toggle("more", hasMore);
  }

  function updateAllCodeBlocksFade() {
    for (const pre of document.querySelectorAll(".code-block")) {
      updateCodeBlockFade(pre);
    }
  }

  $("view-tabs").addEventListener("scroll", updatePhoneTabsFade, { passive: true });
  window.addEventListener("resize", () => {
    // Browser zoom fires a resize and changes the device pixel ratio.
    // Zoom can change the minimums, so this resize marks them stale.
    if (window.devicePixelRatio !== lastDevicePixelRatio) {
      lastDevicePixelRatio = window.devicePixelRatio;
      leftMinDirty = true;
      listMinDirty = true;
    }
    updateTopBarOverflow();
    updatePhoneTabsFade();
    updateAllCodeBlocksFade();
  });
  // A change of the text size alone fires no event. Text-only zoom and a
  // minimum font size are examples. A hidden line of text in the stage
  // font changes its width when the text size changes, and an observer
  // then marks the minimums stale. The first report only sets the width.
  if (typeof ResizeObserver !== "undefined") {
    const textProbe = element("span", { class: "text-probe", "aria-hidden": "true", text: "klama → not run" });
    document.body.append(textProbe);
    let textProbeWidth = null;
    new ResizeObserver(() => {
      const width = textProbe.getBoundingClientRect().width;
      if (textProbeWidth !== null && width !== textProbeWidth) {
        leftMinDirty = true;
        listMinDirty = true;
        updateTopBarOverflow();
      }
      textProbeWidth = width;
    }).observe(textProbe);
  }
  if (typeof ResizeObserver !== "undefined" && $("output-card")) {
    new ResizeObserver(() => {
      updateAllCodeBlocksFade();
    }).observe($("output-card"));
  }

  // ---- Popover menus -------------------------------------------------------

  const MENUS = [
    { button: "help-button", menu: "help-menu" },
    { button: "pipeline-button", menu: "pipeline-menu" },
    { button: "examples-button", menu: "examples-menu" },
    { button: "options-button", menu: "options-menu" },
    { button: "doc-more-actions", menu: "doc-more-menu" },
  ];

  function closeMenu(buttonId, menuId) {
    const btnEl = $(buttonId);
    const menuEl = $(menuId);
    if (btnEl) {
      btnEl.setAttribute("aria-expanded", "false");
      btnEl.classList.remove("open");
    }
    if (menuEl) menuEl.hidden = true;
    if (menuId === "examples-menu" && $("phone-examples-button")) {
      $("phone-examples-button").classList.remove("open");
    }
  }

  function closeAllMenus(exceptMenuId = null) {
    for (const { button, menu } of MENUS) {
      if (menu === exceptMenuId) continue;
      closeMenu(button, menu);
    }
  }

  function toggleMenu(buttonId, menuId, anchorEl = null) {
    const btnEl = $(buttonId);
    const menuEl = $(menuId);
    const opening = menuEl.hidden;
    closeAllMenus(opening ? menuId : null);
    btnEl.setAttribute("aria-expanded", String(opening));
    btnEl.classList.toggle("open", opening);
    if (anchorEl) anchorEl.classList.toggle("open", opening);
    menuEl.hidden = !opening;
    if (opening && menuId !== "doc-more-menu" && !$("app").classList.contains("phone")) {
      const ref = anchorEl || btnEl;
      const rect = ref.getBoundingClientRect();
      const topbarRect = $("topbar").getBoundingClientRect();
      if (menuId === "options-menu") {
        menuEl.style.right = `${Math.max(8, topbarRect.right - rect.right)}px`;
        menuEl.style.left = "auto";
      } else {
        menuEl.style.left = "8px";
        const menuW = menuEl.offsetWidth || 360;
        const left = Math.max(8, Math.min(rect.left - topbarRect.left, topbarRect.width - menuW - 8));
        menuEl.style.left = `${left}px`;
      }
    }
  }

  for (const { button, menu } of MENUS) {
    $(button).addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu(button, menu);
    });
  }

  $("phone-examples-button").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu("examples-button", "examples-menu", $("phone-examples-button"));
  });

  document.addEventListener("click", (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    for (const { button, menu } of MENUS) {
      const menuEl = $(menu);
      const btnEl = $(button);
      if (!menuEl.hidden) {
        if (
          path.includes(menuEl) ||
          path.includes(btnEl) ||
          path.includes($("phone-examples-button")) ||
          menuEl.contains(event.target) ||
          btnEl.contains(event.target) ||
          $("phone-examples-button").contains(event.target)
        ) {
          return;
        }
      }
    }
    closeAllMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });

  // ---- Result rendering ----------------------------------------------------

  function checkBadgeIcon() {
    const s = document.createElement("span");
    s.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
    return s.firstElementChild;
  }

  function crossIcon() {
    const s = document.createElement("span");
    s.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    return s.firstElementChild;
  }

  function warnIcon(size = 15) {
    const s = document.createElement("span");
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
    return s.firstElementChild;
  }

  function tieIcon() {
    const s = document.createElement("span");
    s.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3"/><path d="m15 9 6-6"/></svg>`;
    return s.firstElementChild;
  }

  function checkIcon() {
    const span = document.createElement("span");
    span.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>`;
    return span.firstElementChild;
  }

  function remember(message) {
    if (!message.info) return;
    const before = JSON.stringify(infos.get(message.pipeline) || null);
    infos.set(message.pipeline, message.info);
    if (message.pipeline === state.pipeline && before !== JSON.stringify(message.info)) {
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
    $("result").dataset.pipeline = message.pipeline;
    renderSummary(message);
    renderDiagnostics(message);
    renderOutput(message);
    renderDocuments();
    renderDocumentError();
    if (message.loadError) setStatus("ready", "The pipeline has a grammar error");
    else if (message.parseError) setStatus("ready", "The parser could not run");
    else setStatus("ready", "Ready");
    if (state.tab === "trace" && message.traceNeedsStages) schedule(0);
  }

  function showFailure(text) {
    setStatus("error", "The parser stopped");
    $("verdict-top").hidden = true;
    const info = infos.get(state.pipeline);
    const stageList = info
      ? info.stages
      : pipelineOf(pipelinePath(state.pipeline)).stages;
    const chips = [];
    stageList.forEach((stage, index) => {
      if (index > 0) {
        chips.push(element("span", { class: "arrow", "aria-hidden": "true", text: "→" }));
      }
      chips.push(element("span", { class: "stage idle" },
        element("b", { text: stage.name }),
        element("span", { class: "sr-only", text: " " }),
        element("span", { text: "not run" })));
    });
    fillStageRow(chips);
    $("features-used").hidden = true;

    const optsDesc = [
      state.features.size ? `features: ${[...state.features].join(",")}` : "",
      state.without.size ? `without: ${[...state.without].join(",")}` : "",
      state.elision ? `elision: ${state.elision}` : "",
      state.until ? `until: ${state.until}` : "",
    ].filter(Boolean).join(", ") || "default";
    const issueTitle = encodeURIComponent(`Playground parser error: ${text.split("\n")[0].slice(0, 80)}`);
    const issueBody = encodeURIComponent(
      `Pipeline: \`${state.pipeline}\`\nOptions: ${optsDesc}\nLibrary: \`@gencmu/parser\` (playground)\nInput:\n\`\`\`\n${state.text}\n\`\`\`\n\nError:\n\`\`\`\n${text}\n\`\`\`\n`
    );
    const issueHref = `https://github.com/int19h/gencmu/issues/new?title=${issueTitle}&body=${issueBody}`;

    const headRow = element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--bad)" },
      warnIcon(18),
      element("h2", { style: "margin:0;font-size:15px;font-weight:650;color:var(--bad)", text: "The parser stopped" }));

    const box = element("div", { class: "alert-box bad box", id: "parser-error", role: "alert", style: "gap:10px" },
      headRow,
      element("p", { style: "margin:0", text: "This is a bug in gencmu. A new parser starts with your next change." }),
      element("pre", { class: "parser-stop-pre", text }),
      element("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center" },
        element("a", {
          class: "btn primary",
          href: issueHref,
          target: "_blank",
          rel: "noopener",
          text: "Report this bug",
        }),
        element("button", {
          type: "button",
          class: "btn",
          text: "Copy the details",
          onclick: (e) => copyText(text, e.currentTarget, "Copy the details"),
        })));
    $("diagnostics").replaceChildren(box);
    $("output").replaceChildren(element("p", { class: "empty-out", text: "No result." }));
    updateTabToolbar(false);
  }

  function renderSummary(message) {
    $("verdict-top").hidden = false;
    const info = message.info || infos.get(message.pipeline);
    const badge = $("verdict-badge");
    const copyLinkBtn = $("copy-link");

    if (message.loadError) {
      badge.className = "badge bad";
      badge.removeAttribute("aria-label");
      fill(badge, [warnIcon(), "Grammar error"]);
      copyLinkBtn.hidden = true;
    } else if (message.parseError) {
      badge.className = "badge bad";
      badge.removeAttribute("aria-label");
      fill(badge, [crossIcon(), "Error"]);
      copyLinkBtn.hidden = false;
    } else if (message.parse.ok) {
      const warned = message.parse.warnings.length;
      if (warned > 0) {
        const warnLabel = plural(warned, "warning");
        badge.className = "badge badge-joined";
        badge.setAttribute("aria-label", `Accepted, ${warnLabel}`);
        fill(badge, [
          element("span", { class: "part-ok" }, checkBadgeIcon(), "Accepted"),
          element("span", { class: "sr-only", text: ", " }),
          element("span", { class: "part-warn", text: warnLabel }),
        ]);
      } else {
        badge.className = "badge good";
        badge.removeAttribute("aria-label");
        fill(badge, [checkBadgeIcon(), "Accepted"]);
      }
      copyLinkBtn.hidden = false;
    } else {
      copyLinkBtn.hidden = false;
      badge.removeAttribute("aria-label");
      const err = message.parse.error;
      if (err.kind === "rejected") {
        badge.className = "badge bad";
        fill(badge, [crossIcon(), `Rejected by ${err.stage}`]);
      } else if (err.kind === "ambiguous" && err.reason === "tie") {
        badge.className = "badge tie";
        fill(badge, [tieIcon(), `Tie in ${err.stage}`]);
      } else if (err.kind === "ambiguous") {
        badge.className = "badge warn";
        fill(badge, [warnIcon(), `Elision-only check failed in ${err.stage}`]);
      } else if (err.kind === "reported") {
        badge.className = "badge bad";
        fill(badge, [crossIcon(), `Errors in ${err.stage}`]);
      } else if (err.kind === "feature-conflict") {
        badge.className = "badge bad";
        fill(badge, [
          crossIcon(),
          `Feature conflict in ${err.stage || "pipeline"}`,
          element("span", { class: "sr-only", text: ` (required feature ${err.feature} is disabled)` }),
        ]);
      } else {
        badge.className = "badge bad";
        fill(badge, [crossIcon(), `Grammar error in ${err.stage || "pipeline"}`]);
      }
    }

    if (message.loadError || message.parseError || message.parseMs === undefined) {
      $("timing").textContent = "";
      $("timing").title = "";
    } else {
      $("timing").textContent = ms(message.parseMs);
      $("timing").title = "Parse time";
    }

    const chips = [];
    const reports = message.parse ? message.parse.stages : [];
    const stageList = info
      ? info.stages
      : reports.length
        ? reports
        : pipelineOf(pipelinePath(message.pipeline || state.pipeline)).stages;

    stageList.forEach((stage, index) => {
      if (index > 0) {
        chips.push(element("span", { class: "arrow", "aria-hidden": "true", text: "→" }));
      }
      const report = reports.find((each) => each.name === stage.name);
      if (message.loadError) {
        chips.push(element("span", { class: "stage idle" },
          element("b", { text: stage.name }),
          element("span", { class: "sr-only", text: " " }),
          element("span", { text: "not loaded" })));
        return;
      }
      if (!report) {
        chips.push(element("span", { class: "stage idle" },
          element("b", { text: stage.name }),
          element("span", { class: "sr-only", text: " " }),
          element("span", { text: "not run" })));
        return;
      }

      const isLast = index === stageList.length - 1;

      if (report.error) {
        const err = message.parse && message.parse.error;
        const isTie = err && err.stage === stage.name && err.kind === "ambiguous" && err.reason === "tie";
        const isAmbig = err && err.stage === stage.name && err.kind === "ambiguous";
        const errLabel = isTie
          ? "tie"
          : isAmbig
            ? "ambiguous"
            : err && err.stage === stage.name && err.kind === "rejected"
              ? "rejected"
              : report.error;
        const hasOwnTokens = report.output !== null && report.output !== undefined;
        const tokenStageName = hasOwnTokens
          ? stage.name
          : index > 0
            ? stageList[index - 1].name
            : stage.name;
        chips.push(element("button", {
          type: "button",
          class: `stage ${isAmbig ? "tie" : "bad"}`,
          title: hasOwnTokens
            ? `Show tokens handed on by ${stage.name}`
            : index > 0
              ? `Show tokens from ${tokenStageName}, read by ${stage.name}`
              : `Show tokens for ${stage.name}`,
          onclick: () => {
            state.tokenStage = tokenStageName;
            selectTab("tokens", true);
          },
        },
        element("b", { text: stage.name }),
        element("span", { class: "sr-only", text: " " }),
        element("span", { text: errLabel })));
      } else {
        const hasTokenCount = !(isLast && !report.output) &&
          report.output !== null && report.output !== undefined;
        let detailSpan;
        let plainDetail;
        if (hasTokenCount) {
          const word = report.output === 1 ? " token" : " tokens";
          plainDetail = `${report.output}${word}`;
          detailSpan = element("span", {},
            String(report.output),
            element("i", { class: "tok-word", text: word }));
        } else {
          plainDetail = report.verdict || "accepted";
          detailSpan = element("span", { text: plainDetail });
        }
        chips.push(element("button", {
          type: "button",
          class: "stage",
          title: `Show tokens handed on by ${stage.name}`,
          onclick: () => {
            state.tokenStage = stage.name;
            selectTab("tokens", true);
          },
        },
        element("b", { text: stage.name }),
        element("span", { class: "sr-only", text: " " }),
        detailSpan,
        report.verdict && !plainDetail.includes(report.verdict)
          ? element("span", { class: "sr-only", text: ` ${report.verdict}` })
          : null));
      }
    });
    fillStageRow(chips);

    const used = message.parse && !message.loadError ? message.parse.features : [];
    const featsEl = $("features-used");
    if (used && used.length) {
      featsEl.hidden = false;
      fill(featsEl, [
        "Enabled features",
        used.map((name) => element("code", { class: "chip", text: name })),
      ]);
    } else {
      featsEl.hidden = true;
      featsEl.replaceChildren();
    }
  }

  function renderReportedErrorBox(err) {
    const bodyChildren = [];
    const ruleBtn = err.rule
      ? element("button", {
          type: "button",
          class: "link",
          text: err.rule,
          onclick: () => jumpToRuleName(err.rule, err.stage),
        })
      : null;
    if (err.code && err.stage && ruleBtn) {
      bodyChildren.push(element("p", { style: "margin:0;font-size:13.5px" },
        `Error ${err.code} in the ${err.stage} stage, rule `,
        ruleBtn,
        `: ${err.message}`));
    } else if (err.message) {
      bodyChildren.push(element("p", { style: "margin:0;font-size:13.5px", text: err.message }));
    }
    if (err.owner) {
      bodyChildren.push(element("p", { style: "margin:0;font-size:13px;color:var(--muted)", text: err.owner }));
    }
    if (err.excerpt) {
      const [srcLine, caretLine] = err.excerpt.split("\n");
      const ex = formatExcerptNode(srcLine || "", caretLine || "", "var(--bad)");
      ex.style.background = "var(--surface)";
      ex.style.border = "1px solid var(--bad-line)";
      bodyChildren.push(ex);
    }
    if (err.rejection) {
      const ev = err.rejection;
      bodyChildren.push(element("p", {
        style: "margin:0;font-size:13px",
        text: `The competing readings reach token ${ev.token}, line ${ev.line}, column ${ev.column}:`,
      }));
      if (ev.excerpt) {
        const [rSrc, rCaret] = ev.excerpt.split("\n");
        const rex = formatExcerptNode(rSrc || "", rCaret || "", "var(--bad)");
        rex.style.background = "var(--surface)";
        rex.style.border = "1px solid var(--bad-line)";
        bodyChildren.push(rex);
      }
      const expText = ev.expected && ev.expected.length
        ? ev.expected.map((e) => `  ${e.terminal}: ${(e.rules || []).join(", ")}`).join("\n")
        : "No terminal can continue those readings.";
      bodyChildren.push(element("pre", { class: "alert-pre", text: expText }));
    }
    return element("div", { class: "alert-box bad box", role: "alert" },
      element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--bad)" },
        warnIcon(18),
        element("h2", { style: "margin:0;font-size:15px;font-weight:650;color:var(--bad)", text: `Reported error in ${err.stage || "pipeline"}` })),
      element("div", { style: "display:flex;flex-direction:column;gap:8px" }, bodyChildren));
  }

  function renderDiagnostics(message) {
    const boxes = [];

    if (message.loadError) {
      const error = message.loadError;
      boxes.push(element("div", { class: "alert-box bad box", role: "alert" },
        element("h2", { text: `The ${message.pipeline} pipeline cannot load` }),
        element("p", { class: "alert-pre" }, linkified(error.message))));
    }

    if (message.parseError) {
      boxes.push(element("div", { class: "alert-box bad box", role: "alert" },
        element("h2", { text: "The parser could not run" }),
        element("pre", { class: "alert-pre" }, linkified(message.parseError.message))));
    }

    const parse = message.parse;
    const error = parse && parse.error;
    if (error && error.kind !== "ambiguous") {
      if (error.kind === "rejected") {
        boxes.push(renderRejectionBox(parse, error));
      } else if (error.kind === "reported") {
        if (!Array.isArray(error.errors) || error.errors.length === 0) {
          boxes.push(element("div", { class: "alert-box bad box", role: "alert" },
            element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--bad)" },
              warnIcon(18),
              element("h2", { style: "margin:0;font-size:15px;font-weight:650;color:var(--bad)", text: `Reported error in ${error.stage}` })),
            element("pre", { class: "alert-pre", text: parse.explanation || "" })));
        }
      } else if (error.kind === "feature-conflict") {
        const feat = error.feature || "";
        const turnOnRow = feat
          ? element("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center" },
              element("button", {
                type: "button",
                class: "btn",
                text: `Turn on ${feat}`,
                onclick: () => {
                  state.features.add(feat);
                  state.without.delete(feat);
                  renderOptions();
                  schedule(0);
                },
              }))
          : null;
        boxes.push(element("div", { class: "alert-box bad box", role: "alert" },
          element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--bad)" },
            warnIcon(18),
            element("h2", { style: "margin:0;font-size:15px;font-weight:650;color:var(--bad)", text: `Required feature ${feat} is disabled` })),
          element("p", { style: "margin:0;font-size:13.5px", text: error.message || parse.explanation }),
          turnOnRow));
      } else {
        boxes.push(element("div", { class: "alert-box bad box", role: "alert" },
          element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--bad)" },
            warnIcon(18),
            element("h2", { style: "margin:0;font-size:15px;font-weight:650;color:var(--bad)", text: `Grammar error in ${error.stage || "pipeline"}` })),
          element("p", { class: "alert-pre" }, linkified(parse.explanation))));
      }
    }

    if (parse && parse.ties && parse.ties.length) {
      for (const tie of parse.ties) {
        boxes.push(renderTieBox(tie));
      }
    }

    if (error && Array.isArray(error.errors) && error.errors.length > 0) {
      for (const err of error.errors) {
        boxes.push(renderReportedErrorBox(err));
      }
    }

    if (parse && Array.isArray(parse.warnings) && parse.warnings.length) {
      const warnBlocks = parse.warnings.map((w) => {
        const ruleBtn = w.rule
          ? element("button", {
              type: "button",
              class: "link",
              text: w.rule,
              onclick: () => jumpToRuleName(w.rule, w.stage),
            })
          : null;
        const items = [
          ruleBtn
            ? element("p", { style: "margin:0;font-size:13.5px" },
                `Warning ${w.code} in the ${w.stage} stage, rule `,
                ruleBtn,
                `: ${w.message}`)
            : element("p", { style: "margin:0;font-size:13.5px", text: `Warning ${w.code} in the ${w.stage} stage, rule ${w.rule}: ${w.message}` }),
        ];
        if (w.owner) {
          items.push(element("p", { style: "margin:0;font-size:13px;color:var(--muted)", text: w.owner }));
        }
        if (typeof w.excerpt === "string" && w.excerpt) {
          const [srcLine, caretLine] = w.excerpt.split("\n");
          const ex = formatExcerptNode(srcLine || "", caretLine || "", "var(--warn)");
          ex.style.background = "var(--surface)";
          ex.style.border = "1px solid var(--warn-line)";
          items.push(ex);
        }
        return element("div", { style: "display:flex;flex-direction:column;gap:8px" }, items);
      });
      boxes.push(element("div", { class: "alert-box warn box" },
        element("div", { style: "display:flex;align-items:center;gap:8px;color:var(--warn)" },
          warnIcon(18),
          element("h3", { text: plural(parse.warnings.length, "warning") })),
        warnBlocks));
    }

    if (boxes.length > 0 && !boxes[0].id) {
      boxes[0].id = "explanation";
    }
    fill($("diagnostics"), boxes);
  }

  function formatExcerptNode(srcLine, caretLine, caretColor) {
    const srcParts = [];
    const srcMatch = srcLine.match(/^(\s*\d*\s*[|│]\s?)(.*)$/);
    if (srcMatch) {
      srcParts.push(element("span", { style: "color:var(--faint)", text: srcMatch[1] }), srcMatch[2]);
    } else {
      srcParts.push(srcLine);
    }

    const caretParts = [];
    const caretMatch = caretLine.match(/^(\s*[|│]\s?)(\s*)(\^+)(.*)$/);
    if (caretMatch) {
      caretParts.push(
        element("span", { style: "color:var(--faint)", text: caretMatch[1] }),
        caretMatch[2],
        element("span", { style: `color:${caretColor};font-weight:700`, text: caretMatch[3] }),
        caretMatch[4]
      );
    } else {
      const plainCaret = caretLine.match(/^(\s*)(\^+)(.*)$/);
      if (plainCaret) {
        caretParts.push(
          plainCaret[1],
          element("span", { style: `color:${caretColor};font-weight:700`, text: plainCaret[2] }),
          plainCaret[3]
        );
      } else {
        caretParts.push(caretLine);
      }
    }

    return element("pre", { class: "excerpt" }, srcParts, "\n", caretParts);
  }

  function renderRejectionBox(parse, error) {
    const children = [];
    const lines = (parse.explanation || "").split("\n");
    const leadLine = lines[0] || `The ${error.stage} stage cannot read the text.`;

    const leadParts = [];
    const stagePrefix = `The ${error.stage} stage `;
    if (leadLine.startsWith(stagePrefix)) {
      leadParts.push("The ", element("span", { class: "mono", text: error.stage }), " stage ");
      const rest = leadLine.slice(stagePrefix.length);
      const quoteMatch = rest.match(/^(.*?")([^"]+)(".*)$/);
      if (quoteMatch) {
        leadParts.push(quoteMatch[1], element("span", { class: "mono", text: quoteMatch[2] }), quoteMatch[3]);
      } else {
        leadParts.push(rest);
      }
    } else {
      leadParts.push(leadLine);
    }
    children.push(element("p", { class: "explain-lead" }, leadParts));

    if (typeof error.excerpt === "string" && error.excerpt) {
      const [srcLine, caretLine] = error.excerpt.split("\n");
      children.push(formatExcerptNode(srcLine || "", caretLine || "", "var(--bad)"));
    }

    const byRule = error.expectedByRule || [];
    if (byRule.length > 0) {
      children.push(element("p", { class: "explain-sub", text: "What could have come there, by the rule that would have read it:" }));

      const visibleRules = state.showAllRules ? byRule : byRule.slice(0, 5);
      const dlItems = [];
      for (const group of visibleRules) {
        const terminals = group.terminals || [];
        const ruleBtn = group.rule !== "(literal)"
          ? element("button", {
              type: "button",
              class: "link",
              text: group.rule,
              onclick: () => {
                if (group.at && group.at.document) {
                  openDocument(group.at.document, group.at.line || 1, group.at.column || 1);
                } else {
                  jumpToRuleName(group.rule, error.stage);
                }
              },
            })
          : element("span", { text: group.rule });
        dlItems.push(
          element("dt", {}, ruleBtn, element("span", { class: "sr-only", text: ": " })),
          element("dd", { text: terminals.join(", ") })
        );
      }
      children.push(element("dl", { class: "exp expected-summary" }, dlItems));
    } else {
      children.push(element("p", { class: "explain-sub", text: "Nothing could have continued there." }));
    }

    if (error.boundary) {
      const b = error.boundary;
      const bRuleBtn = element("button", {
        type: "button",
        class: "link",
        text: b.rule,
        onclick: () => {
          if (b.location && b.location.document) {
            openDocument(b.location.document, b.location.line || 1, b.location.column || 1);
          } else {
            jumpToRuleName(b.rule, error.stage);
          }
        },
      });
      children.push(element("p", { class: "explain-sub" },
        "Failed boundary condition in rule ",
        bRuleBtn,
        ` (condition ${b.condition} at position ${b.at}).`));
    }

    const actionRow = [];
    if (byRule.length > 5) {
      actionRow.push(element("button", {
        type: "button",
        class: "btn",
        text: state.showAllRules ? "Show fewer rules" : `Show all ${byRule.length} rules`,
        onclick: () => {
          state.showAllRules = !state.showAllRules;
          if (shown) renderDiagnostics(shown);
        },
      }));
    }
    if (error.stage) {
      actionRow.push(element("button", {
        type: "button",
        class: "btn",
        text: "Trace here",
        onclick: () => {
          state.trace = {
            stage: error.stage,
            position: error.token === null || error.token === undefined ? 0 : error.token,
            toRejection: false,
          };
          selectTab("trace", true);
        },
      }));
    }
    if (actionRow.length > 0) {
      children.push(element("div", { style: "display:flex;flex-wrap:wrap;align-items:center;gap:8px" }, actionRow));
    }

    return element("div", { class: "explain-divider box" }, children);
  }

  function findCaretLineIndex(lines, fromIndex = 1) {
    for (let i = fromIndex; i < lines.length; i++) {
      if (/^\s*[|│]\s*\^+\s*$/.test(lines[i])) return i;
    }
    return -1;
  }

  function renderTieBox(tie) {
    if (tie.reason && tie.reason !== "tie") {
      return element("div", { class: "explain-divider box" },
        element("pre", { class: "excerpt", text: tie.summary || "" }));
    }
    const summaryLines = (tie.summary || "").split("\n");
    const leadText = summaryLines[0] || `The ${tie.stage} stage is ambiguous.`;
    let srcLine = "";
    let caretLine = "";
    let firstDiff = tie.firstDiff || tie.first || "";
    let secondDiff = tie.secondDiff || tie.second || "";

    const differIdx = summaryLines.findIndex((l) => l.startsWith("They first differ here:"));
    if (differIdx >= 0) {
      const caretIdx = findCaretLineIndex(summaryLines, differIdx + 2);
      if (caretIdx >= differIdx + 2) {
        srcLine = summaryLines[caretIdx - 1];
        caretLine = summaryLines[caretIdx];
      }
    }
    for (const line of summaryLines) {
      if (line.startsWith("  the first reading ")) {
        firstDiff = line.slice("  the first reading ".length);
      } else if (line.startsWith("  the second reading ")) {
        secondDiff = line.slice("  the second reading ".length);
      }
    }

    const excerptEl = srcLine
      ? formatExcerptNode(srcLine, caretLine, "var(--warn)")
      : element("pre", { class: "excerpt", text: tie.summary });

    return element("div", { class: "explain-divider box" },
      element("p", { class: "explain-lead", text: leadText }),
      element("p", { class: "explain-sub", text: "They first differ here:" }),
      excerptEl,
      element("dl", { class: "tie-dl" },
        element("dt", { text: "First reading" }),
        element("dd", { text: firstDiff }),
        element("dt", { text: "Second reading" }),
        element("dd", { text: secondDiff })),
      element("p", { class: "explain-sub", text: tie.advice || "" }));
  }

  function jumpToRuleName(ruleName, stageName) {
    const info = infos.get(state.pipeline);
    if (!info || !info.ruleLocations || !stageName) return;
    const loc = info.ruleLocations[stageName] && info.ruleLocations[stageName][ruleName];
    if (loc && loc.document) {
      openDocument(loc.document, loc.line || 1, loc.column || 1);
    }
  }

  // ---- Output views --------------------------------------------------------

  function formatColoredBrackets(text, spans) {
    const frag = document.createDocumentFragment();
    if (Array.isArray(spans) && spans.length > 0) {
      for (const [kind, chunk] of spans) {
        if (!chunk) continue;
        if (!kind) {
          frag.appendChild(document.createTextNode(chunk));
        } else {
          const span = document.createElement("span");
          span.className = kind;
          span.textContent = chunk;
          frag.appendChild(span);
        }
      }
      return frag;
    }
    if (text) frag.appendChild(document.createTextNode(text));
    return frag;
  }

  function appendSpaceRuns(parent, text, { linkifyRuns = false, extraClass = "", mode = "code" } = {}) {
    if (!text) return;
    if (linkifyRuns) {
      for (const part of text.split(/( +)/)) {
        if (!part) continue;
        if (part[0] === " ") {
          parent.append(part);
        } else {
          const cls = extraClass ? `wrun ${extraClass}` : "wrun";
          parent.append(element("span", { class: cls }, linkified(part)));
        }
      }
      return;
    }
    const re = mode === "tree" ? /[^ ]+(?: [›·])*/g : /[^ ]+/g;
    let last = 0;
    let m;
    const cls = extraClass ? `wrun ${extraClass}` : "wrun";
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        parent.append(text.slice(last, m.index));
      }
      parent.append(element("span", { class: cls, text: m[0] }));
      last = re.lastIndex;
    }
    if (last < text.length) {
      parent.append(text.slice(last));
    }
  }

  function renderWrappedLines(rawText, { className = "result-text code-block", linkify = false, mode = "code", tabindex = null } = {}) {
    const pre = element("pre", { class: className });
    if (tabindex !== null) pre.tabIndex = tabindex;
    const lines = (rawText || "").split("\n");
    const nodes = lines.map((line, idx) => {
      const m = /^( *)/.exec(line);
      const leadCount = m ? m[1].length : 0;
      const leadSpaces = line.slice(0, leadCount);
      const rest = line.slice(leadCount);
      const span = element("span", {
        class: "wline",
        style: `padding-left:calc(${leadCount}ch + 4ch);text-indent:-4ch;min-width:calc(${leadCount}ch + 28ch + var(--code-pad-r, 18px))`,
      });
      if (leadCount > 0) {
        span.append(element("span", { class: "wsp", text: leadSpaces }));
      }
      appendSpaceRuns(span, rest, { linkifyRuns: linkify, mode });
      if (idx < lines.length - 1) {
        span.append(element("span", { class: "wsp", text: "\n" }));
      }
      return span;
    });
    fill(pre, nodes);
    pre.addEventListener("scroll", () => updateCodeBlockFade(pre), { passive: true });
    return pre;
  }

  let copyOutputText = "";
  const CANONICAL_LINES = 3000;
  const CANONICAL_WORDS = 6000;
  function sliceCanonical(rawText, maxLines = CANONICAL_LINES, maxWords = CANONICAL_WORDS) {
    const text = rawText || "";
    const len = text.length;
    let totalLines = 1;
    let totalWords = 0;
    let shownLines = 0;
    let shownWords = 0;
    let cutIndex = -1;
    let cappedBy = null;
    let inWord = false;

    for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code === 10) {
        inWord = false;
        if (cutIndex < 0 && totalLines === maxLines) {
          cutIndex = i;
          cappedBy = "lines";
          shownLines = maxLines;
          shownWords = totalWords;
        }
        totalLines++;
      } else if (code === 32) {
        inWord = false;
      } else if (!inWord) {
        if (cutIndex < 0 && totalWords === maxWords) {
          cutIndex = i;
          while (cutIndex > 0 && text.charCodeAt(cutIndex - 1) === 32) cutIndex--;
          cappedBy = "words";
          shownLines = totalLines;
          shownWords = maxWords;
        }
        inWord = true;
        totalWords++;
      }
    }

    const capped = cutIndex >= 0;
    const noteText = !capped
      ? ""
      : cappedBy === "lines"
        ? `Showing the first ${shownLines} of ${totalLines} lines. Copy copies the whole text.`
        : `Showing the first ${shownWords} of ${totalWords} words. Copy copies the whole text.`;

    return {
      shownText: capped ? text.slice(0, cutIndex) : text,
      totalLines,
      totalWords,
      shownLines: capped ? shownLines : totalLines,
      shownWords: capped ? shownWords : totalWords,
      capped,
      cappedBy,
      noteText,
    };
  }

  function updateTabToolbar(hasOutput = true) {
    $("elided-toggle").hidden = !(state.tab === "brackets" && hasOutput);
    $("canonical-toggle").hidden = !(state.tab === "json" && hasOutput);
    const showCopy = ["brackets", "tree", "json", "audit"].includes(state.tab) && hasOutput;
    $("copy-output").hidden = !showCopy;
    $("output-controls").hidden =
      $("elided-toggle").hidden && $("canonical-toggle").hidden && $("copy-output").hidden;
  }

  function renderOutput(message) {
    const output = $("output");
    const empty = (text) => element("p", { class: "empty-out", text });

    if (message.loadError || message.parseError) {
      copyOutputText = "";
      updateTabToolbar(false);
      output.replaceChildren(empty("No result."));
      return;
    }

    if (state.tab === "audit") {
      if (message.audit === undefined || message.audit === null) {
        copyOutputText = "";
        updateTabToolbar(false);
        output.replaceChildren();
      } else {
        copyOutputText = message.audit;
        updateTabToolbar(true);
        output.replaceChildren(renderWrappedLines(message.audit, { className: "result-text code-block", linkify: true, tabindex: 0 }));
        updateAllCodeBlocksFade();
      }
      return;
    }

    if (state.tab === "trace") {
      copyOutputText = "";
      updateTabToolbar(false);
      renderTrace(message.trace);
      updateAllCodeBlocksFade();
      return;
    }

    if (state.tab === "tokens") {
      copyOutputText = "";
      updateTabToolbar(false);
      if (message.output && message.output.format === "tokens") {
        renderTokens(message.output);
      } else {
        output.replaceChildren();
      }
      return;
    }

    const parse = message.parse;
    if (parse && parse.error && parse.error.kind === "ambiguous" && parse.ties && parse.ties.length) {
      const tie = parse.ties[0];
      if (state.tab === "brackets") {
        const firstText = (state.showElided ? tie.first : (tie.firstPlain ?? tie.first)) || "";
        const secondText = (state.showElided ? tie.second : (tie.secondPlain ?? tie.second)) || "";
        const firstSpans = state.showElided ? tie.firstSpans : (tie.firstPlainSpans ?? tie.firstSpans);
        const secondSpans = state.showElided ? tie.secondSpans : (tie.secondPlainSpans ?? tie.secondSpans);
        copyOutputText = [firstText, secondText].join("\n\n");
        updateTabToolbar(true);
        fill(output, [
          element("p", { class: "rlabel", text: "First reading" }),
          element("pre", { class: "reading" }, formatColoredBrackets(firstText, firstSpans)),
          element("p", { class: "rlabel", text: "Second reading" }),
          element("pre", { class: "reading" }, formatColoredBrackets(secondText, secondSpans)),
        ]);
      } else if (state.tab === "tree") {
        const firstT = tie.firstTree || "";
        const secondT = tie.secondTree || "";
        copyOutputText = [firstT, secondT].join("\n\n");
        updateTabToolbar(true);
        fill(output, [
          element("p", { class: "rlabel", text: "First reading" }),
          renderWrappedLines(firstT, { className: "reading code-block", mode: "tree" }),
          element("p", { class: "rlabel", text: "Second reading" }),
          renderWrappedLines(secondT, { className: "reading code-block", mode: "tree" }),
        ]);
        updateAllCodeBlocksFade();
      } else {
        if (state.canonical && (tie.firstCanonical === null || tie.firstCanonical === undefined)) {
          copyOutputText = "";
          updateTabToolbar(false);
          output.replaceChildren();
          return;
        }
        const firstJ = (state.canonical ? tie.firstCanonical : tie.firstJson) || "";
        const secondJ = (state.canonical ? tie.secondCanonical : tie.secondJson) || "";
        copyOutputText = [firstJ, secondJ].join("\n\n");
        updateTabToolbar(true);
        if (state.canonical) {
          const firstSlice = sliceCanonical(firstJ);
          const secondSlice = sliceCanonical(secondJ);
          fill(output, [
            element("p", { class: "rlabel", text: "First reading" }),
            renderWrappedLines(firstSlice.shownText, { className: "reading code-block" }),
            firstSlice.capped ? element("p", { class: "empty-hint", text: firstSlice.noteText }) : null,
            element("p", { class: "rlabel", text: "Second reading" }),
            renderWrappedLines(secondSlice.shownText, { className: "reading code-block" }),
            secondSlice.capped ? element("p", { class: "empty-hint", text: secondSlice.noteText }) : null,
          ]);
        } else {
          fill(output, [
            element("p", { class: "rlabel", text: "First reading" }),
            renderWrappedLines(firstJ, { className: "reading code-block" }),
            element("p", { class: "rlabel", text: "Second reading" }),
            renderWrappedLines(secondJ, { className: "reading code-block" }),
          ]);
        }
        updateAllCodeBlocksFade();
      }
      return;
    }

    const result = message.output;
    const expectedFormat = state.tab === "json" && state.canonical ? "canonical" : state.tab;
    if (!result || result.format !== expectedFormat) {
      copyOutputText = "";
      updateTabToolbar(false);
      output.replaceChildren();
      return;
    }

    if (result.tree === false) {
      copyOutputText = "";
      updateTabToolbar(false);
      const err = parse ? parse.error : null;
      output.replaceChildren(empty(err
        ? `No tree: the ${err.stage} stage did not accept the text. The Tokens and Trace tabs show the stages.`
        : "No tree."));
      return;
    }

    if (result.text === "") {
      copyOutputText = "";
      updateTabToolbar(false);
      output.replaceChildren(empty("The text is empty."));
      return;
    }

    copyOutputText = result.text || "";
    updateTabToolbar(true);
    if (result.format === "brackets") {
      output.replaceChildren(element("pre", { class: "result-text", tabindex: "0" }, formatColoredBrackets(result.text, result.spans)));
    } else if (result.format === "canonical") {
      const { shownText, capped, noteText } = sliceCanonical(result.text);
      const pre = renderWrappedLines(shownText, {
        className: "result-text code-block",
        mode: "code",
        tabindex: 0,
      });
      const note = capped
        ? element("p", { class: "empty-hint", text: noteText })
        : null;
      fill(output, [pre, note]);
      updateAllCodeBlocksFade();
    } else {
      output.replaceChildren(renderWrappedLines(result.text, {
        className: "result-text code-block",
        mode: result.format === "tree" ? "tree" : "code",
        tabindex: 0,
      }));
      updateAllCodeBlocksFade();
    }
  }

  function renderTokens(result) {
    const resolvedStage = result.stage || "";
    const tokChanged = state.tokenStage !== resolvedStage;
    state.tokenStage = resolvedStage;
    if (tokChanged) flushFragment();
    const stageSegs = element("div", { class: "trace-stage-segs", id: "token-stage-segs", role: "radiogroup", "aria-label": "Stage" },
      result.stages.map((stage) => element("button", {
        type: "button",
        role: "radio",
        class: "seg",
        "aria-checked": String(stage.name === result.stage),
        text: `${stage.name}${stage.count === null ? "" : ` (${stage.count})`}`,
        onclick: () => {
          state.tokenStage = stage.name;
          schedule(0);
        },
      })));

    const topBar = element("div", { class: "tok-bar" }, stageSegs);
    if (!result.rows.length) {
      fill($("output"), [
        topBar,
        element("p", { class: "empty-out", text: `The ${result.stage} stage handed on no tokens${result.error ? ` (${result.error})` : ""}.` }),
      ]);
      return;
    }

    const allColumns = [
      {
        title: "#",
        empty: () => false,
        cell: (row) => element("td", { class: "num idx", text: String(row.index) }),
      },
      {
        title: "text",
        empty: (row) => row.text === undefined || row.text === null,
        cell: (row) => element("td", {}, element("code", { text: JSON.stringify(row.text) })),
      },
      {
        title: "value",
        empty: (row) => row.value === undefined || row.value === null,
        cell: (row) => element("td", {}, element("code", { text: JSON.stringify(row.value) })),
      },
      {
        title: "image",
        empty: (row) => row.image === undefined || row.image === null,
        cell: (row) => element("td", {}, element("code", { text: JSON.stringify(row.image) })),
      },
      {
        title: "span",
        empty: (row) => !row.span,
        cell: (row) => element("td", { class: "num", text: row.span }),
      },
      {
        title: "source",
        empty: (row) => !row.source,
        cell: (row) => element("td", { class: "num", text: row.source }),
      },
      {
        title: "insertedBy",
        empty: (row) => !row.insertedBy,
        cell: (row) => element("td", {}, element("code", { text: row.insertedBy })),
      },
      {
        title: "before",
        empty: (row) => !row.before || row.before === "[]",
        cell: (row) => element("td", {}, element("code", { text: row.before })),
      },
      {
        title: "after",
        empty: (row) => !row.after || row.after === "[]",
        cell: (row) => element("td", {}, element("code", { text: row.after })),
      },
    ];
    const columns = allColumns.filter((col) => !result.rows.every((row) => col.empty(row)));
    const header = element("tr", {},
      columns.map((col) => element("th", { scope: "col", text: col.title })));
    const rows = result.rows.map((row) => {
      const chips = [
        ...(row.errors || []).map((code) => element("span", {
          class: "tag tok-err",
          "aria-label": `Error: ${code}`,
          text: code,
        })),
        ...(row.warnings || []).map((code) => element("span", {
          class: "tag tok-warn",
          "aria-label": `Warning: ${code}`,
          text: code,
        })),
        ...(row.tags || []).map((tag) => element("span", { class: "tag", text: tag })),
      ];
      const cells = columns.map((col) => col.cell(row));
      if (chips.length > 0) {
        cells.push(element("td", { class: "tags" }, element("div", { class: "tags-list" }, chips)));
      }
      return element("tr", {
        class: chips.length > 0 ? "has-tags" : null,
      }, cells);
    });

    const note = result.total > result.rows.length
      ? element("p", { class: "empty-hint", text: `Showing the first ${result.rows.length} of ${result.total} tokens.` })
      : null;

    fill($("output"), [
      topBar,
      element("div", { class: "table-wrap" },
        element("table", {
          class: "tokens",
          style: `--non-tag-cols: ${columns.length}`,
        },
          element("thead", {}, header),
          element("tbody", {}, rows))),
      note,
    ].filter(Boolean));
  }

  function chevronIcon(dir) {
    const s = document.createElement("span");
    const d = dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6";
    s.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="${d}"/></svg>`;
    return s.firstElementChild;
  }

  function renderTrace(trace) {
    const output = $("output");
    if (!trace) {
      output.replaceChildren();
      return;
    }

    const info = infos.get(state.pipeline);
    const stages = info ? info.stages : [{ name: trace.stage || "syntax" }];
    const stageSegs = element("div", { class: "trace-stage-segs", role: "radiogroup", "aria-label": "Stage" },
      stages.map((stage) => element("button", {
        type: "button",
        role: "radio",
        class: "seg",
        "aria-checked": String(stage.name === trace.stage),
        text: stage.name,
        onclick: () => {
          state.trace.stage = stage.name;
          state.trace.toRejection = false;
          schedule(0);
        },
      })));

    state.trace.toRejection = false;
    if (trace.error) {
      fill(output, [
        element("div", { class: "trace-controls" }, stageSegs),
        renderWrappedLines(trace.error, { className: "result-text code-block", linkify: true }),
      ]);
      return;
    }

    const traceChanged = state.trace.stage !== trace.stage || state.trace.position !== trace.position;
    state.trace.stage = trace.stage;
    state.trace.position = trace.position;
    if (traceChanged) saveFragment();

    const pickerItems = [];
    if (trace.from > 0) pickerItems.push(element("span", { class: "faint", text: "… " }));
    const gap = (position) => element("button", {
      type: "button",
      class: "gap",
      "aria-pressed": String(position === trace.position),
      "aria-label": `Position ${position}`,
      title: `Position ${position}`,
      onclick: () => {
        state.trace.position = position;
        state.trace.toRejection = false;
        schedule(0);
      },
    }, element("span"));

    trace.tokens.forEach((token, index) => {
      pickerItems.push(gap(trace.from + index));
      pickerItems.push(element("span", { class: "tok", text: token.replace(/\s/g, "␣") || "∅" }));
    });
    pickerItems.push(gap(trace.from + trace.tokens.length));
    if (trace.from + trace.tokens.length < trace.count) {
      pickerItems.push(element("span", { class: "faint", text: " …" }));
    }

    const prevBtn = element("button", {
      type: "button",
      class: "btn",
      style: "padding:0 8px",
      "aria-label": "Previous position",
      disabled: trace.position <= 0,
      onclick: () => {
        if (state.trace.position > 0) {
          state.trace.position--;
          state.trace.toRejection = false;
          schedule(0);
        }
      },
    }, chevronIcon("left"));
    const nextBtn = element("button", {
      type: "button",
      class: "btn",
      style: "padding:0 8px",
      "aria-label": "Next position",
      disabled: trace.position >= trace.count,
      onclick: () => {
        if (state.trace.position < trace.count) {
          state.trace.position++;
          state.trace.toRejection = false;
          schedule(0);
        }
      },
    }, chevronIcon("right"));

    const parsedTrace = buildTraceView(trace);

    fill(output, [
      element("div", { class: "trace-controls" },
        stageSegs,
        element("div", { class: "trace-pos-row" },
          prevBtn,
          element("div", { id: "trace-picker", role: "group", "aria-label": "Token positions" }, pickerItems),
          nextBtn,
          element("span", { class: "trace-pos-label", text: parsedTrace.summary || `Position ${trace.position} of ${trace.count}` }))),
      parsedTrace.sectionsNode,
    ]);
  }

  function buildTraceView(trace) {
    const stageName = trace.stage;
    const headerLine = trace.header || (trace.text ? trace.text.split("\n", 1)[0] : "");
    const summaryMatch = headerLine.match(/at (position \d+.*)$/i);
    const rawSummary = summaryMatch
      ? summaryMatch[1].charAt(0).toUpperCase() + summaryMatch[1].slice(1)
      : headerLine;
    const summary = rawSummary.replace(/:$/, "");
    const sections = trace.sections || {};

    const sectionSpecs = [
      ["Completed", sections.completed || []],
      ["Advanced", sections.advanced || []],
      ["Predicted", sections.predicted || []],
      ["Dropped", sections.dropped || []],
    ];
    const children = [];
    for (const [title, items] of sectionSpecs) {
      children.push(element("p", { class: "sec" },
        title,
        element("span", { text: items.length === 0 ? "none" : plural(items.length, "item") })));
      for (const item of items) {
        children.push(formatStructuredTraceItem(item, stageName));
      }
    }

    const expected = trace.expected || [];
    children.push(element("p", { class: "sec" },
      "Could read next",
      element("span", { text: expected.length === 0 ? "none" : plural(expected.length, "item") })));
    for (const exp of expected) {
      children.push(formatExpectedTraceItem(exp));
    }

    return {
      summary,
      sectionsNode: element("div", { class: "trace-sections" }, children),
    };
  }

  function formatStructuredTraceItem(item, stageName) {
    const fullLine = `${item.lhs} ≔ ${item.rhs}${item.span ? `  ${item.span}` : ""}`;
    const text = item.refused ? `${fullLine}\n${item.refused}` : fullLine;
    return formatTraceItem(text, stageName);
  }

  function formatExpectedTraceItem(exp) {
    const p = element("p", { class: "item" });
    const termSpan = element("span", { class: "t" });
    appendSpaceRuns(termSpan, exp.terminal, { extraClass: "t" });
    p.appendChild(termSpan);
    if (exp.rules && exp.rules.length > 0) {
      p.append(" ");
      const rulesSpan = element("span", { class: "muted" });
      appendSpaceRuns(rulesSpan, `(${exp.rules.join(", ")})`, { extraClass: "muted" });
      p.appendChild(rulesSpan);
    }
    return p;
  }

  function formatTraceItem(itemText, stageName) {
    const p = element("p", { class: "item" });
    const [firstLine, ...extraLines] = itemText.split("\n");
    const defIdx = firstLine.indexOf(" ≔ ");
    let rest = firstLine;
    if (defIdx > 0) {
      const ruleName = firstLine.slice(0, defIdx).trim();
      const helperMatch = /^\u2039(.+) part\u203a$/.exec(ruleName);
      const targetRule = helperMatch ? helperMatch[1] : ruleName;
      rest = firstLine.slice(defIdx);
      const btn = element("button", {
        type: "button",
        class: "link",
        onclick: () => jumpToRuleName(targetRule, stageName),
      });
      appendSpaceRuns(btn, ruleName);
      p.appendChild(btn);
    }

    const tokenRe = /(•|\(elidable[^)]*\)|\[\d+\.\.\d+\])/g;
    let last = 0;
    let m;
    while ((m = tokenRe.exec(rest)) !== null) {
      if (m.index > last) {
        appendSpaceRuns(p, rest.slice(last, m.index));
      }
      const part = m[0];
      if (part === "•") {
        p.appendChild(element("i", { class: "wrun", text: "•" }));
      } else if (part.startsWith("(elidable")) {
        appendSpaceRuns(p, part, { extraClass: "faint" });
      } else {
        p.appendChild(element("em", { class: "wrun", text: part }));
      }
      last = tokenRe.lastIndex;
    }
    if (last < rest.length) {
      appendSpaceRuns(p, rest.slice(last));
    }
    for (const extra of extraLines) {
      p.appendChild(document.createElement("br"));
      const subSpan = element("span", { class: "muted" });
      appendSpaceRuns(subSpan, extra, { extraClass: "muted" });
      p.appendChild(subSpan);
    }
    return p;
  }

  // ---- Options menu --------------------------------------------------------

  function defaultTraceStage(info) {
    const error =
      shown &&
      shown.text === state.text &&
      shown.pipeline === state.pipeline &&
      shown.parse &&
      shown.parse.error;
    if (error && error.stage && info.stages.some((stage) => stage.name === error.stage)) return error.stage;
    return info.stages[info.stages.length - 1].name;
  }

  function countNonDefaultOptions() {
    let count = state.features.size + state.without.size;
    if (state.elision !== "") count++;
    if (state.until) count++;
    return count;
  }

  function renderOptions() {
    $("pipeline").value = state.pipeline;
    updatePipelineButton();
    $("show-elided").checked = state.showElided;
    $("show-canonical").checked = state.canonical;
    const elisionMode = state.elision || "default";
    $("elision-only").value = elisionMode;

    for (const btn of $("elision-only-segs").querySelectorAll(".seg")) {
      const checked = btn.dataset.val === elisionMode;
      btn.setAttribute("aria-checked", String(checked));
      btn.classList.toggle("set", checked && elisionMode !== "default");
    }

    const nonDefault = countNonDefaultOptions();
    const countBadge = $("options-count");
    if (nonDefault > 0) {
      countBadge.hidden = false;
      countBadge.textContent = String(nonDefault);
    } else {
      countBadge.hidden = true;
    }
    updateTopBarOverflow();

    const info = infos.get(state.pipeline);
    const elisionDescEl = $("elision-only-desc");
    if (elisionDescEl) {
      if (!info) {
        elisionDescEl.textContent = "Default: set by the pipeline";
      } else {
        const elisionStages = info.stages.filter((s) => s.elisionOnly).map((s) => s.name);
        if (elisionStages.length === 1) {
          elisionDescEl.textContent = `Default: on for the ${elisionStages[0]} stage`;
        } else if (elisionStages.length > 1) {
          elisionDescEl.textContent = `Default: on for the ${elisionStages.join(", ")} stages`;
        } else {
          elisionDescEl.textContent = "Default: off";
        }
      }
    }
    const featuresEl = $("features");
    if (!info) {
      featuresEl.replaceChildren(element("div", { class: "frow" },
        element("small", { text: "Loading features…" })));
      return;
    }

    if (!info.features.length) {
      featuresEl.replaceChildren(element("div", { class: "frow" },
        element("small", { text: "This pipeline declares no features or warnings." })));
    } else {
      fill(featuresEl, info.features.map((feature) => {
        const name = feature.name;
        const mode = state.without.has(name) ? "off" : state.features.has(name) ? "on" : "grammar";
        const desc = `${feature.kind === "warning" ? "Warning" : "Gate"} · ${feature.default ? "on" : "off"} by default`;

        const setFeatureMode = (val) => {
          state.features.delete(name);
          state.without.delete(name);
          if (val === "off") state.without.add(name);
          else if (val === "on") state.features.add(name);
          renderOptions();
          schedule(0);
        };

        return element("div", { class: "frow" },
          element("div", {},
            element("div", { class: "mono", text: name }),
            element("small", { text: desc })),
          element("div", { class: "seg3", role: "radiogroup", "aria-label": name },
            element("button", {
              type: "button",
              class: "seg",
              role: "radio",
              "data-value": "grammar",
              "aria-checked": String(mode === "grammar"),
              text: "Default",
              onclick: () => setFeatureMode("grammar"),
            }),
            element("button", {
              type: "button",
              class: `seg${mode === "on" ? " set" : ""}`,
              role: "radio",
              "data-value": "on",
              "aria-checked": String(mode === "on"),
              text: "On",
              onclick: () => setFeatureMode("on"),
            }),
            element("button", {
              type: "button",
              class: `seg${mode === "off" ? " set" : ""}`,
              role: "radio",
              "data-value": "off",
              "aria-checked": String(mode === "off"),
              text: "Off",
              onclick: () => setFeatureMode("off"),
            })));
      }));
    }

    const until = $("until");
    fill(until, [
      element("option", { value: "", text: `${info.stages[info.stages.length - 1].name}, the last stage` }),
      info.stages.slice(0, -1).map((stage) => element("option", { value: stage.name, text: stage.name })),
    ]);
    until.value = state.until;
  }

  $("reset-features").addEventListener("click", () => {
    state.features.clear();
    state.without.clear();
    state.elision = "";
    state.until = "";
    renderOptions();
    schedule(0);
  });

  for (const btn of $("elision-only-segs").querySelectorAll(".seg")) {
    btn.addEventListener("click", () => {
      state.elision = btn.dataset.val === "default" ? "" : btn.dataset.val;
      renderOptions();
      schedule(0);
    });
  }

  $("elision-only").addEventListener("change", (event) => {
    state.elision = event.target.value === "default" ? "" : event.target.value;
    renderOptions();
    schedule(0);
  });

  $("until").addEventListener("change", (event) => {
    state.until = event.target.value;
    renderOptions();
    schedule(0);
  });

  // ---- Tabs & Copy controls ------------------------------------------------

  const tabs = [...document.querySelectorAll('#view-tabs [role="tab"]')];
  function selectTab(name, focus) {
    if (name === "canonical") {
      state.tab = "json";
      state.canonical = true;
      $("show-canonical").checked = true;
    } else {
      state.tab = name;
    }
    for (const tab of tabs) {
      const selected = tab.dataset.view === state.tab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    $("output").setAttribute("aria-labelledby", `tab-${state.tab}`);
    if (shown) renderOutput(Object.assign({}, shown, { output: null, trace: null, audit: undefined }));
    schedule(0);
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.view, false));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        selectTab(next.dataset.view, true);
      }
    });
  }

  $("show-elided").addEventListener("change", (event) => {
    state.showElided = event.target.checked;
    schedule(0);
  });

  $("show-canonical").addEventListener("change", (event) => {
    state.canonical = event.target.checked;
    schedule(0);
  });

  $("copy-output").addEventListener("click", (event) => {
    if (copyOutputText) {
      copyText(copyOutputText, event.currentTarget, "Copy");
      return;
    }
    const pre = document.querySelector("#output pre.result-text");
    if (pre) {
      copyText(pre.textContent, event.currentTarget, "Copy");
      return;
    }
    const readings = [...document.querySelectorAll("#output pre.reading")].map((n) => n.textContent);
    if (readings.length) {
      copyText(readings.join("\n\n"), event.currentTarget, "Copy");
    }
  });

  $("copy-link").addEventListener("click", (event) => {
    flushFragment();
    copyText(location.href, event.currentTarget, "Share");
  });

  async function copyText(text, button, restoreLabel) {
    const labelEl = button.querySelector("span") || button;
    if (button._copyTimer) clearTimeout(button._copyTimer);
    try {
      await navigator.clipboard.writeText(text);
      labelEl.textContent = "Copied";
    } catch {
      labelEl.textContent = "Copy failed";
    }
    button._copyTimer = setTimeout(() => {
      button._copyTimer = 0;
      labelEl.textContent = restoreLabel;
    }, 1500);
  }

  // ---- Split drag handle & Hide/Show grammar -------------------------------

  const splitHandle = $("split-handle");
  function setSplitPercent(pct, persist = true) {
    const clamped = Math.max(20, Math.min(60, Math.round(pct)));
    const workspace = $("workspace");
    workspace.style.setProperty("--left-grow", String(clamped));
    workspace.style.setProperty("--right-grow", String(100 - clamped));
    splitHandle.setAttribute("aria-valuenow", String(clamped));
    updateAllCodeBlocksFade();
    if (persist) {
      try {
        localStorage.setItem("gencmu.split", String(clamped));
      } catch {
        // Ignore storage errors
      }
    }
  }

  try {
    const savedSplit = Number(localStorage.getItem("gencmu.split"));
    if (Number.isFinite(savedSplit) && savedSplit >= 20 && savedSplit <= 60) {
      setSplitPercent(savedSplit, false);
    }
  } catch {
    // Ignore storage errors
  }

  splitHandle.addEventListener("keydown", (event) => {
    const current = Number(splitHandle.getAttribute("aria-valuenow") || 35);
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitPercent(current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitPercent(current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSplitPercent(35);
    }
  });

  splitHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    splitHandle.setPointerCapture(event.pointerId);
    const workspace = $("workspace");
    const onMove = (moveEvent) => {
      const rect = workspace.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(pct);
    };
    const onUp = (upEvent) => {
      splitHandle.releasePointerCapture(upEvent.pointerId);
      splitHandle.removeEventListener("pointermove", onMove);
      splitHandle.removeEventListener("pointerup", onUp);
    };
    splitHandle.addEventListener("pointermove", onMove);
    splitHandle.addEventListener("pointerup", onUp);
  });

  $("hide-grammar").addEventListener("click", () => {
    state.grammarHidden = true;
    $("workspace").classList.add("grammar-hidden");
    updateTopBarOverflow();
    updateAllCodeBlocksFade();
  });

  $("show-grammar").addEventListener("click", () => {
    state.grammarHidden = false;
    $("workspace").classList.remove("grammar-hidden");
    updateTopBarOverflow();
    updateAllCodeBlocksFade();
  });

  function updatePhoneGrammarState() {
    const grammarPane = $("grammar-pane");
    const toggleBtn = $("phone-grammar-toggle");
    grammarPane.classList.toggle("phone-collapsed", !state.phoneGrammarOpen);
    toggleBtn.setAttribute("aria-expanded", String(state.phoneGrammarOpen));
  }

  $("phone-grammar-toggle").addEventListener("click", () => {
    state.phoneGrammarOpen = !state.phoneGrammarOpen;
    if (state.phoneGrammarOpen && !state.open) {
      openDocument(pipelinePath(state.pipeline), 0, 1);
      return;
    }
    updatePhoneGrammarState();
  });

  // ---- Grammar documents & Editor ------------------------------------------

  const normalized = (text) => (text || "").replace(/\r\n?/g, "\n");
  const isEdited = (path) => client.edits.has(path);

  let lastCursorPos = { line: 1, column: 1 };
  function updateEditorStats(pos) {
    if (pos) lastCursorPos = pos;
    $("editor-stats").textContent = `Line ${lastCursorPos.line}, column ${lastCursorPos.column}`;
  }

  const editor = createEditor($("editor-body"), {
    onChange: (value) => {
      updateEditorStats();
      const path = state.open;
      if (!path) return;
      const bundledText = bundled[path];
      client.setDocument(
        path,
        bundledText !== undefined && normalized(bundledText) === value ? bundledText : value
      );
      renderDocuments();
      renderDocumentError();
      schedule(GRAMMAR_DELAY);
    },
    onCursorChange: (pos) => {
      updateEditorStats(pos);
    },
  });
  const editorCapabilities = editor.capabilities || {
    syntaxColors: false,
    wrappedLineNumbers: false,
    marginMarks: false,
  };
  $("editor-col").dataset.syntaxColors = String(!!editorCapabilities.syntaxColors);
  $("editor-col").dataset.wrappedLineNumbers = String(!!editorCapabilities.wrappedLineNumbers);
  $("editor-col").dataset.marginMarks = String(!!editorCapabilities.marginMarks);

  function documentError() {
    const error = (shown && shown.loadError) || (shown && shown.parse && shown.parse.error);
    return error && error.document && error.document === state.open ? error : null;
  }

  function shortLabel(path, entryDir) {
    let rel;
    if (path.startsWith(entryDir)) {
      rel = path.slice(entryDir.length);
    } else {
      const parentDir = entryDir.slice(0, entryDir.slice(0, -1).lastIndexOf("/") + 1);
      if (parentDir && path.startsWith(parentDir)) {
        rel = path.slice(parentDir.length);
      } else {
        rel = path.replace(/^grammars\//, "");
      }
    }
    return rel.replace(/\.md$/, "");
  }

  function renderDocLabel(label) {
    const parts = label.split("/");
    if (parts.length === 1) {
      return element("span", { class: "s", text: label });
    }
    const children = [];
    for (let i = 0; i < parts.length - 1; i++) {
      children.push(element("small", { class: "s", text: `${parts[i]}/` }));
      children.push(document.createElement("wbr"));
    }
    children.push(element("span", { class: "s", text: parts[parts.length - 1] }));
    return element("span", {}, children);
  }

  function renderDocuments() {
    const entry = pipelinePath(state.pipeline);
    const entryDir = entry.slice(0, entry.lastIndexOf("/") + 1);
    const { stages, before, documents } = pipelineOf(entry);
    const errorDoc =
      (shown && shown.loadError && shown.loadError.document) ||
      (shown && shown.parse && shown.parse.error && shown.parse.error.document) ||
      null;

    const editedInPipeline = documents.filter(isEdited);
    const countText = `${plural(documents.length, "document")}${editedInPipeline.length ? ` · ${editedInPipeline.length} edited` : ""}`;
    $("grammar-count").textContent = countText;
    $("phone-grammar-count").textContent = countText;

    const allEditsCount = client.edits.size;
    $("download-edited").hidden = false;
    $("download-edited").disabled = !allEditsCount;
    if ($("download-edited-label")) $("download-edited-label").textContent = "Download edited";
    if ($("show-grammar-dot")) $("show-grammar-dot").hidden = !allEditsCount;

    const stageGroups = [
      { stage: "pipeline", label: "Pipeline", paths: [entry, ...before] },
      ...stages.map((s) => ({ stage: s.name, label: s.name, paths: s.documents })),
    ];

    const railNodes = [];
    const fullNodes = [];
    const selectNodes = [];

    for (const grp of stageGroups) {
      const groupNodes = [
        element("p", { class: "group doc-stage", text: grp.label }),
      ];
      const fullGroupNodes = [
        element("p", { class: "group", text: grp.label }),
      ];
      const optgroupChildren = [];

      for (const path of grp.paths) {
        const label = shortLabel(path, entryDir);
        const isCurrent = path === state.open;
        const edited = isEdited(path);
        const hasError = path === errorDoc;
        const missing = client.text(path) === undefined;
        const notes = [
          edited ? "edited" : "",
          hasError ? "has an error" : "",
          path === reading ? "being read" : "",
          missing ? "missing" : "",
        ].filter(Boolean);

        const dot = hasError
          ? element("span", { class: "dot bad", title: "Grammar error" })
          : edited
            ? element("span", { class: "dot", title: "Edited" })
            : null;

        groupNodes.push(element("button", {
          type: "button",
          class: ["doc", edited ? "edited" : "", hasError ? "error" : "", path === reading ? "reading" : ""].filter(Boolean).join(" "),
          "data-doc": path,
          "aria-current": isCurrent ? "true" : null,
          "aria-pressed": String(isCurrent),
          disabled: missing,
          title: (firstHeading(client.text(path)) || path) + (notes.length ? ` (${notes.join(", ")})` : ""),
          "aria-label": path + (notes.length ? `, ${notes.join(", ")}` : ""),
          onclick: () => openDocument(path, 0, 1),
        },
        renderDocLabel(label),
        dot));

        fullGroupNodes.push(element("button", {
          type: "button",
          class: "drow",
          "data-doc": path,
          disabled: missing,
          onclick: () => openDocument(path, 0, 1),
        },
        element("span", { class: "mono" },
          renderDocLabel(label),
          hasError
            ? element("span", { class: "dot bad" })
            : edited
               ? element("span", { class: "dot" })
              : null),
        element("span", { text: firstHeading(client.text(path)) || path })));

        optgroupChildren.push(element("option", {
          value: path,
          selected: isCurrent,
          disabled: missing,
          text: `${label}${edited ? " (edited)" : ""}`,
        }));
      }

      railNodes.push(element("div", { class: "doc-group" }, groupNodes));
      fullNodes.push(element("div", { class: "doc-group-full" }, fullGroupNodes));
      selectNodes.push(element("optgroup", { label: grp.label }, optgroupChildren));
    }

    if (state.open && !documents.includes(state.open)) {
      const label = shortLabel(state.open, entryDir);
      const edited = isEdited(state.open);
      const missing = client.text(state.open) === undefined;
      selectNodes.push(
        element("optgroup", { label: "Outside this pipeline" }, [
          element("option", {
            value: state.open,
            selected: true,
            disabled: missing,
            text: `${label}${edited ? " (edited)" : ""}`,
          }),
        ])
      );
    }

    fill($("documents"), railNodes);
    listMinDirty = true;
    fill($("documents-list-view"), fullNodes);
    fill($("doc-select"), selectNodes);
    if (state.open) $("doc-select").value = state.open;

    $("workspace").classList.toggle("no-doc", !state.open);
    if (!state.open) {
      $("documents-list-view").hidden = false;
      $("grammar-panes").hidden = true;
    } else {
      $("documents-list-view").hidden = true;
      $("grammar-panes").hidden = false;
      const slash = state.open.lastIndexOf("/");
      if (slash >= 0) {
        fill($("doc-path"), [
          element("span", { class: "doc-path-dir", text: state.open.slice(0, slash + 1) }),
          state.open.slice(slash + 1),
        ]);
      } else {
        $("doc-path").textContent = state.open;
      }
      const edited = isEdited(state.open);
      $("doc-edited-pill").hidden = !edited;
      $("doc-reset").hidden = !edited;
      $("doc-reset").disabled = !edited;
    }

    const openPath = state.open || entry;
    const openLabel = shortLabel(openPath, entryDir);
    const openEdited = isEdited(openPath);
    if ($("doc-more-reset-label")) $("doc-more-reset-label").textContent = `Reset ${openLabel}`;
    if ($("doc-more-reset")) $("doc-more-reset").disabled = !openEdited;
    if ($("doc-more-download-label")) $("doc-more-download-label").textContent = `Download ${openLabel}`;
    if ($("doc-more-download")) $("doc-more-download").disabled = !openPath || client.text(openPath) === undefined;
    if ($("doc-more-download-edited-label")) {
      $("doc-more-download-edited-label").textContent = `Download edited (${allEditsCount})`;
    }
    if ($("doc-more-download-edited")) $("doc-more-download-edited").disabled = !allEditsCount;

    const listed = new Set(documents);
    const elsewhere = [...client.edits.keys()].filter((path) => !listed.has(path));
    const note = $("edited-elsewhere");
    note.hidden = !elsewhere.length;
    fill(note, [
      "Also edited, outside this pipeline: ",
      elsewhere.flatMap((path, index) => [
        index ? ", " : "",
        element("button", {
          type: "button",
          class: "link mono",
          text: path.replace(/^grammars\//, "").replace(/\.md$/, ""),
          title: path,
          onclick: () => openDocument(path, 0, 1),
        }),
      ]),
    ]);
    updateTopBarOverflow();
  }

  function renderDocumentError() {
    const errBar = $("doc-error-bar");
    const error = documentError();
    if (!error) {
      errBar.hidden = true;
      editor.clearMarks();
      return;
    }
    const line = error.line || 1;
    const col = error.column || 1;
    const rawFirstLine = (error.message || "Grammar error").split("\n")[0];
    const strippedLine = rawFirstLine.replace(/^[^\s:]+:\d+(?::\d+)?:\s*(?:stage\s+[^:]+:\s*)?/, "");
    $("doc-error-loc").textContent = `${line}:${col}`;
    $("doc-error-text").textContent = strippedLine || rawFirstLine;
    $("doc-error-jump").textContent = `Go to ${line}:${col}`;
    $("doc-error-jump").onclick = () => editor.goTo(line, col);
    errBar.hidden = false;
    editor.markError(line, strippedLine || rawFirstLine, col);
  }

  function openDocument(path, line = 0, column = 1, forceReset = false) {
    if (!path) {
      state.open = null;
      state.phoneGrammarOpen = false;
      updatePhoneGrammarState();
      editor.setLabel("Grammar document");
      renderDocuments();
      updateAllCodeBlocksFade();
      return;
    }
    const sameDoc = state.open === path;
    state.open = path;
    if (state.grammarHidden) {
      state.grammarHidden = false;
      $("workspace").classList.remove("grammar-hidden");
    }
    if ($("app").classList.contains("phone")) {
      state.phoneGrammarOpen = true;
      updatePhoneGrammarState();
    }
    renderDocuments();
    updateAllCodeBlocksFade();
    const baseName = path.slice(path.lastIndexOf("/") + 1) || "Grammar document";
    editor.setLabel(baseName);
    const nextText = normalized(client.text(path));
    if (forceReset || !sameDoc || editor.getValue() !== nextText) {
      lastCursorPos = { line: line || 1, column: column || 1 };
      editor.setValue(nextText);
    } else if (line) {
      lastCursorPos = { line, column: column || 1 };
    }
    updateEditorStats(lastCursorPos);
    renderDocumentError();
    if (line) {
      editor.goTo(line, column || 1);
    }
  }

  $("doc-select").addEventListener("change", (event) => {
    openDocument(event.target.value, 0, 1);
  });

  $("doc-close").addEventListener("click", () => {
    openDocument(null);
  });

  function resetOpenDocument() {
    const path = state.open || pipelinePath(state.pipeline);
    if (!path || bundled[path] === undefined) return;
    client.setDocument(path, bundled[path]);
    openDocument(path, 0, 1, true);
    schedule(0);
  }

  $("doc-reset").addEventListener("click", resetOpenDocument);

  function download(path) {
    const blob = new Blob([client.text(path)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a", {
      href: url,
      download: path.replace(/^grammars\//, "").replace(/\//g, "--"),
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadAllEdited() {
    [...client.edits.keys()].forEach((path, index) => setTimeout(() => download(path), index * 300));
  }

  $("doc-download").addEventListener("click", () => state.open && download(state.open));
  $("download-edited").addEventListener("click", downloadAllEdited);

  $("doc-more-reset").addEventListener("click", () => {
    closeAllMenus();
    resetOpenDocument();
    $("doc-more-actions").focus();
  });
  $("doc-more-download").addEventListener("click", () => {
    closeAllMenus();
    const path = state.open || pipelinePath(state.pipeline);
    if (path) download(path);
    $("doc-more-actions").focus();
  });
  $("doc-more-download-edited").addEventListener("click", () => {
    closeAllMenus();
    downloadAllEdited();
    $("doc-more-actions").focus();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!client.edits.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // ---- Pipeline, Examples & Input controls ---------------------------------

  function updatePipelineButton() {
    $("pipeline-label").textContent = state.pipeline;
    $("pipeline-description").textContent = pipelineTitle(state.pipeline);
    $("pipeline").value = state.pipeline;
    for (const btn of $("pipeline-menu").querySelectorAll(".mitem")) {
      const selected = btn.dataset.pipeline === state.pipeline;
      btn.setAttribute("aria-selected", String(selected));
    }
    updateTopBarOverflow();
  }

  function showExampleNote(info) {
    const box = $("example-hint");
    if (!info || (!info.gloss && !info.text)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("example-hint-title").textContent = info.title || "Example note";
    const glossEl = $("example-hint-gloss");
    if (glossEl) {
      if (info.gloss) {
        glossEl.hidden = false;
        glossEl.textContent = info.gloss;
      } else {
        glossEl.hidden = true;
        glossEl.textContent = "";
      }
    }
    const textEl = $("example-hint-text");
    if (info.text) {
      textEl.hidden = false;
      textEl.textContent = info.text;
    } else {
      textEl.hidden = true;
      textEl.textContent = "";
    }
    const ruleBtn = $("example-hint-rule");
    if (info.ruleLink) {
      ruleBtn.hidden = false;
      ruleBtn.textContent = info.ruleLink.label;
      ruleBtn.onclick = info.ruleLink.onClick;
    } else {
      ruleBtn.hidden = true;
      ruleBtn.onclick = null;
    }
  }

  $("example-hint-dismiss").addEventListener("click", () => {
    activeExample = null;
    exampleRule = null;
    showExampleNote(null);
  });

  function makeExampleOutcomePill(example, pipelineName) {
    const merged = mergeExampleForPipeline(example, pipelineName);
    const warnings = Array.isArray(merged.warnings) ? merged.warnings : [];
    if (example.expect === "accepted" && warnings.length > 0) {
      const label = `accepted, with warnings: ${warnings.join(", ")}`;
      return element("span", {
        class: "ex-pill pill-joined",
        "aria-label": label,
        title: label,
      },
      element("span", { class: "part-ok", text: "accepted" }),
      element("span", { class: "part-warn" }, warnIcon(12)));
    }
    const table = {
      accepted: { label: "accepted", cls: "ok" },
      rejected: { label: "rejected", cls: "no" },
      reported: { label: "reported", cls: "no" },
      tie: { label: "tie", cls: "tie" },
      "elision-only": { label: "elision-only", cls: "tie" },
      "feature-conflict": { label: "feature conflict", cls: "no" },
      grammar: { label: "grammar error", cls: "no" },
    };
    const entry = table[example.expect] || { label: example.expect || "accepted", cls: "ok" };
    return element("span", { class: `ex-pill ${entry.cls}`, text: entry.label });
  }

  function renderExamplesMenu() {
    const examples = $("examples");
    const exmenu = $("examples-menu");
    if (!examples || !exmenu) return;

    const currentPipeline = state.pipeline;
    const matching = allExamples.filter(
      (ex) => Array.isArray(ex.pipelines) && ex.pipelines.includes(currentPipeline)
    );
    const otherCount = allExamples.length - matching.length;

    const selectOptions = [element("option", { value: "", text: "Examples…" })];
    const exItems = [
      element("p", { class: "mgroup", text: `Examples for ${currentPipeline}` }),
    ];

    matching.forEach((example, idx) => {
      const title = example.title || example.id;
      const firstLine = (example.text || "").split("\n")[0];
      selectOptions.push(element("option", { value: example.id, text: title }));
      const btnAttrs = {
        type: "button",
        class: "exitem",
        role: "menuitem",
        "data-example-id": example.id,
        onclick: () => {
          const focusBtn = $("app").classList.contains("phone")
            ? $("phone-examples-button")
            : $("examples-button");
          closeAllMenus();
          applyExample(example);
          if (focusBtn) focusBtn.focus();
        },
      };
      if (idx === matching.length - 1 && otherCount > 0) {
        btnAttrs.style = "margin-bottom: 6px";
      }
      exItems.push(element("button", btnAttrs,
        element("span", { class: "ex-top" },
          element("b", { text: title }),
          makeExampleOutcomePill(example, currentPipeline)),
        element("code", { class: "mono", text: firstLine })));
    });

    if (matching.length === 0) {
      exItems.push(element("p", {
        class: "ex-empty",
        text: "No examples for this pipeline.",
      }));
    }

    if (otherCount > 0) {
      const footText =
        otherCount === 1
          ? "Other pipelines have 1 more example."
          : `Other pipelines have ${otherCount} more examples.`;
      exItems.push(element("p", { class: "ex-foot", text: footText }));
    }

    fill(examples, selectOptions);
    fill(exmenu, exItems);
  }

  function applyExampleForPipeline(example) {
    state.showAllRules = false;
    const merged = mergeExampleForPipeline(example, state.pipeline);
    state.features = new Set();
    state.without = new Set();
    if (merged.features && typeof merged.features === "object") {
      for (const [fname, fval] of Object.entries(merged.features)) {
        if (fval === true) state.features.add(fname);
        else if (fval === false) state.without.add(fname);
      }
    }

    if (merged.elisionOnly === true) state.elision = "on";
    else if (merged.elisionOnly === false) state.elision = "off";
    else state.elision = "";

    state.until = "";
    state.tokenStage = "";
    state.canonical = false;
    $("show-canonical").checked = false;

    const targetView = merged.view || "brackets";
    state.trace = {
      stage: "",
      position: 0,
      toRejection: targetView === "trace",
    };

    const hasExplicitElided =
      "showElided" in example ||
      Boolean(
        example.byPipeline &&
          example.byPipeline[state.pipeline] &&
          "showElided" in example.byPipeline[state.pipeline]
      );
    state.showElided = hasExplicitElided ? Boolean(merged.showElided) : false;
    $("show-elided").checked = state.showElided;

    const openSpec = merged.open || null;
    const docPath =
      openSpec && openSpec.document
        ? resolveOpenDocument(state.pipeline, openSpec.document)
        : "";
    const docLabel = docPath
      ? `${shortLabel(docPath, pipelinePath(state.pipeline).replace(/pipeline\.md$/, ""))}.md`
      : "";

    const noteTitle = example.title || "Example note";
    const noteGloss = example.gloss || "";
    const noteHint = merged.hint || "";

    let ruleLink = null;
    if (openSpec && docPath) {
      if (openSpec.anchor) {
        const anchorText = openSpec.anchor;
        const jumpToAnchor = () => {
          const val = client.text(docPath);
          const at = val.indexOf(anchorText);
          const line = at >= 0 ? val.slice(0, at).split("\n").length : 1;
          openDocument(docPath, line, 1);
        };
        ruleLink = {
          label: `Open ${docLabel} at ${anchorText}`,
          onClick: jumpToAnchor,
        };
        exampleRule = null;
        lastRuleLocation = null;
        jumpToAnchor();
      } else if (openSpec.rule) {
        const ruleName = openSpec.rule;
        lastRuleLocation = null;
        exampleRule = {
          document: docPath,
          rule: ruleName,
          title: noteTitle,
          gloss: noteGloss,
          hint: noteHint,
          docLabel,
        };
        ruleLink = {
          label: `Open ${docLabel} at ${ruleName}`,
          onClick: () => {
            if (lastRuleLocation && lastRuleLocation.document) {
              openDocument(lastRuleLocation.document, lastRuleLocation.line, lastRuleLocation.column);
            } else {
              openDocument(docPath, 1, 1);
            }
          },
        };
        openDocument(docPath, 1, 1);
      } else {
        exampleRule = null;
        lastRuleLocation = null;
        openDocument(docPath, 1, 1);
      }
    } else if ($("app").classList.contains("phone") && state.phoneGrammarOpen) {
      exampleRule = null;
      lastRuleLocation = null;
      openDocument(pipelinePath(state.pipeline), 0, 1);
    } else {
      exampleRule = null;
      lastRuleLocation = null;
      openDocument(null);
    }

    showExampleNote(
      noteGloss || noteHint
        ? {
            title: noteTitle,
            gloss: noteGloss,
            text: noteHint,
            ruleLink,
          }
        : null
    );

    renderExamplesMenu();
    renderOptions();
    renderDocuments();

    selectTab(targetView, false);
  }

  function applyExample(example) {
    activeExample = example;
    state.text = example.text;
    $("input").value = example.text;

    if (Array.isArray(example.pipelines) && example.pipelines.length > 0) {
      if (!example.pipelines.includes(state.pipeline)) {
        state.pipeline = example.pipelines[0];
      }
    }

    applyExampleForPipeline(example);
  }

  function initControls() {
    const pipeline = $("pipeline");
    const pmenu = $("pipeline-menu");
    const groups = new Map();
    const menuItems = [];

    for (const name of pipelineNames) {
      const parent = name.split("/")[0];
      const title = pipelineTitle(name);
      if (!groups.has(parent)) {
        groups.set(parent, element("optgroup", { label: parent }));
        menuItems.push(element("p", { class: "mgroup", text: parent }));
      }
      groups.get(parent).append(element("option", { value: name, text: `${name}: ${title}` }));
      menuItems.push(element("button", {
        type: "button",
        class: "mitem",
        role: "option",
        "data-pipeline": name,
        "aria-selected": String(name === state.pipeline),
        onclick: () => {
          closeAllMenus();
          if (state.pipeline !== name) {
            pipeline.value = name;
            pipeline.dispatchEvent(new Event("change"));
          }
          $("pipeline-button").focus();
        },
      },
      element("span", { class: "mono", text: name }),
      element("small", { text: title })));
    }
    fill(pipeline, [...groups.values()]);
    fill(pmenu, menuItems);

    const examples = $("examples");
    renderExamplesMenu();

    examples.addEventListener("change", () => {
      if (examples.value === "") return;
      const val = examples.value;
      examples.value = "";
      const example = allExamples.find((ex) => ex.id === val);
      if (!example) return;
      applyExample(example);
    });

    $("input").value = state.text;
    $("input").addEventListener("input", () => {
      state.text = $("input").value;
      state.showAllRules = false;
      activeExample = null;
      exampleRule = null;
      showExampleNote(null);
      schedule(TEXT_DELAY);
    });

    pipeline.addEventListener("change", () => {
      state.pipeline = pipeline.value;
      state.features.clear();
      state.without.clear();
      state.elision = "";
      state.until = "";
      state.tokenStage = "";
      state.trace = { stage: "", position: 0, toRejection: false };
      exampleRule = null;
      if (
        activeExample &&
        Array.isArray(activeExample.pipelines) &&
        activeExample.pipelines.includes(state.pipeline)
      ) {
        applyExampleForPipeline(activeExample);
        return;
      }
      activeExample = null;
      showExampleNote(null);
      const nextDocs = pipelineOf(pipelinePath(state.pipeline)).documents;
      if (state.open && !nextDocs.includes(state.open)) {
        if ($("app").classList.contains("phone")) {
          openDocument(pipelinePath(state.pipeline), 0, 1);
        } else {
          openDocument(null);
        }
      }
      renderExamplesMenu();
      renderOptions();
      renderDocuments();
      schedule(0);
    });
  }

  // ---- Start ---------------------------------------------------------------

  loadFragment();
  initControls();
  renderOptions();
  renderDocuments();
  {
    const initialStages = pipelineOf(pipelinePath(state.pipeline)).stages;
    const initialChips = [];
    initialStages.forEach((stage, index) => {
      if (index > 0) {
        initialChips.push(element("span", { class: "arrow", "aria-hidden": "true", text: "→" }));
      }
      initialChips.push(element("span", { class: "stage idle" },
        element("b", { text: stage.name }),
        element("span", { class: "sr-only", text: " " }),
        element("span", { text: "not run" })));
    });
    fillStageRow(initialChips);
    $("verdict-top").hidden = true;
    $("copy-link").hidden = true;
    $("output").replaceChildren();
    updateTabToolbar(false);
  }
  self.playground = {
    state,
    infos,
    client,
    timings,
    schedule,
    openDocument,
    editor,
    examples: allExamples,
    applyExample,
    getCopyOutputText: () => copyOutputText,
  };
  startWorker();
  selectTab(state.tab, false);
})();
