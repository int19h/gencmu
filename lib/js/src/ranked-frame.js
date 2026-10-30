import {firstBoundaryAtom} from "./boundary.js";
// Lexical entry state for transparent helpers in a ranked alternative.
import {prepareConditions, partsFor, prepareClause, simplifyFor, DOM_FALSE} from "./dom.js";
import {rankedBoundCaptures,rankedCaptureReads} from "./ranked.js";

/** @param {any} lowered @param {any} ranked */
export function prepareRankedFrames(lowered, ranked) {
  if (!ranked.groups.length) return;
  const helpers = new Map(lowered.productions.filter((/** @type {any} */ p) => p.helper).map((/** @type {any} */ p) => [p.lhs, p]));
  const groups = new Map(ranked.groups.map((/** @type {any} */ g) => [g.helper, g]));
  const privateNames = new Map(ranked.groups.map((/** @type {any} */ group) => [group,group.captures]));
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
    p.rankedPrivate = own ? rankedBoundCaptures(own,relevant) : new Set();
    p.sourcePrivate = new Set(ranked.groups.filter((/** @type {any} */ g) => g.source === p.source).flatMap((/** @type {any} */ g) => [...privateNames.get(g)]));
    // Cache identity includes declarations and selected absence, not helper IDs.
    p.rankedBindings = [
      p.captures.map((/** @type {any} */ c) => c.name).filter((/** @type {string} */ n) => !n.startsWith('\u0000')).sort(),
      [...p.rankedPrivate].sort(),
    ];
    for (const s of p.rhs) if (groups.has(s.name)) s.slot = groups.get(s.name);
  }
  lowered.ranked = ranked;
  prepareRankedConditions(lowered);
}

// Follow capture presence through active helpers, without constructing values.
// Runtime frames and target discovery use the same condition reduction.
/** @param {any} lowered */
function prepareRankedConditions(lowered) {
  const contextual = new Set(lowered.productions.filter((/** @type {any} */ p) => p.contextual).map((/** @type {any} */ p) => p.lhs));
  /** @type {any[]} */
  const pending = [];
  const enter = (/** @type {any} */ p, /** @type {any} */ frame) => {
    const present = new Set([...frame.present, ...p.captures.map((/** @type {any} */ c) => c.name)]);
    const knownPrivate = new Set([...frame.knownPrivate, ...p.rankedPrivate]);
    p.rhs.forEach((/** @type {any} */ symbol, /** @type {number} */ index) => {
      if (symbol.terminal || !contextual.has(symbol.name)) return;
      const captures = new Map(frame.captures);
      for (const capture of p.captures) if (capture.index < index) captures.set(capture.name, null);
      pending.push({name:symbol.name, present, captures, knownPrivate});
    });
  };
  for (const p of lowered.productions) if (!p.helper) enter(p, {present:new Set(), captures:new Map(), knownPrivate:new Set()});
  const seen = new Set();
  for (let at = 0; at < pending.length; at++) {
    const frame = pending[at];
    const key = JSON.stringify([frame.name, [...frame.present].sort(), [...frame.captures.keys()].sort(), [...frame.knownPrivate].sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const p of lowered.byLhs.get(frame.name) ?? []) {
      const present = new Set(['', ...frame.present, ...p.captures.map((/** @type {any} */ c) => c.name)]);
      const clauses = p.rankedGroup ? p.source.clauses.conditions : [];
      const conditions = frameConditions(clauses, present, {...p,lexicalFrame:frame}, frame.captures, p.rankedGroup?.final ?? false);
      p.rankedConditions ??= [];
      for (const condition of conditions) p.rankedConditions.push(condition);
      enter(p, frame);
    }
  }
}

/** @param {any[]} clauses @param {Set<string>} present @param {any} production @param {Map<string,any>} [prefix] */
function frameConditions(clauses, present, production, prefix = new Map(), final = true) {
  const positions = new Map(production.captures.map((/** @type {any} */ c) => [c.name,c.index]));
  const result = [];
  for (const raw of clauses) {
    const atom = firstBoundaryAtom(raw);
    if (production.helper && atom) {
      const receiver = atom.receiver.capture;
      if (receiver !== "" && prefix.has(receiver)) continue;
    }
    if (production.lexicalFrame && [...rankedCaptureReads(raw)].some(n => production.sourcePrivate.has(n)
      && !production.rankedPrivate.has(n) && !production.lexicalFrame.knownPrivate.has(n) && !positions.has(n) && !prefix.has(n))) continue;
    for (const simplified of partsFor(prepareConditions([raw]), n => present.has(n), present)) {
      const condition = simplified === DOM_FALSE ? {any:[]} : simplified;
      const reads = rankedConditionVariables(condition);
      if (!reads.every(n => present.has(n))) continue;
      if (!final && reads.includes('')) continue;
      if (reads.some(n => n !== '' && !positions.has(n) && !prefix.has(n))) continue;
      const readyAt = reads.reduce((last,n) => Math.max(last,n === '' ? production.rhs.length-1 : prefix.has(n) ? -1 : positions.get(n)), -1);
      // Ownership belongs to the written clause, before presence removes reads.
      // A nested helper still evaluates it, but introduces no enclosing literal.
      const wholeBoundary = atom?.receiver.capture === ""
        ? !production.helper || [...rankedCaptureReads(raw)].some(name => production.rankedPrivate?.has(name))
        : true;
      result.push({condition,readyAt,wholeBoundary});
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
  const written = (/** @type {any} */ p) => [p.owner ?? p.lhs, p.source?.at ?? p.id, context.lowered.ranked?.paths.get(p.writtenExpression) ?? ''];
  const symbol = (/** @type {any} */ s) => [s.terminal ? s.name : helpers.has(s.name) ? written(helpers.get(s.name)) : s.name,s.terminal,s.test];
  const prefixKey = (/** @type {any} */ item) => {
    const captures = [];
    for (let part = item.slots; part; part = part.parent) {
      const name = item.production.captures[part.index].name;
      if (!name.startsWith('\u0000')) captures.push([name,part.start,part.end,part.tags,part.structure,part.observation?.id]);
    }
    return [written(item.production),item.origin,item.production.rhs.slice(0,item.dot).map(symbol),item.production.rhs.slice(item.dot).map(symbol),item.prefix,captures.reverse(),item.restores,item.production.rankedBindings,item.observationPrefix?.id];
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
      const observationPrefix = context.closes
        ? context.closes.concat(outer?.observationPrefix ?? context.closes.empty,item.observationPrefix ?? context.closes.empty)
        : null;
      const sealObservationPrefix = inside && outer ? outer.sealObservationPrefix : observationPrefix;
      const sealGroup = inside && outer ? outer.sealGroup : context.lowered.ranked?.groups.find((/** @type {any} */ group) => group.helper === name) ?? null;
      const sealEntry = inside && outer ? outer.sealEntry : item;
      const knownPrivate = new Set([...outer?.knownPrivate ?? [],...item.production.rankedPrivate ?? []]);
      const frame = {id:next++,key,captures,root,namedOrigin,prefix,inside,sealPrefix,present,knownPrivate,
        observationPrefix,sealObservationPrefix,sealGroup,sealEntry};
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
      // The item conditions of the braces' alternative run in the helper,
      // with the enclosing item's captures from the frame (engine §4).
      const itemConditions = production.itemAlternative ? itemFrameConditions(production.itemConditions,present,bound,frame.captures) : [];
      if (!production.source) {
        // A helper outside every ranked alternative: a frame gives it the
        // enclosing item's captures and nothing else.
        /** @type {any[][]} */
        const conditionsAt = Array.from({length:production.rhs.length+1},() => []);
        for (const c of itemConditions) conditionsAt[c.readyAt+1].push(c);
        const result = {...production,baseProduction:production,lexicalFrame:frame,conditions:itemConditions,conditionsAt};
        productions.set(key,result);
        return result;
      }
      // Every clause ready at this written boundary runs in source order,
      // including common clauses and clauses owned by an enclosing group.
      const conditions = [...frameConditions(production.rankedGroup ? production.source.clauses.conditions : [],present,bound,frame.captures,production.rankedGroup?.final ?? false),...itemConditions];
      /** @type {any[][]} */
      const conditionsAt = Array.from({length:production.rhs.length+1},() => []);
      for (const c of conditions) conditionsAt[c.readyAt+1].push(c);
      const source = production.source;
      const publicNames = new Set([...frame.present].filter(n => !production.sourcePrivate.has(n)));
      const terms = [source.tags,source.clauses.tags].filter(term => term !== undefined)
        .map(term => simplifyFor(prepareClause(term),n => n === '' || publicNames.has(n),publicNames));
      // With no written term, tag closure proves empty unary inheritance.
      // Multi-symbol parents discard tags by the ordinary rule.
      const parentTags = terms.length === 0 ? {emptySet:true} : terms.length === 1 ? terms[0] : {union:terms};
      const result = {...production,baseProduction:production,lexicalFrame:frame,conditions,conditionsAt,parentTags};
      productions.set(key,result);
      return result;
    },
  };
}

/**
 * The item conditions of a contextual brace helper, simplified for one of
 * its productions in one frame (engine §3.6, §4). A condition drops where the
 * production lacks an item capture it uses, or the frame an outer one.
 * @param {any[]} clauses @param {Set<string>} present @param {any} production @param {Map<string,any>} prefix
 */
function itemFrameConditions(clauses, present, production, prefix) {
  const positions = new Map(production.captures.map((/** @type {any} */ c) => [c.name,c.index]));
  const result = [];
  for (const raw of clauses) {
    const atom = firstBoundaryAtom(raw);
    for (const simplified of partsFor(prepareConditions([raw]), n => present.has(n), present)) {
      const condition = simplified === DOM_FALSE ? {any:[]} : simplified;
      const reads = rankedConditionVariables(condition);
      if (!reads.every(n => positions.has(n) || prefix.has(n))) continue;
      const readyAt = reads.reduce((last,n) => Math.max(last,prefix.has(n) ? -1 : positions.get(n)), -1);
      result.push({condition,readyAt,wholeBoundary:!!atom});
    }
  }
  return result;
}

/** @param {any} condition */
function rankedConditionVariables(condition) {return [...rankedCaptureReads(condition)];}
