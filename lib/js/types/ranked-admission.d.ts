export declare class RankedAdmission {
    forest: {
        chart: {
            start: number;
            end: number;
            setAt: (position: number) => import("./earley.js").ChartSet;
            furthest: number;
            context: import("./earley.js").ParseContext;
            closeRequested?: boolean;
            boundaryFailures?: any[];
            family?: import("./family-summaries.js").FamilySummaries | null;
            familyTrace?: Map<import("./earley.js").Item, {
                event: import("./close-observations.js").CloseEvent;
                permitted: boolean;
            }[]> | null;
            sets: {
                position: number;
                index: Map<number | string, import("./earley.js").Item>;
                queue: import("./earley.js").Item[];
                head: number;
                waiting: Map<string, import("./earley.js").Item[]>;
                nullable: Map<string, import("./earley.js").Item[]>;
                predicted: Map<string, boolean>;
                skipped: string[];
                items: import("./slot-forest.js").Item[];
            }[];
        };
        plain: Map<import("./types.js").Item, import("./types.js").Item>;
        helpers: Set<string>;
        rawIndices: WeakMap<import("./types.js").Edge, number>;
    } | null;
    groups: Map<any, any>;
    at: Map<any, any>;
    maxima: Map<any, any>;
    masks: Map<any, any>;
    stats: {
        chartFacts: number;
        groups: number;
        candidateEdges: number;
        retainedEdges: number;
        boundarySplits: any[];
    };
    /** @param {any} chart @param {any} ranked */
    constructor(chart: any, ranked: any);
    /** @param {any} item @param {string} context */
    availabilityKey(item: any, context: string): string;
    /** @param {any} item @param {string} context */
    dependencies(item: any, context: string): any[];
    /** @param {any} item @param {any} dependency @param {string} context */
    compute(item: any, dependency: any, context: string): Set<any> | null;
    /** @param {any} item @param {string} context */
    mask(item: any, context: string): any;
}
