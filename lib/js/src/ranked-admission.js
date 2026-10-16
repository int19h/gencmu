import {hooks} from "./testing.js";
import {helperSlotForest} from "./slot-forest.js";
import {boundaryDominates} from "./boundary.js";

// Admission uses finite eligible facts, before the ordinary ranker.
export class RankedAdmission {
  /** @param {any} chart @param {any} ranked */
  constructor(chart, ranked) {
    const names = new Set(ranked.groups.map((/** @type {any} */ g) => g.helper));
    this.forest = helperSlotForest(chart,names);
    this.groups = new Map();
    this.at = new Map();
    this.qualified = new Map();
    this.masks = new Map();
    this.stats = {chartFacts:0,groups:0,candidateEdges:0,retainedEdges:0,boundarySplits:/** @type {any[]} */ ([])};
    const reported = new Set();
    this.reportSplit = (/** @type {any[]} */ candidates) => {
      const {site,entry,edge} = candidates[0];
      if (reported.has(entry)) return;
      reported.add(entry);
      const split = {group:site,entry,start:edge.child.origin,end:edge.child.end};
      this.stats.boundarySplits.push(split);
      hooks.boundaryAdmission?.([split],chart);
    };
    const helpers = new Map(chart.context.lowered.productions.filter((/** @type {any} */ p) => p.helper).map((/** @type {any} */ p) => [p.lhs,p]));
    const written = (/** @type {any} */ p) => [p.owner ?? p.lhs,p.source?.at,ranked.paths.get(p.writtenExpression) ?? ''];
    const prefix = (/** @type {any} */ item) => {
      const captures = [];
      for (let part = item.slots; part; part = part.parent) {
        const name = item.production.captures[part.index].name;
        if (!name.startsWith('\u0000')) captures.push([name,part.start,part.end,part.tags,part.structure]);
      }
      return [item.production.lexicalFrame?.key ?? null,written(item.production),item.origin,
        item.production.rhs.slice(0,item.dot).map((/** @type {any} */ s) => [helpers.has(s.name) ? written(helpers.get(s.name)) : s.name,s.terminal,s.test]),
        item.production.rhs.slice(item.dot).map((/** @type {any} */ s) => [helpers.has(s.name) ? written(helpers.get(s.name)) : s.name,s.terminal,s.test]),
        item.prefix,captures.reverse(),item.strict,item.restores,item.boundary?.id ?? null];
    };
    for (const set of (this.forest?.chart ?? chart).sets) if (set) for (const item of set.items) {
      this.stats.chartFacts++;
      const group = item.production.rhs[item.dot-1]?.slot;
      if (!group || !names.has(group.helper) || item.production.helper && !item.slotScope) continue;
      for (const [index,edge] of item.edges.entries()) {
        if (edge.kind !== 'complete') continue;
        const scope = item.slotScope;
        const ancestry = scope ? [scope.frames.map(prefix),scope.bounds.map((/** @type {any} */ b) => [written(b.carrier.production),b.carrier.origin,b.carrier.end])] : null;
        const baseKey = JSON.stringify([group.id,prefix(edge.previous),ancestry,edge.child.origin,edge.child.end]);
        const open = chart.context.boundaries?.open(edge.previous.boundary,edge.child.boundary) ?? null;
        let candidates = this.groups.get(baseKey);
        if (!candidates) this.groups.set(baseKey,candidates=[]);
        const candidate = {item,index,edge,option:edge.child.production.rankedOption,open,site:group.site,entry:baseKey};
        candidates.push(candidate);
        let choices = this.at.get(item);
        if (!choices) this.at.set(item,choices=new Map());
        choices.set(index,{group:candidates,candidate});
        this.stats.candidateEdges++;
      }
    }
    this.stats.groups = this.groups.size;
  }

  /** @param {any} item @param {string} context */
  availabilityKey(item,context) {
    return JSON.stringify([context,item.complete ? item.slotScope?.frames[0].production.lhs ?? item.production.lhs : null]);
  }

  /** @param {any} item @param {string} context */
  dependencies(item,context) {
    const choices = this.at.get(item), key = this.availabilityKey(item,context);
    return choices ? [...new Set([...choices.values()].map(choice => choice.group))].filter(group => !this.qualified.get(group)?.has(key))
      .flatMap(group => group.map((/** @type {any} */ candidate) => candidate.edge)) : [];
  }

  /** @param {any} item @param {any} dependency @param {string} context */
  compute(item,dependency,context) {
    const choices = this.at.get(item);
    if (!choices) return null;
    const key = this.availabilityKey(item,context), mask = new Set();
    for (const [index,{group,candidate}] of choices) {
      let contexts = this.qualified.get(group);
      if (!contexts) this.qualified.set(group,contexts=new Map());
      let kept = contexts.get(key);
      if (kept === undefined) {
        const viable = group.filter((/** @type {any} */ proof) => dependency(proof.edge.previous).all && dependency(proof.edge.child).all);
        kept = new Set(viable.filter((/** @type {any} */ proof) => !viable.some((/** @type {any} */ higher) =>
          higher.option < proof.option && boundaryDominates(higher.open,proof.open))));
        if ([...kept].some(proof => viable.some((/** @type {any} */ higher) => higher.option < proof.option))) this.reportSplit(group);
        contexts.set(key,kept);
      }
      if (kept.has(candidate)) mask.add(index);
    }
    let contexts = this.masks.get(item);
    if (!contexts) this.masks.set(item,contexts=new Map());
    contexts.set(context,mask);
    this.stats.retainedEdges += mask.size;
    return mask;
  }

  /** @param {any} item @param {string} context */
  mask(item,context) {
    if (!this.at.has(item)) return null;
    const found = this.masks.get(item)?.get(context);
    if (!found) throw new Error('Ranked admission requires eligible child facts before ranking.');
    return found;
  }
}
