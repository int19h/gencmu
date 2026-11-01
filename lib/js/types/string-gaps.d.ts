import type { Span } from "./types.js";
/** @import {Span} from "./types.js" */
export declare class GapClaims {
    context: import("./earley.js").ParseContext;
    /** @type {{span:Span, intervals:Span[]}[]} */
    claims: {
        span: Span;
        intervals: Span[];
    }[];
    /** @type {Span[]} */
    covered: Span[];
    /** @param {import("./earley.js").ParseContext} context */
    constructor(context: import("./earley.js").ParseContext);
    /** @param {number} a @param {number} b @returns {string} */
    verbatim(a: number, b: number): string;
}
