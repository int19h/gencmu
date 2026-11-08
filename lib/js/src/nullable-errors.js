// Conservative empty-error test before feature filtering (engine §3.6).

/**
 * The first error alternative that can read no tokens. Gates, conditions,
 * and symbol tests cannot establish a positive width. Each dependency edge
 * participates in the least fixed point once, including recursive calls.
 * @param {Map<string,import('./grammar.js').StitchedRule>} rules
 * @param {{rule:import('./grammar.js').StitchedRule,alternative:import('./grammar.js').StitchedAlternative}[]} errors
 */
export function nullableError(rules, errors) {
  /** @typedef {{all:boolean,children:number[],users:number[],remaining:number,value:boolean}} Node */
  /** @type {Node[]} */
  const nodes=[];
  /** @type {Map<object|string,number>} */
  const identities=new Map();
  /** @type {(object|string)[]} */
  const pending=[];
  /** @param {object|string} identity */
  const intern=identity=>{
    const previous=identities.get(identity);
    if(previous!==undefined)return previous;
    const id=nodes.length;
    identities.set(identity,id);
    nodes.push({all:false,children:[],users:[],remaining:0,value:false});
    pending.push(identity);
    return id;
  };
  const roots=errors.map(({alternative})=>intern(alternative.expr));
  for(let index=0;index<pending.length;index++){
    const identity=pending[index],node=nodes[index];
    /** @type {(object|string)[]} */
    let children=[];
    if(typeof identity==='string')children=rules.get(identity)?.alternatives.map(alternative=>alternative.expr) ?? [];
    else {
      const expr=/** @type {import('./types.js').Expr} */(identity);
      if('empty' in expr || 'optional' in expr)node.all=true;
      else if('seq' in expr){node.all=true;children=expr.seq;}
      else if('choice' in expr)children=expr.choice;
      else if('ranked' in expr)children=expr.ranked;
      else if('and' in expr)children=expr.and;
      else if('repeat' in expr)children=[expr.repeat];
      else if('capture' in expr || 'test' in expr)children=[expr.expr];
      else if('splice' in expr)children=[expr.splice];
      else if('ref' in expr && rules.has(expr.ref))children=[expr.ref];
    }
    node.children=children.map(intern);
    node.remaining=node.children.length;
    for(const child of node.children)nodes[child].users.push(index);
  }
  const ready=[];
  for(let index=0;index<nodes.length;index++)if(nodes[index].all && nodes[index].remaining===0){nodes[index].value=true;ready.push(index);}
  for(let index=0;index<ready.length;index++)for(const user of nodes[ready[index]].users){
    const node=nodes[user];
    if(node.value)continue;
    if(!node.all || --node.remaining===0){node.value=true;ready.push(user);}
  }
  const first=roots.findIndex(root=>nodes[root].value);
  return first<0?undefined:errors[first];
}
