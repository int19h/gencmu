import { GencmuError } from "../errors.js";
/**
 * The capture name that marks a primary without a written label. The
 * bridge adds underscores until no capture of the rule has the name.
 */
export declare const PRIMARY_CAPTURE = "primary_";
export declare const SYMBOL_KEYS: string[];
/**
 * A visible key: a capitalized key or an engine key.
 * @param {any} key
 */
export declare function isVisibleKey(key: any): boolean;
/**
 * The format 49 records of one DOM 50 document, for recognition.
 * @param {any} dom a valid DOM 50
 * @param {string} path the document
 * @returns {any} a DOM 49 with the extra members `format50` and `origins`
 * @param {any} origins
 */
export declare function bridgeDocument(dom: any, path: string, origins: any): any;
export declare class Bridge {
    dom: any;
    path: any;
    origins: any;
    /** @type {any[]} */
    classifiers: any[];
    /** @type {{demanded: Set<string>, domains: Map<string, any[]>}} the hidden keys that recognizer tests read */
    hidden: {
        demanded: Set<string>;
        domains: Map<string, any[]>;
    };
    /** @type {Map<string, GencmuError>} the rules whose keys have no tag term */
    untranslated: Map<string, GencmuError>;
    /** @type {GencmuError[]} the conditions that the recognizer cannot test */
    deferred: GencmuError[];
    /** @type {Set<string>} the rules whose keys a recognizer test reads */
    keyReaders: Set<string>;
    /** @type {Map<string, string>} the symbol of each capture of the rule in hand */
    captureSymbols: Map<string, string>;
    currentRule: any;
    atMostOne: Set<any> | undefined;
    repeated: Set<any> | undefined;
    hasClosed: boolean | undefined;
    forestRoot: any;
    /**
     * @param {any} dom
     * @param {any} path
     * @param {any} origins
     */
    constructor(dom: any, path: any, origins: any);
    /** @param {any} call */
    registerCall(call: any): void;
    /** @param {any} record */
    origin(record: any): string;
    /**
     * @param {any} description
     * @param {any} at
     * @returns {never}
     */
    fail(description: any, at: any): never;
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
    /** @param {any} value */
    isClassifier(value: any): any;
    /** @param {any} constant */
    classifier(constant: any): {
        name: string;
        entries: any[];
        at: any;
    };
    /** @param {any} value */
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
    /** @param {any} directive */
    directive(directive: any): any;
    /** @param {any} rule */
    rule(rule: any): any;
    /**
     * @param {any} alternative
     * @param {any} rule
     */
    alternative(alternative: any, rule: any): any;
    /**
     * @param {any} alternative
     * @param {any} rule
     * @param {any} primary
     */
    alternativeTags(alternative: any, rule: any, primary: any): any;
    /**
     * @param {any} alternative
     * @param {any} rule
     * @param {any} primary
     */
    writtenTags(alternative: any, rule: any, primary: any): any;
    /**
     * @param {any} term
     * @param {any} tags
     */
    bagTags(term: any, tags: any): any;
    /**
     * The recognizer lowers only the queries that its conditions and terms
     * name. A query that only a bag term or an emission term reads after the
     * choice of a parse rides to lowering on an emission item too.
     * @param {any} rule
     */
    queryCarriers(rule: any): any[];
    /**
     * The late structural comparisons of a rule with a pattern on the right.
     * The recognizer compiles only the patterns that its records name, so
     * each such comparison rides to lowering on an emission item that the
     * format 50 stage never runs (engine §4).
     * @param {any} rule
     */
    comparisonCarriers(rule: any): {
        condition: any;
        captures: any[];
    }[];
    /**
     * @param {any} entries
     * @returns {any}
     */
    inlined(entries: any): any;
    /** @param {any} key */
    hiddenAll(key: any): {
        union: {
            tag: string;
        }[];
    };
    /**
     * @param {any} key
     * @param {any} value
     * @param {any} guard
     */
    hiddenWrite(key: any, value: any, guard: any): {
        union: any[];
    };
    /**
     * A recognizer condition that holds where an expression has one value:
     * true, false, or a condition record.
     * @param {any} node
     * @param {any} value
     * @param {any} [guard]
     * @returns {any}
     */
    valueTest(node: any, value: any, guard?: any): any;
    /**
     * @param {any} node
     * @param {any} [at]
     * @returns {any}
     */
    tagsOf(node: any, at?: any): any;
    /** @param {any} node */
    message(node: any): any;
    /** @param {any} arg */
    argument(arg: any): any;
    /**
     * @param {any} node
     * @param {any} primary
     * @returns {any}
     */
    body(node: any, primary: any): any;
    /** @param {any} value */
    requirement(value: any): any;
    /** @param {any} node */
    stringOperand(node: any): any;
    /** @param {any} node */
    pattern(node: any): any;
    /**
     * The recognizer clauses of one written clause. A conjunction becomes
     * one clause for each operand. A universal predicate on a capture inside
     * a repetition becomes the predicate on the capture: the recognizer
     * checks a clause that names such a capture on each of its items, and an
     * empty list has none, as `.all` requires (part 1 §9).
     * @param {any} node
     */
    clauses(node: any): any;
    /** @param {any} node */
    inline(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    truth(node: any): any;
    /** @param {any} receiver */
    receiverTags(receiver: any): {
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
    /** @param {any} node */
    payloadComparison(node: any): Readonly<{
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
        right: {
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
            right: {
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
            right: {
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
                right: {
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
    /**
     * @param {any} node
     * @returns {any}
     */
    forestPredicate(node: any): any;
    /** @param {any} node */
    comparison(node: any): Readonly<{
        constant: true;
    }> | Readonly<{
        constant: false;
    }> | {
        op: any;
        left: any;
        right: any;
    };
    /** @param {any} node */
    strings(node: any): {
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
    /** @param {any} node */
    keySet(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    string(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    expression(node: any): any;
}
/**
 * Whether a recognizer key is one that the bridge adds.
 * @param {any} key
 */
export declare function isHiddenKey(key: any): any;
/** The hidden recognizer key of every written token. */
export declare const WRITTEN = "Written_token";
/**
 * The place of each late structural comparison among the carriers of its
 * rule. The stage reads the lowered condition at that place, so that the
 * comparison uses the pattern that the recognizer compiled.
 * @type {WeakMap<object, number>}
 */
export declare const CARRIED: WeakMap<object, number>;
/**
 * The hidden recognizer key for a payload of a key, or for one value.
 * @param {any} key
 * @param {any} [value]
 */
export declare function payloadTag(key: any, value?: any): string;
/**
 * The hidden recognizer key for the presence of a key, bare or valued.
 * @param {any} key
 */
export declare function presentTag(key: any): string;
/**
 * The name of a classifier for the recognizer, which needs a lowercase name.
 * @param {any} name
 */
export declare function classifierName(name: any): string;
/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 * @param {any} document
 * @param {any} at
 * @param {any} index
 */
export declare function alternativeKey(document: any, at: any, index: any): string;
/**
 * The format 50 expression of an argument as the recognizer stores it in
 * an instance: the inverse of argumentTerm. Other arguments stay as they are.
 * @param {any} arg
 */
export declare function argumentExpression(arg: any): any;
/**
 * @param {any} node
 * @returns {any}
 */
export declare function isClosed(node: any, bound?: Set<any>): any;
