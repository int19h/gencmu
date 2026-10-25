// The documents of a pipeline, stage by stage, for the playground's grammar
// editor. It reads the %stage and %include directives as the library does
// (docs/design.md, "Pipelines"), but forgives what the library would refuse,
// so that the editor can list the documents of a pipeline that has an error:
// a document that does not exist, one whose text cannot be read, and a cycle
// of includes are all listed, and the scan goes on.
(function (root) {
  "use strict";

  // While a test sets `hooks.work`, the scans below count their steps in
  // it, as the library's hook does (lib/js/src/testing.js), and stop at the
  // first count past `hooks.work.budget`. Unset, they count nothing.
  const hooks = { work: null };
  const count = (kind, steps = 1) => {
    const work = hooks.work;
    if (!work) return;
    work[kind] = (work[kind] || 0) + steps;
    const most = work.budget && work.budget[kind];
    if (most !== undefined && work[kind] > most) {
      const error = new Error(`${work[kind]} ${kind}, past the budget of ${most}`);
      error.name = "WorkBudget";
      throw error;
    }
  };

  // A path relative to a document, resolved and normalized, as the library
  // resolves an %include.
  function resolvePath(from, relative) {
    const parts = from.split("/").slice(0, -1);
    for (const part of relative.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  }

  // The text of a document's jbogenbau blocks. A block that is never closed
  // runs to the end of the document.
  function grammarText(markdown) {
    const kept = [];
    let fence = null;
    let keep = false;
    for (const line of markdown.split(/\r\n|\r|\n/)) {
      if (fence === null) {
        const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
          fence = open[1];
          keep = open[2].trim() === "jbogenbau";
        }
        continue;
      }
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      else if (keep) kept.push(line);
    }
    return kept.join("\n");
  }

  // The characters the notation reads as spaces: the White_Space property
  // (engine §1, grammars/notation/lexical.md).
  const SPACE = /^[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]$/;

  // Keywords, names and quoted tokens used by pipeline directives (§9.1).
  // Comments stop at their first closer. Quotes never use backslash escapes.
  // Strings keep dollar signs literally. Other punctuation ends an operand.
  function tokens(text) {
    const cs = [...text];
    const at = (i, what) => cs.slice(i, i + what.length).join("") === what;
    const found = [];
    let i = 0;
    while (i < cs.length) {
      if (SPACE.test(cs[i])) {
        i++;
      } else if (at(i, "(*")) {
        let end = i + 2;
        while (end < cs.length && !at(end, "*)")) end++;
        i = end + 2;
      } else if (cs[i] === "\"") {
        const start = ++i;
        let valid = true;
        while (i < cs.length && cs[i] !== "\"") {
          i++;
        }
        const value = cs.slice(start, i).join("");
        valid = valid && i < cs.length;
        if (i < cs.length) i++;
        found.push(valid ? { kind: "string", value } : { kind: "other", value: "" });
      } else {
        const keyword = cs[i] === "%";
        let end = i + (keyword ? 1 : 0);
        if (/^[A-Za-z]$/.test(cs[end])) {
          end++;
          while (end < cs.length && /^[-_A-Za-z0-9]$/.test(cs[end])) end++;
          found.push({ kind: keyword ? "keyword" : "name", value: cs.slice(i, end).join("") });
          i = end;
        } else {
          found.push({ kind: "other", value: cs[i] });
          i++;
        }
      }
    }
    return found;
  }

  // The fallback lists literal paths while a document awaits the worker.
  // Escaped paths require its public reader and selected names scope.
  // The stage selectors and %include directives of a grammar text, in order.
  function directives(text) {
    const found = [];
    const all = tokens(text);
    all.forEach((token, index) => {
      const next = all[index + 1];
      if (token.kind !== "keyword" || !next) return;
      if (["%stage", "%extend-stage", "%redefine-stage"].includes(token.value) && next.kind === "name")
        found.push({ stage: next.value, kind: token.value });
      if (token.value === "%include" && next.kind === "string" && !next.value.includes("‹")) found.push({ include: next.value });
      if (token.value === "%names" && next.kind === "string" && !next.value.includes("‹")) found.push({ names: next.value });
    });
    return found;
  }

  // The pipeline's documents: those it includes before its first %stage,
  // and each stage with the documents included in it, at every place they are
  // included; and every document the scan reached, once. `textOf` gives a
  // document's Markdown, or undefined when it does not exist.
  function pipelineStages(path, textOf, directivesOf = () => undefined) {
    const scans = new Map();
    const scan = (documentPath, inherited) => {
      const key = JSON.stringify([documentPath, inherited]);
      if (!scans.has(key)) {
        const markdown = textOf(documentPath);
        const parsed = directivesOf(documentPath, inherited);
        const decoded = parsed?.flatMap(directive => {
          if (["stage", "extend-stage", "redefine-stage"].includes(directive.name)) return [{stage:directive.args[0], kind:"%"+directive.name}];
          return directive.name === "include" ? [{include:directive.args[0]}] : directive.name === "names" ? [{names:directive.args[0]}] : [];
        });
        const list = decoded ?? (markdown === undefined ? [] : directives(grammarText(markdown)));
        const names = [...new Set([...inherited, ...list.filter(item => item.names !== undefined).map(item => resolvePath(documentPath, item.names))])].sort((a,b) => {
          const left = [...a], right = [...b];
          for (let i = 0; i < Math.min(left.length, right.length); i++) {
            const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
            if (difference) return difference;
          }
          return left.length - right.length;
        });
        scans.set(key, {directives:list, names});
      }
      return scans.get(key);
    };
    const before = [];
    const stages = [];
    const named = new Map();
    let selected;
    const reached = new Set([path]);
    // Only the documents being included stop the scan, so that a document
    // included twice is listed twice, with what it includes. They are a
    // stack of frames, each with its directives and the next one to read,
    // since a chain of includes can be longer than the call stack is deep.
    // A set of their paths finds a cycle with one lookup.
    const frames = [{ path, ...scan(path, []), next: 0 }];
    const including = new Set([path]);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.next === frame.directives.length) {
        frames.pop();
        including.delete(frame.path);
        continue;
      }
      const directive = frame.directives[frame.next++];
      count("splice");
      if (directive.stage !== undefined) {
        if (directive.kind === "%stage") {
          selected = { name: directive.stage, documents: [] };
          stages.push(selected);
          named.set(directive.stage, selected);
        } else {
          selected = named.get(directive.stage);
          if (selected && directive.kind === "%redefine-stage") selected.documents = [];
        }
        continue;
      }
      if (directive.names !== undefined) continue;
      const target = resolvePath(frame.path, directive.include);
      (selected ? selected.documents : before).push(target);
      reached.add(target);
      if (including.has(target)) continue;
      including.add(target);
      frames.push({ path: target, ...scan(target, frame.names), next: 0 });
    }
    return { before, stages, documents: [...reached] };
  }

  // The mentions of grammar documents in a text, as the expression
  // /((?:[a-z0-9-]+\/)+[a-z0-9-]+\.md)(?::(\d+)(?::(\d+))?)?/g finds them,
  // each with its index, its whole text, its path, and its line and column
  // when given. The expression would try every start inside a long run of
  // names and slashes, and walk the run from each, so a scan finds each
  // run's one possible start instead.
  function documentMentions(text) {
    const found = [];
    const isNameCharacter = (c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-";
    // Each scan below counts each character before it reads it.
    const digitsAt = (i) => {
      let end = i;
      for (;;) {
        count("text");
        if (!(end < text.length && text[end] >= "0" && text[end] <= "9")) return end;
        end++;
      }
    };
    for (let i = 0; i < text.length;) {
      count("text");
      if (!isNameCharacter(text[i]) && text[i] !== "/") {
        i++;
        continue;
      }
      // A run of name characters and slashes, [i, end). A path within it
      // ends at its end, before ".md", and is a name, then names each after
      // one slash, with at least one slash. So it starts at the first name
      // character after any double slash and before the last slash.
      let end = i;
      let lastSlash = -1;
      let afterDouble = i;
      while (end < text.length && (isNameCharacter(text[end]) || text[end] === "/")) {
        count("text");
        if (text[end] === "/") {
          if (end > i && text[end - 1] === "/") afterDouble = end + 1;
          lastSlash = end;
        }
        end++;
      }
      let start = afterDouble;
      while (start < end && text[start] === "/") {
        count("text");
        start++;
      }
      if (!text.startsWith(".md", end) || text[end - 1] === "/" || lastSlash < start) {
        i = end;
        continue;
      }
      let stop = end + 3;
      let line;
      let column;
      if (text[stop] === ":" && digitsAt(stop + 1) > stop + 1) {
        const lineEnd = digitsAt(stop + 1);
        line = text.slice(stop + 1, lineEnd);
        stop = lineEnd;
        if (text[stop] === ":" && digitsAt(stop + 1) > stop + 1) {
          const columnEnd = digitsAt(stop + 1);
          column = text.slice(stop + 1, columnEnd);
          stop = columnEnd;
        }
      }
      found.push({ index: start, text: text.slice(start, stop), path: text.slice(start, end + 3), line, column });
      i = stop;
    }
    return found;
  }

  root.gencmuPipeline = { pipelineStages, resolvePath, documentMentions, hooks };
})(typeof self !== "undefined" ? self : this);
