"""The tests of the gencmu package. They run from a checkout with
``python -m unittest`` in ``python/``, against the package in ``src/``
unless an installed one is asked for with GENCMU_INSTALLED=1."""

from __future__ import annotations

import os
import sys
from pathlib import Path

if not os.environ.get("GENCMU_INSTALLED"):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
