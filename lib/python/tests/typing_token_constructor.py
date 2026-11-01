"""Consumer fixture for the documented Token arguments."""

import gencmu


def construct_tokens() -> tuple[gencmu.Token, gencmu.Token]:
    defaults = gencmu.Token(
        text="A", value=None, image=None, tags=frozenset({"_General_Category_Uppercase_Letter", "_General_Category_Letter"}), span=(0, 1), source=(0, 1)
    )
    api_example = gencmu.Token(
        text="A", value="a", image="A", tags={"_General_Category_Uppercase_Letter", "_General_Category_Letter"}, span=(0, 1), source=(0, 1)
    )
    return defaults, api_example
