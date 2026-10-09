// Lexical entry state for transparent helpers in a ranked alternative.
import {prepareConditions, partsFor} from "./dom.js";
import {rankedCaptureReads} from "./ranked.js";

/** @param {any} lowered @param {any} ranked */
export function prepareRankedFrames(lowered, ranked) {
  if (!ranked.groups.length) return;
  const helpers = new Map(lowered.productions.filter((/** @type {any} */ p) => p.helper).map((/** @type {any} */ p) => [p.lhs, p]));
  const groups = new Map(ranked.groups.map((/** @type {any} */ g) => [g.helper, g]));
  const privateNames = new Map();
  for (const group of ranked.groups) {
    const names = new Set();
    const pending = [group.expr];
    while (pending.length) {
      const expr = pending.pop();
      if (expr.capture) names.add(expr.capture);
      for (const [key, value] of Object.entries(expr)) {
        if (key === 'ranked' || key === 'seq' || key === 'choice' || key === 'and') for (const child of value) pending.push(child);
        else if (['node','optional','repeat','separator','group'].includes(key)) pending.push(value);
      }
    }
    privateNames.set(group, names);
  }
  const descendants = (/** @type {any} */ name) => {
    const found = new Set(), visited = new Set(), pending = [name];
    while (pending.length) {
      const next = pending.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      if (groups.has(next)) found.add(groups.get(next));
      for (const p of lowered.byLhs.get(next) ?? []) if (p.helper) {
        for (const s of p.rhs) if (helpers.has(s.name)) pending.push(s.name);
      }
    }
    return found;
  };
  for (const p of lowered.productions) {
    const relevant = new Set();
    for (const s of p.rhs) for (const g of descendants(s.name)) relevant.add(g);
    const own = p.rankedGroup;
    const names = new Set([...relevant].flatMap((/** @type {any} */ g) => [...privateNames.get(g)]));
    const clauses = p.source?.clauses.conditions ?? [];
    if (!p.helper) {
      // Private conditions run at their lexical boundary, including guards
      // on a capture absent from the selected option.
      p.rankedDeferred = clauses.filter((/** @type {any} */ c) => [...rankedCaptureReads(c)].some(n => names.has(n)));
      // Presence simplification can erase every read, so rebuild these clauses.
      const common = clauses.filter((/** @type {any} */ c) => !p.rankedDeferred.includes(c));
      const present = new Set(['', ...p.captures.map((/** @type {any} */ c) => c.name)]);
      p.conditions = frameConditions(common, present, p);
      p.conditionsAt = Array.from({length:p.rhs.length+1}, () => []);
      for (const c of p.conditions) p.conditionsAt[c.readyAt+1].push(c);
    }
    if (p.helper && ranked.groups.some((/** @type {any} */ g) => g.source === p.source)) {
      p.contextual = true;
    }
    p.rankedPrivate = own ? new Set([...privateNames.get(own)].filter(n => ![...relevant].some(g => privateNames.get(g).has(n)))) : new Set();
    p.sourcePrivate = new Set(ranked.groups.filter((/** @type {any} */ g) => g.source === p.source).flatMap((/** @type {any} */ g) => [...privateNames.get(g)]));
    for (const s of p.rhs) if (groups.has(s.name)) s.slot = groups.get(s.name);
  }
  lowered.ranked = ranked;
}

/** @param {any[]} clauses @param {Set<string>} present @param {any} production @param {Map<string,any>} [prefix] */
function frameConditions(clauses, present, production, prefix = new Map(), final = true) {
  const positions = new Map(production.captures.map((/** @type {any} */ c) => [c.name,c.index]));
  const result = [];
  for (const raw of clauses) {
    if (production.lexicalFrame && [...rankedCaptureReads(raw)].some(n => production.sourcePrivate.has(n)
      && !production.rankedPrivate.has(n) && !production.lexicalFrame.knownPrivate.has(n) && !positions.has(n) && !prefix.has(n))) continue;
    for (const condition of partsFor(prepareConditions([raw]), n => present.has(n), present)) {
      const reads = rankedConditionVariables(condition);
      if (!reads.every(n => present.has(n))) continue;
      if (!final && reads.includes('')) continue;
      if (reads.some(n => n !== '' && !positions.has(n) && !prefix.has(n))) continue;
      const readyAt = reads.reduce((last,n) => Math.max(last,n === '' ? production.rhs.length-1 : prefix.has(n) ? -1 : positions.get(n)), -1);
      result.push({condition,readyAt});
    }
  }
  return result;
}

/** @param {any} context */
export function rankedFrameTable(context) {
  const frames = new Map(), productions = new Map();
  const contextual = new Set(context.lowered.productions.filter((/** @type {any} */ p) => p.contextual).map((/** @type {any} */ p) => p.lhs));
  const helpers = new Map(context.lowered.productions.filter((/** @type {any} */ p) => p.helper).map((/** @type {any} */ p) => [p.lhs,p]));
  let next = 0;
  const written = (/** @type {any} */ p) => [p.owner ?? p.lhs, p.source?.at, context.lowered.ranked.paths.get(p.writtenExpression) ?? ''];
  const symbol = (/** @type {any} */ s) => [s.terminal ? s.name : helpers.has(s.name) ? written(helpers.get(s.name)) : s.name,s.terminal,s.test];
  const prefixKey = (/** @type {any} */ item) => {
    const captures = [];
    for (let part = item.slots; part; part = part.parent) {
      const name = item.production.captures[part.index].name;
      if (!name.startsWith('\u0000')) captures.push([name,part.start,part.end,part.tags,part.structure]);
    }
    return [written(item.production),item.origin,item.production.rhs.slice(0,item.dot).map(symbol),item.production.rhs.slice(item.dot).map(symbol),item.prefix,captures.reverse(),item.restores];
  };
  return {
    contextual,
    /** @param {any} item @param {string} name */
    entry(item, name) {
      if (!contextual.has(name)) return null;
      const outer = item.production.lexicalFrame;
      // The recursive production of a flat repetition keeps its entry.
      if (outer && item.production.lhs === name) return outer;
      const key = JSON.stringify([outer?.key ?? null,prefixKey(item)]);
      const old = frames.get(key);
      if (old) return old;
      const captures = new Map(outer?.captures ?? []);
      for (let part = item.slots; part; part = part.parent) {
        const name = item.production.captures[part.index].name;
        if (!name.startsWith('\u0000')) captures.set(name,part);
      }
      const present = new Set(outer?.present ?? []);
      for (const capture of item.production.captures) if (!capture.name.startsWith("\u0000")) present.add(capture.name);
      const root = outer?.root ?? item.production;
      const namedOrigin = outer?.namedOrigin ?? item.origin;
      const prefix = outer && context.patterns ? context.patterns.concat(outer.prefix,item.prefix) : item.prefix;
      const inside = !!outer?.inside || !!item.production.rankedGroup;
      const sealPrefix = inside && outer ? outer.sealPrefix : prefix;
      const knownPrivate = new Set([...outer?.knownPrivate ?? [],...item.production.rankedPrivate]);
      const frame = {id:next++,key,captures,root,namedOrigin,prefix,inside,sealPrefix,present,knownPrivate};
      frames.set(key,frame);
      return frame;
    },
    /** @param {any} production @param {any} frame */
    production(production, frame) {
      if (!frame) return production;
      const key = `${production.id}/${frame.id}`;
      const old = productions.get(key);
      if (old) return old;
      const present = new Set(['',...frame.present,...production.captures.map((/** @type {any} */ c) => c.name)]);
      const bound = {...production,lexicalFrame:frame};
      // Every clause ready at this written boundary runs in source order,
      // including common clauses and clauses owned by an enclosing group.
      const conditions = frameConditions(production.rankedGroup ? production.source.clauses.conditions : [],present,bound,frame.captures,production.rankedGroup?.final ?? false);
      /** @type {any[][]} */
      const conditionsAt = Array.from({length:production.rhs.length+1},() => []);
      for (const c of conditions) conditionsAt[c.readyAt+1].push(c);
      const result = {...production,baseProduction:production,lexicalFrame:frame,conditions,conditionsAt};
      productions.set(key,result);
      return result;
    },
  };
}

/** @param {any} condition */
function rankedConditionVariables(condition) {return [...rankedCaptureReads(condition)];}
