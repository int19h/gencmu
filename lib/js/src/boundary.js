// Complete-tree neighbours, represented by finite records (engine §4.2).
import { clauseChildren, expressionChildren, productionClauses } from "./clause-walk.js";

export const BOUNDARY_METHODS = new Set(["followed-by", "preceded-by"]);
/** @type {WeakMap<object, any>} */
export const boundaryLocations = new WeakMap();
/** Preserve positions when constants or patterns copy a clause.
 * @param {object} from @param {object} to */
export function copyBoundaryLocation(from,to) {
  const location = boundaryLocations.get(from);
  if (location) boundaryLocations.set(to,location);
}
/** @param {any} node @returns {any[]} */
export function boundaryAtoms(node) {
  const found = [], pending = [node];
  while (pending.length) {
    const part = pending.pop();
    if (part && BOUNDARY_METHODS.has(part.method)) found.push(part);
    else for (const child of clauseChildren(part).slice().reverse()) pending.push(child);
  }
  return found;
}
/** @param {any} rule @returns {{problem:string,node:any}|null} */
export function boundaryProblem(rule) {
  const allowed = new Set();
  for (const condition of rule.conditions) {
    const atoms = boundaryAtoms(condition);
    if (atoms.length > 1) return {problem:"a condition item accepts only one boundary atom",node:atoms[1]};
    if (!atoms.length) continue;
    const atom = atoms[0];
    allowed.add(atom);
    const receiver = atom.receiver.capture;
    if (receiver !== "") {
      const pending = [condition];
      while (pending.length) {
        const part = pending.pop();
        const capture = part?.capture ?? part?.captured;
        if (typeof capture === "string" && capture !== receiver) return {problem:"a boundary condition with a captured receiver reads only that capture",node:atom};
        for (const child of clauseChildren(part)) pending.push(child);
      }
    }
  }
  for (const item of rule.emit?.items ?? []) for (const atom of boundaryAtoms(item.tags)) allowed.add(atom);
  // Include bodies, tests, and recipes as forbidden surfaces too.
  const pending = [rule];
  while (pending.length) {
    const part = pending.pop();
    if (!part || typeof part !== "object") continue;
    if (BOUNDARY_METHODS.has(part.method) && !allowed.has(part)) return {problem:"a boundary atom stands only in conditions or emission tags",node:part};
    for (const child of Object.values(part)) if (child && typeof child === "object") pending.push(child);
  }
  return null;
}

/** Body reachability, independently of gates and conditions. @param {any} grammar */
export function boundaryReachability(grammar) {
  /** @param {string[]} roots */
  const reach = roots => {
    const rules = new Set(), terminals = new Set(), pending = [...roots];
    while (pending.length) {
      const name = pending.pop();
      if (rules.has(name)) continue;
      rules.add(name);
      for (const alternative of grammar.rules.get(name)?.alternatives ?? []) {
        const stack = [alternative.expr];
        while (stack.length) {
          const expr = stack.pop();
          if (expr.ref) {
            if (/^[A-Z]/.test(expr.ref)) terminals.add(expr.ref);
            else if (!expr.ref.startsWith("_")) pending.push(expr.ref);
          }
          for (const child of expressionChildren(expr)) stack.push(child);
        }
      }
    }
    return {rules,terminals};
  };
  const queries = [], atoms = [], seen = new Set();
  for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
    const clauses = alternative.clauses;
    if (seen.has(clauses)) {
      const pending = [alternative.tags];
      while (pending.length) {
        const part = pending.pop();
        if (part?.method && ["matches","begins","tags"].includes(part.method) && part.args[0]?.rule) queries.push({rule:rule.name,alternative,target:part.args[0].rule});
        for (const child of clauseChildren(part)) pending.push(child);
      }
      continue;
    }
    seen.add(clauses);
    for (const atom of boundaryAtoms([clauses.conditions,clauses.emit])) atoms.push({rule:rule.name,alternative,atom});
    const pending = [clauses,alternative.tags];
    while (pending.length) {
      const part = pending.pop();
      if (part?.method && ["matches","begins","tags"].includes(part.method) && part.args[0]?.rule) queries.push({rule:rule.name,alternative,target:part.args[0].rule});
      for (const child of clauseChildren(part)) pending.push(child);
    }
  }
  // Grammars with no atoms need no boundary reachability or query closure.
  // In particular, do not build one transitive closure per nested query.
  if (!atoms.length) {
    const empty = {rules:new Set(),terminals:new Set()};
    return {text:empty,all:empty,queries:[],atoms:[]};
  }
  const text = reach(["text"]), all = reach(["text",...queries.map(query => query.target)]);
  return {text,all,queries:queries.map(query => ({...query,reached:reach([query.target])})),atoms};
}

// BigInt sets have no fixed maximum width. A literal carries only direction,
// target, and sign. Source information lives outside records for diagnostics.
/** @typedef {{bit:bigint,direction:string,target:bigint,positive:boolean}} BoundaryLiteral */
/** @typedef {{id:number,empty:boolean,start:bigint,first:bigint,end:bigint,last:bigint}} BoundaryRecord */
export class BoundaryRecords {
  /** @param {any[]} productions */
  constructor(productions) {
    this.names = new Map();
    this.forward = 0n;
    this.backward = 0n;
    /** @type {BoundaryLiteral[]} */
    this.literals = [];
    /** @type {Map<string,BoundaryLiteral>} */
    this.literalKeys = new Map();
    /** @type {Map<string,BoundaryRecord>} */
    this.records = new Map();
    this.empty = this.intern(true,0n,0n,0n,0n);
    const seen = new Set();
    for (const production of productions) for (const clause of productionClauses(production)) {
      // Emission atoms demand no offers.
      const pending = [clause];
      while (pending.length) {
        const part = /** @type {any} */ (pending.pop());
        if (!part || typeof part !== "object" || seen.has(part)) continue;
        seen.add(part);
        if (part.condition) for (const atom of boundaryAtoms(part.condition)) this.demand(atom);
        else if (Array.isArray(part.conditions)) for (const atom of boundaryAtoms(part.conditions)) this.demand(atom);
        for (const child of clauseChildren(part)) if (child !== part.emit) pending.push(child);
      }
    }
  }
  /** @param {string} name */
  name(name) {
    let bit = this.names.get(name);
    if (bit === undefined) this.names.set(name,bit = 1n << BigInt(this.names.size));
    return bit;
  }
  /** @param {any} atom */
  demand(atom) {
    const mask = atom.args.reduce((/** @type {bigint} */ bits,/** @type {any} */ arg) => bits | this.name(arg.rule ?? arg.terminal),0n);
    if (atom.method === "followed-by") this.forward |= mask;
    else this.backward |= mask;
  }
  /** @param {any} atom @param {boolean} positive */
  literal(atom,positive) {
    const direction = atom.method === "followed-by" ? "f" : "p";
    const target = atom.args.reduce((/** @type {bigint} */ bits,/** @type {any} */ arg) => bits | this.name(arg.rule ?? arg.terminal),0n);
    const key = `${direction}/${target}/${positive}`;
    let literal = this.literalKeys.get(key);
    if (!literal) {
      literal = {bit:1n << BigInt(this.literals.length),direction,target,positive};
      this.literalKeys.set(key,literal);
      this.literals.push(literal);
    }
    return literal;
  }
  /** @param {boolean} empty @param {bigint} start @param {bigint} first @param {bigint} end @param {bigint} last */
  intern(empty,start,first,end,last) {
    const key = `${empty}/${start}/${first}/${end}/${last}`;
    let record = this.records.get(key);
    if (!record) this.records.set(key,record = {id:this.records.size,empty,start,first,end,last});
    return record;
  }
  /** @param {bigint} literals @param {bigint} offers @param {string} direction @param {boolean} final @param {(literal:any)=>void} fail */
  meet(literals,offers,direction,final,fail) {
    let remaining = literals, failed = false;
    for (const literal of this.literals) {
      if (!(literals & literal.bit) || literal.direction !== direction) continue;
      const hit = !!(literal.target & offers);
      if (!hit && !final) continue;
      if (hit !== literal.positive) { fail(literal); failed = true; }
      remaining &= ~literal.bit;
    }
    return failed ? null : remaining;
  }
  /** @param {BoundaryRecord} record @param {bigint} bits */
  append(record,bits) { return this.intern(record.empty,record.start,record.first,record.end|bits,record.last); }
  /** @param {string} name @param {boolean} empty */
  leaf(name,empty) {
    const bit = this.names.get(name) ?? 0n;
    return empty ? this.empty : this.intern(false,0n,bit & this.forward,0n,bit & this.backward);
  }
  /** @param {BoundaryRecord} prefix @param {BoundaryRecord} child @param {(literal:any)=>void} fail */
  advance(prefix,child,fail) {
    if (child.empty) {
      if (prefix.empty) return this.append(prefix,child.end);
      // Rule 2 meets only the empty child's backward literals. The prefix's
      // own literals must reach the next nonempty constituent unchanged.
      const end = this.meet(child.end,prefix.last,"p",false,fail);
      return end === null ? null : this.append(prefix,end);
    }
    if (prefix.empty) {
      const start = this.meet(prefix.end|child.start,child.first,"f",false,fail);
      return start === null ? null : this.intern(false,start,child.first,child.end,child.last);
    }
    const middle = prefix.end|child.start;
    const forward = this.meet(middle,child.first,"f",true,fail);
    const backward = this.meet(middle,prefix.last,"p",true,fail);
    return forward === null || backward === null ? null : this.intern(false,prefix.start,prefix.first,child.end,child.last);
  }
  /** @param {BoundaryRecord} record @param {string|null} name @param {bigint} backward @param {bigint} forward @param {(literal:any)=>void} fail */
  complete(record,name,backward,forward,fail) {
    if (record.empty) return this.append(record,backward|forward);
    const bit = this.names.get(name) ?? 0n;
    const first = record.first|(bit & this.forward), last = record.last|(bit & this.backward);
    const start = this.meet(record.start,first,"f",false,fail);
    if (start === null) return null;
    const end = this.meet(record.end,last,"p",false,fail);
    return end === null ? null : this.intern(false,start|backward,first,end|forward,last);
  }
  /** @param {BoundaryRecord} record @param {(literal:any)=>void} fail */
  accepts(record,fail = () => {}) {
    const pending = record.start|record.end;
    let accepted = true;
    for (const literal of this.literals) if (pending & literal.bit && literal.positive) { fail(literal); accepted = false; }
    return accepted;
  }
  /** The option's facts after qualification, without the prefix's facts. @param {BoundaryRecord} prefix @param {BoundaryRecord} child */
  open(prefix,child) {
    if (child.empty) {
      const end = prefix.empty ? child.end : this.meet(child.end,prefix.last,"p",false,() => {});
      return end === null ? null : `E/${end}`;
    }
    return prefix.empty ? child.id : `N/${child.end}/${child.last}`;
  }
}

/** @type {WeakMap<object,any[]>} */
const cachedAtoms = new WeakMap();
/** @param {any} condition */
export function firstBoundaryAtom(condition) {
  let found = cachedAtoms.get(condition);
  if (!found) cachedAtoms.set(condition,found=boundaryAtoms(condition));
  return found[0];
}
/** @type {WeakMap<any[],BoundaryRecords|null>} */
const machines = new WeakMap();
/** @param {any[]} productions */
export function boundaryMachine(productions) {
  if (!machines.has(productions)) {
    const machine = new BoundaryRecords(productions);
    machines.set(productions,machine.forward || machine.backward ? machine : null);
  }
  return machines.get(productions) ?? null;
}

/** A cached document needs source positions only when it raises an error.
 * @type {WeakMap<object,{document:string,node:object}>} */
export const boundaryDocumentErrors = new WeakMap();
/** @param {any} dom @param {any[]} tokens @param {(token:any)=>[number,number]} positionOf */
export function restoreBoundaryLocations(dom,tokens,positionOf) {
  const atoms = dom.rules.flatMap((/** @type {any} */ rule) => boundaryAtoms([rule.conditions,rule.emit]));
  const selectors = tokens.flatMap((token,index) => BOUNDARY_METHODS.has(token.value) && tokens[index-1]?.text === "." && tokens[index+1]?.text === "(" ? [index] : []);
  if (atoms.length !== selectors.length) return;
  atoms.forEach((/** @type {any} */ atom,/** @type {number} */ index) => {
    const at = selectors[index];
    boundaryLocations.set(atom,{at:positionOf(tokens[at-2])});
    for (let argument=0;argument<atom.args.length;argument++) boundaryLocations.set(atom.args[argument],{at:positionOf(tokens[at+2+2*argument])});
  });
}

/** @type {WeakMap<object,Set<string>>} */
const emissionDemands = new WeakMap();
/** @param {any[]} productions */
export function emissionTargets(productions) {
  let names = emissionDemands.get(productions);
  if (!names) {
    names = new Set(productions.flatMap(p => boundaryAtoms(p.emit).flatMap(a => a.args.map((/** @type {any} */ target) => target.rule ?? target.terminal))));
    emissionDemands.set(productions,names);
  }
  return names;
}
