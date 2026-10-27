"""Public API worker for the Unicode property performance gate."""
import json
from pathlib import Path
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(sys.argv[1]) / "lib/python/src"))
import gencmu


def decode(value):
    return bytes.fromhex(value).decode("utf-8")


def rows(path):
    return [line.split("\t") for line in Path(path).read_text().splitlines() if line]


dialects = {}
for line in sys.stdin:
    try:
        command, key, *args = line.rstrip("\n").split("\t")
        if command == "load":
            dialect = gencmu.load_dialect("lojban/cll") if args[0] == "-" else gencmu.load_dialect_sources(
                {decode(k): decode(v) for k, v in rows(args[0])}, "p.md")
            dialects[key] = dialect
            answer = {"features": [[f.name, f.kind, f.default] for f in dialect.features]}
        elif command == "batch":
            count, manifest, output = args
            cases = [(decode(text), dict(features=set(filter(None, decode(features).split("\n"))),
                                        without_features=set(filter(None, decode(without).split("\n")))))
                     for _, text, features, without in rows(manifest)]
            dialect = dialects[key]
            start = time.perf_counter()
            for _ in range(int(count)):
                results = [dialect.parse(text, **options) for text, options in cases]
            seconds = time.perf_counter() - start
            start = time.perf_counter()
            serialized = ['{"result":' + gencmu.to_json(result) + ',"brackets":'
                          + json.dumps(gencmu.to_brackets(result), ensure_ascii=False) + '}' for result in results]
            serialization = time.perf_counter() - start
            if output != "-":
                Path(output).write_text("\n".join(serialized) + "\n", encoding="utf-8")
            answer = dict(seconds=seconds, serialization=serialization)
        elif command == "concurrent":
            tables = [(name, gencmu.load_dialect_sources({decode(k): decode(v) for k, v in rows(file)}, "p.md"))
                      for name, file in rows(args[0])]
            def check_table(item):
                name, dialect = item
                a, b = dialect.parse("a"), dialect.parse("b")
                return dict(name=name, a=a.ok, b=b.ok, tags=sorted(b.tree.tags))
            with ThreadPoolExecutor(max_workers=4) as executor:
                answer = list(executor.map(check_table, tables * 4))
        else:
            raise ValueError("Unknown command: " + command)
        print(json.dumps(answer), flush=True)
    except Exception:
        import traceback
        print(json.dumps({"error": traceback.format_exc()}), flush=True)
        sys.exit(1)
