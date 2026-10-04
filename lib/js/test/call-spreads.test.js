// No call in the repository's JavaScript spreads an array into its
// arguments or hands one to `apply`. A call takes a bounded number of
// arguments, about 100,000 in V8, so a spread of a list that grows with a
// text, a grammar or a result throws a RangeError on a large input. A spread
// into an array literal or a parameter list has no such bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The places in a JavaScript source where a call spreads an argument or
 * calls `apply`, as line numbers. The scan skips comments, strings,
 * templates and regular expressions, and tells a call's parentheses from a
 * parameter list's by what follows them.
 * @param {string} source
 * @returns {number[]}
 */
function callSpreads(source) {
  const found = [];
  /** @type {{open: string, at: number, call: boolean}[]} */
  const stack = [];
  let previous = "";
  let word = "";
  const n = source.length;
  const lineOf = (at) => source.slice(0, at).split("\n").length;
  // The index after the `)` that closes the `(` at `at`, skipping nested
  // brackets only; a parameter list holds no string with a parenthesis in
  // this repository's sources, and a wrong guess only reports too much.
  const closing = (at) => {
    let depth = 0;
    for (let index = at; index < n; index++) {
      if (source[index] === "(") depth++;
      else if (source[index] === ")" && --depth === 0) return index + 1;
    }
    return n;
  };
  for (let index = 0; index < n;) {
    const c = source[index];
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end < 0 ? n : end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      index++;
      while (index < n && source[index] !== c) {
        if (source[index] === "\\") index++;
        else if (c === "`" && source.startsWith("${", index)) {
          let depth = 1;
          index += 2;
          while (index < n && depth > 0) {
            if (source[index] === "{") depth++;
            else if (source[index] === "}") depth--;
            index++;
          }
          continue;
        }
        index++;
      }
      index++;
      previous = c;
      word = "";
      continue;
    }
    if (c === "/" && (previous === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous) || word === "return")) {
      index++;
      let inClass = false;
      while (index < n) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        else if (source[index] === "/" && !inClass) break;
        index++;
      }
      index++;
      while (index < n && /[a-z]/i.test(source[index])) index++;
      previous = "/";
      word = "";
      continue;
    }
    if (/[\w$]/.test(c)) {
      let end = index;
      while (end < n && /[\w$]/.test(source[end])) end++;
      word = source.slice(index, end);
      if (word === "apply" && previous === "." && source[end] === "(") found.push(lineOf(index));
      previous = "w";
      index = end;
      continue;
    }
    if (c === "(") {
      // A parenthesis after a name, a `)` or a `]` opens a call's arguments,
      // unless what follows the group starts a function body.
      const after = source.slice(closing(index)).trimStart();
      const keyword = ["if", "while", "for", "switch", "catch", "function", "return", "typeof", "await", "yield"].includes(word);
      const call = (previous === "w" && !keyword) || previous === ")" || previous === "]";
      const parameters = after.startsWith("=>") || (after.startsWith("{") && previous === "w");
      stack.push({ open: c, at: index, call: call && !parameters });
    } else if (c === "[" || c === "{") {
      stack.push({ open: c, at: index, call: false });
    } else if (c === ")" || c === "]" || c === "}") {
      stack.pop();
    } else if (source.startsWith("...", index)) {
      const top = stack[stack.length - 1];
      if (top && top.open === "(" && top.call && (previous === "(" || previous === ",")) found.push(lineOf(index));
      index += 3;
      previous = ".";
      word = "";
      continue;
    }
    if (!/\s/.test(c)) {
      previous = c;
      word = "";
    }
    index++;
  }
  return found;
}

/** @type {(directory: string) => string[]} */
const sources = (directory) => fs.readdirSync(directory, { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile() && /\.(m?js)$/.test(entry.name) && !entry.parentPath.includes("node_modules"))
  .map((entry) => path.join(entry.parentPath, entry.name));

test("the scan finds a call's spread and apply, and nothing else", () => {
  assert.deepEqual(callSpreads("Math.max(...widths);\nf(a,\n  ...b);\ng.apply(null, list);"), [1, 3, 4]);
  assert.deepEqual(callSpreads("const f = (...rest) => rest;\nfunction g(...rest) { return [...rest]; }\nconst o = { ...p };"), []);
  assert.deepEqual(callSpreads('// f(...a)\nconst s = "f(...a)";\nconst r = /(...)/;\nconst t = `${h(x)}(...a)`;'), []);
  assert.deepEqual(callSpreads("class A { m(...rest) { return rest; } }\nif (a) (...b) => b;"), []);
});

test("no call in the libraries, the tools, the playground or dist spreads an argument", () => {
  const files = [
    ...sources(path.join(root, "lib/js/src")),
    path.join(root, "lib/js/cli.js"),
    ...sources(path.join(root, "lib/js/test")),
    ...sources(path.join(root, "tools")),
    ...sources(path.join(root, "playground")),
    path.join(root, "dist/gencmu.js"),
  ];
  const problems = [];
  for (const file of files) {
    for (const line of callSpreads(fs.readFileSync(file, "utf8"))) problems.push(`${path.relative(root, file)}:${line}`);
  }
  assert.deepEqual(problems, []);
});
