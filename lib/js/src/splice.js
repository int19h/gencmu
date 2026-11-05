// A pipeline: the items of a pipeline document, with each %include replaced
// by the items of the document it names, assigned to the selected stage
// (engine §13).

import { GencmuError, EmptyStageError } from "./errors.js";
import { extractGrammarText, resolvePath } from "./markdown.js";
import { compareCodePoints, stringName } from "./tags.js";
import { countWork, hooks } from "./testing.js";
import { NamesScope, selectedNames } from "./unicode-names.js";
import { DocumentStrings } from "./string-escapes.js";

/** @import { DomClassifier, DomConstant, DomDirective, DomImplication, DomRule, GrammarDom } from "./types.js" */

/**
 * An item of a document: a rule, a directive, a constant's definition, a
 * classifier or an implication.
 * @typedef {{rule: DomRule} | {directive: DomDirective} | {constant: DomConstant} | {classifier: DomClassifier}
 *   | {implication: DomImplication}} Item
 */

/**
 * One stage of a spliced pipeline: its name, where its %stage stands, and its
 * items as runs of consecutive items of one document, each with a DOM that
 * holds exactly those items.
 * @typedef {{name: string, at: {document: string, line: number, column: number}, documents: {path: string, dom: GrammarDom}[], changes: StageChange[]}} SplicedStage
 * @typedef {{kind: "extended" | "replaced", document: string, line: number, column: number}} StageChange
 */

/**
 * A document's rules, directives, constants, classifiers and implications
 * in the order they were written, which is the order of their positions
 * (engine §9).
 * @param {GrammarDom} dom
 * @returns {Item[]}
 */
function itemsInOrder(dom) {
  /** @type {Item[]} */
  const items = [...dom.rules.map((rule) => ({ rule })), ...dom.directives.map((directive) => ({ directive })),
    ...dom.constants.map((constant) => ({ constant })), ...dom.classifiers.map((classifier) => ({ classifier })),
    ...dom.implications.map((implication) => ({ implication }))];
  return items.sort((a, b) => itemAt(a)[0] - itemAt(b)[0] || itemAt(a)[1] - itemAt(b)[1]);
}

/**
 * Splices the pipeline document at `path`. `domOf` gives a document's DOM,
 * or undefined when the document does not exist.
 * @param {string} path
 * @param {(path: string, names:string[]) => GrammarDom | undefined} domOf
 * @returns {{stages: SplicedStage[], features: string[]}}
 */
export function splicePipeline(path, domOf) {
  /** @type {SplicedStage[]} */
  const stages = [];
  /** @type {string[]} */
  const features = [];
  // Sets beside the lists, so that a check of a name costs one lookup and
  // not a scan of all that came before it.
  const featureNames = new Set();
  /** @type {{stage: SplicedStage, run: {path:string, dom:GrammarDom}, directive: import("./types.js").DomDirective}[]} */
  const declarations = [];
  /** @type {Map<string, SplicedStage>} */
  const stageNames = new Map();
  /** @type {{path: string, dom: GrammarDom} | null} the run being built */
  let run = null;
  /** @type {SplicedStage | undefined} */
  let selected;

  try {
    for (const { frame, item } of walkIncludes(path, domOf)) {
      if (item === null) { run = null; continue; }
      const { path: documentPath, dom } = frame;
      const where = itemAt(item);
      const at = { document: documentPath, line: where[0], column: where[1] };
      if ("directive" in item && item.directive.name === "features" && !selected) {
        if (item.directive.conditions) throw new GencmuError("grammar", `global features cannot have conditions`, at);
        for (const name of item.directive.args) {
          if (hooks.work) countWork(hooks.work, "splice");
          if (featureNames.has(name)) continue;
          featureNames.add(name);
          features.push(name);
        }
      } else if ("directive" in item && item.directive.name === "stage") {
        const name = item.directive.args[0];
        const earlier = stageNames.get(name);
        if (earlier) {
          throw new GencmuError("grammar", `a second stage named ${name}; the first is at ${earlier.at.document}:${earlier.at.line}:${earlier.at.column}`, at);
        }
        /** @type {SplicedStage} */
        const stage = { name, at, documents: [], changes: [] };
        selected = stage;
        stages.push(stage);
        stageNames.set(name, stage);
        run = null;
      } else if ("directive" in item && ["extend-stage", "redefine-stage"].includes(item.directive.name)) {
        const name = item.directive.args[0];
        const next = stageNames.get(name);
        if (!next) throw new GencmuError("grammar", `%${item.directive.name} names an unknown stage ${name}`, at);
        selected = next;
        const replaced = item.directive.name === "redefine-stage";
        if (replaced) selected.documents = [];
        selected.changes.push({ kind: replaced ? "replaced" : "extended", ...at });
        run = null;
      } else {
        const stage = selected;
        if (!stage) {
          const what = "rule" in item ? `the rule ${item.rule.name}` : "constant" in item ? `the constant $${item.constant.name}`
            : "classifier" in item ? `the classifier ${item.classifier.name}` : "implication" in item ? "%implies" : `%${item.directive.name}`;
          throw new GencmuError("grammar", `${what} stands before the first %stage`, at);
        }
        if (run === null || run.path !== documentPath) {
          run = { path: documentPath, dom: { format: dom.format, rules: [], directives: [], constants: [], classifiers: [], implications: [] } };
          stage.documents.push(run);
        }
        if ("rule" in item) run.dom.rules.push(item.rule);
        else if ("constant" in item) run.dom.constants.push(item.constant);
        else if ("classifier" in item) run.dom.classifiers.push(item.classifier);
        else if ("implication" in item) run.dom.implications.push(item.implication);
        else {
          run.dom.directives.push(item.directive);
          if (item.directive.name === "features") declarations.push({stage, run, directive:item.directive});
        }
      }
    }
  } catch (error) {
    if (error instanceof GencmuError && selected) {
      throw new GencmuError(error.kind, error.description, {...error.where, stage:selected.name}, {cause:error.cause ?? error});
    }
    throw error;
  }
  if (stages.length === 0) throw new GencmuError("grammar", "a pipeline needs at least one %stage", { document: path });
  for (const stage of stages) {
    if (!stage.documents.some((document) => document.dom.rules.length > 0)) {
      throw new EmptyStageError("grammar", "has no rules", {...stage.at, stage:stage.name});
    }
  }
  const surviving = new Set(stages.flatMap(stage => stage.documents));
  const owners = new Map();
  for (const {stage, run, directive} of declarations) {
    if (!surviving.has(run)) continue;
    for (const name of directive.args) {
      const owner = owners.get(name);
      if (owner !== undefined && owner !== stage.name) {
        const [line,column] = directive.at;
        throw new GencmuError("grammar", `feature ${name} is local to both ${owner} and ${stage.name}`,
          {document:run.path,line,column,stage:stage.name});
      }
      owners.set(name,stage.name);
    }
  }
  return { stages, features: features.sort(compareCodePoints) };
}

/**
 * @typedef {{path:string, dom:GrammarDom, items:Item[], next:number, names:string[], inherited:string[]}} IncludeFrame
 */

/**
 * Walk includes with one explicit stack and one cycle guard. A null item
 * marks a document boundary, where a spliced run ends.
 * @param {string} path
 * @param {(path:string, names:string[])=>GrammarDom|undefined} domOf
 * @returns {Generator<{frame:IncludeFrame, item:Item|null, index:number}>}
 */
function* walkIncludes(path, domOf) {
  const top = domOf(path, []);
  if (top === undefined) throw new GencmuError("grammar", `${path} was not found`, {document:path});
  /** @type {IncludeFrame[]} */
  const frames = [{path, dom:top, items:itemsInOrder(top), next:0, names:selectedNames(path,top), inherited:[]}];
  const including = new Set([path]);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.next === frame.items.length) {
      frames.pop();
      including.delete(frame.path);
      yield {frame, item:null, index:frame.next};
      continue;
    }
    const index = frame.next++;
    const item = frame.items[index];
    if (hooks.work) countWork(hooks.work, "splice");
    if ("directive" in item && item.directive.name === "names") continue;
    if (!("directive" in item) || item.directive.name !== "include") {
      yield {frame, item, index};
      continue;
    }
    const [line,column] = itemAt(item);
    const at = {document:frame.path,line,column};
    let target;
    try { target = resolvePath(frame.path, item.directive.args[0]); }
    catch (error) {
      if (error instanceof GencmuError) throw new GencmuError("grammar", error.message, at);
      throw error;
    }
    const through = () => frames.map(open => open.path).join(" → ");
    if (including.has(target)) throw new GencmuError("grammar", `${target} includes itself (${through()} → ${target})`, at);
    let included;
    try { included = domOf(target, frame.names); }
    catch (error) {
      if (error instanceof GencmuError && error.where.line === undefined && error.cause instanceof Error) {
        throw new GencmuError(error.kind, `${error.where.document ?? target}: ${error.description}`, {...error.where, ...at}, {cause:error.cause});
      }
      throw error;
    }
    if (included === undefined) throw new GencmuError("grammar", `${target} was not found (${through()} → ${target})`, at);
    yield {frame, item:null, index};
    frames.push({path:target, dom:included, items:itemsInOrder(included), next:0, names:selectedNames(target,included,frame.names), inherited:frame.names});
    including.add(target);
  }
}

/**
 * A pipeline's documents as one jbogenbau text: its features in one %features,
 * then every item of the spliced stream but %include, %names and global
 * %features. Strings use their canonical spelling. Other source text stays
 * as written, with a comment naming each document run (docs/notation.md).
 * @param {{path: string, declared: string[], loader: import("./pipeline.js").Loader}} pipeline
 * @returns {string}
 */
export function stitchText(pipeline) {
  const { loader, declared: features } = pipeline;
  /** @type {string[]} */
  const out = features.length ? [`%features ${features.join(" ")}`, ""] : [];
  /** @type {string | undefined} */
  let selected;
  /** @type {string | null} */
  let last = null;
  /** @type {WeakMap<IncludeFrame, {chars:string[], index:Map<string,number>, strings:Map<number,{end:number,text:string}>}>} */
  const texts = new WeakMap();
  /** @type {Map<string,string>} */
  const sources = new Map();
  /** @param {string} path @param {string[]} inherited */
  const domOf = (path, inherited) => {
    const key = JSON.stringify([path,inherited]);
    const text = sources.get(key) ?? loader.read(path);
    if (text === undefined) return undefined;
    sources.set(key,text);
    return loader.documentDom(path,inherited,text);
  };
  /** @param {IncludeFrame} frame */
  const textOf = (frame) => {
    const {path:documentPath, items, inherited} = frame;
    const source = /** @type {string} */ (sources.get(JSON.stringify([documentPath,inherited])));
    const { text, positions } = extractGrammarText(source, documentPath, loader.unicode);
    const index = new Map(positions.map((position, i) => [`${position[0]}:${position[1]}`, i]));
    const chars = [...text];
    /** @type {Map<number,{end:number, text:string}>} */
    const strings = new Map();
    // Includes and names paths disappear from the export. Documents that
    // contain only those paths need no second lexical reading.
    const hasStrings = items.some((item, i) => {
      if ("directive" in item && ["include", "names"].includes(item.directive.name)) return false;
      const start = /** @type {number} */ (index.get(itemAt(item).join(":")));
      const end = i + 1 < items.length ? /** @type {number} */ (index.get(itemAt(items[i + 1]).join(":"))) : chars.length;
      return chars.slice(start, end).includes('"');
    });
    if (hasStrings) {
      const lexical = loader.notation.parse(text, {until:"lexical"});
      if (!lexical.ok) throw new GencmuError("grammar", "cannot read strings for textual stitching", {document:documentPath});
      const names = new NamesScope(key => loader.needNames(key), loader.unicode, inherited);
      const decoder = new DocumentStrings(documentPath, loader.unicode, names, offset => positions[offset] ?? [1,1]);
      const tokens = /** @type {import("./tokens.js").Token[]} */ (lexical.stages[0].output);
      decoder.inspect(tokens);
      for (const token of tokens) if (token.tags.has("String")) {
        strings.set(token.source[0], {end:token.source[1], text:stringName(decoder.decode(token), loader.unicode)});
      }
    }
    const made = {chars,index,strings};
    texts.set(frame,made);
    return made;
  };
  try {
    for (const {frame,item,index:i} of walkIncludes(pipeline.path,domOf)) {
      if (item === null) continue;
      const {path:documentPath,items} = frame;
      const {chars,index,strings} = texts.get(frame) ?? textOf(frame);
      const start = /** @type {number} */ (index.get(`${itemAt(item)[0]}:${itemAt(item)[1]}`));
      const end = i + 1 < items.length ? /** @type {number} */ (index.get(`${itemAt(items[i + 1])[0]}:${itemAt(items[i + 1])[1]}`)) : chars.length;
      if ("directive" in item && ["stage", "extend-stage", "redefine-stage"].includes(item.directive.name)) selected = item.directive.args[0];
      if ("directive" in item && item.directive.name === "features" && !selected) continue;
      if (last !== documentPath) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(`-- ${commentLabel(documentPath)}`);
        last = documentPath;
      }
      const pieces = [];
      for (let offset = start; offset < end;) {
        const string = strings.get(offset);
        if (string) {
          pieces.push(string.text);
          offset = string.end;
        } else pieces.push(chars[offset++]);
      }
      // trimEnd, since /\s+$/ tries each space of a long inner run in turn.
      out.push(pieces.join("").trimEnd());
    }
  } catch (error) {
    if (error instanceof GencmuError && selected) throw error.withLocation({stage:selected});
    throw error;
  }
  return out.join("\n") + "\n";
}

/**
 * A document's path in one line comment. Line breaks stay escaped.
 * @param {string} path
 * @returns {string}
 */
function commentLabel(path) {
  return JSON.stringify(path);
}

/**
 * @param {Item} item
 * @returns {[number, number]}
 */
function itemAt(item) {
  if ("rule" in item) return item.rule.at;
  if ("constant" in item) return item.constant.at;
  if ("classifier" in item) return item.classifier.at;
  if ("implication" in item) return item.implication.at;
  return item.directive.at;
}
