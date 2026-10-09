export type Item = import("./types.js").Item;
export type SlotScope = {
    id: number;
    frames: Item[];
    bounds: {
        carrier: Item;
        restricted: boolean;
    }[];
    blocked: boolean;
};
export type RouteMask = {
    all: Set<number>;
    allowed: Set<number>;
};
/** @typedef {import("./types.js").Item} Item */
/** @typedef {{id:number,frames:Item[],bounds:{carrier:Item,restricted:boolean}[],blocked:boolean}} SlotScope */
/** @typedef {{all:Set<number>,allowed:Set<number>}} RouteMask */
/** @param {import("./earley.js").Chart} chart @param {Set<string>} names @param {import("./maximal.js").Maximal|null} maximal */
export declare function helperSlotForest(chart: import("./earley.js").Chart, names: Set<string>, maximal: import("./maximal.js").Maximal | null): {
    chart: {
        start: number;
        end: number;
        setAt: (position: number) => import("./earley.js").ChartSet;
        furthest: number;
        context: import("./earley.js").ParseContext;
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
    routeMasks: Map<import("./types.js").Item, RouteMask>;
    rawIndices: WeakMap<import("./types.js").Edge, number>;
} | null;
