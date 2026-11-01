"""Claim uncovered source text for selected string recipes."""
from ._errors import _GrammarFault


class GapClaims:
    def __init__(self, context):
        self.context = context
        self.tokens = context.tokens
        self.claims = {}
        self.coverage = []
        for start, end in sorted(token.source for token in self.tokens if token.source[0] < token.source[1]):
            if self.coverage and start <= self.coverage[-1][1]:
                self.coverage[-1] = (self.coverage[-1][0], max(end, self.coverage[-1][1]))
            else:
                self.coverage.append((start, end))


    def string(self, start_token, end_token) -> str:
        span = start_token, end_token
        if start_token == end_token:
            return ""
        left = min(token.source[0] for token in self.tokens[start_token:end_token])
        right = max(token.source[1] for token in self.tokens[start_token:end_token])
        before = self.tokens[start_token - 1].source[1] if start_token else 0
        after = self.tokens[end_token].source[0] if end_token < len(self.tokens) else len(self.context.text)
        start, end = left, right
        if before < left:
            start = before
            for a, b in self.coverage:
                if a >= left:
                    break
                if b > start:
                    start = min(left, b)
        if right < after:
            end = after
            for a, b in self.coverage:
                if b <= right:
                    continue
                end = max(right, min(end, a))
                break
        extensions = [(start, left)] if start < left else []
        if right < end:
            extensions.append((right, end))
        if span not in self.claims:
            for other in self.claims.values():
                if any(max(a, c) < min(b, d) for a, b in extensions for c, d in other):
                    raise _GrammarFault("verbatim recipes claim the same uncovered text from different spans")
            self.claims[span] = extensions
        return self.context.text[start:end]

