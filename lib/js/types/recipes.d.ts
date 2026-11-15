import { GencmuError } from "./errors.js";
import type { Recipe } from "./types.js";
/** @import { Recipe } from "./types.js" */
/** @type {WeakMap<GencmuError,{document:string, recipe:Recipe}>} */
export declare const recipeFailures: WeakMap<GencmuError, {
    document: string;
    recipe: Recipe;
}>;
/**
 * @param {Recipe|undefined} value
 * @param {Recipe|undefined} image
 * @param {string} document
 */
export declare function validateRecipeCycles(value: Recipe | undefined, image: Recipe | undefined, document: string): void;
