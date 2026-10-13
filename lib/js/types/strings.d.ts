import type { Derivation, DerivationRule, Recipe, Scope, Span } from "./types.js";
import type { ParseContext } from "./earley.js";
export type Channel = "value" | "image";
export type Request = {
    node: Derivation;
    channel: Channel;
} | {
    node: DerivationRule;
    recipe: Recipe;
    item?: object;
};
/** @import { Derivation, DerivationRule, Recipe, Scope, Span } from "./types.js" */
/** @import { ParseContext } from "./earley.js" */
/** @typedef {"value" | "image"} Channel */
/** @typedef {{node:Derivation, channel:Channel} | {node:DerivationRule, recipe:Recipe, item?:object}} Request */
/** @param {DerivationRule} node @param {string} name @returns {Derivation} */
export declare function capturedNode(node: DerivationRule, name: string): Derivation;
export declare class StringWalk {
    context: ParseContext;
    scope: (node: DerivationRule) => Scope;
    /** @type {WeakMap<Derivation,Map<object|string,string>>} */
    values: WeakMap<Derivation, Map<object | string, string>>;
    /** @type {WeakMap<Derivation,Set<object|string>>} */
    active: WeakMap<Derivation, Set<object | string>>;
    /** @type {{span:Span, intervals:Span[]}[]} */
    claims: {
        span: Span;
        intervals: Span[];
    }[];
    /** @type {Span[]} */
    covered: Span[];
    /** @type {WeakMap<object,Map<object,object>>} */
    itemKeys: WeakMap<object, Map<object, object>>;
    /** @param {ParseContext} context @param {(node:DerivationRule)=>Scope} scope */
    constructor(context: ParseContext, scope: (node: DerivationRule) => Scope);
    /** @param {Request} request @returns {object|string} */
    key(request: Request): object | string;
    /** @param {Derivation} node @param {Channel} channel @returns {string} */
    channel(node: Derivation, channel: Channel): string;
    /** @param {DerivationRule} node @param {Recipe} recipe @param {object} item @returns {string} */
    item(node: DerivationRule, recipe: Recipe, item: object): string;
    /** @param {Request} root @returns {string} */
    run(root: Request): string;
    /** @param {Request} request @returns {Generator<Request,string,string>} */
    build(request: Request): Generator<Request, string, string>;
    /** @param {number} a @param {number} b @returns {string} */
    verbatim(a: number, b: number): string;
}
