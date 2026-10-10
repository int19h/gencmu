"""The shape of a grammar DOM (docs/output.md, "A grammar DOM").

A DOM that was not read from a document here, the bootstrap's or a
precompiled one from compiled.json, is held to every rule the reader holds a
document to (engine §9), so that a corrupt or hand-made one is refused, or
read afresh, rather than changing a result or failing inside a parse. The
same walk bounds the nesting of a document that was read (engine §9).
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from ._clauses import definition_problem, duplicate_captures, deferred_emission_problem, rule_has_ranked
from ._tags import character_of_tag, is_tag
from ._types import constant_value_problem, expected_problem, is_sound_test, open_part, rule_type_problem, term_type, test_type_problem
from ._unicode import PROPERTY_NAMES
from ._patterns import pattern_problem, walk_pattern


class Lowercase(Protocol):
    """What the strings of sound tests are checked against: the lowercase mapping of the
    library's Unicode table, which the canonical sound uses (engine §5, §9),
    and the marks that a character tag escapes (engine §1)."""

    def lowercase(self, text: str) -> str: ...

    def is_mark(self, code: int) -> bool: ...


FORMAT = 22
"""The version of the DOM's shape (docs/output.md)."""

CONSTANT_NAME = re.compile(r"[A-Z][A-Za-z0-9-]*")
"""A constant's name, without its ``$``, begins with a capital (engine §2)."""

CLASSIFIER_NAME = re.compile(r"[a-z][A-Za-z0-9-]*")
"""A classifier's name begins with a lower-case letter (engine §2, §9)."""

_CLASS_NAME = re.compile(r"[A-Z][A-Za-z0-9-]*")
"""A class of a classifier's entry is a name with a capital (engine §2, §9)."""

MAX_DEPTH = 256
"""No node of an expression, a term or a condition may lie below more than
this many compound nodes of it (engine §9). A node's depth here is the
number of compound nodes above it, since only compound nodes have children:
optional, repeat, and, choice, seq, capture and test; union,
intersection, difference, if and call; any, all, not, if, matches, begins, initial and a
comparison."""

TOO_DEEP = "nested too deeply"

_FUNCTIONS = {"phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after", "matches", "begins", "initial"}
_COMPARATORS = {"=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"}
_SPANS = {"head", "tail", "last", "from", "after"}
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
CAPTURE_NAME = re.compile(r"[a-z][a-z0-9-]*")
"""A capture's name is all lower case (engine §9)."""
_WHOLE = ""
"""The capture name of ``$``, the whole constituent (engine §3.5)."""
_DIRECTIVE_NAMES = frozenset(["ambiguity-resolution", "stage", "extend-stage", "redefine-stage", "include", "features"])
"""The directives of the notation (engine §9)."""
_TERMINAL_NAME = re.compile(r"[A-Z][A-Za-z0-9-]*")
"""A reference that names a terminal begins with a capital (engine §2)."""

# The flags of an expression to check: whether it is an alternative's whole
# expression, where a chain may stand, and whether it lies inside braces or
# an elidable optional, where no capture stands.
_WHOLE_EXPR = 1
_SEALED = 2


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_position(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_is_int(x) for x in value)


def _is_one_of(value: Any, names: set[str]) -> bool:
    """Whether a value is one of some strings; any other value, a list or an
    object included, is not, and raises nothing."""
    return isinstance(value, str) and value in names


def _is_span(value: Any) -> bool:
    """A capture, or head, tail, last, from or after of one."""
    return isinstance(value, dict) and (isinstance(value.get("capture"), str) or _is_one_of(value.get("call"), _SPANS))


def _is_guard(value: Any) -> bool:
    """A gate, negated or not, or a warning, which never is, of a feature
    that is a name (engine §9), with no member but those three."""
    return (
        isinstance(value, dict)
        and len(value) == 3
        and isinstance(value.get("feature"), str)
        and _NAME.fullmatch(value["feature"]) is not None
        and isinstance(value.get("negated"), bool)
        and (value.get("kind") == "gate" or (value.get("kind") == "warning" and value["negated"] is False))
    )


def _is_rule_name(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("rule"), str) and len(value) == 1


def _is_classifier_name(value: Any) -> bool:
    """The second argument of classify: a classifier's name (engine §9)."""
    return (
        isinstance(value, dict)
        and isinstance(value.get("classifier"), str)
        and CLASSIFIER_NAME.fullmatch(value["classifier"]) is not None
        and len(value) == 1
    )


def _is_entry(entry: Any, unicode: Lowercase) -> bool:
    """An entry of a classifier: gates, one or more canonical keys, ``∈`` or
    ``∉``, and a class (engine §2, §9)."""
    return (
        isinstance(entry, dict)
        and len(entry) == 5
        and _is_position(entry.get("at"))
        and _is_one_of(entry.get("op"), {"∈", "∉"})
        and isinstance(entry.get("class"), str)
        and _CLASS_NAME.fullmatch(entry["class"]) is not None
        and isinstance(entry.get("guards"), list)
        and all(
            isinstance(guard, dict)
            and len(guard) == 3
            and isinstance(guard.get("feature"), str)
            and _NAME.fullmatch(guard["feature"]) is not None
            and guard.get("kind") == "gate"
            and isinstance(guard.get("negated"), bool)
            for guard in entry["guards"]
        )
        and _items(entry.get("keys"), 1)
        and all(isinstance(key, str) and sound_problem(key, unicode) is None for key in entry["keys"])
    )


# The forms of an expression, a term and a condition, each as its members
# (docs/output.md). The first member names the form.
_EXPRESSION_FORMS = (
    ("seq",),
    ("choice",),
    ("ranked",),
    ("and",),
    ("optional", "elidable?", "maximal?"),
    ("repeat", "separator?", "chain?"),
    ("ref",),
    ("terminal",),
    ("capture", "expr"),
    ("range",),
    ("property",),
    ("test", "value", "expr"),
    ("empty",),
)
_TERM_FORMS = (
    ("union",),
    ("intersection",),
    ("difference",),
    ("if", "then"),
    ("call", "args"),
    ("string",),
    ("tag",),
    ("range",),
    ("emptySet",),
    ("capture",),
    ("const", "at"),
    ("pattern",),
)
_CONDITION_FORMS = (
    ("op", "left", "right"),
    ("matches", "rule"),
    ("begins", "rule"),
    ("initial",),
    ("not",),
    ("any",),
    ("all",),
    ("captured",),
    ("if", "then"),
)


def _has_one_form(value: dict[str, Any], forms: tuple[tuple[str, ...], ...]) -> bool:
    """Whether a node has exactly the members of one of its forms. So a node
    that joins two forms, such as ``{"tag":…,"string":…}``, is refused
    before it is read, and no library reads it one way where another reads
    it another way. A member that ends in ``?`` may be absent."""
    form = next((members for members in forms if members[0] in value), None)
    if form is None:
        return False
    names = {member.rstrip("?") for member in form}
    return all(member.endswith("?") or member in value for member in form) and all(key in names for key in value)


def _is_ref(value: Any) -> bool:
    """A reference's name: a name, or ``#`` (engine §9)."""
    return isinstance(value, str) and (value == "#" or _NAME.fullmatch(value) is not None)


def _items(value: Any, least: int, most: float = float("inf")) -> bool:
    return isinstance(value, list) and least <= len(value) <= most


def _is_whole(value: Any) -> bool:
    """Whether a span is ``$``, the whole constituent."""
    return isinstance(value, dict) and value.get("capture") == _WHOLE


def reads_own_tags(term: Any, argument: bool = False) -> bool:
    """Whether one node of a rule's or an alternative's tag term reads the
    tags that term defines: ``$`` as a value, ``tags($)`` or ``classes($)``
    (engine §9). ``$`` as a value is also a span where a value is needed,
    which the types refuse (engine §10). The caller walks the term; ``argument`` says the node is an
    argument of a call, where ``$`` is a span."""
    if not isinstance(term, dict):
        return False
    if not argument and _is_whole(term) and "expr" not in term:
        return True
    args = term.get("args")
    return (
        _is_one_of(term.get("call"), {"tags", "classes"})
        and isinstance(args, list)
        and len(args) == 1
        and _is_whole(args[0])
    )


def term_reads_own_tags(term: Any) -> bool:
    """Whether a well-formed tag term reads the tags it defines anywhere,
    the conditions of its guarded terms included."""
    stack: list[tuple[Any, bool]] = [(term, False)]
    while stack:
        value, argument = stack.pop()
        if reads_own_tags(value, argument):
            return True
        if isinstance(value, dict):
            if value.get("op") in ("≅", "≇"):
                continue
            for key, inner in value.items():
                # A call's arguments, a matches(), a begins() and an
                # initial() are spans, where $ is the constituent's tokens
                # and not its tags.
                spans = key in ("args", "matches", "begins", "initial")
                if isinstance(inner, list):
                    stack.extend((item, spans) for item in inner)
                elif isinstance(inner, dict):
                    stack.append((inner, spans))
    return False


TEST_OPS = frozenset(["=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅"])
"""The comparators of a test in a body (engine §2): the two sound tests and
the four tag tests."""


def sound_problem(sound: str, unicode: Lowercase | None) -> str | None:
    """What is wrong with the string of a sound test (engine §9), or None:
    one that no canonical sound can be, with a comma or a code point that
    the lowercase mapping would change. Without a table, the lowercase
    mapping is not checked."""
    if "," in sound:
        return f"the string {json.dumps(sound, ensure_ascii=False)} holds a comma, which no canonical sound holds"
    if unicode is not None and unicode.lowercase(sound) != sound:
        return f"the string {json.dumps(sound, ensure_ascii=False)} is not in lower case, which every canonical sound is"
    return None


def _is_testable(expr: Any, unicode: Lowercase) -> bool:
    """Whether an expression can carry a test (engine §2): a reference
    other than ``#``, a terminal, a range or a property, with no other
    member."""
    if not isinstance(expr, dict) or len(expr) != 1:
        return False
    return (
        (_is_ref(expr.get("ref")) and expr["ref"] != "#")
        or is_tag(expr.get("terminal"), unicode)
        or _is_character_class(expr, unicode)
    )


def test_value_fault(op: str, value: Any, unicode: Lowercase | None) -> tuple[str, Any] | None:
    """What is wrong with a test's value (engine §9), with the node at
    fault, or None: it must be a closed term, of type string for a sound
    test and tag set for a tag test, and a string literal of a sound test
    must be a canonical sound. The shape of the value must already be
    checked, and its nesting bounded."""
    open_node = open_part(value)
    if open_node is not None:
        return "a test's operand is a closed term, and reads no capture or span", open_node
    kind, problem = term_type(value)
    if problem is not None:
        return problem, value
    problem = test_type_problem(op, kind)  # type: ignore[arg-type]
    if problem is not None:
        return problem, value
    if is_sound_test(op) and isinstance(value.get("string"), str):
        wrong = sound_problem(value["string"], unicode)
        if wrong is not None:
            return wrong, value
    return None


def range_problem(range_: Any, unicode: Lowercase) -> str | None:
    """What is wrong with a range (engine §1, §9), or None: its ends must be
    two character tags in their canonical spelling by the table, which says
    which code points are marks, the start not above the end."""
    if not isinstance(range_, list) or len(range_) != 2:
        return "a malformed range"
    first, last = (character_of_tag(end, unicode) if isinstance(end, str) else None for end in range_)
    if first is None or last is None:
        return "a range's ends are two character tags"
    if first > last:
        return f"the range {range_[0]}..{range_[1]} starts above its end"
    return None


def property_problem(name: Any) -> str | None:
    """What is wrong with a property's name (engine §1, §9), or None."""
    if not isinstance(name, str) or name not in PROPERTY_NAMES:
        return (
            f"'\\p{{{name}}}' is not a property: a property is a General_Category value in its short form,"
            " a one-letter group of them, White_Space or Any"
        )
    return None


def _is_character_class(value: dict[str, Any], unicode: Lowercase) -> bool:
    """Whether an expression node is a range or a property that the DOM
    allows, and has no other member."""
    if len(value) != 1:
        return False
    if "range" in value:
        return range_problem(value["range"], unicode) is None
    if "property" in value:
        return property_problem(value["property"]) is None
    return False


def dom_problem(dom: Any, unicode: Lowercase, defer_emission: bool = False) -> str | None:
    """Why a value is not a grammar DOM the reader could have written, or
    None when it is one. ``unicode`` is the loader's table: the lowercase
    mapping that the strings of sound tests are checked against, and the marks that decide a
    character tag's canonical spelling."""
    if (
        not isinstance(dom, dict)
        or dom.get("format") != FORMAT
        or not isinstance(dom.get("rules"), list)
        or not isinstance(dom.get("directives"), list)
        or not isinstance(dom.get("constants"), list)
        or not isinstance(dom.get("classifiers"), list)
        or not isinstance(dom.get("implications"), list)
    ):
        return f"not a DOM of format {FORMAT}"
    for directive in dom["directives"]:
        if (
            not isinstance(directive, dict)
            or not isinstance(directive.get("name"), str)
            or not isinstance(directive.get("args"), list)
            or not all(isinstance(arg, str) for arg in directive["args"])
            or not _is_position(directive.get("at"))
        ):
            return "a malformed directive"
        # No directive has a maximal member, and the notation has four
        # directives; %elidable is none of them (engine §9).
        if "maximal" in directive or directive["name"] not in _DIRECTIVE_NAMES or (directive["name"] == "ambiguity-resolution" and "maximal" in directive["args"]):
            return "a malformed directive"
        # The operands the notation's syntax allows these directives (engine §9).
        name, args = directive["name"], directive["args"]
        if (
            (name in ("stage", "extend-stage", "redefine-stage") and not (len(args) == 1 and _NAME.fullmatch(args[0])))
            or (name == "include" and len(args) != 1)
            or (name == "features" and not (args and all(_NAME.fullmatch(arg) for arg in args)))
        ):
            return "a malformed directive"
    # Each entry is a node to check, its kind, its depth, and whether it
    # lies in a rule's or an alternative's tag term, which may not read
    # the tags it defines.
    pending: list[tuple[str, Any, int, int]] = []
    # The expressions of the alternatives, whose capture names are checked
    # per production once their shape is.
    expressions: list[Any] = []
    # A constant's definition: its name, its op, its position and a value
    # that is a closed term (engine §2, §10).
    for constant in dom["constants"]:
        if (
            not isinstance(constant, dict)
            or not isinstance(constant.get("name"), str)
            or not CONSTANT_NAME.fullmatch(constant["name"])
            or not _is_one_of(constant.get("op"), {"define", "redefine"})
            or not _is_position(constant.get("at"))
            or "value" not in constant
            or len(constant) != 4
        ):
            return "a malformed constant"
        pending.append(("term", constant["value"], 0, False))
    # A classifier: its name, and entries of gates, canonical keys, an
    # operator and a class (engine §2, §9).
    for classifier in dom["classifiers"]:
        if (
            not isinstance(classifier, dict)
            or not isinstance(classifier.get("name"), str)
            or not CLASSIFIER_NAME.fullmatch(classifier["name"])
            or not isinstance(classifier.get("entries"), list)
            or not _is_position(classifier.get("at"))
            or len(classifier) != 3
        ):
            return "a malformed classifier"
        if not all(_is_entry(entry, unicode) for entry in classifier["entries"]):
            return "a malformed entry of a classifier"
    # An implication: two closed terms whose type is a tag set, checked once
    # the nesting is bounded (engine §2, §9).
    for implication in dom["implications"]:
        if (
            not isinstance(implication, dict)
            or len(implication) != 3
            or "if" not in implication
            or "then" not in implication
            or not _is_position(implication.get("at"))
        ):
            return "a malformed implication"
        pending.append(("term", implication["if"], 0, False))
        pending.append(("term", implication["then"], 0, False))
    for rule in dom["rules"]:
        if (
            not isinstance(rule, dict)
            or not isinstance(rule.get("name"), str)
            or not (_NAME.fullmatch(rule["name"]) or rule["name"] == "#")
            or not _is_one_of(rule.get("op"), {"define", "redefine", "extend"})
            or not isinstance(rule.get("flags"), list)
            or len(rule["flags"]) > 1
            or any(flag != "leftmost-longest" for flag in rule["flags"])
            or (rule["op"] == "extend" and bool(rule["flags"]))
            or not _items(rule.get("alternatives"), 1)
            or not isinstance(rule.get("conditions"), list)
            or not _is_position(rule.get("at"))
            or ("opaque" in rule and rule["opaque"] is not True)
        ):
            return "a malformed rule"
        if "tags" in rule:
            pending.append(("term", rule["tags"], 0, True))
        if "emit" in rule:
            pending.append(("emission", rule["emit"], 0, False))
        pending.extend(("condition", condition, 0, False) for condition in rule["conditions"])
        for alternative in rule["alternatives"]:
            if (
                not isinstance(alternative, dict)
                or not isinstance(alternative.get("guards"), list)
                or not all(_is_guard(guard) for guard in alternative["guards"])
            ):
                return "a malformed alternative"
            # The whole expression, where a chain may stand; its capture
            # names are checked per production once its shape is.
            pending.append(("expr", alternative.get("expr"), 0, _WHOLE_EXPR))
            expressions.append(alternative.get("expr"))
            if "tags" in alternative:
                pending.append(("term", alternative["tags"], 0, True))
    # The tested symbols, whose values are checked once the nesting is
    # bounded.
    tests: list[dict[str, Any]] = []
    problem = _walk(pending, unicode, tests)
    if problem is not None:
        return problem
    # The walks below recurse, so they run only once the nesting is bounded.
    for constant in dom["constants"]:
        if open_part(constant["value"]) is not None:
            return "a constant's value is not a closed term"
    for implication in dom["implications"]:
        for side in (implication["if"], implication["then"]):
            if open_part(side) is not None:
                return "a side of an implication is not a closed term"
            kind, problem = term_type(side)
            if problem is None:
                problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
                if problem is not None:
                    problem = f"a side of an implication is a tag set: {problem}"
            if problem is not None:
                return problem
    for test in tests:
        fault = test_value_fault(test["test"], test["value"], unicode)
        if fault is not None:
            return fault[0]
    # A capture name stands at most once in each production (engine §3.5).
    for expr in expressions:
        if duplicate_captures(expr):
            return "a capture name used twice in one production"
    # A definition is checked as a whole (engine §9), once its clauses are
    # known to be well formed, and so are the types of its terms and
    # conditions (engine §10).
    for rule in dom["rules"]:
        problem = definition_problem(rule)
        if problem is not None and defer_emission and deferred_emission_problem(problem) and rule_has_ranked(rule):
            problem = None
        problem = problem or rule_type_problem(rule)
        if problem is not None:
            return problem
    for constant in dom["constants"]:
        problem = constant_value_problem(constant["value"], constant["op"] == "redefine")
        if problem is not None:
            return problem
    # The order of a document's items is the order of their positions, so no
    # two items share one (engine §9).
    positions: set[tuple[int, int]] = set()
    for item in [*dom["rules"], *dom["directives"], *dom["constants"], *dom["classifiers"], *dom["implications"]]:
        at = (item["at"][0], item["at"][1])
        if at in positions:
            return "two items at one position"
        positions.add(at)
    return None


def _walk(pending: list[tuple[str, Any, int, int]], unicode: Lowercase, tests: list[dict[str, Any]]) -> str | None:
    """Check the nodes of expressions, emissions, conditions and terms, each
    entry a node, its kind, its depth, and a mark. For a term or a
    condition, the mark says whether it lies in a rule's or an alternative's
    tag term, which may not read the tags it defines; for an expression, it
    holds the flags _WHOLE_EXPR and _SEALED. The tested symbols go into
    ``tests``, whose values the caller checks once the nesting is
    bounded."""
    items: Any
    args: Any
    while pending:
        kind, value, depth, own = pending.pop()
        if depth > MAX_DEPTH:
            return TOO_DEEP
        if not isinstance(value, dict):
            return f"a malformed {'expression' if kind == 'expr' else kind}"
        below = depth + 1
        if kind == "expr":
            # An expression has exactly the members of one form
            # (docs/output.md). A place inside braces or an elidable
            # optional holds no capture, at any depth (engine §3.5).
            sealed = own & _SEALED
            if not _has_one_form(value, _EXPRESSION_FORMS):
                return "ranked-choice-syntax: A ranked expression has only its ranked array." if "ranked" in value else "a malformed expression"
            if "range" in value or "property" in value:
                if not _is_character_class(value, unicode):
                    return "a malformed expression"
            elif "choice" in value or "ranked" in value or "seq" in value:
                items = value.get("choice", value.get("ranked", value.get("seq")))
                if not _items(items, 2):
                    return "ranked-choice-syntax: A ranked expression requires at least two operands." if "ranked" in value else "a malformed expression"
                pending.extend(("expr", item, below, sealed) for item in items)
            elif "and" in value:
                if not _items(value["and"], 2, 16):
                    return "a malformed expression"
                pending.extend(("expr", item, below, sealed) for item in value["and"])
            elif "repeat" in value:
                # A chain is the whole expression of its alternative (engine
                # §9), and its direction is left or right. A separator
                # counts on from the depth of its repeat, as the item does.
                if "chain" in value and (not own & _WHOLE_EXPR or not _is_one_of(value["chain"], {"left", "right"})):
                    return "a malformed expression"
                pending.append(("expr", value["repeat"], below, _SEALED))
                if "separator" in value:
                    pending.append(("expr", value["separator"], below, _SEALED))
            elif "optional" in value:
                # An elidable optional is marked true, and maximal only with
                # it; its expression begins with its terminal (engine §3.8,
                # §9). The member is the boolean True itself: 1 equals True
                # in Python, but it is no boolean.
                if ("elidable" in value and value["elidable"] is not True) or (
                    "maximal" in value and (value["maximal"] is not True or "elidable" not in value)
                ):
                    return "a malformed expression"
                elidable = value.get("elidable") is True
                if elidable and elidable_head(value["optional"]) is None:
                    return "a malformed elidable optional"
                pending.append(("expr", value["optional"], below, _SEALED if elidable else sealed))
            elif "capture" in value:
                # A capture wraps one symbol: a reference, a terminal, a
                # range, a property or a tested one of these, and stands
                # anywhere but in braces or an elidable optional (engine
                # §3.5, §9).
                if sealed:
                    return "a capture inside braces or an elidable optional"
                inner = value.get("expr")
                if (
                    not isinstance(value["capture"], str)
                    or not CAPTURE_NAME.fullmatch(value["capture"])
                    or not isinstance(inner, dict)
                    or not any(member in inner for member in ("ref", "terminal", "range", "property", "test"))
                ):
                    return "a malformed capture"
                # A capture is a compound node, and its symbol below it is
                # checked as any expression is.
                pending.append(("expr", inner, below, 0))
            elif "test" in value:
                # A compound node (engine §9) over one symbol; its value
                # counts on from its depth, and is checked once the nesting
                # is bounded.
                if not _is_one_of(value["test"], set(TEST_OPS)):
                    return "a malformed test"
                if not _is_testable(value["expr"], unicode):
                    return "a test follows only a reference other than # or a terminal"
                pending.append(("expr", value["expr"], below, 0))
                pending.append(("term", value["value"], below, False))
                tests.append(value)
            elif not (_is_ref(value.get("ref")) or is_tag(value.get("terminal"), unicode) or value.get("empty") is True):
                return "a malformed expression"
        elif kind == "emission":
            # No member but items, and no items for ε (engine §9). Each item
            # has only the keys capture, insert, tags, before and after.
            # Attachments stand only on a named capture, each a non-empty
            # list of capture names. $ goes only with $, and a capture other
            # than $ is listed once. An inserted tag has no tags, and no
            # item has ∅ as its tags.
            items = value.get("items")
            if not _items(items, 0) or len(value) != 1:
                return "a malformed emission"
            kinds: list[str | None] = []
            for item in items:
                if not isinstance(item, dict):
                    kinds.append(None)
                elif isinstance(item.get("insert"), str):
                    # An inserted item is one tag (engine §9).
                    kinds.append("insert" if item.keys() == {"insert"} and is_tag(item["insert"], unicode) else None)
                elif isinstance(item.get("capture"), str):
                    if not item.keys() <= {"capture", "tags", "before", "after"}:
                        kinds.append(None)
                    elif item["capture"] == _WHOLE:
                        kinds.append("whole" if item.keys() <= {"capture", "tags"} else None)
                    elif not all(_is_attachment_list(item[side]) for side in ("before", "after") if side in item):
                        kinds.append(None)
                    else:
                        kinds.append("capture")
                else:
                    kinds.append(None)
            if None in kinds:
                return "a malformed emission"
            if "whole" in kinds and any(k != "whole" for k in kinds):
                return "a malformed emission"
            # A capture stands once, as an item or as an attachment.
            captures = [
                name
                for item, k in zip(items, kinds)
                if k == "capture"
                for name in (*item.get("before", ()), item["capture"], *item.get("after", ()))
            ]
            if len(set(captures)) != len(captures):
                return "a malformed emission"
            for item in items:
                if "tags" not in item:
                    continue
                if isinstance(item["tags"], dict) and item["tags"].get("emptySet") is True:
                    return "∅ as an emitted item's tags"
                # An emission is no node of a term: its tags start at the top.
                pending.append(("term", item["tags"], depth, False))
        elif kind == "condition":
            # A condition has exactly the members of one form
            # (docs/output.md). The condition of a guarded term in a tag
            # term cannot read the tags the term defines either.
            if not _has_one_form(value, _CONDITION_FORMS):
                return "a malformed condition"
            if "any" in value or "all" in value:
                items = value["any"] if "any" in value else value["all"]
                if not _items(items, 2):
                    return "a malformed condition"
                pending.extend(("condition", item, below, own) for item in items)
            elif "not" in value:
                pending.append(("condition", value["not"], below, own))
            elif "if" in value:
                if "then" not in value:
                    return "a malformed condition"
                pending.append(("condition", value["if"], below, own))
                pending.append(("condition", value["then"], below, own))
            elif "captured" in value:
                if not isinstance(value["captured"], str):
                    return "a malformed condition"
            elif "matches" in value or "begins" in value:
                span = value["matches"] if "matches" in value else value["begins"]
                if not isinstance(value.get("rule"), str) or not _is_span(span) or ("matches" in value and "begins" in value):
                    return "a malformed condition"
                pending.append(("argument", span, below, own))
            elif "initial" in value:
                if len(value) != 1 or not _is_span(value["initial"]):
                    return "a malformed condition"
                pending.append(("argument", value["initial"], below, own))
            else:
                if not _is_one_of(value.get("op"), _COMPARATORS):
                    return "a malformed condition"
                tree = value.get("op") in ("≅", "≇")
                if tree and (not isinstance(value.get("left"), dict) or set(value["left"]) != {"capture"}):
                    return "a tree comparison requires a bare capture"
                pending.append(("argument" if tree else "term", value.get("left"), below, own))
                pending.append(("term", value.get("right"), below, own))
        else:
            # A term; an argument is a term where a span may stand.
            if not _has_one_form(value, _TERM_FORMS):
                return "a malformed term"
            if own and reads_own_tags(value, kind == "argument"):
                return "a tag term that reads the tags it defines"
            if "pattern" in value:
                problem = pattern_problem(value["pattern"], initial_depth=below)
                if problem is not None:
                    return problem
                for node, offset in walk_pattern(value["pattern"]):
                    if "test" in node:
                        if open_part(node["value"]) is not None:
                            return "a pattern test requires a closed operand"
                        tests.append(node)
                        pending.append(("term", node["value"], below + offset + 1, False))
            elif "union" in value or "intersection" in value or "difference" in value:
                key = "union" if "union" in value else "intersection" if "intersection" in value else "difference"
                items = value[key]
                if not _items(items, 2, 2 if key == "difference" else float("inf")):
                    return "a malformed term"
                pending.extend(("term", item, below, own) for item in items)
            elif "if" in value:
                # A guarded term: its condition, and the tag set it guards.
                if kind == "argument" or "then" not in value:
                    return "a malformed term"
                pending.append(("condition", value["if"], below, own))
                pending.append(("term", value["then"], below, own))
            elif "call" in value:
                # The reader's signatures (engine §9), with a span where one is due.
                args = value.get("args") if isinstance(value.get("args"), list) else []
                call = value["call"]
                if not _is_one_of(call, _FUNCTIONS) or call in ("matches", "begins", "initial"):
                    ok = False
                elif call == "tags":
                    ok = (len(args) == 1 and _is_span(args[0])) or (
                        len(args) == 2 and _is_span(args[0]) and _is_rule_name(args[1])
                    )
                elif call == "split":
                    # Its arguments' types are checked with the rule's types.
                    ok = len(args) == 2 and all(
                        not _is_rule_name(arg) and not _is_classifier_name(arg) and not _is_span(arg) for arg in args
                    )
                elif call == "tag":
                    ok = (
                        len(args) == 1
                        and not _is_rule_name(args[0])
                        and not _is_classifier_name(args[0])
                        and not _is_span(args[0])
                    )
                elif call == "classify":
                    # A string's term, and a classifier's name (engine §9).
                    ok = (
                        len(args) == 2
                        and not _is_rule_name(args[0])
                        and not _is_classifier_name(args[0])
                        and not _is_span(args[0])
                        and _is_classifier_name(args[1])
                    )
                else:
                    ok = len(args) == 1 and _is_span(args[0])
                if not ok or (kind != "argument" and call in _SPANS):
                    return "a malformed term"
                seen = literal_call_problem(call, args)
                if seen is not None:
                    return seen
                pending.extend(
                    ("argument", arg, below, own) for arg in args if not _is_rule_name(arg) and not _is_classifier_name(arg)
                )
            elif not (
                isinstance(value.get("string"), str)
                or is_tag(value.get("tag"), unicode)
                or value.get("emptySet") is True
                or isinstance(value.get("capture"), str)
                or ("range" in value and range_problem(value["range"], unicode) is None)
                or (
                    isinstance(value.get("const"), str)
                    and CONSTANT_NAME.fullmatch(value["const"]) is not None
                    and _is_position(value.get("at"))
                )
            ):
                return "a malformed term"
    return None


def elidable_head(expr: Any) -> Any:
    """The terminal at the head of an elidable optional's expression, or
    None when the expression has no such head (engine §3.8, §9): a ``ref``
    whose name begins with a capital, a ``terminal`` whose tag is a name, or
    an ``=`` test of one of these, alone or first in a ``seq``."""
    head = expr["seq"][0] if isinstance(expr, dict) and isinstance(expr.get("seq"), list) and expr["seq"] else expr
    if not isinstance(head, dict):
        return None

    def is_terminal(node: Any) -> bool:
        return (
            isinstance(node, dict)
            and len(node) == 1
            and (
                (isinstance(node.get("ref"), str) and _TERMINAL_NAME.fullmatch(node["ref"]) is not None)
                or (isinstance(node.get("terminal"), str) and _NAME.fullmatch(node["terminal"]) is not None)
            )
        )

    if is_terminal(head):
        return head
    if head.get("test") in ("=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅") and is_terminal(head.get("expr")):
        return head
    return None


def _is_attachment_list(value: Any) -> bool:
    """Whether an item's ``before`` or ``after`` is a list of capture names
    that is not empty (docs/output.md)."""
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(name, str) and CAPTURE_NAME.fullmatch(name) is not None for name in value)
    )


def literal_call_problem(call: str, args: list[Any]) -> str | None:
    """What is wrong with a call of split or tag whose argument the reader
    sees as a string literal (engine §9, §10), or None: an empty delimiter,
    or a tag's string that is not a name."""

    def literal(arg: Any) -> str | None:
        return arg["string"] if isinstance(arg, dict) and isinstance(arg.get("string"), str) else None

    if call == "split" and len(args) > 1 and literal(args[1]) == "":
        return "split has an empty delimiter"
    if call == "tag" and args:
        name = literal(args[0])
        if name is not None and not _NAME.fullmatch(name):
            return f"tag({json.dumps(name, ensure_ascii=False)}): the string is not a name"
    return None
