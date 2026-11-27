export type Disagreement = {
    stage: string;
    kind: string;
    rule: string;
    document?: string;
    at?: any;
    answer: boolean | null;
    detail: string;
};
/**
 * Checks the chosen tree of one stage.
 * @param {any} root the occurrence of the chosen tree
 * @param {any} data the stage data, with its evaluator
 * @param {string} stage the name of the stage
 * @param {any} owner the stage, which makes compound bindings
 * @returns {{checked: number, refused: Disagreement[], undecided: Disagreement[], disagreements: Disagreement[], higher: {checked: number, unmatched: number}}}
 */
export declare function checkChosenTree(root: any, data: any, stage: string, owner: any): {
    checked: number;
    refused: Disagreement[];
    undecided: Disagreement[];
    disagreements: Disagreement[];
    higher: {
        checked: number;
        unmatched: number;
    };
};
export type Route = {
    at: number;
    bindings: Map<string, any[]>;
    tests: any[];
    options: any[];
    taken: Set<string>;
};
/**
 * Sets the function that gives the capture slots of a body. The stage
 * owns it, and the oracle reads it.
 * @param {(body: any) => Map<string, string>} fn
 */
export declare function setCaptureKinds(fn: (body: any) => Map<string, string>): void;
