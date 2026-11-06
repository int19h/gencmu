// Erased completions retain observable state, but no private bindings (§6).
/** @typedef {import('./types.js').Item} Item */
/** @typedef {{indices:number[],erased:boolean}} EdgeGroup */
export class ErasedClasses {
  constructor(){
    /** @type {WeakMap<object,number>} */ this.ids=new WeakMap();
    /** @type {WeakMap<object,string>} */ this.keys=new WeakMap();
    this.next=0;
  }
  /** @param {object} object */
  id(object){let id=this.ids.get(object);if(id===undefined){id=this.next++;this.ids.set(object,id);}return id;}
  /** @param {Item} item */
  key(item){
    let key=this.keys.get(item);
    if(key===undefined){
      key=JSON.stringify([item.production.lhs,item.origin,item.end,item.tagId,item.prefix,item.structure,
        item.production.closeRequested?item.observationPrefix?.id:null,item.production.closeRequested?item.observation?.id:null,item.familySummary?.id,
        item.production.treeRequested?/** @type {any} */(item).treePrefix:null,item.production.treeRequested?/** @type {any} */(item).treeIdentity:null,item.boundary?.id,
        item.strict,item.restores,!!item.production.closeRequested,!!item.production.treeRequested,
        item.production.lexicalFrame?.id,item.slotScope?.id]);
      this.keys.set(item,key);
    }
    return key;
  }
  /** @param {import('./types.js').Edge[]} edges @param {Set<number>|null|undefined} [mask] @returns {EdgeGroup[]} */
  groups(edges,mask){
    const groups=[],seen=new Map();
    for(let index=0;index<edges.length;index++){
      if(mask&&!mask.has(index))continue;
      const edge=edges[index],erased=edge.kind==='complete'&&edge.child.production.erased;
      const key=erased?this.id(edge.previous)+'/'+this.key(edge.child):null;
      const old=key===null?undefined:seen.get(key);
      if(old)old.indices.push(index);
      else {const group={indices:[index],erased};groups.push(group);if(key!==null)seen.set(key,group);}
    }
    return groups;
  }
  /** @param {Item[]} roots @returns {number[][]} */
  roots(roots){
    const groups=[],seen=new Map();
    for(const [index,item] of roots.entries()){
      const key=item.production.erased?this.key(item):null;
      const old=key===null?undefined:seen.get(key);
      if(old)old.push(index);
      else {const group=[index];groups.push(group);if(key!==null)seen.set(key,group);}
    }
    return groups;
  }
}
