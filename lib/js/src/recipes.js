// Recipe selection and loading checks (engine §11.3).
import { GencmuError } from "./errors.js";

/** @import { Recipe } from "./types.js" */
/** @type {WeakMap<GencmuError,{document:string, recipe:Recipe}>} */
export const recipeFailures = new WeakMap();

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
        const at = /** @type {any} */ (recipe).at;
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
