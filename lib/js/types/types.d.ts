export type TagSet = Set<string>;
export type Span = [number, number];
export type Position = [number, number];
export type ErrorLocation = {
    document?: string;
    line?: number;
    column?: number;
    stage?: string;
    rule?: string;
};
export type Resources = (path: string) => string | undefined;
export type Verdict = "unique" | "resolved" | "tie";
export type TokenNode = {
    kind: "token";
    /**
     * the terminal the token was read as
     */
    terminal: string;
    /**
     * the token's index in the stage's input
     */
    token: number;
    span: Span;
    source: Span;
};
export type ElidedNode = {
    kind: "elided";
    terminal: string;
    span: Span;
    source: Span;
    /**
     * the string of the terminator's `=` test, if it
     * has one, which a restored token sounds like and the output does not
     * show (engine §7)
     */
    sound?: string;
};
export type RuleNode = {
    kind: "rule";
    rule: string;
    span: Span;
    source: Span;
    tags: TagSet;
    children: ResultNode[];
};
export type ResultNode = TokenNode | ElidedNode | RuleNode;
export type Expectation = {
    terminal: string;
    rules: string[];
};
export type ParseError = {
    kind: "rejected" | "ambiguous" | "grammar";
    stage?: string;
    /**
     * why an ambiguous error is
     * one: a tie (engine §6) or the check of elision-only (engine §7)
     */
    reason?: "tie" | "elision-only";
    /**
     * a defect that the check of
     * elision-only found: it lost its chosen derivation (engine §7.9)
     */
    code?: "elision-witness-lost";
    /**
     * for that defect, the chosen tree
     */
    chosen?: ResultNode;
    /**
     * for that defect, the terminators
     * that the check wrote back, in their order of insertion
     */
    completion?: Restoration[];
    token?: number;
    source?: Span;
    line?: number;
    column?: number;
    expected?: Expectation[];
    readings?: ResultNode[];
    /**
     * for an error of elision-only, where its
     * two readings first differ (engine §7.10)
     */
    witness?: Witness;
    document?: string;
    message: string;
};
export type Restoration = {
    terminal: string;
    at: number;
    source: Span;
    sound?: string;
};
export type Action = ReadAction | CloseAction;
export type ReadAction = {
    kind: "read";
    token: number;
    terminal: string;
};
export type CloseAction = {
    kind: "close";
    item: Item;
};
export type StageReport = TiedStageReport | SettledStageReport;
export type TiedStageReport = StageReportBase & {
    verdict: "tie";
    witness: Witness | null;
};
export type SettledStageReport = StageReportBase & {
    verdict: "unique" | "resolved" | null;
    witness: null;
};
export type Witness = [WitnessAction, WitnessAction];
export type WitnessAction = WitnessRead | WitnessClose | WitnessElided;
export type WitnessElided = {
    kind: "elided";
    /**
     * the position in the stage's input where the
     * terminator was written back
     */
    at: number;
    /**
     * the terminal that read it
     */
    terminal: string;
};
export type WitnessRead = {
    kind: "read";
    /**
     * the index of the token in the stage's input
     */
    token: number;
    /**
     * the terminal that read it
     */
    terminal: string;
};
export type WitnessClose = {
    kind: "close";
    /**
     * the rule of the production; for a helper, the
     * rule whose alternative introduced it
     */
    rule: string;
    /**
     * the number of the production (engine §3)
     */
    production: number;
    /**
     * whether the production is a helper's
     */
    helper: boolean;
    /**
     * the tokens that the production covers
     */
    span: Span;
};
export type StageReportBase = {
    name: string;
    /**
     * the tokens handed to the next stage
     */
    output: Token[] | null;
    /**
     * the chosen tree, or null for a stage
     * that rejected its input or tied
     */
    tree: ResultNode | null;
    error: ParseError | null;
    /**
     * the tokens the stage read
     */
    input?: Token[];
    /**
     * the warnings of the chosen tree
     * (engine §12), absent for a stage that rejected its input or tied
     */
    warnings?: ParseWarning[];
};
export type ParseWarning = {
    stage: string;
    feature: string;
    rule: string;
    /**
     * the node's span over the stage's input tokens
     */
    span: Span;
    /**
     * the node's range of the original text
     */
    source: Span;
};
export type Feature = {
    name: string;
    kind: "gate" | "warning";
    /**
     * whether the pipeline's `%features` turns it on
     */
    default: boolean;
};
export type ParseResult = {
    ok: boolean;
    stages: StageReport[];
    /**
     * the last stage's tree
     */
    tree: ResultNode | null;
    error: ParseError | null;
    text: string;
    /**
     * every stage's warnings, in stage order
     */
    warnings: ParseWarning[];
    /**
     * the features the parse ran with, those auto
     * features added included; not part of the canonical JSON
     */
    features: string[];
};
export type ParseOptions = {
    /**
     * the features to turn on, besides
     * those the dialect's pipeline turns on
     */
    features?: Iterable<string>;
    /**
     * the features to turn off,
     * the pipeline's among them; naming one in both lists is a usage error
     */
    withoutFeatures?: Iterable<string>;
    /**
     * enable `sa-su` only for a text that
     * needs it; on unless `false`
     */
    autoFeatures?: boolean;
    /**
     * the name of the last stage to run
     */
    until?: string;
    /**
     * override the grammar's own
     * elision-only setting
     */
    elisionOnly?: boolean | null;
    /**
     * the first stage's input, in place of the
     * text's characters
     */
    tokens?: Token[];
};
export type GrammarDom = {
    format: number;
    rules: DomRule[];
    directives: DomDirective[];
    constants: DomConstant[];
    classifiers: DomClassifier[];
    implications: DomImplication[];
};
export type DomClassifier = {
    name: string;
    entries: DomEntry[];
    at: Position;
};
export type DomEntry = {
    /**
     * gates only
     */
    guards: Guard[];
    /**
     * each a canonical sound
     */
    keys: string[];
    op: "∈" | "∉";
    /**
     * an identifier tag that begins with a capital
     */
    class: string;
    at: Position;
};
export type DomImplication = {
    if: Term;
    then: Term;
    at: Position;
};
export type DomConstant = {
    name: string;
    op: "define" | "redefine";
    value: Term;
    at: Position;
};
export type DomDirective = {
    name: string;
    args: string[];
    at: Position;
};
export type DomRule = {
    name: string;
    op: "define" | "redefine" | "extend";
    flags: string[];
    tags?: Term;
    alternatives: DomAlternative[];
    emit?: Emission;
    conditions: Condition[];
    opaque?: true;
    at: Position;
};
export type DomAlternative = {
    guards: Guard[];
    expr: Expr;
    tags?: Term;
};
export type Guard = {
    feature: string;
    /**
     * a gate keeps its alternative only while
     * its feature is on, or off if negated; a warning always keeps it
     */
    kind: "gate" | "warning";
    /**
     * always false for a warning
     */
    negated: boolean;
};
export type Pattern = {
    name: string;
    at: Position;
} | PatternTerminal | {
    constant: string;
    at: Position;
} | {
    test: TestOp;
    value: Term;
    expr: PatternTerminal;
} | {
    children: PatternChildren;
} | {
    union: Pattern[];
} | {
    intersection: Pattern[];
} | {
    difference: [Pattern, Pattern];
} | {
    path: "descendant" | "first" | "last";
    pattern: Pattern;
};
export type PatternTerminal = {
    terminal: string;
    at: Position;
};
export type PatternChildren = {
    node: Pattern;
} | {
    sequence: PatternChildren[];
} | {
    optional: PatternChildren;
} | {
    repeat: PatternChildren;
    separator?: PatternChildren;
} | {
    siblings: true;
};
export type Expr = {
    choice: Expr[];
} | {
    and: Expr[];
} | {
    seq: Expr[];
} | {
    repeat: Expr;
    separator?: Expr;
    chain?: "left" | "right";
} | {
    optional: Expr;
    elidable?: true;
    maximal?: true;
} | {
    capture: string;
    expr: Expr;
} | {
    ref: string;
} | {
    terminal: string;
} | {
    range: [string, string];
} | {
    property: string;
} | {
    test: TestOp;
    value: Term;
    expr: TestedSymbol;
} | {
    empty: true;
};
export type TestOp = "=" | "≠" | "⊇" | "⊉" | "∩=∅" | "∩≠∅";
export type TestedSymbol = {
    ref: string;
} | {
    terminal: string;
} | {
    range: [string, string];
} | {
    property: string;
};
export type Emission = {
    items: EmitItem[];
};
export type EmitItem = {
    capture?: string;
    insert?: string;
    tags?: Term;
    before?: string[];
    after?: string[];
};
export type Comparator = "=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇";
export type Condition = {
    any: Condition[];
} | {
    all: Condition[];
} | {
    not: Condition;
} | {
    captured: string;
} | {
    if: Condition;
    then: Condition;
} | {
    matches: Term;
    rule: string;
} | {
    begins: Term;
    rule: string;
} | {
    initial: Term;
} | {
    op: Comparator;
    left: Term;
    right: Term;
};
export type Term = {
    pattern: Pattern;
} | {
    string: string;
} | {
    tag: string;
} | {
    range: [string, string];
} | {
    emptySet: true;
} | {
    union: Term[];
} | {
    if: Condition;
    then: Term;
} | {
    intersection: Term[];
} | {
    difference: [Term, Term];
} | {
    call: string;
    args: Argument[];
} | {
    capture: string;
} | ConstantTerm;
export type ConstantTerm = {
    const: string;
    at: Position;
    value?: TermValue;
};
export type Argument = Term | {
    rule: string;
} | {
    classifier: string;
};
export type GrammarSymbol = {
    slot?: import("./preferences.js").SlotComponent;
    role?: string;
    name: string;
    terminal: boolean;
    /**
     * the test on the symbol's own span; not part
     * of the terminal's identity (engine §4)
     */
    test?: SymbolTest;
    /**
     * for a range or a property, the
     * characters it matches; its name is then its written form (engine §4)
     */
    characters?: CharacterClass;
};
export type SymbolTest = {
    op: TestOp;
    sound?: string;
    tags?: TagSet;
    written: string;
};
export type CharacterClass = {
    from: number;
    to: number;
} | {
    property: string;
};
export type Capture = {
    name: string;
    /**
     * the position of the captured symbol
     */
    index: number;
};
export type ReadyCondition = {
    condition: Condition;
    readyAt: number;
};
export type Production = {
    source?: import("./grammar.js").StitchedAlternative;
    slotRoles?: Map<string, string>;
    role?: string;
    writtenTags?: Term[];
    id: number;
    lhs: string;
    rhs: GrammarSymbol[];
    helper: boolean;
    flags: string[];
    /**
     * the rule the production was lowered from
     */
    owner: string;
    /**
     * the terminator an empty helper stands for
     */
    elided: string | null;
    /**
     * the test of that terminator, an
     * `=` test whose string a restored token sounds like, or null (engine §7)
     */
    elidedTest: SymbolTest | null;
    captures: Capture[];
    /**
     * for each position of `rhs`, the index in
     * `captures` of the capture there, or -1
     */
    captureAt: number[];
    /**
     * each capture's name, with its
     * index in `captures`
     */
    captureSlot: Map<string, number>;
    conditions: ReadyCondition[];
    /**
     * the conditions ready after
     * each position, at `readyAt + 1`, in written order
     */
    conditionsAt: ReadyCondition[][];
    tags: Term | null;
    emit: Emission | null;
    /**
     * whether its constituent is an opaque part,
     * which sounds `?` and shows its text (engine §11)
     */
    opaque: boolean;
    /**
     * the features of the alternative's warnings,
     * in the order they are written; none for a helper
     */
    warnings: string[];
};
export type Resolution = {
    /**
     * the rule of the
     * ranking (engine §6)
     */
    lean: "greedy" | "lazy" | "late-elision";
    elisionOnly: boolean;
};
export type LoweredGrammar = {
    productions: Production[];
    byLhs: Map<string, Production[]>;
    /**
     * the helpers of the elidable
     * optionals written [++T x], whose terminators are maximal (engine §3.8,
     * §4)
     */
    maximalHelpers: Set<string>;
    resolution: Resolution;
    preferences: import("./preferences.js").Preferences;
    /**
     * each classifier
     * of the stage, resolved for these features: each key's classes (engine
     * §2)
     */
    classifiers: Map<string, Map<string, TagSet>>;
    /**
     * the stage's
     * implications, which its emitted tokens take (engine §11)
     */
    implications: {
        if: TagSet;
        then: TagSet;
    }[];
};
export type Lean = "greedy" | "lazy" | "late-elision" | "none";
export type Captured = {
    parent: Captured;
    jump: Captured;
    depth: number;
    index: number;
    start: number;
    end: number;
    tags: number;
    structure: number;
    id: number;
} | null;
export type Edge = {
    kind: "seed";
} | {
    kind: "scan";
    previous: Item;
    token: number;
    terminal: string;
} | {
    kind: "complete";
    previous: Item;
    child: Item;
} | {
    kind: "restore";
    token: number;
    terminal: string;
};
export type TermValue = {
    pattern: any;
} | {
    string: string;
} | {
    set: Set<string>;
};
export type SpanValue = {
    structure?: number;
    patterns?: import("./patterns.js").PatternMachine | null;
    start: number;
    end: number;
    tags?: TagSet;
    /**
     * in the check of engine §7, a span of the
     * reconstructed input that an observation projects ("R"), or one that a
     * fault reads as it is ("raw"); absent for a span of the stage's input
     */
    space?: "R" | "raw";
    /**
     * for a span of the stage's
     * input that a function computed in the check, the span of R behind it,
     * which only faults read
     */
    reconstructed?: [number, number];
    /**
     * for such a span, the exact span of R
     * behind it: one original token for head and last, and from the first
     * original token of the span for tail, from and after; only faults read
     * it
     */
    exact?: [number, number];
};
export type Scope = {
    capture: (name: string) => SpanValue;
};
export type Rope = {
    empty: true;
    size: number;
} | RopeLeaf | RopeConcat;
export type RopeLeaf = {
    leaf: Action;
    size: number;
};
export type RopeConcat = {
    left: Rope;
    right: Rope;
    size: number | bigint;
};
export type Derivation = DerivationRead | DerivationRule;
export type DerivationRead = {
    read: ReadAction;
    start: number;
    end: number;
};
export type DerivationRule = {
    item: Item;
    production: Production;
    children: Derivation[];
    start: number;
    end: number;
};
export type Token = import("./tokens.js").Token;
export type Item = import("./earley.js").Item;
export type ParseContext = import("./earley.js").ParseContext;
/**
 * A tag set: tags in their canonical spelling (engine §1), which have no
 * strength.
 * @typedef {Set<string>} TagSet
 */
/**
 * A half-open range `[start, end)`: of a stage's input tokens, or of the
 * text's code points.
 * @typedef {[number, number]} Span
 */
/**
 * A place in a document, `[line, column]`, both from 1.
 * @typedef {[number, number]} Position
 */
/**
 * Where a grammar error was found, as far as it is known.
 * @typedef {object} ErrorLocation
 * @property {string} [document]
 * @property {number} [line]
 * @property {number} [column]
 * @property {string} [stage]
 * @property {string} [rule]
 */
/**
 * A function from a path relative to the grammars root to that file's text,
 * or `undefined` when there is no such file.
 * @typedef {(path: string) => string | undefined} Resources
 */
/**
 * What a stage concluded about its derivations (engine §6).
 * @typedef {"unique" | "resolved" | "tie"} Verdict
 */
/**
 * A result tree node that reads one token.
 * @typedef {object} TokenNode
 * @property {"token"} kind
 * @property {string} terminal the terminal the token was read as
 * @property {number} token the token's index in the stage's input
 * @property {Span} span
 * @property {Span} source
 */
/**
 * A result tree node for a terminator the text left out.
 * @typedef {object} ElidedNode
 * @property {"elided"} kind
 * @property {string} terminal
 * @property {Span} span
 * @property {Span} source
 * @property {string} [sound] the string of the terminator's `=` test, if it
 *   has one, which a restored token sounds like and the output does not
 *   show (engine §7)
 */
/**
 * A result tree node for a rule.
 * @typedef {object} RuleNode
 * @property {"rule"} kind
 * @property {string} rule
 * @property {Span} span
 * @property {Span} source
 * @property {TagSet} tags
 * @property {ResultNode[]} children
 */
/** @typedef {TokenNode | ElidedNode | RuleNode} ResultNode */
/**
 * A terminal a rejected stage could have read, and the rules that could
 * have read it.
 * @typedef {object} Expectation
 * @property {string} terminal
 * @property {string[]} rules
 */
/**
 * Why a text did not parse: rejected by a stage, ambiguous with a tie or
 * under elision-only, or a defect of the grammar found while running it.
 * @typedef {object} ParseError
 * @property {"rejected" | "ambiguous" | "grammar"} kind
 * @property {string} [stage]
 * @property {"tie" | "elision-only"} [reason] why an ambiguous error is
 *   one: a tie (engine §6) or the check of elision-only (engine §7)
 * @property {"elision-witness-lost"} [code] a defect that the check of
 *   elision-only found: it lost its chosen derivation (engine §7.9)
 * @property {ResultNode} [chosen] for that defect, the chosen tree
 * @property {Restoration[]} [completion] for that defect, the terminators
 *   that the check wrote back, in their order of insertion
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {Expectation[]} [expected]
 * @property {ResultNode[]} [readings]
 * @property {Witness} [witness] for an error of elision-only, where its
 *   two readings first differ (engine §7.10)
 * @property {string} [document]
 * @property {string} message
 */
/**
 * A terminator that the check of elision-only wrote back (engine §7.9): its
 * terminal, its position in the stage's input, the empty source of its
 * elided node, and the sound of a terminator with an `=` test.
 * @typedef {object} Restoration
 * @property {string} terminal
 * @property {number} at
 * @property {Span} source
 * @property {string} [sound]
 */
/**
 * One step of a derivation, read bottom-up: a token read, or a production
 * closed.
 * @typedef {ReadAction | CloseAction} Action
 */
/**
 * @typedef {object} ReadAction
 * @property {"read"} kind
 * @property {number} token
 * @property {string} terminal
 */
/**
 * @typedef {object} CloseAction
 * @property {"close"} kind
 * @property {Item} item
 */
/**
 * What one stage did. A stage whose verdict is `tie` has a witness, and
 * its two readings are in its error. Any other stage has no witness.
 * @typedef {TiedStageReport | SettledStageReport} StageReport
 */
/**
 * @typedef {StageReportBase & {verdict: "tie", witness: Witness | null}} TiedStageReport
 */
/**
 * @typedef {StageReportBase & {verdict: "unique" | "resolved" | null, witness: null}} SettledStageReport
 */
/**
 * Where the two readings of a tie first differ: their actions there.
 * Neither is ever missing (engine §6). The witness is plain data of the
 * result's own, and shares nothing with the grammar.
 * @typedef {[WitnessAction, WitnessAction]} Witness
 */
/**
 * An action of a witness: a token read, a production closed, or, in the
 * witness of an error of elision-only, a read of a terminator that the
 * check wrote back (engine §7.10).
 * @typedef {WitnessRead | WitnessClose | WitnessElided} WitnessAction
 */
/**
 * @typedef {object} WitnessElided
 * @property {"elided"} kind
 * @property {number} at the position in the stage's input where the
 *   terminator was written back
 * @property {string} terminal the terminal that read it
 */
/**
 * @typedef {object} WitnessRead
 * @property {"read"} kind
 * @property {number} token the index of the token in the stage's input
 * @property {string} terminal the terminal that read it
 */
/**
 * @typedef {object} WitnessClose
 * @property {"close"} kind
 * @property {string} rule the rule of the production; for a helper, the
 *   rule whose alternative introduced it
 * @property {number} production the number of the production (engine §3)
 * @property {boolean} helper whether the production is a helper's
 * @property {Span} span the tokens that the production covers
 */
/**
 * What every stage report has.
 * @typedef {object} StageReportBase
 * @property {string} name
 * @property {Token[] | null} output the tokens handed to the next stage
 * @property {ResultNode | null} tree the chosen tree, or null for a stage
 *   that rejected its input or tied
 * @property {ParseError | null} error
 * @property {Token[]} [input] the tokens the stage read
 * @property {ParseWarning[]} [warnings] the warnings of the chosen tree
 *   (engine §12), absent for a stage that rejected its input or tied
 */
/**
 * A warning (engine §12): a node of a stage's chosen tree that a warned
 * alternative built while its feature was on.
 * @typedef {object} ParseWarning
 * @property {string} stage
 * @property {string} feature
 * @property {string} rule
 * @property {Span} span the node's span over the stage's input tokens
 * @property {Span} source the node's range of the original text
 */
/**
 * One of a dialect's features (engine §13).
 * @typedef {object} Feature
 * @property {string} name
 * @property {"gate" | "warning"} kind
 * @property {boolean} default whether the pipeline's `%features` turns it on
 */
/**
 * The result of parsing a text.
 * @typedef {object} ParseResult
 * @property {boolean} ok
 * @property {StageReport[]} stages
 * @property {ResultNode | null} tree the last stage's tree
 * @property {ParseError | null} error
 * @property {string} text
 * @property {ParseWarning[]} warnings every stage's warnings, in stage order
 * @property {string[]} features the features the parse ran with, those auto
 *   features added included; not part of the canonical JSON
 */
/**
 * @typedef {object} ParseOptions
 * @property {Iterable<string>} [features] the features to turn on, besides
 *   those the dialect's pipeline turns on
 * @property {Iterable<string>} [withoutFeatures] the features to turn off,
 *   the pipeline's among them; naming one in both lists is a usage error
 * @property {boolean} [autoFeatures] enable `sa-su` only for a text that
 *   needs it; on unless `false`
 * @property {string} [until] the name of the last stage to run
 * @property {boolean | null} [elisionOnly] override the grammar's own
 *   elision-only setting
 * @property {Token[]} [tokens] the first stage's input, in place of the
 *   text's characters
 */
/**
 * A grammar document as read by the notation.
 * @typedef {object} GrammarDom
 * @property {number} format
 * @property {DomRule[]} rules
 * @property {DomDirective[]} directives
 * @property {DomConstant[]} constants
 * @property {DomClassifier[]} classifiers
 * @property {DomImplication[]} implications
 */
/**
 * A `%classifier` item: the classifier's name and the entries it adds
 * (engine §2).
 * @typedef {object} DomClassifier
 * @property {string} name
 * @property {DomEntry[]} entries
 * @property {Position} at
 */
/**
 * An entry of a classifier: its gates, its keys, `∈` or `∉`, and its class
 * (engine §2).
 * @typedef {object} DomEntry
 * @property {Guard[]} guards gates only
 * @property {string[]} keys each a canonical sound
 * @property {"∈" | "∉"} op
 * @property {string} class an identifier tag that begins with a capital
 * @property {Position} at
 */
/**
 * An implication, `%implies A ⟹ B`: two closed terms whose type is a tag set
 * (engine §2, §11).
 * @typedef {object} DomImplication
 * @property {Term} if
 * @property {Term} then
 * @property {Position} at
 */
/**
 * A constant's definition: `%const` or `%redefine-const`, the name without
 * `$`, and its value, a closed term (engine §2, §10).
 * @typedef {object} DomConstant
 * @property {string} name
 * @property {"define" | "redefine"} op
 * @property {Term} value
 * @property {Position} at
 */
/**
 * @typedef {object} DomDirective
 * @property {string} name
 * @property {string[]} args
 * @property {Position} at
 */
/**
 * @typedef {object} DomRule
 * @property {string} name
 * @property {"define" | "redefine" | "extend"} op
 * @property {string[]} flags
 * @property {Term} [tags]
 * @property {DomAlternative[]} alternatives
 * @property {Emission} [emit]
 * @property {Condition[]} conditions
 * @property {true} [opaque]
 * @property {Position} at
 */
/**
 * @typedef {object} DomAlternative
 * @property {Guard[]} guards
 * @property {Expr} expr
 * @property {Term} [tags]
 */
/**
 * @typedef {object} Guard
 * @property {string} feature
 * @property {"gate" | "warning"} kind a gate keeps its alternative only while
 *   its feature is on, or off if negated; a warning always keeps it
 * @property {boolean} negated always false for a warning
 */
/**
 * A structural node predicate in a grammar DOM (output §2).
 * @typedef {{name:string, at:Position} | PatternTerminal | {constant:string, at:Position}
 *   | {test:TestOp, value:Term, expr:PatternTerminal} | {children:PatternChildren}
 *   | {union:Pattern[]} | {intersection:Pattern[]} | {difference:[Pattern,Pattern]}
 *   | {path:"descendant"|"first"|"last", pattern:Pattern}} Pattern
 */
/** @typedef {{terminal:string, at:Position}} PatternTerminal */
/**
 * A pattern expression over sibling nodes.
 * @typedef {{node:Pattern} | {sequence:PatternChildren[]} | {optional:PatternChildren}
 *   | {repeat:PatternChildren, separator?:PatternChildren} | {siblings:true}} PatternChildren
 */
/**
 * A rule body expression.
 * @typedef {{choice: Expr[]} | {and: Expr[]} | {seq: Expr[]}
 *   | {repeat: Expr, separator?: Expr, chain?: "left" | "right"}
 *   | {optional: Expr, elidable?: true, maximal?: true} | {capture: string, expr: Expr} | {ref: string} | {terminal: string}
 *   | {range: [string, string]} | {property: string}
 *   | {test: TestOp, value: Term, expr: TestedSymbol} | {empty: true}} Expr
 */
/**
 * The comparator of a test in a body (engine §2).
 * @typedef {"=" | "≠" | "⊇" | "⊉" | "∩=∅" | "∩≠∅"} TestOp
 */
/**
 * What a test follows: a reference other than `#`, or a terminal.
 * @typedef {{ref: string} | {terminal: string} | {range: [string, string]} | {property: string}} TestedSymbol
 */
/**
 * An emission clause.
 * @typedef {{items: EmitItem[]}} Emission
 */
/**
 * One item of an emission clause: a capture, `""` for `$`, the whole
 * constituent, with the tags to give it; or an inserted token, whose one
 * tag `insert` is. A named capture, the item's carrier, can name
 * attachment captures before it and after it (engine §11).
 * @typedef {object} EmitItem
 * @property {string} [capture]
 * @property {string} [insert]
 * @property {Term} [tags]
 * @property {string[]} [before]
 * @property {string[]} [after]
 */
/**
 * @typedef {"=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇"} Comparator
 */
/**
 * A condition.
 * @typedef {{any: Condition[]} | {all: Condition[]} | {not: Condition} | {captured: string}
 *   | {if: Condition, then: Condition} | {matches: Term, rule: string} | {begins: Term, rule: string} | {initial: Term}
 *   | {op: Comparator, left: Term, right: Term}} Condition
 */
/**
 * A term of a condition or a tags clause: a string, a tag literal, the
 * empty set, a set expression, a guarded term, a call, or a span, which
 * only a call's argument can be (engine §10).
 * @typedef {{pattern: Pattern} | {string: string} | {tag: string} | {range: [string, string]} | {emptySet: true} | {union: Term[]} | {if: Condition, then: Term}
 *   | {intersection: Term[]} | {difference: [Term, Term]} | {call: string, args: Argument[]} | {capture: string} | ConstantTerm} Term
 */
/**
 * A reference to a constant, with the position of the reference. In a
 * stitched grammar, it also holds the constant's final value (engine §2).
 * @typedef {{const: string, at: Position, value?: TermValue}} ConstantTerm
 */
/**
 * A function's argument: a term, the name of a rule, or the name of a
 * classifier.
 * @typedef {Term | {rule: string} | {classifier: string}} Argument
 */
/**
 * @typedef {object} GrammarSymbol
 * @property {import("./preferences.js").SlotComponent} [slot]
 * @property {string} [role]
 * @property {string} name
 * @property {boolean} terminal
 * @property {SymbolTest} [test] the test on the symbol's own span; not part
 *   of the terminal's identity (engine §4)
 * @property {CharacterClass} [characters] for a range or a property, the
 *   characters it matches; its name is then its written form (engine §4)
 */
/**
 * A test of a lowered symbol, with its value: a string for a sound test and
 * a tag set for a tag test, and the test as an expected list writes it
 * (docs/output.md).
 * @typedef {object} SymbolTest
 * @property {TestOp} op
 * @property {string} [sound]
 * @property {TagSet} [tags]
 * @property {string} written
 */
/**
 * The characters a range or a property matches: a range's first and last
 * scalar values, or a property's name.
 * @typedef {{from: number, to: number} | {property: string}} CharacterClass
 */
/**
 * @typedef {object} Capture
 * @property {string} name
 * @property {number} index the position of the captured symbol
 */
/**
 * A condition of a production, with the position after which it can be
 * checked (-1 for before any symbol).
 * @typedef {object} ReadyCondition
 * @property {Condition} condition
 * @property {number} readyAt
 */
/**
 * A production of a lowered grammar (engine §3).
 * @typedef {object} Production
 * @property {import("./grammar.js").StitchedAlternative} [source]
 * @property {Map<string, string>} [slotRoles]
 * @property {string} [role]
 * @property {Term[]} [writtenTags]
 * @property {number} id
 * @property {string} lhs
 * @property {GrammarSymbol[]} rhs
 * @property {boolean} helper
 * @property {string[]} flags
 * @property {string} owner the rule the production was lowered from
 * @property {string | null} elided the terminator an empty helper stands for
 * @property {SymbolTest | null} elidedTest the test of that terminator, an
 *   `=` test whose string a restored token sounds like, or null (engine §7)
 * @property {Capture[]} captures
 * @property {number[]} captureAt for each position of `rhs`, the index in
 *   `captures` of the capture there, or -1
 * @property {Map<string, number>} captureSlot each capture's name, with its
 *   index in `captures`
 * @property {ReadyCondition[]} conditions
 * @property {ReadyCondition[][]} conditionsAt the conditions ready after
 *   each position, at `readyAt + 1`, in written order
 * @property {Term | null} tags
 * @property {Emission | null} emit
 * @property {boolean} opaque whether its constituent is an opaque part,
 *   which sounds `?` and shows its text (engine §11)
 * @property {string[]} warnings the features of the alternative's warnings,
 *   in the order they are written; none for a helper
 */
/**
 * @typedef {object} Resolution
 * @property {"greedy" | "lazy" | "late-elision"} lean the rule of the
 *   ranking (engine §6)
 * @property {boolean} elisionOnly
 */
/**
 * A grammar lowered for one set of features.
 * @typedef {object} LoweredGrammar
 * @property {Production[]} productions
 * @property {Map<string, Production[]>} byLhs
 * @property {Set<string>} maximalHelpers the helpers of the elidable
 *   optionals written [++T x], whose terminators are maximal (engine §3.8,
 *   §4)
 * @property {Resolution} resolution
 * @property {import("./preferences.js").Preferences} preferences
 * @property {Map<string, Map<string, TagSet>>} classifiers each classifier
 *   of the stage, resolved for these features: each key's classes (engine
 *   §2)
 * @property {{if: TagSet, then: TagSet}[]} implications the stage's
 *   implications, which its emitted tokens take (engine §11)
 */
/**
 * The rule the ranking uses: the grammar's, or none for elision-only's
 * check and for the readings of a late-elision tie (engine §6).
 * @typedef {"greedy" | "lazy" | "late-elision" | "none"} Lean
 */
/**
 * The captured parts of a chart item, the last one first: each part's
 * capture by its index in the production, its span and the number of its
 * tag set, after the parts before it. A context makes each sequence once,
 * with its number (engine §4). `depth` counts the parts, and `jump` is an
 * earlier sequence that a search for a part can skip to.
 * @typedef {{parent: Captured, jump: Captured, depth: number, index: number, start: number, end: number, tags: number, structure: number, id: number} | null} Captured
 */
/**
 * How an item was built.
 * @typedef {{kind: "seed"} | {kind: "scan", previous: Item, token: number, terminal: string}
 *   | {kind: "complete", previous: Item, child: Item}
 *   | {kind: "restore", token: number, terminal: string}} Edge
 */
/**
 * A value a term evaluates to: a string, or a set, of strings or of tags,
 * whose kind the reader has checked (engine §10).
 * @typedef {{pattern: any} | {string: string} | {set: Set<string>}} TermValue
 */
/**
 * A span a term denotes, with the tags of the captured part when it is a
 * whole capture.
 * @typedef {object} SpanValue
 * @property {number} [structure]
 * @property {import("./patterns.js").PatternMachine | null} [patterns]
 * @property {number} start
 * @property {number} end
 * @property {TagSet} [tags]
 * @property {"R" | "raw"} [space] in the check of engine §7, a span of the
 *   reconstructed input that an observation projects ("R"), or one that a
 *   fault reads as it is ("raw"); absent for a span of the stage's input
 * @property {[number, number]} [reconstructed] for a span of the stage's
 *   input that a function computed in the check, the span of R behind it,
 *   which only faults read
 * @property {[number, number]} [exact] for such a span, the exact span of R
 *   behind it: one original token for head and last, and from the first
 *   original token of the span for tail, from and after; only faults read
 *   it
 */
/**
 * Where a term looks up its captures.
 * @typedef {object} Scope
 * @property {(name: string) => SpanValue} capture
 */
/**
 * A sequence of actions, shared between the sequences built on it. Its
 * size is the number of its visible actions, exact however large (see
 * Count in rank.js).
 * @typedef {{empty: true, size: number} | RopeLeaf | RopeConcat} Rope
 */
/** @typedef {{leaf: Action, size: number}} RopeLeaf */
/** @typedef {{left: Rope, right: Rope, size: number | bigint}} RopeConcat */
/**
 * A derivation, every production closed, helpers and all.
 * @typedef {DerivationRead | DerivationRule} Derivation
 */
/**
 * @typedef {object} DerivationRead
 * @property {ReadAction} read
 * @property {number} start
 * @property {number} end
 */
/**
 * @typedef {object} DerivationRule
 * @property {Item} item
 * @property {Production} production
 * @property {Derivation[]} children
 * @property {number} start
 * @property {number} end
 */
/** @typedef {import("./tokens.js").Token} Token */
/** @typedef {import("./earley.js").Item} Item */
/** @typedef {import("./earley.js").ParseContext} ParseContext */
export {};
