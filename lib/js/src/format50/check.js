// @ts-nocheck
// Checks of a stitched format 50 stage that need the whole stage: the
// types of truth positions, the constant graph, classifier receivers,
// output masks, engine keys and capture scope (part 1 §13, part 3 §§3-6).
// A check whose answer depends on the features of a parse returns the
// expression, and the stage checks it again before recognition.

import { GencmuError } from "../errors.js";
import { captureKinds } from "./stage.js";

const NO_TRUTH = new Map([["string", "A string"], ["number", "A number"], ["pattern", "A pattern"], ["function", "A function"]]);
const SPAN_METHODS = new Set(["span", "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens"]);
const TRUTH_METHODS = new Set(["has", "has-value", "present", "any", "all", "starts-input", "ends-input", "overlaps", "followed-by", "preceded-by"]);
const BAG_METHODS = new Set(["keys", "flags", "classes", "select", "classify", "union"]);
const STRING_METHODS = new Set(["join", "source-text", "decomposed-source-text", "verbatim-text"]);

function located(description, document, at) {
  return new GencmuError("grammar", description, { document, ...(at ? { line: at[0], column: at[1] } : {}) });
}

export class StageCheck {
  /**
   * @param {Map<string, {record: any, document: string}[]>} constants
   */
  constructor(constants) {
    this.constants = constants;
  }

  constantValue(name, version) {
    const versions = this.constants.get(name);
    if (!versions) return undefined;
    return versions[version ?? versions.length - 1];
  }

  /** The possible types of an expression, as a set of names. */
  typeOf(node, ctx) {
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
      return this.typeOf(version.record.value, { constant: { name: node.const, index: this.constants.get(node.const).indexOf(version) }, active });
    }
    if (node.apply !== undefined) return one("unknown");
    if (node.param !== undefined) return one("unknown");
    if (node.property !== undefined) return this.propertyType(node, ctx);
    if (node.method !== undefined) {
      const name = node.method;
      if (SPAN_METHODS.has(name)) return one("span");
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
    }
    return new Set(["unknown"]);
  }

  /**
   * Checks an expression in a truth position.
   * @returns {any | null} the expression, where the answer depends on the features
   */
  truth(node, ctx, document, what = "truth") {
    const types = this.typeOf(node, ctx);
    const bad = [...types].filter(type => NO_TRUTH.has(type));
    if (bad.length && bad.length === types.size) {
      const kind = NO_TRUTH.get(bad[0]);
      throw located(what === "guard" ? `${kind.toLowerCase()} cannot serve as a guard` : `${kind.toLowerCase()} does not convert to truth`,
        ctx.document ?? document, node.at ?? ctx.at);
    }
    return bad.length ? node : null;
  }

  /**
   * Walks an expression: checks each truth position in it, and each method
   * receiver that the types decide.
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
    if (node.concat) {
      for (const operand of node.concat) {
        const types = this.typeOf(operand, ctx);
        const bad = [...types].find(type => type !== "string" && type !== "unknown");
        if (bad && types.size === 1) throw located(`an operand of concatenation is ${bad === "number" ? "a number" : `of type ${bad}`}`, document, operand.at ?? node.at);
      }
    }
    if (node.not !== undefined) return this.walk(node.not, ctx, document, deferred, true);
    if (node.all || node.any) {
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
    const deferred = [];
    this.constantGraph();
    for (const [name, versions] of this.constants) {
      for (const [index, version] of versions.entries()) {
        this.walk(version.record.value, { constant: { name, index }, document: version.document }, version.document, deferred);
      }
    }
    for (const { rule, document } of rules) {
      if (rule.instance) continue;
      const statementKinds = new Map();
      for (const alternative of rule.alternatives) {
        for (const [name, kind] of captureKinds(alternative.expr)) {
          statementKinds.set(name, statementKinds.get(name) === "list" || kind === "list" ? "list" : kind);
        }
      }
      const shared = { captures: statementKinds, document };
      for (const condition of rule.conditions) this.walk(condition, shared, document, deferred, true);
      if (rule.term) {
        this.scope(rule.term, rule, statementKinds, document, true);
        this.walk(rule.term, shared, document, deferred);
        this.nodeBag(rule.term, document);
      }
      for (const alternative of rule.alternatives) {
        if (!alternative.term) continue;
        const own = captureKinds(alternative.expr);
        this.scope(alternative.term, rule, statementKinds, document, false, own);
        this.walk(alternative.term, { captures: own, document }, document, deferred);
        this.nodeBag(alternative.term, document);
      }
      for (const item of rule.emit?.items ?? []) {
        if (item.guard) {
          const later = this.truth(item.guard, { ...shared, at: item.at }, document, "guard");
          if (later) deferred.push({ node: later, ctx: shared, document });
          this.walk(item.guard, shared, document, deferred);
        }
        if (item.term) this.walk(item.term, shared, document, deferred);
      }
    }
    this.instances(rules, deferred);
    this.classifiers(rules);
    this.outputs();
    return deferred;
  }

  // Each call of a template: its arguments substituted into the terms of
  // the template, and the origin filters that the arguments meet. An error
  // that an argument causes is reported at the written argument.
  instances(rules, deferred) {
    const templates = new Map(rules.filter(({ rule }) => rule.params).map(entry => [entry.rule.name, entry]));
    if (!templates.size) return;
    const calls = [];
    const find = (node, document) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(item => find(item, document));
      if (node.call !== undefined && Array.isArray(node.args) && templates.has(node.call)) calls.push({ call: node, document });
      for (const value of Object.values(node)) if (value && typeof value === "object") find(value, document);
    };
    for (const { rule, document } of rules) find([rule.alternatives, rule.instance, rule.args && { call: rule.name, args: rule.args }], document);
    for (const { call, document } of calls) {
      const { rule: template, document: home } = templates.get(call.call);
      const env = new Map(template.params.map((param, index) => [param, call.args[index]]));
      // An origin filter on a parameter needs a terminal as its argument.
      const filters = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(filters);
        if (node.test === "tags" && node.expr?.param !== undefined &&
            node.requirements.some(item => item.value.tag === "_Elided")) {
          const arg = env.get(node.expr.param);
          const name = arg?.rule ?? arg?.ref;
          if (name !== undefined && /^[a-z]/.test(name) || arg?.call !== undefined) {
            throw located("the _Elided origin test applies only to a terminal, and the argument is a rule", document, arg.at);
          }
        }
        for (const value of Object.values(node)) if (value && typeof value === "object") filters(value);
      };
      template.alternatives.forEach(alternative => filters(alternative.expr));
      const substitute = node => {
        if (Array.isArray(node)) return node.map(substitute);
        if (!node || typeof node !== "object") return node;
        if (node.param !== undefined && env.has(node.param)) {
          const arg = env.get(node.param);
          return arg.expression ? { ...arg.expression, at: arg.expression.at ?? arg.at } : arg;
        }
        return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, substitute(value)]));
      };
      const ctx = { captures: new Map(), document };
      for (const term of [template.term, ...template.alternatives.map(alternative => alternative.term)]) {
        if (term) this.walk(substitute(term), ctx, document, deferred);
      }
      void home;
    }
  }

  /**
   * The value certificate (part 2 §4): the rules whose value provably
   * equals the join of their input values. Returns each value test or
   * recognition read of a rule value that has no certificate.
   */
  certificates(rules) {
    const byName = new Map();
    for (const entry of rules) {
      if (entry.rule.params || entry.rule.instance) continue;
      if (!byName.has(entry.rule.name) || entry.rule.op !== "extend") byName.set(entry.rule.name, []);
      byName.get(entry.rule.name).push(entry);
    }
    const joinsChildren = this.defaultsJoinChildren();
    const certified = new Set(byName.keys());
    const symbolPasses = node => {
      if (!node || typeof node !== "object") return true;
      if (node.primary) return symbolPasses(node.primary);
      if (node.capture !== undefined && node.expr) return symbolPasses(node.expr);
      if (node.test !== undefined) return symbolPasses(node.expr);
      if (node.ref !== undefined) return !/^[a-z]/.test(node.ref) || certified.has(node.ref);
      if (node.literal || node.range || node.wildcard || node.empty) return true;
      if (node.seq || node.choice) return (node.seq ?? node.choice).every(symbolPasses);
      if (node.optional) return (!node.elidable || !node.default || node.default.string === "") && symbolPasses(node.optional);
      if (node.repeat) return symbolPasses(node.repeat) && symbolPasses(node.separator);
      return false;
    };
    const isInputJoin = value => value?.method === "join" && !value.args.length && value.receiver?.map?.method === "tokens" &&
      value.receiver.by?.property === "value" && value.receiver.map.receiver?.method === "span" &&
      value.receiver.map.receiver.receiver?.capture === "";
    const alternativePasses = (rule, alternative) => {
      const terms = [rule.term, alternative.term].filter(Boolean);
      let writer = null;
      for (const term of terms) for (const entry of term.bag) {
        if (entry.kind === "write" && entry.keys.includes("value") || entry.kind === "delete" && entry.key === "value" ||
            entry.kind === "splat" || entry.kind === "copy" && entry.key === "value") writer = entry;
      }
      if (writer) return writer.kind === "write" && !writer.guard && !writer.gates.length && isInputJoin(writer.value);
      const body = alternative.expr;
      if (body.primary) return symbolPasses(body.primary);
      if (body.seq?.some(item => item.primary)) return false;
      if (!terms.length && (body.ref !== undefined || body.literal || body.range || body.wildcard || body.test !== undefined || body.capture !== undefined || body.choice)) {
        return symbolPasses(body);
      }
      return joinsChildren && symbolPasses(body);
    };
    for (let changed = true; changed;) {
      changed = false;
      for (const name of [...certified]) {
        const passes = byName.get(name).every(({ rule }) => rule.alternatives.every(alternative => alternativePasses(rule, alternative)));
        if (!passes) {
          certified.delete(name);
          changed = true;
        }
      }
    }
    const failures = [];
    const visit = (node, document, symbols) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(item => visit(item, document, symbols));
      if ((node.test === "=" || node.test === "≠") && node.expr) {
        let base = node.expr;
        while (base.capture !== undefined && base.expr || base.test !== undefined) base = base.expr;
        if (base.ref !== undefined && byName.has(base.ref) && !certified.has(base.ref)) {
          failures.push(located(`the value test on ${base.ref} has no proof that the value equals the join of its input`, document, node.at));
        }
      }
      if (node.property === "value" && node.receiver?.capture && symbols?.has(node.receiver.capture)) {
        const target = symbols.get(node.receiver.capture);
        if (byName.has(target) && !certified.has(target)) {
          failures.push(located(`the read of the value of ${target} in recognition has no proof that it equals the join of its input`, document, node.at));
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, document, symbols);
    };
    for (const { rule, document } of rules) {
      const symbols = new Map();
      for (const alternative of rule.alternatives ?? []) collectRuleCaptures(alternative.expr, symbols);
      visit(rule.alternatives?.map(alternative => alternative.expr), document);
      visit(rule.conditions, document, symbols);
    }
    return failures;
  }

  /**
   * A read of a payload needs a payload on each route that reaches it. A
   * route of a rule without the key, or with the key bare, needs a test of
   * .has-value(k) on the same capture before the read (part 3 §3).
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
        const keys = new Set(terms.flatMap(term => term.bag.flatMap(entry => entry.keys ?? (entry.key ? [entry.key] : []))));
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
    const failures = [];
    const mark = (capture, key) => `${capture}|${key}`;
    const tested = (node, out) => {
      if (node?.method === "has-value" && node.receiver?.capture !== undefined) out.add(mark(node.receiver.capture, node.args[0].key));
      if (node?.all) for (const item of node.all) tested(item, out);
      return out;
    };
    for (const { rule, document } of rules) {
      const symbols = new Map();
      for (const alternative of rule.alternatives ?? []) collectRuleCaptures(alternative.expr, symbols);
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
            const valuedSomewhere = found.some(state => state === "valued" || state === "maybe");
            const missing = found.length < routes.alternatives || found.some(state => state !== "valued");
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

  // Whether $DEFAULTS gives each rule node the join of its children's values.
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
  scope(term, rule, statementKinds, document, sharedTerm, own) {
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
    const routes = rule.alternatives.map(alternative => captureKinds(alternative.expr));
    for (const entry of term.bag) {
      const found = [];
      if (entry.guard) reads(entry.guard, true, found);
      reads(entry.value ?? entry.source, false, found);
      for (const { name, guarded } of found) {
        if (!statementKinds.has(name)) throw located(`the statement does not declare the capture $${name}`, document, entry.at);
        if (sharedTerm) {
          if (!guarded && !entry.guard && routes.some(route => !route.has(name))) {
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
  nodeBag(term, document) {
    for (const entry of term.bag) {
      const keys = entry.kind === "write" ? entry.keys : entry.kind === "bare" ? [entry.key] : [];
      for (const key of keys) {
        if (key.startsWith("_")) throw located(`a constructor cannot write the engine key ${key}`, document, entry.at);
      }
      if (entry.kind !== "splat") continue;
      if (mentionsInputs(entry.value)) throw located("a permission set such as $INPUTS cannot supply stored engine memberships", document, entry.at);
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

  // A constant reads the final version of another constant, and the
  // previous version of itself only inside a redefinition.
  constantGraph() {
    const edges = new Map();
    for (const [name, versions] of this.constants) {
      versions.forEach((version, index) => {
        const targets = [];
        collectConstants(version.record.value, target => {
          if (target === name) {
            if (index === 0) throw located(`$${name} calls itself, a cycle of constants`, version.document, version.record.at);
            targets.push(versions[index - 1]);
          } else if (this.constants.has(target)) targets.push(this.constants.get(target).at(-1));
        });
        edges.set(version, targets);
      });
    }
    const state = new Map();
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
  classifiers(rules) {
    const receivers = new Set();
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
        if (entry.kind === "write") entry.keys.forEach(key => known.add(key));
        if (entry.kind === "bare") known.add(entry.key);
      }
      for (const version of versions) for (const entry of version.record.value.bag ?? []) {
        if (entry.kind === "bare" && !entry.gates.length && !entry.guard) {
          throw located(`the class ${entry.key} of $${name} has no value: an effective classifier entry cannot be bare`, version.document, entry.at);
        }
        if (entry.kind !== "write") continue;
        const value = entry.value;
        if (value.list && !value.list.every(item => item.value.string !== undefined)) {
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
          if (target?.bag?.some(item => item.kind === "write")) {
            throw located(`a splat of $${source.const} gives valued entries to the output mask`, version.document, entry.at);
          }
        }
      }
    }
  }
}

function collectRuleCaptures(node, symbols) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(item => collectRuleCaptures(item, symbols));
  if (node.capture !== undefined && node.expr) {
    let base = node.expr;
    while (base.test !== undefined || base.primary) base = base.expr ?? base.primary;
    if (base.ref !== undefined && /^[a-z]/.test(base.ref)) symbols.set(node.capture, base.ref);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectRuleCaptures(value, symbols);
}

function mentionsInputs(node) {
  if (!node || typeof node !== "object") return false;
  if (node.const === "INPUTS") return true;
  if (node.method === "keys" || node.method === "flags" || node.method === "classes") return false;
  return Object.values(node).some(value => value && typeof value === "object" && mentionsInputs(value));
}

function collectConstants(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(item => collectConstants(item, visit));
  if (node.const !== undefined) visit(node.const);
  if (node.apply !== undefined) visit(node.apply);
  for (const value of Object.values(node)) if (value && typeof value === "object") collectConstants(value, visit);
}
