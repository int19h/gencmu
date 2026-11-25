/**
 * The units that a subtree selects: rule nodes with bare emission and the
 * nodes of emission lists, in order. A rule without its own selection
 * forwards those of its children. Erasure selects nothing.
 * @param {any} root
 * @returns {any[]}
 */
export declare function selectedUnits(root: any): any[];
/**
 * The satellites of a display unit before and after its primary, or null
 * for a unit that shows as one leaf or as its primary alone.
 * @param {any} node
 */
export declare function decoration(node: any): {
    before: any;
    after: any;
} | null;
/** The image and classes that a unit shows. */
export declare function unitFace(node: any): {
    image: any;
    classes: any;
};
