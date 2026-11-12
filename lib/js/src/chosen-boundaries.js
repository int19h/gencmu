// Boundary observations of one chosen derivation (engine §4.2).
/** @param {import('./types.js').Derivation} root @param {Set<string>} demanded */
export function chosenBoundaries(root,demanded) {
  /** @type {Map<number,Set<string>>} */ const first=new Map(),last=new Map();
  const pending=demanded.size?[root]:[];
  const offer=(/** @type {Map<number,Set<string>>} */ map,/** @type {number} */ at,/** @type {string} */ name)=>{
    let names=map.get(at);if(!names)map.set(at,names=new Set());names.add(name);
  };
  while(pending.length) {
    const node=/** @type {import('./types.js').Derivation} */(pending.pop());
    if(node.start<node.end) {
      const name='read' in node?node.read.terminal:node.production.helper?null:node.production.lhs;
      if(name!==null && demanded.has(name)){offer(first,node.start,name);offer(last,node.end,name);}
    }
    if(!('read' in node))for(const child of node.children)pending.push(child);
  }
  return {first,last};
}

/** @param {ReturnType<typeof chosenBoundaries>} boundaries @param {any} atom
 * @param {{start:number,end:number}} span */
export function chosenBoundary(boundaries,atom,span) {
  const forward=atom.method==='followed-by';
  const offers=(forward?boundaries.first:boundaries.last).get(forward?span.end:span.start);
  return !!offers && atom.args.some((/** @type {any} */ target)=>offers.has(target.rule??target.terminal));
}
