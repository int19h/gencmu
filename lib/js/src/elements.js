// Element boundaries beside physical capture expansions (engine §3.2).
/** @import { GrammarSymbol } from "./types.js" */
/** @typedef {{from:number,to:number,symbol?:GrammarSymbol,children?:Element[],written?:object}} Element */
/** @type {WeakMap<object,Element[]>} */
const structures = new WeakMap();

/** @param {{symbol:GrammarSymbol}[]} sequence @returns {Element[]} */
export function elementsOf(sequence) {
  let elements = structures.get(sequence);
  if (!elements) structures.set(sequence, elements = sequence.map((item,index) => ({from:index,to:index+1,symbol:item.symbol})));
  return elements;
}

/** @param {Element} node @param {number} offset @returns {Element} */
function shifted(node,offset) {
  return {...node,from:node.from+offset,to:node.to+offset,
    ...(node.children ? {children:node.children.map(child => shifted(child,offset))} : {})};
}

/** @param {object} sequence @param {Element[]} left @param {Element[]} right @param {number} offset @param {boolean} [owned] */
export function joinedElements(sequence,left,right,offset,owned=false) {
  const suffix = right.map(node => shifted(node,offset));
  const elements = owned ? left : [...left];
  for (const node of suffix) elements.push(node);
  structures.set(sequence,elements);
}

/** @param {{symbol:GrammarSymbol}[]} sequence @param {object} written */
export function optionalElement(sequence,written) {
  const children = elementsOf(sequence);
  structures.set(sequence,[{from:0,to:sequence.length,children,written}]);
}

/** @param {Element[]} elements @returns {number|null} */
export function inheritedIndex(elements) {
  let children = elements;
  while (children.length === 1) {
    const node = children[0];
    if (node.symbol) return node.from;
    children = node.children ?? [];
  }
  return null;
}
