import {helperSlotForest} from "./slot-forest.js";

// Admission uses finite eligible facts, before the ordinary ranker.
export class RankedAdmission {
  /** @param {any} chart @param {any} ranked @param {any} maximal */
  constructor(chart, ranked, maximal) {
    const names = new Set(ranked.groups.map((/** @type {any} */ g) => g.helper));
    this.forest = helperSlotForest(chart,names,maximal);
    this.maximal = maximal;
    this.groups = new Map();
    this.at = new Map();
    this.maxima = new Map();
    this.masks = new Map();
    this.stats = {chartFacts:0,groups:0,candidateEdges:0,retainedEdges:0};
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
        item.prefix,captures.reverse(),item.strict,item.restores];
    };
    for (const set of (this.forest?.chart ?? chart).sets) if (set) for (const item of set.items) {
      this.stats.chartFacts++;
      const group = item.production.rhs[item.dot-1]?.slot;
      if (!group || !names.has(group.helper) || item.production.helper && !item.slotScope) continue;
      for (const [index,edge] of item.edges.entries()) {
        if (edge.kind !== 'complete') continue;
        const scope = item.slotScope;
        const ancestry = scope ? [scope.frames.map(prefix),scope.bounds.map((/** @type {any} */ b) => [written(b.carrier.production),b.carrier.origin,b.carrier.end,b.restricted])] : null;
        const key = JSON.stringify([group.id,prefix(edge.previous),ancestry,edge.child.origin,edge.child.end]);
        let candidates = this.groups.get(key);
        if (!candidates) this.groups.set(key,candidates=[]);
        candidates.push({item,index,edge,option:edge.child.production.rankedOption});
        let choices = this.at.get(item);
        if (!choices) this.at.set(item,choices=new Map());
        choices.set(index,candidates);
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
    return choices ? [...new Set(choices.values())].filter(group => !this.maxima.get(group)?.has(key))
      .flatMap(group => group.map((/** @type {any} */ candidate) => candidate.edge)) : [];
  }

  /** @param {any} item @param {any} dependency @param {string} context */
  compute(item,dependency,context) {
    const choices = this.at.get(item);
    if (!choices) return this.forest?.routeMasks.get(item) ?? null;
    const key = this.availabilityKey(item,context), mask = {all:new Set(),allowed:new Set()};
    for (const [index,group] of choices) {
      let contexts = this.maxima.get(group);
      if (!contexts) this.maxima.set(group,contexts=new Map());
      let kept = contexts.get(key);
      if (!kept) {
        kept = {all:Infinity,allowed:Infinity};
        for (const candidate of group) {
          const {edge} = candidate;
          if (!dependency(edge.previous).all || !dependency(edge.child).all) continue;
          kept.all = Math.min(kept.all,candidate.option);
          if (!this.maximal?.guards(candidate.item) || !this.maximal.forbids(edge.child,candidate.item.production.rhs[candidate.item.dot-1].test)) {
            kept.allowed = Math.min(kept.allowed,candidate.option);
          }
        }
        contexts.set(key,kept);
      }
      const option = item.edges[index].child.production.rankedOption;
      if (option === kept.all) mask.all.add(index);
      if (option === kept.allowed) mask.allowed.add(index);
    }
    const route = this.forest?.routeMasks.get(item);
    if (route) {
      for (const index of mask.all) if (!route.all.has(index)) mask.all.delete(index);
      for (const index of mask.allowed) if (!route.allowed.has(index)) mask.allowed.delete(index);
    }
    let contexts = this.masks.get(item);
    if (!contexts) this.masks.set(item,contexts=new Map());
    contexts.set(context,mask);
    this.stats.retainedEdges += mask.all.size;
    return mask;
  }

  /** @param {any} item @param {string} context */
  mask(item,context) {
    if (!this.at.has(item)) return this.forest?.routeMasks.get(item) ?? null;
    const found = this.masks.get(item)?.get(context);
    if (!found) throw new Error('Ranked admission requires eligible child facts before ranking.');
    return found;
  }
}
