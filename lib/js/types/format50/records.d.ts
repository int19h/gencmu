export type Field50 = true | 0 | string | typeof flag50;
export type Form50 = {
    slots: string[];
    fields: Record<string, Field50>;
    when: string[];
    tag?: string;
    open?: boolean;
};
declare const flag50: unique symbol;
export type Record50 = {
    kind: string;
    when: string[];
    tag?: string;
    members: Set<string>;
    names: string[];
    operands: [string, string][];
    flags: string[];
    open?: boolean;
};
export type Constraint50 = {
    required?: string[];
    values?: Record<string, any[]>;
    types?: Record<string, string>;
    min?: Record<string, number>;
    max?: Record<string, number>;
    kinds?: Record<string, string[]>;
    notKinds?: Record<string, string[]>;
};
export {};
