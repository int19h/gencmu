// Diagnostic sources flow beside records. They never distinguish items.

/** @typedef {{rule:string,condition:number,order:number}} BoundarySite */
export class BoundarySource {
  constructor() {
    /** @type {Set<BoundarySite>} */
    this.sites = new Set();
    /** @type {Set<BoundarySource>} */
    this.users = new Set();
  }
  /** @param {BoundarySite} site */
  add(site) {
    /** @type {BoundarySource[]} */
    const pending = [this];
    for (let index = 0; index < pending.length; index++) {
      const source = pending[index];
      if (source.sites.has(site)) continue;
      source.sites.add(site);
      for (const user of source.users) pending.push(user);
    }
  }
  /** Later joins must also reach items that already advanced.
   * @param {BoundarySource|undefined} source */
  inherit(source) {
    if (!source || source === this || source.users.has(this)) return;
    source.users.add(this);
    for (const site of source.sites) this.add(site);
  }
}

/** @typedef {Map<bigint,BoundarySource>} Sources */
/** @param {bigint} mask @param {Sources[]} inputs @returns {Sources} */
function select(mask,...inputs) {
  const result = new Map();
  for (const input of inputs) for (const [bit,source] of input) {
    if (!(mask & bit)) continue;
    let target = result.get(bit);
    if (!target) result.set(bit,target=new BoundarySource());
    target.inherit(source);
  }
  return result;
}

export class BoundaryAnnotations {
  /** @param {Sources} [start] @param {Sources} [end] */
  constructor(start = new Map(),end = new Map()) {
    this.start = start;
    this.end = end;
  }
  /** @param {import("./boundary.js").BoundaryRecord} record */
  retain(record) {
    return new BoundaryAnnotations(select(record.start,this.start),select(record.end,this.end));
  }
  /** @param {"start"|"end"} edge @param {bigint} bit @param {BoundarySite|undefined} site */
  add(edge,bit,site) {
    let source = this[edge].get(bit);
    if (!source) this[edge].set(bit,source=new BoundarySource());
    if (site) source.add(site);
  }
  /** Equal records keep one item and join its annotations.
   * @param {BoundaryAnnotations} other */
  merge(other) {
    for (const edge of /** @type {const} */ (["start","end"])) for (const [bit,source] of other[edge]) {
      let target = this[edge].get(bit);
      if (!target) this[edge].set(bit,target=new BoundarySource());
      target.inherit(source);
    }
  }
  /** @param {BoundaryAnnotations} child @param {boolean} empty @param {bigint} bit */
  meeting(child,empty,bit) {
    const source = new BoundarySource();
    if (empty) source.inherit(child.end.get(bit));
    else {source.inherit(this.end.get(bit));source.inherit(child.start.get(bit));}
    return source;
  }
  /** Follow the same boundary transfers as the record's advance.
   * @param {import("./boundary.js").BoundaryRecords} machine
   * @param {import("./boundary.js").BoundaryRecord} prefix
   * @param {import("./boundary.js").BoundaryRecord} child
   * @param {import("./boundary.js").BoundaryRecord} result
   * @param {BoundaryAnnotations} sources */
  advance(machine,prefix,child,result,sources) {
    if (child.empty) {
      const pending = prefix.empty ? child.end : machine.meet(child.end,prefix.last,"p",false,() => {}) ?? 0n;
      return new BoundaryAnnotations(select(result.start,this.start),select(result.end,this.end,select(pending,sources.end)));
    }
    return prefix.empty
      ? new BoundaryAnnotations(select(result.start,this.end,sources.start),select(result.end,sources.end))
      : new BoundaryAnnotations(select(result.start,this.start),select(result.end,sources.end));
  }
}
