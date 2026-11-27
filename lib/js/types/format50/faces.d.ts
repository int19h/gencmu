/**
 * The units that a subtree selects: rule nodes with bare emission and the
 * nodes of emission lists, in order. A rule without its own selection
 * forwards those of its children. Erasure selects nothing. The units of an
 * emission list come from `listed`, which the publishing stage passes, and
 * later from the units that it stored.
 * @param {any} root
 * @param {((node: any) => any[]) | null} [listed]
 * @returns {any[]}
 */
export declare function selectedUnits(root: any, listed?: ((node: any) => any[]) | null): any[];
/**
 * The satellites of a display unit before and after its primary, or null
 * for a unit that shows as one leaf or as its primary alone.
 * @param {any} node
 * @param {((node: any) => any[]) | null} [listed] the units of an emission
 * list, while the stage publishes
 */
export declare function decoration(node: any, listed?: ((node: any) => any[]) | null): {
    before: any;
    after: any;
} | null;
/**
 * The satellites that a published unit shows, along its whole primary
 * path: the satellites before the core from the outermost level inwards,
 * and those after it from the innermost level outwards. The path crosses
 * into earlier stages through input tokens (engine §11.3).
 * @param {any} node
 * @returns {{before: any[], after: any[]}}
 */
export declare function satellitesOf(node: any): {
    before: any[];
    after: any[];
};
/**
 * Makes the faces of the units that the published tokens of a stage can
 * show: each satellite beside a primary, and each primary whose path
 * reaches satellites, as display reads them. A satellite needs an image,
 * and a failing recipe of a satellite fails the publication. No other
 * recipe runs, so an overridden recipe makes no verbatim claim. A satellite branch
 * with an emission list shows the units that its list selects, which
 * `listed` makes.
 * @param {any[]} tokens
 * @param {((node: any) => any[]) | null} [listed]
 */
export declare function publishFaces(tokens: any[], listed?: ((node: any) => any[]) | null): void;
/**
 * The image and classes that a unit shows, as its stage made them when it
 * published.
 * @param {any} node
 */
export declare function unitFace(node: any): {
    image: string;
    classes: string[];
};
