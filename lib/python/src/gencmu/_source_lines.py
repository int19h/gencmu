"""One shared line index for positions and excerpts (engine §12.1)."""

from . import _testing


class SourceLines:
    def __init__(self, text):
        self.text = text
        self.breaks = None

    def position(self, offset):
        if self.breaks is None:
            breaks = []
            for index, character in enumerate(self.text):
                _testing.count("text")
                if character == "\n" or character == "\r" and (index + 1 == len(self.text) or self.text[index + 1] != "\n"):
                    breaks.append(index)
            self.breaks = breaks
        low, high = 0, len(self.breaks)
        while low < high:
            _testing.count("text")
            middle = (low + high) // 2
            if self.breaks[middle] < offset:
                low = middle + 1
            else:
                high = middle
        start = self.breaks[low - 1] + 1 if low else 0
        return low + 1, offset - start + 1

    def excerpt(self, source):
        line, column = self.position(source[0])
        start = source[0] - column + 1
        end = start
        while end < len(self.text) and self.text[end] not in ("\r", "\n"):
            _testing.count("text")
            end += 1
        shown = self.text[start:end].replace("\t", " ")
        width = max(1, min(source[1], end) - source[0])
        gutter = str(line) + " | "
        return line, column, gutter + shown + "\n" + " " * (len(gutter) - 2) + "| " + " " * (column - 1) + "^" * width
