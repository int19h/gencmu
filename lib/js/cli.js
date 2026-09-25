#!/usr/bin/env node
// The gencmu command line: parse texts, audit grammars, run test files.
// Run `node lib/js/cli.js help` for the commands.

import fs from "node:fs";
import path from "node:path";
import {
  loadDialect, loadDialectFile, bundledGrammarsDirectory,
  toBrackets, toTree, toJson, prettyJson, displayValue, resultJson,
  explainError, explainTies, explainWarnings, tokenTable, audit, formatAudit, trace, formatTrace, GencmuError,
} from "./src/node.js";

const HELP = `gencmu: a Lojban parser whose grammars are literate documents.

Usage:
  gencmu parse [options] [TEXT...]   parse TEXT, or standard input if none is given
  gencmu audit [options]             report unreachable rules, replaced and extended
                                     rules, and %emits ε that changes nothing
  gencmu test FILE [options]         run corpus-format test cases (tests/README.md)
  gencmu dialects                    list the bundled dialects
  gencmu features [options]          list a dialect's features: each name, whether
                                     it is a gate or a warning, and whether the
                                     dialect turns it on
  gencmu help                        show this

Options:
  --dialect NAME         a bundled dialect: cll (default), bpfk, experimental, zantufa, notation
  --pipeline FILE        a pipeline document on disk instead
  --feature NAME         turn a feature on; may be repeated
  --no-feature NAME      turn a feature off, one the dialect turns on included;
                         may be repeated
  --until STAGE          stop after the named stage
  --format FORMAT        brackets (default), tree, json, canonical, or tokens
  --show-elided          show elided terminators in brackets and trees
  --elision-only on|off  override the grammar's elision-only setting
  --no-auto-features     do not add sa-su when a text needs it
  --trace STAGE:POS      show what STAGE's recognizer did at position POS of
                         its input (between tokens POS-1 and POS)

A parse prints the result on standard output and any tie, warning or error,
explained, on standard error. The exit status is 0 for an accepted text, 1 for a text the
dialect does not accept, and 2 for a mistake in the command or a grammar.`;

/** @typedef {{command: string, words: string[], dialect: string, pipeline?: string, features: string[], withoutFeatures: string[], until?: string, format: string, showElided: boolean, elisionOnly?: boolean, autoFeatures: boolean, trace?: {stage: string, position: number}}} Command */

/**
 * @param {string[]} argv
 * @returns {Command}
 */
function parseArguments(argv) {
  /** @type {Command} */
  const command = { command: argv[0] || "help", words: [], dialect: "cll", features: [], withoutFeatures: [], format: "brackets", showElided: false, autoFeatures: true };
  const value = (/** @type {number} */ index, /** @type {string} */ flag) => {
    if (index >= argv.length) throw new GencmuError("usage", `${flag} needs a value`);
    return argv[index];
  };
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case "--dialect": command.dialect = value(++index, argument); break;
      case "--pipeline": command.pipeline = value(++index, argument); break;
      case "--feature": command.features.push(value(++index, argument)); break;
      case "--no-feature": command.withoutFeatures.push(value(++index, argument)); break;
      case "--until": command.until = value(++index, argument); break;
      case "--format": command.format = value(++index, argument); break;
      case "--show-elided": command.showElided = true; break;
      case "--no-auto-features": command.autoFeatures = false; break;
      case "--elision-only": {
        const setting = value(++index, argument);
        if (setting !== "on" && setting !== "off") throw new GencmuError("usage", "--elision-only takes on or off");
        command.elisionOnly = setting === "on";
        break;
      }
      case "--trace": {
        const match = /^([A-Za-z][A-Za-z0-9-]*):(\d+)$/.exec(value(++index, argument));
        if (!match) throw new GencmuError("usage", "--trace takes STAGE:POSITION, such as words:3");
        command.trace = { stage: match[1], position: Number(match[2]) };
        break;
      }
      default:
        if (argument.startsWith("--")) throw new GencmuError("usage", `unknown option ${argument}`);
        command.words.push(argument);
    }
  }
  if (!["brackets", "tree", "json", "canonical", "tokens"].includes(command.format)) {
    throw new GencmuError("usage", `unknown format ${command.format}; use brackets, tree, json, canonical or tokens`);
  }
  return command;
}

/** @param {Command} command */
function dialectOf(command) {
  return command.pipeline ? loadDialectFile(command.pipeline) : loadDialect(command.dialect);
}

/** @param {Command} command */
function parseCommand(command) {
  const text = command.words.length ? command.words.join(" ") : fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const dialect = dialectOf(command);
  const result = dialect.parse(text, {
    features: command.features, withoutFeatures: command.withoutFeatures, until: command.until, elisionOnly: command.elisionOnly, autoFeatures: command.autoFeatures,
  });
  const warnings = explainWarnings(result);
  if (warnings) console.error(warnings);
  if (command.trace) {
    console.log(formatTrace(trace(dialect, text, { ...command.trace, features: command.features, withoutFeatures: command.withoutFeatures, autoFeatures: command.autoFeatures })));
    return exitStatus(result);
  }
  const ties = explainTies(result);
  if (ties) console.error(ties);
  if (command.format === "tokens") console.log(tokenTable(result));
  else if (command.format === "canonical") console.log(toJson(result));
  else if (result.tree) {
    if (command.format === "brackets") console.log(toBrackets(result, { showElided: command.showElided }));
    else if (command.format === "tree") console.log(toTree(result));
    else console.log(prettyJson(displayValue(result)));
  }
  if (result.error) console.error(explainError(result));
  return exitStatus(result);
}

/**
 * 0 for an accepted text, 1 for one the dialect does not accept, 2 for a
 * defect of the grammar found while parsing.
 * @param {import("./src/types.js").ParseResult} result
 */
function exitStatus(result) {
  if (result.ok) return 0;
  return result.error && result.error.kind === "grammar" ? 2 : 1;
}

/** @param {Command} command */
function auditCommand(command) {
  console.log(formatAudit(audit(dialectOf(command))));
  return 0;
}

/** @param {Command} command */
function testCommand(command) {
  if (command.words.length !== 1) throw new GencmuError("usage", "test takes one file of cases");
  const cases = fs.readFileSync(command.words[0], "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const dialects = new Map();
  let failed = 0;
  for (const c of cases) {
    const name = c.dialect || command.dialect;
    if (!dialects.has(name)) dialects.set(name, command.pipeline && !c.dialect ? loadDialectFile(command.pipeline) : loadDialect(name));
    const result = dialects.get(name).parse(c.text, { features: c.features || command.features, withoutFeatures: c.withoutFeatures || command.withoutFeatures });
    const got = { expect: result.ok ? "accept" : "reject" };
    if (result.ok) got.verdict = result.stages[result.stages.length - 1].verdict;
    else if (result.error) got.stage = result.error.stage;
    const ties = result.stages.filter((stage) => stage.verdict === "tie").map((stage) => stage.name);
    if (ties.length) got.ties = ties;
    const words = result.stages.find((stage) => stage.name === "words");
    if (words && words.output) got.words = words.output.map((token) => token.phonemes || token.text);
    if (result.ok) got.brackets = toBrackets(result);
    for (const key of ["expect", "verdict", "stage", "ties", "words", "brackets"]) {
      if (!(key in c) && !(key in got)) continue;
      if (JSON.stringify(c[key]) !== JSON.stringify(got[key])) {
        failed++;
        console.log(`${c.id || c.text}: ${key} expected ${JSON.stringify(c[key])}, got ${JSON.stringify(got[key])}`);
        break;
      }
    }
  }
  console.log(`${cases.length - failed} of ${cases.length} cases pass`);
  return failed ? 1 : 0;
}

function dialectsCommand() {
  const directory = path.join(bundledGrammarsDirectory(), "dialects");
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".md")).sort()) {
    const title = (fs.readFileSync(path.join(directory, file), "utf8").split("\n")[0] || "").replace(/^#\s*/, "").replace(/\s*<\?.*\?>\s*$/, "");
    console.log(`${file.slice(0, -3).padEnd(14)}${title}`);
  }
  return 0;
}

/** @param {Command} command */
function featuresCommand(command) {
  const features = dialectOf(command).features;
  if (features.length === 0) console.log("(no features)");
  for (const feature of features) console.log(`${feature.name.padEnd(24)}${feature.kind.padEnd(9)}${feature.default ? "on" : "off"}`);
  return 0;
}

function main() {
  try {
    const command = parseArguments(process.argv.slice(2));
    switch (command.command) {
      case "parse": return parseCommand(command);
      case "audit": return auditCommand(command);
      case "test": return testCommand(command);
      case "dialects": return dialectsCommand();
      case "features": return featuresCommand(command);
      case "help": case "--help": case "-h": console.log(HELP); return 0;
      default: throw new GencmuError("usage", `unknown command ${command.command}; try gencmu help`);
    }
  } catch (error) {
    if (error instanceof GencmuError || (error instanceof Error && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT")) {
      console.error(`gencmu: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

void resultJson;
process.exitCode = main();
