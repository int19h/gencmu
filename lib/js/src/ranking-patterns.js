// Local node predicates for ranking (engine §6 and §9.3).
import { localNodeMatches, patternParts } from './patterns.js';

/** @param {any} pattern @returns {boolean} */
export function requiresElided(pattern) {
  if (pattern.union) return pattern.union.every(requiresElided);
  if (pattern.intersection) return pattern.intersection.some(requiresElided);
  if (pattern.difference) return requiresElided(pattern.difference[0]);
  if (pattern.test === 'tags' && pattern.requirements.some((/** @type {any} */ r)=>!r.negated && r.value.set.has('_Elided'))) return true;
  return !!pattern.expr && requiresElided(pattern.expr);
}

/** @param {any} pattern @returns {string|null} */
export function rankingPatternProblem(pattern) {
  if (pattern.union || pattern.intersection || pattern.difference) {
    for (const operand of pattern.union ?? pattern.intersection ?? pattern.difference) {
      const problem=rankingPatternProblem(operand);
      if (problem) return problem;
    }
    return null;
  }
  if (!pattern.exact || pattern.children || pattern.path || pattern.any && !pattern.test) return 'a ranking step requires an exact local node pattern';
  return null;
}

/** @param {any} pattern @returns {boolean} */
export function readsNodeTags(pattern) {
  if (pattern.test === 'tags' && (pattern.expr?.name || pattern.expr?.call)) return true;
  return patternParts(pattern).some(readsNodeTags);
}

/** @param {any} pattern @param {any} node @returns {boolean|null} */
export function possibleNodeMatch(pattern,node) {
  const and=(/** @type {(boolean|null)[]} */ values)=>values.includes(false)?false:values.includes(null)?null:true;
  const or=(/** @type {(boolean|null)[]} */ values)=>values.includes(true)?true:values.includes(null)?null:false;
  if (pattern.union) return or(pattern.union.map((/** @type {any} */ p)=>possibleNodeMatch(p,node)));
  if (pattern.intersection) return and(pattern.intersection.map((/** @type {any} */ p)=>possibleNodeMatch(p,node)));
  if (pattern.difference) {
    const right=possibleNodeMatch(pattern.difference[1],node);
    return and([possibleNodeMatch(pattern.difference[0],node),right === null?null:!right]);
  }
  if (pattern.test) {
    const base=possibleNodeMatch(pattern.expr,node);
    if (base === false) return false;
    if (pattern.test !== 'tags') return and([base,node.value === undefined?null:localNodeMatches(pattern,node.name??null,node.tags??new Set(),node.name?null:node,node.value)]);
    if (node.tags) return and([base,localNodeMatches(pattern,node.name??null,node.tags,node.terminal?node:null,node.value)]);
    if (pattern.requirements.some((/** @type {any} */ r)=>!r.negated && r.value.set.has('_Elided'))) return false;
    return and([base,pattern.requirements.length?null:true]);
  }
  if (pattern.name) return pattern.name === node.name;
  if (pattern.terminal) return pattern.terminal === "_" ? !!node.terminal : pattern.terminal === node.terminal;
  return false;
}

/** @param {any} pattern @returns {boolean} */
export function hasPatternValue(pattern) {
  return pattern.test === '=' || pattern.test === '≠' || patternParts(pattern).some(hasPatternValue);
}

/** @param {any} term @returns {Set<string>|null} */
export function knownTags(term) {
  if (!term || term.if || term.method) return null;
  if (term.tag) return new Set([term.tag]);
  if (term.set instanceof Set) return term.set;
  if (term.emptySet) return new Set();
  const parts=term.union ?? term.intersection ?? term.difference;
  if (!parts) return null;
  const values=parts.map(knownTags);
  if (values.some((/** @type {any} */ value)=>value === null)) return null;
  const [first,...rest]=values;
  if (term.union) return new Set(values.flatMap((/** @type {Set<string>} */ value)=>[...value]));
  return new Set([...first].filter(tag=>term.intersection?rest.every((/** @type {Set<string>} */ value)=>value.has(tag)):!rest[0].has(tag)));
}

/** @type {WeakMap<object,boolean>} */
const profileDecisions=new WeakMap();
/** @param {any} lowered @returns {boolean} */
export function canCountProfiles(lowered) {
  const steps=lowered.resolution.steps;
  if (!steps.length) return false;
  const cached=profileDecisions.get(lowered);
  if (cached !== undefined) return cached;
  const pending=['text'],seen=new Set();
  let possible=false;
  const test=(/** @type {any} */ node)=>steps.some((/** @type {any} */ step)=>possibleNodeMatch(step.pattern,node)!==false);
  while(pending.length) {
    const name=pending.pop();
    if(seen.has(name)) continue;
    seen.add(name);
    for(const p of lowered.byLhs.get(name)??[]) {
      if(!p.helper) possible ||= test({name:p.lhs,tags:p.tags?knownTags(p.tags):new Set()});
      if(p.elided && !p.rhs.length) possible ||= test({terminal:p.elided,tags:new Set([p.elided,'_Elided']),value:''});
      for(const symbol of p.rhs) {
        if(symbol.terminal) possible ||= test({terminal:symbol.name});
        else pending.push(symbol.name);
      }
    }
  }
  profileDecisions.set(lowered,possible);
  return possible;
}
