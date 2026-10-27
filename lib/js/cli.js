#!/usr/bin/env node
// The gencmu command line: parse texts, audit grammars, run test files.
// Run `node lib/js/cli.js help` for the commands.

import fs from "node:fs";
import path from "node:path";
import { caseOutcome, caseDifference } from "./src/cases.js";
import { traceProblem } from "./src/diagnostics.js";
import {
  loadPipeline, loadPipelineFile, bundledPipelines, bundledGrammarsDirectory,
  toBrackets, toTree, toJson, prettyJson, displayValue, resultJson,
  explainError, explainWarnings, tokenTable, audit, formatAudit, trace, formatTrace, stitchText, GencmuError,
} from "./src/node.js";

const HELP = `gencmu: a Lojban parser whose grammars are literate documents.

Usage:
  gencmu parse [options] [TEXT...]   parse TEXT, or standard input if none is given
  gencmu audit [options]             report unreachable rules, replaced and extended
                                     rules and stages, %erased clauses that change nothing, and
                                     where classifiers add and remove classes
  gencmu stitch [options]            print a pipeline's documents as one jbogenbau
                                     text, with every %include replaced by the
                                     rules and directives it names
  gencmu test FILE [options]         check a grammar's own corpus-format cases
                                     (tests/README.md): each text's result must
                                     match its case. It checks the cases, not
                                     the engine, and runs none of the engine's
                                     self-checks
  gencmu pipelines                   list the bundled pipelines
  gencmu features [options]          list a pipeline's features: each name, whether
                                     it is a gate or a warning, and whether the
                                     pipeline turns it on
  gencmu help                        show this

Options:
  --pipeline NAME        a bundled pipeline: lojban/cll (default), lojban/bpfk, lojban/experimental, lojban/zantufa, lojban/examples/kihei, gencmu/jbogenbau
  --pipeline-file FILE   a pipeline document on disk instead
  --feature NAME         turn a feature on; may be repeated
  --no-feature NAME      turn a feature off, one the pipeline turns on included;
                         may be repeated
  --until STAGE          stop after the named stage
  --format FORMAT        brackets (default), tree, json, canonical, or tokens
  --show-elided          show elided terminators in brackets (trees always
                         show them)
  --elision-only on|off  override the grammar's elision-only setting
  --trace STAGE:POS      show what STAGE's recognizer did at position POS of
                         its input (between tokens POS-1 and POS)

A parse prints the result on standard output and any tie, warning or error,
explained, on standard error. The exit status is 0 for an accepted text, 1 for a text the
pipeline does not accept, and 2 for a mistake in the command or a grammar.`;

/** @typedef {{command: string, words: string[], pipeline: string, pipelineFile?: string, features: string[], withoutFeatures: string[], until?: string, format: string, showElided: boolean, elisionOnly?: boolean, trace?: {stage: string, position: number}}} Command */

/**
 * @param {string[]} argv
 * @returns {Command}
 */
function parseArguments(argv) {
  /** @type {Command} */
  const command = { command: argv[0] || "help", words: [], pipeline: "lojban/cll", features: [], withoutFeatures: [], format: "brackets", showElided: false };
  const value = (/** @type {number} */ index, /** @type {string} */ flag) => {
    if (index >= argv.length) throw new GencmuError("usage", `${flag} needs a value`);
    return argv[index];
  };
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case "--pipeline": command.pipeline = value(++index, argument); break;
      case "--pipeline-file": command.pipelineFile = value(++index, argument); break;
      case "--feature": command.features.push(value(++index, argument)); break;
      case "--no-feature": command.withoutFeatures.push(value(++index, argument)); break;
      case "--until": command.until = value(++index, argument); break;
      case "--format": command.format = value(++index, argument); break;
      case "--show-elided": command.showElided = true; break;
      case "--elision-only": {
        const setting = value(++index, argument);
        if (setting !== "on" && setting !== "off") throw new GencmuError("usage", "--elision-only takes on or off");
        command.elisionOnly = setting === "on";
        break;
      }
      case "--trace": {
        const match = /^([a-z][A-Za-z0-9_-]*):(\d+)$/.exec(value(++index, argument));
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
function pipelineOf(command) {
  return command.pipelineFile ? loadPipelineFile(command.pipelineFile) : loadPipeline(command.pipeline);
}

/** @param {Command} command */
function parseCommand(command) {
  const text = command.words.length ? command.words.join(" ") : fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const pipeline = pipelineOf(command);
  const result = pipeline.parse(text, {
    features: command.features, withoutFeatures: command.withoutFeatures, until: command.until, elisionOnly: command.elisionOnly,
  });
  const warnings = explainWarnings(result);
  if (warnings) console.error(warnings);
  if (command.trace) {
    const problem = traceProblem(pipeline, result, command.trace.stage);
    if (problem) {
      console.error(problem);
      return exitStatus(result);
    }
    console.log(formatTrace(trace(pipeline, text, { ...command.trace, features: command.features, withoutFeatures: command.withoutFeatures })));
    if (result.error) console.error(explainError(result));
    return exitStatus(result);
  }
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
 * 0 for an accepted text, 1 for one the pipeline does not accept, 2 for a
 * defect of the grammar found while parsing.
 * @param {import("./src/types.js").ParseResult} result
 */
function exitStatus(result) {
  if (result.ok) return 0;
  return result.error && result.error.kind === "grammar" ? 2 : 1;
}

/** @param {Command} command */
function auditCommand(command) {
  console.log(formatAudit(audit(pipelineOf(command))));
  return 0;
}

/** @param {Command} command */
function stitchCommand(command) {
  process.stdout.write(stitchText(pipelineOf(command)));
  return 0;
}

/** @param {Command} command */
function testCommand(command) {
  if (command.words.length !== 1) throw new GencmuError("usage", "test takes one file of cases");
  const cases = fs.readFileSync(command.words[0], "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const pipelines = new Map();
  let failed = 0;
  for (const c of cases) {
    // A case without a pipeline runs in the pipeline of the command, if it
    // names one, which is cached apart from the bundled pipelines.
    const fromPipeline = Boolean(command.pipelineFile && !c.pipeline);
    const name = fromPipeline ? "" : c.pipeline || command.pipeline;
    if (!pipelines.has(name)) pipelines.set(name, (fromPipeline ? loadPipelineFile(command.pipelineFile) : loadPipeline(name)));
    const result = pipelines.get(name).parse(c.text, { features: c.features || command.features, withoutFeatures: c.withoutFeatures || command.withoutFeatures });
    // The cases are compared as the library's own corpus runner compares
    // them (src/cases.js). This checks the cases, not the engine: unlike
    // that runner, it does not run the engine's self-checks.
    const difference = caseDifference(c, caseOutcome(result));
    if (difference) {
      failed++;
      console.log(`${c.id || c.text}: ${difference}`);
    }
  }
  console.log(`${cases.length - failed} of ${cases.length} cases pass`);
  return failed ? 1 : 0;
}

function pipelinesCommand() {
  const directory = bundledGrammarsDirectory();
  for (const name of bundledPipelines()) {
    const file = path.join(name, "pipeline.md");
    const title = (fs.readFileSync(path.join(directory, file), "utf8").split("\n")[0] || "").replace(/^#\s*/, "").replace(/\s*<\?.*\?>\s*$/, "");
    console.log(`${name.padEnd(30)}${title}`);
  }
  return 0;
}

/** @param {Command} command */
function featuresCommand(command) {
  const features = pipelineOf(command).features;
  if (features.length === 0) console.log("(no features)");
  for (const feature of features) console.log(`${feature.name.padEnd(24)}${feature.kind.padEnd(9)}${feature.default ? "on" : "off"}`);
  return 0;
}

function main() {
  /** @type {Command | undefined} */
  let command;
  try {
    command = parseArguments(process.argv.slice(2));
    switch (command.command) {
      case "parse": return parseCommand(command);
      case "audit": return auditCommand(command);
      case "stitch": return stitchCommand(command);
      case "test": return testCommand(command);
      case "pipelines": return pipelinesCommand();
      case "features": return featuresCommand(command);
      case "help": case "--help": case "-h": console.log(HELP); return 0;
      default: throw new GencmuError("usage", `unknown command ${command.command}; try gencmu help`);
    }
  } catch (error) {
    if (error instanceof GencmuError || (error instanceof Error && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT")) {
      if (error instanceof GencmuError && error.code && ["json","canonical"].includes(command?.format ?? "")) {
        console.log(command.format === "canonical" ? JSON.stringify(error) : JSON.stringify(error,null,2));
      } else console.error(`gencmu: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

void resultJson;
process.exitCode = main();
