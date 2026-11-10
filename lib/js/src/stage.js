import {chosenBoundaries,chosenBoundary} from "./chosen-boundaries.js";
import {ChosenChecks} from "./checks.js";
import {restorationForest} from './restoration-forest.js';
import {competitorRejections} from './competitor-rejection.js';
import {DiagnosticFlow,stageDiagnostics,emptyDiagnostics,joinDiagnostics,tiedDiagnostics} from "./diagnostic-flow.js";
import {Measures,recordDiagnostic,ZERO_MEASURE} from "./measures.js";
import {derivationIdentity} from "./tree-identities.js";
import { canCountProfiles, requiresElided } from './ranking-patterns.js';
import {emissionTargets} from "./boundary.js";
// Running one stage: recognition, the choice of a parse, the result tree
// (engine §12), emission (engine §11) and elision-only (engine §7).

import { GencmuError, runtimeGrammarError } from "./errors.js";
import {restoreTokens} from "./restoration.js";
import { retainStageChart, ParseContext, workingStructure, structuralRead, terminalObservation, recognize, rootItems, rejectionOf, evaluate, settled, asSet, writtenSymbol } from "./earley.js";
import { Ranker, derivationTree, ropeOf, firstDifference } from "./rank.js";
import {RankedAdmission} from "./ranked-admission.js";
import { walkWitness } from "./witness.js";
import { Token, Sources, attached, hasAttachments } from "./tokens.js";
import { tagSet } from "./tags.js";
import { StringWalk, capturedNode } from "./strings.js";
import { foldTree } from "./walk.js";
import { countWork, fault, hooks } from "./testing.js";

/**
 * @import { Action, Derivation, DerivationRule, ElidedNode, EmitItem, ResultNode, Scope, Span, StageReport, TagSet } from "./types.js"
 * @import { Grammar } from "./grammar.js"
 * @import { UnicodeTable } from "./unicode.js"
 */

/**
 * The options of one stage's run.
 * @typedef {object} StageOptions
 * @property {Set<string>} features
 * @property {boolean | null | undefined} elisionOnly
 * @property {number} [stageOrder]
 * @property {boolean} [pendingErrors]
 */

/** @param {import("./earley.js").Chart} chart @param {Token[]} tokens @param {import("./types.js").KeyStep[]} steps @param {import("./types.js").Lean} lean @param {number[] | null} [project] */
function slotRanker(chart, tokens, steps, lean, project = null) {
  const ranker = new Ranker(tokens, steps, lean, project);
  ranker.erasures.closes=chart.context.closes;
  ranker.restorationForest=restorationForest(chart);
  if(ranker.restorationForest)chart=ranker.restorationForest.chart;
  ranker.profiles ||= canCountProfiles(chart.context.lowered) && !(chart.context.mode === "reconstruction" && !chart.context.lowered.productions.some(p=>p.error) && steps.every(step=>requiresElided(step.pattern)));
  ranker.configured = true;
  ranker.interner = chart.context.interner;
  ranker.space.interner = chart.context.interner;
  ranker.space.tokens = chart.context.recon && !chart.context.recon.raw ? chart.context.recon.observed.tokens : tokens;
  if (chart.context.lowered.ranked?.groups.length) ranker.admission = new RankedAdmission(chart,chart.context.lowered.ranked);
  return ranker;
}

export class Stage {
  /**
   * @param {string} name
   * @param {Grammar} grammar
   * @param {import("./splice.js").StageChange[]} [stageChanges]
   */
  constructor(name, grammar, stageChanges = []) {
    this.name = name;
    this.grammar = grammar;
    this.stageChanges = stageChanges;
  }

  /**
   * Runs the stage over `tokens`.
   * @param {Token[]} tokens
   * @param {string[]} sourceText the original text as an array of code points
   * @param {UnicodeTable} unicode
   * @param {StageOptions} options
   * @returns {StageReport}
   */
  run(tokens, sourceText, unicode, options) {
    const features = options.features;
    /** @type {StageReport} */
    const report = { name: this.name, verdict: null, witness: null, output: null, tree: null, error: null,errors:[],warnings:[] };
    let lowered;
    let context;
    let chart;
    let roots;
    try {
      // Lowering for these features may itself find an error of the grammar
      // (engine §3), which is a result like any found while parsing.
      lowered = this.grammar.lower(features);
      context = new ParseContext(lowered, tokens, sourceText, unicode);
      chart = recognize(context, "text", 0, tokens.length);
      retainStageChart(context,chart);
      roots = rootItems(chart, "text");
    } catch (error) {
      if (error instanceof GencmuError) {
        report.error = runtimeGrammarError(error.withLocation({stage:undefined}),this.name);
        return report;
      }
      throw error;
    }
    // An input whose every derivation is cyclic (engine §4) has none to
    // count, and is rejected like one with no item of `text` at all.
    const resolution = lowered.resolution;
    const ranking = roots.length === 0 ? null : slotRanker(chart, tokens, resolution.steps, resolution.lean).rank(roots);
    if (ranking === null) {
      const rejection = rejectionOf(chart);
      report.error = {
        kind: "rejected",
        stage: this.name,
        token: rejection.position,
        source: sourceAt(tokens, rejection.position),
        expected: rejection.expected,
        ...(rejection.boundary ? {boundary:rejection.boundary} : {}),
        message: `the ${this.name} stage could not continue at token ${rejection.position}` +
          (rejection.expected.length ? `; expected ${rejection.expected.map((e) => e.terminal).join(", ")}` : ""),
      };
      return report;
    }
    if (ranking.verdict === "tie") {
      const derivations=[ranking.first,/** @type {import("./types.js").Rope} */(ranking.second)].map(derivationTree);
      const flows=derivations.map(root=>new DiagnosticFlow(root,tokens));
      Object.assign(report,{verdict:"tie",witness:witnessOf(/** @type {[Action|null,Action|null]} */(ranking.witness))});
      try{
        for(const flow of flows)evaluateDiagnostics(flow,context,features,this.name,options.stageOrder);
      }catch(error){
        if(!(error instanceof GencmuError))throw error;
        stageDiagnostics.set(report,{collected:emptyDiagnostics(),evaluated:joinDiagnostics(flows.map(flow=>flow.messages()))});
        report.error=runtimeGrammarError(error.withLocation({stage:undefined}),this.name);return report;
      }
      for(const flow of flows)competitorRejections(flow,chart);
      stageDiagnostics.set(report,{collected:tiedDiagnostics(flows[0].events(),flows[1].events()),evaluated:joinDiagnostics(flows.map(flow=>flow.messages()))});
      report.error={kind:"ambiguous",stage:this.name,reason:"tie",readings:derivations.map(root=>resultTree(root,context)[0]),message:`the ${this.name} stage's text has two best readings, a tie`};
      return report;
    }
    Object.assign(report,{verdict:ranking.verdict,witness:null});
    const derivation=derivationTree(ranking.first),flow=new DiagnosticFlow(derivation,tokens);
    report.tree=resultTree(derivation,context)[0];
    try{evaluateDiagnostics(flow,context,features,this.name,options.stageOrder);}
    catch(error){
      if(!(error instanceof GencmuError))throw error;
      stageDiagnostics.set(report,{collected:emptyDiagnostics(),evaluated:flow.messages()});
      report.tree=null;report.error=runtimeGrammarError(error.withLocation({stage:undefined}),this.name);return report;
    }
    competitorRejections(flow,chart);
    const diagnosticData={collected:flow.collected(),evaluated:flow.messages()};
    stageDiagnostics.set(report,diagnosticData);
    try{
      report.output=emit(derivation,context,flow);
      const unowned=flow.assign();report.errors=unowned.errors;report.warnings=unowned.warnings;
    }catch(error){
      if(!(error instanceof GencmuError))throw error;
      report.output=null;report.error=runtimeGrammarError(error.withLocation({stage:undefined}),this.name);return report;
    }
    const elisionOnly = options.elisionOnly === undefined || options.elisionOnly === null
      ? lowered.resolution.elisionOnly : options.elisionOnly;
    if (elisionOnly && !options.pendingErrors && !diagnosticData.collected.errors.length && (report.verdict === "resolved" ||
        report.verdict === "unique" && hasElided(report.tree))) {
      /** @type {ElisionCheck} */
      let check;
      try {
        check = this.elisionCheck(derivation, report.tree, context, features);
      } catch (error) {
        // An error of the grammar in the check ends the stage as one found
        // while emitting does: no output, the rest kept (engine §7.7).
        if (error instanceof GencmuError) {
          // A fault loses the error (F26:lost), and another reports it as
          // a lost witness (F26:relabel).
          if (fault("F26:lost")) return report;
          report.output = null;
          report.error = fault("F26:relabel")
            ? {
              kind: "grammar",
              stage: this.name,
              code: "elision-witness-lost",
              message: `the ${this.name} stage could not reconstruct its chosen derivation for elision-only`,
              chosen: report.tree,
              completion: [],
            }
            : runtimeGrammarError(error.withLocation({stage:undefined}),this.name);
          return report;
        }
        throw error;
      }
      if (check.competitorWarnings){
        for(const warning of check.competitorWarnings)diagnosticData.collected.warnings.push(warning);
      }
      if (check.kind === "lost") {
        // The witness of the chosen derivation is lost: a defect of the
        // engine, which ends the stage with no output (engine §7.9).
        report.output = null;
        report.error = {
          kind: "grammar",
          stage: this.name,
          code: "elision-witness-lost",
          message: `the ${this.name} stage could not reconstruct its chosen derivation for elision-only`,
          chosen: report.tree,
          completion: check.completion,
        };
      } else if (check.kind === "ambiguous") {
        report.error = {
          kind: "ambiguous",
          stage: this.name,
          reason: "elision-only",
          readings: check.readings,
          ...(check.witness ? { witness: check.witness } : {}),
          message: `the ${this.name} stage's text is ambiguous with every elided terminator written out`,
        };
      }
    }
    return report;
  }

  /**
   * Engine §7: the check of elision-only. It writes the chosen derivation's
   * elided terminators back into the stage's input as synthetic tokens and
   * recognizes that input, R, with the main lowering in the reconstruction
   * mode. Every observation reads the stage's input through the projection
   * π. Raw absence of the chosen witness gives witness loss. An admitted
   * witness that is solely best keeps the main result. Any other best
   * competitor gives an elision-only ambiguity.
   * @param {Derivation} chosen D, the chosen derivation
   * @param {ResultNode} tree D's tree
   * @param {ParseContext} main the context of the main parse, whose memo
   *   the check's queries share
   * @param {Set<string>} features
   * @returns {ElisionCheck}
   */
  elisionCheck(chosen, tree, main, features) {
    const tokens = main.tokens;
    const lowered = main.lowered;
    // The old contract, as a whole (a fault, F13): every elidable optional
    // mandatory, observations of R itself, and no reading a pass.
    const old = fault("F13");
    /** @type {ElidedNode[]} */
    const elided = [];
    // In text order: the leaves left to right (engine §7.2).
    const pending = [tree];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.kind === "elided") elided.push(node);
      if (node.kind === "rule") for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
    /** @type {RestorationRecord[]} */
    const records = elided.map((node) => {
      /** @type {RestorationRecord} */
      const record = { terminal: node.terminal, at: node.span[0], source: [node.source[0], node.source[1]] };
      if (node.value !== undefined) record.value = node.value;
      return record;
    });
    // The order of insertion: the records' own, or, under a fault, each run
    // at one position reversed (F27).
    let order = records.map((_, index) => index);
    if (fault("F27:order")) {
      order = [];
      for (let index = 0; index < records.length;) {
        let end = index;
        while (end < records.length && records[end].at === records[index].at) end++;
        for (let at = end - 1; at >= index; at--) order.push(at);
        index = end;
      }
    }
    const {restored,synthetic,originalAt,recordAt,recordOf,project} = restoreTokens(tokens,records,order,fault("F12"));
    const r = new ParseContext(lowered, restored, main.sourceText, main.unicode, main.interner);
    r.closes = main.closes;
    r.mode = old ? "mandatory" : "reconstruction";
    r.synthetic = synthetic;
    r.recon = { observed: main, project, raw: old, faulty: new Map() };
    // The recognition of R is not a query (engine §4, §7.6), unless a fault
    // makes it one (F18).
    const active = "parse\u0001text\u00010\u0001" + tokens.length;
    const asQuery = (old || fault("F18")) && !main.inProgress.has(active);
    if (asQuery) main.inProgress.add(active);
    let chart;
    main.checking = true;
    try {
      chart = recognize(r, "text", 0, restored.length);
    } finally {
      main.checking = false;
      if (asQuery) main.inProgress.delete(active);
    }
    let roots = rootItems(chart, "text");
    if (fault("lost:roots")) roots = [];
    // Runtime tracking marks W(D)'s edges before the check ranks.
    // An optional test hook observes the witness (tests/README.md).
    const run = { chosen, chart, roots, synthetic, originalAt, recordAt };
    const walk = walkWitness(run);
    const watch = hooks.elisionCheck ? hooks.elisionCheck(run) : null;
    if (!roots.length || !walk) {
      if (watch) watch.ranked({ranking:null,counted:false});
      return old ? {kind:"pass"} : {kind:"lost",completion:records};
    }
    // The check's ranker: every key step, no lean, and
    // cycles over spans of R (engine §7.7).
    const steps = lowered.resolution.steps;
    const ranker = slotRanker(chart, restored, steps, "none", fault("F19") ? project : null);
    ranker.profileProject = project;
    ranker.measures.original={measures:new Measures(tokens,main.sources),project};
    ranker.check = true;
    ranker.marks = walk.marks;
    // Concrete membership uses the raw chart, before the ranking view (§7.10).
    const raw = new Ranker(restored, steps, "none", fault("F19") ? project : null);
    raw.configured=true;raw.interner=chart.context.interner;
    raw.measures.original=ranker.measures.original;
    raw.check=true;raw.marks=walk.marks;raw.groupRules(roots);
    const rawCounted=roots.some(item=>raw.countOf(item).member);
    let ranking=ranker.rank(roots);
    if(ranking)ranking.rawWitnessCounted=rawCounted;
    if (fault("lost:count") || !rawCounted) ranking = null;
    if (fault("F23")) {
      // A fault leaves the main grammar in the mode of the check.
      for (const [name, productions] of lowered.byLhs) {
        lowered.byLhs.set(name, productions.filter((production) => !(production.rhs.length === 0 && production.helper && production.elided !== null)));
      }
    }
    if (ranking === null) {
      if (watch) watch.ranked({ ranking: null, counted: false });
      return old ? { kind: "pass" } : { kind: "lost", completion: records };
    }
    const profileOrder = ranker.profiles ? ranker.space.compare(ranking.profile, ranker.space.derivationProfile(chosen, tokens)) : 0;
    const excluded = ranking.witnessCounted !== true;
    const representative=excluded?null:ranker.witnessRepresentative(walk.proof);
    if(!excluded&&!representative)throw new Error("An admitted witness requires its class representative.");
    const restoredWitness = representative??ropeOf(walk.sequence);
    const better = excluded || profileOrder < 0;
    // Observe candidate selection before arranging the diagnostic pair.
    const selectedRanking = ranking;
    if (better || ranking.verdict === "tie") {
      const first = ranking.first;
      const competitor = firstDifference(restoredWitness, first, false) !== null ? first :
        ranker.firstCompetitor(restoredWitness)??(fault("F17","diagnostic")?ranking.second:null);
      if (!competitor) throw new Error("Reconstruction requires a distinct best admitted competitor.");
      let difference = firstDifference(restoredWitness, competitor, true);
      if (!difference?.left || !difference.right) difference = firstDifference(restoredWitness, competitor, false);
      ranking = { ...ranking, second: competitor, first: restoredWitness,
        witness: difference ? [difference.left, difference.right] : null };
    }
    if (watch) watch.ranked({ ranking: better || ranker.admission ? ranking : selectedRanking, counted: rawCounted,representative });
    if (!better && ranking.verdict !== "tie") return { kind: "pass" };
    // The readings, mapped to the stage's input (engine §7.10).
    const original = new Sources(tokens);
    /** @type {Map<string, TagSet>} */
    const chosenTags = new Map();
    if (fault("F8")) {
      foldTree(tree, () => null, (node) => {
        chosenTags.set(`${node.rule}\u0000${node.span[0]}\u0000${node.span[1]}`, node.tags);
        return null;
      });
    }
    /** @type {(root: ResultNode) => ResultNode} */
    const remap = (root) => foldTree(root,
      /** @returns {ResultNode} */
      (node) => {
        if (node.kind === "token" && synthetic[node.token]) {
          // A read of a synthetic token is an elided node of its record's
          // terminal, at the record's position, with the record's source.
          const at = project[node.token];
          const index = recordOf[node.token];
          if (fault("F27:bare")) return { kind: "token", terminal: node.terminal, token: at, span: [at, at + 1], source: node.source };
          if (index === undefined) return { kind: "elided", terminal: node.terminal, span: [at, at], source: node.source };
          const record = records[index];
          /** @type {ElidedNode} */
          const result = { kind: "elided", terminal: record.terminal, span: [at, at], source: [record.source[0], record.source[1]] };
          if (record.value !== undefined) result.value = record.value;
          return result;
        }
        if (node.kind === "token") return { ...node, token: project[node.token], span: [project[node.span[0]], project[node.span[0]] + 1] };
        return node;
      },
      /** @returns {ResultNode} */
      (node, children) => {
        const start = project[node.span[0]];
        const end = project[node.span[1]];
        const tags = chosenTags.get(`${node.rule}\u0000${start}\u0000${end}`) || node.tags;
        return { ...node, span: [start, end], source: sourceOf(original, start, end), tags, children };
      });
    const ropes = [ranking.first, /** @type {import("./types.js").Rope} */ (ranking.second)];
    // The witness, mapped to the stage's input as the readings are
    // (engine §7.10).
    /** @type {(action: Action | null) => import("./types.js").WitnessAction} */
    const mapAction = (action) => {
      // Neither action is ever missing (engine §6, §7.10).
      if (action === null) throw new Error("the witness of the check of elision-only lacks an action");
      // A fault leaves the witness over R: a read keeps its index in R, and
      // a close its span there (witness:project).
      if (fault("witness:project")) {
        if (action.kind === "read") return { kind: "read", token: action.token, terminal: action.terminal };
        const { production, origin, end } = action.item;
        return { kind: "close", rule: production.owner, production: production.sourceId ?? production.id, helper: production.helper, span: [origin, end] };
      }
      if (action.kind === "read") {
        return synthetic[action.token]
          ? { kind: "elided", at: project[action.token], terminal: action.terminal }
          : { kind: "read", token: project[action.token], terminal: action.terminal };
      }
      const { production, origin, end } = action.item;
      return { kind: "close", rule: production.owner, production: production.sourceId ?? production.id, helper: production.helper, span: [project[origin], project[end]] };
    };
    const witness = /** @type {[Action | null, Action | null]} */ (ranking.witness);
    /** @type {ElisionCheck} */
    const result = {
      kind: "ambiguous",
      readings: ropes.map((rope, index) => excluded && index === 0 ? tree : remap(resultTree(derivationTree(rope), r)[0])),
      // F17 counts duplicated items as a false tie between identical
      // derivations. There is no differing action in that injected state.
      // Return its malformed result for the shared case to reject.
      witness: ranking.witness === null && fault("F17", "diagnostic")
        ? undefined : [mapAction(witness[0]), mapAction(witness[1])],
    };
    // A competing reading gives no warning (engine §7.10), unless a fault
    // takes its warnings (F22).
    if (fault("F22")) result.competitorWarnings = reportsOf(derivationTree(ropes[1]), r, features, this.name).warnings;
    return result;
  }
}

/**
 * A restoration record (engine §7.2): the terminal, its position in the
 * stage's input, the empty source of its elided node, and the saved value
 * of a terminator with an `=` test.
 * @typedef {{terminal: string, at: number, source: Span, value?: string}} RestorationRecord
 */

/**
 * What the check of engine §7 found: a pass, ambiguity, or witness loss.
 * @typedef {({kind: "pass"} | {kind: "ambiguous", readings: ResultNode[], witness?: import("./types.js").Witness} | {kind: "lost", completion: RestorationRecord[]})
 *   & {competitorWarnings?: import("./types.js").ParseWarning[]}} ElisionCheck
 */

/**
 * @param {Token[]} tokens
 * @param {number} position
 * @returns {Span}
 */
function sourceAt(tokens, position) {
  if (position < tokens.length) return [tokens[position].source[0], tokens[position].source[1]];
  const end = tokens.length ? tokens[tokens.length - 1].source[1] : 0;
  return [end, end];
}

// Where an empty span at token index `at` lies in the source.
/**
 * @param {Token[]} tokens
 * @param {number} at
 * @returns {number}
 */
function emptySource(tokens, at) {
  if (at > 0) return tokens[at - 1].source[1];
  return tokens.length ? tokens[0].source[0] : 0;
}

// The source of tokens [start, end): the source of the tokens (engine §1),
// or, for an empty span, the point where it lies (engine §12).
/**
 * @param {Sources} sources
 * @param {number} start
 * @param {number} end
 * @returns {Span}
 */
function sourceOf(sources, start, end) {
  if (start >= end) {
    const position = emptySource(sources.tokens, start);
    return [position, position];
  }
  return sources.of(start, end);
}

/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {TagSet}
 */
function nodeTags(node, context) {
  if ("read" in node) return context.tokens[node.read.token].tags;
  return context.interner.get(node.item.tagId);
}

/**
 * Reports follow the chosen derivation before spliced nodes disappear.
 * Suppression covers its own occurrence and every descendant.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @param {Set<string>} features
 * @param {string} stage
 * @returns {{errors:import("./types.js").ParseWarning[],warnings:import("./types.js").ParseWarning[]}}
 */
function reportsOf(root, context, features, stage) {
  const flow=new DiagnosticFlow(root,context.tokens);
  evaluateDiagnostics(flow,context,features,stage);
  return flow.collected();
}

/**
 * Evaluate own messages before erasure and preserve a prefix on failure (§12.1).
 * @param {DiagnosticFlow} flow @param {ParseContext} context
 * @param {Set<string>} features @param {string} stage @param {number} [stageOrder]
 */
export function evaluateDiagnostics(flow,context,features,stage,stageOrder=0){
  const strings=new StringWalk(context,node=>new TreeScope(node,context),false);
  const measures=new Measures(context.tokens,context.sources),scope={};
  const enabled=context.lowered.checks.filter(check=>check.error||features.has(check.name));
  const checks=context.mode===null && enabled.length ? new ChosenChecks(flow,context,features,enabled) : null;
  const occurrences=new Map();
  let ordinal=0;
  const stack=[{node:flow.root,suppressed:new Set()}];
  while(stack.length){
    const {node,suppressed:inherited}=/** @type {NonNullable<ReturnType<typeof stack.pop>>} */(stack.pop());
    const production='read' in node?null:node.production;
    const suppressed=production?.suppressWarnings?.length?new Set([...inherited,...production.suppressWarnings]):inherited;
    if(!('read' in node) && production && (production.error||production.warning)){
      const occurrence=ordinal++,code=production.spliceOf??production.lhs;
      const recipe=production.error??(features.has(code)&&!suppressed.has('_')&&!suppressed.has(code)?production.warning:undefined);
      if(recipe){
        hooks.diagnosticMessage?.(node,recipe);
        const diagnostic={stage,code,rule:code,span:/** @type {Span} */([node.start,node.end]),source:sourceOf(context.sources,node.start,node.end),message:strings.item(node,recipe,recipe)};
        recordDiagnostic(diagnostic,production.error?measures.own(node.start,node.end):ZERO_MEASURE,{scope,stageOrder,ordinal:occurrence,rule:code});
        flow.add(node,diagnostic,production.error?'errors':'warnings');
      }
    }
    if(checks)for(const {check,message} of checks.at(node,suppressed)) {
      const occurrence=occurrences.get(check.name)??0;occurrences.set(check.name,occurrence+1);
      const diagnostic={stage,code:check.name,rule:check.name,span:/** @type {Span} */([node.start,node.end]),source:sourceOf(context.sources,node.start,node.end),message};
      recordDiagnostic(diagnostic,check.error?measures.own(node.start,node.end):ZERO_MEASURE,{scope,stageOrder,ordinal:ordinal++,rule:check.name,check:check.name,occurrence});
      flow.add(node,diagnostic,check.error?'errors':'warnings',true);
    }
    if(!('read' in node))for(let index=node.children.length-1;index>=0;index--)stack.push({node:node.children[index],suppressed});
  }
}

/**
 * The result tree of a derivation (engine §12), as a list: a spliced node
 * yields its children. The walk keeps its own stack, since a right-recursive
 * rule over a long text, such as paragraphs joined by `ni'o`, nests as deep
 * as the text is long.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {ResultNode[]}
 */
function resultTree(root, context) {
  /** @type {ResultNode[]} */
  const result = [];
  /** @type {{node: Derivation, into: ResultNode[]}[]} */
  const stack = [{node:root, into:result}];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const {node} = frame;
    let {into} = frame;
    if ("read" in node) {
      into.push({ kind: "token", terminal: node.read.terminal, token: node.read.token, span: [node.start, node.end], source: sourceOf(context.sources, node.start, node.end) });
      continue;
    }
    const production = node.production;
    if (production.helper && production.elided && node.children.length === 0) {
      const position = emptySource(context.tokens, node.start);
      /** @type {ElidedNode} */
      const elided = { kind: "elided", terminal: production.elided, span: [node.start, node.start], source: [position, position] };
      if (production.elidedValue !== undefined) elided.value = production.elidedValue;
      into.push(elided);
      continue;
    }
    if (!production.helper) {
      /** @type {import("./types.js").RuleNode} */
      const made = {
        kind: "rule",
        rule: production.lhs,
        span: [node.start, node.end],
        source: sourceOf(context.sources, node.start, node.end),
        tags: nodeTags(node, context),
        children: [],
      };
      into.push(made);
      into = made.children;
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      stack.push({node:node.children[index], into});
    }
  }
  return result;
}

/**
 * A witness as plain data of the result's own: an action that closes a
 * production names it by its rule and number, and holds no chart item.
 * @param {[Action | null, Action | null]} actions
 * @returns {import("./types.js").Witness}
 */
function witnessOf(actions) {
  /** @type {(action: Action | null) => import("./types.js").WitnessAction} */
  const plain = (action) => {
    // Neither action is ever missing (engine §6).
    if (action === null) throw new Error("the witness of a tie lacks an action");
    if (action.kind === "read") return { kind: "read", token: action.token, terminal: action.terminal };
    const { production, origin, end } = action.item;
    return { kind: "close", rule: production.owner, production: production.sourceId ?? production.id, helper: production.helper, span: [origin, end] };
  };
  return [plain(actions[0]), plain(actions[1])];
}

/** @implements {Scope} */
class TreeScope {
  /**
   * @param {DerivationRule} node
   * @param {ParseContext} context
   */
  constructor(node, context) {
    this.node = node;
    this.context = context;
  }
  /** @param {string} name */
  treeIdentityOf(name) {
    if(name === "")return derivationIdentity(this.context,this.node,true);
    const capture=this.node.production.captures[/** @type {number} */ (this.node.production.captureSlot.get(name))];
    return derivationIdentity(this.context,capturedNode(this.node,name));
  }
  /** @param {any} atom */
  boundary(atom) {
    return chosenBoundary(this.context.emissionBoundaries,atom,this.capture(atom.receiver.capture));
  }
  /** @param {string} name */
  capture(name) {
    if (name === "") return { observation: this.node.item.observation, structure: workingStructure(this.context,this.node.item), patterns: this.context.patterns, start: this.node.start, end: this.node.end, tags: nodeTags(this.node, this.context) };
    const production = this.node.production;
    const capture = production.captures[/** @type {number} */ (production.captureSlot.get(name))];
    const child = capturedNode(this.node,name);
    let captured = this.node.item.slots;
    while (captured && captured.index !== production.captureSlot.get(name)) captured = captured.parent;
    const observation = captured?.observation ?? ("read" in child
      ? terminalObservation(this.context,child.read.terminal,child.start)
      : child.item.observation);
    return { observation, structure: captured?.structure ?? ("read" in child ? structuralRead(this.context, child.read.terminal, child.start) : child.item.structure), patterns: this.context.patterns, start: child.start, end: child.end, tags: nodeTags(child, this.context) };
  }
}

/**
 * @typedef {object} Emitter
 * @property {ParseContext} context
 * @property {StringWalk} strings
 * @property {boolean} forwards
 * @property {Set<import("./tokens.js").AttachedToken>} inherited
 * @property {DiagnosticFlow} trace
 */

/** @param {import("./types.js").Production} production */
function countsForNothing(production) { return production.erased; }

/**
 * @param {Derivation} node
 * @param {TagSet} explicit
 * @param {Emitter} emitter
 * @param {DerivationRule} enclosing
 * @param {EmitItem} item
 * @returns {Token}
 */
function makeToken(node, explicit, emitter, enclosing, item) {
  const {context, strings} = emitter;
  const tags = implied(explicit, context.lowered.implications);
  const source = sourceOf(context.sources, node.start, node.end);
  const text = context.sourceText.slice(source[0], source[1]).join("");
  const value = item.value ? strings.item(enclosing,item.value,item) : strings.channel(node,"value");
  const imageRecipe = item.image ?? item.value;
  const image = imageRecipe ? strings.item(enclosing,imageRecipe,item) : strings.channel(node,"image");
  const token = new Token(tags,[node.start,node.end],source,text,value,undefined,image);
  const from = emitter.forwards ? forwarded(node,context) : null;
  if (from) {
    if (emitter.inherited.has(from)) throw new GencmuError("grammar", "an input token's attachments cannot belong to two emitted tokens");
    emitter.inherited.add(from);
    token.before = from.before;
    token.after = from.after;
  }
  return token;
}

/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {import("./tokens.js").AttachedToken | null}
 */
function forwarded(node, context) {
  let parts = 0;
  /** @type {import("./tokens.js").AttachedToken | null} */
  let found = null;
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("read" in current) {
      parts++;
      const token = context.tokens[current.read.token];
      if (hasAttachments(token)) found = token;
    } else if (!countsForNothing(current.production)) {
      for (let index = current.children.length-1; index >= 0; index--) stack.push(current.children[index]);
    }
  }
  if (found && parts > 1) throw new GencmuError("grammar", "a token combines an attached input token with another counted input token");
  return found;
}

/**
 * @param {EmitItem} item
 * @param {Derivation | undefined} anchor
 * @param {DerivationRule} node
 * @param {TagSet} explicit
 * @param {Emitter} emitter
 * @returns {Token}
 */
function insertedToken(item, anchor, node, explicit, emitter) {
  const {context, strings} = emitter;
  const at = anchor ? anchor.start : node.end;
  const position = anchor ? sourceOf(context.sources,anchor.start,anchor.end)[0]
    : at > node.start ? context.tokens[at-1].source[1] : sourceOf(context.sources,node.start,node.end)[0];
  const value = item.value ? strings.item(node,item.value,item) : "";
  const imageRecipe = item.image ?? item.value;
  const image = imageRecipe ? strings.item(node,imageRecipe,item) : "";
  return new Token(implied(explicit,context.lowered.implications),[at,at],[position,position],"",value,node.production.owner,image);
}

/**
 * The implications of a stage indexed by each tag of their `if`, made once
 * per list of implications.
 * @type {WeakMap<{if: TagSet, then: TagSet}[], Map<string, number[]>>}
 */
const implicationIndexes = new WeakMap();

/**
 * A token's explicit tags with the tags of the stage's implications, added
 * until no tag changes (engine §11). An implication only adds tags, so the
 * closure ends, also over a cycle. A pass over every implication until none
 * adds a tag would settle one link of a chain per pass, so a worklist of the
 * tags added fires each implication at most once.
 * @param {TagSet} tags
 * @param {{if: TagSet, then: TagSet}[]} implications
 * @returns {TagSet}
 */
export function implied(tags, implications) {
  if (implications.length === 0) return tags;
  let index = implicationIndexes.get(implications);
  if (!index) {
    index = new Map();
    for (let number = 0; number < implications.length; number++) {
      if (hooks.work) countWork(hooks.work, "implications");
      for (const tag of implications[number].if) {
        if (hooks.work) countWork(hooks.work, "implications");
        const list = index.get(tag);
        if (list) list.push(number);
        else index.set(tag, [number]);
      }
    }
    implicationIndexes.set(implications, index);
  }
  let result = tags;
  /** @type {Set<number> | null} */
  let fired = null;
  // Each tag and implication counts before it is read, and each tag of
  // the token's as the closure copies it.
  /** @type {string[]} */
  const queue = [];
  for (const tag of tags) {
    if (hooks.work) countWork(hooks.work, "implications");
    queue.push(tag);
  }
  for (let head = 0; head < queue.length; head++) {
    for (const number of index.get(queue[head]) ?? []) {
      if (hooks.work) countWork(hooks.work, "implications");
      if (fired === null) fired = new Set();
      else if (fired.has(number)) continue;
      fired.add(number);
      for (const tag of implications[number].then) {
        if (hooks.work) countWork(hooks.work, "implications");
        if (result.has(tag)) continue;
        if (result === tags) {
          result = new Set();
          for (const own of tags) {
            if (hooks.work) countWork(hooks.work, "tags");
            result.add(own);
          }
        }
        result.add(tag);
        queue.push(tag);
      }
    }
  }
  return result;
}

// The tokens a derivation emits for the next stage (engine §11). The walk
// keeps its own stack of tasks, in text order, rather than recursing. So
// attachments nest as deep as the text is long: each attachment's tokens
// gather in a list of their own on a stack of lists.
/**
 * @typedef {{walk: Derivation,flow:import("./diagnostic-flow.js").EmissionScope} | {run: () => void}} EmitTask
 */

/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @param {DiagnosticFlow} [trace]
 * @returns {Token[]}
 */
export function emit(root, context, trace=new DiagnosticFlow(root,context.tokens)) {
  // Emission atoms observe this one chosen derivation. They request no
  // recognition offers, and never split an admission group.
  context.emissionBoundaries=chosenBoundaries(root,emissionTargets(context.lowered.productions));
  const strings = new StringWalk(context,node => new TreeScope(node,context));
  return emitted(root, { context, strings, forwards: context.tokens.some(hasAttachments), inherited: new Set(),trace });
}

/**
 * The tokens the root of a derivation emits (engine §11), with the
 * attachments of its captured parts.
 * @param {Derivation} root
 * @param {Emitter} emitter
 * @returns {Token[]}
 */
function emitted(root, emitter) {
  const { context } = emitter;
  // The tokens emitted so far: the output, and above it the attachments
  // being gathered, the innermost last.
  /** @type {Token[][]} */
  const lists = [[]];
  /** @type {(token: Token) => void} */
  const put = (token) => lists[lists.length - 1].push(token);
  /** @type {EmitTask[]} */
  const tasks = [{ walk: root,flow:emitter.trace.main }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if ("run" in task) {
      task.run();
      continue;
    }
    const node = task.walk,flow=task.flow;
    if ("read" in node) continue;
    const production = node.production;
    if (production.erased) continue;
    const clause = production.emit;
    if (!clause) {
      for (let index = node.children.length - 1; index >= 0; index--) tasks.push({ walk: node.children[index],flow });
      continue;
    }
    const scope = new TreeScope(node, context);
    /** @type {(item: EmitItem, fallback: TagSet) => TagSet} */
    const valueTags = (item, fallback) => {
      if (!item.tags) return fallback;
      const term = item.tags;
      const tags = asSet(settled(() => evaluate(context, term, scope)));
      return tags;
    };
    if (clause.items.length === 0) continue;
    // The items, in the order listed, and nothing else of the constituent
    // but their attachments (engine §11). An inserted tag's position is the
    // start of its anchor, the first written part of the capture item listed
    // next after it, or the constituent's end.
    /** @type {(name: string) => Derivation} */
    const part = (name) => capturedNode(node,name);
    // An attachment: what its captured parts emit in their place, walked
    // into a list of their own (engine §11).
    /** @param {string[]|undefined} names @param {import("./diagnostic-flow.js").EmissionScope[]} scopes @returns {EmitTask[]} */
    const walks = (names,scopes) => (names ?? []).map(name=>{
      const child=part(name),scope=emitter.trace.attachment(child);scopes.push(scope);return {walk:child,flow:scope};
    });
    // The attachments gathered last, each token without its span.
    const gathered = () => /** @type {Token[]} */ (lists.pop()).map(token=>{
      const copy=attached(token);emitter.trace.attached(token,copy);return copy;
    });
    // Each item's anchor, the next capture item listed after it, found in
    // one backward pass rather than by a search of the rest for each.
    /** @type {(EmitItem | undefined)[]} */
    const anchors = new Array(clause.items.length);
    for (let index = clause.items.length - 1, next = undefined; index >= 0; index--) {
      if (hooks.work) countWork(hooks.work, "clauses");
      anchors[index] = next;
      if (clause.items[index].capture !== undefined) next = clause.items[index];
    }
    /** @type {EmitTask[]} */
    const ordered = [];
    clause.items.forEach((item, index) => {
      if (item.insert !== undefined) {
        const next = anchors[index];
        const anchor = next && next.capture !== undefined ? part(next.before?.[0] ?? next.capture) : undefined;
        ordered.push({ run: () => {
          const token=insertedToken(item,anchor,node,valueTags(item,tagSet()),emitter);
          emitter.trace.emitted(token,null,node,flow);put(token);
        } });
      } else if (item.capture !== undefined) {
        const child = part(item.capture);
        // Before-attachments, then the carrier with its tag term, then
        // after-attachments; the first error ends the emission. New
        // attachments are outer to inherited ones (engine §11).
        /** @type {import("./tokens.js").AttachedToken[]} */
        let before = [];
        /** @type {Token | undefined} */
        let token;
        /** @type {import("./diagnostic-flow.js").EmissionScope[]} */ const beforeScopes=[];
        /** @type {import("./diagnostic-flow.js").EmissionScope[]} */ const afterScopes=[];
        // One push for each step: an item can have any number of
        // attachments, more than a call takes arguments.
        ordered.push({ run: () => lists.push([]) });
        for (const step of walks(item.before,beforeScopes)) ordered.push(step);
        ordered.push(
          { run: () => {
            before = gathered();
            token = makeToken(child, valueTags(item, nodeTags(child, context)), emitter, node, item);
            emitter.trace.emitted(token,child,node,flow);
            lists.push([]);
          } });
        for (const step of walks(item.after,afterScopes)) ordered.push(step);
        ordered.push(
          { run: () => {
            const after = gathered();
            const carrier = /** @type {Token} */ (token);
            emitter.trace.attachments(carrier,beforeScopes,afterScopes,carrier.before,carrier.after);
            if (before.length) carrier.before = [...before, ...carrier.before];
            if (after.length) carrier.after = [...carrier.after, ...after];
            put(carrier);
          } },
        );
      }
    });
    for (let index = ordered.length - 1; index >= 0; index--) tasks.push(ordered[index]);
  }
  return lists[0];
}



/** @param {ResultNode} tree @returns {boolean} */
function hasElided(tree) {
  const pending = [tree];
  while (pending.length) {
    const node = /** @type {ResultNode} */ (pending.pop());
    if (node.kind === "elided") return true;
    if (node.kind === "rule") for (const child of node.children) pending.push(child);
  }
  return false;
}
