import {helperSlotForest,helperPrefixKey} from "./slot-forest.js";
import {slotSymbolRole} from "./preferences.js";
// Slot admission over raw packed edges. Counts supply finite eligible child
// proofs before any flag or omission ranking chooses a reading.
/** @typedef {{item: import("./types.js").Item, index: number, edge: Extract<import("./types.js").Edge, {kind:"complete"}>, label: string}} SlotCandidate */
/** @typedef {{all: Set<number>, allowed: Set<number>}} AdmissionMask */
export class SlotAdmission {
  /** @param {import("./earley.js").Chart} chart @param {import("./preferences.js").Preferences} preferences @param {import("./maximal.js").Maximal | null} maximal */
  constructor(chart, preferences, maximal) {
    this.forest = preferences.hasHelperSlots ? helperSlotForest(chart,preferences,maximal) : null;
    const originalChart=chart;
    chart=this.forest?.chart??chart;
    this.preferences = preferences;
    this.maximal = maximal;
    /** @type {Map<string,SlotCandidate[]>} */
    this.groups = new Map();
    /** @type {Map<import("./types.js").Item,Map<number,SlotCandidate[]>>} */
    this.at = new Map();
    /** @type {{plain: Map<import("./types.js").Item,AdmissionMask>, contextual: Map<import("./types.js").Item,Map<string,AdmissionMask>>}} */
    this.masks = {plain:new Map(), contextual:new Map()};
    /** @type {Map<SlotCandidate[], Map<string, {all:Set<string>, allowed:Set<string>}>>} */
    this.maxima = new Map();
    this.stats = {chartFacts:0, groups:0, candidateEdges:0, retainedEdges:0};
    if (!preferences.names.size) return;
    const helpers = new Map(originalChart.context.lowered.productions.filter(p => p.helper).map(p => [p.lhs, p.writtenExpression]));
    for (const set of chart.sets) if (set) for (const raw of set.items) {
      const item = /** @type {import("./types.js").Item} */ (raw);
      this.stats.chartFacts++;
      const symbol = item.production.rhs[item.dot - 1];
      if (!symbol?.slot || item.production.helper && !item.slotScope) continue;
      for (const [index, edge] of item.edges.entries()) {
        if (edge.kind !== 'complete') continue;
        const previous = edge.previous;
        const captures = [];
        for (let part=previous.slots; part; part=part.parent) {
          const capture = previous.production.captures[part.index];
          captures.push([(previous.production.componentRoles?.get(symbol.slot.id) ?? previous.production.slotRoles)?.get(capture?.name ?? "") ?? capture?.name, part.start, part.end, part.tags, part.structure]);
        }
        captures.reverse();
        const variant=/** @type {import("./preferences.js").SlotVariant} */ (preferences.ruleVariants.get(symbol.name));
        const scope=item.slotScope;
        const ancestry=scope?[scope.frames.map(frame=>helperPrefixKey(frame,variant,helpers)),scope.bounds.map(({carrier,restricted})=>[variant.paths.get(/** @type {object} */ (carrier.production.writtenExpression)),carrier.origin,carrier.end,restricted])]:null;
        const key = JSON.stringify([symbol.slot.id, ancestry, item.production.role, item.origin,
          previous.production.rhs.slice(0, previous.dot).map(s => [slotSymbolRole(s,variant,helpers), s.terminal, s.test]),
          previous.prefix, captures, previous.strict, previous.restores, edge.child.origin, edge.child.end]);
        let group = this.groups.get(key);
        if (!group) this.groups.set(key, group=[]);
        group.push({item,index,edge,label:symbol.name});
        let choices = this.at.get(item);
        if (!choices) this.at.set(item,choices=new Map());
        choices.set(index,group);
        this.stats.candidateEdges++;
      }
    }
    this.stats.groups = this.groups.size;
    if (this.forest) this.stats.chartFacts=originalChart.sets.reduce((sum,set)=>sum+(set?.items.length??0),0);
  }

  /** @param {import("./types.js").Item} item @param {string} context */
  availabilityKey(item, context) {
    return JSON.stringify([context, item.complete ? item.slotScope?.frames[0].production.lhs ?? item.production.lhs : null]);
  }

  /** @param {import("./types.js").Item} item @param {string} context */
  dependencies(item, context) {
    const choices = this.at.get(item);
    const key = this.availabilityKey(item, context);
    return choices ? [...new Set(choices.values())].filter(group => !this.maxima.get(group)?.has(key))
      .flatMap(group => group.map(candidate => candidate.edge)) : [];
  }

  /** @param {import("./types.js").Item} item @param {(item: import("./types.js").Item) => {all:number,allowed:number}} dependency @param {string} context */
  compute(item, dependency, context) {
    const choices = this.at.get(item);
    if (!choices) return this.forest?.routeMasks.get(item) ?? null;
    const maximal = this.maximal;
    const mask = {all:new Set(), allowed:new Set()};
    const key = this.availabilityKey(item, context);
    for (const [index,group] of choices) {
      let contexts = this.maxima.get(group);
      if (!contexts) this.maxima.set(group, contexts = new Map());
      let kept = contexts.get(key);
      if (!kept) {
        const present = new Set(), allowed = new Set();
        for (const candidate of group) {
          const {edge} = candidate;
          if (!dependency(edge.previous).all || !dependency(edge.child).all) continue;
          present.add(candidate.label);
          const guarded = maximal?.guards(candidate.item);
          if (!guarded || !maximal?.forbids(edge.child, candidate.item.production.rhs[candidate.item.dot - 1].test)) allowed.add(candidate.label);
        }
        /** @type {(labels: Set<string>) => Set<string>} */
        const maximalLabels = labels => new Set([...labels].filter(label => ![...labels].some(higher => this.preferences.paths.get(higher)?.has(label))));
        kept = {all:maximalLabels(present), allowed:maximalLabels(allowed)};
        contexts.set(key,kept);
      }
      const label = item.production.rhs[item.dot - 1].name;
      if (kept.all.has(label)) mask.all.add(index);
      if (kept.allowed.has(label)) mask.allowed.add(index);
    }
    if (context === '') this.masks.plain.set(item,mask);
    else {
      let contexts = this.masks.contextual.get(item);
      if (!contexts) this.masks.contextual.set(item,contexts=new Map());
      contexts.set(context,mask);
    }
    this.stats.retainedEdges += mask.all.size;
    return mask;
  }

  /** @param {import("./types.js").Item} item @param {string} context */
  mask(item, context) {
    if (!this.at.has(item)) return this.forest?.routeMasks.get(item) ?? null;
    const found = context === '' ? this.masks.plain.get(item) : this.masks.contextual.get(item)?.get(context);
    if (!found) throw new Error('Slot admission requires eligible child facts before ranking.');
    return found;
  }
}
