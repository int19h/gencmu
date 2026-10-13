"""Initialize optional corpus reports before pytest starts its workers."""

import os
from pathlib import Path


def pytest_sessionstart(session):
    if not hasattr(session.config, "workerinput"):
        if report := os.environ.get("GENCMU_CORPUS_REPORT"):
            Path(report).write_text("", encoding="utf-8")
