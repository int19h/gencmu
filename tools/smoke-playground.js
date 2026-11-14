#!/usr/bin/env node
// Opens the playground in a headless browser and checks that it works: its
// parser worker starts, parses a sentence under the CLL pipeline into the
// expected brackets, explains a text it rejects, and shows a tie as an
// error with its two readings; that "gencmu" in its heading links to the
// repository; that it lists the features a parse used by name; that it
// never shows an out-of-date answer as current; that it shows an empty
// bracket rendering as one; that a failure for another run does not end
// the current one; and that a link to the Trace tab traces its text, or
// shows its error once. With no URL the page is opened from
// a loopback HTTP server. A supplied URL tests an existing deployment.
// Every preset also runs through its selector. Grammar edits expose ties
// and Reset restores the bundled result.
//
//   node tools/smoke-playground.js [--browser chromium|chrome|firefox] [URL]
//
// The browser is driven with Playwright, a development dependency of lib/js,
// and is one of Playwright's own browsers, which unlike a snap can read a
// checkout anywhere. Install them once with
//
//   cd lib/js && npm ci && npx playwright install chromium firefox
"use strict";
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const http = require("node:http");

const args = process.argv.slice(2);
let browser = "chromium";
let target = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--browser") browser = args[++index];
  else target = args[index];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repository = path.resolve(__dirname, "..");
const repositoryFiles = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean));

function loadPlaywright() {
  try {
    return createRequire(path.join(__dirname, "..", "lib", "js", "package.json"))("playwright");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error("Playwright is not installed: run `npm ci` in lib/js, then `npx playwright install chromium firefox`");
  }
}

async function main() {
  const playwright = loadPlaywright();
  const engines = { chromium: playwright.chromium, chrome: playwright.chromium, firefox: playwright.firefox };
  const engine = engines[browser];
  if (!engine) throw new Error(`unknown browser ${browser}`);
  const instance = await engine.launch({ headless: true });
  let server;
  try {
    if (!target) {
      server = http.createServer((request,response) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
          const file = path.resolve(repository,"." + pathname + (pathname.endsWith("/") ? "index.html" : ""));
          if (!file.startsWith(repository + path.sep)) { response.writeHead(403).end(); return; }
          const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml" };
          const text = fs.readFileSync(file);
          response.writeHead(200,{ "Content-Type":types[path.extname(file)] || "text/plain" }).end(text);
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
      target = `http://127.0.0.1:${server.address().port}/index.html`;
    }
    let page = await instance.newPage();
    /** Runs a function in the page and returns its value. */
    const run = (script, arg) => page.evaluate(script, arg);
    // The browser parses attributes and resolves generated links before this test.
    async function assertLinks() {
      const { base, links } = await run(() => ({ base: location.href,
        links: [...document.querySelectorAll("a[href]")].map((link) => link.href) }));
      const { origin, protocol } = new URL(base);
      for (const href of links) {
        const url = new URL(href);
        const pathname = decodeURIComponent(url.pathname);
        if (url.origin === origin && (url.protocol === protocol || url.protocol === "blob:") && !/\.md\/?$/i.test(pathname)) continue;
        const prefix = "/int19h/gencmu/blob/main/";
        const file = path.join(repository, pathname.slice(prefix.length));
        if (url.href === "https://github.com/int19h/gencmu") continue;
        if (url.origin === "https://github.com" && !url.username && !url.password && url.pathname === "/int19h/gencmu/issues/new") continue;
        if (url.origin === "https://github.com" && !url.username && !url.password && url.pathname.startsWith(prefix) &&
            repositoryFiles.has(pathname.slice(prefix.length)) && fs.existsSync(file) && fs.statSync(file).isFile()) continue;
        throw new Error(`invalid playground link: ${href}`);
      }
    }
    /** Polls a function until it returns something other than null. */
    async function until(what, script, arg) {
      let value = null;
      for (let attempt = 0; attempt < 600; attempt++) {
        value = await run(script, arg);
        if (value !== null) return value;
        await sleep(100);
      }
      const status = await run(() => document.getElementById("status").textContent);
      throw new Error(`timed out waiting for ${what}; the status says ${JSON.stringify(status)}`);
    }
    // The answer shown for a text, once the page has one and is idle.
    const answerFor = (text) => until(`the answer for ${JSON.stringify(text)}`, (text) => {
      const status = document.getElementById("status");
      const result = document.getElementById("result");
      if (status.dataset.state === "error") return { error: status.textContent };
      if (status.dataset.state !== "ready" || result.dataset.for !== text || result.hasAttribute("aria-busy")) return null;
      const output = document.querySelector("#output pre.result-text");
      const explanation = document.getElementById("explanation");
      return { output: output ? output.textContent : "", explanation: explanation ? explanation.textContent : "",
               verdict: document.querySelector("#summary .badge").textContent };
    }, text);
    // The page once it is idle with an answer shown, or has failed, and
    // optionally once an element matches a selector.
    const idle = (what, selector) => until(what, (selector) => {
      const status = document.getElementById("status");
      if (status.dataset.state === "error") return { error: status.textContent };
      if (status.dataset.state !== "ready" || document.getElementById("result").hasAttribute("aria-busy")) return null;
      if (selector && !document.querySelector(selector)) return null;
      const output = document.querySelector("#output pre") || document.getElementById("output");
      return { boxes: [...document.querySelectorAll("#diagnostics .box")].map((box) => box.textContent), output: output ? output.textContent : null };
    }, selector || null);
    // A change marks the shown result stale at once, before any answer: the
    // result region is busy and the status no longer says ready. The change
    // and the check run in one evaluation, so no answer can come between.
    const change = async (what, id, value, event) => {
      const left = await run(({ id, value, event }) => {
        const control = document.getElementById(id);
        control.value = value;
        control.dispatchEvent(new Event(event));
        const status = document.getElementById("status").dataset.state;
        const busy = document.getElementById("result").getAttribute("aria-busy");
        return busy === "true" && status !== "ready" ? null : { status, busy };
      }, { id, value, event });
      if (left) throw new Error(`right after ${what} the old result was still shown as current: ${JSON.stringify(left)}`);
    };
    const editGrammar = async (what, value) => {
      const left = await run((value) => {
        self.playground.editor.editValue(value);
        const status = document.getElementById("status").dataset.state;
        const busy = document.getElementById("result").getAttribute("aria-busy");
        return busy === "true" && status !== "ready" ? null : { status, busy };
      }, value);
      if (left) throw new Error(`right after ${what} the old result was still shown as current: ${JSON.stringify(left)}`);
    };
    const type = (text) => change("typing", "input", text, "input");
    const choose = (path) => change("choosing a pipeline", "pipeline", path.replace(/^grammars\//, "").replace(/\/pipeline\.md$/, ""), "change");
    const tokenTable = () => run(() => {
      const header = [...document.querySelectorAll("#output table.tokens th")].map((cell) => cell.textContent);
      return {
        header,
        rows: [...document.querySelectorAll("#output table.tokens tbody tr")].map((row) =>
          [...row.querySelectorAll("td")].map((cell, index) => {
            const col = header[index];
            if (col === "tags") return [...cell.querySelectorAll(".tag")].map((tag) => tag.textContent);
            if (col === "before" || col === "after") return JSON.parse(cell.textContent);
            return cell.textContent;
          })),
      };
    });

    await page.goto(target);
    // The status is "loading" and then "busy" until the first answer, which
    // makes it "ready", or a failure, which makes it "error".
    const started = await until("the page to start", () => {
      const status = document.getElementById("status");
      return status && ["ready", "error"].includes(status.dataset.state) ? { state: status.dataset.state, status: status.textContent } : null;
    });
    if (started.state !== "ready") throw new Error(`the playground did not become ready: ${started.status}`);
    await assertLinks();
    // Each fixture uses the same live DOM assertion as the page and presets.
    const invalidLinks = [
      ["unquoted attribute", "<a href=docs/design.md>broken</a>"],
      ["uppercase attribute", '<a HREF="docs/design.md">broken</a>'],
      ["character reference", '<a href="docs/design&#46;md">broken</a>'],
      ["setAttribute", null],
      ["GitHub raw file", "<a href=https://github.com/int19h/gencmu/raw/main/docs/design.md>broken</a>"],
      ["missing GitHub file", '<a HREF="https://github.com/int19h/gencmu/blob/main/docs/missing.md">broken</a>'],
      ["another GitHub repository", '<a href="https://github.com/int19h/another/blob/main/README.md">broken</a>'],
      ["another branch", '<a href="https://github.com/int19h/gencmu/blob/other/README.md">broken</a>'],
      ["another origin", '<a href="https://example.com/docs/design.html">broken</a>'],
      ["repository directory", '<a href="https://github.com/int19h/gencmu/blob/main/docs">broken</a>'],
    ];
    for (const [label, html] of invalidLinks) {
      const href = await run((html) => {
        const fixture = document.createElement("div");
        fixture.id = "smoke-link-fixture";
        if (html) fixture.innerHTML = html;
        else {
          const link = document.createElement("a");
          link.setAttribute("href", "docs/design.md");
          fixture.append(link);
        }
        document.body.append(fixture);
        return fixture.querySelector("a").href;
      }, html);
      let rejected = false;
      try { await assertLinks(); }
      catch (error) { rejected = error.message === `invalid playground link: ${href}`; }
      finally { await run(() => document.getElementById("smoke-link-fixture").remove()); }
      if (!rejected) throw new Error(`the link assertion allowed ${label}`);
    }
    // Local assets, rendered documents, and the editor's Blob downloads qualify.
    await run(() => {
      const fixture = document.createElement("div");
      fixture.id = "smoke-link-fixture";
      fixture.innerHTML = '<a href="playground/style.css">asset</a><a href="https://github.com/int19h/gencmu/blob/main/docs/notation.md#tree-patterns">document</a>';
      const download = document.createElement("a");
      download.href = URL.createObjectURL(new Blob(["grammar"]));
      download.download = "grammar.md";
      fixture.append(download);
      document.body.append(fixture);
    });
    try { await assertLinks(); }
    finally {
      await run(() => {
        const fixture = document.getElementById("smoke-link-fixture");
        URL.revokeObjectURL(fixture.querySelector("a[download]").href);
        fixture.remove();
      });
    }
    const version = await run(() => document.getElementById("version").textContent);
    // The id of every run the page sends from here on.
    await run(() => {
      const client = self.playground.client;
      const send = client.run.bind(client);
      self.smokeRunIds = [];
      client.run = (id, request) => {
        self.smokeRunIds.push(id);
        send(id, request);
      };
    });
    if (!/^Library \d+\.\d+\.\d+/.test(version)) throw new Error(`the worker did not report the library's version: ${version}`);

    // The brand title shows "gencmu" and the help menu links to the repository.
    const heading = await run(() => {
      const title = document.querySelector("#brand-title .g");
      const link = document.querySelector('#help-menu a[href="https://github.com/int19h/gencmu/blob/main/README.md"]');
      return title && link ? { text: title.textContent, href: link.getAttribute("href") } : null;
    });
    if (!heading || heading.text !== "gencmu" || heading.href !== "https://github.com/int19h/gencmu/blob/main/README.md") {
      throw new Error(`the heading does not link gencmu to the repository: ${JSON.stringify(heading)}`);
    }

    const parameterProof = await run(() => {
      const g=self.gencmu;
      const source="```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule pair(@Left, @Right) @Left @Right\n%rule text = pair(\"a\", \"b\")\n```";
      const sources={...self.gencmuGrammars,"smoke-parameters.md":source};
      const pipeline=g.loadPipelineSources(sources,"smoke-parameters.md");
      const result=pipeline.parse("ab");
      const audit=g.audit(pipeline)[0];
      return {ok:result.ok,rule:result.tree.rule,children:result.tree.children.map(child=>child.kind),
        templates:audit.templates.map(item=>item.template),instances:audit.instances.map(item=>item.name)};
    });
    assert.deepEqual(parameterProof,{ok:true,rule:"text",children:["token","token"],templates:["pair"],instances:["text"]});
    console.log(`parameterized rules work in ${browser}`);

    const includeCases = JSON.parse(fs.readFileSync(path.join(repository,"tests/playground-includes.json"),"utf8"));
    const includeDocuments = await run(async cases => {
      const results = [];
      for (const item of cases) {
        results.push(await new Promise((resolve,reject) => {
          const client = new self.ParserWorker({...self.gencmuGrammars,...item.sources,"grammars/test/includes/pipeline.md":"```jbogenbau\n%include \"../../../p.md\"\n```"},message => {
            if (message.kind === "ready") client.run(1,{pipeline:"test/includes",text:"a",features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
            if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
            if (message.kind === "result") {
              const editor = self.gencmuPipeline.pipelineStages("p.md",path => client.text(path),(path, names) => client.documentDirectives.get(JSON.stringify([path, names])));
              client.stop();
              if (message.loadError || !message.parse?.ok) reject(new Error(JSON.stringify(message)));
              else resolve(editor.documents);
            }
          });
          client.start();
        }));
      }
      return results;
    },includeCases);
    assert.deepEqual(includeDocuments,includeCases.map(item => item.documents));
    console.log(`decoded include paths match the editor in ${browser}`);

    const workerTrace = await run(() => new Promise((resolve, reject) => {
      const source = '```jbogenbau\n%stage chars\n%ambiguity-resolution greedy\n%rule text "a" :: A %emits $\n%stage syntax\n%ambiguity-resolution late #·_<_Elided>\n%elision-only\n%rule text a | b | c %emits $ :: A\n%rule a (A [+T])\n%rule b (A [+T] [+T])\n%rule c (A T)\n%stage tree\n%ambiguity-resolution greedy\n%rule text A\n```\n';
      const sources = {...self.gencmuGrammars, "grammars/lojban/cll/pipeline.md":source};
      const client = new self.ParserWorker(sources, message => {
        if (message.kind === "ready") client.run(1, {pipeline:"lojban/cll", text:"a", features:[], withoutFeatures:[], until:null,
          elisionOnly:false, trace:{stage:"tree", position:0}, view:{format:"brackets"}});
        if (["failed", "crashed"].includes(message.kind)) { client.stop(); reject(new Error(message.message)); }
        if (message.kind === "result") { client.stop(); resolve(message); }
      });
      client.start();
    }));
    assert.equal(workerTrace.parse?.ok, true, JSON.stringify(workerTrace));
    assert.equal(workerTrace.trace?.stage, "tree", JSON.stringify(workerTrace));
    assert.equal(workerTrace.trace?.error, undefined, JSON.stringify(workerTrace));
    assert.match(workerTrace.trace.text, /The tree stage at position 0/);
    console.log(`worker traces preserve the elision-only choice in ${browser}`);

    const namesFetches = [];
    const namesPaths = JSON.parse(fs.readFileSync(path.join(repository,"tests/playground-names-paths.json"),"utf8"));
    const namesRoute = "**/*";
    const namesBase = new URL(".", target).pathname;
    const extraNames = "grammars/test/smoke-extra-names.txt";
    const missingNames = "grammars/test/missing-names.txt";
    await page.route(namesRoute, route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith(namesBase)) return route.continue();
      const resource = decodeURIComponent(pathname.slice(namesBase.length));
      if (!["data/unicode/unicode-names.txt", extraNames, missingNames, ...namesPaths].includes(resource)) return route.continue();
      namesFetches.push(resource);
      if (resource === "data/unicode/unicode-names.txt") return route.fulfill({ contentType:"text/plain", body:fs.readFileSync(path.join(repository,"data/unicode/unicode-names.txt"),"utf8") });
      if (namesPaths.includes(resource) || resource === extraNames) return route.fulfill({ contentType:"text/plain", body:"unicode-names 15.1.0\nname E000 SMOKE LETTER\n" });
      return route.fulfill({ status:404, body:"missing" });
    });
    const namesProof = await run(async () => {
      const g = self.gencmu;
      const block = text => "```jbogenbau\n" + text + "\n```\n";
      const source = block('%names "smoke-extra-names.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"');
      const cache = JSON.parse(self.gencmuGrammars["data/preparsed/lojban.json"]);
      cache.bundledNames["grammars/test/smoke-extra-names.txt"] = g.fnv1a64("unicode-names 15.1.0\nname E000 SMOKE LETTER\n");
      const dependencies = { "data/unicode/unicode-names.txt":cache.bundledNames["data/unicode/unicode-names.txt"], "grammars/test/smoke-extra-names.txt":cache.bundledNames["grammars/test/smoke-extra-names.txt"] };
      cache.documents = {};
      cache.documents["grammars/test/smoke-names.md"] = { hash:g.fnv1a64(source), names:dependencies, dom:{ format:49,
        rules:[{name:"text",op:"define",alternatives:[{gates:[],expr:{literal:{string:"b"}}}],conditions:[],at:[4,1]}],
        directives:[{name:"names",args:["smoke-extra-names.txt"],at:[1,1]},{name:"stage",args:["main"],at:[2,1]},
          {name:"ambiguity-resolution",steps:[{step:"greedy"}],at:[3,1]}],constants:[],classifiers:[],implications:[] } };
      const proof = (documents,text) => new Promise((resolve,reject) => {
        const client = new self.ParserWorker({...self.gencmuGrammars,...documents,"grammars/test/names/pipeline.md":block('%include "../smoke-names.md"')},message => {
          if (message.kind === "ready") client.run(1,{pipeline:"test/names",text,features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
          if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
          if (message.kind === "result") { client.stop(); resolve({ok:!!message.parse?.ok,error:message.loadError?.document || null}); }
        });
        client.start();
      });
      const cached = await proof({"grammars/test/smoke-names.md":source,"data/preparsed/test.json":JSON.stringify(cache)},"b");
      cache.documents["grammars/test/smoke-names.md"].names["grammars/test/smoke-extra-names.txt"] = "0000000000000000";
      const missed = await proof({"grammars/test/smoke-names.md":source,"data/preparsed/test.json":JSON.stringify(cache)},"\uE000");
      const custom = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"'),
        "data/unicode/unicode-names.txt":"unicode-names 15.1.0\nname E000 SMOKE LETTER\n"},"\uE000");
      const numeric = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹U+0061›"')},"a");
      const core = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹NUL›"')},"\0");
      const missing = await proof({"grammars/test/smoke-names.md":block('%names "missing-names.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹LATIN SMALL LETTER A›"')},"a");
      return {cached,missed,custom,numeric,core,missing};
    });
    assert.deepEqual(namesProof,{cached:{ok:true,error:null},missed:{ok:true,error:null},custom:{ok:true,error:null},
      numeric:{ok:true,error:null},core:{ok:true,error:null},missing:{ok:false,error:missingNames}});
    assert.deepEqual(namesFetches,["data/unicode/unicode-names.txt",extraNames,"data/unicode/unicode-names.txt","data/unicode/unicode-names.txt",missingNames]);
    const pathProof = await run(async paths => {
      const results = [];
      for (const path of paths) {
        results.push(await new Promise((resolve,reject) => {
          const source = '```jbogenbau\n%names "' + path + '"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"\n```';
          const client = new self.ParserWorker({...self.gencmuGrammars,"names-path.md":source,"grammars/test/names-path/pipeline.md":'```jbogenbau\n%include "../../../names-path.md"\n```'},message => {
            if (message.kind === "ready") client.run(1,{pipeline:"test/names-path",text:"\uE000",features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
            if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
            if (message.kind === "result") {
              client.stop();
              resolve({ok:!!message.parse?.ok,stored:client.namesResources.has(path),error:message.loadError?.message || null});
            }
          });
          client.start();
        }));
      }
      return results;
    },namesPaths);
    assert.deepEqual(pathProof,namesPaths.map(() => ({ok:true,stored:true,error:null})));
    assert.deepEqual(namesFetches.slice(5),namesPaths.flatMap(path => ["data/unicode/unicode-names.txt",path]));
    await page.unroute(namesRoute);
    console.log(`lazy names fetching works in ${browser}`);

    // From here on, every answer the page shows as ready must be for the text
    // and pipeline its controls hold at that moment: an answer that arrives
    // after they changed is out of date and must not be shown.
    await run(() => {
      self.smokeStale = [];
      const check = () => {
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        if (status.dataset.state !== "ready") return;
        const text = document.getElementById("input").value;
        const pipeline = document.getElementById("pipeline").value;
        if (result.dataset.for !== text || result.dataset.pipeline !== pipeline) {
          self.smokeStale.push({ shown: result.dataset.for, pipeline: result.dataset.pipeline, text, selected: pipeline });
        }
      };
      new MutationObserver(check).observe(document.getElementById("status"), { attributes: true, childList: true, subtree: true });
    });
    const stale = async () => {
      const found = await run(() => self.smokeStale);
      if (found.length) throw new Error(`the page showed an answer for an earlier state as current: ${JSON.stringify(found[0])}`);
    };

    // Examples menu, choosing an example, the note, and the footer.
    const checkExamplesMenuFor = async (pipelinePathStr, expectedHeading, expectedCount, expectedFooter) => {
      await choose(pipelinePathStr);
      await idle(`pipeline ${expectedHeading}`);
      const menuState = await run(() => {
        const menu = document.getElementById("examples-menu");
        const heading = menu.querySelector(".mgroup")?.textContent || "";
        const items = [...menu.querySelectorAll(".exitem")].map((btn) => {
          const pill = btn.querySelector(".ex-pill");
          return {
            id: btn.dataset.exampleId,
            title: btn.querySelector(".ex-top b")?.textContent || "",
            pillText: pill?.textContent || "",
            pillAria: pill?.getAttribute("aria-label") || null,
            isJoined: pill?.classList.contains("pill-joined") || false,
            code: btn.querySelector("code")?.textContent || "",
          };
        });
        const foot = menu.querySelector(".ex-foot")?.textContent || null;
        return { heading, items, foot };
      });
      if (menuState.heading !== expectedHeading) {
        throw new Error(`unexpected examples heading: ${JSON.stringify(menuState.heading)} !== ${JSON.stringify(expectedHeading)}`);
      }
      if (menuState.items.length !== expectedCount) {
        throw new Error(`unexpected examples count for ${expectedHeading}: ${menuState.items.length} !== ${expectedCount}`);
      }
      if (menuState.foot !== expectedFooter) {
        throw new Error(`unexpected examples footer for ${expectedHeading}: ${JSON.stringify(menuState.foot)} !== ${JSON.stringify(expectedFooter)}`);
      }
      return menuState;
    };

    const cllMenu = await checkExamplesMenuFor(
      "grammars/lojban/cll/pipeline.md",
      "Examples for lojban/cll",
      19,
      "Other pipelines have 23 more examples."
    );
    const conflictItem = cllMenu.items.find((it) => it.id === "sa-su-feature-conflict");
    if (!conflictItem || conflictItem.pillText !== "feature conflict") {
      throw new Error(`sa-su-feature-conflict pill mismatch: ${JSON.stringify(conflictItem)}`);
    }

    const expMenu = await checkExamplesMenuFor(
      "grammars/lojban/experimental/pipeline.md",
      "Examples for lojban/experimental",
      23,
      "Other pipelines have 19 more examples."
    );
    const cgvItem = expMenu.items.find((it) => it.id === "cgv-name-warning");
    if (!cgvItem || !cgvItem.isJoined || cgvItem.pillAria !== "accepted, 1 warning") {
      throw new Error(`cgv-name-warning pill is not the joined two-part warning pill: ${JSON.stringify(cgvItem)}`);
    }

    const ebMenu = await checkExamplesMenuFor(
      "grammars/eberban/refgram/pipeline.md",
      "Examples for eberban/refgram",
      15,
      "Other pipelines have 27 more examples."
    );
    const hyphenItem = ebMenu.items.find((it) => it.id === "hyphen-warning");
    if (!hyphenItem || !hyphenItem.isJoined || hyphenItem.pillAria !== "accepted, 1 warning") {
      throw new Error(`hyphen-warning pill is not the joined two-part warning pill: ${JSON.stringify(hyphenItem)}`);
    }

    await choose("grammars/lojban/cll/pipeline.md");
    await idle("returning to lojban/cll before example checks");

    const selectExampleById = async (id) => {
      await run((exId) => {
        const ex = self.playground.examples.find((item) => item.id === exId);
        if (!ex) throw new Error(`missing example id ${exId}`);
        self.playground.applyExample(ex);
      }, id);
    };

    // Check a-sentence: gloss + hint without open, note stays across listed pipeline switch and hides on unlisted pipeline switch.
    await selectExampleById("a-sentence");
    const sentenceAns = await answerFor("mi klama le zarci");
    if (sentenceAns.error || sentenceAns.output.trim() !== "(mi [klama {le zarci}])") {
      throw new Error(`a-sentence failed: ${JSON.stringify(sentenceAns)}`);
    }
    const sentenceNote = await run(() => ({
      hidden: document.getElementById("example-hint").hidden,
      title: document.getElementById("example-hint-title").textContent,
      gloss: document.getElementById("example-hint-gloss").textContent,
      glossHidden: document.getElementById("example-hint-gloss").hidden,
      text: document.getElementById("example-hint-text").textContent,
      textHidden: document.getElementById("example-hint-text").hidden,
      ruleHidden: document.getElementById("example-hint-rule").hidden,
    }));
    if (
      sentenceNote.hidden ||
      sentenceNote.title !== "A sentence" ||
      sentenceNote.gloss !== "I go to the market." ||
      sentenceNote.glossHidden ||
      sentenceNote.textHidden ||
      !sentenceNote.text.includes("stages turn letters into words") ||
      !sentenceNote.ruleHidden
    ) {
      throw new Error(`a-sentence note mismatch: ${JSON.stringify(sentenceNote)}`);
    }
    await choose("grammars/lojban/experimental/pipeline.md");
    await answerFor("mi klama le zarci");
    if (await run(() => document.getElementById("example-hint").hidden)) {
      throw new Error("switching to a pipeline listed by the example hid the example note");
    }
    await choose("grammars/eberban/refgram/pipeline.md");
    await answerFor("mi klama le zarci");
    if (!(await run(() => document.getElementById("example-hint").hidden))) {
      throw new Error("switching to a pipeline not listed by the example did not hide the example note");
    }
    await choose("grammars/lojban/cll/pipeline.md");
    await answerFor("mi klama le zarci");

    const exampleChecks = [
      {
        id: "elided-terminators",
        pipeline: "lojban/cll",
        output: /⟨ku⟩[\s\S]*tavla/,
        elidedChecked: true,
      },
      {
        id: "repeated-le",
        pipeline: "lojban/cll",
        rejected: true,
        tab: "trace",
      },
      {
        id: "clause-erasure-sa",
        pipeline: "lojban/cll",
        output: /^\(mi \[citka \{lo plise\}\]\)$/,
        summary: /sa-su/,
        conditionalFeature: "sa-su",
        document: "grammars/lojban/common/stream.md",
        rule: "%rule sa-erasure",
        linkLabel: "Open common/stream.md at sa-erasure",
      },
      {
        id: "cyrillic",
        pipeline: "lojban/cll",
        output: /^\(mi \[klama \{le zarci\}\]\)$/,
        document: "grammars/lojban/cll/cyrillic.md",
        rule: "%rule cll-cyrillic-consonant :: Consonant",
        linkLabel: "Open cyrillic.md at cll-cyrillic-consonant",
      },
      {
        id: "earliest-longest-tense",
        pipeline: "lojban/cll",
        output: /^\(mi \[viska \{\(pu va\) \(\[ca gi\] do gi \[la djan\]\)\}\]\)$/,
        document: "grammars/lojban/cll/pipeline.md",
        rule: "  leftmost-longest #·simple-tense-modal, late #·_<_Elided>",
        linkLabel: "Open pipeline.md at leftmost-longest #·simple-tense-modal",
        summary: /syntax\s*resolved/,
        edit: ["leftmost-longest #·simple-tense-modal, ", ""],
        tie: true,
      },
      {
        id: "ranked-choice-connective",
        pipeline: "lojban/cll",
        output: /^\(\[lo kosta\] cu \[blabi joi ke \{xekri blanu\} ke'e\]\)$/,
        document: "grammars/lojban/cll/syntax.md",
        rule: "%rule afterthought-connection(@Group, @Unit)",
        linkLabel: "Open syntax.md at %rule afterthought-connection(@Group, @Unit)",
      },
      {
        id: "cgv-name-warning",
        pipeline: "lojban/experimental",
        output: /^\(\[\{la tokios\} cu\] \[barda tcadu\]\)$/,
        verdict: /^Accepted, 1 warning$/,
        document: "grammars/lojban/experimental/stream.md",
        rule: "%rule experimental-cgv",
        linkLabel: "Open stream.md at experimental-cgv",
      },
      {
        id: "me-prefers-sumti",
        pipeline: "lojban/experimental",
        tab: "tree",
        output: /me-unit\n\s+ME "me"\n\s+sumti/,
        document: "grammars/lojban/experimental/syntax.md",
        rule: "%rule me-unit",
        linkLabel: "Open syntax.md at me-unit",
        edit: ["%conditions\n  ¬$m.without-elision.parse(sumti)", ""],
        tie: true,
      },
      {
        id: "right-grouped-chain",
        pipeline: "eberban/refgram",
        output: /^\(a \[mi \{dona \(tcu mian\)\}\]\)$/,
        document: "grammars/eberban/refgram/syntax.md",
        rule: "%rule chain",
        linkLabel: "Open syntax.md at chain",
      },
      {
        id: "hyphen-warning",
        pipeline: "eberban/refgram",
        verdict: /^Accepted, 1 warning$/,
        document: "grammars/eberban/refgram/morphology.md",
        rule: "%rule hyphen-misplaced",
        linkLabel: "Open morphology.md at hyphen-misplaced",
      },
    ];

    for (const check of exampleChecks) {
      await choose(`grammars/${check.pipeline}/pipeline.md`);
      await idle(`pipeline ${check.pipeline}`);
      await page.locator(`#examples-menu button[data-example-id="${check.id}"]`).evaluate((btn) => btn.click());
      const text = await page.locator("#input").inputValue();
      const answer = await answerFor(text);
      await assertLinks();
      if (answer.error) throw new Error(`${check.id}: ${answer.error}`);
      if (check.verdict) {
        if (!check.verdict.test(answer.verdict)) {
          throw new Error(`${check.id}: unexpected verdict ${JSON.stringify(answer)}`);
        }
      } else if (check.rejected ? !/Rejected by syntax/.test(answer.verdict) : !/^Accepted/.test(answer.verdict)) {
        throw new Error(`${check.id}: unexpected verdict ${JSON.stringify(answer)}`);
      }
      if (check.elidedChecked !== undefined) {
        const isChecked = await page.locator("#show-elided").isChecked();
        if (isChecked !== check.elidedChecked) {
          throw new Error(`${check.id}: expected #show-elided=${check.elidedChecked}, got ${isChecked}`);
        }
      }
      if (check.tab) {
        const activeTab = await run(() => document.querySelector('#view-tabs .tab[aria-selected="true"]')?.dataset.view);
        if (activeTab !== check.tab) {
          throw new Error(`${check.id}: expected tab ${check.tab}, got ${activeTab}`);
        }
      }
      if (check.output && !check.output.test(answer.output.trim())) {
        throw new Error(`${check.id}: unexpected output ${answer.output}`);
      }
      const summary = await page.locator("#summary").textContent();
      if (check.summary && !check.summary.test(summary)) {
        throw new Error(`${check.id}: unexpected summary ${summary}`);
      }
      if (check.conditionalFeature) {
        await page.locator("#options-button").click();
        const group = page.locator(`#features [role="radiogroup"][aria-label="${check.conditionalFeature}"]`);
        if ((await group.locator('button[data-value="grammar"]').getAttribute("aria-checked")) !== "true") {
          throw new Error("a conditional feature does not follow its grammar initially");
        }
        await group.locator('button[data-value="off"]').click();
        const disabled = await answerFor(text);
        if (
          !/required feature sa-su is disabled/.test(disabled.verdict) ||
          !/words.*requires disabled feature sa-su/.test(disabled.explanation)
        ) {
          throw new Error(`the disabled required feature was not reported: ${JSON.stringify(disabled)}`);
        }
        await group.locator('button[data-value="on"]').click();
        const enabled = await answerFor(text);
        if (!/^Accepted/.test(enabled.verdict)) throw new Error("a caller-enabled feature did not parse");
        await group.locator('button[data-value="grammar"]').click();
        const restored = await answerFor(text);
        if (!/^Accepted/.test(restored.verdict)) throw new Error("the grammar did not restore its conditional feature");
        await page.locator("#options-button").click();
      }
      if (check.document) {
        const opened = await run(() => {
          const cur = self.playground.editor.getCursor();
          return {
            path: document.getElementById("doc-path").textContent,
            line: cur.lineText,
            linkText: document.getElementById("example-hint-rule").textContent,
          };
        });
        if (opened.path !== check.document || opened.line !== check.rule) {
          throw new Error(`${check.id}: the editor did not open the relevant rule: ${JSON.stringify(opened)}`);
        }
        if (check.linkLabel && opened.linkText !== check.linkLabel) {
          throw new Error(`${check.id}: unexpected note link label: ${JSON.stringify(opened.linkText)} !== ${JSON.stringify(check.linkLabel)}`);
        }
      }
      if (check.edit) {
        const source = await run(() => self.playground.editor.getValue());
        if (!source.includes(check.edit[0])) throw new Error(`${check.id}: the suggested edit is absent`);
        await editGrammar("editing a grammar", source.replaceAll(check.edit[0], check.edit[1]));
        const edited = await answerFor(text);
        if (edited.error || (check.tie && !/Tie in syntax/.test(edited.verdict))) {
          throw new Error(`${check.id}: the edit did not show its claimed effect: ${JSON.stringify(edited)}`);
        }
        await page.locator("#doc-reset").click();
        const reset = await answerFor(text);
        if (!check.output.test(reset.output.trim())) throw new Error(`${check.id}: reset did not restore the result`);
      }
      await assertLinks();
      console.log(`example works in ${browser}: ${check.id}`);
    }

    // Format 15 separates original text, normalized values and images.
    // Attachments keep all token fields except span, at every depth.
    await choose("grammars/lojban/cll/pipeline.md");
    const tokenText = "ba'e m,I ui nai klAma";
    await type(tokenText);
    await answerFor(tokenText);
    await page.locator("#tab-tokens").click();
    await idle("the token stage selector", "#token-stage-segs button");
    await page.locator("#token-stage-segs button").filter({hasText: /^indicators \(/}).click();
    await idle("the indicators token table", "#output table.tokens");
    const miTags = ["Cmavo", "Continued", "Final-Stress", "Initial-Stress", "KOhA", "Onset", "Run-Final", "Run-Initial", "Word"];
    const klamaTags = ["BRIVLA", "Continued", "Gismu", "Initial-Stress", "Onset", "Run-Final", "Run-Initial", "Stress-Guard", "Word"];
    const beforeTokens = [{text: "ba'e", value: "ba'e", image: "ba'e",
      tags: ["BAhE", "Cmavo", "Continued", "Onset", "Run-Final", "Run-Initial", "Word"], source: [0, 4]}];
    const afterTokens = [{text: "ui", value: "ui", image: "ui",
      tags: ["Cmavo", "Continued", "Indicator", "Run-Final", "Run-Initial", "UI", "Word"], source: [9, 11],
      after: [{text: "nai", value: "nai", image: "nai",
        tags: ["Cmavo", "Continued", "NAI", "Onset", "Run-Final", "Run-Initial", "Word"], source: [12, 15]}]}];
    assert.deepEqual(await tokenTable(), {
      header: ["#", "text", "value", "image", "span", "source", "tags", "before", "after"],
      rows: [
        ["0", '"m,I"', '"mi"', '"mI"', "1–2", "5–8", miTags, beforeTokens, afterTokens],
        ["1", '"klAma"', '"klama"', '"klAma"', "4–5", "16–21", klamaTags, [], []],
      ],
    }, "the token table must show format 15 fields, omit empty columns, and show recursive attachments");
    await page.locator("#tab-tree").click();
    const imageTree = await idle("the tree with images");
    assert.match(imageTree.output, /KOhA "mI"\n\s+◂ BAhE "ba'e"\n\s+▸ UI "ui"\n\s+▸ NAI "nai"/);
    await page.locator("#tab-json").click();
    const imageDisplay = JSON.parse((await idle("the display JSON with images")).output);
    const displayNodes = [imageDisplay];
    let attached = null;
    while (displayNodes.length) {
      const node = displayNodes.pop();
      if (!node || typeof node !== "object") continue;
      if (node.terminal === "KOhA") attached = node;
      for (const child of Object.values(node)) displayNodes.push(child);
    }
    assert.deepEqual(attached, {terminal: "KOhA", image: "mI",
      before: [{classes: ["BAhE"], image: "ba'e"}],
      after: [{classes: ["UI"], image: "ui", after: [{classes: ["NAI"], image: "nai"}]}]},
      "display JSON must render images and nested attachments");
    await page.locator("#show-canonical").check();
    const canonical = JSON.parse((await idle("the canonical JSON with values and images")).output);
    assert.equal(canonical.format, 17);
    const indicator = canonical.stages.find((stage) => stage.name === "indicators").output[0];
    assert.deepEqual(indicator, {text: "m,I", value: "mi", image: "mI", tags: miTags,
      span: [1, 2], source: [5, 8], before: beforeTokens, after: afterTokens});
    await page.locator("#show-canonical").uncheck();
    await page.locator("#tab-brackets").click();
    await idle("the brackets after the token assertions");
    console.log(`format 15 token and tree views work in ${browser}`);
    // Rule navigation uses the reader's exact definitions and active documents.
    await choose("grammars/lojban/zantufa/pipeline.md");
    await idle("switching to lojban/zantufa for rule navigation");
    const navigationText = "lo mlatu pe mi cu .feliks.";
    const navigationOutput = "([lo {mlatu (pe mi)}] cu feliks)";
    const setNavigationCase = (kind) => run((kind) => {
      const client = self.playground.client;
      const syntax = self.gencmuGrammars["grammars/lojban/zantufa/syntax.md"];
      const pipeline = self.gencmuGrammars["grammars/lojban/zantufa/pipeline.md"];
      let changed = syntax;
      let changedPipeline = pipeline;
      const marker = "%rule tanru-unit-1\n";
      if (kind === "prefix") changed = "%rule tanru-unit-1 \"prose\"\n\n" + syntax.replace(marker, "%rule tanru-unit-10 \"w\"\n" + marker);
      else if (kind === "renamed") changed = syntax.replaceAll("tanru-unit-1", "renamed-unit");
      else if (kind === "moved") {
        const start = syntax.indexOf(marker);
        const end = syntax.indexOf("\n%rule ", start + marker.length);
        if (start < 0 || end < 0) throw new Error("the navigation fixture cannot find the rule body");
        changed = syntax.slice(0, start) + syntax.slice(end);
        changedPipeline += "\n```jbogenbau\n" + syntax.slice(start, end) + "\n```\n";
      }
      client.setDocument("grammars/lojban/zantufa/syntax.md", changed);
      client.setDocument("grammars/lojban/zantufa/pipeline.md", changedPipeline);
    }, kind);
    for (const kind of ["prefix", "renamed", "moved", "reset"]) {
      await setNavigationCase(kind);
      await selectExampleById("cmevla-as-selbri");
      const answer = await answerFor(navigationText);
      if (answer.error || answer.output.trim() !== navigationOutput) {
        throw new Error(`${kind} rule navigation changed the preset result: ${JSON.stringify(answer)}`);
      }
      const opened = await run(() => {
        const cur = self.playground.editor.getCursor();
        const hint = document.getElementById("example-hint");
        return { path: document.getElementById("doc-path").textContent, offset: cur.offset,
          line: cur.lineText, hint: hint.hidden ? "" : hint.textContent };
      });
      if (kind === "renamed") {
        if (!opened.hint.includes("Cannot find rule tanru-unit-1 in the active grammar.") || opened.offset !== 0) {
          throw new Error(`a missing rule was not explained at the document start: ${JSON.stringify(opened)}`);
        }
      } else if (opened.path !== (kind === "moved" ? "grammars/lojban/zantufa/pipeline.md" : "grammars/lojban/zantufa/syntax.md") ||
          opened.line !== "%rule tanru-unit-1" || opened.hint.includes("Cannot find rule")) {
        throw new Error(`${kind} rule navigation missed the exact definition: ${JSON.stringify(opened)}`);
      }
      await assertLinks();
    }
    console.log(`playground regression cases work in ${browser}`);
    await page.locator("#tab-brackets").click();

    await choose("grammars/lojban/cll/pipeline.md");
    const sentence = "mi klama le zarci";
    await type(sentence);
    const accepted = await answerFor(sentence);
    if (accepted.error) throw new Error(`the playground failed: ${accepted.error}`);
    const brackets = "(mi [klama {le zarci}])";
    if (accepted.output.trim() !== brackets) {
      throw new Error(`${sentence} under lojban/cll gave ${JSON.stringify(accepted.output)}, not ${brackets}`);
    }

    const rejected = "mi klama le le";
    await type(rejected);
    const explained = await answerFor(rejected);
    if (explained.error) throw new Error(`the playground failed: ${explained.error}`);
    if (!/Rejected by syntax/.test(explained.verdict) || !/The syntax stage cannot read the text/.test(explained.explanation) ||
        !/\^/.test(explained.explanation) || !/sumti-6: .*LE/.test(explained.explanation)) {
      throw new Error(`${rejected} was not explained as a rejection: ${JSON.stringify(explained)}`);
    }

    const pipelineGroups = await run(() => [...document.querySelectorAll("#pipeline optgroup")].map((group) => ({
      label: group.label,
      names: [...group.children].map((option) => option.value),
    })));
    assert.deepEqual(pipelineGroups, [
      { label: "lojban", names: ["lojban/cll", "lojban/bpfk", "lojban/experimental", "lojban/zantufa", "lojban/examples/kihei"] },
      { label: "eberban", names: ["eberban/refgram"] },
      { label: "gencmu", names: ["gencmu/jbogenbau"] },
    ]);

    const kiheiLabel = await run(() => document.querySelector('#pipeline option[value="lojban/examples/kihei"]').textContent);
    if (kiheiLabel !== "lojban/examples/kihei: Discourse frames (ki'ei)") throw new Error(`unexpected kihei title: ${kiheiLabel}`);
    await choose("grammars/lojban/examples/kihei/pipeline.md");
    const saFrame = "broda .i ki'ei ko'a sa ki'ei ko'e .i brode";
    await type(saFrame);
    const frameAnswer = await answerFor(saFrame);
    if (frameAnswer.error || frameAnswer.output.trim() !== "([broda i] [{ki'ei ko'e} i brode])") {
      throw new Error(`KIhEI word erasure failed: ${JSON.stringify(frameAnswer)}`);
    }

    // Discarded source still needs to parse and remains editable from its error link.
    const patched = "grammars/lojban/zantufa/pipeline.md";
    const discarded = "grammars/lojban/common/latin.md";
    const extended = "grammars/lojban/zantufa/syntax.md";
    await run(({patched, discarded, extended}) => {
      self.playground.client.setDocument(discarded, "```jbogenbau\n%rule text (\n```\n");
      self.playground.client.setDocument(extended, "```jbogenbau\n%extend-rule text \"b\" :: X %emits $\n```\n");
      self.playground.client.setDocument(patched, "```jbogenbau\n%stage a\n%include \"../common/latin.md\"\n" +
        "%stage b\n%ambiguity-resolution greedy\n%rule text X\n%redefine-stage a\n" +
        "%ambiguity-resolution greedy\n%rule text \"a\" :: X %emits $\n%extend-stage a\n" +
        "%include \"syntax.md\"\n```\n");
    }, {patched, discarded, extended});
    await choose(patched);
    await type("b");
    await idle("the error in discarded source");
    const errorLink = page.locator('#diagnostics button.link').filter({hasText: "grammars/lojban/common/latin.md"}).first();
    await errorLink.click();
    const openedDiscarded = await run(() => document.getElementById("doc-path").textContent);
    if (openedDiscarded !== discarded) throw new Error(`discarded source did not open: ${openedDiscarded}`);
    await editGrammar("repairing discarded source", "```jbogenbau\n%rule old \"x\"\n```\n");
    const repaired = await answerFor("b");
    if (repaired.error || repaired.output.trim() !== "b") throw new Error(`stage patch failed: ${JSON.stringify(repaired)}`);
    const groups = await run(() => [...document.querySelectorAll(".doc-group")].map(group => ({
      name: group.querySelector(".doc-stage").textContent, text: group.textContent,
    })));
    if (!groups.some(group => group.name === "a" && group.text.includes("syntax")) ||
        groups.some(group => group.name === "a" && group.text.includes("common/latin"))) {
      throw new Error(`wrong stage contributions: ${JSON.stringify(groups)}`);
    }
    await run(paths => paths.forEach(path => self.playground.client.setDocument(path, self.gencmuGrammars[path])),
      [patched, discarded, extended]);
    await choose("grammars/lojban/cll/pipeline.md");
    console.log(`stage patches and KIhEI work in ${browser}`);

    // A tie is an error, shown with its two readings and no tree. No text
    // ties in a bundled pipeline, so an edited pipeline stands in for one: its
    // stage syntax reads "w" as either of two rules.
    const tiedPipeline = "grammars/lojban/zantufa/pipeline.md";
    await run((path) => self.playground.client.setDocument(path, "# A tie\n\n```jbogenbau\n" +
      "%stage syntax\n%ambiguity-resolution greedy\n%rule text a | b\n%rule a \"w\"\n%rule b \"w\"\n```\n"), tiedPipeline);
    await choose(tiedPipeline);
    const tied = "w";
    await type(tied);
    const tie = await answerFor(tied);
    if (tie.error) throw new Error(`the playground failed: ${tie.error}`);
    if (!/Tie in syntax/.test(tie.verdict) || !/The syntax stage is ambiguous/.test(tie.explanation) ||
        !/first/i.test(tie.explanation) || !/second/i.test(tie.explanation) || tie.output !== "") {
      throw new Error(`${tied} was not shown as a tie: ${JSON.stringify(tie)}`);
    }
    await run((path) => self.playground.client.setDocument(path, self.gencmuGrammars[path]), tiedPipeline);
    await choose("grammars/lojban/experimental/pipeline.md");

    // Texts typed while earlier ones are still being parsed, one of them long
    // enough to be parsing when the next arrives.
    const long = Array(8).fill("lo lojbo cu tavla fi lo nu mi klama le zarci .i do pu tavla mi").join(" .i ");
    for (const text of [long, "mi klama", long + " .i mi", "mi klama le zarci .i do klama", "do klama"]) {
      await type(text);
      await sleep(170 + Math.floor(Math.random() * 100));
    }
    await choose("grammars/lojban/experimental/pipeline.md");
    await type("mi cu klama");
    await choose("grammars/lojban/cll/pipeline.md");
    const last = "mi klama le zarci";
    await type(last);
    const settled = await answerFor(last);
    if (settled.error || settled.output.trim() !== brackets) throw new Error(`after a burst of changes: ${JSON.stringify(settled)}`);
    await stale();

    // An empty text has a tree whose brackets are empty (docs/output.md).
    // When there is no output to copy, the page hides Elided and Copy and
    // shows "The text is empty." as .empty-out without saying there is no tree.
    const emptyRendering = async (what) => {
      const answer = await answerFor("");
      if (answer.error) throw new Error(`the playground failed: ${answer.error}`);
      const empty = await run(() => ({
        pre: document.querySelector("#output pre.result-text") ? document.querySelector("#output pre.result-text").textContent : null,
        copy: !document.getElementById("copy-output")?.hidden,
        elided: !document.getElementById("elided-toggle")?.hidden,
        text: document.getElementById("output").textContent,
      }));
      if (empty.pre !== null || empty.copy || empty.elided || /No tree|no tokens/.test(empty.text) || empty.text.trim() !== "The text is empty.") {
        throw new Error(`the empty bracket rendering of ${what} was not shown as one: ${JSON.stringify(empty)}`);
      }
    };
    await type("");
    await emptyRendering("a hollow tree");

    // A token's image can be empty too (docs/output.md), so an empty
    // rendering does not mean that the tree holds no tokens. In this
    // pipeline the first stage emits one token X with an empty image for the
    // empty text, and the second stage reads it.
    const imageless = "grammars/lojban/zantufa/pipeline.md";
    await run((path) => self.playground.client.setDocument(path, "# Empty images\n\n```jbogenbau\n" +
      "%stage a\n%ambiguity-resolution greedy\n%rule text ε\n%emits ε :: X\n" +
      "%stage b\n%ambiguity-resolution greedy\n%rule text X\n```\n"), imageless);
    await choose(imageless);
    await emptyRendering("a token with an empty image");
    const shownFor = await run(() => document.getElementById("result").dataset.pipeline);
    if (shownFor !== "lojban/zantufa") throw new Error(`the empty image was checked under ${shownFor}, not the edited pipeline`);
    await page.locator("#tab-tokens").click();
    await idle("the inserted token table", "#output table.tokens");
    assert.deepEqual(await tokenTable(), {
      header: ["#", "text", "value", "image", "span", "source", "tags", "insertedBy"],
      rows: [["0", '""', '""', '""', "0–0", "0–0", ["X"], "text"]],
    }, "the token table must keep empty values and images, show insertedBy, and omit empty columns");
    await page.locator("#tab-brackets").click();
    await idle("the empty brackets after the inserted token assertion");
    await run((path) => self.playground.client.setDocument(path, self.gencmuGrammars[path]), imageless);
    await choose("grammars/lojban/cll/pipeline.md");
    await type(last);
    await answerFor(last);

    // An edited document is read with the notation grammar, which takes a
    // while for a long one such as the CLL word shapes; a pipeline that does
    // not use it should not wait for that.
    await run(() => {
      [...document.querySelectorAll("button.doc")].find((button) => button.dataset.doc === "grammars/lojban/cll/shapes.md").click();
      const ed = self.playground.editor;
      ed.editValue(ed.getValue().replace("%rule", "%rule "));
    });
    await until("the edited word shapes to be read", () =>
      document.getElementById("status").textContent.includes("Reading shapes.md") ? true : null);
    await choose("grammars/lojban/experimental/pipeline.md");
    const other = await until("an answer under the experimental pipeline", () => {
      const status = document.getElementById("status");
      const result = document.getElementById("result");
      return status.dataset.state === "ready" && result.dataset.pipeline === "lojban/experimental" && !result.hasAttribute("aria-busy")
        ? { read: self.playground.client.doms.has("grammars/lojban/cll/shapes.md"), output: (document.querySelector("#output pre") || {}).textContent } : null;
    });
    // The worker hands the page every document it finishes reading, so the
    // document's being there means the switch waited for it.
    if (other.read) throw new Error("switching to a pipeline that does not read the edited word shapes waited for them to be read");
    if (!other.output || !other.output.includes("klama")) throw new Error(`no brackets under experimental: ${JSON.stringify(other)}`);
    await stale();

    // The features a parse used are listed by name, each in its own code
    // element, and never as the text of an array.
    const featured = "je lu «lo nu spoja pu lakne je cu xoi ro da pacna na fasnu» li'u";
    await type(featured);
    const listed = await answerFor(featured);
    if (listed.error) throw new Error(`the playground failed: ${listed.error}`);
    const features = await run(() => {
      const line = document.querySelector("#summary .features-used");
      return line ? { text: line.textContent, codes: [...line.querySelectorAll("code")].map((code) => code.textContent) } : null;
    });
    const escaped = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = features && features.codes.map((name) => `${escaped(name)}`).join("");
    if (!features || !features.codes.length || !new RegExp(`^Enabled features${named}$`).test(features.text)) {
      throw new Error(`the features used were not listed by name: ${JSON.stringify(features)}`);
    }
    await stale();

    // A failure of an earlier run can arrive after a newer run started. It
    // must not end the newer run, and its error is not shown. The worker
    // fails a run whose request is null. Here that run has the id of the
    // last run that finished, and the worker posts its failure before it
    // reads the newer run.
    const staleFailure = "mi klama le zarci .i do klama";
    const failedEarlier = await run((text) => {
      const client = self.playground.client;
      const ids = self.smokeRunIds;
      const earlier = ids[ids.length - 1];
      const input = document.getElementById("input");
      input.value = text;
      input.dispatchEvent(new Event("input"));
      client.worker.postMessage({ kind: "run", id: earlier, request: null });
      self.playground.schedule(0);
      return { earlier, newer: ids[ids.length - 1] };
    }, staleFailure);
    if (!(failedEarlier.newer > failedEarlier.earlier)) throw new Error(`the page did not start a newer run at once: ${JSON.stringify(failedEarlier)}`);
    const afterFailure = await answerFor(staleFailure);
    if (afterFailure.error) throw new Error(`a failure for another run ended the current one: ${afterFailure.error}`);
    if (!afterFailure.output.includes("klama")) throw new Error(`no brackets after a stale failure: ${JSON.stringify(afterFailure)}`);
    const boxes = await run(() => [...document.querySelectorAll("#diagnostics .box")].map((box) => box.textContent));
    if (boxes.some((box) => /went wrong|The parser stopped/.test(box))) throw new Error(`a failure for another run was shown: ${JSON.stringify(boxes)}`);

    // A failure outside any run, here of a worker told to start with no
    // documents, stops that worker. The page says so, and the next change
    // starts a new worker.
    await run(() => self.playground.client.worker.postMessage({ kind: "init", sources: null }));
    const broken = await until("the failure outside a run", () => {
      const status = document.getElementById("status");
      return status.dataset.state === "error" ? { text: document.getElementById("diagnostics").textContent, worker: !!self.playground.client.worker } : null;
    });
    if (!/The parser stopped/.test(broken.text) || broken.worker) {
      throw new Error(`a failure outside a run did not stop the worker: ${JSON.stringify(broken)}`);
    }
    await type(last);
    const restarted = await answerFor(last);
    if (restarted.error || restarted.output.trim() !== brackets) throw new Error(`no new worker after a failure outside a run: ${JSON.stringify(restarted)}`);
    await stale();

    // A shared link can ask for a feature both on and off, which the library
    // refuses. On the Trace tab the page shows that error once and then
    // stays idle: it asks the worker again only when the worker says that
    // the trace waits for the pipeline's stages. The link keeps both lists.
    const conflicting = "#text=mi&pipeline=lojban/cll&features=sa-su&without=sa-su&view=trace";
    page = await instance.newPage();
    await page.goto(target + conflicting);
    const refused = await idle("the refused feature selection");
    await assertLinks();
    if (refused.error) throw new Error(`the playground failed: ${refused.error}`);
    if (refused.boxes.length !== 1 || !/The parser could not run/.test(refused.boxes[0]) || !/sa-su/.test(refused.boxes[0])) {
      throw new Error(`a feature both on and off was not shown as one error: ${JSON.stringify(refused)}`);
    }
    const runs = await run(() => self.playground.timings.runs.length);
    await sleep(1500);
    const after = await run(() => ({ runs: self.playground.timings.runs.length, state: document.getElementById("status").dataset.state, hash: location.hash }));
    if (after.runs !== runs || after.state !== "ready") {
      throw new Error(`the Trace tab kept asking after the error: ${runs} runs, then ${JSON.stringify(after)}`);
    }
    const kept = new URLSearchParams(after.hash.slice(1));
    if (kept.get("features") !== "sa-su" || kept.get("without") !== "sa-su") {
      throw new Error(`the link lost its feature selection: ${after.hash}`);
    }

    // A link to the Trace tab traces the text, once the worker has named
    // the pipeline's stages.
    page = await instance.newPage();
    await page.goto(target + "#text=mi%20klama&pipeline=lojban/cll&view=trace");
    const traced = await idle("a trace from a link", "#trace-picker .gap");
    await assertLinks();
    if (traced.error || !traced.output) throw new Error(`a link to the Trace tab gave no trace: ${JSON.stringify(traced)}`);

    // The redesigned layout controls work: popover menus, split handle, hide
    // and show grammar, basic editor interface, and phone layout at 390 and 320.
    const layoutChecks = await run(() => {
      const helpBtn = document.getElementById("help-button");
      const helpMenu = document.getElementById("help-menu");
      helpBtn.click();
      const helpOpen = !helpMenu.hidden && helpBtn.getAttribute("aria-expanded") === "true";
      const hasPlaygroundDoc = [...helpMenu.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").endsWith("docs/playground.md"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      const helpClosed = helpMenu.hidden && helpBtn.getAttribute("aria-expanded") === "false";

      const split = document.getElementById("split-handle");
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
      const movedSplit = split.getAttribute("aria-valuenow");
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
      const resetSplit = split.getAttribute("aria-valuenow");

      document.getElementById("hide-grammar").click();
      const hidden = document.getElementById("workspace").classList.contains("grammar-hidden");
      document.getElementById("show-grammar").click();
      const shownAgain = !document.getElementById("workspace").classList.contains("grammar-hidden");

      const ed = self.playground.editor;
      const hasEditorApi =
        ed &&
        ed.variant === "full" &&
        ed.capabilities?.syntaxColors === true &&
        ed.capabilities?.wrappedLineNumbers === true &&
        ed.capabilities?.marginMarks === true &&
        typeof ed.getValue === "function" &&
        typeof ed.setValue === "function" &&
        typeof ed.goTo === "function" &&
        typeof ed.markError === "function" &&
        typeof ed.clearMarks === "function" &&
        typeof ed.focus === "function";

      return { helpOpen, hasPlaygroundDoc, helpClosed, movedSplit, resetSplit, hidden, shownAgain, hasEditorApi };
    });
    if (
      !layoutChecks.helpOpen ||
      !layoutChecks.hasPlaygroundDoc ||
      !layoutChecks.helpClosed ||
      layoutChecks.movedSplit !== "45" ||
      layoutChecks.resetSplit !== "35" ||
      !layoutChecks.hidden ||
      !layoutChecks.shownAgain ||
      !layoutChecks.hasEditorApi
    ) {
      throw new Error(`the redesigned layout checks failed: ${JSON.stringify(layoutChecks)}`);
    }

    // Full editor checks: syntax colors, error marks in the gutter, and Go to line:column.
    await run(() => {
      self.playground.openDocument("grammars/lojban/cll/syntax.md", 345, 1);
    });
    const fullTokens = await run(() => {
      const content = document.querySelector("#editor-body .cm-content");
      return {
        label: content ? content.getAttribute("aria-label") : null,
        hasK: !!document.querySelector("#editor-body .cm-content .k"),
        hasD: !!document.querySelector("#editor-body .cm-content .d"),
        hasT: !!document.querySelector("#editor-body .cm-content .t"),
        hasP: !!document.querySelector("#editor-body .cm-content .p"),
      };
    });
    if (fullTokens.label !== "syntax.md" || !fullTokens.hasK || !fullTokens.hasD || !fullTokens.hasT || !fullTokens.hasP) {
      throw new Error(`full editor syntax colors or label missing: ${JSON.stringify(fullTokens)}`);
    }
    const syntaxSource = await run(() => self.playground.editor.getValue());
    await editGrammar("introducing a grammar error in full editor", syntaxSource.replace("sumti-tail [+KU", "sumti-tali [+KU"));
    await idle("the grammar error in full editor", "#doc-error-bar:not([hidden])");
    await run(() => self.playground.editor.goTo(350, 21));
    const fullErrorMarks = await run(() => {
      const gutterErr = document.querySelector("#editor-body .cm-errorLineGutter .cm-errorLineNumber");
      const lineErr = document.querySelector("#editor-body .cm-errorLine");
      const srText = document.getElementById("editor-error-sr")?.textContent || "";
      const jumpBtn = document.getElementById("doc-error-jump");
      return {
        gutterAria: gutterErr ? gutterErr.getAttribute("aria-label") : null,
        hasLineErr: !!lineErr,
        srText,
        jumpText: jumpBtn ? jumpBtn.textContent : null,
      };
    });
    if (
      !fullErrorMarks.gutterAria ||
      !/, error$/.test(fullErrorMarks.gutterAria) ||
      !fullErrorMarks.hasLineErr ||
      !/^Line \d+, error:/.test(fullErrorMarks.srText) ||
      !/^Go to \d+:\d+$/.test(fullErrorMarks.jumpText || "")
    ) {
      throw new Error(`full editor error marks missing: ${JSON.stringify(fullErrorMarks)}`);
    }
    await page.locator("#doc-error-jump").click();
    const jumpedLine = await run(() => self.playground.editor.getCursor().lineText);
    if (jumpedLine !== "%rule sumti-6") {
      throw new Error(`full editor Go to line:column did not move to %rule sumti-6: ${jumpedLine}`);
    }
    await page.locator("#doc-reset").click();
    await idle("resetting full editor grammar error");

    // Round 5 checks: wrapped lines in Tree/JSON/Audit, measured top-bar steps, and phone chevron/version.
    await page.locator("#tab-tree").click();
    await idle("tree view for wrapped line check");
    const wrappedTreeCheck = await run(() => {
      const pre = document.querySelector("#output pre.result-text.code-block");
      const wlines = pre ? [...pre.querySelectorAll(".wline")] : [];
      return {
        hasRawText: !!(pre && typeof pre.dataset.rawText === "string" && pre.dataset.rawText.length > 0),
        rawMatchesText: !!(pre && pre.dataset.rawText === pre.textContent),
        textIndent: wlines[0] ? wlines[0].style.textIndent : null,
        pad0: wlines[0] ? wlines[0].style.paddingLeft : null,
        pad1: wlines[1] ? wlines[1].style.paddingLeft : null,
        versionPhone: document.getElementById("version-phone")?.textContent || "",
      };
    });
    if (
      !wrappedTreeCheck.hasRawText ||
      !wrappedTreeCheck.rawMatchesText ||
      wrappedTreeCheck.textIndent !== "-4ch" ||
      wrappedTreeCheck.pad0 !== "calc(4ch)" ||
      wrappedTreeCheck.pad1 !== "calc(6ch)" ||
      !/^Library \d+\.\d+\.\d+$/.test(wrappedTreeCheck.versionPhone)
    ) {
      throw new Error(`Round 5 wrapped line or phone version check failed: ${JSON.stringify(wrappedTreeCheck)}`);
    }
    await page.locator("#tab-brackets").click();
    await idle("returning to brackets before width checks");

    for (const [w, expectedPhone, expectedStep] of [
      [1440, false, ""],
      [760, false, "1"],
      [600, false, "2"],
      [560, true, ""],
      [390, true, ""],
      [320, true, ""],
    ]) {
      await page.setViewportSize({ width: w, height: 844 });
      const m = await run(() => {
        window.dispatchEvent(new Event("resize"));
        const app = document.getElementById("app");
        const topbar = document.getElementById("topbar");
        return {
          phone: app.classList.contains("phone"),
          step: topbar.getAttribute("data-overflow") || "",
          scrollW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
        };
      });
      if (m.phone !== expectedPhone || m.step !== expectedStep || m.scrollW > m.winW) {
        throw new Error(`width check failed at ${w}px: ${JSON.stringify({ m, expectedPhone, expectedStep })}`);
      }
    }
    console.log(`redesigned layout, full editor, and phone checks work in ${browser}`);

    // Basic editor variant: served without playground/vendor/.
    const basicPage = await instance.newPage();
    await basicPage.route("**/playground/vendor/**", (route) => route.fulfill({ status: 404, body: "missing" }));
    await basicPage.goto(target);
    const basicStarted = await (async () => {
      for (let attempt = 0; attempt < 600; attempt++) {
        const val = await basicPage.evaluate(() => {
          const status = document.getElementById("status");
          return status && ["ready", "error"].includes(status.dataset.state)
            ? { state: status.dataset.state, variant: self.playground?.editor?.variant, caps: self.playground?.editor?.capabilities }
            : null;
        });
        if (val !== null) return val;
        await sleep(100);
      }
      throw new Error("timed out waiting for basic editor variant to start");
    })();
    if (
      basicStarted.state !== "ready" ||
      basicStarted.variant !== "basic" ||
      basicStarted.caps?.syntaxColors !== false ||
      basicStarted.caps?.wrappedLineNumbers !== false ||
      basicStarted.caps?.marginMarks !== false
    ) {
      throw new Error(`basic editor variant did not initialize as expected: ${JSON.stringify(basicStarted)}`);
    }
    await basicPage.evaluate(() => {
      const btn = document.querySelector('#examples-menu button[data-example-id="clause-erasure-sa"]');
      if (!btn) throw new Error("missing clause-erasure-sa in basic editor examples menu");
      btn.click();
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const exLoaded = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        return status.dataset.state === "ready" &&
          !result.hasAttribute("aria-busy") &&
          result.dataset.for.includes("badna")
          ? true
          : null;
      });
      if (exLoaded) break;
      await sleep(100);
    }
    const basicOpened = await basicPage.evaluate(() => {
      const ta = document.getElementById("doc-text");
      const cur = self.playground.editor.getCursor();
      const menuHead = document.querySelector("#examples-menu .mgroup")?.textContent || "";
      const menuFoot = document.querySelector("#examples-menu .ex-foot")?.textContent || "";
      const noteLink = document.getElementById("example-hint-rule")?.textContent || "";
      return {
        hasTextarea: ta instanceof HTMLTextAreaElement,
        hasCm: !!document.querySelector("#editor-body .cm-editor"),
        label: ta ? ta.getAttribute("aria-label") : null,
        lineText: cur.lineText,
        menuHead,
        menuFoot,
        noteLink,
      };
    });
    if (
      !basicOpened.hasTextarea ||
      basicOpened.hasCm ||
      basicOpened.label !== "stream.md" ||
      basicOpened.lineText !== "%rule sa-erasure" ||
      basicOpened.menuHead !== "Examples for lojban/cll" ||
      basicOpened.menuFoot !== "Other pipelines have 23 more examples." ||
      basicOpened.noteLink !== "Open common/stream.md at sa-erasure"
    ) {
      throw new Error(`basic editor did not open stream.md on %rule sa-erasure via example: ${JSON.stringify(basicOpened)}`);
    }
    await basicPage.evaluate(() => {
      self.playground.openDocument("grammars/lojban/cll/syntax.md", 345, 1);
    });
    await basicPage.evaluate(() => {
      const ed = self.playground.editor;
      ed.editValue(ed.getValue().replace("sumti-tail [+KU", "sumti-tali [+KU"));
      ed.goTo(1, 1);
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const readyErr = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const bar = document.getElementById("doc-error-bar");
        return status.dataset.state === "ready" && bar && !bar.hidden ? true : null;
      });
      if (readyErr) break;
      await sleep(100);
    }
    await basicPage.locator("#doc-error-jump").click();
    const basicJumped = await basicPage.evaluate(() => ({
      lineText: self.playground.editor.getCursor().lineText,
      srText: document.getElementById("editor-error-sr")?.textContent || "",
    }));
    if (basicJumped.lineText !== "%rule sumti-6" || !/^Line \d+, error:/.test(basicJumped.srText)) {
      throw new Error(`basic editor Go to line:column or sr text failed: ${JSON.stringify(basicJumped)}`);
    }
    await basicPage.locator("#doc-reset").click();
    for (let attempt = 0; attempt < 600; attempt++) {
      const restored = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const bar = document.getElementById("doc-error-bar");
        const badge = document.querySelector("#summary .badge");
        return status.dataset.state === "ready" && bar?.hidden && badge?.textContent === "Accepted" ? true : null;
      });
      if (restored) break;
      await sleep(100);
    }
    console.log(`basic editor variant works in ${browser}`);
    console.log(`playground works in ${browser} at ${target}, ${version}`);
  } finally {
    await instance.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
