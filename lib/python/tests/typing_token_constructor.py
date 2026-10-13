"""Consumer typing fixture for the documented Token arguments."""

from typing import assert_type

import gencmu


def construct_tokens() -> tuple[gencmu.Token, gencmu.Token]:
    defaults = gencmu.Token(
        text="A", value=None, image=None, tags=frozenset({"_Lu", "_L"}), span=(0, 1), source=(0, 1)
    )
    api_example = gencmu.Token(
        text="A", value="a", image="A", tags={"_Lu", "_L"}, span=(0, 1), source=(0, 1)
    )
    assert_type(defaults.value, str)
    assert_type(defaults.image, str)
    assert_type(api_example.value, str)
    assert_type(api_example.image, str)
    return defaults, api_example
