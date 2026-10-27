#!/usr/bin/env python3
"""Compare Unicode profile costs through the four public APIs (tests/README.md)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
WORKERS = ROOT / "tools/bench-unicode-properties"
LIBRARIES = ("javascript", "rust", "go", "python")
FORWARD = '```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text {token}\n%rule token _\n%emits $\n```\n'


def command(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def hex_text(value):
    return value.encode("utf-8").hex()


def save(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def manifest(path, cases):
    path.write_text("".join("\t".join(hex_text(value) for value in (
        case["id"], case["text"], "\n".join(case.get("features", [])),
        "\n".join(case.get("withoutFeatures", [])))) + "\n" for case in cases), encoding="ascii")


def concurrent_tables(directory):
    fixtures = json.loads((ROOT / "tests/json-keys.json").read_text())
    hashes = {}
    for name, text in [("bootstrap", (ROOT / "data/preparsed/gencmu.json").read_text()),
                       ("unicode", (ROOT / "data/unicode/unicode.txt").read_text()), ("source", fixtures["grammar"])]:
        value = 0xcbf29ce484222325
        for byte in text.encode():
            value = ((value ^ byte) * 0x100000001b3) & 0xffffffffffffffff
        hashes[name] = f"{value:016x}"
    selected = [case for case in fixtures["preparsed"] if case.get("concurrent")]
    if len(selected) != 3:
        raise ValueError("Concurrent table conformance requires its three shared cache controls")
    rows, expected = [], {}
    for index, case in enumerate(selected):
        cache = fixtures["cache"].replace(case["find"], case["replace"], 1)
        for name, fingerprint in hashes.items():
            cache = cache.replace("@" + name + "@", fingerprint)
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": fixtures["grammar"],
                   "data/unicode/unicode.txt": (ROOT / "data/unicode/unicode.txt").read_text(), "data/preparsed/lojban.json": cache, **case["sources"]}
        path = directory / f"table-{index}.tsv"
        path.write_text("".join(hex_text(key) + "\t" + hex_text(value) + "\n" for key, value in sources.items()), encoding="ascii")
        rows.append(str(index) + "\t" + str(path) + "\n")
        expected[str(index)] = {"name": str(index), "a": not case["cached"], "b": case["cached"], "tags": case["tags"]}
    path = directory / "tables.tsv"
    path.write_text("".join(rows), encoding="ascii")
    return path, expected


def baseline_tree(revision):
    for section in command("git", "worktree", "list", "--porcelain").split("\n\n"):
        fields = dict(line.split(" ", 1) for line in section.splitlines() if " " in line)
        if fields.get("HEAD") == revision:
            return Path(fields["worktree"])
    path = ROOT.parent / ("unicode-properties-baseline-" + revision[:8])
    subprocess.run(["git", "worktree", "add", "--detach", str(path), revision], cwd=ROOT, check=True)
    return path


def build(library, root, directory, python):
    directory.mkdir(parents=True, exist_ok=True)
    log = directory / "build.log"
    with log.open("w") as output:
        def run(args, cwd):
            subprocess.run(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, check=True)
        if library == "javascript":
            return ["node", str(WORKERS / "javascript.mjs"), str(root)]
        if library == "python":
            return [python, str(WORKERS / "python.py"), str(root)]
        binary = directory / "worker"
        if library == "rust":
            run(["cargo", "build", "--release", "--lib"], root / "lib/rust")
            run(["rustc", "--edition=2021", "-O", str(WORKERS / "rust.rs"),
                 "--extern", "gencmu=" + str(root / "lib/rust/target/release/libgencmu.rlib"),
                 "-L", "dependency=" + str(root / "lib/rust/target/release/deps"), "-o", str(binary)], root)
        else:
            (directory / "go.mod").write_text('module unicode-property-measurements\n\ngo 1.22\n\n'
                'require github.com/int19h/gencmu/lib/go v0.0.0\n'
                'replace github.com/int19h/gencmu/lib/go => ' + str(root / "lib/go") + '\n')
            run(["go", "build", "-o", str(binary), str(WORKERS / "go.go")], directory)
        return [str(binary)]


class Worker:
    def __init__(self, argv, log):
        self.log = log.open("a")
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, text=True)

    def request(self, *fields):
        self.process.stdin.write("\t".join(map(str, fields)) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("A worker exited before its reply: " + str(self.process.poll()))
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def rss(self):
        text = Path(f"/proc/{self.process.pid}/status").read_text()
        return int(re.search(r"^VmHWM:\s+(\d+)", text, re.M)[1]) * 1024

    def close(self):
        self.process.stdin.close()
        try:
            code = self.process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait()
            raise RuntimeError("A worker did not exit after EOF")
        finally:
            self.log.close()
        if code:
            raise RuntimeError("A worker failed: " + str(code))


class Comparison:
    def __init__(self, directory):
        text = (ROOT / "lib/js/src/unicode-property-catalog.js").read_text()
        catalog = json.loads(text.split(" = ", 1)[1].rstrip(";\n"))
        self.aliases = {alias: name for alias, name in catalog["aliases"].items()
                        if catalog["tags"][name][0] == "General_Category"}
        self.retained = set(self.aliases.values()) | {"_White_Space", "_Emoji_Presentation", "_Emoji_Component"}
        self.directory = directory

    def project(self, value, key=""):
        if isinstance(value, dict):
            return {k: self.project(v, k) for k, v in value.items()}
        if isinstance(value, list):
            if key == "tags":
                tags = [self.aliases.get(tag, tag) for tag in value]
                return sorted(tag for tag in tags if not tag.startswith("_") or tag in self.retained)
            return [self.project(item, key) for item in value]
        if isinstance(value, str) and key in {"terminal", "rule", "rules", "expression", "message", "brackets"}:
            return re.sub(r"(?<![A-Za-z0-9_-])_[A-Za-z][A-Za-z0-9_]*", lambda m: self.aliases.get(m[0], m[0]), value)
        return value

    def results(self, paths, cases):
        differences = []
        digests = [hashlib.sha256(), hashlib.sha256()]
        with paths[0].open() as left, paths[1].open() as right:
            for case in cases:
                lines = [left.readline(), right.readline()]
                if not all(lines):
                    raise ValueError("A result stream omits " + case["id"])
                values = [self.project(json.loads(line)) for line in lines]
                if "forwarded" in case:
                    for value in values:
                        result = value["result"]
                        tokens = result["stages"][0].get("output", [])
                        if not result["ok"] or len(tokens) != len(case["forwarded"]) or "".join(t["value"] for t in tokens) != case["forwarded"]:
                            raise ValueError("A forwarding workload changes its scalar tokens")
                for digest, value in zip(digests, values):
                    digest.update((case["id"] + "\n" + json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
                if values[0] != values[1]:
                    differences.append({"id": case["id"], "baseline": values[0], "candidate": values[1]})
            if left.readline() or right.readline():
                raise ValueError("A result stream contains extra cases")
        for path in paths:
            path.unlink()
        return {"digests": [digest.hexdigest() for digest in digests], "differences": differences}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--output", type=Path, required=True, help="directory for measurements and build files")
    parser.add_argument("--python", default=str(ROOT / "lib/python/.venv/bin/python"))
    parser.add_argument("--prepare-only", action="store_true", help="build workers and write the fixed manifests without timing")
    parser.add_argument("--conformance-only", action="store_true", help="run shared concurrent table controls without timing")
    parser.add_argument("--library", action="append", choices=LIBRARIES, help="measure only the selected libraries")
    parser.add_argument("--resume", action="store_true", help="resume completed phases for the same committed inputs")
    args = parser.parse_args()
    directory = args.output.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    revision = command("git", "rev-parse", args.baseline)
    baseline = baseline_tree(revision)
    if command("git", "status", "--porcelain", cwd=baseline):
        raise ValueError("The baseline worktree must be clean")
    if (ROOT / "data/unicode/unicode.txt").read_bytes() != (baseline / "data/unicode/unicode.txt").read_bytes():
        raise ValueError("Both revisions must use identical core character data")
    cases = []
    for path in sorted((baseline / "tests/corpus").glob("*.jsonl")):
        cases.extend(case for line in path.read_text().splitlines() if line.strip()
                     if (case := json.loads(line))["dialect"] == "cll-ebnf")
    cases.sort(key=lambda case: case["id"].encode("ascii"))
    if len(cases) < 400 or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("The baseline requires 400 distinct cll-ebnf IDs")
    candidate_cases = {}
    for path in (ROOT / "tests/corpus").glob("*.jsonl"):
        for line in path.read_text().splitlines():
            if line.strip() and (case := json.loads(line))["dialect"] == "cll-ebnf":
                candidate_cases[case["id"]] = case
    for case in cases:
        other = candidate_cases.get(case["id"])
        if other is None or any(case.get(key, []) != other.get(key, []) for key in ("text", "features", "withoutFeatures")):
            raise ValueError("The candidate omits or changes a baseline corpus record: " + case["id"])
    sample = [dict(id=c["id"], text=c["text"], features=c.get("features", []), withoutFeatures=c.get("withoutFeatures", [])) for c in cases[:400]]
    save(directory / "selection.json", sample)
    manifest(directory / "corpus.tsv", sample)
    source = directory / "forward.tsv"
    source.write_text(hex_text("p.md") + "\t" + hex_text(FORWARD) + "\n", encoding="ascii")
    workloads = {"corpus": sample}
    for name, text in [("ascii", "a" * 4096), ("combining", "e\u0301" * 2048), ("hangul", "한" * 1365)]:
        workloads[name] = [{"id": name, "text": text, "forwarded": "한" * 1365 if name == "hangul" else text}]
        manifest(directory / (name + ".tsv"), workloads[name])
    report = {"baseline": revision, "candidate": command("git", "rev-parse", "HEAD"),
              "candidateDirty": bool(command("git", "status", "--porcelain")),
              "environment": {"platform": platform.platform(), "machine": platform.machine(),
                  "cpu": command("lscpu"), "node": command("node", "--version"),
                  "go": command("go", "version"), "rust": command("rustc", "--version"),
                  "python": command(args.python, "--version")},
              "coreSha256": hashlib.sha256((ROOT / "data/unicode/unicode.txt").read_bytes()).hexdigest(),
              "fullCorpusCount": len(cases), "libraries": {}, "complete": False, "passed": False}
    report_path = directory / "report.json"
    if args.resume and report_path.exists():
        if report["candidateDirty"]:
            raise ValueError("A resumed comparison requires a clean committed candidate")
        previous = json.loads(report_path.read_text())
        for key in ("baseline", "candidate", "candidateDirty", "coreSha256", "fullCorpusCount"):
            if previous[key] != report[key]:
                raise ValueError("The resumed comparison changes " + key)
        for key in ("platform", "machine", "node", "go", "rust", "python"):
            if previous["environment"][key] != report["environment"][key]:
                raise ValueError("The resumed comparison changes " + key)
        report = previous
    save(report_path, report)
    comparison = Comparison(directory)
    tables, table_expected = concurrent_tables(directory)
    for library in dict.fromkeys(args.library or LIBRARIES):
        if report["libraries"].get(library, {}).get("complete"):
            continue
        print("Building " + library, flush=True)
        argv = [build(library, tree, directory / library / label, args.python)
                for tree, label in [(baseline, "baseline"), (ROOT, "candidate")]]
        if args.prepare_only:
            continue
        record = report["libraries"].setdefault(library,
            {"workloads": {}, "cold": [], "fullCorpus": {"chunks": [], "differences": []}})
        table_worker = Worker(argv[1], directory / library / "concurrent.log")
        try:
            observed = table_worker.request("concurrent", "-", tables)
            if len(observed) != len(table_expected) * 4 or any(item != table_expected.get(item["name"]) for item in observed):
                raise ValueError(library + ": concurrent reads change a selected table or its preparsed cache hit")
            if any(sum(item["name"] == name for item in observed) != 4 for name in table_expected):
                raise ValueError(library + ": concurrent reads omit a shared control")
            record["concurrentTables"] = observed
            save(report_path, report)
        finally:
            table_worker.close()
        if args.conformance_only:
            continue
        workers = [Worker(command, directory / library / (label + ".log")) for command, label in zip(argv, ["baseline", "candidate"])]
        outputs = [directory / "baseline.jsonl", directory / "candidate.jsonl"]
        try:
            for key, sources in [("corpus", "-"), ("forward", source)]:
                loaded = [worker.request("load", key, sources) for worker in workers]
                if loaded[0] != loaded[1]:
                    raise ValueError(library + ": incompatible dialect features")
            for name, inputs in workloads.items():
                if "passed" in record["workloads"].get(name, {}):
                    continue
                print(library + ": warm " + name, flush=True)
                key = "corpus" if name == "corpus" else "forward"
                path = directory / (name + ".tsv")
                measurements = {"warmups": [], "calibration": [], "pairs": []}
                record["workloads"][name] = measurements
                for _ in range(2):
                    measurements["warmups"].append([w.request("batch", key, 1, path, "-") for w in workers])
                repetitions = 1
                while True:
                    pair = [w.request("batch", key, repetitions, path, "-") for w in workers]
                    measurements["calibration"].append({"repetitions": repetitions, "results": pair})
                    if min(item["seconds"] for item in pair) >= 1.25:
                        break
                    repetitions *= 2
                measurements["repetitions"] = repetitions
                for index in range(9):
                    pair = [None, None]
                    for side in ([0, 1] if index % 2 == 0 else [1, 0]):
                        pair[side] = workers[side].request("batch", key, repetitions, path, outputs[side])
                        pair[side]["peakBytes"] = workers[side].rss()
                    outcome = comparison.results(outputs, inputs)
                    measurements["pairs"].append({"results": pair, "comparison": outcome})
                    save(report_path, report)
                medians = [statistics.median(p["results"][side]["seconds"] / repetitions for p in measurements["pairs"]) for side in range(2)]
                measurements["medianSeconds"] = medians
                measurements["ratio"] = medians[1] / medians[0]
                measurements["passed"] = (medians[1] <= medians[0] * 1.05
                    and all(result["seconds"] >= 1 for pair in measurements["pairs"] for result in pair["results"])
                    and not any(p["comparison"]["differences"] for p in measurements["pairs"]))
                save(report_path, report)
            completed = 0
            for chunk in record["fullCorpus"]["chunks"]:
                if chunk["offset"] != completed or chunk["count"] != min(128, len(cases) - completed):
                    raise ValueError("The resumed corpus chunks do not form the selected prefix")
                completed += chunk["count"]
            for offset in range(completed, len(cases), 128):
                chunk = cases[offset:offset + 128]
                path = directory / "full.tsv"
                manifest(path, chunk)
                for side in range(2):
                    workers[side].request("batch", "corpus", 1, path, outputs[side])
                outcome = comparison.results(outputs, chunk)
                record["fullCorpus"]["chunks"].append({"offset": offset, "count": len(chunk), "digests": outcome["digests"]})
                record["fullCorpus"]["differences"].extend(outcome["differences"])
                save(report_path, report)
                print(f"{library}: full corpus {min(offset + 128, len(cases))}/{len(cases)}", flush=True)
        finally:
            for worker in workers:
                worker.close()
        print(library + ": cold corpus", flush=True)
        for index in range(len(record["cold"]), 9):
            pair = [None, None]
            for side in ([0, 1] if index % 2 == 0 else [1, 0]):
                start = time.perf_counter()
                worker = Worker(argv[side], directory / library / "cold.log")
                try:
                    worker.request("load", "corpus", "-")
                    result = worker.request("batch", "corpus", 1, directory / "corpus.tsv", "-")
                    result["coldSeconds"] = time.perf_counter() - start - result["serialization"]
                    result["peakBytes"] = worker.rss()
                    pair[side] = result
                finally:
                    worker.close()
            record["cold"].append(pair)
            save(report_path, report)
        medians = [statistics.median(pair[side]["coldSeconds"] for pair in record["cold"]) for side in range(2)]
        record["coldMedianSeconds"] = medians
        record["coldPassed"] = medians[1] <= medians[0] + max(medians[0] * .05, .025)
        record["complete"] = True
        save(report_path, report)
    report["complete"] = not (args.prepare_only or args.conformance_only) and all(
        report["libraries"].get(library, {}).get("complete") for library in LIBRARIES)
    measured_passed = all(record.get("coldPassed") and not record["fullCorpus"]["differences"]
        and len(record["workloads"]) == len(workloads)
        and all(measurement.get("passed") for measurement in record["workloads"].values())
        for record in report["libraries"].values())
    report["passed"] = report["complete"] and measured_passed
    save(report_path, report)
    return 0 if report["passed"] or args.prepare_only or args.conformance_only or args.library and measured_passed else 1


if __name__ == "__main__":
    sys.exit(main())
