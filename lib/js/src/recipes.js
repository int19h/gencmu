// Recipe selection and loading checks (engine §11.3).
import { GencmuError } from "./errors.js";

/** @import { Recipe, Position, GrammarDom } from "./types.js" */
/** @type {WeakMap<object,Position>} */
export const recipeLocations = new WeakMap();
/** @type {WeakMap<GencmuError,{document:string, recipe:Recipe}>} */
export const recipeFailures = new WeakMap();

/** @param {object} source @param {object} target */
export function copyRecipeLocation(source,target) {
  const at = recipeLocations.get(source);
  if (at) recipeLocations.set(target,at);
}

/** @param {GrammarDom} dom @param {{text:string}[]} tokens @param {(token:any)=>Position} positionOf */
export function restoreRecipeLocations(dom,tokens,positionOf) {
  const starts = tokens.flatMap((token,index) => [":=",":-"].includes(token.text) ? [tokens[index+1]] : []);
  /** @type {Recipe[]} */
  const recipes = [];
  for (const rule of dom.rules) {
    for (const recipe of [rule.value,rule.image]) if (recipe) recipes.push(recipe);
    for (const alternative of rule.alternatives) for (const recipe of [alternative.value,alternative.image]) if (recipe) recipes.push(recipe);
    for (const item of rule.emit?.items ?? []) for (const recipe of [item.value,item.image]) if (recipe) recipes.push(recipe);
  }
  if (starts.length === recipes.length) recipes.forEach((recipe,index) => recipeLocations.set(recipe,positionOf(starts[index])));
}

/**
 * @param {Recipe|undefined} value
 * @param {Recipe|undefined} image
 * @param {string} document
 */
export function validateRecipeCycles(value,image,document) {
  const selected = {value, image:image ?? value};
  const impliedImage = image === undefined && value !== undefined;
  /** @type {("value"|"image")[]} */
  const path = [];
  const done = new Set();
  /** @param {"value"|"image"} channel */
  const visit = channel => {
    if (channel === "image" && impliedImage) channel = "value";
    if (done.has(channel)) return;
    const recipe = selected[channel];
    if (!recipe) { done.add(channel); return; }
    path.push(channel);
    for (const atom of recipe.concat) {
      if (!("method" in atom) || !["value","image"].includes(atom.method)) continue;
      const receiver = atom.receiver;
      if (!("method" in receiver) || receiver.method !== "emitted" || !("capture" in receiver.receiver) || receiver.receiver.capture !== "") continue;
      const next = /** @type {"value"|"image"} */ (atom.method === "image" && impliedImage ? "value" : atom.method);
      if (path.includes(next)) {
        const at = recipeLocations.get(recipe);
        const location = at ? `${document}:${at[0]}:${at[1]}: ` : `${document}: `;
        const error = new GencmuError("grammar", `${location}recipe dependency cycle: ${[...path,next].join(" → ")}`, {
          document, ...(at ? {line:at[0],column:at[1]} : {}),
        });
        recipeFailures.set(error,{document,recipe});
        throw error;
      }
      visit(next);
    }
    path.pop();
    done.add(channel);
  };
  visit("value");
  visit("image");
}
