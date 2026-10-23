"""Generate the pinned property resource and tag catalogs (engine §1)."""

from array import array
import hashlib
import json
import subprocess
import sys


BINARY = """
Alphabetic Cased Case_Ignorable Lowercase Uppercase
Changes_When_Casefolded Changes_When_Casemapped Changes_When_Lowercased
Changes_When_Titlecased Changes_When_Uppercased Changes_When_NFKC_Casefolded
ID_Start ID_Continue XID_Start XID_Continue ID_Compat_Math_Start ID_Compat_Math_Continue
Ideographic Unified_Ideograph Radical IDS_Binary_Operator IDS_Trinary_Operator IDS_Unary_Operator
Diacritic Extender Grapheme_Base Grapheme_Extend Prepended_Concatenation_Mark Variation_Selector
Dash Quotation_Mark Terminal_Punctuation Sentence_Terminal Hex_Digit ASCII_Hex_Digit Math
White_Space Pattern_White_Space Pattern_Syntax Bidi_Control Bidi_Mirrored Join_Control
Logical_Order_Exception Soft_Dotted Default_Ignorable_Code_Point Noncharacter_Code_Point
Deprecated Composition_Exclusion Full_Composition_Exclusion Emoji Emoji_Presentation
Emoji_Modifier Emoji_Modifier_Base Emoji_Component Extended_Pictographic Regional_Indicator
""".split()

ENUMERATED = """
General_Category Canonical_Combining_Class Script Block Age Bidi_Class Bidi_Paired_Bracket_Type
East_Asian_Width Vertical_Orientation Line_Break Word_Break Grapheme_Cluster_Break Sentence_Break
Joining_Type Joining_Group Hangul_Syllable_Type Indic_Conjunct_Break Indic_Positional_Category
Indic_Syllabic_Category Decomposition_Type Numeric_Type NFC_Quick_Check NFD_Quick_Check
NFKC_Quick_Check NFKD_Quick_Check
""".split()

CORE = {"General_Category", "Canonical_Combining_Class", "White_Space", "Emoji_Presentation", "Emoji_Component"}
DIRECT = {
    "General_Category": "extracted/DerivedGeneralCategory.txt",
    "Canonical_Combining_Class": "extracted/DerivedCombiningClass.txt",
    "Script": "Scripts.txt", "Block": "Blocks.txt", "Age": "DerivedAge.txt",
    "Bidi_Class": "extracted/DerivedBidiClass.txt", "Bidi_Paired_Bracket_Type": "BidiBrackets.txt",
    "East_Asian_Width": "extracted/DerivedEastAsianWidth.txt", "Vertical_Orientation": "VerticalOrientation.txt",
    "Line_Break": "LineBreak.txt", "Word_Break": "auxiliary/WordBreakProperty.txt",
    "Grapheme_Cluster_Break": "auxiliary/GraphemeBreakProperty.txt",
    "Sentence_Break": "auxiliary/SentenceBreakProperty.txt", "Joining_Type": "extracted/DerivedJoiningType.txt",
    "Joining_Group": "extracted/DerivedJoiningGroup.txt", "Hangul_Syllable_Type": "HangulSyllableType.txt",
    "Indic_Positional_Category": "IndicPositionalCategory.txt", "Indic_Syllabic_Category": "IndicSyllabicCategory.txt",
    "Decomposition_Type": "extracted/DerivedDecompositionType.txt", "Numeric_Type": "extracted/DerivedNumericType.txt",
}
NAMED = ["PropList.txt", "DerivedCoreProperties.txt", "emoji/emoji-data.txt",
         "DerivedNormalizationProps.txt", "extracted/DerivedBinaryProperties.txt"]


def loose(name):
    """UCD assignment files use aliases and spaced Block names."""
    return name.replace("_", "").replace("-", "").replace(" ", "").lower()


def records(text, missing=False):
    for line in text.splitlines():
        if missing:
            if "# @missing:" not in line:
                continue
            body = line.split("# @missing:", 1)[1]
        else:
            body = line.split("#", 1)[0]
        if body.strip():
            yield [field.strip() for field in body.split(";")]


class UCD:
    def __init__(self, root, directory):
        manifest = json.loads((root / "tools/unicode-property-sources.json").read_text())
        self.text = {}
        for name, fingerprint in manifest["files"].items():
            raw = (directory / name).read_bytes()
            if hashlib.sha256(raw).hexdigest() != fingerprint:
                raise ValueError(f"{name}: the input differs from pinned Unicode {manifest['unicode']}")
            self.text[name] = raw.decode("utf-8")
        self.version = manifest["unicode"]
        self.properties = {}
        self.short = {}
        for row in records(self.text["PropertyAliases.txt"]):
            short, long, *_ = row
            self.short[long] = short
            for alias in row:
                self.properties[loose(alias)] = long
        self.values = {p: {} for p in ENUMERATED}
        self.value_aliases = {p: {} for p in ENUMERATED}
        ccc = {}
        for row in records(self.text["PropertyValueAliases.txt"]):
            prop = self.properties[loose(row[0])]
            if prop not in self.values:
                continue
            if prop == "Canonical_Combining_Class":
                code, short, long = int(row[1]), row[2], row[3]
                ccc[code] = (short, long)
                aliases = row[1:]
            else:
                short, long = row[1:3]
                if prop == "General_Category" and short == "LC":
                    continue
                aliases = row[1:]
            self.values[prop][long] = short
            for alias in aliases:
                self.value_aliases[prop][loose(alias)] = long
        for code in range(255):
            short, long = ccc.get(code, (str(code), str(code)))
            self.values["Canonical_Combining_Class"][long] = short
            self.value_aliases["Canonical_Combining_Class"][str(code)] = long
        self.values["Script_Extensions"] = self.values["Script"].copy()
        self.value_aliases["Script_Extensions"] = self.value_aliases["Script"].copy()
        self.types = {**{p: "binary" for p in BINARY}, **{p: "enumerated" for p in ENUMERATED},
                      "Script_Extensions": "multiple"}

    def value(self, prop, spelling):
        return self.value_aliases[prop][loose(spelling)]

    def catalog(self):
        aliases, folded, tags = {}, {}, {}

        def add(spelling, canonical):
            if spelling in aliases and aliases[spelling] != canonical:
                raise ValueError(f"a property tag alias collides: {spelling}")
            key = spelling.lower()
            if key in folded and folded[key] != canonical:
                raise ValueError(f"property tags collide after case folding: {spelling}")
            aliases[spelling] = canonical
            folded[key] = canonical

        for prop, kind in sorted(self.types.items()):
            if kind == "binary":
                canonical = "_" + prop
                tags[canonical] = [prop, ""]
                add(canonical, canonical)
                add("_" + self.short[prop], canonical)
            else:
                for long, short in sorted(self.values[prop].items()):
                    canonical = "_" + prop + "_" + long
                    tags[canonical] = [prop, long]
                    add(canonical, canonical)
                    add("_" + self.short[prop] + "_" + short, canonical)
                    if prop == "General_Category":
                        add("_" + short, canonical)
        return {"types": dict(sorted(self.types.items())), "values": {p: sorted(v) for p, v in sorted(self.values.items())},
                "aliases": dict(sorted(aliases.items())), "tags": dict(sorted(tags.items())), "core": sorted(CORE), "combining": {str(code): "_Canonical_Combining_Class_" + self.value("Canonical_Combining_Class", str(code)) for code in range(255)}}

    def core_records(self, abbreviations):
        categories, category_values, _ = self.assignments("General_Category")
        classes, class_values, _ = self.assignments("Canonical_Combining_Class")
        category_ids = {value: i for i, value in enumerate(category_values)}
        class_ids = {value: i for i, value in enumerate(class_values)}
        numeric_classes = {self.value("Canonical_Combining_Class", str(code)): code for code in range(255)}
        expected_categories = array("H", [category_ids["Unassigned"]]) * 0x110000
        expected_classes = array("H", [class_ids["Not_Reordered"]]) * 0x110000
        mappings, pending = {}, None
        for line in self.text["UnicodeData.txt"].splitlines():
            fields = line.split(";")
            code = int(fields[0], 16)
            if fields[1].endswith(", First>"):
                pending = code
                continue
            first = pending if fields[1].endswith(", Last>") else code
            pending = None
            category = category_ids[self.value("General_Category", fields[2])]
            klass = class_ids[self.value("Canonical_Combining_Class", fields[3])]
            assign(expected_categories, first, code, category)
            assign(expected_classes, first, code, klass)
            if fields[5] and not fields[5].startswith("<"):
                mappings[code] = [int(part, 16) for part in fields[5].split()]
        if expected_categories != categories or expected_classes != classes:
            raise ValueError("UnicodeData.txt disagrees with the extracted category or combining-class assignments")

        def expand(code):
            if 0xAC00 <= code <= 0xD7A3:
                index = code - 0xAC00
                return [0x1100 + index // 588, 0x1161 + index % 588 // 28] + ([0x11A7 + index % 28] if index % 28 else [])
            return [part for child in mappings[code] for part in expand(child)] if code in mappings else [code]

        lines = [f"unicode {self.version}"]
        for first, last, value in runs(categories):
            lines.append(f"category {self.values['General_Category'][category_values[value]]} {first:04X} {last:04X}")
        for prop in ["White_Space", "Emoji_Presentation", "Emoji_Component"]:
            result, _, _ = self.assignments(prop)
            name = prop.lower().replace("_", "-")
            lines.extend(f"{name} {first:04X} {last:04X}" for first, last, value in runs(result) if value)
        for code in sorted(mappings):
            scalars = expand(code)
            for index in range(1, len(scalars)):
                klass = numeric_classes[class_values[classes[scalars[index]]]]
                previous = index
                while klass and previous and numeric_classes[class_values[classes[scalars[previous - 1]]]] > klass:
                    scalars[previous - 1], scalars[previous] = scalars[previous], scalars[previous - 1]
                    previous -= 1
            lines.append("decompose " + " ".join(f"{scalar:04X}" for scalar in [code] + scalars))
        lines.extend(f"abbreviation {code:04X} {alias}" for code, alias in abbreviations)
        for first, last, value in runs(classes):
            klass = numeric_classes[class_values[value]]
            if klass:
                lines.append(f"combining {klass} {first:04X} {last:04X}")
        return lines

    def assignments(self, prop):
        """Resolve defaults in source order, then apply explicit assignments."""
        if prop == "Script_Extensions":
            scripts, script_values, _ = self.assignments("Script")
            values = [(value,) for value in script_values]
            ids = {value: i for i, value in enumerate(values)}
            result = scripts[:]
            for row in records(self.text["ScriptExtensions.txt"]):
                first, last = endpoints(row[0])
                members = tuple(sorted(self.value(prop, value) for value in row[1].split()))
                if members not in ids:
                    ids[members] = len(values)
                    values.append(members)
                assign(result, first, last, ids[members])
            return result, values, ids[("Unknown",)]
        binary = prop in BINARY
        values = ["No", "Yes"] if binary else sorted(self.values[prop])
        ids = {value: i for i, value in enumerate(values)}
        result = array("H", [0]) * 0x110000
        default = 0 if binary else None
        if not binary:
            for row in records(self.text["PropertyValueAliases.txt"], missing=True):
                if self.properties.get(loose(row[1])) != prop:
                    continue
                first, last = endpoints(row[0])
                value = ids[self.value(prop, row[2])]
                if first == 0 and last == 0x10FFFF:
                    default = value
                assign(result, first, last, value)
        if prop in DIRECT:
            source = self.text[DIRECT[prop]]
            for row in records(source, missing=True):
                first, last = endpoints(row[0])
                value = ids[self.value(prop, row[-1])]
                if first == 0 and last == 0x10FFFF and default is None:
                    default = value
                assign(result, first, last, value)
            for row in records(source):
                first, last = endpoints(row[0])
                assign(result, first, last, ids[self.value(prop, row[-1])])
        elif prop == "Composition_Exclusion":
            for row in records(self.text["CompositionExclusions.txt"]):
                first, last = endpoints(row[0])
                assign(result, first, last, 1)
        else:
            for missing in [True, False]:
                for name in NAMED:
                    for row in records(self.text[name], missing=missing):
                        if len(row) < 2 or self.properties.get(loose(row[1])) != prop:
                            continue
                        first, last = endpoints(row[0])
                        value = 1 if binary else ids[self.value(prop, row[2])]
                        if missing and first == 0 and last == 0x10FFFF and default is None:
                            default = value
                        assign(result, first, last, value)
        if default is None:
            raise ValueError(f"{prop}: no complete UCD default")
        return result, values, default


def endpoints(domain):
    ends = domain.split("..")
    return int(ends[0], 16), int(ends[-1], 16)


def assign(result, first, last, value):
    result[first:last + 1] = array("H", [value]) * (last - first + 1)


def runs(result):
    """Keep surrogate boundaries even when neighboring values agree."""
    for first, last in [(0, 0xD7FF), (0xE000, 0x10FFFF)]:
        start, value = first, result[first]
        for code in range(first + 1, last + 1):
            if result[code] != value:
                yield start, code - 1, value
                start, value = code, result[code]
        yield start, last, value


def write_properties(root, ucd):
    lines = [f"unicode-properties {ucd.version}"]
    for prop, kind in sorted(ucd.types.items()):
        if prop in CORE:
            continue
        result, values, default = ucd.assignments(prop)
        suffix = ""
        if kind == "enumerated":
            suffix = " " + values[default]
        elif kind == "multiple":
            suffix = " " + " ".join(values[default])
        lines.append(f"{kind} {prop}{suffix}")
        if kind != "binary":
            lines.extend(f"value {prop} {value}" for value in sorted(ucd.values[prop]))
        for first, last, value in runs(result):
            if value == default:
                continue
            suffix = ""
            if kind == "enumerated":
                suffix = " " + values[value]
            elif kind == "multiple":
                suffix = " " + " ".join(values[value])
            lines.append(f"range {prop} {first:04X} {last:04X}{suffix}")
    (root / "grammars/unicode-properties.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_catalog(root, ucd):
    catalog = ucd.catalog()
    if len(catalog["tags"]) != 1378 or len(catalog["aliases"]) != 2786:
        raise ValueError("The pinned tag inventory differs from the specified catalog")
    data = json.dumps(catalog, ensure_ascii=True, separators=(",", ":"))
    title = "Generated by tools/unicode-table.py from Unicode 15.1.0."
    outputs = {
        "lib/js/src/unicode-property-catalog.js": f"// {title}\n" +
            "/** @type {{types: Record<string, string>, values: Record<string, string[]>, aliases: Record<string, string>, tags: Record<string, [string, string]>, core: string[], combining: Record<string,string>}} */\n" +
            f"export const PROPERTY_CATALOG = {data};\n",
        "lib/python/src/gencmu/_unicode_property_catalog.py": f'"""{title}"""\n\nPROPERTY_CATALOG = {data}\n',
        "lib/rust/src/unicode_property_catalog.rs": f'// {title}\npub(crate) const PROPERTY_CATALOG: &str = r#"{data}"#;\n',
        "lib/go/unicode_property_catalog.go": f'// {title}\npackage gencmu\n\nconst propertyCatalog = `{data}`\n',
    }
    for path, text in outputs.items():
        (root / path).write_text(text, encoding="utf-8")


def write_digests(root, ucd):
    """Derive audit expectations directly from UCD assignments, without reading generated resources."""
    command = ["go", "run", str(root / "tools/unicode-property-digests.go")]
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        try:
            for prop, kind in sorted(ucd.types.items()):
                result, values, _ = ucd.assignments(prop)
                tags = []
                for value in values:
                    if prop == "General_Category":
                        short = ucd.values[prop][value]
                        major = ucd.value(prop, short[0])
                        members = ["_" + prop + "_" + member for member in sorted({value, major})]
                    elif kind == "binary":
                        members = ["_" + prop] if value == "Yes" else []
                    elif kind == "multiple":
                        members = ["_" + prop + "_" + member for member in value]
                    else:
                        members = ["_" + prop + "_" + value]
                    tags.append(",".join(members))
                header = json.dumps({"Property": prop, "Tags": tags}, separators=(",", ":"))
                process.stdin.write((header + "\n").encode("ascii"))
                if sys.byteorder != "little":
                    result.byteswap()
                process.stdin.write(result.tobytes())
            process.stdin.close()
            digests = dict(line.decode("ascii").split() for line in process.stdout)
            if process.wait() or set(digests) != set(ucd.types):
                raise ValueError("The UCD property digest generation failed")
        except BaseException:
            process.kill()
            process.wait()
            raise
    data = {"unicode": ucd.version, "algorithm": "fnv1a64", "scalars": 0x110000 - 0x800,
            "properties": digests}
    (root / "tests/unicode/property-digests.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
