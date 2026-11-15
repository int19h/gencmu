#!/usr/bin/env node
// Bundles the pinned CodeMirror 6 packages that the playground editor needs
// into one self-contained ES module at playground/vendor/codemirror.js, with
// the combined licence text beside it at playground/vendor/LICENSE.
//
//   node tools/vendor-editor.js [--check] [--basic-editor]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(thisFile), "..");
const libJsDir = path.join(root, "lib", "js");
const nodeModulesDir = path.join(libJsDir, "node_modules");
const vendorDir = path.join(root, "playground", "vendor");
const bundlePath = path.join(vendorDir, "codemirror.js");
const licensePath = path.join(vendorDir, "LICENSE");
const fullEditorPath = path.join(root, "playground", "editor-full.js");

export const PINNED_PACKAGES = Object.freeze({
  "@codemirror/commands": "6.11.1",
  "@codemirror/language": "6.13.1",
  "@codemirror/state": "6.7.6",
  "@codemirror/streamparser": "6.0.0",
  "@codemirror/view": "6.43.15",
  "@lezer/common": "1.5.5",
  "@lezer/highlight": "1.2.5",
  "@marijn/find-cluster-break": "1.0.4",
  "crelt": "1.0.7",
  "style-mod": "4.1.4",
  "w3c-keyname": "2.2.8",
});

const ENTRY_SOURCE = `
export {
  Compartment,
  EditorState,
  Facet,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
export {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  gutterLineClass,
  gutters,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumberMarkers,
  lineNumbers,
} from "@codemirror/view";
export {
  defaultKeymap,
  history,
  historyKeymap,
  standardKeymap,
} from "@codemirror/commands";
`;

function loadEsbuild() {
  try {
    const req = createRequire(path.join(libJsDir, "package.json"));
    return req("esbuild");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error("esbuild is not installed: run `npm ci` in lib/js");
    }
    throw error;
  }
}

function verifyPinnedPackages() {
  const licenses = [];
  for (const [pkg, expectedVersion] of Object.entries(PINNED_PACKAGES)) {
    const pkgDir = path.join(nodeModulesDir, pkg);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      throw new Error(`missing ${pkg} in lib/js/node_modules: run \`npm ci\` in lib/js`);
    }
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (pkgJson.version !== expectedVersion) {
      throw new Error(`expected ${pkg}@${expectedVersion}, found ${pkg}@${pkgJson.version}`);
    }
    const licenseFile = fs.readdirSync(pkgDir).find((name) => /^licen[cs]e/i.test(name));
    if (!licenseFile) {
      throw new Error(`missing licence file for ${pkg}`);
    }
    const licenseText = fs.readFileSync(path.join(pkgDir, licenseFile), "utf8").trim();
    licenses.push(`=== ${pkg}@${expectedVersion} (${pkgJson.license || "MIT"}) ===\n\n${licenseText}`);
  }
  return licenses.join("\n\n------------------------------------------------------------------------\n\n") + "\n";
}

function runEsbuild(esbuild, options) {
  try {
    return esbuild.buildSync(options);
  } catch (error) {
    if (!error || !/EACCES/.test(String(error.message))) throw error;
    const platPkg = `@esbuild/${process.platform}-${process.arch}`;
    const binSource = path.join(nodeModulesDir, platPkg, "bin", "esbuild");
    if (!fs.existsSync(binSource)) throw error;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-esbuild-"));
    const binCopy = path.join(tmpDir, "esbuild");
    const prevBinPath = process.env.ESBUILD_BINARY_PATH;
    try {
      fs.copyFileSync(binSource, binCopy);
      fs.chmodSync(binCopy, 0o755);
      process.env.ESBUILD_BINARY_PATH = binCopy;
      return esbuild.buildSync(options);
    } finally {
      if (prevBinPath === undefined) delete process.env.ESBUILD_BINARY_PATH;
      else process.env.ESBUILD_BINARY_PATH = prevBinPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

export function buildVendorArtifacts() {
  const combinedLicense = verifyPinnedPackages();
  const esbuild = loadEsbuild();
  const result = runEsbuild(esbuild, {
    stdin: {
      contents: ENTRY_SOURCE,
      resolveDir: libJsDir,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    minify: true,
    legalComments: "none",
    metafile: true,
    write: false,
  });

  for (const inputPath of Object.keys(result.metafile.inputs)) {
    if (inputPath === "<stdin>") continue;
    const rel = inputPath.replace(/^.*node_modules[\\/]/, "").replace(/\\/g, "/");
    const parts = rel.split("/");
    const pkgName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!Object.hasOwn(PINNED_PACKAGES, pkgName)) {
      throw new Error(`unpinned package ${pkgName} included in CodeMirror bundle (${inputPath})`);
    }
  }

  const versionList = Object.entries(PINNED_PACKAGES)
    .map(([name, ver]) => `${name}@${ver}`)
    .join(", ");
  const header = [
    "// Generated by tools/vendor-editor.js. Do not edit by hand.",
    `// Pinned packages: ${versionList}`,
    "// See ./LICENSE for the MIT licence notices of these packages.",
    "",
  ].join("\n");
  const code = Buffer.from(result.outputFiles[0].contents).toString("utf8");
  return {
    bundleText: header + code,
    licenseText: combinedLicense,
  };
}

export function syncVendorEditor({ checkMode = false, basicEditor = false } = {}) {
  const stale = [];
  if (basicEditor) {
    for (const [fullPath, label] of [
      [bundlePath, "playground/vendor/codemirror.js"],
      [licensePath, "playground/vendor/LICENSE"],
      [fullEditorPath, "playground/editor-full.js"],
    ]) {
      if (!fs.existsSync(fullPath)) continue;
      stale.push(label);
      if (!checkMode) fs.unlinkSync(fullPath);
    }
    if (!checkMode && fs.existsSync(vendorDir) && fs.readdirSync(vendorDir).length === 0) {
      fs.rmdirSync(vendorDir);
    }
    return stale;
  }

  const { bundleText, licenseText } = buildVendorArtifacts();
  const targets = [
    [bundlePath, bundleText, "playground/vendor/codemirror.js"],
    [licensePath, licenseText, "playground/vendor/LICENSE"],
  ];
  for (const [fullPath, nextText, label] of targets) {
    const current = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
    if (current === nextText) continue;
    stale.push(label);
    if (!checkMode) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, nextText);
    }
  }
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const check = process.argv.includes("--check");
  const basic = process.argv.includes("--basic-editor");
  const stale = syncVendorEditor({ checkMode: check, basicEditor: basic });
  if (check && stale.length) {
    console.error(`Out of date (run \`node tools/vendor-editor.js\`): ${stale.join(", ")}`);
    process.exit(1);
  }
}
