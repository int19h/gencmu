// Checks of a stitched format 50 stage that need the whole stage: the
// types of truth positions, the constant graph, classifier receivers,
// output masks, engine keys and capture scope (docs/notation.md, "Errors before recognition").
// A check whose answer depends on the features of a parse returns the
// expression, and the stage checks it again before recognition.

import { GencmuError } from "../errors.js";
import { captureKinds } from "./stage.js";
import { isCompoundCapture50 } from "./validate.js";
import { isPatternSet } from "./evaluate.js";

const NO_TRUTH = new Map([["string", "A string"], ["number", "A number"], ["pattern", "A pattern"], ["function", "A function"]]);
const SPAN_VALUED = new Set(["span", "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens"]);
const TRUTH_METHODS = new Set(["has", "has-value", "present", "any", "all", "starts-input", "ends-input", "overlaps", "followed-by", "preceded-by"]);
const BAG_METHODS = new Set(["keys", "flags", "classes", "select", "classify", "union"]);
const NODE_METHODS = new Set([
  "span", "children", "keys", "flags", "classes", "select", "has", "has-value", "tokens", "first-token", "last-token",
  "tokens-after-first", "onward", "following-tokens", "preceding-tokens", "starts-input", "ends-input", "source-text",
  "decomposed-source-text", "verbatim-text", "parse", "without-elision", "without-elision-except", "followed-by", "preceded-by",
]);
const STRING_METHODS = new Set(["join", "source-text", "decomposed-source-text", "verbatim-text"]);

/**
 * @param {any} description
 * @param {any} document
 * @param {any} at
 */
function located(description, document, at) {
  return new GencmuError("grammar", description, { document, ...(at ? { line: at[0], column: at[1] } : {}) });
}

export class StageCheck {
  /**
   * @param {Map<string, {record: any, document: string}[]>} constants
   */
  constructor(constants) {
    /** @type {Map<string, any[]>} */
    this.constants = constants;
    /** @type {Map<string, RuleBag>} the bag type of each rule of the stage */
    this.bags = new Map();
  }

  /**
   * @param {any} name
   * @param {any} [version]
   */
  constantValue(name, version) {
    const versions = this.constants.get(name);
    if (!versions) return undefined;
    return versions[version ?? versions.length - 1];
  }

  /**
   * The possible types of an expression, as a set of names.
   * @param {any} node
   * @param {any} ctx
   * @returns {any}
   */
  typeOf(node, ctx) {
    /** @param {any} name */
    const one = name => new Set([name]);
    if (!node || typeof node !== "object") return one("unknown");
    if (node.string !== undefined) return one("string");
    if (node.integer !== undefined) return one("number");
    if (node.pattern !== undefined || node.emptySet) return one("pattern");
    if (node.lambda !== undefined) return one("function");
    if (node.bag) return one("bag");
    if (node.list) return one("list");
    if (node.concat) return one("string");
    if (node.not !== undefined || node.all || node.any) return one("truth");
    if (node.if !== undefined && node.else === undefined) return one("truth");
    if (node.if !== undefined) return new Set([...this.typeOf(node.then, ctx), ...this.typeOf(node.else, ctx)]);
    if (node.op !== undefined) return one(node.op === "+" ? "number" : "truth");
    if (node.union || node.intersection) return one("bag");
    if (node.difference) return this.typeOf(node.difference[0], ctx);
    if (node.map !== undefined || node.flatten !== undefined) return one("list");
    if (node.capture !== undefined) {
      if (node.capture === "") return one("node");
      if (ctx.names?.has(node.capture)) return ctx.names.get(node.capture);
      return one(ctx.captures?.get(node.capture) === "list" ? "list" : "node");
    }
    if (node.item) return ctx.item ?? one("unknown");
    if (node.const !== undefined) {
      if (node.const === "INPUTS") return one("bag");
      const version = this.constantValue(node.const, ctx.constant?.name === node.const ? ctx.constant.index - 1 : undefined);
      if (!version) return one("unknown");
      if (ctx.active?.has(version)) return one("unknown");
      const active = new Set([...(ctx.active ?? []), version]);
      return this.typeOf(version.record.value, { constant: { name: node.const, index: /** @type {any[]} */ (this.constants.get(node.const)).indexOf(version) }, active });
    }
    if (node.apply !== undefined) return one("unknown");
    if (node.param !== undefined) return one("unknown");
    if (node.property !== undefined) return this.propertyType(node, ctx);
    if (node.method !== undefined) {
      const name = node.method;
      if (SPAN_VALUED.has(name)) return one("span");
      if (name === "tokens" || name === "children" || name === "split" || name === "ngrams") return one("list");
      if (TRUTH_METHODS.has(name)) return one("truth");
      if (BAG_METHODS.has(name)) return one("bag");
      if (STRING_METHODS.has(name)) return one("string");
      if (name === "at-most") return one("number");
      if (name === "parse" || name === "error-free") return one("forest");
      return one("unknown");
    }
    return one("unknown");
  }

  /**
   * @param {any} node
   * @param {any} ctx
   */
  propertyType(node, ctx) {
    const key = node.property;
    const receiver = node.receiver;
    if (receiver?.const !== undefined) {
      const version = this.constantValue(receiver.const);
      const value = version?.record.value;
      if (value?.bag) {
        const types = new Set();
        let open = false;
        for (const entry of value.bag) {
          if (entry.kind === "bare" && entry.key === key) types.add("truth");
          else if (entry.kind === "write" && entry.keys.includes(key)) for (const type of this.typeOf(entry.value, {})) types.add(type);
          else if (entry.kind === "splat" || entry.kind === "copy") open = true;
        }
        if (open) types.add("unknown");
        if (!types.size) types.add("truth");
        return types;
      }
      return new Set(["unknown"]);
    }
    if (key === "value" || key === "image") {
      const types = receiver ? this.typeOf(receiver, ctx) : ctx.item;
      if (types && [...types].every(type => type === "node")) return new Set(["string"]);
      return new Set(["unknown"]);
    }
    // A payload of a captured node has the types of the key in the bags of
    // the rules that the capture binds. Without a valued route, the read
    // is a test of the key (engine §10).
    const name = receiver?.capture;
    const rules = name !== undefined && name !== "" && !ctx.names?.has(name) && ctx.captures?.get(name) === "one" ?
      ctx.captureRules?.get(name) : undefined;
    if (rules) {
      /** @type {Set<string>} */
      const types = new Set();
      for (const rule of rules) {
        const bag = this.bags.get(rule);
        const states = bag?.keys.get(key);
        if (!bag || !states && bag.open) return new Set(["unknown"]);
        for (const state of states ?? []) if (state !== "absent" && state !== "bare") types.add(state);
      }
      return types.size ? types : new Set(["truth"]);
    }
    return new Set(["unknown"]);
  }

  /**
   * The bag type of each rule of the stage (engine §10): for each key, the
   * states "absent" and "bare" that it can have, and the types of its
   * payloads. In an open bag, a key that is not listed can have any payload.
   * The sources apply in order: the defaults, the primary or the sole
   * symbol, the statement term and the alternative term. The type is a
   * union over the alternatives of every written definition, so it
   * over-approximates. A template, an instance binding, a call and a
   * terminal give an open bag.
   * @param {{rule: any}[]} rules
   */
  ruleBags(rules) {
    /** @type {Map<string, RuleBag>} */
    const bags = new Map();
    for (const { rule } of rules) if (!rule.params && !rule.instance && !bags.has(rule.name)) bags.set(rule.name, { keys: new Map(), open: false });
    for (const { rule } of rules) if (rule.params || rule.instance) bags.set(rule.name, { keys: new Map(), open: true });
    this.bags = bags;
    const defaults = this.constantValue("DEFAULTS")?.record.value;
    const defaultEntries = defaults?.lambda !== undefined && defaults.body?.bag ? defaults.body.bag : null;
    // The types only grow, so the loop ends. A bound keeps a cycle of
    // copies from running long, and then every bag is open.
    for (let round = 0; ; round++) {
      let changed = false;
      for (const { rule } of rules) {
        if (rule.params || rule.instance) continue;
        const bag = /** @type {RuleBag} */ (bags.get(rule.name));
        for (const alternative of rule.alternatives ?? []) {
          const next = this.alternativeBag(rule, alternative, defaultEntries);
          if (next.open && !bag.open) {
            bag.open = true;
            changed = true;
          }
          for (const key of new Set([...bag.keys.keys(), ...next.keys.keys()])) {
            const states = next.keys.get(key) ?? new Set(next.open ? ["unknown"] : ["absent"]);
            if (!bag.keys.has(key)) bag.keys.set(key, new Set(bag.open && !states.has("absent") ? ["unknown"] : []));
            const known = /** @type {Set<string>} */ (bag.keys.get(key));
            for (const state of states) if (!known.has(state)) {
              known.add(state);
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
      if (round > 64) {
        for (const bag of bags.values()) bag.open = true;
        break;
      }
    }
    return bags;
  }

  /**
   * The bag type of one alternative of a rule.
   * @param {any} rule
   * @param {any} alternative
   * @param {any[] | null} defaultEntries
   * @returns {RuleBag}
   */
  alternativeBag(rule, alternative, defaultEntries) {
    /** @type {RuleBag} */
    const bag = { keys: new Map(), open: false };
    const captureRules = new Map();
    captureRuleSets(alternative.expr, captureRules);
    const ctx = { captures: captureKinds(alternative.expr), captureRules };
    if (defaultEntries === null) bag.open = true;
    else for (const entry of defaultEntries) this.applyEntry(bag, entry, {});
    if (rule.erased) for (const key of ["value", "image"]) bag.keys.set(key, new Set(["string"]));
    const terms = [rule.term, alternative.term].filter(Boolean);
    const primaries = primarySymbols(alternative.expr);
    const suppliers = primaries.length ? primaries : terms.length ? null : soleSymbols(alternative.expr);
    // Where the check cannot tell which symbol supplies the bag, any key
    // can stand with any payload.
    if (suppliers === undefined) this.overlay(bag, { keys: new Map(), open: true });
    else if (suppliers !== null) this.overlay(bag, this.unionBag(suppliers.map((/** @type {any} */ symbol) => this.symbolBag(symbol))));
    for (const term of terms) for (const entry of term.bag) this.applyEntry(bag, entry, ctx);
    return bag;
  }

  /**
   * The bag type of a symbol of a body.
   * @param {any} symbol
   * @returns {RuleBag}
   */
  symbolBag(symbol) {
    if (typeof symbol.ref === "string" && /^[a-z]/.test(symbol.ref)) return this.bags.get(symbol.ref) ?? { keys: new Map(), open: true };
    // A token or a call: its value and image are strings, and its other
    // keys come from outside this stage or from the template.
    return { keys: new Map([["value", new Set(["string"])], ["image", new Set(["string"])]]), open: true };
  }

  /**
   * Applies a later source to a bag type: each key that the source can
   * hold replaces the earlier states, and an absent state keeps them.
   * @param {RuleBag} bag
   * @param {RuleBag} source
   */
  overlay(bag, source) {
    for (const [key, states] of source.keys) {
      const present = [...states].filter(state => state !== "absent");
      const earlier = bag.keys.get(key) ?? new Set(bag.open ? ["unknown"] : ["absent"]);
      bag.keys.set(key, new Set(states.has("absent") ? [...earlier, ...present] : present));
    }
    if (source.open) {
      // Any other key of the source can replace an earlier state.
      for (const [key, states] of bag.keys) if (!source.keys.has(key)) states.add("unknown");
      bag.open = true;
    }
  }

  /**
   * Applies one entry of a constructor to a bag type, in written order. A
   * guard or a gate keeps the earlier states beside the new ones.
   * @param {RuleBag} bag
   * @param {any} entry
   * @param {any} ctx
   */
  applyEntry(bag, entry, ctx) {
    const conditional = !!entry.guard || !!entry.gates?.length;
    /** @param {string} key @param {Iterable<string>} states */
    const set = (key, states) => {
      const earlier = bag.keys.get(key) ?? new Set(bag.open ? ["unknown"] : ["absent"]);
      bag.keys.set(key, new Set(conditional ? [...earlier, ...states] : states));
    };
    if (entry.kind === "write") {
      const types = [...this.typeOf(entry.value, ctx)];
      for (const key of entry.keys) set(key, types);
    } else if (entry.kind === "bare") set(entry.key, ["bare"]);
    else if (entry.kind === "delete") set(entry.key, ["absent"]);
    else if (entry.kind === "copy") {
      const source = this.valueBag(entry.source, ctx);
      const states = source.keys.get(entry.key) ?? new Set(source.open ? ["unknown", "absent"] : ["absent"]);
      // A copy from an absent key writes nothing.
      const earlier = bag.keys.get(entry.key) ?? new Set(bag.open ? ["unknown"] : ["absent"]);
      const present = [...states].filter(state => state !== "absent");
      bag.keys.set(entry.key, new Set(conditional || states.has("absent") ? [...earlier, ...present] : present));
    } else if (entry.kind === "splat") {
      const source = this.valueBag(entry.value, ctx);
      if (conditional) {
        const copy = { keys: new Map([...bag.keys].map(([key, states]) => [key, new Set(states)])), open: bag.open };
        this.overlay(copy, source);
        for (const [key, states] of copy.keys) for (const state of bag.keys.get(key) ?? new Set(bag.open ? ["unknown"] : ["absent"])) states.add(state);
        bag.keys = copy.keys;
        bag.open = copy.open;
      } else this.overlay(bag, source);
    }
  }

  /**
   * The union of bag types, for a node that one of several symbols gives.
   * @param {RuleBag[]} sources
   * @returns {RuleBag}
   */
  unionBag(sources) {
    if (sources.length === 1) return sources[0];
    /** @type {RuleBag} */
    const bag = { keys: new Map(), open: sources.some(source => source.open) };
    for (const source of sources) for (const key of source.keys.keys()) if (!bag.keys.has(key)) bag.keys.set(key, new Set());
    for (const [key, states] of bag.keys) {
      for (const source of sources) for (const state of source.keys.get(key) ?? (source.open ? ["unknown", "absent"] : ["absent"])) states.add(state);
    }
    return bag;
  }

  /**
   * The bag type of an expression that a copy or a splat reads.
   * @param {any} node
   * @param {any} ctx
   * @returns {RuleBag}
   */
  valueBag(node, ctx) {
    const name = node?.capture;
    const rules = name !== undefined && name !== "" && ctx.captures?.get(name) === "one" ? ctx.captureRules?.get(name) : undefined;
    if (rules) return this.unionBag([...rules].map(rule => this.bags.get(rule) ?? { keys: new Map(), open: true }));
    if (node?.bag) {
      /** @type {RuleBag} */
      const bag = { keys: new Map(), open: false };
      for (const entry of node.bag) this.applyEntry(bag, entry, ctx);
      return bag;
    }
    return { keys: new Map(), open: true };
  }

  /**
   * Checks an expression in a truth position.
   * @returns {any | null} the expression, where the answer depends on the features
   * @param {any} node
   * @param {any} ctx
   * @param {any} document
   */
  truth(node, ctx, document, what = "truth") {
    const types = this.typeOf(node, ctx);
    const bad = [...types].filter(type => NO_TRUTH.has(type));
    if (bad.length && bad.length === types.size) {
      const kind = /** @type {string} */ (NO_TRUTH.get(bad[0]));
      throw located(what === "guard" ? `${kind.toLowerCase()} cannot serve as a guard` : `${kind.toLowerCase()} does not convert to truth`,
        ctx.document ?? document, node.at ?? ctx.at);
    }
    return bad.length ? node : null;
  }

  /**
   * Walks an expression: checks each truth position in it, and each method
   * receiver that the types decide.
   * @param {any} node
   * @param {any} ctx
   * @param {any} document
   * @param {any} deferred
   * @returns {any}
   */
  walk(node, ctx, document, deferred, truthPosition = false) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) this.walk(item, ctx, document, deferred);
      return;
    }
    if (truthPosition) {
      const later = this.truth(node, ctx, document);
      if (later) deferred.push({ node: later, ctx, document });
    }
    if (node.method === "present" && node.receiver && this.typeOf(node.receiver, ctx).has("span") &&
        this.typeOf(node.receiver, ctx).size === 1) {
      throw located("a span has no .present method", document, node.at);
    }
    if (node.method === "has" || node.method === "has-value") {
      if (node.args[0]?.key === "_Elided") throw located("the omission origin _Elided is not a bag key", document, node.at);
    }
    // A capture in an optional or a repetition is a list. A method of a
    // node or a span does not take a list as its receiver (docs/engine.md, "Method signatures").
    if (node.method !== undefined && NODE_METHODS.has(node.method) && node.receiver?.capture !== undefined &&
        node.receiver.capture !== "" && !ctx.names?.has(node.receiver.capture) && ctx.captures?.get(node.receiver.capture) === "list") {
      throw located(`$${node.receiver.capture} is a list of nodes, which has no method .${node.method}`, document, node.at);
    }
    // A comparison that reads a constant or a payload of a captured node has
    // its operand types only in the stage. Where both are known, the rules
    // of the closed check apply.
    if (COMPARED.has(node.op) && [node.left, node.right].some(side => side?.const !== undefined ||
        side?.property !== undefined && side.receiver?.capture !== undefined)) {
      const left = this.typeOf(node.left, ctx);
      const right = this.typeOf(node.right, ctx);
      const fault = ![...left, ...right].includes("unknown") && comparisonFault(node.op, left, right);
      if (fault) throw located(fault, document, node.at);
    }
    if (node.concat) {
      for (const operand of node.concat) {
        const types = this.typeOf(operand, ctx);
        const bad = [...types].find(type => type !== "string" && type !== "unknown");
        if (bad && types.size === 1) throw located(`an operand of concatenation is ${bad === "number" ? "a number" : `of type ${bad}`}`, document, operand.at ?? node.at);
      }
    }
    if (node.not !== undefined) return this.walk(node.not, ctx, document, deferred, true);
    // A pattern's bare list also has the member any, as a truth value.
    if (Array.isArray(node.all) || Array.isArray(node.any)) {
      for (const item of node.all ?? node.any) this.walk(item, ctx, document, deferred, true);
      return;
    }
    if (node.if !== undefined) {
      this.walk(node.if, ctx, document, deferred, true);
      const implication = node.else === undefined;
      this.walk(node.then, ctx, document, deferred, implication);
      if (!implication) this.walk(node.else, ctx, document, deferred);
      return;
    }
    if (node.bag || node.list) {
      for (const entry of node.bag ?? node.list) {
        if (entry.guard) {
          const later = this.truth(entry.guard, { ...ctx, at: entry.at }, document, "guard");
          if (later) deferred.push({ node: later, ctx, document });
          this.walk(entry.guard, ctx, document, deferred);
        }
        this.walk(entry.value ?? entry.source, ctx, document, deferred);
      }
      return;
    }
    if (node.lambda !== undefined) {
      const names = new Map(ctx.names ?? []);
      if (node.lambda) names.set(node.lambda, new Set(["unknown"]));
      this.walk(node.body, { ...ctx, names, item: new Set(["unknown"]) }, document, deferred, ctx.predicate);
      return;
    }
    if (node.method === "any" || node.method === "all") {
      this.walk(node.receiver, ctx, document, deferred);
      for (const arg of node.args) this.walk(arg, { ...ctx, predicate: true }, document, deferred);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "at" && value && typeof value === "object") this.walk(value, { ...ctx, predicate: false }, document, deferred);
    }
  }

  /**
   * Checks a stage. Returns the truth positions that depend on the features.
   * @param {{rule: any, document: string}[]} rules the written rules of the stage
   */
  check(rules) {
    /** @type {any[]} */
    const deferred = [];
    this.constantGraph();
    for (const [name, versions] of this.constants) {
      for (const [index, version] of versions.entries()) {
        this.walk(version.record.value, { constant: { name, index }, document: version.document }, version.document, deferred);
      }
    }
    this.ruleBags(rules);
    for (const { rule, document } of rules) {
      if (!rule.instance) compoundUses(rule, document, (/** @type {string} */ name) => this.constantValue(name)?.record.value);
    }
    this.defaultKeyReads(rules);
    for (const { rule, document } of rules) {
      if (rule.instance) continue;
      const statementKinds = new Map();
      const statementRules = new Map();
      for (const alternative of rule.alternatives) {
        for (const [name, kind] of captureKinds(alternative.expr)) {
          statementKinds.set(name, statementKinds.has(name) && statementKinds.get(name) === "one" || kind === "one" ? "one" : "list");
        }
        captureRuleSets(alternative.expr, statementRules);
      }
      const shared = { captures: statementKinds, captureRules: statementRules, document };
      for (const condition of rule.conditions) this.walk(condition, shared, document, deferred, true);
      for (const term of [rule.term, ...rule.alternatives.map((/** @type {any} */ alternative) => alternative.term)]) if (term) ownBagReads(term, document);
      if (rule.term) {
        this.scope(rule.term, rule, statementKinds, document, true);
        this.walk(rule.term, shared, document, deferred);
        this.nodeBag(rule.term, document);
      }
      for (const alternative of rule.alternatives) {
        if (!alternative.term) continue;
        const own = captureKinds(alternative.expr);
        const ownRules = new Map();
        captureRuleSets(alternative.expr, ownRules);
        this.scope(alternative.term, rule, statementKinds, document, false, own);
        this.walk(alternative.term, { captures: own, captureRules: ownRules, document }, document, deferred);
        this.nodeBag(alternative.term, document);
      }
      for (const item of rule.emit?.items ?? []) {
        if (item.guard) {
          const later = this.truth(item.guard, { ...shared, at: item.at }, document, "guard");
          if (later) deferred.push({ node: later, ctx: shared, document });
          this.walk(item.guard, shared, document, deferred);
        }
        if (item.term) {
          this.walk(item.term, shared, document, deferred);
          this.provenance(item.term, document);
        }
      }
    }
    // Each version of the stage defaults is a constructor of rule nodes. It
    // writes no engine key of its own either.
    for (const version of this.constants.get("DEFAULTS") ?? []) {
      const value = version.record.value;
      const body = value.lambda !== undefined ? value.body : value;
      this.provenance(body, version.document);
      const own = (body?.bag ?? []).find((/** @type {any} */ entry) => this.fromPermission({ bag: [entry] }));
      if (own) throw located(`a constructor cannot write the engine key ${own.key ?? own.keys.find((/** @type {string} */ key) => key.startsWith("_"))}`, version.document, own.at);
    }
    this.instances(rules, deferred);
    this.classifiers(rules);
    this.outputs();
    return deferred;
  }

  // Each call of a template: its arguments substituted into the terms of
  // the template, and the origin filters that the arguments meet. An error
  // that an argument causes is reported at the written argument.
  /**
   * @param {any} rules
   * @param {any} deferred
   * @returns {any}
   */
  instances(rules, deferred) {
    const templates = new Map(rules.filter((/** @type {any} */ { rule }) => rule.params).map((/** @type {any} */ entry) => [entry.rule.name, entry]));
    if (!templates.size) return;
    /** @type {any[]} */
    const calls = [];
    /**
     * @param {any} node
     * @param {any} document
     */
    const find = (node, document) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(item => find(item, document));
      if (node.call !== undefined && Array.isArray(node.args) && templates.has(node.call)) calls.push({ call: node, document });
      for (const value of Object.values(node)) if (value && typeof value === "object") find(value, document);
    };
    for (const { rule, document } of rules) find([rule.alternatives, rule.instance, rule.args && { call: rule.name, args: rule.args }], document);
    for (const { call, document } of calls) {
      const { rule: template, document: home } = templates.get(call.call);
      const env = new Map(template.params.map((/** @type {any} */ param, /** @type {any} */ index) => [param, call.args[index]]));
      // An origin filter on a parameter needs a terminal as its argument.
      /** @param {any} node */
      const filters = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(filters);
        if (node.test === "tags" && node.expr?.param !== undefined &&
            node.requirements.some((/** @type {any} */ item) => item.value.tag === "_Elided")) {
          const arg = env.get(node.expr.param);
          const name = arg?.rule ?? arg?.ref;
          if (name !== undefined && /^[a-z]/.test(name) || arg?.call !== undefined) {
            throw located("the _Elided origin test applies only to a terminal, and the argument is a rule", document, arg.at);
          }
        }
        for (const value of Object.values(node)) if (value && typeof value === "object") filters(value);
      };
      template.alternatives.forEach((/** @type {any} */ alternative) => filters(alternative.expr));
      /**
       * @param {any} node
       * @returns {any}
       */
      const substitute = node => {
        if (Array.isArray(node)) return node.map(substitute);
        if (!node || typeof node !== "object") return node;
        if (node.param !== undefined && env.has(node.param)) {
          const arg = env.get(node.param);
          return arg.expression ? { ...arg.expression, at: arg.expression.at ?? arg.at } : arg;
        }
        return Object.fromEntries(Object.entries(node).map(/** @returns {any} */ ([key, value]) => [key, substitute(value)]));
      };
      const ctx = { captures: new Map(), document };
      for (const term of [template.term, ...template.alternatives.map((/** @type {any} */ alternative) => alternative.term)]) {
        if (!term) continue;
        const actual = substitute(term);
        this.walk(actual, ctx, document, deferred);
        this.provenance(actual, document, call.at);
      }
      void home;
    }
  }

  /**
   * The value certificate (docs/engine.md, "Proof for a rule value"): the rules whose value provably
   * equals the join of their input values. Returns each value test or
   * recognition read of a rule value that has no certificate.
   * @param {any} rules
   * @returns {any}
   */
  certificates(rules, readers = new Set(), valueReads = /** @type {any[]} */ ([])) {
    const byName = new Map();
    // A rule bound to an instance, as `%rule a = t(…)`, has the alternatives
    // of its template with each parameter replaced by its actual.
    const templates = new Map(rules.filter((/** @type {any} */ { rule }) => rule.params).map((/** @type {any} */ { rule }) => [rule.name, rule]));
    for (const entry of rules) {
      if (!entry.rule.instance || !templates.has(entry.rule.instance.call)) continue;
      const expanded = expandInstance(entry.rule, templates.get(entry.rule.instance.call));
      if (expanded) rules = [...rules.filter((/** @type {any} */ other) => other !== entry), { ...entry, rule: expanded }];
    }
    for (const entry of rules) {
      if (entry.rule.params || entry.rule.instance) continue;
      if (!byName.has(entry.rule.name) || entry.rule.op !== "extend") byName.set(entry.rule.name, []);
      byName.get(entry.rule.name).push(entry);
    }
    // A compound binding (docs/notation.md, "Rule bags") has the value of a termless splice
    // of its operand: the defaults, or its primary or sole symbol.
    for (const { rule, document } of rules) {
      if (rule.params || rule.instance) continue;
      /** @param {any} node */
      const each = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(each);
        if (isCompoundCapture50(node)) {
          const key = compoundKey(rule.name, node.capture);
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push({ rule: { name: key, op: "define", alternatives: [{ expr: node.expr }] }, document });
        }
        for (const value of Object.values(node)) if (value && typeof value === "object") each(value);
      };
      for (const alternative of rule.alternatives ?? []) each(alternative.expr);
    }
    const joinsChildren = this.defaultsJoinChildren();
    const joinsInput = this.defaultsJoinInput();
    const certified = new Set(byName.keys());
    /** @type {Map<string, boolean>} the proofs of template calls in bodies */
    const callProofs = new Map();
    /**
     * @param {any} node
     * @returns {boolean}
     */
    const symbolPasses = node => {
      if (!node || typeof node !== "object") return true;
      if (node.primary) return symbolPasses(node.primary);
      if (node.capture !== undefined && node.expr) return symbolPasses(node.expr);
      if (node.test !== undefined) return symbolPasses(node.expr);
      if (node.ref !== undefined) return !/^[a-z]/.test(node.ref) || certified.has(node.ref);
      // A call of a template passes where each alternative of its instance
      // passes. A call that is still being checked passes, as in the
      // greatest fixed point of the certificate.
      if (node.call !== undefined && Array.isArray(node.args)) {
        const template = templates.get(node.call);
        if (!template) return false;
        const key = JSON.stringify(node, (field, value) => field === "at" ? undefined : value);
        if (callProofs.has(key)) return /** @type {boolean} */ (callProofs.get(key));
        callProofs.set(key, true);
        const expanded = expandInstance({ name: node.call, op: "define", instance: node }, template);
        const passes = !!expanded && expanded.alternatives.every((/** @type {any} */ alternative) => alternativePasses(expanded, alternative));
        callProofs.set(key, passes);
        return passes;
      }
      if (node.literal || node.range || node.wildcard || node.empty) return true;
      // A splice adds its called rule's value.
      if (node.splice) return symbolPasses(node.splice);
      if (node.seq || node.choice || node.and || node.ranked) return (node.seq ?? node.choice ?? node.and ?? node.ranked).every(symbolPasses);
      if (node.optional) return (!node.elidable || !node.default || node.default.string === "") && symbolPasses(node.optional);
      if (node.repeat) return symbolPasses(node.repeat) && symbolPasses(node.separator);
      return false;
    };
    /** @param {any} value */
    const isInputJoin = value => value?.method === "join" && !value.args.length && value.receiver?.map?.method === "tokens" &&
      value.receiver.by?.property === "value" && value.receiver.map.receiver?.method === "span" &&
      value.receiver.map.receiver.receiver?.capture === "";
    /**
     * @param {any} rule
     * @param {any} alternative
     */
    const alternativePasses = (rule, alternative) => {
      const terms = [rule.term, alternative.term].filter(Boolean);
      let writer = null;
      for (const term of terms) for (const entry of term.bag) {
        if (entry.kind === "write" && entry.keys.includes("value") || entry.kind === "delete" && entry.key === "value" ||
            entry.kind === "splat" && splatMayWriteValue(entry.value) || entry.kind === "copy" && entry.key === "value") writer = entry;
      }
      // An erased rule has the empty string as its value, which is not the
      // join of a consuming window, whatever its terms write.
      if (rule.erased) return false;
      if (writer) return writer.kind === "write" && !writer.guard && !writer.gates.length && isInputJoin(writer.value);
      // A compound binding of the body is no sole symbol, and a primary
      // inside it is the primary of the rule.
      let body = alternative.expr;
      while (isCompoundCapture50(body)) body = body.expr;
      if (body.primary) return symbolPasses(body.primary);
      if (body.seq?.some((/** @type {any} */ item) => item.primary || hasPrimary(item))) return false;
      const compound = isCompoundCapture50(alternative.expr);
      if (!compound && !terms.length && (body.ref !== undefined || body.literal || body.range || body.wildcard || body.test !== undefined || body.capture !== undefined || body.choice || body.splice)) {
        return symbolPasses(body);
      }
      return joinsInput || joinsChildren && symbolPasses(body);
    };
    const reasons = new Map();
    for (let changed = true; changed;) {
      changed = false;
      // The proofs of calls read the certified rules, which shrink.
      callProofs.clear();
      for (const name of [...certified]) {
        const failing = byName.get(name).flatMap((/** @type {any} */ { rule }) => rule.alternatives.map((/** @type {any} */ alternative, /** @type {any} */ index) => [rule, alternative, index]))
          .find((/** @type {any} */ [rule, alternative]) => !alternativePasses(rule, alternative));
        if (failing) {
          certified.delete(name);
          // The first supplier that breaks the proof, for the message.
          const [, alternative, index] = failing;
          /** @type {any[]} */
          const refs = [];
          /** @param {any} node */
          const collect = node => {
            if (!node || typeof node !== "object") return;
            if (node.ref !== undefined && /^[a-z]/.test(node.ref)) refs.push(node.ref);
            for (const value of Object.values(node)) if (value && typeof value === "object") collect(value);
          };
          collect(alternative.expr);
          const child = refs.find(ref => byName.has(ref) && !certified.has(ref));
          reasons.set(name, child ? `alternative ${index + 1} reads ${child}, ${reasons.get(child) ?? "which has no certificate"}` :
            `alternative ${index + 1} writes or keeps a value that is not the join of its input`);
          changed = true;
        }
      }
    }
    // The calls of each template in the bodies of the stage, for a read of
    // a capture of a parameter: it reads the actual of each call.
    /** @type {Map<string, any[]>} */
    const calls = new Map();
    for (const { rule } of rules) {
      /** @type {any[]} */
      const pending = [rule.alternatives?.map((/** @type {any} */ alternative) => alternative.expr), rule.instance];
      while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node)) {
          for (const item of node) pending.push(item);
          continue;
        }
        if (typeof node.call === "string" && Array.isArray(node.args)) {
          if (!calls.has(node.call)) calls.set(node.call, []);
          calls.get(node.call)?.push(node);
        }
        for (const [field, value] of Object.entries(node)) if (field !== "at" && value && typeof value === "object") pending.push(value);
      }
    }
    /**
     * Whether a target of a value read has the certificate, or the reason
     * why not.
     * @param {any} target
     * @param {string | undefined} template the template whose parameters the read names
     * @returns {string | null}
     */
    const proof = (target, template) => {
      if (target.leaf || target.ref !== undefined && /^[A-Z_]/.test(target.ref)) return null;
      if (target.unknown) return "the capture binds a form that has no certificate";
      if (target.ref !== undefined) {
        const shown = target.ref.startsWith(COMPOUND_PREFIX) ? `the compound binding $${target.ref.split(":").at(-1)}` : target.ref;
        if (!byName.has(target.ref)) return `${shown}: the stage has no definition of it`;
        return certified.has(target.ref) ? null : `${shown}: ${reasons.get(target.ref) ?? "it has no certificate"}`;
      }
      if (target.param !== undefined) {
        // A parameter stands for the actual of each call of the template.
        const params = template ? templates.get(template)?.params ?? [] : [];
        const index = params.indexOf(target.param);
        if (index < 0) return null;
        for (const call of calls.get(/** @type {string} */ (template)) ?? []) {
          const actual = actualBody(call.args[index]);
          const failed = actual && proof(actual, undefined);
          if (failed) return `the actual of @${target.param} in a call of ${template}: ${failed}`;
        }
        return null;
      }
      return symbolPasses(target) ? null : "a supplier of its value is not the join of its input";
    };
    /** @type {any[]} */
    const failures = [];
    for (const read of valueReads) {
      // A read inside a tag term runs where a recognizer test reads the
      // keys of its rule.
      if (read.term !== null && !readers.has(read.term)) continue;
      for (const target of read.targets) {
        const failed = proof(target, read.template);
        if (failed) {
          failures.push(located(`${read.shown} has no proof that the value equals the join of its input: ${failed}`, read.document, read.at));
          break;
        }
      }
    }
    return failures;
  }

  /**
   * A read of a payload needs a payload on each route that reaches it. A
   * route of a rule without the key, or with the key bare, needs a test of
   * .has-value(k) on the same capture before the read (engine §10).
   * @param {any} rules
   */
  payloadRefinement(rules) {
    const states = new Map();
    for (const { rule } of rules) {
      if (rule.params || rule.instance) continue;
      const own = states.get(rule.name) ?? { alternatives: 0, keys: new Map() };
      states.set(rule.name, own);
      for (const alternative of rule.alternatives) {
        own.alternatives++;
        const terms = [rule.term, alternative.term].filter(Boolean);
        const keys = new Set(terms.flatMap(term => term.bag.flatMap((/** @type {any} */ entry) => entry.keys ?? (entry.key ? [entry.key] : []))));
        for (const key of keys) {
          let writer = null;
          for (const term of terms) for (const entry of term.bag) {
            if (entry.kind === "write" && entry.keys.includes(key) || entry.key === key || entry.kind === "splat") writer = entry;
          }
          const state = writer === null ? "absent" : writer.kind === "write" ? (writer.guard || writer.gates.length ? "maybe" : "valued") :
            writer.kind === "splat" || writer.kind === "copy" ? "unknown" : "absent";
          own.keys.set(key, [...(own.keys.get(key) ?? []), state]);
        }
      }
    }
    /** @type {any[]} */
    const failures = [];
    /**
     * @param {any} capture
     * @param {any} key
     */
    const mark = (capture, key) => `${capture}|${key}`;
    /**
     * @param {any} node
     * @param {any} out
     */
    const tested = (node, out) => {
      if (node?.method === "has-value" && node.receiver?.capture !== undefined) out.add(mark(node.receiver.capture, node.args[0].key));
      if (node?.all) for (const item of node.all) tested(item, out);
      return out;
    };
    for (const { rule, document } of rules) {
      const symbols = new Map();
      for (const alternative of rule.alternatives ?? []) collectRuleCaptures(alternative.expr, symbols);
      /**
       * @param {any} node
       * @param {any} refined
       */
      const walk = (node, refined) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(item => walk(item, refined));
        if (node.if !== undefined && node.else === undefined) {
          walk(node.if, refined);
          walk(node.then, new Set([...refined, ...tested(node.if, new Set())]));
          return;
        }
        if (node.all) {
          let current = new Set(refined);
          for (const item of node.all) {
            walk(item, current);
            current = new Set([...current, ...tested(item, new Set())]);
          }
          return;
        }
        if (node.property !== undefined && node.property !== "value" && node.property !== "image" && node.receiver?.capture) {
          const target = symbols.get(node.receiver.capture);
          const routes = target !== undefined ? states.get(target) : undefined;
          if (routes && !refined.has(mark(node.receiver.capture, node.property))) {
            const found = routes.keys.get(node.property) ?? [];
            const valuedSomewhere = found.some((/** @type {any} */ state) => state === "valued" || state === "maybe");
            const missing = found.length < routes.alternatives || found.some((/** @type {any} */ state) => state !== "valued");
            if (valuedSomewhere && missing && !found.includes("unknown")) {
              failures.push(located(`the read of '${node.property} on $${node.receiver.capture} can reach an absent payload`, document, node.at));
            }
          }
        }
        for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") walk(value, refined);
      };
      walk(rule.conditions, new Set());
    }
    return failures;
  }

  /**
   * The possible states of each key that the stage's tokens can carry
   * (docs/notation.md, "Stage interfaces"): "absent", "bare" or "valued", for each key that a term of
   * the stage writes, and the input states of each key that a copy of an
   * input bag passes on. The states are a union over all writers, so they
   * over-approximate the interface.
   * @param {{rule: any}[]} rules
   * @param {Map<string, Set<string>> | null} input the states of the input keys
   */
  outputStates(rules, input) {
    const states = new Map();
    /**
     * @param {any} key
     * @param {any} state
     */
    const add = (key, state) => {
      if (!states.has(key)) states.set(key, new Set(["absent"]));
      states.get(key).add(state);
    };
    for (const [key, values] of input ?? []) for (const value of values) add(key, value);
    const terms = [];
    for (const { rule } of rules) {
      terms.push(rule.term);
      for (const alternative of rule.alternatives ?? []) terms.push(alternative.term);
      for (const item of rule.emit?.items ?? []) terms.push(item.term);
    }
    for (const version of this.constants.get("DEFAULTS") ?? []) if (version.record.value.body?.bag) terms.push(version.record.value.body);
    for (const term of terms.filter(Boolean)) {
      for (const entry of term.bag) {
        if (entry.kind === "bare") add(entry.key, "bare");
        if (entry.kind === "write") for (const key of entry.keys) add(key, "valued");
        if (entry.kind === "copy") for (const value of input?.get(entry.key) ?? ["valued"]) add(entry.key, value);
      }
    }
    return states;
  }

  /**
   * A read of the payload of an input token needs a payload on each route
   * (engine §10). .has(k) removes absence and .has-value(k) also removes the
   * bare state. A guard refines its entry, and an antecedent its
   * consequent.
   * @param {{rule: any, document: string}[]} rules
   * @param {Map<string, Set<string>>} input the states of the input keys
   */
  inputRefinement(rules, input) {
    /** @type {any[]} */
    const failures = [];
    /**
     * @param {any} node
     * @param {any} out
     */
    const tests = (node, out) => {
      if ((node?.method === "has-value" || node?.method === "has") && node.receiver?.capture !== undefined) {
        const key = `${node.receiver.capture}|${node.args[0].key}`;
        if (node.method === "has-value" || out.get(key) !== "value") out.set(key, node.method === "has-value" ? "value" : "present");
      }
      if (node?.all) for (const item of node.all) tests(item, out);
      return out;
    };
    /**
     * @param {any} refined
     * @param {any} more
     */
    const merge = (refined, more) => {
      const result = new Map(refined);
      for (const [key, kind] of more) if (kind === "value" || result.get(key) !== "value") result.set(key, kind);
      return result;
    };
    for (const { rule, document } of rules) {
      const terminals = new Set();
      /** @param {any} node */
      const find = node => {
        if (!node || typeof node !== "object") return;
        if (node.capture !== undefined && node.expr) {
          let base = node.expr;
          while (base.test !== undefined || base.primary) base = base.expr ?? base.primary;
          if (base.wildcard || base.ref !== undefined && /^[A-Z_]/.test(base.ref)) terminals.add(node.capture);
        }
        for (const value of Object.values(node)) if (value && typeof value === "object") find(value);
      };
      for (const alternative of rule.alternatives ?? []) find(alternative.expr);
      if (!terminals.size) continue;
      /**
       * @param {any} node
       * @param {any} refined
       */
      const walk = (node, refined) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(item => walk(item, refined));
        if (node.if !== undefined && node.else === undefined) {
          walk(node.if, refined);
          walk(node.then, merge(refined, tests(node.if, new Map())));
          return;
        }
        if (Array.isArray(node.all)) {
          let current = refined;
          for (const item of node.all) {
            walk(item, current);
            current = merge(current, tests(item, new Map()));
          }
          return;
        }
        if (Array.isArray(node.bag)) {
          for (const entry of node.bag) {
            if (entry.guard) walk(entry.guard, refined);
            walk(entry.value ?? entry.source, entry.guard ? merge(refined, tests(entry.guard, new Map())) : refined);
          }
          return;
        }
        const read = node.property !== undefined && node.property !== "value" && node.property !== "image" &&
          node.receiver?.capture !== undefined && terminals.has(node.receiver.capture);
        if (read && input.has(node.property)) {
          const states = /** @type {Set<string>} */ (input.get(node.property));
          const kind = refined.get(`${node.receiver.capture}|${node.property}`);
          if (states.has("valued") && (kind === undefined && (states.has("absent") || states.has("bare")) || kind === "present" && states.has("bare"))) {
            failures.push(located(kind === "present"
              ? `the presence test leaves a bare route to the read of '${node.property} on $${node.receiver.capture}`
              : `the read of '${node.property} on $${node.receiver.capture} can reach an absent or bare key`, document, node.at));
          }
        }
        for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") walk(value, refined);
      };
      walk([rule.conditions, rule.term, (rule.alternatives ?? []).map((/** @type {any} */ alternative) => alternative.term), (rule.emit?.items ?? []).map((/** @type {any} */ item) => item.term)], new Map());
    }
    return failures;
  }

  /**
   * Refuses a condition that reads a key, other than value and image, that
   * the stage defaults can write. Recognition reads the tags of a node from
   * its primary, its sole symbol and its terms, not from the defaults. The
   * loader refuses the other recognition reads of such a key, a body filter
   * on a rule and a read of a compound binding (docs/notation.md, "Rule
   * bags").
   * @param {{rule: any, document: string}[]} rules
   */
  defaultKeyReads(rules) {
    const writes = this.defaultsWrites();
    if (!writes) return;
    const { written, open } = writes;
    /** @param {any} node @returns {string | null} the key that a test reads, "*" for all keys */
    const read = node => {
      if (node.property !== undefined && node.receiver && node.property !== "value" && node.property !== "image") return node.property;
      if ((node.method === "has" || node.method === "has-value") && node.args?.[0]?.key !== undefined) return node.args[0].key;
      if (["keys", "flags", "classes"].includes(node.method)) return "*";
      return null;
    };
    for (const { rule, document } of rules) {
      /** @param {any} node */
      const visit = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const key = read(node);
        if (key !== null && (key === "*" ? written.size || open : written.has(key) || open)) {
          throw located(`the format 50 recognizer cannot yet read ${key === "*" ? "the keys" : `the key ${key}`} that the stage defaults give a node`, document, node.at);
        }
        for (const item of Object.values(node)) if (item && typeof item === "object") visit(item);
      };
      visit(rule.conditions);
    }
  }

  /**
   * The keys other than value and image that the stage defaults can write,
   * and whether a splat of the defaults can write any key, or null where
   * they write none.
   * @returns {{written: Set<string>, open: boolean} | null}
   */
  defaultsWrites() {
    const value = this.constantValue("DEFAULTS")?.record.value;
    const bag = value?.lambda !== undefined ? value.body?.bag : undefined;
    if (!bag) return null;
    /** @type {Set<string>} */
    const written = new Set();
    let open = false;
    for (const entry of bag) {
      if (entry.kind === "write") for (const key of entry.keys) written.add(key);
      else if (entry.kind === "bare" || entry.kind === "copy") written.add(entry.key);
      else if (entry.kind === "splat") open = true;
    }
    for (const key of ["value", "image"]) written.delete(key);
    return written.size || open ? { written, open } : null;
  }

  /**
   * Whether the stage defaults give each node the join of the values of
   * its input tokens, as `value: $n.span.tokens!'value.join()`.
   */
  defaultsJoinInput() {
    const value = this.constantValue("DEFAULTS")?.record.value;
    if (!value || value.lambda === undefined || !value.body?.bag) return false;
    let writer = null;
    for (const entry of value.body.bag) if (entry.kind === "write" && entry.keys.includes("value") || entry.kind === "splat") writer = entry;
    const join = writer?.value;
    return writer?.kind === "write" && !writer.guard && !writer.gates.length && join?.method === "join" && !join.args.length &&
      join.receiver?.map?.method === "tokens" && join.receiver.by?.property === "value" &&
      join.receiver.map.receiver?.method === "span" && join.receiver.map.receiver.receiver?.capture === value.lambda;
  }

  defaultsJoinChildren() {
    const version = this.constantValue("DEFAULTS");
    const value = version?.record.value;
    if (!value || value.lambda === undefined || !value.body?.bag) return false;
    let writer = null;
    for (const entry of value.body.bag) if (entry.kind === "write" && entry.keys.includes("value") || entry.kind === "splat") writer = entry;
    const join = writer?.value;
    return writer?.kind === "write" && !writer.guard && join?.method === "join" && !join.args.length &&
      join.receiver?.map?.method === "children" && join.receiver.map.receiver?.capture === value.lambda &&
      join.receiver.by?.property === "value";
  }

  // A shared statement term reads a capture of some alternatives only
  // behind a presence guard. An alternative term reads only its own
  // captures. Every capture name must be known to the statement.
  /**
   * @param {any} term
   * @param {any} rule
   * @param {any} statementKinds
   * @param {any} document
   * @param {any} sharedTerm
   * @param {any} [own]
   */
  scope(term, rule, statementKinds, document, sharedTerm, own) {
    /**
     * @param {any} node
     * @param {any} guarded
     * @param {any} found
     */
    const reads = (node, guarded, found, bound = new Set()) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) reads(item, guarded, found, bound);
        return;
      }
      // A function binder is no capture of the rule.
      if (node.lambda !== undefined) {
        reads(node.body, guarded, found, node.lambda ? new Set([...bound, node.lambda]) : bound);
        return;
      }
      if (node.capture !== undefined && node.capture !== "" && !node.expr && !bound.has(node.capture)) found.push({ name: node.capture, guarded, at: node.at });
      for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") reads(value, guarded, found, bound);
    };
    const routes = rule.alternatives.map((/** @type {any} */ alternative) => captureKinds(alternative.expr));
    for (const entry of term.bag) {
      /** @type {any[]} */
      const found = [];
      if (entry.guard) reads(entry.guard, true, found);
      reads(entry.value ?? entry.source, false, found);
      for (const { name, guarded } of found) {
        if (!statementKinds.has(name)) throw located(`the statement does not declare the capture $${name}`, document, entry.at);
        if (sharedTerm) {
          if (!guarded && !entry.guard && routes.some((/** @type {any} */ route) => !route.has(name))) {
            throw located(`the shared statement entry reads $${name}, which an alternative does not declare`, document, entry.at);
          }
        } else if (!own.has(name)) {
          throw located(`the alternative term reads $${name}, which only another alternative declares`, document, entry.at);
        }
      }
    }
  }

  // A rule term writes no engine key, and copies no permission set into a
  // node. A splat of a closed constant gives the strings of a node only
  // where it holds strings for them.
  /**
   * @param {any} term
   * @param {any} document
   */
  nodeBag(term, document) {
    this.provenance(term, document);
    for (const entry of term.bag) {
      const keys = entry.kind === "write" ? entry.keys : entry.kind === "bare" ? [entry.key] : [];
      for (const key of keys) {
        if (key.startsWith("_")) throw located(`a constructor cannot write the engine key ${key}`, document, entry.at);
      }
      if (entry.kind !== "splat") continue;
      if (entry.value.const !== undefined) {
        const value = this.constantValue(entry.value.const)?.record.value;
        for (const item of value?.bag ?? []) {
          for (const key of item.kind === "write" ? item.keys : item.kind === "bare" ? [item.key] : []) {
            if ((key === "value" || key === "image") && (item.kind === "bare" || !this.typeOf(item.value, {}).has("string") || this.typeOf(item.value, {}).size > 1)) {
              throw located(`the splat gives the node's string key ${key} a value that is not a string`, document, entry.at);
            }
          }
        }
      }
    }
  }

  /**
   * Refuses a constructor that stores an engine membership from permission
   * alone. A stored engine membership needs evidence from a node. Neither
   * $INPUTS nor a constant that names an engine key gives it, also through
   * an alias, a version, a function, a selection, a copy or a splat. A mask
   * can still name an engine key for the selection of a node.
   * @param {any} term a bag constructor
   * @param {any} document
   * @param {any} [at] the place to report instead of the entry
   */
  provenance(term, document, at) {
    const entry = (term?.bag ?? []).find((/** @type {any} */ entry) => entry.kind === "copy" && this.fromPermission(entry.source) ||
      entry.kind === "splat" && this.fromPermission(entry.value));
    if (entry) throw located("a permission set such as $INPUTS cannot supply stored engine memberships", document, at ?? entry.at);
  }

  /**
   * Whether a value takes its entries from a permission set: $INPUTS, a bag
   * that names an engine key, or a constant, a function or a selection whose
   * entries come from one.
   * @param {any} node
   * @param {Set<any>} [active] the constant versions being followed
   * @returns {boolean}
   */
  fromPermission(node, active = new Set()) {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(item => this.fromPermission(item, active));
    if (node.const === "INPUTS") return true;
    if (node.const !== undefined || node.apply !== undefined) {
      const name = node.const ?? node.apply;
      for (const version of this.constants.get(name) ?? []) {
        if (active.has(version)) continue;
        const value = version.record.value;
        if (this.fromPermission(value.lambda !== undefined ? value.body : value, new Set([...active, version]))) return true;
      }
      return node.apply !== undefined && this.fromPermission(node.arg, active);
    }
    // A capture, a span and the item of a predicate read a node, which is
    // evidence. Their key sets are too.
    if (node.capture !== undefined || node.item) return false;
    // A selection takes the entries of its receiver, and a key set of a
    // value takes its names.
    if (node.method === "select" || node.method === "keys" || node.method === "flags" || node.method === "classes") return this.fromPermission(node.receiver, active);
    if (node.method !== undefined) return false;
    // An intersection holds only names that each operand holds.
    if (Array.isArray(node.intersection)) return node.intersection.every((/** @type {any} */ item) => this.fromPermission(item, active));
    if (Array.isArray(node.difference)) return this.fromPermission(node.difference[0], active);
    if (node.bag) return node.bag.some((/** @type {any} */ entry) => (entry.kind === "splat" && this.fromPermission(entry.value, active)) ||
      (entry.kind === "copy" && this.fromPermission(entry.source, active)) ||
      (entry.kind === "bare" && entry.key.startsWith("_")) || (entry.kind === "write" && entry.keys.some((/** @type {string} */ key) => key.startsWith("_"))));
    return ["union", "if", "then", "else", "list"].some(key => this.fromPermission(node[key], active));
  }

  // A constant reads the final version of another constant, and the
  // previous version of itself only inside a redefinition.
  constantGraph() {
    const edges = new Map();
    for (const [name, versions] of this.constants) {
      versions.forEach((version, index) => {
        /** @type {any[]} */
        const targets = [];
        collectConstants(version.record.value, (/** @type {any} */ target) => {
          if (target === name) {
            if (index === 0) throw located(`$${name} calls itself, a cycle of constants`, version.document, version.record.at);
            targets.push(versions[index - 1]);
          } else if (this.constants.has(target)) targets.push(/** @type {any[]} */ (this.constants.get(target)).at(-1));
        });
        edges.set(version, targets);
      });
    }
    const state = new Map();
    /** @param {any} version */
    const visit = version => {
      if (state.get(version) === "done") return;
      if (state.get(version) === "active") throw located(`a cycle of constants reaches $${version.record.name}`, version.document, version.record.at);
      state.set(version, "active");
      for (const target of edges.get(version) ?? []) visit(target);
      state.set(version, "done");
    };
    for (const version of edges.keys()) visit(version);
  }

  // Each receiver of .classify: its class entries hold strings, lists of
  // strings or key sets, and each reference names a class of some version.
  /** @param {any} rules */
  classifiers(rules) {
    const receivers = new Set();
    /** @param {any} node */
    const find = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(find);
      if (node.method === "classify" && node.receiver?.const !== undefined) receivers.add(node.receiver.const);
      for (const value of Object.values(node)) if (value && typeof value === "object") find(value);
    };
    for (const { rule } of rules) find(rule);
    for (const versions of this.constants.values()) for (const version of versions) find(version.record.value);
    for (const name of receivers) {
      const versions = this.constants.get(name) ?? [];
      const known = new Set();
      for (const version of versions) for (const entry of version.record.value.bag ?? []) {
        if (entry.kind === "write") entry.keys.forEach((/** @type {any} */ key) => known.add(key));
        if (entry.kind === "bare") known.add(entry.key);
      }
      for (const version of versions) for (const entry of version.record.value.bag ?? []) {
        if (entry.kind === "bare" && !entry.gates.length && !entry.guard) {
          throw located(`the class ${entry.key} of $${name} has no value: an effective classifier entry cannot be bare`, version.document, entry.at);
        }
        if (entry.kind !== "write") continue;
        const value = entry.value;
        if (value.list && !value.list.every((/** @type {any} */ item) => item.value.string !== undefined)) {
          throw located(`a classifier list of $${name} requires string elements`, version.document, entry.at);
        }
        if (value.bag) for (const reference of value.bag) {
          if (reference.kind !== "bare" || !known.has(reference.key)) {
            throw located(`${reference.key ?? "a reference"} has no supplier in any version of the classifier $${name}`, version.document, reference.at ?? entry.at);
          }
        }
      }
    }
  }

  // $OUTPUTS is a key set. A splat that can give it a valued entry fails.
  outputs() {
    for (const version of this.constants.get("OUTPUTS") ?? []) {
      const value = version.record.value;
      for (const entry of value.bag ?? []) {
        if (entry.kind === "write") throw located(`$OUTPUTS cannot give the key ${entry.keys[0]} a value`, version.document, entry.at);
        if (entry.kind !== "splat") continue;
        const source = entry.value;
        if (source.const !== undefined && source.const !== "INPUTS" && source.const !== "OUTPUTS") {
          const target = this.constantValue(source.const)?.record.value;
          if (target?.bag?.some((/** @type {any} */ item) => item.kind === "write")) {
            throw located(`a splat of $${source.const} gives valued entries to the output mask`, version.document, entry.at);
          }
        }
      }
    }
  }
}

// Whether a splat can give the key value: a key set never does.
/** @param {any} node */
function splatMayWriteValue(node) {
  if (node.bag) return node.bag.some((/** @type {any} */ entry) => entry.kind === "splat" ? splatMayWriteValue(entry.value) :
    (entry.keys ?? [entry.key]).includes("value"));
  if (["flags", "keys", "classes", "select", "classify", "union"].includes(node.method)) return node.method === "select";
  if (node.intersection || node.union || node.difference) return false;
  return true;
}

/**
 * The uses that a compound binding cannot have (docs/notation.md, "Captures"): the part of
 * a braced item, and an operand of node equality, also through the item of
 * a predicate or a map over such bindings. A name that any route of the
 * rule binds as a compound binding counts. A pattern can read the binding
 * on the left of a comparison, but not the item of a predicate yet. Around
 * a ranked choice, a condition reads only what the options share.
 * @param {any} rule
 * @param {string} document
 * @param {(name: string) => any} constant the value of a constant
 */
function compoundUses(rule, document, constant) {
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {any} node */
  const collect = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (isCompoundCapture50(node)) names.add(node.capture);
    for (const value of Object.values(node)) if (value && typeof value === "object") collect(value);
  };
  for (const alternative of rule.alternatives ?? []) collect(alternative.expr);
  if (!names.size) return;
  for (const item of rule.emit?.items ?? []) {
    if (item.term !== undefined && names.has(item.capture)) {
      throw located(`a braced item cannot take the compound binding $${item.capture} as its part`, document, item.at);
    }
  }
  // Whether an operand denotes a compound binding, with the binders and
  // the implicit item that range over such bindings.
  /** @param {any} node @param {Set<string>} scope @param {boolean} item */
  const compound = (node, scope, item) => node?.item ? item : typeof node?.capture === "string" && scope.has(node.capture);
  /** @param {any} node @param {Set<string>} scope @param {boolean} item */
  const walk = (node, scope, item) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(each => walk(each, scope, item));
    if ((node.op === "≅" || node.op === "≇") && (compound(node.left, scope, item) || compound(node.right, scope, item))) {
      const side = compound(node.left, scope, item) ? node.left : node.right;
      const shown = side.item ? "an item that is a compound binding" : `the compound binding $${side.capture}`;
      // A pattern reads the anonymous structure of the binding.
      const pattern = node.right?.pattern !== undefined || node.right?.const !== undefined || isPatternSet(node.right);
      if (!pattern || side !== node.left) throw located(`node equality cannot compare ${shown}`, document, node.at);
      if (side.item) throw located(`the format 50 engine cannot yet compare ${shown} with a pattern`, document, node.at);
      return;
    }
    // The restoration of a compound binding needs the close observations
    // of its operand, which the recognizer does not yet keep.
    if ((node.method === "without-elision" || node.method === "without-elision-except") && compound(node.receiver, scope, item)) {
      const shown = node.receiver.item ? "an item that is a compound binding" : `the compound binding $${node.receiver.capture}`;
      throw located(`the format 50 engine cannot yet restore ${shown}`, document, node.at);
    }
    // A predicate or a map over compound bindings binds its item to one.
    const over = node.method === "all" || node.method === "any" ? node.receiver : node.map;
    const fn = node.method === "all" || node.method === "any" ? node.args?.[0] : node.by;
    const ranges = !!over && (compound(over, scope, item) || Array.isArray(over.list) && over.list.some((/** @type {any} */ entry) => compound(entry.value, scope, item)));
    if (ranges && fn?.lambda !== undefined) {
      walk(over, scope, item);
      walk(fn.body, fn.lambda ? new Set([...scope, fn.lambda]) : scope, true);
      return;
    }
    if (node.lambda !== undefined) {
      walk(node.body, node.lambda ? new Set([...scope].filter(name => name !== node.lambda)) : scope, false);
      return;
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value, scope, item);
  };
  walk([rule.term, ...(rule.alternatives ?? []).map((/** @type {any} */ alternative) => alternative.term), rule.conditions,
    rule.error, rule.warning, (rule.emit?.items ?? []).map((/** @type {any} */ entry) => [entry.guard, entry.term])], names, false);
  // A compound binding that holds a ranked choice exports only what its
  // options share during recognition (docs/notation.md, "Ranked choices"): its presence, its span
  // and its certified value. A condition reads nothing else of it, also
  // through the item of a predicate over such bindings.
  /** @type {Set<string>} */
  const ranked = new Set();
  /** @param {any} node @returns {boolean} */
  const holdsRanked = node => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(holdsRanked);
    if (Array.isArray(node.ranked)) return true;
    return Object.values(node).some(value => !!value && typeof value === "object" && holdsRanked(value));
  };
  /** @param {any} node */
  const rankedLabels = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(rankedLabels);
    if (isCompoundCapture50(node) && holdsRanked(node.expr)) ranked.add(node.capture);
    for (const value of Object.values(node)) if (value && typeof value === "object") rankedLabels(value);
  };
  for (const alternative of rule.alternatives ?? []) rankedLabels(alternative.expr);
  if (!ranked.size) return;
  // The function constants that the walk is inside.
  /** @type {Set<string>} */
  const entered = new Set();
  /** @param {any} node @param {Set<string>} scope @param {boolean} item @param {any} parent */
  const early = (node, scope, item, parent) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(each => early(each, scope, item, parent));
    const bound = node.item ? item : typeof node.capture === "string" && !node.expr && scope.has(node.capture);
    if (bound) {
      // A function constant reads its argument as its body reads its
      // parameter.
      const fn = parent?.apply !== undefined && parent.arg === node && !entered.has(parent.apply) ? constant(parent.apply) : undefined;
      if (fn?.lambda) {
        entered.add(parent.apply);
        early(fn.body, new Set([fn.lambda]), false, null);
        entered.delete(parent.apply);
        return;
      }
      // A pattern sees one seal at the ranked choice, so it reads only what
      // the options share.
      const shared = parent === null || parent.not !== undefined || Array.isArray(parent.all) || Array.isArray(parent.any) ||
        parent.if !== undefined || parent.property === "value" || COMMON_READS.has(parent.method) ||
        (parent.op === "≅" || parent.op === "≇") && parent.left === node;
      if (!shared) {
        const shown = node.item ? "an item that is a compound binding" : `the compound binding $${node.capture}`;
        throw located(`a condition cannot read ${shown} beyond what the options of its ranked choice share`, document, parent.at ?? node.at);
      }
      return;
    }
    const over = node.method === "all" || node.method === "any" ? node.receiver : node.map;
    const fn = node.method === "all" || node.method === "any" ? node.args?.[0] : node.by;
    if (over && fn?.lambda !== undefined && compound(over, scope, item)) {
      early(fn.body, fn.lambda ? new Set([...scope, fn.lambda]) : scope, true, null);
      return;
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") early(value, scope, item, node);
  };
  for (const condition of rule.conditions ?? []) early(condition, ranked, false, null);
}

// The reads of a compound binding that do not tell the options of a ranked
// choice apart: its presence and the reads of its span.
const COMMON_READS = new Set(["present", "span", "following-tokens", "preceding-tokens", "onward", "first-token", "last-token",
  "tokens-after-first", "starts-input", "ends-input", "followed-by", "preceded-by", "source-text", "decomposed-source-text"]);

/**
 * @typedef {{keys: Map<string, Set<string>>, open: boolean}} RuleBag
 * The type of a bag: for each key, its possible states and payload types.
 */

// The rules that each capture of a body can bind. A capture of a token,
// a call or a parameter names that symbol, which has an open bag.
/**
 * @param {any} node
 * @param {Map<string, Set<string>>} into
 */
function captureRuleSets(node, into) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) captureRuleSets(item, into);
    return;
  }
  if (node.capture !== undefined && node.expr) {
    let base = node.expr;
    while (base.test !== undefined || base.primary) base = base.expr ?? base.primary;
    const name = typeof base.ref === "string" && /^[a-z]/.test(base.ref) ? base.ref : "\u0000open";
    if (!into.has(node.capture)) into.set(node.capture, new Set());
    into.get(node.capture)?.add(name);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") captureRuleSets(value, into);
}

// The symbols that the primaries of an alternative mark. A choice can mark
// one on each route.
/** @param {any} node @param {any[]} [into] @returns {any[]} */
function primarySymbols(node, into = []) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const item of node) primarySymbols(item, into);
    return into;
  }
  if (node.primary) {
    let base = node.primary;
    while (base.capture !== undefined && base.expr || base.test !== undefined) base = base.expr;
    into.push(base);
    return into;
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") primarySymbols(value, into);
  return into;
}

// The plain symbols that supply the bag of an alternative where neither
// term stands (notation, "Rule bags"): one plain mandatory symbol, or one
// on each route of an unranked choice. Null where the alternative has no
// such symbol, and undefined where this check cannot tell.
/** @param {any} node @returns {any[] | null | undefined} */
function soleSymbols(node) {
  let base = node;
  while (base && (base.capture !== undefined && base.expr || base.test !== undefined)) base = base.expr;
  if (!base || base.seq || base.and || base.optional || base.repeat || base.ranked || base.empty) return null;
  if (base.choice) {
    const routes = base.choice.map(soleSymbols);
    return routes.every((/** @type {any} */ route) => Array.isArray(route)) ? routes.flat() : undefined;
  }
  return base.ref !== undefined || base.call !== undefined || base.literal !== undefined || base.splice !== undefined ||
    base.range !== undefined || base.wildcard || base.param !== undefined ? [base] : undefined;
}

// The name of the termless rule that a compound binding stands for in the
// value certificate.
const COMPOUND_PREFIX = "\u0000compound:";
/** @param {string} rule @param {string} capture */
const compoundKey = (rule, capture) => `${COMPOUND_PREFIX}${rule}:${capture}`;

/**
 * The rule that each capture binds. A compound binding stands for its
 * termless rule, where the owner is known.
 * @param {any} node
 * @param {any} symbols
 * @param {string} [owner]
 */
function collectRuleCaptures(node, symbols, owner) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(item => collectRuleCaptures(item, symbols, owner));
  if (owner !== undefined && isCompoundCapture50(node)) symbols.set(node.capture, compoundKey(owner, node.capture));
  else if (node.capture !== undefined && node.expr) {
    let base = node.expr;
    while (base.test !== undefined || base.primary) base = base.expr ?? base.primary;
    if (base.ref !== undefined && /^[a-z]/.test(base.ref)) symbols.set(node.capture, base.ref);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectRuleCaptures(value, symbols, owner);
}

// The comparisons whose operand types the stage checks.
const COMPARED = new Set(["=", "≠", "∈", "∉", "⊆", "⊈"]);

/**
 * The fault of a comparison whose operand types are known, with the
 * messages of the closed check (validate.js), or undefined.
 * @param {string} op
 * @param {Set<string>} left
 * @param {Set<string>} right
 */
function comparisonFault(op, left, right) {
  /** @param {Set<string>} types */
  const scalar = types => new Set([...types].map(type => type === "span" ? "string" : type));
  if (op === "=" || op === "≠") {
    const [a, b] = [scalar(left), scalar(right)];
    if (![...a].some(type => b.has(type))) return `${op} requires comparable operands of one type`;
  }
  if (op === "∈" || op === "∉") {
    if (!right.has("list")) return `${op} requires a list on its right`;
    if (![...scalar(left)].some(type => type === "string" || type === "number")) return `${op} requires compatible operands`;
  }
  if ((op === "⊆" || op === "⊈") && (!left.has("bag") || !right.has("bag"))) return `${op} requires key sets`;
  return undefined;
}

// The methods that read the bag of a node, not its place.
const BAG_READS = new Set(["keys", "flags", "classes", "select", "has", "has-value"]);

// A term builds the bag of `$`, so it cannot read that bag (docs/notation.md, "Rule bags"). Its
// place, span and children stay readable. A function binder named `$`
// does not exist, so every bare `$` in a term is the rule occurrence.
/**
 * @param {any} term
 * @param {any} document
 */
function ownBagReads(term, document) {
  /** @param {any} node */
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const own = node.receiver?.capture === "" && !node.receiver.expr;
    if (own && (node.property !== undefined || BAG_READS.has(node.method))) {
      throw located("a term cannot read the bag of $, which the term builds", document, node.at);
    }
    if (node.kind === "splat" && node.value?.capture === "") throw located("a term cannot read the bag of $, which the term builds", document, node.at);
    if (node.kind === "copy" && node.source?.capture === "") throw located("a term cannot read the bag of $, which the term builds", document, node.at);
    for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") visit(value);
  };
  visit(term);
}

/**
 * The covers of one emission list read disjoint input, in input order
 * (docs/notation.md, "Emission"): the loader checks this for the items
 * with no guard and no gate. On each alternative, it rejects two covers
 * that can consume the same input and a pair of consuming covers that
 * stand in the reverse order of their parts in the body. A whole-node item
 * covers every part. Possible consumption ignores tests and conditions,
 * and a forward covers what the part can hand on. The error stands at the
 * second item of the first conflicting pair, in written order. It runs
 * after stitching and after the check of nullable error productions.
 * @param {{rule: any, document: string}[]} rules
 */
export function emissionCovers(rules) {
  /** @type {Map<string, any[]>} */
  const byName = new Map();
  for (const { rule } of rules) {
    if (rule.instance || !rule.alternatives?.length) continue;
    if (!byName.has(rule.name)) byName.set(rule.name, []);
    byName.get(rule.name)?.push(rule);
  }
  /** @type {Set<string>} */
  const consuming = new Set();
  /** @param {any} node @returns {boolean} */
  const consumes = node => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(consumes);
    if (node.literal !== undefined || node.range !== undefined || node.wildcard !== undefined || node.remainder) return true;
    if (node.empty) return false;
    if (node.ref !== undefined) return /^[A-Z_]/.test(node.ref) || consuming.has(node.ref);
    if (node.call !== undefined) return consuming.has(node.call);
    if (node.param !== undefined) return true;
    if (node.splice !== undefined) return consumes(node.splice.ref !== undefined || node.splice.call !== undefined ? node.splice : node.splice.target ?? node.splice);
    return ["seq", "choice", "ranked", "and", "expr", "primary", "optional", "repeat", "separator"].some(key => consumes(node[key]));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, versions] of byName) {
      if (consuming.has(name) || !versions.some(rule => rule.alternatives.some((/** @type {any} */ alternative) => consumes(alternative.expr)))) continue;
      consuming.add(name);
      changed = true;
    }
  }
  // The rules whose output can hold a token that consumes input: a rule
  // that emits and can consume, or a rule with no emission whose body can
  // hand on such a token.
  /** @type {Set<string>} */
  const handing = new Set();
  /** @param {any} node @returns {boolean} */
  const hands = node => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(hands);
    const name = node.ref ?? node.call;
    if (typeof name === "string") return handing.has(name);
    if (node.param !== undefined) return true;
    return ["seq", "choice", "ranked", "and", "expr", "primary", "optional", "repeat", "separator", "splice"].some(key => hands(node[key]));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, versions] of byName) {
      if (handing.has(name) || !consuming.has(name)) continue;
      const rule = versions.at(-1);
      if (!(rule.emit ? rule.emit.items.length === 0 || rule.emit.items.some((/** @type {any} */ item) => !item.insert) : rule.alternatives.some((/** @type {any} */ alternative) => hands(alternative.expr)))) continue;
      handing.add(name);
      changed = true;
    }
  }
  for (const { rule, document } of rules) {
    const items = rule.emit?.items ?? [];
    if (rule.instance || items.length < 2) continue;
    for (const alternative of rule.alternatives ?? []) {
      const layout = coverLayout(alternative.expr);
      /** @type {{item: any, whole: boolean, place?: any}[]} */
      const covers = [];
      for (const item of items) {
        if (item.insert || item.guard || item.gates?.length) continue;
        if (item.capture === "") {
          if (item.term !== undefined && consumes(alternative.expr)) covers.push({ item, whole: true });
          continue;
        }
        const place = layout.get(item.capture);
        if (!place) continue;
        if (item.term !== undefined ? consumes(place.node.expr) : hands(place.node.expr)) covers.push({ item, whole: false, place });
      }
      for (let right = 1; right < covers.length; right++) {
        for (let left = 0; left < right; left++) {
          const a = covers[left], b = covers[right];
          const nested = a.whole || b.whole || a.place === b.place || a.place.inside.has(b.item.capture) || b.place.inside.has(a.item.capture);
          const exclusive = !nested && exclusiveRoutes(a.place.path, b.place.path);
          if (nested && !exclusive) throw located(`the emission of ${rule.name} covers input that another of its items covers`, document, b.item.at);
          if (!exclusive && a.place.order > b.place.order) throw located(`the emission of ${rule.name} lists its covers out of the input order of their parts`, document, b.item.at);
        }
      }
    }
  }
}

/**
 * The place of each capture of a body: its order in the body, its route
 * through the choices around it, and the captures inside its operand.
 * @param {any} body
 * @returns {Map<string, {node: any, order: number, path: [any, number][], inside: Set<string>}>}
 */
function coverLayout(body) {
  /** @type {Map<string, {node: any, order: number, path: [any, number][], inside: Set<string>}>} */
  const places = new Map();
  let order = 0;
  /** @param {any} node @param {[any, number][]} path @param {Set<string>[]} outer */
  const visit = (node, path, outer) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(item => visit(item, path, outer));
    let inner = outer;
    if (node.capture !== undefined && node.expr) {
      for (const set of outer) set.add(node.capture);
      const place = { node, order: order++, path, inside: new Set() };
      if (!places.has(node.capture)) places.set(node.capture, place);
      inner = [...outer, place.inside];
    }
    const choices = node.choice ?? node.ranked;
    if (Array.isArray(choices)) {
      choices.forEach((choice, index) => visit(choice, [...path, [node, index]], inner));
      return;
    }
    for (const key of ["seq", "and", "expr", "primary", "optional", "repeat", "separator"]) visit(node[key], path, inner);
  };
  visit(body, [], []);
  return places;
}

/**
 * Whether two routes through the choices of a body cannot both hold: they
 * take two branches of one choice.
 * @param {[any, number][]} a
 * @param {[any, number][]} b
 */
function exclusiveRoutes(a, b) {
  for (const [choice, index] of a) for (const [other, branch] of b) if (choice === other && index !== branch) return true;
  return false;
}

/**
 * Whether a body holds a primary outside a nested rule.
 * @param {any} node
 * @returns {boolean}
 */
function hasPrimary(node) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasPrimary);
  if (node.primary) return true;
  return ["seq", "choice", "ranked", "and", "expr", "optional", "repeat", "separator"].some(key => hasPrimary(node[key]));
}

/**
 * The body form of an actual of a call.
 * @param {any} arg
 * @returns {any}
 */
function actualBody(arg) {
  if (!arg || typeof arg !== "object") return null;
  if (arg.rule !== undefined) return { ref: arg.rule };
  if (arg.tag !== undefined) return { ref: arg.tag };
  if (arg.body !== undefined) return arg.body;
  if (arg.call !== undefined || arg.splice !== undefined) return arg;
  return null;
}

/**
 * @param {any} node
 * @param {any} visit
 */
function collectConstants(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(item => collectConstants(item, visit));
  if (node.const !== undefined) visit(node.const);
  if (node.apply !== undefined) visit(node.apply);
  for (const value of Object.values(node)) if (value && typeof value === "object") collectConstants(value, visit);
}

/**
 * The rule that an instance binding names, with the alternatives and the
 * term of its template, or null where the actuals do not fit. In a
 * body, a terminal or rule actual becomes a reference to it. In a term, an
 * expression actual stands for itself.
 * @param {any} rule the binding, `%rule a = t(…)`
 * @param {any} template
 */
function expandInstance(rule, template) {
  const args = rule.instance.args;
  if (args.length !== template.params.length) return null;
  const env = new Map(template.params.map((/** @type {any} */ param, /** @type {number} */ index) => [param, args[index]]));
  /**
   * @param {any} node
   * @returns {any}
   */
  const substitute = node => {
    if (Array.isArray(node)) return node.map(substitute);
    if (!node || typeof node !== "object") return node;
    if (node.param !== undefined && env.has(node.param)) {
      const arg = env.get(node.param);
      if (arg.expression) return arg.expression;
      if (arg.tag !== undefined) return { ref: arg.tag };
      if (arg.rule !== undefined) return { ref: arg.rule };
      // A body argument, such as a group or ε, stands for its body.
      if (arg.body !== undefined) return arg.body;
      return arg;
    }
    return Object.fromEntries(Object.entries(node).map(/** @returns {any} */ ([key, value]) => [key, substitute(value)]));
  };
  const alternatives = template.alternatives.map(substitute);
  return {
    name: rule.name, op: rule.op, at: rule.at,
    ...(template.term ? { term: substitute(template.term) } : {}),
    alternatives,
    conditions: rule.conditions ?? [],
  };
}
