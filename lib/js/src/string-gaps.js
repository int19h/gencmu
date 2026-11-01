import { GencmuError } from "./errors.js";
/** @import {Span} from "./types.js" */
export class GapClaims {
  /** @param {import("./earley.js").ParseContext} context */
  constructor(context) {
    this.context = context;
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
