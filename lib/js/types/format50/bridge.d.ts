import { GencmuError } from "../errors.js";
/**
 * The capture name that marks a primary without a written label. The
 * bridge adds underscores until no capture of the rule has the name.
 */
export declare const PRIMARY_CAPTURE = "primary_";
/** A visible key: a capitalized key or an engine key. */
export declare function isVisibleKey(key: any): boolean;
/**
 * The format 49 records of one DOM 50 document, for recognition.
 * @param {any} dom a valid DOM 50
 * @param {string} path the document
 * @returns {any} a DOM 49 with the extra members `format50` and `origins`
 */
export declare function bridgeDocument(dom: any, path: string, origins: any): any;
export declare class Bridge {
    dom: any;
    path: any;
    origins: any;
    classifiers: any[];
    /** @type {Map<string, GencmuError>} the rules whose keys have no tag term */
    untranslated: Map<string, GencmuError>;
    /** @type {GencmuError[]} the conditions that the recognizer cannot test */
    deferred: GencmuError[];
    /** @type {Set<string>} the rules whose keys a recognizer test reads */
    keyReaders: Set<string>;
    /** @type {Map<string, string>} the symbol of each capture of the rule in hand */
    captureSymbols: Map<string, string>;
    hidden: {
        demanded: Set<any>;
        domains: Map<any, never[]>;
    } | undefined;
    currentRule: any;
    atMostOne: Set<any> | undefined;
    hasClosed: boolean | undefined;
    forestRoot: any;
    constructor(dom: any, path: any, origins: any);
    origin(record: any): string;
    fail(description: any, at: any): void;
    document(): {
        format: number;
        rules: any;
        directives: any;
        constants: {
            name: any;
            op: any;
            value: {
                string: any;
                union?: undefined;
                pattern?: undefined;
                tag?: undefined;
            } | {
                string?: undefined;
                union: any;
                pattern?: undefined;
                tag?: undefined;
            } | {
                string?: undefined;
                union?: undefined;
                pattern: any;
                tag?: undefined;
            } | {
                string?: undefined;
                union?: undefined;
                pattern?: undefined;
                tag: any;
            };
            at: any;
            origin50: string;
        }[];
        classifiers: any[];
        implications: never[];
        untranslated: Map<string, GencmuError>;
        deferred: GencmuError[];
        keyReaders: Set<string>;
    };
    isClassifier(value: any): any;
    classifier(constant: any): {
        name: string;
        entries: any[];
        at: any;
    };
    data(value: any): {
        string: any;
        union?: undefined;
        pattern?: undefined;
        tag?: undefined;
    } | {
        string?: undefined;
        union: any;
        pattern?: undefined;
        tag?: undefined;
    } | {
        string?: undefined;
        union?: undefined;
        pattern: any;
        tag?: undefined;
    } | {
        string?: undefined;
        union?: undefined;
        pattern?: undefined;
        tag: any;
    };
    directive(directive: any): any;
    rule(rule: any): any;
    alternative(alternative: any, rule: any): {
        gates: any;
        expr: any;
    };
    alternativeTags(alternative: any, rule: any, primary: any): any;
    writtenTags(alternative: any, rule: any, primary: any): any;
    bagTags(term: any, tags: any): any;
    /**
     * The recognizer lowers only the queries that its conditions and terms
     * name. A query that only a bag term or an emission term reads after the
     * choice of a parse gets a condition that always holds, `q ∨ ¬q`, so that
     * the recognizer lowers it.
     */
    queryCarriers(rule: any): {
        any: any[];
    }[];
    inlined(entries: any): any;
    hiddenAll(key: any): {
        union: {
            tag: string;
        }[];
    };
    hiddenWrite(key: any, value: any, guard: any): {
        union: {
            tag: string;
        }[];
    };
    /**
     * A recognizer condition that holds where an expression has one value:
     * true, false, or a condition record.
     */
    valueTest(node: any, value: any, guard: any): any;
    tagsOf(node: any, at: any): any;
    message(node: any): any;
    argument(arg: any): any;
    body(node: any, primary: any): any;
    requirement(value: any): any;
    stringOperand(node: any): any;
    pattern(node: any): any;
    truth(node: any): any;
    receiverTags(receiver: any): void | {
        forestRoot: boolean;
        method?: undefined;
        receiver?: undefined;
        args?: undefined;
    } | {
        forestRoot?: undefined;
        method: string;
        receiver: {
            capture: any;
        };
        args: never[];
    };
    payloadComparison(node: any): void | Readonly<{
        not: {
            op: string;
            left: {
                string: string;
            };
            right: {
                string: string;
            };
        };
    }> | {
        op: string;
        left: {
            tag: string;
        };
        right: void | {
            forestRoot: boolean;
            method?: undefined;
            receiver?: undefined;
            args?: undefined;
        } | {
            forestRoot?: undefined;
            method: string;
            receiver: {
                capture: any;
            };
            args: never[];
        };
    } | {
        all: {
            op: string;
            left: {
                tag: string;
            };
            right: void | {
                forestRoot: boolean;
                method?: undefined;
                receiver?: undefined;
                args?: undefined;
            } | {
                forestRoot?: undefined;
                method: string;
                receiver: {
                    capture: any;
                };
                args: never[];
            };
        }[];
    } | {
        any: {
            op: string;
            left: {
                tag: string;
            };
            right: void | {
                forestRoot: boolean;
                method?: undefined;
                receiver?: undefined;
                args?: undefined;
            } | {
                forestRoot?: undefined;
                method: string;
                receiver: {
                    capture: any;
                };
                args: never[];
            };
        }[] | {
            all: {
                op: string;
                left: {
                    tag: string;
                };
                right: void | {
                    forestRoot: boolean;
                    method?: undefined;
                    receiver?: undefined;
                    args?: undefined;
                } | {
                    forestRoot?: undefined;
                    method: string;
                    receiver: {
                        capture: any;
                    };
                    args: never[];
                };
            }[];
        }[];
    } | null;
    forestPredicate(node: any): any;
    comparison(node: any): void | {
        op: any;
        left: any;
        right: any;
    };
    strings(node: any): void | {
        method?: undefined;
        receiver?: undefined;
        args?: undefined;
        union: any;
        const?: undefined;
        at?: undefined;
    } | {
        union?: undefined;
        method: string;
        receiver: any;
        args: any[];
        const?: undefined;
        at?: undefined;
    } | {
        union?: undefined;
        method?: undefined;
        receiver?: undefined;
        args?: undefined;
        const: any;
        at: any;
    };
    keySet(node: any): any;
    string(node: any): any;
    expression(node: any): any;
}
/** The hidden recognizer key for a payload of a key, or for one value. */
export declare function payloadTag(key: any, value: any): string;
/** The hidden recognizer key for the presence of a key, bare or valued. */
export declare function presentTag(key: any): string;
/** The name of a classifier for the recognizer, which needs a lowercase name. */
export declare function classifierName(name: any): string;
/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 */
export declare function alternativeKey(document: any, at: any, index: any): string;
/**
 * The format 50 expression of an argument as the recognizer stores it in
 * an instance: the inverse of argumentTerm. Other arguments stay as they are.
 */
export declare function argumentExpression(arg: any): any;
export declare function isClosed(node: any, bound?: Set<any>): any;
