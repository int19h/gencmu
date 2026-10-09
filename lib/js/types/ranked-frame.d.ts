/** @param {any} lowered @param {any} ranked */
export declare function prepareRankedFrames(lowered: any, ranked: any): void;
/** @param {any} context */
export declare function rankedFrameTable(context: any): {
    contextual: Set<any>;
    /** @param {any} item @param {string} name */
    entry(item: any, name: string): any;
    /** @param {any} production @param {any} frame */
    production(production: any, frame: any): any;
};
