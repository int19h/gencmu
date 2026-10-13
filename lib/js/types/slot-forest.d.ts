export type Item = import("./types.js").Item;
export type SlotScope = {
    id: number;
    frames: Item[];
    bounds: {
        carrier: Item;
    }[];
};
/** @typedef {import("./types.js").Item} Item */
/** @typedef {{id:number,frames:Item[],bounds:{carrier:Item}[]}} SlotScope */
/** @param {import("./earley.js").Chart} chart @param {Set<string>} names */
export declare function helperSlotForest(chart: import("./earley.js").Chart, names: Set<string>): {
    chart: {
        start: number;
        end: number;
        setAt: (position: number) => import("./earley.js").ChartSet;
        furthest: number;
        context: import("./earley.js").ParseContext;
        closeRequested?: boolean;
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
            items: Item[];
        }[];
    };
    plain: Map<import("./types.js").Item, import("./types.js").Item>;
    helpers: Set<string>;
    rawIndices: WeakMap<import("./types.js").Edge, number>;
} | null;
