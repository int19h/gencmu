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

  // The notation's tokens that matter here, as the notation reads them
  // (grammars/notation/lexical.md): keywords, names and strings, with spaces
  // and comments dropped. A comment runs from "(*" to the first "*)" after
  // it; a phoneme tag, one character between slashes, is one token, and so
  // is a character tag, between two quotes; and a string's escapes are
  // decoded, an escape the reader refuses giving no string. Anything else is
  // a token of its own that ends a directive.
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
      } else if (cs[i] === "'") {
        // A character tag or a property, the characters between two
        // quotes with a backslash escaping the next one, is one token. A
        // range is two of them joined by `..`, which is of no interest here.
        let end = i + 1;
        while (end < cs.length && cs[end] !== "'") end += cs[end] === "\\" ? 2 : 1;
        found.push({ kind: "character", value: cs.slice(i, end + 1).join("") });
        i = end + 1;
      } else if (cs[i] === "/" && cs[i + 2] === "/") {
        found.push({ kind: "phoneme", value: cs.slice(i, i + 3).join("") });
        i += 3;
      } else if (cs[i] === "\"") {
        let value = "";
        let valid = true;
        for (i++; i < cs.length && cs[i] !== "\""; i++) {
          if (cs[i] !== "\\") {
            value += cs[i];
            continue;
          }
          i++;
          const escape = /^u\{([0-9A-Fa-f]{1,6})\}/.exec(cs.slice(i, i + 9).join(""));
          if (cs[i] === "\\" || cs[i] === "\"") value += cs[i];
          else if (escape && parseInt(escape[1], 16) <= 0x10FFFF) {
            value += String.fromCodePoint(parseInt(escape[1], 16));
            i += escape[0].length - 1;
          } else valid = false;
        }
        i++;
        found.push(valid ? { kind: "string", value } : { kind: "other", value: "" });
      } else {
        const word = /^%?[A-Za-z][A-Za-z0-9-]*/.exec(cs.slice(i, i + 256).join(""));
        if (word) {
          found.push({ kind: word[0][0] === "%" ? "keyword" : "name", value: word[0] });
          i += word[0].length;
        } else {
          found.push({ kind: "other", value: cs[i] });
          i++;
        }
      }
    }
    return found;
  }

  // The stage selectors and %include directives of a grammar text, in order.
  function directives(text) {
    const found = [];
    const all = tokens(text);
    all.forEach((token, index) => {
      const next = all[index + 1];
      if (token.kind !== "keyword" || !next) return;
      if (["%stage", "%extend-stage", "%redefine-stage"].includes(token.value) && next.kind === "name")
        found.push({ stage: next.value, kind: token.value });
      if (token.value === "%include" && next.kind === "string") found.push({ include: next.value });
    });
    return found;
  }

  // The pipeline's documents: those it includes before its first %stage,
  // and each stage with the documents included in it, at every place they are
  // included; and every document the scan reached, once. `textOf` gives a
  // document's Markdown, or undefined when it does not exist.
  function pipelineStages(path, textOf) {
    const scans = new Map();
    const scan = (documentPath) => {
      if (!scans.has(documentPath)) {
        const markdown = textOf(documentPath);
        scans.set(documentPath, markdown === undefined ? [] : directives(grammarText(markdown)));
      }
      return scans.get(documentPath);
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
    const frames = [{ path, directives: scan(path), next: 0 }];
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
      const target = resolvePath(frame.path, directive.include);
      (selected ? selected.documents : before).push(target);
      reached.add(target);
      if (including.has(target)) continue;
      including.add(target);
      frames.push({ path: target, directives: scan(target), next: 0 });
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
