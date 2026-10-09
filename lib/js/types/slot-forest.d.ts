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
/** @param {import("./earley.js").Chart} chart @param {import("./preferences.js").Preferences} preferences @param {import("./maximal.js").Maximal|null} maximal */
export declare function helperSlotForest(chart: import("./earley.js").Chart, preferences: import("./preferences.js").Preferences, maximal: import("./maximal.js").Maximal | null): {
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
/** @param {Item} item @param {import("./preferences.js").SlotVariant} variant */
export declare function helperPrefixKey(item: Item, variant: import("./preferences.js").SlotVariant): (string | number | boolean | (string | number)[][] | (string | boolean | import("./types.js").SymbolTest | undefined)[][] | undefined)[];
