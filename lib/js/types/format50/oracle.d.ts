export type Disagreement = {
    stage: string;
    kind: "condition" | "filter";
    rule: string;
    document?: string;
    at?: any;
    answer: boolean | null;
    detail: string;
};
/**
 * @typedef {{stage: string, kind: "condition" | "filter", rule: string, document?: string,
 *   at?: any, answer: boolean | null, detail: string}} Disagreement
 */
/**
 * Checks the chosen tree of one stage.
 * @param {any} root the occurrence of the chosen tree
 * @param {any} derivation the chosen derivation
 * @param {Map<any, any>} made the occurrence of each derivation node
 * @param {any} data the stage data, with its evaluator
 * @param {string} stage
 * @returns {{checked: number, undecided: Disagreement[], disagreements: Disagreement[]}}
 */
export declare function checkChosenTree(root: any, derivation: any, made: Map<any, any>, data: any, stage: string): {
    checked: number;
    undecided: Disagreement[];
    disagreements: Disagreement[];
};
