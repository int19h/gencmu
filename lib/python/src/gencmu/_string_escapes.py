"""Source string escapes, before syntax recognition (engine §9.1)."""

import re

from ._errors import GencmuError
from ._markdown import resolve

_STATEMENTS = {"%names", "%rule", "%redefine-rule", "%extend-rule", "%stage", "%extend-stage", "%redefine-stage", "%include", "%features", "%ambiguity-resolution", "%const", "%redefine-const", "%classifier", "%implies"}


class DocumentStrings:
    def __init__(self, path, unicode, names, position):
        self.path, self.unicode, self.names, self.position = path, unicode, names, position
        self.names_paths = set()

    def inspect(self, tokens):
        def quoted(token):
            return "String" in token.tags or "Include-Path" in token.tags
        for index, token in enumerate(tokens[:-1]):
            if token.value == "%names" and quoted(tokens[index + 1]):
                self.names_paths.add(tokens[index + 1].source[0])
        index = 0
        extras = set(self.names.extras)
        while index < len(tokens) and tokens[index].value == "%names":
            end = index + 1
            while end < len(tokens) and tokens[end].value not in _STATEMENTS:
                end += 1
            if end != index + 2 or not quoted(tokens[index + 1]):
                line, column = self.position(tokens[index].source[0])
                raise GencmuError("%names takes one quoted path", document=self.path, line=line, column=column)
            extras.add(resolve(self.path, self.decode(tokens[index + 1], True)))
            index = end
        self.names.extras = sorted(extras)
        for token in tokens:
            if "String" in token.tags or "Include-Path" in token.tags:
                self.decode(token, "Include-Path" in token.tags)

    def decode(self, token, path=False):
        source = token.text
        result, literal = [], []

        def flush():
            text = "".join(literal)
            result.append(text if path else self.unicode.decompose(text))
            literal.clear()

        index = 1
        while index < len(source) - 1:
            character = source[index]
            if character != "‹":
                literal.append(character)
                index += 1
                continue
            flush()
            opening = index

            def fail():
                line, column = self.position(token.source[0] + opening)
                raise GencmuError("an invalid or unknown string escape", document=self.path, line=line, column=column)

            index += 1
            start = index
            while index < len(source) - 1 and source[index] != "›":
                if source[index] in ('"', "\n", "\r"):
                    fail()
                index += 1
            name = source[start:index]
            if index >= len(source) - 1 or source[index] != "›" or not name:
                fail()
            if name.startswith("U+"):
                if re.fullmatch(r"U\+[0-9A-Fa-f]{4,6}", name) is None:
                    fail()
                code = int(name[2:], 16)
                if code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
                    fail()
            else:
                code = self.names.lookup(name, token.source[0] in self.names_paths)
            if code is None:
                fail()
            result.append(chr(code))
            index += 1
        flush()
        return "".join(result)
