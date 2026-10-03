// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";
import { CAPTURE_NAME, captureSequences, CLASSIFIER_NAME, DOM_FORMAT, comparisonProblem, conditionTypeProblem, constantValueType, definitionProblem, expectedProblem, isSoundTest, joinedType, literalCallProblem, propertyProblem, rangeProblem, readsOwnTags, soundProblem, termType } from "./dom.js";
import { characterTag } from "./tags.js";

/**
 * @import { Argument, Comparator, Condition, DomAlternative, DomClassifier, DomConstant, DomDirective, DomEntry, DomImplication, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
 * @import { Token } from "./tokens.js"
 */

/**
 * `tree` is the syntax stage's result tree; `tokens` the syntax stage's
 * input tokens, whose text is what the author wrote; `positionOf` maps a
 * token to its [line, column] in the document.
 * @param {ResultNode} tree
 * @param {Token[]} tokens
 * @param {(token: Token) => Position} positionOf
 * @param {string} path
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 *   the lowercase mapping that the strings of sound tests are checked
 *   against (engine §9, §10), and the marks that a character tag escapes
 *   (engine §1)
 * @returns {GrammarDom}
 */
export function treeToDom(tree, tokens, positionOf, path, unicode) {
  /** @type {(node: ResultNode) => string} */
  const text = (node) => tokens[/** @type {import("./types.js").TokenNode} */ (node).token].text;
  /** @type {(node: ResultNode) => Position} */
  const at = (node) => positionOf(tokens[firstToken(node)]);
  /** @type {(message: string, node: ResultNode) => never} */
  const fail = (message, node) => {
    const [line, column] = at(node);
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  };

  // A rule node's children, with transparent rules read in their place.
  /** @type {(node: ResultNode) => ResultNode[]} */
  const parts = (node) => {
    /** @type {ResultNode[]} */
    const result = [];
    if (node.kind !== "rule") return result;
    for (const child of node.children) {
      if (child.kind === "rule" && !NAMED.has(child.rule)) result.push(...parts(child));
      else result.push(child);
    }
    return result;
  };
  /** @type {(node: ResultNode) => string | null} */
  const tokenText = (node) => (node.kind === "token" ? text(node) : null);
  /** @type {(node: ResultNode, name: string) => RuleNode[]} */
  const ofRule = (node, name) => parts(node).flatMap((child) => (child.kind === "rule" && child.rule === name ? [child] : []));
  /** @type {(node: ResultNode, name: string) => RuleNode | undefined} */
  const one = (node, name) => ofRule(node, name)[0];
  // The parts that the reader reads from a node (engine §9). A node that
  // lacks one is an error of the document, which only a bootstrap of
  // another notation gives.
  /** @type {(node: ResultNode, what: string) => never} */
  const lacks = (node, what) => fail(`the notation's ${ruleOf(node)} has no ${what}`, node);
  /** @type {(node: ResultNode, name: string) => RuleNode} */
  const only = (node, name) => {
    const found = one(node, name);
    return found || lacks(node, name);
  };
  /** @type {(node: ResultNode, name: string, least?: number) => RuleNode[]} */
  const some = (node, name, least = 1) => {
    const found = ofRule(node, name);
    return found.length >= least ? found : lacks(node, least === 1 ? name : `${least} of ${name}`);
  };
  /** @type {(node: ResultNode) => ResultNode} */
  const token = (node) => parts(node).find((child) => child.kind === "token") || lacks(node, "token");
  // The first part, a token, a range or a property.
  /** @type {(node: ResultNode) => ResultNode} */
  const symbolPart = (node) => {
    const first = parts(node)[0];
    if (first && (first.kind === "token" || ruleOf(first) === "range" || ruleOf(first) === "property")) return first;
    return lacks(node, "token, range or property");
  };
  // The one rule among the parts, which must be one of `kinds`.
  /** @type {(node: ResultNode, kinds: Set<string>) => RuleNode} */
  const knownOf = (node, kinds) => {
    const found = parts(node).filter((child) => child.kind === "rule");
    if (found.length !== 1 || !kinds.has(/** @type {RuleNode} */ (found[0]).rule)) return lacks(node, `single part of these: ${[...kinds].join(", ")}`);
    return /** @type {RuleNode} */ (found[0]);
  };
  /** @type {(node: ResultNode) => string | undefined} */
  const ruleOf = (node) => (node.kind === "rule" ? node.rule : undefined);
  // The first node of a rule at or below a node, in the order written.
  /** @type {(node: ResultNode, name: string) => ResultNode | null} */
  const firstOfRule = (node, name) => {
    if (ruleOf(node) === name) return node;
    for (const child of parts(node)) {
      const found = firstOfRule(child, name);
      if (found) return found;
    }
    return null;
  };

  /** @type {DomRule[]} */
  const rules = [];
  /** @type {DomDirective[]} */
  const directives = [];
  /** @type {DomConstant[]} */
  const constants = [];
  /** @type {DomClassifier[]} */
  const classifiers = [];
  /** @type {DomImplication[]} */
  const implications = [];
  // What the reader is reading as a closed term, a constant's value or a
  // test's operand, or null (engine §9, §10).
  /** @type {string | null} */
  let closedFor = null;
  // The notation node of each capture of the alternative being read, where
  // an error about it is reported.
  /** @type {Map<object, ResultNode>} */
  let captureNodes = new Map();
  // How many braces and elidable optionals the reader is inside, where no
  // capture stands.
  let braces = 0;
  let marked = 0;
  for (const item of parts(tree)) {
    if (item.kind === "rule" && !ITEMS.has(item.rule)) fail(`the notation gives a ${item.rule} where an item stands`, item);
    if (ruleOf(item) === "directive") {
      const name = text(token(item)).slice(1);
      const operands = parts(item).filter((child) => ruleOf(child) === "argument-word" || ruleOf(child) === "argument-string" || ruleOf(child) === "argument-tag");
      const problem = operandProblem(name, operands.map((child) => operandKind(child)));
      if (problem) fail(problem, item);
      directives.push({
        name,
        // A string operand is decoded, as a string of a rule is, and a tag
        // literal is its name.
        args: operands.map((child) => {
          if (ruleOf(child) === "argument-word") return text(token(child));
          if (ruleOf(child) === "argument-string") return decode(token(child));
          // A range or a property has no tag; operandProblem has refused it.
          return tagOf(symbolPart(child));
        }),
        at: at(item),
      });
    } else if (ruleOf(item) === "rule") {
      rules.push(readRule(item));
    } else if (ruleOf(item) === "constant-definition") {
      constants.push(readConstant(item));
    } else if (ruleOf(item) === "classifier") {
      classifiers.push(readClassifier(item));
    } else if (ruleOf(item) === "implication-declaration") {
      implications.push(readImplicationDeclaration(item));
    }
  }
  return { format: DOM_FORMAT, rules, directives, constants, classifiers, implications };

  /**
   * A `%classifier` item: its name, which begins with a lower-case letter,
   * and its entries (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomClassifier}
   */
  function readClassifier(node) {
    const nameNode = only(node, "classifier-name");
    const name = text(token(nameNode));
    if (!CLASSIFIER_NAME.test(name)) fail(`${name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter`, nameNode);
    return { name, entries: ofRule(node, "classifier-entry").map(readEntry), at: at(node) };
  }

  /**
   * An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a class
   * (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomEntry}
   */
  function readEntry(node) {
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(token(guard));
      if (spelled.endsWith("!")) fail("an entry of a classifier takes gates only, not a warning", guard);
      const negated = spelled.startsWith("¬");
      /** @type {import("./types.js").Guard} */
      const read = { feature: spelled.slice(negated ? 1 : 0, -1), kind: "gate", negated };
      return read;
    });
    const keys = some(node, "classifier-key").map((keyNode) => {
      const key = decode(token(keyNode));
      const wrong = soundProblem(key, unicode);
      if (wrong) fail(`a key is a canonical sound: ${wrong}`, keyNode);
      return key;
    });
    const op = /** @type {"∈" | "∉"} */ (text(token(only(node, "classifier-operator"))));
    const classNode = only(node, "classifier-class");
    const written = text(token(classNode));
    const name = written.startsWith("~") ? written.slice(1) : written;
    if (!isCapital(name)) fail(`${written} is not a class: a class is an identifier tag that begins with a capital`, classNode);
    return { guards, keys, op, class: name, at: at(node) };
  }

  /**
   * An implication, `%implies A ⟹ B`: two closed terms whose type is a tag
   * set (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomImplication}
   */
  function readImplicationDeclaration(node) {
    const [antecedent, consequent] = some(node, "union", 2).slice(0, 2).map((side) => {
      closedFor = "a side of an implication";
      const term = readTerm(side);
      closedFor = null;
      const found = termType(term);
      const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
      if (problem) fail(`a side of an implication is a tag set: ${problem}`, side);
      return term;
    });
    return { if: antecedent, then: consequent, at: at(node) };
  }

  /**
   * A constant's definition: its name without `$`, and its value, a closed
   * term of a type that a constant can have (engine §2, §9, §10).
   * @param {ResultNode} node
   * @returns {DomConstant}
   */
  function readConstant(node) {
    const keyword = text(token(only(node, "constant-definer")));
    const name = text(token(only(node, "constant-reference"))).slice(1);
    const valueNode = only(node, "term");
    closedFor = "a constant's value";
    const value = readTerm(valueNode);
    closedFor = null;
    const op = keyword === "%redefine-const" ? "redefine" : "define";
    const found = constantValueType(value, op === "redefine");
    if ("problem" in found) fail(found.problem, valueNode);
    return { name, op, value, at: at(node) };
  }

  /**
   * @param {ResultNode} node
   * @returns {DomRule}
   */
  function readRule(node) {
    const keyword = text(token(only(node, "definer")));
    /** @type {Partial<DomRule>} */
    const rule = { name: text(token(only(node, "rule-name"))), op: keyword === "%extend-rule" ? "extend" : keyword === "%redefine-rule" ? "redefine" : "define" };
    const tags = one(node, "tags-clause");
    if (tags) rule.tags = readConstituentTags(tags);
    rule.alternatives = some(only(node, "body"), "alternative").map(readAlternative);
    const emits = one(node, "emits-clause");
    if (emits) rule.emit = readEmission(emits);
    // Each condition of the list is one condition, applying where its
    // captures are (engine §3.6).
    const conditions = one(node, "conditions-clause");
    rule.conditions = conditions ? some(conditions, "implication").map(readImplication) : [];
    if (one(node, "opaque-clause")) rule.opaque = true;
    rule.at = at(node);
    const problem = definitionProblem(rule);
    if (problem) fail(problem, node);
    return /** @type {DomRule} */ (rule);
  }

  /**
   * @param {ResultNode} node
   * @returns {DomAlternative}
   */
  function readAlternative(node) {
    // A guard's token is its spelling: `f?` or `¬f?` for a gate, `f!` for
    // a warning (engine §9).
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(token(guard));
      const negated = spelled.startsWith("¬");
      /** @type {import("./types.js").Guard} */
      const read = { feature: spelled.slice(negated ? 1 : 0, -1), kind: spelled.endsWith("!") ? "warning" : "gate", negated };
      return read;
    });
    captureNodes = new Map();
    /** @type {DomAlternative} */
    const alternative = { guards, expr: readExpression(only(node, "conjunction"), true) };
    // A name stands at most once in each production, gates aside: the
    // error stands at the second capture that such a production reads,
    // the first in the text where there are several (engine §3.5, §9).
    const twice = captureSequences(alternative.expr).duplicates.map((capture) => /** @type {ResultNode} */ (captureNodes.get(capture)));
    if (twice.length > 0) {
      const first = twice.reduce((a, b) => (firstToken(b) < firstToken(a) ? b : a));
      fail(`the capture $${text(token(first)).slice(1)} is read twice by one production of the alternative`, first);
    }
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = readConstituentTags(tags);
    return alternative;
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [whole] whether it is the alternative's whole
   *   expression, where a chain may stand (engine §9)
   * @returns {Expr}
   */
  function readExpression(node, whole = false) {
    switch (ruleOf(node)) {
      case "choice": {
        const found = some(node, "conjunction");
        const items = found.map((item) => readExpression(item));
        return items.length === 1 ? items[0] : { choice: items };
      }
      case "conjunction": {
        const found = some(node, "sequence");
        const items = found.map((item) => readExpression(item, whole && found.length === 1));
        // A & of n items expands to 2ⁿ−1 sequences (engine §3.2).
        if (items.length > 16) fail("an & joins at most 16 items", node);
        return items.length === 1 ? items[0] : { and: items };
      }
      case "sequence": {
        const found = some(node, "primary");
        const items = found.map((item) => readPrimary(knownOf(item, PRIMARIES), whole && found.length === 1));
        return items.length === 1 ? items[0] : { seq: items };
      }
      default:
        return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * An optional, and with a marker `+` or `++` among its parts an elidable
   * one (engine §3.8, §9). Its form is checked on the tree, where a group
   * is still a node: one sequence, whose first primary is the terminal
   * itself, `=`-tested or not.
   * @param {RuleNode} node
   * @returns {Expr}
   */
  function readOptional(node) {
    const found = parts(node);
    const markers = found.filter((child) => tokenText(child) === "+" || tokenText(child) === "++");
    if (markers.length >= 2) fail("an optional has one marker + or ++ at most", markers[1]);
    const choice = only(node, "choice");
    if (markers.length === 0) return { optional: readExpression(choice) };
    const form = "an elidable optional begins with its terminator, a name with a capital or ~name, written directly after the marker, and joins it to nothing with | or &";
    const conjunctions = ofRule(choice, "conjunction");
    const sequences = conjunctions.length === 1 ? ofRule(conjunctions[0], "sequence") : [];
    const primary = sequences.length === 1 ? ofRule(sequences[0], "primary")[0] : undefined;
    const head = primary ? knownOf(primary, PRIMARIES) : undefined;
    /** @type {(symbol: RuleNode) => boolean} */
    const isTerminal = (symbol) => ruleOf(symbol) === "tag" || (ruleOf(symbol) === "reference" && /^[A-Z]/.test(text(token(symbol))));
    if (!head) fail(form, node);
    const symbol = /** @type {RuleNode} */ (head);
    if (ruleOf(symbol) === "tested") {
      if (!isTerminal(knownOf(only(symbol, "primary"), PRIMARIES))) fail(form, node);
      const testNode = only(symbol, "test");
      const comparator = parts(testNode).flatMap((child) => (child.kind === "token" ? [text(child)] : [])).join("");
      if (comparator !== "=") fail("the terminator of an elidable optional takes no test but =, since elision-only restores it with its sound", testNode);
    } else if (!isTerminal(symbol)) {
      fail(form, node);
    }
    marked++;
    const expr = readExpression(choice);
    marked--;
    return tokenText(markers[0]) === "++" ? { optional: expr, elidable: true, maximal: true } : { optional: expr, elidable: true };
  }

  /**
   * Braces: the item, its separator if a backslash has one, and a chain's
   * direction from its marker, a `...` among the parts (engine §9).
   * @param {RuleNode} node
   * @param {boolean} whole whether the braces are their alternative's whole
   *   expression
   * @returns {Expr}
   */
  function readRepetition(node, whole) {
    const found = parts(node);
    const choices = some(node, "choice");
    const markers = found.flatMap((child, index) => (tokenText(child) === "..." ? [index] : []));
    // Two markers are an error at the second, and a marker after the
    // separator is an error at that marker, whichever a reader meets first.
    if (markers.length >= 2) fail("braces have one chain marker ... at most", found[markers[1]]);
    const second = choices.length >= 2 ? found.indexOf(choices[1]) : found.length;
    if (markers.length === 1 && markers[0] > second) fail("a separator has no chain marker: ... stands after { or after the item", found[markers[0]]);
    const chain = markers.length === 0 ? null : markers[0] < found.indexOf(choices[0]) ? "left" : "right";
    // A chain is the whole expression of its alternative, as the lowering
    // of its levels needs (engine §3.3, §9).
    if (chain && !whole) fail("a chain is the whole expression of its alternative: name it as a rule to use it here", node);
    braces++;
    /** @type {Expr} */
    const result = { repeat: readExpression(choices[0]) };
    if (choices.length >= 2) result.separator = readExpression(choices[1]);
    braces--;
    if (chain) result.chain = chain;
    return result;
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [whole] whether a chain may stand here
   * @returns {Expr}
   */
  function readPrimary(node, whole = false) {
    switch (ruleOf(node)) {
      case "reference": return { ref: text(token(node)) };
      case "tag": case "character": case "phoneme": return { terminal: tagOf(token(node)) };
      case "range": return { range: readRange(node) };
      case "property": return { property: readProperty(token(node)) };
      case "tested": {
        // A reference other than # or a terminal, and one test on its own
        // span (engine §2, §9). The syntax grammar reads a test after any
        // primary, so that the reader can name the reason.
        const testNode = only(node, "test");
        const symbol = knownOf(only(node, "primary"), PRIMARIES);
        const kind = ruleOf(symbol);
        if (kind === "constant-reference") fail(CONSTANT_IN_BODY, symbol);
        if (!["reference", "tag", "character", "phoneme", "range", "property"].includes(/** @type {string} */ (kind)) ||
            (kind === "reference" && text(token(symbol)) === "#")) {
          fail("a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test", testNode);
        }
        const expr = /** @type {import("./types.js").TestedSymbol} */ (readPrimary(symbol));
        // The comparator is the test's tokens: `=`, `≠`, `⊇` or `⊉`, or
        // `∩` and `=∅` or `≠∅` around the operand.
        const test = /** @type {import("./types.js").TestOp} */ (parts(testNode).flatMap((child) => (child.kind === "token" ? [text(child)] : [])).join(""));
        const operand = only(testNode, "test-operand");
        closedFor = "a test's operand";
        const value = readTerm(operand);
        closedFor = null;
        const found = termType(value);
        const problem = "problem" in found ? found.problem : expectedProblem(found.type, isSoundTest(test) ? "string" : "tags");
        if (problem) fail(`${test} tests ${isSoundTest(test) ? "a string" : "a tag set"}: ${problem}`, operand);
        if (isSoundTest(test) && "string" in value) {
          const wrong = soundProblem(value.string, unicode);
          if (wrong) fail(wrong, firstOfRule(operand, "string") || operand);
        }
        return { test, value, expr };
      }
      case "capture": {
        if (braces > 0) fail("a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that", node);
        if (marked > 0) fail("a capture cannot stand inside an elidable optional, which elision restores as one unit", node);
        const captureToken = token(node);
        const inner = only(node, "primary");
        if (text(captureToken) === "$") fail("$ is the whole constituent and wraps nothing", node);
        if (!CAPTURE_NAME.test(text(captureToken).slice(1))) fail("a capture's name is all lower case", node);
        const wrapped = knownOf(inner, PRIMARIES);
        const kind = ruleOf(wrapped);
        if (kind === "constant-reference") fail(CONSTANT_IN_BODY, wrapped);
        if (!["reference", "tag", "character", "phoneme", "range", "property", "tested"].includes(/** @type {string} */ (kind))) fail("a capture wraps one symbol", node);
        const name = text(captureToken).slice(1);
        const expr = readPrimary(wrapped);
        const capture = { capture: name, expr };
        captureNodes.set(capture, node);
        return capture;
      }
      case "constant-reference": return fail(CONSTANT_IN_BODY, node);
      case "group": return readExpression(only(node, "choice"));
      case "optional": return readOptional(/** @type {RuleNode} */ (node));
      case "repetition": return readRepetition(/** @type {RuleNode} */ (node), whole);
      case "empty": return { empty: true };
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {Emission}
   */
  function readEmission(node) {
    // `%emits ε` emits nothing, and the constituent does not count.
    if (parts(node).some((child) => tokenText(child) === "ε")) return { items: [] };
    const items = some(node, "emit-item").map((itemNode) => {
      const target = symbolPart(only(itemNode, "emit-target"));
      const kind = target.kind === "rule" ? target.rule : target.terminal;
      /** @type {EmitItem} */
      let item = {};
      if (kind === "capture") item = { capture: text(target).slice(1) };
      else if (kind === "tag" || kind === "character" || kind === "phoneme") item = { insert: tagOf(target) };
      else if (kind === "identifier" && isCapital(text(target))) item = { insert: text(target) };
      else if (kind === "identifier") fail(`${text(target)} names a rule; an inserted tag is a tag literal, such as ~${text(target)}`, itemNode);
      else if (kind === "range" || kind === "property") fail("an inserted item is one tag, not a range or a property", itemNode);
      else fail("expected a capture or a tag after %emits", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags && item.insert !== undefined) fail("an inserted tag takes no tags of its own", itemNode);
      if (tags) {
        item.tags = readTagTerm(only(tags, "term"));
        if ("emptySet" in item.tags) fail("<∅> emits a token no terminal can read; %emits ε emits nothing", itemNode);
      }
      // Attachments: named captures in parentheses, before the item and
      // after it, carried only by a named capture (engine §9, §11).
      const before = ofRule(itemNode, "emit-before").map(readAttachment);
      const after = ofRule(itemNode, "emit-after").map(readAttachment);
      if ((before.length || after.length) && item.capture === undefined) fail("an inserted tag carries no attachments", itemNode);
      if ((before.length || after.length) && item.capture === "") fail("$ carries no attachments; name a capture", itemNode);
      if (before.length) item.before = before;
      if (after.length) item.after = after;
      return item;
    });
    if (items.some((item) => item.capture === "") && !items.every((item) => item.capture === "")) {
      fail("$ goes with no item but another $", node);
    }
    // A capture stands once in an emission, as an item or as an attachment.
    const named = items.flatMap((item) => (item.capture !== undefined && item.capture !== "" ? [item.capture, ...(item.before || []), ...(item.after || [])] : []));
    if (named.some((name, index) => named.indexOf(name) !== index)) fail("%emits lists a capture twice", node);
    return { items };
  }

  /**
   * An attachment's capture, by its name without `$`: never `$` itself.
   * @param {RuleNode} node
   * @returns {string}
   */
  function readAttachment(node) {
    const capture = parts(node).find((child) => child.kind === "token" && text(child).startsWith("$"));
    const name = capture ? text(capture).slice(1) : "";
    if (name === "") fail("an attachment holds a named capture, not $", node);
    return name;
  }

  /**
   * A constituent's tag term, which cannot read the tags it defines: `$`,
   * `tags($)` or `classes($)` (engine §9).
   * @param {ResultNode} node
   * @returns {Term}
   */
  function readConstituentTags(node) {
    const term = readTagTerm(only(node, "term"));
    if (readsOwnTags(term)) fail("a constituent's tags cannot be made of its own tags, tags($) or classes($)", node);
    return term;
  }

  /**
   * A whole term that must be a tag set: a constituent's or an item's tags
   * (engine §10). The error stands at the term.
   * @param {ResultNode} node
   * @returns {Term}
   */
  function readTagTerm(node) {
    const term = readTerm(node);
    const found = termType(term);
    const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
    if (problem) fail(problem, node);
    return term;
  }

  /**
   * A condition, or conditions joined by ⟹, grouping to the right.
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readImplication(node) {
    const antecedent = readAnyOf(only(node, "any-of"));
    const consequent = one(node, "implication");
    return consequent ? { if: antecedent, then: readImplication(consequent) } : antecedent;
  }

  /**
   * Conditions joined by ∨, each several joined by ∧; a parenthesized group
   * of the same connective is part of the one around it (engine §9).
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readAnyOf(node) {
    // Parentheses make no node, so a group of the same connective as the
    // one around it is part of it: (a ∧ b) ∧ c is a ∧ b ∧ c (engine §9).
    const items = some(node, "all-of").flatMap((allNode) => {
      const all = some(allNode, "condition").map(readCondition).flatMap((item) => ("all" in item ? item.all : [item]));
      const one = all.length === 1 ? all[0] : { all };
      return "any" in one ? one.any : [one];
    });
    return items.length === 1 ? items[0] : { any: items };
  }

  /**
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readCondition(node) {
    const inner = knownOf(node, CONDITIONS);
    switch (ruleOf(inner)) {
      case "implication":
        return readImplication(inner);
      case "presence":
        return { captured: text(token(inner)).slice(1) };
      case "comparison": {
        const [left, right] = some(inner, "union", 2);
        const op = /** @type {Comparator} */ (text(token(only(inner, "comparator"))));
        const condition = { op, left: readTerm(left), right: readTerm(right) };
        // The two sides fit the comparator (engine §10).
        const leftType = termType(condition.left);
        const rightType = termType(condition.right);
        const problem = "problem" in leftType ? leftType.problem : "problem" in rightType ? rightType.problem
          : comparisonProblem(op, leftType.type, rightType.type);
        if (problem) fail(problem, inner);
        return condition;
      }
      case "negation":
        return { not: readCondition(only(inner, "condition")) };
      case "call": {
        const call = readCall(inner);
        const [span, rule] = call.args;
        if (call.call === "initial" && call.args.length === 1 && !("rule" in span) && !("classifier" in span)) return { initial: span };
        if ((call.call !== "matches" && call.call !== "begins") || call.args.length !== 2 || !("rule" in rule) || "rule" in span || "classifier" in span) {
          return fail("a condition calls only matches(span, rule), begins(span, rule) or initial(span)", inner);
        }
        if (call.call === "begins") return { begins: span, rule: rule.rule };
        return { matches: span, rule: rule.rule };
      }
      default:
        return fail(`unexpected ${ruleOf(inner)}`, inner);
    }
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [argument] whether the term is a function's argument,
   *   where a span may stand
   * @returns {Term}
   */
  function readTerm(node, argument = false) {
    if (ruleOf(node) === "term") return readTerm(knownOf(node, TERMS), argument);
    if (ruleOf(node) === "guarded-term") {
      if (closedFor) fail(`${closedFor} is a closed term, and holds no guarded term`, node);
      const condition = readAnyOf(only(node, "any-of"));
      const conditionProblem = conditionTypeProblem(condition);
      if (conditionProblem) fail(conditionProblem, node);
      /** @type {Term} */
      const guarded = { if: condition, then: readTerm(only(node, "term")) };
      const found = termType(guarded);
      if ("problem" in found) fail(found.problem, node);
      return guarded;
    }
    if (ruleOf(node) === "union") {
      // Parts joined by ∪ and ∖ group from the left: a run joined by ∪ is
      // one union, and each ∖ takes what stands before it (engine §9).
      const found = some(node, "intersection");
      if (found.length === 1) return readTerm(found[0], argument);
      /** @type {string[]} */
      const operators = parts(node).flatMap((child) => {
        const written = tokenText(child);
        return written === "∪" || written === "∖" ? [written] : [];
      });
      // A leading ∪ is a separator, not an operator.
      while (operators.length >= found.length) operators.shift();
      const items = found.map((item) => readTerm(item));
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? fail(type.problem, node) : type.type;
      }), operators.includes("∖") ? "∖" : "∪");
      if ("problem" in joined) fail(joined.problem, node);
      /** @type {Term} */
      let result = items[0];
      let open = false;
      operators.forEach((operator, index) => {
        const next = items[index + 1];
        if (operator === "∖") {
          result = { difference: [result, next] };
          open = false;
        } else if (open && "union" in result) {
          result.union.push(next);
        } else {
          result = { union: [result, next] };
          open = true;
        }
      });
      return result;
    }
    if (ruleOf(node) === "intersection") {
      const found = some(node, "term-atom");
      const items = found.map((item) => readTerm(item, argument && found.length === 1));
      if (items.length === 1) return items[0];
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? fail(type.problem, node) : type.type;
      }), "∩");
      if ("problem" in joined) fail(joined.problem, node);
      return { intersection: items };
    }
    if (ruleOf(node) === "term-atom" || ruleOf(node) === "test-operand") {
      const inner = knownOf(node, ATOMS);
      if (ruleOf(inner) === "call") {
        const call = readCall(inner);
        if (!argument && SPANS.has(call.call)) fail(`${call.call} gives a span, which is not a value`, inner);
        if (call.call === "matches" || call.call === "begins" || call.call === "initial") fail(`${call.call} is a condition, not a term`, inner);
        return call;
      }
      return readTerm(inner, argument);
    }
    switch (ruleOf(node)) {
      case "string": return { string: decode(token(node)) };
      case "tag": case "character": case "phoneme": return { tag: tagOf(token(node)) };
      case "range": return { range: readRange(node) };
      case "property": return fail("a property is not a tag set, and stands only as a terminal in a body", node);
      case "name": {
        // A bare name is a tag literal if it begins with a capital, and
        // otherwise a rule, which only a function's argument names.
        const name = text(token(node));
        if (isCapital(name)) return { tag: name };
        if (argument) return /** @type {Term} */ (/** @type {unknown} */ ({ rule: name }));
        return fail(`${name} names a rule, which is not a value; ~${name} is the tag`, node);
      }
      case "empty-set": return { emptySet: true };
      case "call": return readCall(node);
      case "constant-reference": return { const: text(token(node)).slice(1), at: at(node) };
      case "capture-reference": {
        const capture = text(token(node)).slice(1);
        if (closedFor) fail(`${closedFor} is a closed term, and holds no capture`, node);
        if (!argument) fail(`a span is not a value: tags($${capture}) is the tag set of $${capture}`, node);
        return { capture };
      }
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {{call: string, args: Argument[]}}
   */
  function readCall(node) {
    const name = text(token(node));
    if (!FUNCTIONS.has(name)) fail(`unknown function ${name}`, node);
    if (closedFor && name === "classify") fail(`${closedFor} is a closed term, and classify depends on the features`, node);
    if (closedFor && name !== "split" && name !== "tag") fail(`${closedFor} is a closed term, and ${name} reads a span`, node);
    /** @type {Argument[]} */
    const args = ofRule(node, "argument").map((argument) => readTerm(only(argument, "union"), true));
    /** @type {(argument: Argument | undefined) => boolean} */
    const isSpan = (argument) => argument !== undefined && ("capture" in argument || ("call" in argument && SPANS.has(argument.call)));
    /** @type {(argument: Argument | undefined) => boolean} */
    const isRule = (argument) => argument !== undefined && "rule" in argument;
    /** @type {(argument: Argument | undefined) => boolean} */
    const isString = (argument) => {
      if (argument === undefined || "rule" in argument) return false;
      const found = termType(argument);
      // A constant's type is known only when the loader stitches the stage.
      return "type" in found && (found.type === "string" || found.type === "any");
    };
    let ok;
    if (name === "tags") ok = (args.length === 1 && isSpan(args[0])) || (args.length === 2 && isSpan(args[0]) && isRule(args[1]));
    else if (name === "matches" || name === "begins") ok = args.length === 2 && isSpan(args[0]) && isRule(args[1]);
    else if (name === "split") ok = args.length === 2 && args.every(isString);
    else if (name === "tag") ok = args.length === 1 && isString(args[0]);
    else if (name === "classify") ok = args.length === 2 && isString(args[0]) && isRule(args[1]);
    else ok = args.length === 1 && isSpan(args[0]);
    if (!ok) fail(`${name} takes ${SIGNATURES[name]}`, node);
    // The second argument of classify names a classifier, not a rule
    // (engine §9).
    if (name === "classify") return { call: name, args: [args[0], { classifier: /** @type {{rule: string}} */ (args[1]).rule }] };
    // A rule stands only as the second argument.
    if (args.some((argument, index) => "rule" in argument && index !== 1)) fail(`${name} takes ${SIGNATURES[name]}`, node);
    // An empty delimiter or a tag's name that the reader sees (engine §9).
    const seen = literalCallProblem(name, args);
    if (seen) fail(seen, node);
    return { call: name, args };
  }

  /**
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function decode(tokenNode) {
    const written = text(tokenNode);
    // A string escapes its double quote, and a character tag its quote.
    const quote = written[0];
    const spelled = [...written].slice(1, -1);
    let result = "";
    for (let index = 0; index < spelled.length; index++) {
      if (spelled[index] !== "\\") {
        result += spelled[index];
        continue;
      }
      const next = spelled[++index];
      if (next === "\\" || next === quote) result += next;
      else if (next === "u" && spelled[index + 1] === "{") {
        let end = index + 2;
        let hex = "";
        while (end < spelled.length && spelled[end] !== "}") hex += spelled[end++];
        // One to six hexadecimal digits of a Unicode scalar value (engine §9).
        const value = parseInt(hex, 16);
        if (end >= spelled.length || !/^[0-9A-Fa-f]{1,6}$/.test(hex) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
          fail("a bad \\u{...} escape", tokenNode);
        }
        result += String.fromCodePoint(value);
        index = end;
      } else {
        fail(`an unknown escape \\${next || ""}`, tokenNode);
      }
    }
    return result;
  }

  /**
   * The tag of a tag literal `~name`, a character tag or a phoneme tag
   * token: a character tag in its canonical spelling (engine §1, §9).
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function tagOf(tokenNode) {
    const written = text(tokenNode);
    if (written.startsWith("~")) return written.slice(1);
    if (written.startsWith("/")) return written;
    const decoded = [...decode(tokenNode)];
    if (decoded.length !== 1) fail("a character tag holds exactly one character", tokenNode);
    return characterTag(/** @type {number} */ (decoded[0].codePointAt(0)), unicode);
  }

  /**
   * A range's two ends, each a character tag in its canonical spelling; its
   * start must not be above its end (engine §1, §9).
   * @param {ResultNode} node
   * @returns {[string, string]}
   */
  function readRange(node) {
    const ends = some(node, "character", 2).slice(0, 2).map((end) => tagOf(token(end)));
    /** @type {[string, string]} */
    const range = [ends[0], ends[1]];
    const problem = rangeProblem(range, unicode);
    if (problem) fail(problem, node);
    return range;
  }

  /**
   * A property's name: its token is `'\p{Name}'`, with a name of engine §1.
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function readProperty(tokenNode) {
    const match = /^'\\p\{([^}]*)\}'$/.exec(text(tokenNode));
    if (!match) fail("a property is written '\\p{Name}'", tokenNode);
    const name = /** @type {RegExpExecArray} */ (match)[1];
    const problem = propertyProblem(name);
    if (problem) fail(problem, tokenNode);
    return name;
  }

  /**
   * The kind of a directive's operand (engine §9).
   * @param {ResultNode} node
   * @returns {OperandKind}
   */
  function operandKind(node) {
    if (ruleOf(node) === "argument-string") return "string";
    if (ruleOf(node) === "argument-word") return isCapital(text(token(node))) ? "class" : "name";
    const first = symbolPart(node);
    if (ruleOf(first) === "range" || ruleOf(first) === "property") return /** @type {OperandKind} */ (ruleOf(first));
    const written = text(first);
    return written.startsWith("~") ? "tag" : written.startsWith("/") ? "phoneme" : "character";
  }
}

/**
 * Whether a name begins with a capital, and so is a terminal and a tag
 * literal (engine §2).
 * @param {string} name
 * @returns {boolean}
 */
function isCapital(name) {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 0x41 && first <= 0x5a;
}

/**
 * A directive's operand: a bare name, lower case or with a capital, a
 * string, a tag literal `~name`, a phoneme tag or a character tag.
 * @typedef {"name" | "class" | "string" | "tag" | "phoneme" | "character" | "range" | "property"} OperandKind
 */

const FUNCTIONS = new Set(["phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]);


/**
 * What is wrong with a directive's operands, or null (engine §9).
 * @param {string} name
 * @param {OperandKind[]} kinds
 * @returns {string | null}
 */
export function operandProblem(name, kinds) {
  const names = kinds.every((kind) => kind === "name" || kind === "class");
  if (name === "stage") return kinds.length === 1 && names ? null : "%stage takes one name";
  if (name === "include") return kinds.length === 1 && kinds[0] === "string" ? null : "%include takes one string";
  if (name === "features") return kinds.length > 0 && names ? null : "%features takes one or more names";
  return names ? null : `%${name} takes names only`;
}

const CONSTANT_IN_BODY = "a constant cannot stand in a body: a body names a class of tokens with a rule, such as %rule digit '0'..'9'";

// The functions whose value is a span.
const SPANS = new Set(["head", "tail", "last", "from", "after"]);

/** @type {Record<string, string>} */
const SIGNATURES = {
  phonemes: "one span", text: "one span", words: "one span", classes: "one span",
  head: "one span", tail: "one span", last: "one span", from: "one span", after: "one span", initial: "one span",
  split: "two strings", tag: "one string", tags: "a span, and optionally a rule", classify: "a string and a classifier's name", matches: "a span and a rule", begins: "a span and a rule",
};

// What a primary, a condition, a term and a term atom hold: the one rule
// among their parts is one of these (engine §9).
const PRIMARIES = new Set(["reference", "tag", "character", "phoneme", "range", "property", "tested", "capture", "group", "optional", "repetition", "empty", "constant-reference"]);
const CONDITIONS = new Set(["comparison", "call", "negation", "presence", "implication"]);
const TERMS = new Set(["union", "guarded-term"]);
const ATOMS = new Set(["string", "tag", "character", "phoneme", "range", "property", "name", "empty-set", "term", "call", "capture-reference", "constant-reference"]);
// The items of a document (engine §9).
const ITEMS = new Set(["directive", "rule", "constant-definition", "classifier", "implication-declaration"]);

// The rules of the notation's syntax grammar that the reader knows (engine
// §9). Every other rule is a wrapper, and the reader reads its parts in its
// place.
const NAMED = new Set([
  "directive", "argument-word", "argument-string", "rule", "definer", "rule-name", "body", "alternative", "guard", "alternative-tags",
  "conjunction", "sequence", "primary", "repetition", "reference", "string", "phoneme", "tested", "test", "test-operand", "capture", "group", "optional",
  "choice", "empty", "tags-clause", "conditions-clause", "emits-clause", "opaque-clause", "emit-item", "emit-target", "emit-tags", "emit-before", "emit-after",
  "implication", "any-of", "all-of", "condition", "comparison", "comparator", "negation", "presence",
  "term", "guarded-term", "union", "intersection", "term-atom", "tag", "character", "name", "empty-set", "call", "argument",
  "capture-reference", "argument-tag", "range", "property", "constant-definition", "constant-definer", "constant-reference",
  "classifier", "classifier-name", "classifier-entry", "classifier-key", "classifier-operator", "classifier-class", "implication-declaration",
]);

/**
 * @param {ResultNode} node
 * @returns {number}
 */
function firstToken(node) {
  if (node.kind === "token") return node.token;
  if (node.kind === "elided") return node.span[0];
  for (const child of node.children) {
    if (child.kind === "token") return child.token;
    if (child.kind === "rule") {
      const found = firstToken(child);
      if (found !== undefined) return found;
    }
  }
  return node.span[0];
}

