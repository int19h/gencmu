// Logical helper boundaries beside physical capture expansions (engine §3.2).
/** @import { GrammarSymbol } from "./types.js" */
/** @typedef {{from:number,to:number,symbol?:GrammarSymbol,children?:LogicalSymbol[],written?:object}} LogicalSymbol */
/** @type {WeakMap<object,LogicalSymbol[]>} */
const structures = new WeakMap();

/** @param {{symbol:GrammarSymbol}[]} sequence @returns {LogicalSymbol[]} */
export function logicalOf(sequence) {
  let logical = structures.get(sequence);
  if (!logical) structures.set(sequence, logical = sequence.map((item,index) => ({from:index,to:index+1,symbol:item.symbol})));
  return logical;
}

/** @param {LogicalSymbol} node @param {number} offset @returns {LogicalSymbol} */
function shifted(node,offset) {
  return {...node,from:node.from+offset,to:node.to+offset,
    ...(node.children ? {children:node.children.map(child => shifted(child,offset))} : {})};
}

/** @param {object} sequence @param {LogicalSymbol[]} left @param {LogicalSymbol[]} right @param {number} offset */
export function joinedLogical(sequence,left,right,offset) {
  structures.set(sequence,[...left,...right.map(node => shifted(node,offset))]);
}

/** @param {{symbol:GrammarSymbol}[]} sequence @param {object} written */
export function optionalLogical(sequence,written) {
  const children = logicalOf(sequence);
  structures.set(sequence,[{from:0,to:sequence.length,children,written}]);
}

/** @param {LogicalSymbol[]} logical @returns {number|null} */
export function inheritedIndex(logical) {
  let children = logical;
  while (children.length === 1) {
    const node = children[0];
    if (node.symbol) return node.from;
    children = node.children ?? [];
  }
  return null;
}
