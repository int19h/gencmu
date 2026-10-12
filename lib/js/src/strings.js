// The occurrence-based string walk and verbatim gap claims (engine §11).
import { GencmuError } from "./errors.js";
import { evaluate, settled } from "./earley.js";

/** @import { Derivation, DerivationRule, Recipe, Scope, Span } from "./types.js" */
/** @import { ParseContext } from "./earley.js" */
/** @typedef {"value" | "image"} Channel */
/** @typedef {{node:Derivation, channel:Channel} | {node:DerivationRule, recipe:Recipe, item?:object}} Request */

/** @param {DerivationRule} node @param {string} name @returns {Derivation} */
export function capturedNode(node, name) {
  if (name === "") return node;
  const slot = /** @type {number} */ (node.production.captureSlot.get(name));
  return node.children[node.production.captures[slot].index];
}

export class StringWalk {
  /** @param {ParseContext} context @param {(node:DerivationRule)=>Scope} scope */
  constructor(context, scope) {
    this.context = context;
    this.scope = scope;
    /** @type {WeakMap<Derivation,Map<object|string,string>>} */
    this.values = new WeakMap();
    /** @type {WeakMap<Derivation,Set<object|string>>} */
    this.active = new WeakMap();
    /** @type {{span:Span, intervals:Span[]}[]} */
    this.claims = [];
    // Every input source participates, including tokens outside a capture.
    /** @type {Span[]} */
    this.covered = context.tokens.map(token => token.source).filter(([a,b]) => a < b).sort((a,b) => a[0]-b[0]);
    /** @type {Span[]} */
    const merged = [];
    for (const [a,b] of this.covered) {
      const previous = merged[merged.length-1];
      if (previous && a <= previous[1]) previous[1] = Math.max(previous[1], b);
      else merged.push([a,b]);
    }
    this.covered = merged;
    /** @type {WeakMap<object,Map<object,object>>} */
    this.itemKeys = new WeakMap();
  }

  /** @param {Request} request @returns {object|string} */
  key(request) {
    if ("channel" in request) return request.channel;
    if (!request.item) return request.recipe;
    let keys = this.itemKeys.get(request.item);
    if (!keys) this.itemKeys.set(request.item, keys = new Map());
    let key = keys.get(request.recipe);
    if (!key) keys.set(request.recipe, key = {});
    return key;
  }

  /** @param {Derivation} node @param {Channel} channel @returns {string} */
  channel(node, channel) { return this.run({node, channel}); }

  /** @param {DerivationRule} node @param {Recipe} recipe @param {object} item @returns {string} */
  item(node, recipe, item) { return this.run({node, recipe, item}); }

  /** @param {Request} root @returns {string} */
  run(root) {
    /** @type {{request:Request, key:object|string, iterator:Generator<Request,string,string>, answer:string}[]} */
    const stack = [];
    /** @param {Request} request @returns {string|undefined} */
    const enter = request => {
      const key = this.key(request);
      const cached = this.values.get(request.node)?.get(key);
      if (cached !== undefined) return cached;
      let active = this.active.get(request.node);
      if (!active) this.active.set(request.node, active = new Set());
      if (active.has(key)) throw new GencmuError("grammar", "a selected string recipe has a dependency cycle");
      active.add(key);
      stack.push({request, key, iterator:this.build(request), answer:""});
      return undefined;
    };
    const known = enter(root);
    if (known !== undefined) return known;
    let answer = "";
    while (stack.length) {
      const frame = stack[stack.length-1];
      const next = frame.iterator.next(frame.answer);
      if (!next.done) {
        const cached = enter(next.value);
        if (cached !== undefined) frame.answer = cached;
        continue;
      }
      answer = next.value;
      let values = this.values.get(frame.request.node);
      if (!values) this.values.set(frame.request.node, values = new Map());
      values.set(frame.key, answer);
      this.active.get(frame.request.node)?.delete(frame.key);
      stack.pop();
      if (stack.length) stack[stack.length-1].answer = answer;
    }
    return answer;
  }

  /** @param {Request} request @returns {Generator<Request,string,string>} */
  *build(request) {
    const node = request.node;
    if ("channel" in request) {
      if ("read" in node) return this.context.tokens[node.read.token][request.channel];
      const production = node.production;
      if (production.erased) return "";
      const recipe = request.channel === "value" ? production.value : production.image ?? production.value;
      if (recipe) return yield {node, recipe};
      const pieces = [];
      for (const child of node.children) pieces.push(yield {node:child, channel:request.channel});
      return pieces.join("");
    }
    const pieces = [];
    const enclosing = /** @type {DerivationRule} */ (node);
    for (const atom of request.recipe.concat) {
      if ("method" in atom && atom.receiver && "method" in atom.receiver && atom.receiver.method === "emitted") {
        const receiver = /** @type {{capture:string}} */ (atom.receiver.receiver);
        pieces.push(yield {node:capturedNode(enclosing,receiver.capture), channel:/** @type {Channel} */ (atom.method)});
      } else if ("method" in atom && atom.method === "verbatim-text") {
        const receiver = /** @type {{capture:string}} */ (atom.receiver);
        const part = capturedNode(enclosing,receiver.capture);
        pieces.push(this.verbatim(part.start, part.end));
      } else {
        const value = settled(() => evaluate(this.context,atom,this.scope(enclosing)));
        pieces.push("string" in value ? value.string : "");
      }
    }
    return pieces.join("");
  }

  /** @param {number} a @param {number} b @returns {string} */
  verbatim(a,b) {
    if (a === b) return "";
    const {tokens, sources, sourceText} = this.context;
    const [l,r] = sources.of(a,b);
    const p = a > 0 ? tokens[a-1].source[1] : 0;
    const q = b < tokens.length ? tokens[b].source[0] : sourceText.length;
    let left = l, right = r;
    if (p < l) {
      left = p;
      for (const [start,end] of this.covered) {
        if (start >= l) break;
        if (end > left) left = Math.min(l,end);
      }
    }
    if (r < q) {
      right = q;
      for (const [start,end] of this.covered) {
        if (end <= r) continue;
        right = Math.max(r,Math.min(right,start));
        break;
      }
    }
    /** @type {Span[]} */
    const intervals = [];
    if (left < l) intervals.push([left,l]);
    if (r < right) intervals.push([r,right]);
    for (const claim of this.claims) {
      if (claim.span[0] === a && claim.span[1] === b) continue;
      for (const [x,y] of intervals) for (const [u,v] of claim.intervals) {
        if (Math.max(x,u) < Math.min(y,v)) throw new GencmuError("grammar", "different verbatim spans claim the same uncovered source text");
      }
    }
    if (intervals.length) this.claims.push({span:[a,b], intervals});
    return sourceText.slice(left,right).join("");
  }
}
