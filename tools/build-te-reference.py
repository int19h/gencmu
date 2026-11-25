#!/usr/bin/env python3
"""Verify the frozen tree emission reference and build its corpus runner."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile


RECORD = Path(__file__).with_name("te-reference.json")
BUILD = Path("/build/gencmu/te-reference")
GROUPS = {
    "bootstrap": ("data/preparsed/gencmu.json",),
    "unicode": ("data/unicode/",),
    "grammars": ("grammars/", "data/preparsed/"),
    "corpusFiles": ("tests/corpus/", "tests/core.txt"),
    "sharedFixtures": ("tests/",),
    "runnerSources": ("lib/js/", "lib/rust/", "lib/go/", "lib/python/", "tools/", "LICENSE"),
}
SNAPSHOT_PATHS = ("data", "grammars", "tests", "lib/js", "lib/rust", "lib/go", "lib/python", "tools", "LICENSE")
RUST_LINKER = "/usr/bin/cc"
RUST_ENVIRONMENT = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "CARGO_INCREMENTAL": "0"}
CORPUS_FIELDS = {
    "inputCorpus": ("id", "pipeline", "text"),
    "features": ("id", "pipeline", "features", "withoutFeatures"),
    "expectations": ("id", "pipeline", "expect", "verdict", "stage", "at", "error",
                     "errors", "ties", "words", "brackets", "warnings"),
}


def run(*command, **options):
    return subprocess.run(command, check=True, stdin=subprocess.DEVNULL, **options)


def git(root, *arguments):
    return run("git", "-C", root, *arguments, stdout=subprocess.PIPE).stdout


def json_line(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def hash_groups(root, paths):
    hashes = {name: hashlib.sha256() for name in (*GROUPS, *CORPUS_FIELDS)}
    counts = dict.fromkeys(hashes, 0)

    for name in paths:
        groups = [
            group for group, selectors in GROUPS.items()
            if any(name.startswith(s) if s.endswith("/") else name == s for s in selectors)
        ]
        if not groups:
            continue
        content = (root / name).read_bytes()
        entry = json_line([name, hashlib.sha256(content).hexdigest()])
        for group in groups:
            hashes[group].update(entry)
            counts[group] += 1
        if name.startswith("tests/corpus/") and name.endswith(".jsonl"):
            for line in content.split(b"\n"):
                if not line.strip(b" \t\r"):
                    continue
                record = json.loads(line)
                for group, fields in CORPUS_FIELDS.items():
                    projection = {field: record[field] for field in fields if field in record}
                    hashes[group].update(json_line([name, projection]))
                    counts[group] += 1

    return {
        name: {"count": counts[name], "sha256": digest.hexdigest()}
        for name, digest in hashes.items()
    }


def verify(root, paths, expected):
    actual = hash_groups(root, paths)
    if actual.keys() != expected.keys():
        raise ValueError("The reference record must list exactly the expected hash groups.")
    failures = [
        f"{name}: expected {expected[name]}, got {actual[name]}"
        for name in actual if actual[name] != expected[name]
    ]
    if failures:
        raise ValueError("Recorded inputs differ at " + str(root) + "\n" + "\n".join(failures))


def verify_snapshot(root, paths, expected):
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"The snapshot must be a directory: {root}")
    actual = set()
    for entry in root.rglob("*"):
        if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
            raise ValueError(f"Unsupported snapshot entry: {entry}")
        if entry.is_file():
            actual.add(entry.relative_to(root).as_posix())
    extra = sorted(actual - set(paths))
    missing = sorted(set(paths) - actual)
    if extra or missing:
        raise ValueError(f"Snapshot inventory differs at {root}\nExtra: {extra}\nMissing: {missing}")
    verify(root, paths, expected)


def snapshot(checkout, commit, paths, expected, build):
    destination = build / "source"
    if not destination.exists() and not destination.is_symlink():
        with tempfile.TemporaryDirectory(prefix="snapshot-", dir=build) as temporary:
            archive = Path(temporary) / "source.tar"
            unpacked = Path(temporary) / "source"
            git(checkout, "archive", "--format=tar", f"--output={archive}", commit, *SNAPSHOT_PATHS)
            with tarfile.open(archive) as source:
                source.extractall(unpacked, filter="data")
            verify_snapshot(unpacked, paths, expected)
            unpacked.rename(destination)
    else:
        verify_snapshot(destination, paths, expected)
    return destination


def executable_hash(path):
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError(f"The runner must be a regular executable: {path}")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def version(*command, **options):
    return run(*command, stdout=subprocess.PIPE, text=True, **options).stdout.strip()


def rust_arguments(target):
    return [
        "test", "--offline", "--target", target, "--profile", "test",
        "--test", "corpus", "--no-run", "--message-format=json",
        "--config", f'target.{target}.linker="{RUST_LINKER}"',
    ]


def rust_configuration(build, configuration):
    cargo = version("rustup", "which", "cargo")
    rustc = version("rustup", "which", "rustc")
    tools = {
        "cargo": (cargo, "-Vv"),
        "rustc": (rustc, "-Vv"),
        "cc": (RUST_LINKER, "--version"),
        "ld": ("/usr/bin/ld", "--version"),
    }
    env = dict(RUST_ENVIRONMENT, RUSTC=rustc)
    actual = {}
    for tool, command in tools.items():
        actual[tool] = version(*command, env=env, cwd=build)
        if actual[tool] != configuration["tools"].get(tool):
            raise ValueError(f"The active {tool} differs from the recorded build tool.")
    if actual.keys() != configuration["tools"].keys():
        raise ValueError("The record lists unexpected Rust build tools.")
    target = next(line.removeprefix("host: ") for line in actual["rustc"].splitlines() if line.startswith("host: "))
    for key, expected in {
        "target": target, "linker": RUST_LINKER, "environment": RUST_ENVIRONMENT,
        "cargoArguments": rust_arguments(target),
    }.items():
        if configuration[key] != expected:
            raise ValueError(f"The recorded Rust {key} differs from the active build configuration.")
    return cargo, env


def javascript_reference(source, configuration):
    package = source / "lib/js"
    bin_name = json.loads((package / "package.json").read_bytes())["bin"]["gencmu"]
    entrypoint = package / bin_name
    if entrypoint.relative_to(source).as_posix() != configuration["entrypoint"] or not entrypoint.is_file():
        raise ValueError("The recorded JavaScript entry point differs from the pinned package.")
    node_path = shutil.which("node")
    if node_path is None:
        raise ValueError("Node is required to use the frozen JavaScript CLI.")
    node = Path(node_path).resolve()
    if version(node, "--version") != configuration["nodeVersion"]:
        raise ValueError("The active Node version differs from the reference.")
    if executable_hash(node) != configuration["nodeSha256"]:
        raise ValueError("The active Node SHA-256 differs from the reference.")
    return entrypoint, node


def compile_runner(source, build, configuration, cargo, env):
    target = build / "target"
    if target.is_symlink():
        raise ValueError(f"The Cargo target directory is a symbolic link: {target}")
    lock = source / "lib/rust/Cargo.lock"
    try:
        with tempfile.TemporaryDirectory(prefix="cargo-home-", dir=build) as cargo_home:
            completed = run(
                cargo, *configuration["cargoArguments"],
                "--manifest-path", source / "lib/rust/Cargo.toml", "--target-dir", target,
                cwd=build, env=dict(env, CARGO_HOME=cargo_home),
                stdout=subprocess.PIPE, text=True,
            )
    finally:
        # Cargo writes this lockfile beside its manifest. The crate has no dependencies.
        lock.unlink(missing_ok=True)
    messages = [json.loads(line) for line in completed.stdout.splitlines()]
    for message in messages:
        if message["reason"] == "compiler-message":
            print(message["message"]["rendered"], end="")
    executables = [
        Path(message["executable"]) for message in messages
        if message["reason"] == "compiler-artifact" and message["target"]["name"] == "corpus"
        and message["executable"]
    ]
    if len(executables) != 1:
        raise ValueError("Cargo must produce one corpus runner.")
    return executables[0]


def verify_executable(path, expected):
    actual = executable_hash(path)
    if actual != expected:
        raise ValueError(f"Executable SHA-256 differs at {path}\nExpected {expected}, got {actual}")


def frozen_runner(source, build, configuration):
    cargo, env = rust_configuration(build, configuration)
    runner = build / "corpus-runner"
    if runner.exists() or runner.is_symlink():
        verify_executable(runner, configuration["sha256"])
        return runner
    executable = compile_runner(source, build, configuration, cargo, env)
    verify_executable(executable, configuration["sha256"])
    with tempfile.TemporaryDirectory(prefix="runner-", dir=build) as temporary:
        copy = Path(temporary) / "corpus-runner"
        shutil.copyfile(executable, copy)
        copy.chmod(0o555)
        verify_executable(copy, configuration["sha256"])
        os.replace(copy, runner)
    return runner


def build_location(checkout, commit):
    build = (BUILD / commit / "frozen-all-ports").resolve()
    if build.is_relative_to(checkout) or checkout.is_relative_to(build):
        raise ValueError(f"The build location overlaps the checkout: {build}")
    return build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path, help="clean checkout of the recorded commit")
    arguments = parser.parse_args()
    checkout = Path(os.fsdecode(git(arguments.checkout.resolve(), "rev-parse", "--show-toplevel").rstrip(b"\n"))).resolve()
    record = json.loads(RECORD.read_bytes())
    commit = git(checkout, "rev-parse", "HEAD").decode().strip()
    if commit != record["commit"]:
        parser.exit(1, f"Expected {record['commit']}, got {commit}.\n")
    build = build_location(checkout, commit)
    files = git(checkout, "ls-tree", "-r", "--name-only", "-z", commit, *SNAPSHOT_PATHS)
    paths = sorted(name.decode() for name in files.split(b"\0") if name)
    verify(checkout, paths, record["groups"])
    changes = git(checkout, "status", "--porcelain", "--untracked-files=all")
    if changes:
        raise ValueError("The checkout has changes:\n" + changes.decode())

    print(f"Verified {commit} and {len(record['groups'])} hash groups.", flush=True)
    build.mkdir(parents=True, exist_ok=True)
    with (build / "build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source = snapshot(checkout, commit, paths, record["groups"], build)
        entrypoint, node = javascript_reference(source, record["javascript"])
        runner = frozen_runner(source, build, record["rustRunner"])
    print(f"Rust corpus runner: {runner}")
    print(f"Rust runner SHA-256: {record['rustRunner']['sha256']}")
    print(f"JavaScript CLI source: {entrypoint}")
    print(f"JavaScript reference runtime: {node} ({record['javascript']['nodeVersion']})")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
