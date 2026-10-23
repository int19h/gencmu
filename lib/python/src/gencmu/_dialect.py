"""Loading dialects (docs/api.md), reading grammar documents through the
notation (engine §8), and running the pipeline (engine §13)."""

from __future__ import annotations

import json
from copy import deepcopy
import os
import re
import threading
from dataclasses import dataclass, replace
from importlib import resources
from typing import Any, Callable, Iterable, Mapping, Sequence

from ._dom import DomBuilder
from ._errors import ErrorData, GencmuError
from ._grammar import MAX_LOWERED, Grammar, Lowered, lower, stitch
from ._hash import fnv1a64
from ._markdown import jbogenbau_text
from ._model import Feature, Node, ParseError, ParseResult, ParseWarning, Stage, Token
from ._pipeline import Pipeline, splice_pipeline
from ._recent import Recent
from ._stage import StageOutcome, StageRunner
from ._tags import is_tag
from ._unicode import UnicodeTable
from ._validate import CLASSIFIER_NAME, FORMAT, MAX_DEPTH, TOO_DEEP, dom_problem
from ._names import NO_NAMES, NamesDom, NamesScope, selected_names, names_registry
from ._string_escapes import DocumentStrings

DOM_FORMAT = FORMAT

Dom = dict[str, Any]


# ---------------------------------------------------------------------------
# The bundled grammars


def _bundled_root() -> Any:
    return resources.files("gencmu").joinpath("grammars")


_bundled: dict[str, str | None] = {}


def bundled_text(path: str) -> str | None:
    """A file of the bundled grammars, by its ``/``-separated path."""
    if path == "unicode-names-reference.txt":
        path = "unicode-names.txt"
    if path in _bundled:
        return _bundled[path]
    text = _read_bundled(path)
    _bundled[path] = text
    return text


def _decode(data: bytes, document: str) -> str:
    """A file's bytes as strict UTF-8, which keeps a byte order mark as the
    character U+FEFF. Bytes that do not decode are a grammar error of the
    document, found before anything hashes it or looks it up in
    compiled.json (engine §1)."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise GencmuError(
            f"the document is not valid UTF-8: {error.reason} at byte {error.start}", document=document
        ) from None


def _bootstrap_error(error: GencmuError) -> GencmuError:
    embedded = error.document
    if embedded and embedded != "notation/bootstrap.json" and embedded not in error.message:
        error.message += f" (embedded document: {embedded})"
    error.document = "notation/bootstrap.json"
    location = error.where
    if not error.message.startswith(f"{location}: "):
        stage = f"stage {error.stage}: " if error.stage else ""
        error.message = f"{location}: {stage}{error.message}"
    error.args = (error.message,)
    return error


def _read_bundled(path: str) -> str | None:
    node = _bundled_root()
    for part in path.split("/"):
        if part in ("", ".", ".."):
            return None
        node = node.joinpath(part)
    try:
        data = node.read_bytes()
    except (FileNotFoundError, IsADirectoryError, NotADirectoryError, OSError):
        return None
    try:
        return _decode(data, path)
    except GencmuError as error:
        # compiled.json is only a cache, so bytes of it that do not decode
        # make it absent, a miss for every document. Anything else that
        # does not decode stays an error.
        if path == "compiled.json":
            return None
        if path == "notation/bootstrap.json":
            _bootstrap_error(error)
        raise


_lock = threading.Lock()
# The caches that loads share. They are keyed by the texts themselves: a
# string caches its own hash, so a text read once is found again at no
# cost. A process can load many dialects from texts that callers supply.
# So each cache keeps only a few entries, and only so many characters of
# the texts that key them. The least recently used goes first.
_MAX_TEXTS = 4
_MAX_TEXT_SIZE = 4_000_000
_unicode_tables: Recent[str, UnicodeTable] = Recent(_MAX_TEXTS, _MAX_TEXT_SIZE)
_readers: Recent[tuple[str, str], NotationReader] = Recent(_MAX_TEXTS, _MAX_TEXT_SIZE)
_compiled_indexes: Recent[tuple[str, str, str], dict[str, Dom]] = Recent(_MAX_TEXTS, _MAX_TEXT_SIZE)
# The DOMs that a reader read, each keyed by the hash of its document, and
# sized by the length of that document.
_MAX_DOMS = 256
_MAX_DOM_SIZE = 4_000_000


def _unicode_table(text: str) -> UnicodeTable:
    with _lock:
        table = _unicode_tables.get(text)
    if table is None:
        table = UnicodeTable(text)
        with _lock:
            _unicode_tables.put(text, table, len(text))
    return table


_SURROGATE = re.compile("[\ud800-\udfff]")


def scalar_problem(text: str) -> str | None:
    """Why a string is not a sequence of Unicode scalar values, or ``None``
    when it is one. A Python string can hold a lone surrogate, which engine
    §1 makes a usage error."""
    found = _SURROGATE.search(text)
    if found is None:
        return None
    return f"a lone surrogate U+{ord(found.group()):04X} at code point {found.start()}"


def character_tokens(text: str, unicode: UnicodeTable) -> list[Token]:
    """One token per decomposed scalar, with its original source (engine §1)."""
    problem = scalar_problem(text)
    if problem is not None:
        raise GencmuError(f"the text is not a sequence of Unicode scalar values: {problem}", kind="usage")
    tags: dict[str, frozenset[str]] = {}
    tokens: list[Token] = []
    for index, (char, origin) in enumerate(unicode.decompose_with_origins(text)):
        found = tags.get(char)
        if found is None:
            category = unicode.category(ord(char))
            assigned = {"_" + category, "_" + category[0]}
            for prop in ("Emoji_Presentation", "Emoji_Component"):
                if unicode.has_emoji(prop, ord(char)):
                    assigned.add("_" + prop)
            if unicode.is_white_space(ord(char)):
                assigned.add("_White_Space")
            found = tags[char] = frozenset(assigned)
        tokens.append(Token(text[origin], found, (index, index + 1), (origin, origin + 1), value=char, image=char))
    return tokens


# ---------------------------------------------------------------------------
# Reading grammar documents


class NotationReader:
    """Reads grammar documents with the notation dialect's bootstrap DOM."""

    def __init__(self, bootstrap: str, unicode: UnicodeTable) -> None:
        self.hash = fnv1a64(bootstrap)
        self.unicode = unicode
        # Each DOM uses the document hash, bootstrap hash, table fingerprint
        # and DOM format. The module's lock guards it.
        self.doms: Recent[tuple[str, str, str, int], Dom] = Recent(_MAX_DOMS, _MAX_DOM_SIZE)
        try:
            self.stages = self._bootstrap_stages(bootstrap, unicode)
        except GencmuError as error:
            _bootstrap_error(error)
            raise

    def _bootstrap_stages(self, bootstrap: str, unicode: UnicodeTable) -> list[tuple[str, Lowered]]:
        where = "notation/bootstrap.json"
        try:
            data = json.loads(bootstrap)
        except (ValueError, RecursionError) as error:
            # json.loads recurses, and a text nested deeper than the stack
            # allows is no bootstrap either.
            raise GencmuError(f"the bootstrap is not JSON: {error}", document=where) from error
        stages_data = data.get("stages") if isinstance(data, dict) else None
        if not isinstance(data, dict) or data.get("format") != DOM_FORMAT or not isinstance(stages_data, list) or not stages_data:
            raise GencmuError(f"the bootstrap is an object of format {DOM_FORMAT} with at least one stage", document=where)
        stages: list[Grammar] = []
        inputs: list[tuple[str, list[tuple[str, Dom]]]] = []
        names: set[str] = set()
        for stage in stages_data:
            documents = stage.get("documents") if isinstance(stage, dict) else None
            if not isinstance(stage, dict) or not isinstance(stage.get("name"), str) or CLASSIFIER_NAME.fullmatch(stage["name"]) is None or not isinstance(documents, list) or not documents:
                raise GencmuError("a stage of the bootstrap has a name and documents", document=where)
            if stage["name"] in names:
                raise GencmuError(f"a second stage named {stage['name']}", document=where)
            names.add(stage["name"])
            pairs: list[tuple[str, Dom]] = []
            for document in documents:
                if not isinstance(document, dict) or not isinstance(document.get("path"), str):
                    raise GencmuError("a document of the bootstrap has a path and a DOM", document=where)
                problem = dom_problem(document.get("dom"), unicode)
                if problem is not None:
                    raise GencmuError(f"the bootstrap's DOM of {document['path']} is malformed: {problem}", document=where, code="ranked-choice-syntax" if problem.startswith("ranked-choice-syntax:") else None)
                pairs.append((document["path"], document["dom"]))
            inputs.append((stage["name"], pairs))
        for name, pairs in inputs:
            if not any(dom["rules"] for _, dom in pairs):
                raise GencmuError(f"stage {name} has no rules", stage=name)
        for name, pairs in inputs:
            try:
                stages.append(stitch(name, pairs, unicode))
            except GencmuError as error:
                error.stage = name
                raise
        _dialect_features(where, stages, frozenset())
        lowered = []
        for grammar in stages:
            try:
                lowered.append((grammar.stage, lower(grammar, frozenset())))
            except GencmuError as error:
                error.stage = grammar.stage
                raise
        return lowered

    def located(self, dom, text, path, names=None):
        from ._ranked import has_ranked, restore_locations
        from ._boundary import atoms, Located
        found = atoms([rule for rule in dom['rules']])
        if any(not hasattr(arg, 'at') for atom in found for arg in atom['args']):
            fresh = self.read(text, path, True, names)
            originals = atoms(fresh['rules'])
            if len(found) == len(originals):
                for atom, original in zip(found, originals):
                    atom['args'] = [Located(arg, where.at) for arg, where in zip(atom['args'], original['args'])]
        if not has_ranked(dom) or all(hasattr(rule, 'ranked_locations') for rule in dom['rules']):
            return dom
        grammar_text = jbogenbau_text(text)
        tokens = character_tokens(grammar_text.text, self.unicode)
        name, lowered = self.stages[0]
        features = _notation_features(lowered.grammar, tokens, grammar_text.text, self.unicode, frozenset())
        if features:
            lowered = lower(lowered.grammar, features)
        outcome = StageRunner(name, lowered, tokens, grammar_text.text, self.unicode).run(lowered.grammar.elision_only)
        if outcome.error is None and outcome.output is not None:
            return restore_locations(dom, outcome.output, grammar_text.position)
        return dom

    def read(self, text: str, path: str, defer_emission: bool = False, names=None) -> Dom:
        """The DOM of a grammar document (engine §8, §9)."""
        try:
            grammar_text = jbogenbau_text(text)
        except GencmuError as error:
            error.document = path
            raise
        names = names if names is not None else NamesScope(bundled_text, self.unicode)
        strings = DocumentStrings(path, self.unicode, names, grammar_text.position)
        tokens = character_tokens(grammar_text.text, self.unicode)
        tree = None
        features = frozenset()
        for number, (name, lowered) in enumerate(self.stages):
            features = _notation_features(lowered.grammar, tokens, grammar_text.text, self.unicode, features)
            if features:
                lowered = lower(lowered.grammar, features)
            if name == 'syntax':
                for token in tokens:
                    if token.value == '%prefer':
                        line, column = grammar_text.position(token.source[0])
                        raise GencmuError('unknown directive %prefer; use an inline ranked choice (A ≻ B)', document=path, line=line, column=column)
            last = number == len(self.stages) - 1
            runner = StageRunner(name, lowered, tokens, grammar_text.text, self.unicode, emit=not last, features=features)
            # Each notation stage runs the check of elision-only where its
            # own directive declares it (engine §8).
            outcome = runner.run(lowered.grammar.elision_only)
            if outcome.error is not None and outcome.error.kind == "ambiguous":
                # A tie has no single position, so the error names the
                # document alone, never its start (engine §8).
                raise GencmuError(f"the grammar text is ambiguous: the {name} stage of the notation reads it in two ways", document=path)
            if outcome.error is not None:
                source = outcome.error.source
                index = source[0] if source is not None else len(grammar_text.text)
                if name == "lexical" and index > 0 and grammar_text.text[index - 1] == "@":
                    index -= 1
                line, column = grammar_text.position(index)
                message = outcome.error.message
                if outcome.error.kind == "rejected":
                    shown = tokens[outcome.error.token].text if outcome.error.token is not None and outcome.error.token < len(tokens) else None
                    message = f"the notation cannot continue here{f' at {shown!r}' if shown else ''} (stage {name})"
                if name == "lexical" and index < len(grammar_text.text) and grammar_text.text[index] == "@":
                    message = "a parameter requires @ followed directly by an ASCII letter"
                from ._ranked import syntax_failure
                code = 'ranked-choice-syntax' if name == 'syntax' and outcome.error.kind == 'rejected' and outcome.error.token is not None and syntax_failure(tokens, outcome.error.token) else None
                raise GencmuError(message, document=path, line=line, column=column, code=code)
            if last:
                tree = outcome.tree
            else:
                assert outcome.output is not None
                tokens = outcome.output
                if number == 0:
                    strings.inspect(tokens)
        assert tree is not None
        try:
            builder = DomBuilder(tokens, grammar_text, path, self.unicode, defer_emission, strings.decode)
            dom = builder.document_dom(tree)
            if builder.deferred_emissions:
                from ._dom import DeferredDom
                dom = DeferredDom(dom,builder.deferred_emissions)
        except GencmuError:
            raise
        except (LookupError, TypeError, ValueError, AttributeError, AssertionError) as error:
            # Only a bootstrap that is not the notation's gives such a tree.
            raise GencmuError(f"the notation's tree cannot be read as a grammar ({error!r}); is the bootstrap the notation's?", document=path) from error
        # A document read here is held to the rules of a precompiled DOM
        # (engine §9). A bootstrap that is not the notation's can give a DOM
        # that breaks them.
        problem = dom_problem(dom, self.unicode, defer_emission)
        if problem is None:
            return NamesDom(dom, names.dependencies) if names.dependencies is not None else dom
        # Each declaration alone, including feature directives and
        # classifiers, in the order of the document.
        items = (
            [("rules", rule) for rule in dom["rules"]]
            + [("directives", directive) for directive in dom["directives"]]
            + [("classifiers", classifier) for classifier in dom["classifiers"]]
            + [("constants", constant) for constant in dom["constants"]]
            + [("implications", implication) for implication in dom["implications"]]
        )
        items.sort(key=lambda item: (item[1]["at"][0], item[1]["at"][1]))
        empty = {"rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}
        alone = [(item["at"], dom_problem({**dom, **empty, key: [item]}, self.unicode)) for key, item in items]
        if problem == TOO_DEEP:
            # The bound on nesting, reported at the first item too deep, or
            # else at the start.
            line, column = next((at for at, found in alone if found == TOO_DEEP), (1, 1))
            raise GencmuError(
                f"an expression, term or condition is nested more than {MAX_DEPTH} deep",
                document=path,
                line=line,
                column=column,
            )
        # Any other problem, at the first item that has it alone, or else at
        # the document.
        found_at = next(((at, found) for at, found in alone if found is not None), None)
        if found_at is None:
            raise GencmuError(problem, document=path, code="ranked-choice-syntax" if problem.startswith("ranked-choice-syntax:") else None)
        (line, column), found = found_at
        raise GencmuError(found, document=path, line=line, column=column, code="ranked-choice-syntax" if found.startswith("ranked-choice-syntax:") else None)


def _reader(bootstrap: str, unicode_text: str) -> NotationReader:
    key = (bootstrap, unicode_text)
    with _lock:
        reader = _readers.get(key)
    if reader is None:
        reader = NotationReader(bootstrap, _unicode_table(unicode_text))
        with _lock:
            _readers.put(key, reader, len(bootstrap) + len(unicode_text))
    return reader


def _compiled_index(compiled: str | None, bootstrap_hash: str, unicode_text: str) -> dict[str, Dom]:
    """The precompiled DOMs usable with this bootstrap, by text hash.
    Their schema and exact string values follow engine §9."""
    if not compiled:
        return {}
    key = (compiled, bootstrap_hash, unicode_text)
    with _lock:
        found = _compiled_indexes.get(key)
    if found is not None:
        return found
    index: dict[str, Dom] = {}
    unicode = _unicode_table(unicode_text)
    try:
        data = json.loads(compiled)
        if data.get("format") == DOM_FORMAT and data.get("bootstrap") == bootstrap_hash and data.get("unicode") == unicode.fingerprint:
            for entry in data.get("documents", {}).values():
                # A malformed entry is a miss: its document is read afresh.
                if isinstance(entry, dict) and isinstance(entry.get("hash"), str) and dom_problem(entry.get("dom"), unicode) is None:
                    index[entry["hash"]] = NamesDom(entry["dom"], entry["names"]) if "names" in entry else entry["dom"]
    except (ValueError, AttributeError, KeyError, TypeError, RecursionError):
        # An unreadable compiled.json, one nested deeper than json.loads can
        # follow included, is no cache: every document is read afresh.
        index = {}
    with _lock:
        _compiled_indexes.put(key, index, len(compiled) + len(unicode_text))
    return index


# ---------------------------------------------------------------------------
# Dialects


@dataclass
class _Resources:
    unicode: str
    bootstrap: str
    compiled: str | None


class _Loader:
    def __init__(self, lookup: Callable[[str], str | None], found: _Resources, use_cache: bool = True, *, from_disk: bool = False, names_override=None) -> None:
        self.names_override = names_override if names_override is not None else lambda path: True
        self.bundled_names = None
        self.from_disk = from_disk
        self.inherited_names = {}
        self.lookup = lookup
        self.resources = found
        self.use_cache = use_cache
        self.unicode = _unicode_table(found.unicode)
        self.reader = _reader(found.bootstrap, found.unicode)
        self.compiled = _compiled_index(found.compiled, self.reader.hash, found.unicode) if use_cache else {}
        if use_cache and found.compiled:
            try:
                envelope = json.loads(found.compiled)
                if (envelope.get("format") == DOM_FORMAT and envelope.get("bootstrap") == self.reader.hash
                        and envelope.get("unicode") == self.unicode.fingerprint):
                    self.bundled_names = names_registry(envelope.get("bundledNames"))
            except (ValueError, AttributeError, TypeError, RecursionError):
                pass

    def text(self, path: str) -> str:
        text = self.lookup(path)
        if text is None:
            raise GencmuError(f"the document {path} is missing", document=path)
        return text

    def names_text(self, path: str) -> str | None:
        if self.from_disk and path == "unicode-names-reference.txt":
            return bundled_text(path)
        text = self.lookup(path)
        return text if text is not None else bundled_text(path)

    def dom(self, path: str, inherited=()) -> Dom:
        self.inherited_names[path] = list(inherited)
        text = self.text(path)
        # A document is a sequence of scalar values, as a text is (engine §1).
        problem = scalar_problem(text)
        if problem is not None:
            raise GencmuError(f"the document is not a sequence of Unicode scalar values: {problem}", kind="usage", document=path)
        text_hash = fnv1a64(text)
        # The reader keeps the DOMs it read. So the bootstrap and the Unicode
        # table are part of the key: a value test that one table accepts
        # another may refuse (engine §9).
        key = (text_hash, self.reader.hash, self.unicode.fingerprint, DOM_FORMAT)
        names = NamesScope(self.names_text, self.unicode, inherited)
        if self.use_cache:
            found = self.compiled.get(text_hash)
            if found is not None and NamesScope(self.names_text, self.unicode, selected_names(path, found, inherited)).matches(getattr(found, "names_dependencies", NO_NAMES), self.bundled_names, self.names_override):
                return found
            with _lock:
                found = self.reader.doms.get(key)
            if found is not None and NamesScope(self.names_text, self.unicode, selected_names(path, found, inherited)).matches(getattr(found, "names_dependencies", NO_NAMES), self.bundled_names, self.names_override):
                return found
        dom = self.reader.read(text, path, True, names)
        with _lock:
            self.reader.doms.put(key, dom, len(text))
        return dom

    def pipeline(self, pipeline_path: str, diagnostic_document: str | None = None) -> Pipeline:
        """The stages of the pipeline document at ``pipeline_path``, each a
        list of runs of one document's items, and the features the pipeline
        turns on (engine §13)."""
        def document(path, inherited=()):
            if self.lookup(path) is None:
                return None
            dom = self.dom(path, inherited) if inherited else self.dom(path)
            return self.reader.located(dom, self.text(path), path, NamesScope(self.names_text, self.unicode, inherited)) if path == diagnostic_document else dom
        return splice_pipeline(pipeline_path, document, document)

    def load(self, pipeline_path: str) -> Dialect:
        try:
            return self._load(pipeline_path)
        except GencmuError as error:
            boundary_document = getattr(error, "_boundary_document", None)
            if boundary_document is not None and error.line is None:
                # Read the exact document again only for a failed cache load.
                return self._load(pipeline_path, boundary_document)
            location = getattr(error, "_recipe_location", None)
            if location is not None:
                # A cached recipe has no source position in the DOM. Read
                # positions only; the failed cached grammar remains the
                # authority for this diagnostic.
                at, index, channel = location
                fresh = self.reader.read(self.text(error.document), error.document, True, NamesScope(self.names_text, self.unicode, self.inherited_names.get(error.document, ())))
                for rule in fresh["rules"]:
                    if tuple(rule["at"]) == at:
                        owner = rule if channel.startswith("rule_") else rule["alternatives"][index]
                        recipe = owner.get(channel.removeprefix("rule_"))
                        if hasattr(recipe, "at"):
                            error.line, error.column = recipe.at
                        break
                raise
            if not error.code or not error.code.startswith('ranked-choice-') or not error.group or 'at' in error.group or not error.group.get('document'):
                raise
            # Retry only a failed load, with locations for its diagnostic document.
            return self._load(pipeline_path, error.group['document'])

    def _load(self, pipeline_path: str, diagnostic_document: str | None = None) -> Dialect:
        pipeline = self.pipeline(pipeline_path, diagnostic_document)
        stages: list[Grammar] = []
        for stage in pipeline.stages:
            try:
                stages.append(stitch(stage.name, stage.documents, self.unicode))
            except GencmuError as error:
                if error.stage is None:
                    error.stage = stage.name
                raise
        return Dialect(pipeline_path, pipeline, stages, self.unicode)


def _resources(sources: Mapping[str, str] | None = None) -> _Resources:
    def get(path: str) -> str | None:
        if sources is not None and path in sources:
            return sources[path]
        return bundled_text(path)

    unicode = get("unicode.txt")
    bootstrap = get("notation/bootstrap.json")
    if unicode is None:
        raise GencmuError("the bundled unicode.txt is missing", document="unicode.txt")
    if bootstrap is None:
        raise _bootstrap_error(GencmuError("the bundled bootstrap is missing"))
    return _Resources(unicode, bootstrap, get("compiled.json"))


def load_dialect(name: str, *, use_cache: bool = True) -> Dialect:
    """A dialect of the bundled grammars, by the name of its pipeline document
    under ``grammars/dialects/`` without ``.md``."""
    path = f"dialects/{name}.md"
    if "/" in name or bundled_text(path) is None:
        raise GencmuError(f"there is no bundled dialect {name}", kind="grammar", document=path)
    return _Loader(bundled_text, _resources(), use_cache, names_override=lambda path: False).load(path)


def load_dialect_file(path: str | os.PathLike[str], *, use_cache: bool = True) -> Dialect:
    """A dialect from a pipeline document on disk; its documents are found
    relative to it, and the Unicode table and the bootstrap come from the
    bundled grammars. Each document is known by its absolute path, with
    ``/`` between the parts, so an error names the file wherever the
    process runs."""
    pipeline = os.path.abspath(os.fspath(path)).replace(os.sep, "/")

    def lookup(key: str) -> str | None:
        try:
            with open(key.replace("/", os.sep), "rb") as file:
                data = file.read()
        except OSError:
            return None
        return _decode(data, key)

    return _Loader(lookup, _resources(), use_cache, from_disk=True, names_override=lambda path: path != "unicode-names.txt").load(pipeline)


def load_dialect_sources(sources: Mapping[str, str], pipeline: str, *, use_cache: bool = True) -> Dialect:
    """A dialect from documents held in memory: a mapping from ``/``-separated
    path to text, and the path of the pipeline document in it. The mapping
    may hold its own ``unicode.txt``, ``notation/bootstrap.json`` and
    ``compiled.json``; any it lacks come from the bundled grammars."""
    documents = dict(sources)
    return _Loader(documents.get, _resources(documents), use_cache, names_override=documents.__contains__).load(pipeline)


def _dialect_features(path: str, grammars: list[Grammar], declared: frozenset[str]) -> tuple[Feature, ...]:
    """A dialect's features (engine §13): every name a guard of a stage's
    stitched rules or a gate of its classifiers' entries uses, and every
    name the pipeline's ``%features`` declares, in code point order. Each is
    a gate or a warning as its guards use it, and a gate if only declared; a
    name used both ways is an error of the dialect."""
    kinds: dict[str, str] = {}
    for grammar in grammars:
        guards = [(guard, alternative.document, alternative.at) for rule in grammar.rules.values() for alternative in rule.alternatives for guard in alternative.guards]
        for document, classifier in grammar.classifier_items:
            for entry in classifier["entries"]:
                guards.extend((guard, document, entry["at"]) for guard in entry["guards"])
        for guard, document, at in guards:
            name = guard["feature"]
            kind = "warning" if guard.get("kind") == "warning" else "gate"
            if kinds.setdefault(name, kind) != kind:
                raise GencmuError(f"{document}:{at[0]}:{at[1]}: the feature {name} is used both as a gate and as a warning", document=document, line=at[0], column=at[1], stage=grammar.stage)
    local = set()
    defaults = set(declared)
    tested = {}
    for grammar in grammars:
        for document, directive in grammar.feature_items:
            for name in directive["args"]:
                if name in tested:
                    raise GencmuError(f"stage {tested[name]} tests local feature {name}", document=document, line=directive["at"][0], column=directive["at"][1], stage=grammar.stage)
                local.add(name)
                if "conditions" not in directive:
                    defaults.add(name)
        for rule in grammar.rules.values():
            for alt in rule.alternatives:
                for guard in alt.guards:
                    tested.setdefault(guard["feature"], grammar.stage)
        for name in grammar.classifier_gates:
            tested.setdefault(name, grammar.stage)
    return tuple(Feature(name, kinds.get(name, "gate"), name in defaults) for name in sorted(kinds.keys() | declared | local))


class Dialect:
    """A loaded dialect: a pipeline of stages, each a stitched grammar, and
    its ``features``, each a :class:`Feature`. A dialect may be used for any
    number of parses, and shared between threads."""

    def __init__(self, path: str, pipeline: Pipeline, stages: list[Grammar], unicode: UnicodeTable) -> None:
        self.path = path
        # The features the pipeline turns on, and every feature with its kind.
        self.declared = pipeline.features
        self.features = _dialect_features(path, stages, pipeline.features)
        self.grammars = stages
        self.unicode = unicode
        # Each stage's lowered grammars, keyed by the gates that are on, or
        # the error that lowering found.
        self._lowered: list[Recent[frozenset[str], Lowered | ErrorData]] = [Recent(MAX_LOWERED) for _ in stages]
        self._lock = threading.Lock()
        for number in range(len(stages)):
            try:
                self.lowered(number, self.declared)
            except GencmuError:
                # An error lowering finds is a result of the parses that
                # meet it (engine §3, §13), not an error of the load.
                pass

    @property
    def stage_names(self) -> list[str]:
        return [grammar.stage for grammar in self.grammars]

    def _lowered_grammars(self) -> list[Lowered]:
        """Every lowered grammar the dialect holds, for the library's own
        tests."""
        with self._lock:
            return [found for cache in self._lowered for found in cache.values() if isinstance(found, Lowered)]

    def lowered(self, number: int, features: frozenset[str]) -> Lowered:
        # Only the gates that are on change the productions. So two sets of
        # features with the same gates on share one lowered grammar. The
        # check of elision-only reads the same one in a mode of its own
        # (engine §7.1).
        gates = features & self.grammars[number].gates
        key = gates
        with self._lock:
            found = self._lowered[number].get(key)
        if found is None:
            try:
                found = lower(self.grammars[number], gates)
            except GencmuError as error:
                found = ErrorData.of(error)
            with self._lock:
                self._lowered[number].put(key, found)
        if isinstance(found, ErrorData):
            raise found.error()
        return found

    def parse(
        self,
        text: str,
        *,
        features: Iterable[str] = (),
        without_features: Iterable[str] = (),
        until: str | None = None,
        elision_only: bool | None = None,
    ) -> ParseResult:
        """Parse a text, with ``features`` turned on and ``without_features``
        turned off, the pipeline's among them. A text that does not parse is
        a result whose ``ok`` is false; a mistake in the call, such as an
        unknown stage name or a feature named both to turn on and to turn
        off, raises :class:`GencmuError`."""
        problem = scalar_problem(text)
        if problem is not None:
            raise GencmuError(f"the text is not a sequence of Unicode scalar values: {problem}", kind="usage")
        return self.parse_tokens(
            character_tokens(text, self.unicode),
            text,
            features=features,
            without_features=without_features,
            until=until,
            elision_only=elision_only,
        )

    def parse_tokens(
        self,
        tokens: Sequence[Token],
        text: str,
        *,
        features: Iterable[str] = (),
        without_features: Iterable[str] = (),
        until: str | None = None,
        elision_only: bool | None = None,
    ) -> ParseResult:
        """Parse pre-built tokens in place of the first stage's characters,
        over the original ``text`` their sources point into. For tests and
        tools; :meth:`parse` is the usual entry point. A token with
        attachments is a usage error, and empty lists are dropped
        (docs/api.md)."""
        # A text is a sequence of scalar values, so a lone surrogate is the
        # caller's mistake, refused before any character token (engine §1).
        problem = scalar_problem(text)
        if problem is not None:
            raise GencmuError(f"the text is not a sequence of Unicode scalar values: {problem}", kind="usage")
        for option, value in (("features", features), ("without_features", without_features)):
            if isinstance(value, str):
                raise GencmuError(f"{option} is a collection of names, not one string", kind="usage")
        names = self.stage_names
        if until is None:
            last = len(names) - 1
        elif until in names:
            last = names.index(until)
        else:
            raise GencmuError(f"the dialect has no stage {until}; its stages are {', '.join(names)}", kind="usage")
        # The features on are the pipeline's, with the caller's added and the
        # caller's turned off removed (engine §13).
        on = frozenset(features)
        off = frozenset(without_features)
        if on & off:
            raise GencmuError(f"the feature {min(on & off)} is named both to turn on and to turn off", kind="usage")
        enabled = (self.declared | on) - off
        # A caller token stores value and image independently (engine
        # §5). It has no attachments: a list that is not empty is the
        # caller's mistake, and an empty one is dropped (docs/api.md). The
        # parse copies each token, so the caller's objects stay as they are.
        # The copy has its tags and positions in values that cannot change,
        # so the result shares nothing that the caller can change.
        def valid_range(value, limit=None):
            return (isinstance(value, (list, tuple)) and len(value) == 2 and all(type(n) is int for n in value)
                    and 0 <= value[0] <= value[1] and (limit is None or value[1] <= limit))

        for index, token in enumerate(tokens):
            if token.before or token.after:
                raise GencmuError(f"token {index} has attachments, which a caller cannot supply", kind="usage")
            for field in ("text", "value", "image"):
                value = getattr(token, field)
                if not isinstance(value, str) or scalar_problem(value) is not None:
                    raise GencmuError(f"token {index}: {field} requires a scalar string", kind="usage")
            if isinstance(token.tags, str) or not isinstance(token.tags, (list, tuple, set, frozenset)) or any(not is_tag(tag) for tag in token.tags):
                raise GencmuError(f"token {index}: invalid stored tags", kind="usage")
            if not valid_range(token.source, len(text)) or not valid_range(token.span):
                raise GencmuError(f"token {index}: invalid source or span", kind="usage")
        tokens = [
            replace(
                token,
                tags=frozenset(token.tags),
                span=None if token.span is None else (token.span[0], token.span[1]),
                source=(token.source[0], token.source[1]),
                before=[],
                after=[],
            )
            for token in tokens
        ]
        return self._run(text, tokens, enabled, off, last, elision_only)

    def _run(
        self,
        text: str,
        tokens: list[Token],
        features: frozenset[str],
        off: frozenset[str],
        last: int,
        elision_only: bool | None,
    ) -> ParseResult:
        """Run each selected stage once."""
        stages = []
        warnings: list[ParseWarning] = []
        current = tokens
        for number in range(last + 1):
            grammar = self.grammars[number]
            try:
                for _, directive in grammar.feature_items:
                    conditional = "conditions" in directive
                    if conditional and not _input_conditions_hold(directive["conditions"], current, text, self.unicode):
                        continue
                    for feature in directive["args"]:
                        if feature in off:
                            if conditional:
                                failure = ParseError("feature-conflict", f"the {grammar.stage} stage requires disabled feature {feature}", stage=grammar.stage, feature=feature)
                                stages.append(Stage(grammar.stage, None, current))
                                return ParseResult(False, stages, None, failure, text, warnings, features=sorted(features))
                        else:
                            features = features | {feature}
                lowered = self.lowered(number, features)
            except GencmuError as error:
                # An error of the grammar lowering finds for these features
                # is a result, with its stage and no position (engine §13).
                failure = ParseError("grammar", error.message, stage=grammar.stage)
                stages.append(Stage(grammar.stage, None, current))
                return ParseResult(False, stages, None, failure, text, warnings, features=sorted(features))

            runner = StageRunner(grammar.stage, lowered, current, text, self.unicode, features=features)
            check = grammar.elision_only if elision_only is None else elision_only
            outcome = runner.run(check)
            stage = Stage(
                grammar.stage,
                outcome.verdict,
                current,
                outcome.output,
                outcome.witness,
                outcome.tree,
            )
            stages.append(stage)
            warnings.extend(outcome.warnings)
            if outcome.error is not None:
                return ParseResult(False, stages, None, outcome.error, text, warnings, features=sorted(features))
            assert outcome.output is not None
            current = outcome.output
        return ParseResult(True, stages, stages[-1].tree if stages else None, None, text, warnings, features=sorted(features))


def read_document(text: str, path: str = "document.md", *, sources: Mapping[str, str] | None = None) -> Dom:
    """The DOM of one grammar document, read through the notation with no
    cache: the reading the shared notation cases test (engine §8, §9)."""
    found = _resources(sources)
    reader = _reader(found.bootstrap, found.unicode)
    def names_text(key):
        return sources[key] if sources is not None and key in sources else bundled_text(key)
    return reader.read(text, path, names=NamesScope(names_text, reader.unicode))


def _input_conditions_hold(conditions, tokens, text, unicode):
    from types import SimpleNamespace
    from ._earley import Evaluator, Sources
    from ._errors import _GrammarFault
    from ._trampoline import run
    sources = Sources(tokens)
    context = SimpleNamespace(
        tokens=tokens, unicode=unicode,
        nonempty_tokens=lambda: range(len(tokens) + 1),
        value=lambda index: tokens[index].value,
        span_text=lambda start, end: text[slice(*sources.of(start, end))] if start < end else "",
    )
    evaluator = Evaluator(context, 0, len(tokens))
    bound = SimpleNamespace(get=lambda name: (0, len(tokens), None))
    def present(node):
        if isinstance(node, list):
            return [present(item) for item in node]
        if isinstance(node, dict):
            if "captured" in node:
                return {"all": []}
            return {key: present(value) for key, value in node.items()}
        return node
    try:
        return all(run(evaluator.walk_condition(present(condition), bound)) for condition in conditions)
    except _GrammarFault as error:
        raise GencmuError(error.message) from error


def _notation_features(grammar, tokens, text, unicode, features):
    for _, directive in grammar.feature_items:
        if "conditions" not in directive or _input_conditions_hold(directive["conditions"], tokens, text, unicode):
            features = features | frozenset(directive["args"])
    return features
