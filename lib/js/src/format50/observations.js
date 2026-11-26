// The table of recognition observations of the format 50 bridge.
//
// Recognition decides each read of a condition, a filter, a pattern or a
// tag term on the tags and the input strings of the chart, and the stage
// reads the real bags only after the choice of a parse. Each row names a
// read form that recognition decides, the kinds of receiver that it takes,
// and why the form of the recognizer gives the same answer as the bag. The
// bridge marks each read that it hands to the recognizer with its row, and
// it refuses a read with no row, or with a receiver that its row does not
// take. Refusal is the default, and a row is the exception.
//
// A row can name a check that the loader runs later on the whole stage,
// where the exactness of the form depends on more than one document.
//
// Receiver kinds:
// - "token": a capture of a terminal, a written leaf, or a leaf that can be
//   omitted with the empty string as its value.
// - "omitted": a capture of a terminal that can be an omitted leaf with a
//   default that is not empty.
// - "rule": a capture of a rule, a call or a splice.
// - "compound": a compound binding.
// - "self": `$`, the node of the rule that the read belongs to.
// - "list": a capture in an optional or a repetition.
// - "root": the root of a forest in a predicate on that forest.
// - "span": a span of the input.

/**
 * @typedef {{id: string, form: string, receivers: string[], check?: string, proof: string}} Observation
 */

/** @type {Observation[]} */
const ROWS = [
  {
    id: "presence",
    form: "A capture in a truth position, `.present`, and a predicate of presence over a list",
    receivers: ["token", "omitted", "rule", "compound", "self", "list"],
    proof: "The recognizer binds a capture on the route that reads its symbol, so the capture is present exactly where the chosen node has it. A compound binding is present on each visit of its operand. A list is present where it has an item.",
  },
  {
    id: "span",
    form: "A method of a span, a span in a truth position, a query and a neighbor test",
    receivers: ["token", "omitted", "rule", "compound", "self", "span"],
    proof: "The span of a node is the input window of its item, which the chart holds exactly. A query and a neighbor test are observations of recognition by definition, also for a late caller.",
  },
  {
    id: "input-join",
    form: "The join of the values or the images of the input tokens of a span",
    receivers: ["token", "omitted", "rule", "compound", "self", "span"],
    proof: "The recognizer joins the stored strings of the input tokens of the window, which is what the expression computes.",
  },
  {
    id: "token-value",
    form: "`'value` of a leaf",
    receivers: ["token"],
    proof: "A written leaf has the stored value of its one input token, which is the join of the values of its window. An omitted leaf with the empty string as its value has an empty window, whose join is the empty string. A leaf with another default is an omitted receiver, which this row does not take.",
  },
  {
    id: "token-image",
    form: "`'image` of a leaf",
    receivers: ["token", "omitted"],
    proof: "A written leaf has the stored image of its one input token. An omitted leaf has the empty image, which is the join of its empty window.",
  },
  {
    id: "certified-value",
    form: "`'value` of a rule node, of a compound binding or of `$`, and a value test on a symbol of a rule",
    receivers: ["rule", "compound", "self"],
    check: "certificate",
    proof: "The recognizer compares the join of the input values of the window. The certificate proves for every rule that the receiver can bind that its value is that join, and the loader refuses the read where a rule has no certificate.",
  },
  {
    id: "token-key",
    form: "A visible key of a leaf: a property read with no value, `.has(K)`, a filter and `.flags`",
    receivers: ["token", "omitted"],
    proof: "The recognizer token holds a tag for each visible key of the token's bag. An omitted leaf holds the key of its terminal and no other visible key.",
  },
  {
    id: "rule-key",
    form: "A visible key of a rule node, a compound binding or `$`: a property read with no value, `.has(K)`, a filter, a pattern filter and `.flags`",
    receivers: ["rule", "compound", "self"],
    check: "defaults",
    proof: "The tag term of an alternative applies the primary or the sole symbol, then the statement term, then the alternative term, in the order of the bag, and each entry adds or removes the tags of its keys. The loader refuses the read where the term of a rule that the receiver can bind has no tag form, and where the stage defaults can write a key other than value and image, since the tag term does not hold them.",
  },
  {
    id: "hidden-key",
    form: "`.has(k)` and `.has-value(k)` of a key that is not visible",
    receivers: ["token", "rule", "compound", "self"],
    check: "defaults",
    proof: "Each present key has the hidden tag of its presence, and each valued key the hidden tag of its payload, on a recognizer token and on each write of a tag term. A deletion drops every hidden tag of its key, a copy takes every hidden tag of its key, and a splat replaces the hidden tags of each key that its source holds.",
  },
  {
    id: "payload-string",
    form: "`=` and `≠` of a payload with a string",
    receivers: ["token", "rule", "compound", "self", "root"],
    check: "defaults",
    proof: "Each string or number payload carries the hidden tag of its JSON value, on a recognizer token and on each write, made at run time from the computed string or from the enumerated literal. So equality with a string is the test of one tag, and inequality is a valued key without that tag.",
  },
  {
    id: "payload-domain",
    form: "`<`, `≤`, `>` and `≥` of a payload, and arithmetic on payloads",
    receivers: ["rule", "compound", "self"],
    check: "domain",
    proof: "The writes of the stage enumerate every value of the key. The loader refuses the read where the stage input can carry the key with a payload, since the input values are not in that enumeration.",
  },
  {
    id: "key-set",
    form: "`.flags` and `.classes` of a node, and comparisons of such key sets",
    receivers: ["token", "omitted", "rule", "compound", "self", "root", "span"],
    check: "defaults",
    proof: "The visible tags of a node are the visible keys of its bag by the rows of visible keys. The key set of a span is the union of the visible keys of its input tokens. `.keys` has no row, because the tag form holds no tag for a key that is not visible.",
  },
  {
    id: "tag-term",
    form: "A tag of a primary, a copy or a splat in a tag term",
    receivers: ["token", "omitted", "rule", "compound", "self"],
    proof: "A tag term reads the tags of a node of its own alternative, which the rows of keys make exact, and it builds the tags of the rule from them in the order of the bag.",
  },
  {
    id: "root-key",
    form: "A visible key, a value or an image of the root of a forest in a predicate on the forest",
    receivers: ["root"],
    check: "certificate",
    proof: "A root of a forest exposes its recognition observations. Its visible keys are those of its rule by the rows of visible keys. Its value and its image are the hidden tags that its rule writes in the last entry of each alternative, which the bridge requires.",
  },
  {
    id: "pattern",
    form: "A comparison of a node with a tree pattern, and of two nodes",
    receivers: ["token", "omitted", "rule", "compound", "self"],
    check: "certificate",
    proof: "The structural machine reads the rule and terminal identities, the shape and the omission status of the derivation, which the chart holds. A filter of a pattern atom reads keys by the rows of visible keys, and a value test of an atom on a rule needs the certificate of that rule.",
  },
];

/** @type {Map<string, Observation>} */
export const OBSERVATIONS = new Map(ROWS.map(row => [row.id, row]));

/**
 * The row of a read with this receiver, or null.
 * @param {string} id
 * @param {string} receiver
 * @returns {Observation | null}
 */
export function observationRow(id, receiver) {
  const row = OBSERVATIONS.get(id);
  return row && row.receivers.includes(receiver) ? row : null;
}
