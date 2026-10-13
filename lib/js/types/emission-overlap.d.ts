import type { Expr } from "./types.js";
export type Route = {
    parts: Expr[];
    captures: Map<string, Expr>;
};
/** @param {Map<string,import("./grammar.js").StitchedRule>} definitions */
export declare function validateEmissionOverlap(definitions: Map<string, import("./grammar.js").StitchedRule>): void;
