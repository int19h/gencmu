// The repository's files, as every tool under tools/ lists them. In a git
// checkout whose top level is the repository itself, they are the files
// that git tracks, so an untracked file, such as a reviewer's notes, is not
// one of them. Anywhere else, such as an exported tree, or one placed inside
// another checkout, they are every file under the repository, less hidden
// directories and those of tools and builds (node_modules, target).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Whether `root` is the top level of a git checkout of its own.
 * @param {string} root
 * @returns {boolean}
 */
export function ownCheckout(root) {
  try {
    const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return fs.realpathSync(top) === fs.realpathSync(root);
  } catch {
    return false;
  }
}

/**
 * The repository's files, relative to `root`, with `/` between parts,
 * sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function repositoryFiles(root) {
  if (ownCheckout(root)) {
    const listed = execFileSync("git", ["-C", root, "ls-files", "--cached", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 });
    // A file that the index lists and the work tree has deleted is not there.
    return listed.split("\0").filter((file) => file && fs.existsSync(path.join(root, file))).sort();
  }
  return walk(root).sort();
}

/**
 * The repository's Markdown documents, relative to `root`, sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function markdownFiles(root) {
  return repositoryFiles(root).filter((file) => file.endsWith(".md"));
}

/**
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
function walk(root, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(root, relative));
    else files.push(relative);
  }
  return files;
}
