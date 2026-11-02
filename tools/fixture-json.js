// JSON text checks shared by the fixture checker.
/**
 * Number spellings that the shared fixture readers cannot all decode.
 * The text must be valid JSON. Strings, including embedded library inputs,
 * remain opaque. Rust's fixture reader requires signed 64-bit integers.
 * @param {string} json
 * @returns {string[]}
 */
export function numberProblems(json) {
  const found = [];
  const tokens = /"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gs;
  for (const match of json.matchAll(tokens)) {
    const number = match[1];
    if (number === undefined) continue;
    if (/[.eE]/.test(number)) found.push(`number ${number} needs an integer spelling at character ${match.index}`);
    else {
      const value = BigInt(number);
      if (value < -9223372036854775808n || value > 9223372036854775807n) {
        found.push(`number ${number} is outside the signed 64-bit range at character ${match.index}`);
      }
    }
  }
  return found;
}

/**
 * The member names that an object of a JSON text has twice, at any depth,
 * each as its path from the top, such as `at` or `error.kind`. The text
 * must be valid JSON. Two names are the same when their values are, so
 * `"a"` and `"\u0061"` are one name.
 * @param {string} json
 * @returns {string[]}
 */
export function duplicateMembers(json) {
  const found = [];
  /** @type {{object: boolean, path: string, names: Set<string>, name: string | null, expectName: boolean, index: number}[]} */
  const stack = [];
  const childPath = () => {
    const parent = stack[stack.length - 1];
    if (!parent) return "";
    const step = parent.object ? String(parent.name) : `[${parent.index}]`;
    return parent.path ? (parent.object ? `${parent.path}.${step}` : `${parent.path}${step}`) : step;
  };
  for (let at = 0; at < json.length; at++) {
    const char = json[at];
    if (char === '"') {
      let end = at + 1;
      while (json[end] !== '"') end += json[end] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.object && top.expectName) {
        const name = JSON.parse(json.slice(at, end + 1));
        if (top.names.has(name)) found.push(top.path ? `${top.path}.${name}` : name);
        top.names.add(name);
        top.name = name;
        top.expectName = false;
      }
      at = end;
    } else if (char === "{" || char === "[") {
      stack.push({ object: char === "{", path: childPath(), names: new Set(), name: null, expectName: char === "{", index: 0 });
    } else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack[stack.length - 1];
      if (top.object) top.expectName = true;
      else top.index++;
    }
  }
  return found;
}

/**
 * The strings of a JSON value, member names included, that are not
 * sequences of Unicode scalar values: those with a lone surrogate.
 * @param {unknown} value
 * @returns {string[]} each as JSON
 */
export function illFormedStrings(value) {
  const found = [];
  // The values still to visit, the next one last. An explicit stack, since
  // a JSON value can nest deeper than the call stack allows.
  /** @type {unknown[]} */
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string") {
      if (!item.isWellFormed()) found.push(JSON.stringify(item));
    } else if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index--) stack.push(item[index]);
    } else if (item && typeof item === "object") {
      const entries = Object.entries(item);
      for (let index = entries.length - 1; index >= 0; index--) stack.push(entries[index][1], entries[index][0]);
    }
  }
  return found;
}
