import {hooks,countWork} from "./testing.js";
// Written-terminator priority for nested queries (engine §4): which
// completed items of a queried rule have an eligible proof tree.

/**
 * @import { Edge, Item, LoweredGrammar } from "./types.js"
 * @import { Chart } from "./earley.js"
 */


/** @type {WeakMap<LoweredGrammar, {elidable:Set<string>,optional:Map<string,object>}>} */
const helperSites = new WeakMap();
/** @type {WeakMap<LoweredGrammar,boolean>} */
const errorGrammars = new WeakMap();

/**
 * Elidable helpers and the written sites of split plain optional helpers. A
 * captured optional can have separate helpers for its expanded routes.
 * @param {LoweredGrammar} lowered
 * @returns {{elidable:Set<string>,optional:Map<string,object>}}
 */
function helpersOf(lowered) {
  let helpers = helperSites.get(lowered);
  if (!helpers) {
    helpers = {elidable:new Set(),optional:new Map()};
    /** @type {Map<object,Set<string>>} */
    const sites = new Map();
    for (const production of lowered.productions) {
      if (!production.helper) continue;
      if (production.elided !== null) helpers.elidable.add(production.lhs);
      const expression = production.writtenExpression;
      if (expression && "optional" in expression && expression.elidable !== true) {
        let names = sites.get(expression);
        if (!names) sites.set(expression,names=new Set());
        names.add(production.lhs);
      }
    }
    // One helper already joins all its optional's routes in the chart.
    // Only distinct names of one written site need the element group key.
    for (const [expression,names] of sites) {
      if (names.size > 1) for (const name of names) helpers.optional.set(name,expression);
    }
    helperSites.set(lowered, helpers);
  }
  return helpers;
}

/**
 * Whether a completed item is the empty helper of an elidable optional: an
 * advance over it is an omission.
 * @param {Item} item
 * @returns {boolean}
 */
function omitted(item) {
  return item.production.helper && item.production.elided !== null && item.production.rhs.length === 0;
}

/**
 * Whether a completed item is an elidable optional's helper over its
 * nonempty alternative: an advance over it reads the optional as written.
 * @param {Item} item
 * @returns {boolean}
 */
function written(item) {
  return item.dot === item.production.rhs.length && item.production.helper && item.production.elided !== null && item.production.rhs.length > 0;
}

/**
 * @param {Item} item
 * @returns {{node:import("./elements.js").Element|undefined, initial:boolean}|null}
 */
function elementPredecessor(item) {
  const roots = item.production.elements;
  if (!roots) return null;
  /** @param {import("./elements.js").Element[]} nodes @param {boolean} root @returns {{node:import("./elements.js").Element|undefined,initial:boolean}|null} */
  const find = (nodes,root) => {
    for (let index=0;index<nodes.length;index++) {
      if(hooks.work)countWork(hooks.work,"walkSteps");
      const node = nodes[index];
      if (node.symbol && node.from === item.dot) return {node:nodes[index-1],initial:root && index === 1};
      if (node.children && node.from <= item.dot && item.dot < node.to) {
        const result = find(node.children,false);
        if (result) return result;
      }
    }
    return null;
  };
  return find(roots,true);
}

/**
 * The completed items of the queried rule with an eligible proof tree in
 * the chart (engine §4). An omission is an advance over the
 * empty helper of an elidable optional at its position p. It is forbidden
 * where the prefix that the proof tree holds fixed can go on and read the
 * optional as written:
 *
 * - Where the optional has a constituent Y, the prefix is the item before Y
 *   in the same proof tree. The omission is forbidden when the chart advances
 *   that item over Y to some p' ≥ p, and the item so made advances over the
 *   optional's nonempty alternative.
 * - Otherwise the prefix is the item before the optional, and the omission
 *   is forbidden when the chart advances that item over the nonempty
 *   alternative.
 *
 * The chart is the whole recognition of the query, before any filtering,
 * so an attempt that never completes the rule can forbid an omission.
 *
 * Each item has two states, computed together to the least fixpoint: it has
 * an eligible proof tree (E), and an eligible proof tree that permits
 * the optional after it to be empty (P). P follows the proof tree,
 * so a permitted omission never combines with another proof tree's prefix.
 * @param {Chart} chart
 * @param {Item[]} witnesses
 * @param {boolean} [errorFree]
 * @returns {Item[]}
 */
export function eligibleWitnesses(chart, witnesses, errorFree = false) {
  const states=eligibility(chart,witnesses,errorFree);
  return witnesses.filter(item=>errorFree?!!((states.get(item)??0)&1):!!states.get(item));
}

/** @type {WeakMap<object,Map<Item,number>>} */
const stageEligibility=new WeakMap();

/** One least fixed point shared by all local readings of the stage.
 * @param {Chart} chart @param {Item[]} witnesses @param {boolean} errorFree */
export function chartEligibleWitnesses(chart,witnesses,errorFree) {
  if(!witnesses.length)return witnesses;
  let states=stageEligibility.get(chart);
  if(!states) {
    const all=chart.sets.flatMap(set=>set?.items??[]);
    states=eligibility(chart,all,true);stageEligibility.set(chart,states);
  }
  return witnesses.filter(item=>errorFree?!!((states.get(item)??0)&1):!!states.get(item));
}

/** @param {Chart} chart @param {Item[]} witnesses @param {boolean} errorFree
 * @returns {Map<Item,number>} */
function eligibility(chart, witnesses, errorFree) {
  if (witnesses.length === 0) return new Map();
  const {elidable:helpers,optional:optionals} = helpersOf(chart.context.lowered);
  let errors=errorGrammars.get(chart.context.lowered);
  if (errors===undefined) { errors=chart.context.lowered.productions.some(production=>!!production.error);errorGrammars.set(chart.context.lowered,errors); }
  if (helpers.size === 0 && !errors && !errorFree) return new Map(witnesses.map(item=>[item,1]));
  // The items the witnesses rest on, children before the items made from
  // them where the edges allow, so that one sweep settles most of them.
  /** @type {Map<Item, number>} */
  const index = new Map();
  /** @type {Item[]} */
  const order = [];
  let omits = false;
  for (const witness of witnesses) {
    if(hooks.work)countWork(hooks.work,'walkSteps');
    if (index.has(witness)) continue;
    index.set(witness, -1);
    /** @type {{item: Item, edges: Edge[], next: number}[]} */
    const stack = [{ item: witness, edges: witness.edges, next: 0 }];
    while (stack.length > 0) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      const frame = stack[stack.length - 1];
      let pushed = false;
      while (frame.next < frame.edges.length * 2) {
        if(hooks.work)countWork(hooks.work,'walkSteps');
        const step = frame.next++;
        const edge = frame.edges[step >> 1];
        /** @type {Item | null} */
        let below = null;
        if ((step & 1) === 0) below = edge.kind === "seed" || edge.kind === "restore" ? null : edge.previous;
        else if (edge.kind === "complete") {
          below = edge.child;
          if (omitted(edge.child)) omits = true;
        }
        if (below !== null && !index.has(below)) {
          index.set(below, -1);
          stack.push({ item: below, edges: below.edges, next: 0 });
          pushed = true;
          break;
        }
      }
      if (pushed) continue;
      stack.pop();
      index.set(frame.item, order.length);
      order.push(frame.item);
    }
  }
  // With no omission, every item of a chart has a finite proof, made from
  // predicted items in the order in which the recognizer made it.
  if (!omits && !errors && !errorFree) return new Map(witnesses.map(item=>[item,1]));

  // The prefixes that advance over a written optional, and for each item
  // before a constituent Y, the furthest end of an advance over Y that then
  // reads the optional as written.
  /** @type {Set<Item>} */
  const reads = new Set();
  for (const set of chart.sets) {
    if (!set) continue;
    for (const item of set.items) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      for (const edge of item.edges) {
        if(hooks.work)countWork(hooks.work,"walkSteps");
        if (edge.kind === "complete" && written(edge.child)) reads.add(edge.previous);
      }
    }
  }
  /** @type {Map<Item, number>} */
  const further = new Map();
  for (const item of reads) {
    for (const edge of item.edges) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      if (edge.kind !== "complete") continue;
      const known = further.get(edge.previous);
      if (known === undefined || known < item.end) further.set(edge.previous, item.end);
    }
  }

  // For each item, whether an elidable optional comes next, and whether it
  // has a constituent: not at the start, not after a terminal, and not
  // after the first symbol of a production whose first symbol is its own
  // rule (engine §4).
  /** @type {Map<Item,import("./elements.js").Element>} */
  const precedingGroups = new Map();
  /** @param {Item} item @returns {"none"|"alone"|"constituent"|"group"} */
  const nextKind = item => {
    const rhs = item.production.rhs;
    const symbol = rhs[item.dot];
    if (symbol === undefined || symbol.terminal || !helpers.has(symbol.name)) return "none";
    const elements = elementPredecessor(item);
    if (elements) {
      const previous = elements.node;
      if (!previous || previous.symbol?.terminal) return "alone";
      const optional = previous.symbol && optionals.get(previous.symbol.name);
      if (previous.children || optional) {
        // Both physical helper variants and inline expansions retain one
        // optional boundary for the fixed prefix and all blocker routes.
        precedingGroups.set(item,optional ? {...previous,written:optional} : previous);
        return "group";
      }
      if (elements.initial && previous.symbol?.name === item.production.lhs) return "alone";
      return "constituent";
    }
    if (item.dot === 0 || rhs[item.dot-1].terminal) return "alone";
    if (item.dot === 1 && rhs[0].name === item.production.lhs) return "alone";
    return "constituent";
  };
  const next = order.map(nextKind);
  const identities = new WeakMap();
  let identityCount = 0;
  /** @param {object|undefined} object */
  const identity = object => {
    if (!object) return 0;
    let id = identities.get(object);
    if (id === undefined) identities.set(object,id=++identityCount);
    return id;
  };
  /** @param {Item} item @param {import("./elements.js").Element} group */
  const fixedKey = (item,group) => {
    const captures = [];
    for (let slot=item.slots;slot;slot=slot.parent) {
      if(hooks.work)countWork(hooks.work,"walkSteps");
      const name = item.production.captures[slot.index].name;
      captures.push([name,slot.start,slot.end,slot.tags,slot.structure,slot.observation?.sequence]);
    }
    const symbols = item.production.rhs.map((symbol,index) => [symbol.name,symbol.test?.written,
      item.production.captures.filter(capture => capture.index === index && !capture.name.startsWith("\u0000")).map(capture => capture.name)]);
    // Only the preceding optional's route varies. Every outside expansion
    // remains part of the same element production and fixed prefix.
    const outside = [...symbols.slice(0,group.from),["optional"],...symbols.slice(group.to)];
    // A surrounding optional can also have one helper per expanded route.
    const owner = optionals.get(item.production.lhs);
    const scope = owner ? ["optional",identity(owner)] : item.production.lhs;
    return JSON.stringify([identity(item.production.elementSource ?? item.production.source),scope,identity(group.written),
      item.origin,item.end,item.structure,item.observationPrefix?.sequence,item.boundary?.id,outside,captures.reverse()]);
  };
  /** @param {Item} item @param {number} dot @returns {Item[]} */
  const boundaries = (item,dot) => {
    const result = [], pending = [item], seen = new Set();
    while (pending.length) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      const current = /** @type {Item} */ (pending.pop());
      if (seen.has(current)) continue;
      seen.add(current);
      if (current.dot === dot) result.push(current);
      else for (const edge of current.edges) if (edge.kind === "scan" || edge.kind === "complete") pending.push(edge.previous);
    }
    return result;
  };
  const groupFurther = new Map();
  for (const item of reads) if (nextKind(item) === "group") {
    const group = /** @type {import("./elements.js").Element} */ (precedingGroups.get(item));
    for (const prefix of boundaries(item,group.from)) {
      const key = fixedKey(prefix,group);
      groupFurther.set(key,Math.max(groupFurther.get(key) ?? -1,item.end));
    }
  }
  // Each mask holds distinct proof states: 1 is clean and 2 carries an
  // error. E and P retain those states separately. The support channel
  // keeps finite written-priority proofs through own errors for erasure.
  const eligible = new Uint8Array(order.length), permits = new Uint8Array(order.length);
  const support = new Uint8Array(order.length), supportPermits = new Uint8Array(order.length);
  /** @type {(item: Item) => number} */
  const at = item => /** @type {number} */ (index.get(item));
  /** @param {number} left @param {number} right */
  const combine = (left,right) => (left & right & 1) | (left && right && ((left | right) & 2) ? 2 : 0);
  /** @param {Edge} edge */
  const dirtyRead = edge => (edge.kind === "scan" || edge.kind === "restore") && (chart.context.tokens[edge.token].errors?.length ?? 0) !== 0;
  /**
   * Find a permitted proof of one F state through an optional element.
   * Reverse advances retain that state, so a dirty permitted proof cannot
   * lend permission to a clean forbidden proof of the same chart item.
   * @param {Item} item
   * @param {import("./elements.js").Element} group
   * @param {number} end
   * @param {Uint8Array} states
   * @param {Uint8Array} permissions
   * @param {number} bit
   */
  const groupPermits = (item,group,end,states,permissions,bit) => {
    const pending = [{item,bit}], seen = new Set();
    while (pending.length) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      const current = /** @type {{item:Item,bit:number}} */ (pending.pop());
      const key = at(current.item)*2 + (current.bit === 2 ? 1 : 0);
      if (seen.has(key) || !(states[at(current.item)] & current.bit)) continue;
      seen.add(key);
      if (current.item.dot === group.from) {
        if ((groupFurther.get(fixedKey(current.item,group)) ?? -1) < end) return true;
        continue;
      }
      for (const edge of current.item.edges) {
        if(hooks.work)countWork(hooks.work,"walkSteps");
        if (edge.kind === "scan") {
          for (const before of [1,2]) if (states[at(edge.previous)] & before &&
              (dirtyRead(edge) ? 2 : before) === current.bit) pending.push({item:edge.previous,bit:before});
        } else if (edge.kind === "complete") {
          const beforeStates = omitted(edge.child) ? permissions[at(edge.previous)] : states[at(edge.previous)];
          for (const before of [1,2]) for (const child of [1,2]) {
            if (beforeStates & before && states[at(edge.child)] & child &&
                combine(before,child) === current.bit) pending.push({item:edge.previous,bit:before});
          }
        }
      }
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let x = 0; x < order.length; x++) {
      if(hooks.work)countWork(hooks.work,'walkSteps');
      const item = order[x];
      // These are semantic support channels, not separate legacy paths.
      for (const raw of [true,false]) {
        const states = raw ? support : eligible, permissions = raw ? supportPermits : permits;
        let e = 0, p = 0;
        for (const edge of item.edges) {
          if(hooks.work)countWork(hooks.work,'walkSteps');
          let through = 0;
          if (edge.kind === "seed" || edge.kind === "restore") through = dirtyRead(edge) ? 2 : 1;
          else if (edge.kind === "scan") through = dirtyRead(edge) ? states[at(edge.previous)] ? 2 : 0 : states[at(edge.previous)];
          else through = combine(omitted(edge.child) ? permissions[at(edge.previous)] : states[at(edge.previous)],states[at(edge.child)]);
          if (!through) continue;
          e |= through;
          if (next[x] === "alone" && !reads.has(item)) p |= through;
          else if (next[x] === "group") {
            const group = /** @type {import("./elements.js").Element} */ (precedingGroups.get(item));
            for (const bit of [1,2]) if (through & bit && groupPermits(item,group,item.end,states,permissions,bit)) p |= bit;
          } else if (next[x] === "constituent" && edge.kind === "complete") {
            const end = further.get(edge.previous);
            if (end === undefined || end < item.end) p |= through;
          }
        }
        if (item.complete && item.production.erased) {
          // This replaces the ordinary completion transition. Its finite
          // support can contain own errors that normal E rejects.
          e = support[x] || e ? 1 : 0;
          p = p ? 1 : 0;
        } else if (item.complete && item.production.error) {
          e = raw && e ? 2 : 0;
          p = raw && p ? 2 : 0;
        }
        if ((states[x] | e) !== states[x]) { states[x] |= e; changed = true; }
        if ((permissions[x] | p) !== permissions[x]) { permissions[x] |= p; changed = true; }
      }
    }
  }
  return new Map(order.map((item,index)=>[item,eligible[index]]));
}
