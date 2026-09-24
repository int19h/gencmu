"""Loading dialects (docs/api.md), reading grammar documents through the
notation (engine §8), and running the pipeline (engine §13)."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from importlib import resources
from typing import Any, Callable, Iterable, Mapping, Sequence

from ._dom import DomBuilder
from ._errors import GencmuError
from ._grammar import Grammar, Lowered, lower, stitch
from ._hash import fnv1a64
from ._markdown import Pipeline, ebnf_text, read_pipeline
from ._model import ParseError, ParseResult, Stage, Token
from ._stage import StageOutcome, StageRunner, span_phonemes
from ._unicode import UnicodeTable

DOM_FORMAT = 1

Dom = dict[str, Any]


# ---------------------------------------------------------------------------
# The bundled grammars


def _bundled_root() -> Any:
    return resources.files("gencmu").joinpath("grammars")


_bundled: dict[str, str | None] = {}


def bundled_text(path: str) -> str | None:
    """A file of the bundled grammars, by its ``/``-separated path."""
    if path in _bundled:
        return _bundled[path]
    text = _read_bundled(path)
    _bundled[path] = text
    return text


def _read_bundled(path: str) -> str | None:
    node = _bundled_root()
    for part in path.split("/"):
        if part in ("", ".", ".."):
            return None
        node = node.joinpath(part)
    try:
        return node.read_text(encoding="utf-8")  # type: ignore[no-any-return]
    except (FileNotFoundError, IsADirectoryError, NotADirectoryError, OSError):
        return None


_lock = threading.Lock()
# Keyed by the texts themselves: a string caches its own hash, so a text
# read once is found again at no cost.
_unicode_tables: dict[str, UnicodeTable] = {}
_readers: dict[tuple[str, str], NotationReader] = {}
_compiled_indexes: dict[tuple[str, str], dict[str, Dom]] = {}
_dom_cache: dict[tuple[str, str, int], Dom] = {}


def _unicode_table(text: str) -> UnicodeTable:
    with _lock:
        table = _unicode_tables.get(text)
    if table is None:
        table = UnicodeTable(text)
        with _lock:
            _unicode_tables[text] = table
    return table


def character_tokens(text: str, unicode: UnicodeTable) -> list[Token]:
    """The input of a pipeline's first stage: one token per code point (engine §1)."""
    return [
        Token(char, {char: True, unicode.character_class(char): False}, (index, index + 1), (index, index + 1))
        for index, char in enumerate(text)
    ]


# ---------------------------------------------------------------------------
# Reading grammar documents


class NotationReader:
    """Reads grammar documents with the notation dialect's bootstrap DOM."""

    def __init__(self, bootstrap: str, unicode: UnicodeTable) -> None:
        self.hash = fnv1a64(bootstrap)
        self.unicode = unicode
        try:
            data = json.loads(bootstrap)
            stages = [
                stitch(stage["name"], [(document["path"], document["dom"]) for document in stage["documents"]])
                for stage in data["stages"]
            ]
        except (ValueError, KeyError, TypeError) as error:
            raise GencmuError(f"the bootstrap cannot be read: {error}", document="notation/bootstrap.json") from error
        if data.get("format") != DOM_FORMAT:
            raise GencmuError("the bootstrap's DOM format is not 1", document="notation/bootstrap.json")
        self.stages = [(grammar.stage, lower(grammar, frozenset())) for grammar in stages]

    def read(self, text: str, path: str) -> Dom:
        """The DOM of a grammar document (engine §8, §9)."""
        try:
            grammar_text = ebnf_text(text)
        except GencmuError as error:
            error.document = path
            raise
        tokens = character_tokens(grammar_text.text, self.unicode)
        tree = None
        for number, (name, lowered) in enumerate(self.stages):
            last = number == len(self.stages) - 1
            runner = StageRunner(name, lowered, lambda: lowered, tokens, grammar_text.text, self.unicode, emit=not last)
            outcome = runner.run(False)
            if outcome.error is not None:
                source = outcome.error.source
                index = source[0] if source is not None else len(grammar_text.text)
                line, column = grammar_text.position(index)
                message = outcome.error.message
                if outcome.error.kind == "rejected":
                    shown = tokens[outcome.error.token].text if outcome.error.token is not None and outcome.error.token < len(tokens) else None
                    message = f"the notation cannot continue here{f' at {shown!r}' if shown else ''} (stage {name})"
                raise GencmuError(message, document=path, line=line, column=column)
            if last:
                tree = outcome.tree
            else:
                assert outcome.output is not None
                tokens = outcome.output
        assert tree is not None
        return DomBuilder(tokens, grammar_text, path).document_dom(tree)


def _reader(bootstrap: str, unicode_text: str) -> NotationReader:
    key = (bootstrap, unicode_text)
    with _lock:
        reader = _readers.get(key)
    if reader is None:
        reader = NotationReader(bootstrap, _unicode_table(unicode_text))
        with _lock:
            _readers[key] = reader
    return reader


def _compiled_index(compiled: str | None, bootstrap_hash: str) -> dict[str, Dom]:
    """The precompiled DOMs usable with this bootstrap, by text hash."""
    if not compiled:
        return {}
    key = (compiled, bootstrap_hash)
    with _lock:
        found = _compiled_indexes.get(key)
    if found is not None:
        return found
    index: dict[str, Dom] = {}
    try:
        data = json.loads(compiled)
        if data.get("format") == DOM_FORMAT and data.get("bootstrap") == bootstrap_hash:
            for entry in data.get("documents", {}).values():
                if entry.get("dom", {}).get("format") == DOM_FORMAT:
                    index[entry["hash"]] = entry["dom"]
    except (ValueError, AttributeError, KeyError, TypeError):
        index = {}
    with _lock:
        _compiled_indexes[key] = index
    return index


# ---------------------------------------------------------------------------
# Dialects


@dataclass
class _Resources:
    unicode: str
    bootstrap: str
    compiled: str | None


class _Loader:
    def __init__(self, lookup: Callable[[str], str | None], found: _Resources, use_cache: bool = True) -> None:
        self.lookup = lookup
        self.resources = found
        self.use_cache = use_cache
        self.unicode = _unicode_table(found.unicode)
        self.reader = _reader(found.bootstrap, found.unicode)
        self.compiled = _compiled_index(found.compiled, self.reader.hash) if use_cache else {}

    def text(self, path: str) -> str:
        text = self.lookup(path)
        if text is None:
            raise GencmuError(f"the document {path} is missing", document=path)
        return text

    def dom(self, path: str) -> Dom:
        text = self.text(path)
        text_hash = fnv1a64(text)
        key = (text_hash, self.reader.hash, DOM_FORMAT)
        if self.use_cache:
            found = self.compiled.get(text_hash)
            if found is not None:
                return found
            with _lock:
                found = _dom_cache.get(key)
            if found is not None:
                return found
        dom = self.reader.read(text, path)
        with _lock:
            _dom_cache[key] = dom
        return dom

    def load(self, pipeline_path: str) -> Dialect:
        pipeline = read_pipeline(self.text(pipeline_path), pipeline_path)
        stages: list[Grammar] = []
        for stage in pipeline.stages:
            documents = [(path, self.dom(path)) for path in stage.documents]
            try:
                stages.append(stitch(stage.name, documents))
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
    if unicode is None or bootstrap is None:
        raise GencmuError("the bundled grammars are missing unicode.txt or notation/bootstrap.json")
    return _Resources(unicode, bootstrap, get("compiled.json"))


def load_dialect(name: str, *, use_cache: bool = True) -> Dialect:
    """A dialect of the bundled grammars, by the name of its pipeline document
    under ``grammars/dialects/`` without ``.md``."""
    path = f"dialects/{name}.md"
    if "/" in name or bundled_text(path) is None:
        raise GencmuError(f"there is no bundled dialect {name}", kind="grammar", document=path)
    return _Loader(bundled_text, _resources(), use_cache).load(path)


def load_dialect_file(path: str | os.PathLike[str], *, use_cache: bool = True) -> Dialect:
    """A dialect from a pipeline document on disk; its documents are found
    relative to it, and the Unicode table and the bootstrap come from the
    bundled grammars."""
    pipeline = os.fspath(path)
    root = os.path.dirname(os.path.abspath(pipeline))

    def lookup(relative: str) -> str | None:
        try:
            with open(os.path.join(root, *relative.split("/")), encoding="utf-8", newline="") as file:
                return file.read()
        except OSError:
            return None

    return _Loader(lookup, _resources(), use_cache).load(os.path.basename(pipeline))


def load_dialect_sources(sources: Mapping[str, str], pipeline: str, *, use_cache: bool = True) -> Dialect:
    """A dialect from documents held in memory: a mapping from ``/``-separated
    path to text, and the path of the pipeline document in it. The mapping
    may hold its own ``unicode.txt``, ``notation/bootstrap.json`` and
    ``compiled.json``; any it lacks come from the bundled grammars."""
    documents = dict(sources)
    return _Loader(documents.get, _resources(documents), use_cache).load(pipeline)


class Dialect:
    """A loaded dialect: a pipeline of stages, each a stitched grammar. A
    dialect may be used for any number of parses, and shared between
    threads."""

    def __init__(self, path: str, pipeline: Pipeline, stages: list[Grammar], unicode: UnicodeTable) -> None:
        self.path = path
        self.features = pipeline.features
        self.grammars = stages
        self.unicode = unicode
        self._lowered: dict[tuple[int, frozenset[str], bool], Lowered] = {}
        self._lock = threading.Lock()
        for number in range(len(stages)):
            self.lowered(number, self.features, False)

    @property
    def stage_names(self) -> list[str]:
        return [grammar.stage for grammar in self.grammars]

    def lowered(self, number: int, features: frozenset[str], elision: bool) -> Lowered:
        key = (number, features, elision)
        with self._lock:
            found = self._lowered.get(key)
        if found is None:
            found = lower(self.grammars[number], features, elision)
            with self._lock:
                self._lowered[key] = found
        return found

    def parse(
        self,
        text: str,
        *,
        features: Iterable[str] = (),
        auto_features: bool = True,
        until: str | None = None,
        elision_only: bool | None = None,
    ) -> ParseResult:
        """Parse a text. A text that does not parse is a result whose ``ok`` is
        false; a mistake in the call, such as an unknown stage name, raises
        :class:`GencmuError`."""
        return self.parse_tokens(
            character_tokens(text, self.unicode),
            text,
            features=features,
            auto_features=auto_features,
            until=until,
            elision_only=elision_only,
        )

    def parse_tokens(
        self,
        tokens: Sequence[Token],
        text: str,
        *,
        features: Iterable[str] = (),
        auto_features: bool = True,
        until: str | None = None,
        elision_only: bool | None = None,
    ) -> ParseResult:
        """Parse pre-built tokens in place of the first stage's characters,
        over the original ``text`` their sources point into. For tests and
        tools; :meth:`parse` is the usual entry point."""
        if isinstance(features, str):
            raise GencmuError("features is a collection of names, not one string", kind="usage")
        names = self.stage_names
        if until is None:
            last = len(names) - 1
        elif until in names:
            last = names.index(until)
        else:
            raise GencmuError(f"the dialect has no stage {until}; its stages are {', '.join(names)}", kind="usage")
        enabled = frozenset(features) | self.features
        tokens = list(tokens)
        if auto_features and "sa-su" not in enabled and "words" in names and names.index("words") <= last:
            words = names.index("words")
            probe, outcomes = self._run(text, tokens, enabled, 0, words, elision_only, [])
            if not probe.ok or self._reads_sa_su(probe.stages[words], outcomes[words]):
                return self._run(text, tokens, enabled | {"sa-su"}, 0, last, elision_only, [])[0]
            if words == last:
                return probe
            following = probe.stages[words].output
            assert following is not None
            return self._run(text, following, enabled, words + 1, last, elision_only, probe.stages)[0]
        return self._run(text, tokens, enabled, 0, last, elision_only, [])[0]

    @staticmethod
    def _reads_sa_su(stage: Stage, outcome: StageOutcome) -> bool:
        tree = stage.tree
        if tree is None or outcome.erased is None:
            return False
        stack = [tree]
        while stack:
            node = stack.pop()
            if node.kind != "rule":
                continue
            if node.rule == "word" and span_phonemes(stage.input, outcome.erased, node.span[0], node.span[1]) in ("sa", "su"):
                return True
            stack.extend(node.children)
        return False

    def _run(
        self,
        text: str,
        tokens: list[Token],
        features: frozenset[str],
        first: int,
        last: int,
        elision_only: bool | None,
        before: list[Stage],
    ) -> tuple[ParseResult, list[StageOutcome]]:
        stages = list(before)
        outcomes: list[StageOutcome] = []
        current = tokens
        for number in range(first, last + 1):
            grammar = self.grammars[number]
            lowered = self.lowered(number, features, False)

            def elision_lowered(number: int = number) -> Lowered:
                return self.lowered(number, features, True)

            runner = StageRunner(grammar.stage, lowered, elision_lowered, current, text, self.unicode)
            check = grammar.elision_only if elision_only is None else elision_only
            outcome = runner.run(check)
            outcomes.append(outcome)
            stage = Stage(
                grammar.stage,
                outcome.verdict,
                current,
                outcome.output,
                outcome.witness,
                outcome.tied,
                outcome.tree,
            )
            stages.append(stage)
            if outcome.error is not None:
                return ParseResult(False, stages, None, outcome.error, text), [StageOutcome()] * first + outcomes
            assert outcome.output is not None
            current = outcome.output
        return ParseResult(True, stages, stages[-1].tree if stages else None, None, text), [StageOutcome()] * first + outcomes


def read_document(text: str, path: str = "document.md", *, sources: Mapping[str, str] | None = None) -> Dom:
    """The DOM of one grammar document, read through the notation with no
    cache: the reading the shared notation cases test (engine §8, §9)."""
    found = _resources(sources)
    return _reader(found.bootstrap, found.unicode).read(text, path)
