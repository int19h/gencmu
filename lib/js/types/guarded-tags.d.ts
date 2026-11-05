/** @param {any} term @returns {{node:any,atom:any,negated:boolean}[]} */
export declare function neighbourGuards(term: any): {
    node: any;
    atom: any;
    negated: boolean;
}[];
/** @param {any} term @returns {{problem:string,node:any}|null} */
export declare function neighbourGuardProblem(term: any): {
    problem: string;
    node: any;
} | null;
/** @param {any} term @returns {{tags:any,conditions:any[]}[]} */
export declare function guardedTagVariants(term: any): {
    tags: any;
    conditions: any[];
}[];
