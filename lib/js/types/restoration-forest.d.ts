export type Item = import('./types.js').Item;
export type Edge = import('./types.js').Edge;
/** @typedef {import('./types.js').Item} Item */
/** @typedef {import('./types.js').Edge} Edge */
/** @param {import('./earley.js').Chart} chart */
export declare function restorationForest(chart: import('./earley.js').Chart): {
    chart: {
        start: number;
        end: number;
        setAt: (position: number) => import("./earley.js").ChartSet;
        furthest: number;
        context: import("./earley.js").ParseContext;
        frames: ReturnType<typeof import("./ranked-frame.js").rankedFrameTable> | null;
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
            skipped: (string | import("./types.js").Production)[];
            items: Item[];
        }[];
    };
    plain: Map<import("./types.js").Item, import("./types.js").Item>;
    indices: Map<import("./types.js").Item, number[]>;
    /** @param {Map<Item,Set<number>>} marks */
    projectMarks(marks: Map<Item, Set<number>>): Map<import("./types.js").Item, Set<number>>;
} | null;
