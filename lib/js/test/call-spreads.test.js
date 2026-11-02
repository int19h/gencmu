// No call in the repository's JavaScript spreads an array into its
// arguments or hands one to `apply`. A call takes a bounded number of
// arguments, about 100,000 in V8, so a spread of a list that grows with a
// text, a grammar or a result throws a RangeError on a large input. A spread
// into an array literal or a parameter list has no such bound.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { SyntaxKind } from "typescript/unstable/ast";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// One virtual source file keeps parsing independent of imports and types.
const scanRoot = path.join(root,".call-spread-scan");
const configPath = path.join(scanRoot,"tsconfig.json"), sourcePath = path.join(scanRoot,"source.js");
const virtual = createVirtualFileSystem({
  [configPath]: JSON.stringify({compilerOptions:{allowJs:true,noResolve:true,noLib:true,types:[],target:"esnext"},files:["source.js"]}),
  [sourcePath]: "",
});
const parser = new API({cwd:scanRoot,fs:virtual});
let opened = false;
after(()=>parser.close());

/**
 * The lines where a call spreads an argument or invokes `apply`.
 * The parser visits expressions inside templates and distinguishes calls
 * from declarations, rest parameters, strings and regular expressions.
 * @param {string} source
 * @returns {number[]}
 */
function callSpreads(source) {
  virtual.writeFile(sourcePath,source);
  const snapshot = parser.updateSnapshot(opened
    ? {fileChanges:{changed:[sourcePath]}} : {openProjects:[configPath]});
  opened = true;
  try {
    const program = snapshot.getProject(configPath).program;
    assert.deepEqual(program.getSyntacticDiagnostics(sourcePath),[],"the call guard requires valid JavaScript");
    const tree = program.getSourceFile(sourcePath);
    const found = [];
    const lineOf = node=>tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1;
    const pending = [tree];
    for (let node=pending.pop(); node!==undefined; node=pending.pop()) {
      let target;
      if (node.kind === SyntaxKind.CallExpression || node.kind === SyntaxKind.NewExpression) {
        for (const argument of node.arguments ?? []) {
          if (argument.kind === SyntaxKind.SpreadElement) found.push(lineOf(argument));
        }
        target = node.expression;
      } else if (node.kind === SyntaxKind.TaggedTemplateExpression) target = node.tag;
      while (target?.kind === SyntaxKind.ParenthesizedExpression) target = target.expression;
      if (target?.kind === SyntaxKind.PropertyAccessExpression && target.name.text === "apply") {
        found.push(lineOf(target.name));
      } else if (target?.kind === SyntaxKind.ElementAccessExpression) {
        const member = target.argumentExpression;
        if ((member.kind === SyntaxKind.StringLiteral || member.kind === SyntaxKind.NoSubstitutionTemplateLiteral) && member.text === "apply") {
          found.push(lineOf(member));
        }
      }
      node.forEachChild(child=>{pending.push(child);});
    }
    return found.sort((a,b)=>a-b);
  } finally {
    snapshot.dispose();
    parser.clearSourceFileCache();
  }
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

test("the parser finds executable calls in templates and optional chains", () => {
  for (const source of [
    "`${f(...items)}`;", "f.apply (null, items);", "f?.(...items);",
    "`${{nested: `${f(...items)}`}}`;", "f.apply /* arguments */ (null, items);",
    "f?.apply(null, items);", "f.apply?.(null, items);", 'f?.["apply"](null, items);',
    "f['apply'](null, items);", "f[`apply`](null, items);", "(f.apply)(null, items);",
    "f.apply`prefix ${items}`;", "new F(...items);", "class A extends B { constructor(items) { super(...items); } }",
  ]) assert.deepEqual(callSpreads(source),[1],source);
  assert.deepEqual(callSpreads("f.apply /* arguments */\n(null, items);\nf?.(\n  ...items);"),[1,4]);
  assert.deepEqual(callSpreads("const t = `f(...items) ${[...items]}`; const o = {apply(...args) {return args;}};"),[]);
});

test("the call guard refuses unparseable source", () => {
  assert.throws(()=>callSpreads("f(..."),/the call guard requires valid JavaScript/);
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
