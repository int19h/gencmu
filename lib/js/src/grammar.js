import { nullableError } from "./nullable-errors.js";
import { queryBody, queryIdentity } from "./query-forms.js";
import {guardedTagVariants,neighbourGuards} from "./guarded-tags.js";
import {constituentComparisons, localTreeDemand, treeIdentityCycle, prepareTreeDemands} from "./tree-identities.js";
import { patternLocations } from './pattern-shapes.js';
import { rankingPatternProblem, requiresElided } from './ranking-patterns.js';
import { validateEmissionOverlap } from "./emission-overlap.js";
import { expandTemplates, templateBodyText } from "./templates.js";
import { hasUnresolved } from "./template-nodes.js";
import { BOUNDARY_METHODS, boundaryLocations, copyBoundaryLocation, boundaryReachability, boundaryAtoms, boundaryDocumentErrors } from "./boundary.js";
import { logicalOf, joinedLogical, optionalLogical, inheritedIndex } from "./logical.js";
import { copyRecipeLocation, recipeLocations, validateRecipeCycles } from "./recipes.js";
// A stage's grammar: its documents stitched together (engine §2) and
// lowered to productions for one set of features (engine §3).

import { resolvePattern, patternDepthProblem, patternParts } from "./patterns.js";
import { RankedGroups, copyRankedLocation, rankedCaptureReads } from "./ranked.js";
import {prepareRankedFrames,rankedFrameTable} from "./ranked-frame.js";
import { clauseChildren, expressionChildren } from "./clause-walk.js";
import { closeFamilies } from "./close-families.js";
import { GencmuError } from "./errors.js";
import { countWork, hooks } from "./testing.js";
import { readsOwnTags, simplifyFor, prepareClause, prepareConditions, partsFor, presentItems, constantsIn, constantValueType, definitionProblem, deferredRecipeProblem, deferredEmissionProblem, expectedProblem, rangeProblem, openPart, isSoundTest, ruleTypeFault, termType, testsIn, inputConditionsProblem, conditionTypeFault, DOM_TRUE, DOM_FALSE, itemCaptures, capturesMentioned } from "./dom.js";
import { compareCodePoints, splitString, ngrams, tagDifference, tagIntersection, tagSet, TagUnion, stringName } from "./tags.js";

/**
 * @import { Condition, ConstantTerm, DomAlternative, DomClassifier, DomEntry, DomConstant, DomImplication, DomRule, Emission, ErrorLocation, Expr, GrammarDom, Guard, LoweredGrammar, Production, Resolution, SymbolTest, TagSet, Term, TermValue, TestOp } from "./types.js"
 * @import { TermType } from "./dom.js"
 */

/**
 * A constant of a stage (engine §2): its value and type now, and the
 * document of its last definition.
 * @typedef {object} StageConstant
 * @property {TermValue} value
 * @property {TermType} type
 * @property {string} document
 */

/**
 * An implication of a stage with its two sides' values (engine §2, §11).
 * @typedef {object} StageImplication
 * @property {TagSet} if
 * @property {TagSet} then
 */

/**
 * A rule body's alternative as stitched: its own parts, its rule's clauses,
 * and the document and position of the definition that wrote it.
 * @typedef {DomAlternative & {clauses: RuleClauses, document: string, at: ErrorLocation, order: number}} StitchedAlternative
 */

/**
 * @typedef {object} RuleClauses
 * @property {Term | undefined} tags
 * @property {Emission | undefined} emit
 * @property {Condition[]} conditions
 * @property {boolean} erased
 * @property {import("./types.js").Recipe | undefined} value
 * @property {import("./types.js").Recipe | undefined} image
 * @property {import("./types.js").Recipe | undefined} error
 * @property {import("./types.js").Recipe | undefined} warning
 * @property {string[] | undefined} suppressWarnings
 */

/**
 * A rule of the stitched grammar.
 * @typedef {object} StitchedRule
 * @property {string} name
 * @property {string} document
 * @property {ErrorLocation} at
 * @property {StitchedAlternative[]} alternatives
 */

/**
 * How a later document changed a rule an earlier one defined.
 * @typedef {object} RuleChange
 * @property {"replaced" | "extended"} kind
 * @property {string} rule
 * @property {string} document
 * @property {string} previous
 */

/**
 * A symbol of an expanded sequence, and the capture that names it.
 * @typedef {{symbol: import("./types.js").GrammarSymbol, capture?: string, captureTerminal?:boolean}} SequenceItem
 */

/**
 * Where an expansion happens: the rule and the alternative, and the
 * helpers still to lower.
 * @typedef {{rule: StitchedRule, alternative: StitchedAlternative, pending: PendingHelper[]}} Where
 */

/**
 * @typedef {object} PendingHelper
 * @property {string} name
 * @property {(where: Where) => SequenceItem[][]} build
 * @property {string | null} elided
 * @property {string} [elidedValue]
 * @property {SymbolTest | null} elidedTest
 */


// The most lowered grammars, and the most classifier tables, that a stage
// keeps. Each set of the stage's gates that is on has its own, so a stage
// with k gates can have 2^k of them. The least recently used goes first.
const MAX_LOWERED = 16;

/** @type {WeakMap<Grammar, Map<string, any[]>>} */
const argumentUses = new WeakMap();
/** @param {number} run @param {string} path @param {number[]} at */
const argumentSite = (run,path,at) => JSON.stringify([run,path,at]);
// Stitches documents, each { path, dom }, into one grammar.
/** Closed patterns remain available until final erasure flags are known (§9.3).
 * @type {WeakMap<object,{pattern:any,where:any}[]>} */
const erasurePatternUses = new WeakMap();

export class Grammar {
  /**
   * @param {string} stageName
   * @param {{path: string, dom: GrammarDom}[]} documents
   * @param {import("./unicode.js").UnicodeTable} unicode
   *   the loader's table, for the tags of a range in a constant's value and
   *   the canonical value of a string constant in a test
   */
  constructor(stageName, documents, unicode) {
    erasurePatternUses.set(this,[]);
    try {
      this.stageName = stageName;
      this.unicode = unicode;
      /** @type {Map<string, StageConstant>} */
      this.constants = new Map();
      /** @type {any[]} */ this.constantVersions = [];
      /** @type {Map<string, any>} */ this.finalConstants = new Map();
      /**
       * The definitions of rules that use constants, which the loader checks
       * once the constants have their final values.
       * @type {{path: string, rule: DomRule}[]}
       */
      this.constantUsers = [];
      /** @type {{path:string, rule:DomRule, run:number}[]} */
      this.emissionUsers = [];
      /** @type {Map<string, StitchedRule>} */
      this.rules = new Map();
      // Written alternative order survives grouping, replacement and binding.
      this.alternativeOrder = 0;
      /** @type {RuleChange[]} */
      this.changes = [];
      /** @type {Resolution | null} */
      this.resolution = null;
      /** @type {any} */ this.rankingReport = null;
      this.elisionOnly = false;
      /**
       * The stage's `%classifier` items in stitching order, each with its
       * document (engine §2).
       * @type {{path: string, classifier: DomClassifier}[]}
       */
      this.classifierItems = [];
      /** @type {{path: string, implication: DomImplication}[]} */
      this.implicationItems = [];
      /** @type {{path:string,directive:import("./types.js").DomDirective}[]} */
      this.featureItems = [];
      /** @type {{run:number,at:number[],kind:number,check:()=>void}[]} */
      this.validationItems = [];
      /** @type {{path:string,rule:DomRule}[]} */
      const pendingTemplates = [];
      for (const {path,dom} of documents) for (const rule of dom.rules) if (rule.params) {
        const problem = definitionProblem(rule,true);
        if (problem) throw this.documentError(path,rule.at,problem);
      }
      const expansion = expandTemplates(documents,unicode);
      const argumentsBySite = new Map();
      for (const argument of expansion.argumentsToCheck ?? []) {
        const key = argumentSite(argument.inspectionRun,argument.path,argument.at);
        if (!argumentsBySite.has(key)) argumentsBySite.set(key,[]);
        argumentsBySite.get(key).push(argument);
      }
      argumentUses.set(this,argumentsBySite);
      this.erasureChecks=expansion.erasureChecks;
      this.templates=expansion.templates;
      this.instances=expansion.instances;
      for (const [index, {path, dom, inspectionRun = index}] of expansion.documents.entries()) {
        if (expansion.order) for (const rule of dom.rules) {
          const problem = definitionProblem(rule,true);
          if (problem) throw this.documentError(path,rule.at,problem);
        }
        this.addDocument(path, dom, inspectionRun);
      }
      if (expansion.order) this.rules = new Map(expansion.order.map((/** @type {string} */ name) => /** @type {[string,StitchedRule]} */ ([name,this.rules.get(name)])));
      for (const event of expansion.validation ?? []) if (event.rule.params || constantsIn(event.rule).length || hasPattern(event.rule) || argumentsBySite.has(argumentSite(event.inspectionRun,event.path,event.rule.at))) {
        this.constantUsers.push({path:event.path,rule:event.rule});
        this.validationItems.push({run:event.inspectionRun,at:event.rule.at,kind:0,check:() => {
          const checked = this.checkConstantRule(event.path,event.rule,event.inspectionRun);
          if (event.rule.params) pendingTemplates.push({path:event.path,rule:checked});
        }});
      }
      for (const [key,uses] of argumentsBySite) {
        const owner=uses[0];
        this.validationItems.push({run:owner.inspectionRun,at:owner.at,kind:owner.kind,check:()=>{
          const pending=argumentsBySite.get(key);
          if (pending) { argumentsBySite.delete(key); inspectArgumentConstants(this,pending); }
        }});
      }
      this.bindConstants();
      /** @type {WeakMap<DomEntry,string[]>} */
      this.classifierKeys = new WeakMap();
      /** @type {StageImplication[]} */
      this.implications = [];
      this.validationItems.sort((a,b) => a.run-b.run || a.at[0]-b.at[0] || a.at[1]-b.at[1] || a.kind-b.kind);
      for (const item of this.validationItems) item.check();
      this.validationItems.length = 0;
      argumentUses.delete(this);
      this.resolveConstants();
      /**
       * The features that gate an entry of a classifier. Only these change
       * the classifiers' values.
       * @type {string[]}
       */
      this.classifierGates = gateNames(this.classifierItems.flatMap(({ classifier }) => classifier.entries.flatMap((entry) => entry.guards)));
      /**
       * The classifiers resolved for each set of the classifier gates that is
       * on (engine §2).
       * @type {Map<string, Map<string, Map<string, TagSet>> | GencmuError>}
       */
      this.classifierTables = new Map();
      /**
       * Each test of a body with its value, made once for every lowering.
       * @type {WeakMap<object, SymbolTest>}
       */
      this.tests = new WeakMap();
      if (!this.resolution) {
        throw new GencmuError("grammar", "has no %ambiguity-resolution", { stage: stageName });
      }
      if (!this.rules.has("text")) throw new GencmuError("grammar", "has no rule text", {stage:stageName});
      (/** @type {Resolution} */ (this.resolution)).elisionOnly = this.elisionOnly;
      /** @type {WeakMap<RuleClauses,WeakMap<object,{rule:string,condition:number,order:number}>>} */
      this.boundarySites = new WeakMap();
      let ruleOrder = 0;
      for (const rule of this.rules.values()) {
        let conditionIndex = 0;
        const definitions = new Set();
        for (const alternative of rule.alternatives) {
          if (definitions.has(alternative.clauses)) continue;
          definitions.add(alternative.clauses);
          // Repeated includes share DOM nodes, but each definition has its
          // own position in the stitched condition list.
          const sites = new WeakMap();
          this.boundarySites.set(alternative.clauses,sites);
          for (const condition of alternative.clauses.conditions) {
            for (const atom of boundaryAtoms(condition)) sites.set(atom,{rule:rule.name,condition:conditionIndex,order:ruleOrder});
            conditionIndex++;
          }
          for (const other of rule.alternatives.filter(other=>other.clauses===alternative.clauses)) {
            for (const {atom} of neighbourGuards([alternative.clauses.tags,other.tags])) {
              if (!sites.has(atom)) sites.set(atom,{rule:rule.name,condition:conditionIndex++,order:ruleOrder});
            }
          }
        }
        ruleOrder++;
      }
      this.boundaries = boundaryReachability(this);
      for (const {atom,alternative} of this.boundaries.atoms) for (const target of atom.args) {
        if (!(target.rule ? this.boundaries.all.rules.has(target.rule) : this.boundaries.all.terminals.has(target.terminal))) {
          const location = boundaryLocations.get(target);
          const at = location?.at;
          const error = new GencmuError("grammar",`boundary target ${target.rule ?? target.terminal} is unreachable`,
            {document:alternative.document,...(at ? {line:at[0],column:at[1]} : {})});
          boundaryDocumentErrors.set(error,{document:alternative.document,node:target});
          throw error;
        }
      }
      /** @type {any[]} */
      this.defaultValues = [];
      this.checkReferences();
      this.checkDiagnosticsAndSplices();
      this.families = closeFamilies(this.rules);
      this.prepareQueries();
      this.ranked = new RankedGroups(new Map([...this.rules,...this.queryRules]));
      if (this.defaultValues.length) {
        const defaults = new Lowering(this,new Set());
        for (const [rule,alternative,node] of this.defaultValues) defaults.elidedTerminal(node.optional,{rule,alternative,pending:[]},node.default);
      }
      if (this.ranked.groups.length) this.ranked.validate();
      // Slot emission checks inspect written carriers before absent ones disappear.
      this.emissionUsers.sort((a,b) => a.run-b.run || a.rule.at[0]-b.rule.at[0] || a.rule.at[1]-b.rule.at[1]);
      for (const { path, rule } of this.emissionUsers) {
        const problem = deferredRecipeProblem(rule) ?? deferredEmissionProblem(rule);
        if (problem) throw this.documentError(path, rule.at, problem);
      }
      for (const {path,rule} of pendingTemplates) {
        const problem = deferredRecipeProblem(rule) ?? deferredEmissionProblem(rule);
        if (problem) throw this.documentError(path,rule.at,problem);
      }
      // Recipe name analysis precedes effective channel dependencies (§11.4).
      const recipeAlternatives = [...this.rules.values()].flatMap(rule => rule.alternatives);
      recipeAlternatives.sort((a,b) => a.order - b.order);
      for (const alternative of recipeAlternatives) {
        validateRecipeCycles(alternative.value ?? alternative.clauses.value,alternative.image ?? alternative.clauses.image,alternative.document);
      }
      validateEmissionOverlap(this.rules);
      const emptyError=nullableError(this.rules,this.errorAlternatives);
      if(emptyError)throw new GencmuError("grammar",`an error production of ${emptyError.rule.name} can match no tokens`,emptyError.alternative.at);
      /**
       * The features that gate an alternative or an entry of a classifier.
       * Only these change a lowered grammar. A warning keeps its alternative
       * (engine §3.1), and any other name matches no guard (engine §13).
       * @type {string[]}
       */
      this.gates = gateNames([
        ...[...this.rules.values()].flatMap((rule) => rule.alternatives.flatMap((alternative) => alternative.guards)),
        ...this.classifierItems.flatMap(({ classifier }) => classifier.entries.flatMap((entry) => entry.guards)),
      ]);
      /**
       * The lowered grammars, keyed by the gates that are on.
       * @type {Map<string, LoweredGrammar | GencmuError>}
       */
      this.lowered = new Map();
    } catch (error) {
      if (error instanceof GencmuError) throw error.withLocation({stage:stageName});
      throw error;
    }
  }

  /**
   * @param {string} path
   * @param {GrammarDom} dom
   * @param {number} inspectionRun
   */
  addDocument(path, dom, inspectionRun) {
    const declarations = ["rules","directives","constants","classifiers","implications"]
      .flatMap(kind => /** @type {any[]} */ (/** @type {any} */ (dom)[kind]).map(node => ({kind,node})))
      .sort((a,b) => a.node.at[0]-b.node.at[0] || a.node.at[1]-b.node.at[1]);
    for (const {kind,node} of declarations) {
      if (kind === "rules") {
        const rule = /** @type {DomRule} */ (node);
        if (rule.instance) throw new Error("an instance binding survived expansion");
        if (constantsIn(rule).length > 0 || hasPattern(rule) || argumentUses.get(this)?.has(argumentSite(inspectionRun,path,rule.at))) {
          this.constantUsers.push({path,rule});
          this.validationItems.push({run:inspectionRun,at:rule.at,kind:0,check:() => this.checkConstantRule(path,rule,inspectionRun)});
        }
        if (deferredEmissionProblem(rule) || deferredRecipeProblem(rule)) this.emissionUsers.push({path, rule, run:inspectionRun});
        const at = { document: path, line: rule.at[0], column: rule.at[1] };
        const clauses = { tags: rule.tags, emit: rule.emit, conditions: rule.conditions || [], erased: rule.erased === true, value:rule.value, image:rule.image, error:rule.error, warning:rule.warning, suppressWarnings:rule.suppressWarnings };
        const alternatives = rule.alternatives.map((alternative) => ({ ...alternative, clauses, document: path, at, order:this.alternativeOrder++ }));
        const previous = this.rules.get(rule.name);
        if (rule.op === "define") {
          if (previous) {
            throw new GencmuError("grammar", `%rule ${rule.name} is already defined, in ${previous.document}; %redefine-rule replaces a rule`, at);
          }
          this.rules.set(rule.name, { name: rule.name, document: path, at, alternatives });
        } else if (rule.op === "redefine") {
          if (!previous) {
            throw new GencmuError("grammar", `%redefine-rule ${rule.name} replaces no rule defined before it`, at);
          }
          /** @type {RuleChange} */
          const change = { kind: "replaced", rule: rule.name, document: path, previous: previous.document };
          this.changes.push(change);
          this.rules.set(rule.name, { name: rule.name, document: path, at, alternatives });
        } else {
          const base = previous;
          if (!base) {
            throw new GencmuError("grammar", `%extend-rule ${rule.name} extends a rule that is not defined before it`, at);
          }
          /** @type {RuleChange} */
          const change = { kind: "extended", rule: rule.name, document: path, previous: base.document };
          this.changes.push(change);
          // Added in place: a copy of the list for each %extend-rule would
          // cost the square of their number.
          for (const alternative of alternatives) {
            if (hooks.work) countWork(hooks.work, "clauses");
            base.alternatives.push(alternative);
          }
        }
      } else if (kind === "directives") {
        const directive = /** @type {import("./types.js").DomDirective} */ (node);
        const at = { document: path, line: directive.at[0], column: directive.at[1] };
        switch (directive.name) {
          case "features":
            const item = {path,directive};
            this.featureItems.push(item);
            this.validationItems.push({run:inspectionRun,at:directive.at,kind:1,check:() => Object.assign(item,this.resolveFeature(path,directive,inspectionRun))});
            break;
          case "ambiguity-resolution": {
            if (this.resolution) {
              throw new GencmuError("grammar", "has a second %ambiguity-resolution", {...at, stage:this.stageName});
            }
            const steps = /** @type {import("./types.js").RankingStep[]} */ (directive.steps);
            const last = steps[steps.length - 1];
            const lean = last.step === "greedy" || last.step === "lazy" ? last.step : "none";
            const keySteps = /** @type {import("./types.js").KeyStep[]} */ ((lean === "none" ? steps : steps.slice(0, -1)).map(step=>({...step})));
            this.resolution = {steps:keySteps, lean, elisionOnly:false};
            this.validationItems.push({run:inspectionRun,at:directive.at,kind:1,check:()=>{
              for (const step of keySteps) {
                const source=/** @type {any} */ (step.pattern);
                const location=patternLocations.get(source) ?? source.at ?? directive.at;
                const resolved=this.evaluateClosed(path,source.const?source:{pattern:source},location,undefined,'pattern');
                if (!("pattern" in resolved)) throw this.documentError(path,location,"a ranking step requires a pattern");
                const pattern=resolved.pattern;
                const problem=rankingPatternProblem(pattern);
                if(problem) throw this.documentError(path,location,problem);
                if(step.step === 'leftmost-longest' && requiresElided(pattern)) throw this.documentError(path,location,'leftmost-longest cannot require _Elided');
                const pending=[pattern];
                while(pending.length) {
                  const node=pending.pop();
                  if(node.name && !this.rules.has(node.name)) throw this.documentError(path,node.at??location,`${node.name} is not a rule of stage ${this.stageName}`);
                  for (const child of patternParts(node)) pending.push(child);
                }
                step.pattern=pattern;
              }
            }});
            break;
          }
          case "elision-only":
            if (this.elisionOnly) throw new GencmuError("grammar", "has a second %elision-only", at);
            this.elisionOnly = true;
            break;
          default:
            throw new GencmuError("grammar", `unknown directive %${directive.name}`, at);
        }
      } else if (kind === "constants") this.addConstant(path,node);
      else if (kind === "classifiers") {
        this.classifierItems.push({path,classifier:node});
        this.validationItems.push({run:inspectionRun,at:node.at,kind:3,check:() => this.resolveClassifierKeys(path,node)});
      } else {
        this.implicationItems.push({path,implication:node});
        this.validationItems.push({run:inspectionRun,at:node.at,kind:4,check:() => this.implications.push(this.resolveImplication(path,node))});
      }
    }
  }

  /**
   * An implication's two sides, with the constants' final values: closed
   * terms whose type is a tag set (engine §2, §9).
   * @param {string} path
   * @param {DomImplication} implication
   * @returns {StageImplication}
   */
  resolveImplication(path, implication) {
    /** @type {(name: string) => TermType} */
    const types = (name) => /** @type {StageConstant} */ (this.constants.get(name)).type;
    /** @type {TagSet[]} */
    const sides = [];
    for (const side of [implication.if, implication.then]) {
      for (const reference of constantsIn(side)) {
        if (!this.constants.has(reference.const)) {
          throw this.documentError(path, reference.at, `$${reference.const} is not defined in stage ${this.stageName}`);
        }
      }
      const found = termType(side, types);
      const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
      if (problem) throw this.faultError(path, "problem" in found ? found.node : side, implication.at, `a side of an implication is a tag set: ${problem}`);
      const value = this.evaluateClosed(path, side, implication.at);
      sides.push("set" in value ? value.set : tagSet());
    }
    return { if: sides[0], then: sides[1] };
  }

  /**
   * Each classifier of the stage for one set of features: each key's
   * classes after every entry whose gates hold, in stitching order (engine
   * §2). An entry that adds a membership that holds, or removes one that
   * does not, is an error of the grammar for these features.
   * @param {Set<string>} features
   * @returns {Map<string, Map<string, TagSet>>}
   */
  classifiers(features) {
    const key = JSON.stringify(this.classifierGates.filter((name) => features.has(name)));
    let tables = recall(this.classifierTables, key);
    if (tables instanceof GencmuError) throw tables;
    if (tables) return tables;
    tables = new Map();
    for (const { path, classifier } of this.classifierItems) {
      let table = tables.get(classifier.name);
      if (!table) tables.set(classifier.name, (table = new Map()));
      for (const entry of classifier.entries) {
        if (!entry.guards.every((guard) => features.has(guard.feature) !== guard.negated)) continue;
        for (const word of /** @type {string[]} */ (this.classifierKeys.get(entry))) {
          let classes = table.get(word);
          if (!classes) table.set(word, (classes = tagSet()));
          if ((entry.op === "∈") === classes.has(entry.class)) {
            const [line, column] = entry.at;
            const message = entry.op === "∈" ? `${stringName(word, this.unicode)} is already in ${entry.class}` : `${stringName(word, this.unicode)} is not in ${entry.class}, so ∉ has nothing to remove`;
            const error = new GencmuError("grammar", `${path}:${line}:${column}: the classifier ${classifier.name}: ${message}`, { document: path, line, column, stage: this.stageName });
            remember(this.classifierTables, key, error);
            throw error;
          }
          // Each table's sets are its own, so an entry changes one in place:
          // a copy for each entry would cost the square of a key's entries.
          if (entry.op === "∈") classes.add(entry.class);
          else classes.delete(entry.class);
          if (hooks.work) countWork(hooks.work, "tags");
        }
      }
    }
    remember(this.classifierTables, key, tables);
    return tables;
  }

  /**
   * An error of the document at a position of it (engine §2).
   * @param {string} path
   * @param {[number, number]} position
   * @param {string} message
   * @returns {GencmuError}
   */
  documentError(path, position, message) {
    const [line, column] = position;
    return new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  }

  /**
   * Records an immutable constant version. Final bindings select the
   * dependency graph before evaluation (engine §2).
   * @param {string} path
   * @param {DomConstant} constant
   */
  addConstant(path, constant) {
    const { name, op } = constant;
    const previous = this.finalConstants.get(name);
    if (op === "define" && previous) {
      throw this.documentError(path, constant.at, `%const $${name} is already defined in stage ${this.stageName}, in ${previous.path}; %redefine-const gives it a new value`);
    }
    if (op === "redefine" && !previous) {
      throw this.documentError(path, constant.at, `%redefine-const $${name} gives a value to no constant defined before it in stage ${this.stageName}`);
    }
    const version = { ...constant, path, previous, state: 0 };
    this.constantVersions.push(version);
    this.finalConstants.set(name, version);
  }

  // Every lexical reference binds to the final version, except a name in
  // its own redefinition, which binds to that definition's predecessor.
  bindConstants() {
    const versionsByName = new Map();
    for (const version of this.constantVersions) {
      versionsByName.set(version.name,(versionsByName.get(version.name) ?? 0)+1);
      version.dependencies = [];
      for (const reference of constantsIn(version.value)) {
        const target = reference.const === version.name && version.op === "redefine"
          ? version.previous : this.finalConstants.get(reference.const);
        if (!target) throw this.documentError(version.path, reference.at,
          `$${reference.const} is not defined in stage ${this.stageName}; dependency $${version.name} → $${reference.const}`);
        version.dependencies.push({ target, at: reference.at });
      }
    }
    const ordered = [];
    for (const root of this.constantVersions) {
      if (root.state === 2) continue;
      const stack = [{ version: root, next: 0 }];
      root.state = 1;
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const version = frame.version;
        const dependency = version.dependencies[frame.next++];
        if (dependency) {
          const target = dependency.target;
          if (target.state === 1) {
            const start = stack.findIndex(frame => frame.version === target);
            const versions = [...stack.slice(start).map(frame => frame.version),target];
            const ambiguous = versions.some(version => versionsByName.get(version.name) > 1);
            const cycle = versions.map(version => ambiguous
              ? `$${version.name} [${version.path}:${version.at[0]}:${version.at[1]}]` : `$${version.name}`).join(" → ");
            throw this.documentError(version.path, dependency.at, `constant dependency cycle: ${cycle}`);
          }
          if (target.state === 0) { target.state = 1; stack.push({ version: target, next: 0 }); }
          continue;
        }
        ordered.push(version);
        version.state = 2;
        stack.pop();
      }
    }
    // Types are constraints shared by every version of one name. The
    // work queue propagates a concrete kind without adding value edges.
    /** @type {Map<string, TermType>} */
    const kinds = new Map();
    /** @type {Map<string, Set<any>>} */
    const users = new Map();
    for (const version of this.constantVersions) {
      for (const name of [version.name, ...constantsIn(version.value).map(r => r.const)]) {
        let used = users.get(name);
        if (!used) users.set(name, used = new Set());
        used.add(version);
      }
    }
    const queue = this.constantVersions.slice(), queued = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      const version = queue[index];
      queued.delete(version);
      const found = constantValueType(version.value, version.op === "redefine", name => kinds.get(name) ?? "any");
      if ("problem" in found) throw this.faultError(version.path, found.node, version.at, found.problem);
      if (found.type === "any" || found.type === "set") continue;
      const previous = kinds.get(version.name);
      if (previous && previous !== found.type) throw this.documentError(version.path, version.at,
        `%redefine-const $${version.name} keeps the type of the constant, and cannot make it ${TYPE_PHRASES[found.type]}`);
      if (!previous) {
        kinds.set(version.name, found.type);
        for (const user of users.get(version.name) ?? []) if (!queued.has(user)) { queued.add(user); queue.push(user); }
      }
    }
    for (const version of ordered) {
      const type = kinds.get(version.name);
      if (!type) throw this.documentError(version.path, version.at, `the kind of the value of $${version.name} is not given`);
      version.type = type;
      const lookup = (/** @type {string} */ name) => name === version.name && version.op === "redefine"
        ? version.previous : this.finalConstants.get(name);
      version.result = this.evaluateClosed(version.path, version.value, version.at, name => lookup(name).result, type);
    }
    for (const [name, version] of this.finalConstants) {
      this.constants.set(name, { value: version.result, type: version.type, document: version.path });
    }
  }

  /**
   * The error for a construct whose types disagree: at its first constant,
   * which the loader alone could type, or else at the item (engine §9).
   * @param {string} path
   * @param {unknown} node
   * @param {[number, number]} item
   * @param {string} problem
   * @returns {GencmuError}
   */
  faultError(path, node, item, problem) {
    const first = constantsIn(node)[0];
    return this.documentError(path, first ? first.at : item, problem);
  }

  /**
   * The value of a closed term, with the constants' values now (engine §2,
   * §10). A joined empty delimiter errors at the definition. A direct
   * constant delimiter errors at its reference.
   * @param {string} path
   * @param {Term} term
   * @param {[number, number]} item the position of the definition
   * @param {(name:string) => TermValue} [lookup]
   * @param {TermType} [expected]
   * @returns {TermValue}
   */
  evaluateClosed(path, term, item, lookup = (name) => /** @type {StageConstant} */ (this.constants.get(name)).value, expected = undefined) {
    const checkDepth = () => {
      const problem = patternDepthProblem(term,lookup);
      if (problem) throw this.documentError(path,problem.at ?? item,"a resolved pattern is nested more than 256 deep");
    };
    /** @type {(term: Term) => Set<string>} */
    const set = (part) => {
      const value = this.evaluateClosed(path, part, item, lookup);
      return "set" in value ? value.set : "string" in value ? tagSet([value.string]) : tagSet();
    };
    /** @type {(term: Term) => string} */
    const string = (part) => {
      const value = this.evaluateClosed(path, part, item, lookup);
      return "string" in value ? value.string : "";
    };
    if ("string" in term) return { string: term.string };
    if ("concat" in term) return { string: term.concat.map(string).join("") };
    if ("tag" in term) return { set: tagSet([term.tag]) };
    if ("emptySet" in term) return expected === "pattern" ? { pattern: { difference: [{ any:true, children:[{siblings:true}] }, { any:true, children:[{siblings:true}] }] } } : { set: tagSet() };
    if ("const" in term) return lookup(term.const);
    if ("pattern" in term) {
      checkDepth();
      try {
        const pattern = resolvePattern(term.pattern, (name,at) => {
          const resolved = lookup(name);
          if (!("string" in resolved) && !("pattern" in resolved)) throw this.documentError(path,at,"a pattern atom requires a string or pattern constant");
          return resolved;
        }, (value,atom) => {
          if (atom.range) {
            const strings = atom.range.map((/** @type {Term} */ end) => this.evaluateClosed(path,end,atom.at ?? item,lookup));
            const problem = rangeProblem(strings);
            if (problem) {
              const wide = strings.findIndex((/** @type {any} */ end)=>[...end.string].length !== 1);
              throw this.faultError(path,wide >= 0 ? atom.range[wide] : atom.range,atom.at ?? item,problem);
            }
          }
          return this.evaluateClosed(path,value,atom.at ?? item,lookup);
        }, this.unicode);
        erasurePatternUses.get(this)?.push({pattern,where:{document:path,line:item[0],column:item[1]}});
        return {pattern};
      } catch (error) {
        if (error instanceof GencmuError && !error.where.document) throw this.documentError(path,[error.where.line ?? item[0],error.where.column ?? item[1]],error.message);
        throw error;
      }
    }
    const operation = "union" in term ? "union" : "intersection" in term ? "intersection" : "difference" in term ? "difference" : null;
    if (operation) {
      const operands = /** @type {any} */ (term)[operation];
      let pattern = expected === "pattern";
      const pending = [...operands];
      while (!pattern && pending.length) {
        const part = pending.pop();
        if ("pattern" in part || ("const" in part && "pattern" in lookup(part.const))) pattern = true;
        else for (const key of ["union", "intersection", "difference"]) if (part[key]) for (const child of part[key]) pending.push(child);
      }
      if (pattern) {
        checkDepth();
        let values=operands.map((/** @type {Term} */ part) => /** @type {{pattern:any}} */ (this.evaluateClosed(path, part, item, lookup, "pattern")).pattern);
        if(operation!=='difference') values=values.flatMap((/** @type {any} */ part)=>part[operation]??[part]);
        return {pattern:{[operation]:values}};
      }
    }
    if ("union" in term) {
      const result = new TagUnion();
      for (const part of term.union) result.add(set(part));
      return { set: result.result() };
    }
    if ("intersection" in term) {
      const [first, ...rest] = term.intersection.map(set);
      return { set: rest.reduce(tagIntersection, first) };
    }
    if ("difference" in term) return { set: tagDifference(set(term.difference[0]), set(term.difference[1])) };
    if ("method" in term && term.method === "ngrams") return {set:ngrams(string(term.receiver), /** @type {{integer:string}} */ (term.args[0]).integer)};
    if ("method" in term && term.method === "split") {
      const pieces = string(term.receiver);
      const delimiter = /** @type {Term} */ (term.args[0]);
      const seen = string(delimiter);
      if (seen === "") throw "concat" in delimiter
        ? this.documentError(path,item,"split has an empty delimiter")
        : this.faultError(path,delimiter,item,"split has an empty delimiter");
      return {set:splitString(pieces,seen)};
    }
    throw new GencmuError("grammar", `${path}: a constant's value is not a closed term`, { document: path });
  }

  /** @param {any} node @param {string} path @param {[number,number]} at @returns {any} */
  resolvePatterns(node, path, at) {
    const patterns = new Map();
    for (const part of valueParts(node)) {
      if ((part.node.op === "≅" || part.node.op === "≇") && typeof part.node.right?.capture === "string" && constituentComparisons([node.tags,node.conditions,...(node.alternatives ?? []).map((/** @type {any} */ alternative)=>alternative.tags)]).length) this.treeComparisons = true;
      if (part.pattern && !hasUnresolved(part.node)) {
      patterns.set(part.node, this.evaluateClosed(path,part.node,at,undefined,"pattern"));
      }
    }
    /** @param {any} source @returns {any} */
    const copy = source => {
      if (patterns.has(source)) return patterns.get(source);
      if (Array.isArray(source)) return source.map(copy);
      if (!source || typeof source !== "object" || source instanceof Set) return source;
      const result = Object.fromEntries(Object.entries(source).map(([key,value]) => [key,copy(value)]));
      copyRankedLocation(source,result);
      copyRecipeLocation(source,result);
      copyBoundaryLocation(source,result);
      return result;
    };
    return copy(node);
  }

  /** @param {string} path @param {DomRule} rule @param {number} inspectionRun @returns {DomRule} */
  checkConstantRule(path, rule, inspectionRun) {
    /** @type {(name:string) => TermType} */
    const types = name => /** @type {StageConstant} */ (this.constants.get(name)).type;
    const key = argumentSite(inspectionRun,path,rule.at);
    const uses = argumentUses.get(this)?.get(key) ?? [];
    argumentUses.get(this)?.delete(key);
    let resolvedRule;
    if (uses.length) {
      inspectArgumentConstants(this,[{path,rule,at:rule.at},...uses]);
      resolvedRule=resolveNode(rule,this.constants);
    } else {
      for (const reference of constantsIn(rule)) if (!this.constants.has(reference.const)) {
        throw this.documentError(path,reference.at,`$${reference.const} is not defined in stage ${this.stageName}`);
      }
      resolvedRule=resolveNode(rule,this.constants);
      const fault=ruleTypeFault(resolvedRule,types);
      if (fault) throw this.faultError(path,fault.node,rule.at,fault.problem);
      this.checkValueUses(rule,path,rule.at);
    }
    const checked = this.resolvePatterns(resolvedRule,path,rule.at);
    for(const term of [checked.tags,...(checked.alternatives??[]).map((/** @type {any} */ a)=>a.tags)]) {
      if(term && readsOwnTags(term)) throw this.documentError(path,rule.at,"a constituent reads its own tags");
    }
    const problem = definitionProblem(checked, true);
    if (!rule.params && (deferredEmissionProblem(checked) || deferredRecipeProblem(checked))) this.emissionUsers.push({path, rule:checked, run:inspectionRun});
    if (problem) throw this.documentError(path, rule.at, problem);
    return checked;
  }

  /** @param {any} root @param {string} path @param {[number,number]} at @param {boolean} [computed] */
  checkValueUses(root, path, at, computed = false) {
    for (const {node:part,pattern} of valueParts(root)) {
      if (pattern || part.pattern) this.checkPatternUses(part,path,at);
      if (part.range) this.checkRangeUses(part.range,path,at);
      if (part.method === "split" && (computed ? !openPart(part.args[0]) : "string" in part.args[0] || "const" in part.args[0])) {
        const delimiter = /** @type {{string:string}} */ (this.evaluateClosed(path,part.args[0],at));
        if (delimiter.string === "") throw this.faultError(path,part.args[0],at,"split has an empty delimiter");
      }
    }
  }

  /** @param {any[]} ends @param {string} path @param {[number,number]} at */
  checkRangeUses(ends,path,at) {
    const values = ends.map(end => hasUnresolved(end) ? {} : this.evaluateClosed(path,end,at));
    const problem = rangeProblem(values);
    if (problem) {
      const wide = values.findIndex((/** @type {any} */ end) => typeof end.string === "string" && [...end.string].length !== 1);
      throw this.faultError(path,wide >= 0 ? ends[wide] : ends,at,problem);
    }
  }

  /** @param {any} root @param {string} path @param {[number,number]} at */
  checkPatternUses(root,path,at) {
    if (!hasUnresolved(root)) { this.evaluateClosed(path,root,at,undefined,"pattern"); return; }
    const depth = patternDepthProblem(root,name => /** @type {StageConstant} */ (this.constants.get(name)).value);
    if (depth) throw this.documentError(path,depth.at ?? at,"nested too deeply");
    const pending = [{node:root,kind:"term"}];
    while (pending.length) {
      const {node,kind} = /** @type {{node:any,kind:string}} */ (pending.pop());
      if (kind === "value") { this.checkValueUses(node,path,at); continue; }
      if (!hasUnresolved(node)) {
        this.evaluateClosed(path,kind === "pattern" ? {pattern:node} : node,at,undefined,"pattern");
        continue;
      }
      if (node.call) this.checkValueUses(node.args,path,at);
      if (kind === "term") {
        if (node.param || node.call) continue;
        if (node.pattern) pending.push({node:node.pattern,kind:"pattern"});
        else for (const child of clauseChildren(node).slice().reverse()) pending.push({node:child,kind:"term"});
      } else {
        if (node.range) this.checkRangeUses(node.range,path,at);
        if (node.test) pending.push({node:node.test === "tags" ? node.requirements.map((/** @type {any} */ r) => r.value) : node.value,kind:"value"});
        for (const child of patternParts(node).slice().reverse()) pending.push({node:child,kind:"pattern"});
      }
    }
  }

  /** @param {string} path @param {import("./types.js").DomDirective} directive @param {number} inspectionRun */
  resolveFeature(path, directive, inspectionRun) {
    try {
      if (!directive.conditions) return {path,directive};
      const uses=argumentUses.get(this)?.get(argumentSite(inspectionRun,path,directive.at))??[];
      const references=constantsIn(directive.conditions);
      for (const use of uses) for (const reference of constantsIn(use.rule??use.term)) references.push(reference);
      if (uses.length) references.sort((a,b)=>a.at[0]-b.at[0]||a.at[1]-b.at[1]);
      for (const reference of references) {
        if (!this.constants.has(reference.const)) throw this.documentError(path,directive.at,`$${reference.const} is not defined in stage ${this.stageName}`);
      }
      const conditions = /** @type {Condition[]} */ (resolveNode(directive.conditions,this.constants));
      const problem = inputConditionsProblem(conditions);
      if (problem) throw this.documentError(path,directive.at,problem);
      for (const condition of conditions) {
        const fault = conditionTypeFault(condition,name => /** @type {StageConstant} */ (this.constants.get(name)).type);
        if (fault) throw this.documentError(path,directive.at,fault.problem);
      }
      this.checkValueUses(conditions,path,directive.at,true);
      return {path,directive:{...directive,conditions}};
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      if (error.where.document === path && error.where.line === directive.at[0] && error.where.column === directive.at[1]) throw error;
      const prefix = `${error.where.document}:${error.where.line}:${error.where.column}: `;
      const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
      throw this.documentError(path,directive.at,message);
    }
  }

  /** @param {string} path @param {DomClassifier} classifier */
  resolveClassifierKeys(path, classifier) {
    for (const entry of classifier.entries) {
      const keys = entry.keys.map(term => {
        for (const reference of constantsIn(term)) if (!this.constants.has(reference.const)) {
          throw this.documentError(path,reference.at,`$${reference.const} is not defined in stage ${this.stageName}`);
        }
        const found = termType(term,name => /** @type {StageConstant} */ (this.constants.get(name)).type);
        if ("problem" in found) throw this.faultError(path,found.node,entry.at,found.problem);
        const wrong = expectedProblem(found.type,"string");
        if (wrong) throw this.faultError(path,term,entry.at,wrong);
        return /** @type {{string:string}} */ (this.evaluateClosed(path,term,entry.at)).string;
      });
      this.classifierKeys.set(entry,keys);
    }
  }

  /**
   * Substitutes final values in the stitched rules after declaration checks.
   * Clauses shared by alternatives stay shared (engine §2).
   */
  resolveConstants() {
    if (this.constantUsers.length === 0) return;
    // Each reference holds the final value; the clauses that a definition's
    // alternatives share stay shared.
    /** @type {Map<object, RuleClauses>} */
    const resolved = new Map();
    /** @type {<T>(node: T, path:string, at:[number,number]) => T} */
    const resolve = (node, path, at) => /** @type {any} */ (this.resolvePatterns(resolveNode(node, this.constants), path, at));
    // Constants and tree comparisons need resolution in every clause.
    // Inspect shared definition clauses once, and own clauses separately.
    /** @type {Map<object, boolean>} */
    const naming = new Map();
    for (const rule of this.rules.values()) {
      rule.alternatives = rule.alternatives.map((alternative) => {
        const { clauses } = alternative;
        let names = naming.get(clauses);
        if (names === undefined) naming.set(clauses, (names = clauseNeedsResolution(clauses)));
        if (!names && !clauseNeedsResolution([alternative.tags, alternative.value, alternative.image])) return alternative;
        let shared = resolved.get(clauses);
        if (!shared) {
          shared = { ...clauses, tags: resolve(clauses.tags, alternative.document, [alternative.at.line ?? 0, alternative.at.column ?? 0]), error:resolve(clauses.error,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]), warning:resolve(clauses.warning,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]), conditions: resolve(clauses.conditions, alternative.document, [alternative.at.line ?? 0, alternative.at.column ?? 0]), emit: resolve(clauses.emit, alternative.document, [alternative.at.line ?? 0, alternative.at.column ?? 0]), value:resolve(clauses.value,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]), image:resolve(clauses.image,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]) };
          resolved.set(clauses, shared);
        }
        return { ...alternative, value:resolve(alternative.value,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]), image:resolve(alternative.image,alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0]), tags: resolve(alternative.tags, alternative.document, [alternative.at.line ?? 0, alternative.at.column ?? 0]), clauses: shared };
      });
    }
  }

  /**
   * A test of a body with its value, from the constants' final values
   * (engine §2, §4).
   * @param {{test: TestOp, value?: Term, requirements?: import("./types.js").Requirement[], expr?:Expr}} test
   * @param {string} path
   * @param {ErrorLocation} at
   * @returns {SymbolTest}
   */
  symbolTest(test, path, at) {
    let found = this.tests.get(test);
    if (!found) {
      if (test.test === "tags") {
        const positive = new Set();
        const negative = new Set();
        for (const requirement of /** @type {import("./types.js").Requirement[]} */ (test.requirements)) {
          const value = this.evaluateClosed(path, requirement.value, [at.line ?? 0, at.column ?? 0]);
          for (const name of /** @type {{set: TagSet}} */ (value).set) (requirement.negated ? negative : positive).add(name);
        }
        const names = [...new Set([...positive, ...negative])].sort(compareCodePoints);
        const written = "<" + names.flatMap(name => [...(positive.has(name) ? [name] : []), ...(negative.has(name) ? ["¬" + name] : [])]).join(" ") + ">";
        found = { op: "tags", positive, negative, written };
      } else {
        const value = /** @type {{string: string}} */ (this.evaluateClosed(path, /** @type {Term} */ (test.value), [at.line ?? 0, at.column ?? 0]));
        found = { op: test.test, value: value.string, written: test.test + stringName(value.string, this.unicode) };
      }
      if (test.expr && "test" in test.expr) {
        const inner = this.symbolTest(test.expr,path,at);
        found = {...found,inner,written:inner.written+found.written};
      }
      this.tests.set(test, found);
    }
    return found;
  }

  // Anonymous query definitions join lowering and ranked-helper discovery,
  // but never the written grammar or its public audits (engine §3.10).
  prepareQueries() {
    /** @type {Map<string,string>} */ this.queryTargets = new Map();
    /** @type {Map<string,string>} */ this.queryNames = new Map();
    /** @type {Map<string,StitchedRule>} */ this.queryRules = new Map();
    const seen = new Set();
    for (const rule of this.rules.values()) for (const alternative of rule.alternatives) {
      /** @type {unknown[]} */
      const pending = [alternative.clauses,alternative.tags].reverse();
      while (pending.length) {
        const part = /** @type {any} */ (pending.pop());
        if (!part || typeof part !== "object" || seen.has(part)) continue;
        seen.add(part);
        if (part.method === "parse") {
          const body = queryBody(part.args[0].body).body;
          const key = queryIdentity(part.args[0].body);
          if (!this.queryTargets.has(key)) {
            let name;
            if (body.ref && !body.ref.startsWith("_")) name = isTerminalName(body.ref) ? "\u0000query:"+body.ref : body.ref;
            else {
              name = "\u0000parse:"+this.queryRules.size;
              // A forest exposes no returned tags. Discarding the anonymous
              // root's tags also seals ranked bodies without inventing a
              // restriction on an otherwise legal query constituent.
              /** @type {RuleClauses} */
              const clauses = {conditions:[],erased:false,tags:{emptySet:true},emit:undefined,value:undefined,image:undefined,error:undefined,warning:undefined,suppressWarnings:undefined};
              const source = {...alternative,guards:[],expr:body,tags:undefined,value:undefined,image:undefined,clauses};
              this.queryRules.set(name,{name,document:alternative.document,at:alternative.at,alternatives:[source]});
              this.queryNames.set(name,templateBodyText(body,this.unicode));
            }
            this.queryTargets.set(key,name);
          }
        }
        const children = clauseChildren(part);
        for (let index = children.length-1; index >= 0; index--) pending.push(children[index]);
      }
    }
  }

  checkReferences() {
    // A rule named anywhere must be defined: in a body, and in a clause as the
    // rule of matches, begins or tags (engine §2). The error stands at the
    // definition that wrote the alternative.
    /** @type {(name: string, rule: StitchedRule, alternative: StitchedAlternative) => void} */
    const check = (name, rule, alternative) => {
      if (!this.rules.has(name)) {
        throw new GencmuError("grammar", `${name} is not a rule of stage ${this.stageName}`, alternative.at);
      }
    };
    /** @type {(expr: Expr, rule: StitchedRule, alternative: StitchedAlternative) => void} */
    const visit = (expr, rule, alternative) => {
      if ("default" in expr) this.defaultValues.push([rule,alternative,expr]);
      if ("ref" in expr && !isTerminalName(expr.ref)) check(expr.ref, rule, alternative);
      for (const child of expressionChildren(expr)) visit(child, rule, alternative);
    };
    // The stage's classifiers by name, rather than a scan of them for each
    // classifier a clause names.
    const classifierNames = new Set(this.classifierItems.map((item) => item.classifier.name));
    // The clauses that a definition's alternatives share are read with the
    // first of them, where an error in them stands, not again with each.
    /** @type {Set<RuleClauses>} */
    const read = new Set();
    for (const rule of this.rules.values()) {
      for (const alternative of rule.alternatives) {
        visit(alternative.expr, rule, alternative);
        /** @type {unknown[]} */
        const clauses = [alternative.tags];
        if (!read.has(alternative.clauses)) {
          read.add(alternative.clauses);
          const { tags, conditions, emit } = alternative.clauses;
          clauses.push(tags, conditions, emit ? emit.items.map((item) => item.tags) : []);
        }
        const pending = clauses.slice().reverse();
        while (pending.length) {
          const node = /** @type {any} */ (pending.pop());
          if (hooks.work) countWork(hooks.work, "clauses");
          if (!node || typeof node !== "object") continue;
          if (BOUNDARY_METHODS.has(node.method)) continue;
          if (node.body) { visit(queryBody(node.body).body,rule,alternative); continue; }
          if (typeof node.rule === "string") check(node.rule,rule,alternative);
          if (typeof node.classifier === "string" && !classifierNames.has(node.classifier)) {
            throw new GencmuError("grammar", `${node.classifier} is not a classifier of stage ${this.stageName}`, alternative.at);
          }
          const children = clauseChildren(node);
          for (let index = children.length-1; index >= 0; index--) pending.push(children[index]);
        }
      }
    }
  }

  checkDiagnosticsAndSplices() {
    const warnings=new Set(), splices=[], prohibited=new Set();
    /** @type {{rule:StitchedRule,alternative:StitchedAlternative}[]} */
    this.errorAlternatives=[];
    const erased=new Set([...this.rules.values()].filter(rule=>rule.alternatives.every(alternative=>alternative.clauses.erased)).map(rule=>rule.name));
    /** @param {any} pattern @param {any} [where] @param {boolean} [collect] */
    const names=(pattern,where={},collect=true)=> {
      if (pattern?.name) {
        if(collect)prohibited.add(pattern.name);
        if(!this.erasureChecks && erased.has(pattern.name) && pattern.children && !(pattern.children.length===1 && pattern.children[0].siblings)) {
          const at=patternLocations.get(pattern) ?? pattern.at;
          throw new GencmuError("grammar",`a pattern of erased rule ${pattern.name} permits only the child list « ⋯ »`,{...where,...(at ? {line:at[0],column:at[1]} : {})});
        }
      }
      for(const child of patternParts(pattern ?? {})) names(child,where,collect);
    };
    for (const check of this.erasureChecks ?? []) if(check.names.length && check.names.every((/** @type {string} */ name)=>erased.has(name))) {
      throw new GencmuError("grammar",`a pattern of erased rule ${check.name} permits only the child list « ⋯ »`,check.where);
    }
    for (const use of erasurePatternUses.get(this) ?? []) names(use.pattern,use.where,false);
    erasurePatternUses.delete(this);
    for (const step of this.resolution?.steps ?? []) names(step.pattern);
    for (const constant of this.constants.values()) if ("pattern" in constant.value) names(constant.value.pattern);
    for (const rule of this.rules.values()) for (const alternative of rule.alternatives) {
      const clauses=alternative.clauses;
      if (clauses.warning) warnings.add(rule.name);
      if (clauses.error) this.errorAlternatives.push({rule,alternative});
      if (clauses.error && !(/^(?!.*--)[a-z][A-Za-z0-9_-]*$/.test(rule.name) || this.unicode.isEmojiName(rule.name))) throw new GencmuError("grammar","an error code must be a rule name",alternative.at);
      if (clauses.warning && !/^(?!.*--)[A-Za-z][A-Za-z0-9-]*$/.test(rule.name)) throw new GencmuError("grammar","a warning code must be a feature name",alternative.at);
      /** @type {any[]} */
      const pending=[alternative.expr,clauses,alternative.tags];
      while(pending.length) {
        const node=pending.pop();
        if (!node || typeof node!=="object" || node instanceof Set) continue;
        if (node.splice) splices.push({name:node.splice.ref,alternative});
        if (node.pattern) names(node.pattern,alternative.at);
        if (BOUNDARY_METHODS.has(node.method)) for (const target of node.args) if(target.rule) prohibited.add(target.rule);
        for(const child of Object.values(node)) if(child && typeof child==="object") pending.push(child);
      }
    }
    for (const rule of this.rules.values()) for (const alternative of rule.alternatives) {
      for (const code of alternative.clauses.suppressWarnings ?? []) if(code!=="_" && !warnings.has(code)) throw new GencmuError("grammar",`suppression code ${code} is not a warning of stage ${this.stageName}`,alternative.at);
    }
    delete this.erasureChecks;
    for (const {name,alternative} of splices) if (prohibited.has(name)) throw new GencmuError("grammar",`a splice of ${name} conflicts with a pattern or neighbour target`,alternative.at);
  }

  /**
   * @internal
   * @type {((features:Set<string>,error:GencmuError)=>GencmuError)|undefined}
   */
  recoverTreeError;

  /**
   * The productions for a set of enabled features. The check of
   * elision-only reads the same productions in a mode of its own (engine
   * §3.8, §7.4).
   * @param {Set<string>} features
   * @returns {LoweredGrammar}
   */
  lower(features) {
    // Only the gates that are on change the productions. So two sets of
    // features with the same gates on share one lowered grammar.
    const on = new Set(this.gates.filter((name) => features.has(name)));
    const key = JSON.stringify([...on]);
    let lowered = recall(this.lowered, key);
    if (lowered instanceof GencmuError) throw lowered;
    if (!lowered) {
      // The stage resolves its classifiers for the same features, before it
      // lowers its rules (engine §2, §3).
      try {
        const classifiers = this.classifiers(on);
        lowered = { ...new Lowering(this, on).run(), classifiers, implications: this.implications };
      } catch (error) {
        if (error instanceof GencmuError) {
          const recovered = this.recoverTreeError ? this.recoverTreeError(on,error) : error;
          const located = recovered.where.stage === this.stageName ? recovered : recovered.withLocation({stage:this.stageName});
          remember(this.lowered, key, located);
          throw located;
        }
        throw error;
      }
      remember(this.lowered, key, lowered);
    }
    return lowered;
  }
}

/** The value-bearing parts of a definition, in written order.
 * @param {any} root
 * @returns {Generator<{node:any,pattern:boolean}>}
 */
function* valueParts(root) {
  const pending = [{node:root,pattern:false}];
  while (pending.length) {
    const part = /** @type {{node:any,pattern:boolean}} */ (pending.pop());
    const node = part.node;
    if (!node || typeof node !== "object" || node instanceof Set) continue;
    yield part;
    if (part.pattern || node.pattern) continue;
    if (node.op === "≅" || node.op === "≇") {
      pending.push({node:node.right,pattern:!(typeof node.right?.capture === "string")},{node:node.left,pattern:false});
      continue;
    }
    const expressions = expressionChildren(node);
    const children = Array.isArray(node) ? node
      : node.alternatives ? [node.tags,node.value,node.image,node.alternatives,node.conditions,node.error,node.warning,node.emit]
      : node.call ? node.args
      : node.body ? [node.body]
      : node.targets ? node.targets
      : node.requirements && !node.expr ? node.requirements
      : (typeof node.capture === "string" && !node.expr || node.insert) ? [node.tags,node.value,node.image]
      : node.expr ? [node.expr,node.requirements,node.tags,node.value,node.image]
      : node.literal ? [node.literal]
      : node.range ? node.range
      : expressions.length ? expressions
      : clauseChildren(node);
    for (let index=children.length-1; index>=0; index--) pending.push({node:children[index],pattern:false});
  }
}

/**
 * Inspect all retained parts of one declaration in binding-phase order.
 * @param {Grammar} grammar
 * @param {any[]} records
 */
function inspectArgumentConstants(grammar, records) {
  const references=records.flatMap(record=>constantsIn(record.rule??record.term).map(reference=>({reference,path:record.path})));
  references.sort((a,b)=>a.reference.at[0]-b.reference.at[0]||a.reference.at[1]-b.reference.at[1]);
  for (const {reference,path} of references) if (!grammar.constants.has(reference.const)) {
    throw grammar.documentError(path,reference.at,`$${reference.const} is not defined in stage ${grammar.stageName}`);
  }
  /** @type {(name:string)=>TermType} */
  const types=name=>/** @type {StageConstant} */ (grammar.constants.get(name)).type;
  for (const phase of ['type','value']) {
    /** @type {{error:GencmuError,position:number[]}[]} */
    const faults=[];
    for (const record of records) {
      const {path,term,rule,at,tags,fragment}=record;
      try {
        if (phase==='type') {
          if (rule) {
            const fault=ruleTypeFault(resolveNode(rule,grammar.constants),types);
            if (fault) throw grammar.faultError(path,fault.node,at,fault.problem);
          } else {
            const found=termType(term,types);
            if ('problem' in found) throw grammar.faultError(path,found.node,at,found.problem);
            const problem=tags?expectedProblem(found.type,'tags'):null;
            if (problem) throw grammar.faultError(path,term,at,problem);
          }
        } else {
          grammar.checkValueUses(rule??term,path,at);
          if (fragment) {
            const checked=grammar.resolvePatterns(resolveNode(rule,grammar.constants),path,at);
            const problem=definitionProblem(checked,true);
            if (problem) throw grammar.documentError(path,at,problem);
          }
        }
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        const position=error.where.line===at[0]&&error.where.column===at[1] ? record.position??at
          : [error.where.line??at[0],error.where.column??at[1]];
        faults.push({error,position});
      }
    }
    faults.sort((a,b)=>a.position[0]-b.position[0]||a.position[1]-b.position[1]);
    if (faults.length) throw faults[0].error;
  }
}

/**
 * The names of the features that gate, in code point order, each once.
 * @param {Guard[]} guards
 * @returns {string[]}
 */
function gateNames(guards) {
  const names = new Set(guards.map((guard) => guard.feature));
  return [...names].sort(compareCodePoints);
}

/**
 * The value of a key in a bounded cache, now the most recently used.
 * @template T
 * @param {Map<string, T>} cache
 * @param {string} key
 * @returns {T | undefined}
 */
function recall(cache, key) {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

/**
 * Adds a value to a bounded cache, and drops the least recently used
 * value when the cache is full.
 * @template T
 * @param {Map<string, T>} cache
 * @param {string} key
 * @param {T} value
 */
function remember(cache, key, value) {
  cache.set(key, value);
  if (cache.size > MAX_LOWERED) cache.delete(/** @type {string} */ (cache.keys().next().value));
}

/** @param {any} node @returns {boolean} */
function hasPattern(node) {
  const stack = [node];
  while (stack.length) {
    const value = stack.pop();
    if (value && typeof value === "object") {
      if ("pattern" in value || value.op === "≅" || value.op === "≇") return true;
      for (const child of Object.values(value)) stack.push(child);
    }
  }
  return false;
}

/** @param {unknown} root @returns {boolean} */
function clauseNeedsResolution(root) {
  const pending = [root];
  while (pending.length) {
    const node = /** @type {Record<string, any> | undefined} */ (pending.pop());
    if (!node || typeof node !== "object") continue;
    if (typeof node.const === "string" || "pattern" in node || node.op === "≅" || node.op === "≇") return true;
    for (const child of clauseChildren(node)) pending.push(child);
  }
  return false;
}

const TYPE_PHRASES = { forest: "a witness forest", pattern: "a pattern", string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", emitted: "an emitted pair", condition: "a condition", set: "a set", any: "a value" };

/**
 * A copy of a clause in which every reference to a constant holds the
 * constant's value (engine §2).
 * @param {unknown} node
 * @param {Map<string, StageConstant>} constants
 * @returns {unknown}
 */
function resolveNode(node, constants) {
  if (Array.isArray(node)) return node.map((item) => resolveNode(item, constants));
  if (node === null || typeof node !== "object") return node;
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.const === "string") {
    /** @type {ConstantTerm} */
    const reference = { const: record.const, at: /** @type {[number, number]} */ (record.at), value: /** @type {StageConstant} */ (constants.get(record.const)).value };
    copyRankedLocation(record,reference);
    copyRecipeLocation(record,reference);
    return reference;
  }
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const [key, value] of Object.entries(record)) copy[key] = resolveNode(value, constants);
  copyRankedLocation(record,copy);
  copyRecipeLocation(record,copy);
  copyBoundaryLocation(record,copy);
  return copy;
}


/**
 * @param {string} name
 * @returns {boolean}
 */
export function isTerminalName(name) {
  const first = name.codePointAt(0);
  return name.startsWith("_") || (first !== undefined && first >= 0x41 && first <= 0x5a);
}

/**
 * The tag of a symbol that matches by a tag: a terminal, or a reference
 * whose name begins with a capital. A reference in lower case names a rule,
 * so it is never the terminator of an elidable optional (engine §2, §3.8).
 * @param {Expr} expr
 * @returns {string | undefined}
 */
function tagName(expr) {
  while ("test" in expr) expr = expr.expr;
  return "ref" in expr && isTerminalName(expr.ref) ? expr.ref : undefined;
}

// The lowered grammar: productions, numbered as engine §3 says.
class Lowering {
  /**
   * @param {Grammar} grammar
   * @param {Set<string>} features
   */
  constructor(grammar, features) {
    this.grammar = grammar;
    this.features = features;
    /** @type {Production[]} */
    this.productions = [];
    /** @type {any[]|undefined} */ this.treeSites = undefined;
    /** @type {Map<string, Production[]>} */
    this.byLhs = new Map();
    this.helperCount = 0;
    /** @type {Set<string>} the item captures of the alternative being lowered (engine §3.5) */
    this.itemNames = new Set();
    this.validation = false;
    this.helperExpressions = new Map();
    /** @type {Map<string, SequenceItem[][]>} */
    this.helperBodies = new Map();
    /** @type {Map<string, PendingHelper>} */
    this.pendingHelpers = new Map();
    /** @type {Map<string, number>} */
    this.helperOrder = new Map();
    /** @type {WeakMap<StitchedAlternative, Map<string, import("./types.js").Condition[]>>} */
    this.commonConditions = new WeakMap();
    /** @type {WeakMap<SequenceItem[],{group:import("./ranked.js").RankedGroup,option:number}>} */
    this.rankedSequences = new WeakMap();
    this.rankedHelpers = new Set();
    /** @type {Map<string,string>} */
    this.spliceNames = new Map();
    // The structural grammar (engine §3.3): every production that the gates
    // and the expansion make, before a false condition removes any, with
    // its symbols' tests ignored.
    /** @type {{lhs: string, rhs: import("./types.js").GrammarSymbol[], erased?:boolean}[]} */
    this.structural = [];
    // The item of each pair of braces, as its expansions, with the
    // definition that wrote it.
    /** @type {{items: SequenceItem[][], rule: StitchedRule, alternative: StitchedAlternative}[]} */
    this.braceItems = [];
  }

  /** @returns {Omit<LoweredGrammar, "classifiers" | "implications">} */
  run() {
    for (const rule of this.grammar.rules.values()) {
      // Only gates drop an alternative; a warning keeps it (engine §3.1).
      const enabled = rule.alternatives.filter((alternative) => alternative.guards.every(
        (guard) => this.features.has(guard.feature) !== guard.negated));
      // A chain is the only alternative of its rule that the gates leave
      // (engine §3.3); a %extend-rule can add another.
      const chain = enabled.find((alternative) => isChain(alternative.expr));
      if (chain && enabled.length > 1) {
        throw loweringError(chain.at, `${rule.name} is a chain, which is the whole of its rule, but another alternative stands beside it`);
      }
      for (const alternative of enabled) this.lowerAlternative(rule, alternative);
    }
    const terminals = new Set();
    /** @type {any[]} */
    const pending = [...this.grammar.rules.values()].flatMap(rule => rule.alternatives.flatMap(alt => [alt.clauses, alt.tags]));
    const seen = new Set();
    while (pending.length) {
      const part = pending.pop();
      if (!part || typeof part !== "object" || seen.has(part)) continue;
      seen.add(part);
      if (["matches", "begins", "ends"].includes(part.method)) for (const arg of part.args) if (arg.terminal) terminals.add(arg.terminal);
      for (const child of clauseChildren(part)) pending.push(child);
    }
    for (const name of this.grammar.queryTargets.values()) if (name.startsWith("\u0000query:")) terminals.add(name.slice(7));
    this.source = undefined;
    for (const [target,name] of this.spliceNames) {
      const originals=this.byLhs.get(target) ?? [];
      for (const original of originals) {
        const clone={...original,id:this.productions.length,lhs:name,helper:true,spliceOf:target,sourceId:original.sourceId ?? original.id};
        this.productions.push(clone);
        if (!this.byLhs.has(name)) this.byLhs.set(name,[]);
        this.byLhs.get(name)?.push(clone);
        this.structural.push({lhs:name,rhs:original.rhs,erased:original.erased});
      }
    }
    for (const terminal of [...terminals].sort(compareCodePoints)) {
      const name = "\u0000query:" + terminal;
      this.grammar.queryNames.set(name,terminal);
      this.addProduction({
        lhs: name, rhs: [{name: terminal, terminal: true}], helper: true,
        owner: name, elided: null, elidedTest: null,
        captures: [{name: "\u0000child", index: 0}], conditions: [],
        tags: {method: "tags", receiver: {capture: "\u0000child"}, args: []},
        emit: null, erased: false,
      });
    }
    for (const rule of this.grammar.queryRules.values()) {
      for (const alternative of rule.alternatives) this.lowerAlternative(rule,alternative);
      for (const production of this.byLhs.get(rule.name) ?? []) production.helper = true;
    }
    // A splice used only by an anonymous target is discovered after the
    // written aliases. Its target still uses the same original productions.
    for (const [target,name] of this.spliceNames) if (!this.byLhs.has(name)) {
      for (const original of this.byLhs.get(target) ?? []) {
        const clone={...original,id:this.productions.length,lhs:name,helper:true,spliceOf:target,sourceId:original.sourceId ?? original.id};
        this.productions.push(clone);
        if (!this.byLhs.has(name)) this.byLhs.set(name,[]);
        this.byLhs.get(name)?.push(clone);
        this.structural.push({lhs:name,rhs:original.rhs,erased:original.erased});
      }
    }
    for (const production of this.productions) production.treeRoot = !production.helper || !!production.spliceOf;
    this.checkBraceItems();
    this.contextual = this.productions.some((production) => production.contextual);
    if(this.grammar.treeComparisons)this.treeSites=[];
    prepareRankedFrames(this,this.grammar.ranked);
    if(this.grammar.treeComparisons) {
      prepareTreeDemands(this,rankedFrameTable({lowered:this}));
      const cycle=treeIdentityCycle(this);
      if(cycle) {
        const source=cycle.production.logicalSource ?? cycle.production.source;
        const location=boundaryLocations.get(cycle.comparison)?.at;
        const at={...source.at,...(location ? {line:location[0],column:location[1]} : {})};
        const error = loweringError(at,`tree comparison demands a cycle ${cycle.cycle.join(" → ")} that can repeat a demanded rule over one span`);
        if (!location) boundaryDocumentErrors.set(error,{document:source.document,node:cycle.comparison});
        throw error;
      }
    }
    return {
      productions: this.productions,
      contextual: this.contextual || this.grammar.ranked.groups.length > 0,
      treeComparisons: !!this.grammar.treeComparisons,
      byLhs: this.byLhs,
      resolution: /** @type {Resolution} */ (this.grammar.resolution),
      ranked: this.grammar.ranked,
      families: this.grammar.families,
      boundarySites:this.grammar.boundarySites,
      queryTargets:this.grammar.queryTargets,
      queryNames:this.grammar.queryNames,
    };
  }

  /**
   * Numbers a production and adds it, with its captures indexed by
   * position and by name: every advance and every read of a capture looks
   * one up, so a scan of the list would cost its length each time.
   * The conditions are grouped by when they are ready, so that an advance
   * looks only at its own.
   * @param {Omit<Production, "id" | "captureAt" | "captureSlot" | "conditionsAt">} fields
   * @returns {Production}
   */
  addProduction(fields) {
    if (fields.helper && this.source) this.structural.push({ lhs: fields.lhs, rhs: fields.rhs, erased:fields.erased });
    // Each position, capture and condition counts before it is indexed, so
    // that an index built by a scan of the list for each position fails
    // its budget.
    /** @type {number[]} */
    const captureAt = [];
    /** @type {import("./types.js").ReadyCondition[][]} */
    const conditionsAt = [[]];
    for (let index = 0; index < fields.rhs.length; index++) {
      if (hooks.work) countWork(hooks.work, "lowering");
      captureAt.push(-1);
      conditionsAt.push([]);
    }
    /** @type {Map<string, number>} */
    const captureSlot = new Map();
    fields.captures.forEach((capture, slot) => {
      if (hooks.work) countWork(hooks.work, "lowering");
      if (captureAt[capture.index] === -1) captureAt[capture.index] = slot;
      if (!captureSlot.has(capture.name)) captureSlot.set(capture.name, slot);
    });
    for (const condition of fields.conditions) {
      if (hooks.work) countWork(hooks.work, "lowering");
      conditionsAt[condition.readyAt + 1].push(condition);
    }
    /** @type {Production} */
    const production = { ...fields, captureAt, captureSlot, conditionsAt, id: this.productions.length };
    production.logicalSource = this.source;
    if (this.grammar.ranked.groups.length) {
      const source = this.source;
      Object.assign(production, {source, writtenExpression: fields.helper ? this.helperExpressions.get(fields.lhs) : source?.expr});
    }
    this.productions.push(production);
    let same = this.byLhs.get(production.lhs);
    if (!same) this.byLhs.set(production.lhs, (same = []));
    same.push(production);
    return production;
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   */
  lowerAlternative(rule, alternative) {
    /** @type {PendingHelper[]} */
    const pending = [];
    /** @type {Where} */
    const where = { rule, alternative, pending };
    this.source = alternative;
    this.itemNames = new Set(itemCaptures(alternative.expr).keys());
    const expr = alternative.expr;
    let sequences;
    if (isChain(expr)) {
      // A chain is recursion on the rule itself, with no helper: its base
      // productions first, one for each expansion of the item, then its
      // recursive ones (engine §3.3).
      const items = this.expand(expr.repeat, where);
      this.braceItems.push({ items, rule, alternative });
      const separators = expr.separator === undefined ? [[]] : this.expand(expr.separator, where);
      /** @type {SequenceItem[][]} */
      const self = [[{ symbol: { name: rule.name, terminal: false } }]];
      const recursive = expr.chain === "left" ? product(self, product(separators, items)) : product(product(items, separators), self);
      sequences = [...items, ...recursive];
    } else {
      sequences = this.expand(expr, where);
    }
    // Build each helper once before condition pruning examines reachability.
    for (let index = 0; index < pending.length; index++) {
      const helper = pending[index];
      this.pendingHelpers.set(helper.name, helper);
      this.helperOrder.set(helper.name, index);
      this.helperBodies.set(helper.name, helper.build(where));
    }
    for (const sequence of sequences) this.addRuleProduction(rule, alternative, sequence);
    if (pending.length) this.flushHelpers(sequences, rule, alternative);
  }

  /**
   * An item of braces that can derive the empty sequence is an error of
   * the grammar (engine §3.3). Nullability is decided over the structural
   * grammar, every production that the gates leave, reachable or not.
   */
  checkBraceItems() {
    /** @type {Set<string>} */
    const nullable = new Set();
    /** @type {(sequence: SequenceItem[]) => boolean} */
    const empty = (sequence) => {
      for (const { symbol } of sequence) {
        if (hooks.work) countWork(hooks.work, "closures");
        if (symbol.terminal || !nullable.has(symbol.name)) return false;
      }
      return true;
    };
    // A worklist: each production counts its symbols not yet known to be
    // nullable, and a rule found nullable counts down the productions that
    // name it. Passes over every production until none changes would settle
    // one rule per pass.
    /** @type {Map<string, number[]>} */
    const users = new Map();
    const unknown = this.structural.map((production) => production.rhs.length);
    /** @type {string[]} */
    const found = [];
    /** @type {(name: string) => void} */
    const add = (name) => {
      if (nullable.has(name)) return;
      nullable.add(name);
      found.push(name);
    };
    // Each production and each symbol it reads counts, so that a test of
    // every other symbol at each one fails its budget.
    this.structural.forEach((production, index) => {
      if (hooks.work) countWork(hooks.work, "closures");
      for (const symbol of production.rhs) {
        if (hooks.work) countWork(hooks.work, "closures");
        if (symbol.terminal) return;
      }
      if (production.rhs.length === 0) add(production.lhs);
      for (const symbol of production.rhs) {
        if (hooks.work) countWork(hooks.work, "closures");
        const list = users.get(symbol.name);
        if (list) list.push(index);
        else users.set(symbol.name, [index]);
      }
    });
    for (let name = found.pop(); name !== undefined; name = found.pop()) {
      for (const index of users.get(name) ?? []) {
        if (hooks.work) countWork(hooks.work, "closures");
        if (--unknown[index] === 0) add(this.structural[index].lhs);
      }
    }
    for (const { items, rule, alternative } of this.braceItems) {
      for (const sequence of items) {
        if (empty(sequence)) throw loweringError(alternative.at, `an item of braces in ${rule.name} can match no tokens`);
      }
    }
  }

  /**
   * The helpers directly used by expansions, in construction order.
   * @param {SequenceItem[][]} sequences
   * @returns {string[]}
   */
  usedHelpers(sequences) {
    const names = new Set();
    for (const sequence of sequences) for (const {symbol} of sequence) {
      if (hooks.work) countWork(hooks.work, "lowering");
      if (!symbol.terminal && this.helperBodies.has(symbol.name)) names.add(symbol.name);
    }
    return [...names].sort((a, b) => /** @type {number} */ (this.helperOrder.get(a)) - /** @type {number} */ (this.helperOrder.get(b)));
  }

  /**
   * @param {SequenceItem[][]} sequences
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   */
  flushHelpers(sequences, rule, alternative) {
    const stack = this.usedHelpers(sequences).reverse();
    const emitted = new Set();
    for (let name = stack.pop(); name !== undefined; name = stack.pop()) {
      if (emitted.has(name)) continue;
      emitted.add(name);
      const bodies = /** @type {SequenceItem[][]} */ (this.helperBodies.get(name));
      const helper = /** @type {PendingHelper} */ (this.pendingHelpers.get(name));
      const helperItems = [...new Set(bodies.flatMap((sequence) => sequence.flatMap((item) => item.capture && this.itemNames.has(item.capture) ? [item.capture] : [])))];
      for (const sequence of bodies) {
        // A helper with one symbol has that symbol's tags, like any
        // production (engine §3.7).
        const logical = logicalOf(sequence);
        const inherited = inheritedIndex(logical);
        const single = inherited !== null;
        const ranked = this.rankedSequences.get(sequence);
        // The item captures inside braces bind to the helper's productions
        // (engine §3.5), as do the captures of a ranked option.
        const captures = sequence.flatMap((item,index) => item.capture ? [{name:item.capture,index,...(item.captureTerminal?{terminal:true}:{})}] : []);
        const items = helperItems;
        if (single && captures.length === 0) captures.push({name:"\u0000child",index:/** @type {number} */ (inherited)});
        this.addProduction({
          lhs: helper.name,
          rhs: sequence.map((item) => item.symbol),
          logical,
          helper: true,
          owner: rule.name,
          elided: helper.elided,
          elidedTest: helper.elidedTest,
          elidedValue: helper.elidedValue,
          captures,
          conditions: [],
          tags: single ? { method: "tags", receiver: { capture: captures[0].name }, args: [] } : null,
          emit: null,
          erased: false,
          ...(ranked ? {rankedGroup:ranked.group,rankedOption:ranked.option} : {}),
          // Every helper of an alternative with item captures is contextual,
          // so that a frame reaches the braces' helper through the helpers
          // around it, and its item conditions read the enclosing item's
          // captures from the frame (engine §4).
          ...(this.itemNames.size ? {contextual: true} : {}),
          ...(items.length ? {itemAlternative: alternative, itemNames: items,
            itemConditions: alternative.clauses.conditions.filter((condition) => capturesMentioned(condition).some((name) => items.includes(name)))} : {}),
        });
      }
      const children = this.usedHelpers(bodies);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   * @param {SequenceItem[]} sequence
   */
  addRuleProduction(rule, alternative, sequence) {
    this.structural.push({ lhs: rule.name, rhs: sequence.map((item) => item.symbol), erased:alternative.clauses.erased });
    /** @type {import("./types.js").Capture[]} */
    const captures = [];
    sequence.forEach((item, index) => {
      if (item.capture) captures.push({ name: item.capture, index,...(item.captureTerminal?{terminal:true}:{}) });
    });
    // `$`, the whole constituent, is a capture every production has.
    const names = new Set(["", ...captures.map((capture) => capture.name)]);
    const clauses = alternative.clauses;
    // The clauses simplified for this production: presence tests and the
    // guards over them decided (engine §3.6).
    /** @type {(name: string) => boolean} */
    const has = (name) => names.has(name);
    // The union of the alternative's own tags and the rule's (engine §3.7);
    // the reader has made sure neither uses a capture this production lacks.
    // Each clause is prepared once for all productions, so that one costs
    // its own captures and output, not every part of the clause.
    const alternativeTags = alternative.tags === undefined ? null : simplifyFor(prepareClause(alternative.tags), has, names);
    const definitionTags = clauses.tags === undefined ? null : simplifyFor(prepareClause(clauses.tags), has, names);
    const written = [definitionTags, alternativeTags].filter((term) => term !== null);
    /** @type {Term | null} */
    let tags = written.length === 0 ? null : written.length === 1 ? written[0] : { union: written };
    const logical = logicalOf(sequence);
    const inherited = inheritedIndex(logical);
    if (!tags && inherited !== null) {
      // A production with one symbol has that symbol's tags (engine §3.7),
      // whether or not the author captured it.
      let child = captures.find(capture => capture.index === inherited);
      if (!child) {
        child = {name:"\u0000child",index:inherited};
        captures.push(child);
        names.add(child.name);
      }
      tags = {method:"tags",receiver:{capture:child.name},args:[]};
    }
    // Each capture's position, looked up once for every variable of every
    // condition.
    /** @type {Map<string, number>} */
    const positionOf = new Map();
    for (const capture of captures) if (!positionOf.has(capture.name)) positionOf.set(capture.name, capture.index);
    /** @type {import("./types.js").ReadyCondition[]} */
    const conditions = [];
    // The conditions not true for this production, in order (engine §3.6).
    const privateNames = new Set();
    const seen = new Set();
    const pending = this.grammar.ranked.groups.length ? this.usedHelpers([sequence]) : [];
    while (pending.length) {
      const name = /** @type {string} */ (pending.pop());
      if (seen.has(name)) continue;
      seen.add(name);
      const expr = this.helperExpressions.get(name);
      const group = expr && this.grammar.ranked.byExpression.get(expr);
      if (group) for (const capture of group.captures) privateNames.add(capture);
      for (const child of this.usedHelpers(/** @type {SequenceItem[][]} */ (this.helperBodies.get(name)))) pending.push(child);
    }
    let commonConditions = clauses.conditions;
    if (privateNames.size) {
      let cached = this.commonConditions.get(alternative);
      if (!cached) this.commonConditions.set(alternative, cached = new Map());
      const key = JSON.stringify([...privateNames].sort());
      let common = cached.get(key);
      if (!common) {
        common = clauses.conditions.filter(c => ![...rankedCaptureReads(c)].some(n => privateNames.has(n)));
        cached.set(key, common);
      }
      commonConditions = common;
    }
    // An item condition attaches to the helper of its braces (engine §3.6).
    if (this.itemNames.size) commonConditions = commonConditions.filter((c) => !capturesMentioned(c).some((name) => this.itemNames.has(name)));
    for (const condition of partsFor(prepareConditions(commonConditions), has, names)) {
      // A condition false for this production removes it.
      if (condition === DOM_FALSE) return;
      const variables = conditionVariables(condition);
      if (!variables.every((name) => names.has(name))) continue;
      // A condition is ready once its last capture is read, and one that
      // reads `$` once the constituent is complete (engine §4).
      let readyAt = -1;
      for (const name of variables) {
        readyAt = Math.max(readyAt, name === "" ? sequence.length - 1 : /** @type {number} */ (positionOf.get(name)));
      }
      conditions.push({ condition, readyAt });
    }
    let emit = clauses.emit || null;
    if (emit) {
      // An item whose carrier the production lacks is dropped, and so is
      // each attachment capture it lacks (engine §3.6); the reader has made
      // sure the tags of those left use none.
      const items = emit.items;
      emit = {
        items: presentItems(items, has, names).map((index) => items[index])
          .map((item) => {
            /** @type {import("./types.js").EmitItem} */
            const kept = item.tags ? { ...item, tags: simplifyFor(prepareClause(item.tags), has, names) } : { ...item };
            const before = (item.before ?? []).filter(has);
            const after = (item.after ?? []).filter(has);
            if (before.length) kept.before = before;
            else delete kept.before;
            if (after.length) kept.after = after;
            else delete kept.after;
            return kept;
          }),
      };
    }
    const fields = {
      lhs: rule.name,
      rhs: sequence.map((item) => item.symbol),
      logical,
      helper: false,
      owner: rule.name,
      elided: null,
      elidedTest: null,
      captures,
      conditions,
      tags,
      writtenTags: written,
      emit,
      erased: clauses.erased,
      value: alternative.value ?? clauses.value,
      image: alternative.image ?? clauses.image,
      error:clauses.error, warning:clauses.warning, suppressWarnings:clauses.suppressWarnings,
    };
    let variants;
    try { variants=guardedTagVariants(tags); }
    catch (error) { throw this.grammar.documentError(alternative.document,[alternative.at.line ?? 0,alternative.at.column ?? 0],/** @type {Error} */ (error).message); }
    const sourceId=this.productions.length;
    for (const variant of variants) {
      const extra=variant.conditions.map(condition=>({condition,readyAt:sequence.length-1}));
      this.addProduction({...fields,tags:variant.tags,conditions:[...conditions,...extra],guardConditions:extra,sourceId});
    }
  }

  /**
   * The sequences of symbols an expression expands to.
   * @param {Expr} expr
   * @param {Where} where
   * @returns {SequenceItem[][]}
   */
  expand(expr, where) {
    if ("seq" in expr) return this.expandSequence(expr.seq, where);
    if ("choice" in expr) return expr.choice.flatMap((item) => this.expand(item, where));
    if ("ranked" in expr) {
      const group = /** @type {import("./ranked.js").RankedGroup} */ (this.grammar.ranked.byExpression.get(expr));
      if (!this.rankedHelpers.has(group.helper)) {
        this.rankedHelpers.add(group.helper);
        this.helperExpressions.set(group.helper,expr);
        where.pending.push({name:group.helper,elided:null,elidedTest:null,build:context => expr.ranked.flatMap((option,index) => this.expand(option,context).map(sequence => {
          this.rankedSequences.set(sequence,{group,option:index});return sequence;
        }))});
      }
      return [[{symbol:{name:group.helper,terminal:false}}]];
    }
    if ("and" in expr) {
      const parts = expr.and.map((item) => this.expand(item, where));
      /** @type {SequenceItem[][]} */
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        /** @type {SequenceItem[][]} */
        let sequences = [[]];
        parts.forEach((part, index) => {
          if (mask & (1 << index)) sequences = extendAll(sequences, part);
        });
        for (const sequence of sequences) result.push(sequence);
      }
      return result;
    }
    if ("optional" in expr) {
      const inner = expr.optional;
      if (expr.elidable && "capture" in inner) {
        const elided=this.elidedTerminal(inner.expr,where,expr.default);
        this.helperExpression=expr;
        const name=this.helper(where,context=>[[],...this.expand(inner,context)],elided);
        return [
          [{symbol:{name,terminal:false,optionalRoute:"empty"}}],
          [{symbol:{name,terminal:false,optionalRoute:"written"},capture:inner.capture,captureTerminal:true}],
        ];
      }
      // A plain optional that holds a capture expands in place, as (ε | x)
      // would: first the empty sequence, then each expansion of x
      // (engine §3.2).
      if (expr.elidable !== true && holdsCapture(inner)) {
        const routes = [/** @type {SequenceItem[]} */ ([]),...this.expand(inner,where)];
        for (const route of routes) optionalLogical(route,expr);
        return routes;
      }
      if (expr.elidable !== true && this.grammar.ranked.groups.length && holdsCapture(inner, true)) {
        // Keep one helper symbol for tag arity, but give each route its own
        // helper. Its reachable ranked groups then determine known absence.
        return [[], ...this.expand(inner, where)].map(sequence => {
          this.helperExpression = expr;
          const name = this.helper(where, () => [sequence], null);
          return [{symbol:{name,terminal:false}}];
        });
      }
      // Any other optional is a helper, and a marked one is elidable, with
      // the terminal that its marker names
      // (engine §3.8).
      const elided = expr.elidable === true ? this.elidedTerminal(inner, where, expr.default) : null;
      this.helperExpression = expr;
      const name = this.helper(where, (context) => [/** @type {SequenceItem[]} */ ([]), ...this.expand(inner, context)], elided);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("repeat" in expr) {
      // Flat braces are a helper, `h → x | h s x`, its base productions
      // first; the places inside the item come before those inside the
      // separator (engine §3.2).
      const item = expr.repeat;
      const separator = expr.separator;
      this.helperExpression = expr;
      const name = this.helper(where, (context) => {
        const items = this.expand(item, context);
        this.braceItems.push({ items, rule: context.rule, alternative: context.alternative });
        const separators = separator === undefined ? [[]] : this.expand(separator, context);
        /** @type {SequenceItem[]} */
        const self = [{ symbol: { name, terminal: false } }];
        return [...items, ...product(product([self], separators), items)];
      }, null);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("empty" in expr) return [[]];
    if ("test" in expr) {
      // A tested symbol lowers to its symbol with the test, and adds no
      // helper (engine §3).
      const inner = this.expand(expr.expr, where);
      const test = this.grammar.symbolTest(expr, where.rule.document, where.rule.at);
      return [[{ symbol: { ...inner[0][0].symbol, test } }]];
    }
    if ("splice" in expr) {
      if (!("ref" in expr.splice)) throw loweringError(where.alternative.at,"a splice requires a resolved rule reference");
      const target=expr.splice.ref;
      let name=this.spliceNames.get(target);
      if (name===undefined) {name="\u0000splice:"+target;this.spliceNames.set(target,name);}
      return [[{symbol:{name,terminal:false}}]];
    }
    if ("ref" in expr) return [[{ symbol: { name: expr.ref, terminal: isTerminalName(expr.ref) } }]];
    // A range or a property is a terminal whose name is its written form,
    // and which matches by its characters rather than by a tag (engine §4).
    if ("literal" in expr) {
      const value = /** @type {{string: string}} */ (this.grammar.evaluateClosed(where.rule.document, expr.literal, [where.rule.at.line ?? 0, where.rule.at.column ?? 0]));
      return [[{ symbol: { name: stringName(value.string, this.grammar.unicode), terminal: true, literal: value.string } }]];
    }
    if ("wildcard" in expr) return [[{ symbol: { name: "_", terminal: true, wildcard: true } }]];
    if ("range" in expr) {
      const values = expr.range.map(end => this.grammar.evaluateClosed(where.rule.document, end, [where.rule.at.line ?? 0, where.rule.at.column ?? 0]));
      const strings = values.map(value => /** @type {{string: string}} */ (value).string);
      const characters = { from: /** @type {number} */ (strings[0].codePointAt(0)), to: /** @type {number} */ (strings[1].codePointAt(0)) };
      const name = strings.map(value => stringName(value, this.grammar.unicode)).join("..");
      return [[{ symbol: { name, terminal: true, characters } }]];
    }
    if ("capture" in expr) {
      const inner = this.expand(expr.expr, where);
      return [[{ symbol: inner[0][0].symbol, capture: expr.capture }]];
    }
    throw loweringError(where.alternative.at, `an unknown expression in ${where.rule.name}`);
  }

  /**
   * @param {Expr[]} items
   * @param {Where} where
   * @returns {SequenceItem[][]}
   */
  expandSequence(items, where) {
    /** @type {SequenceItem[][]} */
    let sequences = [[]];
    for (const item of items) sequences = extendAll(sequences, this.expand(item, where));
    return sequences;
  }

  /**
   * Names a helper rule, to be lowered when the alternative is done.
   * @param {Where} where
   * @param {(where: Where) => SequenceItem[][]} build
   * @param {{terminal: string, test: SymbolTest | null, value?:string} | null} elided
   * @returns {string}
   */
  helper(where, build, elided) {
    const name = `${where.rule.name}·${this.helperCount++}`;
    if (this.grammar.ranked.groups.length && this.helperExpression) this.helperExpressions.set(name, this.helperExpression);
    where.pending.push({ name, build, elided: elided ? elided.terminal : null, elidedTest: elided ? elided.test : null, elidedValue:elided?.value });
    return name;
  }

  /**
   * The terminal of an elidable optional, the first item of its content,
   * and its complete symbol predicate (engine §3.8, §12).
   * @param {Expr} expr
   * @param {Where} where
   * @param {import("./types.js").Term} [defaultValue]
   * @returns {{terminal: string, test: SymbolTest | null, value?:string}}
   */
  elidedTerminal(expr, where, defaultValue) {
    const first = "capture" in expr ? expr.expr : "seq" in expr ? expr.seq[0] : expr;
    const tested = "test" in first ? first : null;
    const name = tagName(tested ? tested.expr : first);
    if (name === undefined) throw loweringError(where.alternative.at, `an elidable optional in ${where.rule.name} does not begin with its terminator`);
    const test = tested ? this.grammar.symbolTest(tested, where.rule.document, where.rule.at) : null;
    const resolved = defaultValue === undefined ? undefined : this.grammar.evaluateClosed(where.rule.document, defaultValue, recipeLocations.get(defaultValue) ?? [0,0]);
    if (resolved !== undefined && !("string" in resolved)) throw loweringError(where.rule.at, "a default requires one string");
    const value = resolved && "string" in resolved ? resolved.string : test?.op === "=" ? test.value : undefined;
    if (defaultValue !== undefined) {
      /** @type {(t:SymbolTest|null)=>boolean} */
      const holds = (t) => !t || (!t.inner || holds(t.inner)) && (t.op === "tags" ? [...t.positive ?? []].every(tag => tag === name) && !t.negative?.has(name) : (value === t.value) === (t.op === "="));
      if (!holds(test)) {
        const at = recipeLocations.get(defaultValue);
        throw new GencmuError("grammar", "a default fails its head test", {document:where.rule.document,...(at ? {line:at[0],column:at[1]} : {})});
      }
    }
    return { terminal: name, test, value };
  }
}

/**
 * @param {SequenceItem[][]} left
 * @param {SequenceItem[][]} right
 * @returns {SequenceItem[][]}
 */
function product(left, right) {
  /** @type {SequenceItem[][]} */
  const result = [];
  for (const a of left) {
    for (const b of right) {
      // Each symbol copied counts before it is copied.
      /** @type {SequenceItem[]} */
      const sequence = [];
      for (const part of [a, b]) {
        for (const item of part) {
          if (hooks.work) countWork(hooks.work, "lowering");
          sequence.push(item);
        }
      }
      joinedLogical(sequence,logicalOf(a),logicalOf(b),a.length);
      result.push(sequence);
    }
  }
  return result;
}

/**
 * The product of sequences that the caller owns with others, made by
 * extending each owned sequence in place where it continues one way. A
 * copy of the growing prefix at each item would cost the square of a
 * sequence's length. A sequence that continues several ways is copied for
 * all but the last.
 * @param {SequenceItem[][]} left owned, and changed
 * @param {SequenceItem[][]} right only read
 * @returns {SequenceItem[][]}
 */
function extendAll(left, right) {
  /** @type {SequenceItem[][]} */
  const result = [];
  for (const a of left) {
    const logical = logicalOf(a);
    const offset = a.length;
    for (let index = 0; index < right.length; index++) {
      /** @type {SequenceItem[]} */
      let sequence = a;
      if (index < right.length - 1) {
        sequence = [];
        for (const item of a) {
          if (hooks.work) countWork(hooks.work, "lowering");
          sequence.push(item);
        }
      }
      const suffix = logicalOf(right[index]);
      for (const item of right[index]) {
        if (hooks.work) countWork(hooks.work, "lowering");
        sequence.push(item);
      }
      joinedLogical(sequence,logical,suffix,offset,sequence===a);
      result.push(sequence);
    }
  }
  return result;
}

/**
 * An error of the grammar that lowering finds (engine §3). A parse reports
 * it as a result, whose error has no position of its own (docs/output.md),
 * so the message names the document, line and column of the definition
 * that wrote the alternative.
 * @param {ErrorLocation} at
 * @param {string} message
 * @returns {GencmuError}
 */
function loweringError(at, message) {
  return new GencmuError("grammar", `${at.document}:${at.line}:${at.column}: ${message}`, at);
}

/**
 * Whether an expression holds a capture, at any depth (engine §3.5).
 * @param {Expr} expr
 * @param {boolean} [includeRanked]
 * @returns {boolean}
 */
function holdsCapture(expr, includeRanked = false) {
  if ("ranked" in expr && !includeRanked) return false;
  // An item capture binds to the helper of its braces, not to the
  // enclosing production (engine §3.5).
  if ("repeat" in expr) return false;
  if ("capture" in expr) return true;
  return expressionChildren(expr).some(child => holdsCapture(child, includeRanked));
}

/**
 * Whether an expression is a chain, `{... x / s}` or `{x ... / s}`.
 * @param {Expr} expr
 * @returns {expr is {repeat: Expr, separator?: Expr, chain: "left" | "right"}}
 */
function isChain(expr) {
  return "repeat" in expr && expr.chain !== undefined;
}

/**
 * The captures a term or condition names.
 * @param {Term | Condition} term
 * @returns {string[]}
 */
export function termVariables(term) {
  /** @type {string[]} */
  const names = [];
  /** @type {(node: unknown) => void} */
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (node);
    if (typeof record.capture === "string" && Object.keys(record).length === 1) names.push(record.capture);
    for (const value of clauseChildren(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(term);
  return names;
}

/**
 * @param {Condition} condition
 * @returns {string[]}
 */
export function conditionVariables(condition) {
  return termVariables(condition);
}
