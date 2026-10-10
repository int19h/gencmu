#!/usr/bin/env python3
"""Pin the published CLL headings and example anchors for offline tests.

Run python3 tools/cll-footnotes-index.py to fetch each source page once.
--cache-dir reads saved source pages instead, without network access.
"""
import argparse
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/"
LATER = "https://github.com/int19h/cll/blob/v1.3.4/chapters/"
ROOT = Path(__file__).resolve().parent.parent


def build_index(cache_dir=None):
    sources = {}

    def read(url, cached_names):
        if url not in sources:
            if cache_dir:
                file = next((cache_dir / name for name in cached_names if (cache_dir / name).is_file()), None)
                if file is None:
                    raise FileNotFoundError(f"No cached source for {url}")
                data = file.read_bytes()
            else:
                with urllib.request.urlopen(url) as response:
                    data = response.read()
            sources[url] = data
        return sources[url]

    def text(node):
        return " ".join("".join(node.itertext()).split())

    def local(tag):
        return tag.rsplit("}", 1)[-1]

    index_data = read(BASE + "index.html", ["index.html", "cll-index.html"])
    index = ET.fromstring(index_data)
    links = {}
    for node in index.iter():
        href = node.get("href", "")
        if local(node.tag) == "a" and re.match(r"\d+(?:\.\d+)?\. ", text(node)):
            page = urllib.parse.urldefrag(href)[0]
            if page.endswith(".html"):
                links.setdefault(page, []).append(href)
    pages = {}
    for name, aliases in sorted(links.items()):
        url = BASE + name
        data = read(url, [name, *aliases])
        tree = ET.fromstring(data)
        anchors = {}
        first = None
        chapter = None
        section = None
        for node in tree.iter():
            kind = local(node.tag)
            title = text(node) if kind in ("h1", "h2", "strong") else ""
            c = re.match(r"Chapter (\d+)\. (.*)", title)
            s = re.match(r"(\d+\.\d+)\. (.*)", title) if kind in ("h1", "h2") else None
            e = re.match(r"Example (\d+\.\d+)\.", title) if kind == "strong" else None
            if c:
                chapter = c[1]
                record = {"chapter": chapter, "title": title}
            elif s:
                section = s[1]
                record = {"section": section, "title": title}
            elif e:
                record = {"section": section, "example": e[1], "title": title}
            else:
                continue
            if first is None:
                first = record
            for child in node.iter():
                anchor = child.get("id")
                if anchor:
                    anchors[anchor] = record
        if first is None:
            raise ValueError(f"No numbered heading on {url}")
        pages[url] = {"sha256": hashlib.sha256(data).hexdigest(), "default": first, "anchors": anchors}

    # These reviewed claims catch plausible links to the wrong page.
    # They are finite citation guards, not a proof of arbitrary prose.
    # The excerpt is checked against the cached or fetched source once.
    claims = [
        ("CLL writes a pause as a period.", "section-lojban-characters.html", "",
         "The period represents a mandatory pause"),
        ("a triple that CLL forbids,", "section-initial-pairs.html", "",
         "The triples ndj, ndz, ntc, and nts are forbidden."),
        ("CLL also writes `kulnrsu,omi`.", "section-anaphoric-rafsi.html", "c7e15d3",
         "fo'a goi le kulnrsu,omi"),
        ("Relative clauses can come after the inner sumti.", "section-possessive-sumti.html", "",
         "a relative clause immediately following the possessor sumti"),
    ]
    for phrase, name, anchor, excerpt in claims:
        url = BASE + name
        source_text = text(ET.fromstring(sources[url]))
        if excerpt not in source_text:
            raise ValueError(f"Claim evidence is absent from {url}: {excerpt}")
        target = url + ("#" + anchor if anchor else "")
        pages[url].setdefault("supports", []).append({"phrase": phrase, "target": target, "excerpt": excerpt})

    # GitHub line anchors refer to versioned XML. The chapter's c4 anchor
    # supplies its number. The appendix's a03 anchor and section order
    # supply A3.1, A3.2, and so on, as the rendered edition does.
    for name in ("04", "a03"):
        url = LATER + name + ".xml"
        raw_url = url.replace("github.com/", "raw.githubusercontent.com/").replace("/blob/", "/")
        data = read(raw_url, [f"cll-1.3.4-{name}.xml", f"{name}.xml"])
        source = data.decode("utf-8")
        expanded = re.sub(r"&([A-Za-z][A-Za-z0-9]+);", lambda m: html.unescape(m[0]), source)
        tree = ET.fromstring(expanded)
        title = text(tree.find("title"))
        root_anchor = tree.find("title/anchor").get("{http://www.w3.org/XML/1998/namespace}id")
        chapter = re.fullmatch(r"c(\d+)", root_anchor)
        appendix = re.fullmatch(r"a0*(\d+)", root_anchor)
        default = {"chapter": chapter[1], "title": title} if chapter else {"appendix": "A" + appendix[1], "title": title}
        sections = []
        for ordinal, section in enumerate(tree.findall("section"), 1):
            section_title = section.find("title")
            section_id = section.get("{http://www.w3.org/XML/1998/namespace}id")
            start = next(i for i, line in enumerate(source.splitlines(), 1) if f'<section xml:id="{section_id}"' in line)
            record = {"line": start, "title": text(section_title)}
            if chapter:
                anchor = section_title.find("anchor").get("{http://www.w3.org/XML/1998/namespace}id")
                number = re.fullmatch(r"c(\d+)s(\d+)", anchor)
                record["section"] = number[1] + "." + number[2]
            else:
                record["appendix"] = default["appendix"] + "." + str(ordinal)
            sections.append(record)
        pages[url] = {"source": raw_url, "sha256": hashlib.sha256(data).hexdigest(), "default": default,
                      "lines": len(source.splitlines()), "sections": sections}
    return {"edition": "CLL 1.1, generated 2016-08-26; later sources pinned at v1.3.4",
            "index": {"url": BASE + "index.html", "sha256": hashlib.sha256(index_data).hexdigest()}, "pages": pages}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    result = build_index(args.cache_dir)
    target = ROOT / "tests" / "cll-footnotes.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Pinned {len(result['pages'])} source pages in {target.relative_to(ROOT)}")
