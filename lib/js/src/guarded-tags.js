// Concrete variants for neighbour guards in constituent tags (engine §3.7).
import { BOUNDARY_METHODS, boundaryAtoms, clauseChildren } from './clause-walk.js';

/** @param {any} term @returns {Set<string>|null} */
function literalTags(term) {
  if (term?.tag) return new Set([term.tag]);
  if (term?.emptySet) return new Set();
  if (term?.const) return term.value?.set instanceof Set ? term.value.set : null;
  const parts=term?.union ?? term?.intersection ?? term?.difference;
  if (!parts) return null;
  const sets=parts.map(literalTags);
  if (sets.some((/** @type {Set<string>|null} */ set)=>set===null)) return null;
  const first=new Set(sets[0] ?? []);
  if (term.union) {
    for (const set of sets.slice(1)) for (const tag of set) first.add(tag);
  } else if (term.intersection) {
    for (const tag of first) if (sets.some((/** @type {Set<string>} */ set)=>!set.has(tag))) first.delete(tag);
  } else {
    for (const tag of sets[1]) first.delete(tag);
  }
  return first;
}

/** @param {any} term @returns {{node:any,atom:any,negated:boolean}[]} */
export function neighbourGuards(term) {
  const result=[], pending=[term];
  while (pending.length) {
    const node=pending.pop();
    if (!node || typeof node!=='object') continue;
    if (node.if && boundaryAtoms(node.if).length) {
      result.push({node,atom:node.if.not ?? node.if,negated:!!node.if.not});
      continue;
    }
    for (const child of clauseChildren(node).slice().reverse()) pending.push(child);
  }
  return result;
}

/** @param {any} term @returns {boolean} */
function literalTagShape(term) {
  if (term?.tag || term?.emptySet || term?.const || term?.param) return true;
  const operands=term?.union ?? term?.intersection ?? term?.difference;
  return !!operands && operands.every(literalTagShape);
}

/** @param {any} term @returns {{problem:string,node:any}|null} */
export function neighbourGuardProblem(term) {
  for (const {node,atom} of neighbourGuards(term)) {
    if (!BOUNDARY_METHODS.has(atom.method) || atom.receiver?.capture!=='' || Object.keys(atom.receiver).length!==1) {
      return {problem:'a tag guard requires one optionally negated neighbour atom on $',node:node.if};
    }
    if (literalTags(node.then)===null && !literalTagShape(node.then)) {
      return {problem:'a neighbour tag guard requires a literal tag set',node:node.if};
    }
  }
  return null;
}

/** @param {any} term @returns {{tags:any,conditions:any[]}[]} */
export function guardedTagVariants(term) {
  const guards=neighbourGuards(term);
  if (!guards.length) return [{tags:term,conditions:[]}];
  /** @type {any[]} */
  const atoms=[];
  const byKey=new Map(), parts=new Map();
  for (const {node,atom,negated} of guards) {
    const tags=literalTags(node.then);
    if (tags===null) throw new Error('a neighbour tag guard requires a literal tag set');
    // An empty consequent contributes no tag under either truth value.
    if (!tags.size) {parts.set(node,{empty:true});continue;}
    const targets=[...new Set(atom.args.map((/** @type {any} */ arg)=>JSON.stringify([arg.rule?'rule':'terminal',arg.rule ?? arg.terminal])))].sort();
    const key=JSON.stringify([atom.method,targets]);
    let index=byKey.get(key);
    if (index===undefined) {index=atoms.length;byKey.set(key,index);atoms.push({atom,targets,direction:atom.method});}
    parts.set(node,{index,negated});
  }
  const assigned=/** @type {boolean[]} */ ([]);
  /** @type {{tags:any,conditions:any[]}[]} */
  const result=[];
  const possible=()=> {
    for (let i=0;i<assigned.length;i++) if (assigned[i]) {
      const negative=new Set();
      for (let j=0;j<assigned.length;j++) if (!assigned[j] && atoms[j].direction===atoms[i].direction) for (const target of atoms[j].targets) negative.add(target);
      if (atoms[i].targets.every((/** @type {string} */ target)=>negative.has(target))) return false;
    }
    return true;
  };
  /** @param {any} node @returns {any} */
  const replace=(node)=> {
    const part=parts.get(node);
    if (part) return !part.empty && assigned[part.index]!==part.negated ? node.then : {emptySet:true};
    if (!node || typeof node!=='object' || node instanceof Set) return node;
    if (Array.isArray(node)) return node.map(replace);
    // Only the term spine changes. Condition and capture identities stay intact.
    if (node.if) return {...node,then:replace(node.then)};
    for (const key of ['union','intersection','difference']) if (node[key]) return {...node,[key]:node[key].map(replace)};
    return node;
  };
  const visit=()=> {
    if (!possible()) return;
    if (assigned.length===atoms.length) {
      result.push({tags:replace(term),conditions:atoms.map(({atom},index)=>assigned[index]?atom:{not:atom})});
      if (result.length>16) throw new Error('a production has more than 16 guarded tag variants');
      return;
    }
    assigned.push(false);visit();assigned.pop();
    assigned.push(true);visit();assigned.pop();
  };
  visit();
  return result;
}
