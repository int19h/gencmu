import { GencmuError } from "./errors.js";
import type { Recipe, Position, GrammarDom } from "./types.js";
/** @import { Recipe, Position, GrammarDom } from "./types.js" */
/** @type {WeakMap<object,Position>} */
export declare const recipeLocations: WeakMap<object, Position>;
/** @type {WeakMap<GencmuError,{document:string, recipe:Recipe}>} */
export declare const recipeFailures: WeakMap<GencmuError, {
    document: string;
    recipe: Recipe;
}>;
/** @param {object} source @param {object} target */
export declare function copyRecipeLocation(source: object, target: object): void;
/** @param {GrammarDom} dom @param {{text:string}[]} tokens @param {(token:any)=>Position} positionOf */
export declare function restoreRecipeLocations(dom: GrammarDom, tokens: {
    text: string;
}[], positionOf: (token: any) => Position): void;
/**
 * @param {Recipe|undefined} value
 * @param {Recipe|undefined} image
 * @param {string} document
 */
export declare function validateRecipeCycles(value: Recipe | undefined, image: Recipe | undefined, document: string): void;
