import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader } from "../lib/js/src/node.js";
import { splicePipeline } from "../lib/js/src/splice.js";

const TOP_FIELDS = new Set([
  "id",
  "title",
  "text",
  "pipelines",
  "expect",
  "stage",
  "features",
  "elisionOnly",
  "view",
  "showElided",
  "gloss",
  "warnings",
  "hint",
  "open",
  "byPipeline",
]);

const REQUIRED_FIELDS = ["id", "title", "text", "pipelines", "expect"];

const OVERRIDABLE_FIELDS = new Set([
  "features",
  "warnings",
  "elisionOnly",
  "view",
  "showElided",
  "hint",
  "open",
]);

const OPEN_FIELDS = new Set(["document", "rule", "anchor"]);

const VALID_EXPECTS = new Set([
  "accepted",
  "rejected",
  "reported",
  "tie",
  "elision-only",
  "feature-conflict",
  "grammar",
]);

const STAGE_REQUIRED_EXPECTS = new Set([
  "rejected",
  "reported",
  "tie",
  "elision-only",
]);

const VALID_VIEWS = new Set([
  "brackets",
  "tree",
  "json",
  "tokens",
  "trace",
  "audit",
]);

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countOccurrences(haystack, needle) {
  if (!needle || typeof haystack !== "string") return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

export function resolveOpenDocument(pipelineName, docPath) {
  if (typeof docPath !== "string" || !docPath) return "";
  if (docPath.startsWith("grammars/")) return path.posix.normalize(docPath);
  return path.posix.normalize(path.posix.join("grammars", pipelineName, docPath));
}

export function mergeExampleForPipeline(example, pipelineName) {
  const override =
    isPlainObject(example.byPipeline) && isPlainObject(example.byPipeline[pipelineName])
      ? example.byPipeline[pipelineName]
      : {};

  let features = {};
  if (isPlainObject(example.features)) {
    features = { ...example.features };
  }
  if ("features" in override) {
    if (override.features === null) {
      features = {};
    } else if (isPlainObject(override.features)) {
      features = { ...features, ...override.features };
    }
  }

  const pick = (field, fallback) => {
    if (field in override) {
      return override[field] === null ? fallback : override[field];
    }
    return example[field] !== undefined ? example[field] : fallback;
  };

  return {
    features,
    warnings: pick("warnings", null),
    elisionOnly: pick("elisionOnly", undefined),
    view: pick("view", "brackets"),
    showElided: pick("showElided", false),
    hint: pick("hint", null),
    open: pick("open", null),
  };
}

function formatOutcomeDesc(outcome, stage, warnings) {
  const parts = [outcome];
  if (stage) parts.push(`stage=${stage}`);
  if (warnings && warnings.length) {
    parts.push(`warnings=[${[...warnings].sort().join(", ")}]`);
  }
  return parts.join(" ");
}

export function createExampleContext(root, options = {}) {
  const readSource =
    options.readSource ||
    ((rel) => {
      const full = path.join(root, rel.split("/").join(path.sep));
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : undefined;
    });

  const loader = options.loader || new Loader(readSource);

  let knownPipelines = options.knownPipelines;
  if (!knownPipelines) {
    const grammarsDir = path.join(root, "grammars");
    const walk = (dir, prefix = "") => {
      const found = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const rel = prefix + entry.name;
        if (entry.isDirectory()) {
          for (const item of walk(path.join(dir, entry.name), rel + "/")) found.push(item);
        } else if (entry.name === "pipeline.md") {
          found.push(prefix.slice(0, -1));
        }
      }
      return found;
    };
    knownPipelines = new Set(walk(grammarsDir));
  }

  const pipelineCache = new Map();
  function getPipelineInfo(name) {
    if (pipelineCache.has(name)) return pipelineCache.get(name);
    const entryPath = `grammars/${name}/pipeline.md`;
    const pipeline = loader.pipeline(entryPath);
    const docs = new Set([entryPath]);
    splicePipeline(
      entryPath,
      (docPath, inherited) => {
        docs.add(docPath);
        const text = readSource(docPath);
        return text === undefined ? undefined : loader.documentDom(docPath, inherited, text);
      },
      new Set(pipeline.features.map((f) => f.name))
    );
    const features = new Map(pipeline.features.map((f) => [f.name, f]));
    const stages = new Map(pipeline.stages.map((s) => [s.name, s]));
    const info = { pipeline, docs, features, stages };
    pipelineCache.set(name, info);
    return info;
  }

  return {
    root,
    readSource,
    loader,
    knownPipelines,
    getPipelineInfo,
  };
}

export function checkExampleEntries(file, family, parsed, context, options = {}) {
  const problems = [];
  const runs = [];
  const runExamples = options.runExamples !== false;

  if (!Array.isArray(parsed)) {
    problems.push(`${file} (file): example file must be a JSON array of objects`);
    return { problems, runs };
  }

  const seenIds = new Set();

  parsed.forEach((entry, index) => {
    const fallbackId = `entry #${index + 1}`;
    if (!isPlainObject(entry)) {
      problems.push(`${file} (${fallbackId}): example entry must be an object`);
      return;
    }

    const id =
      typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id : fallbackId;
    const beforeCount = problems.length;
    const report = (fault) => problems.push(`${file} (${id}): ${fault}`);

    for (const key of Object.keys(entry)) {
      if (!TOP_FIELDS.has(key)) {
        report(`unknown field "${key}"`);
      }
    }

    for (const req of REQUIRED_FIELDS) {
      if (!(req in entry) || entry[req] === undefined || entry[req] === null) {
        report(`missing required field "${req}"`);
      }
    }

    if ("id" in entry && entry.id !== undefined && entry.id !== null) {
      if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
        report(
          `invalid id "${String(entry.id)}" (expected lowercase ASCII letters and digits joined by single hyphens)`
        );
      } else if (seenIds.has(entry.id)) {
        report(`repeated id "${entry.id}"`);
      } else {
        seenIds.add(entry.id);
      }
    }

    if ("title" in entry && entry.title !== undefined && entry.title !== null) {
      if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
        report("title must be a non-empty string");
      } else if (entry.title.endsWith(".")) {
        report("title must not end with a period");
      }
    }

    if ("text" in entry && entry.text !== undefined && entry.text !== null) {
      if (typeof entry.text !== "string" || entry.text.length === 0) {
        report("text must not be empty");
      }
    }

    const validPipelines = [];
    if ("pipelines" in entry && entry.pipelines !== undefined && entry.pipelines !== null) {
      if (!Array.isArray(entry.pipelines) || entry.pipelines.length === 0) {
        report("pipelines must be a non-empty array");
      } else {
        const seenP = new Set();
        for (const p of entry.pipelines) {
          if (typeof p !== "string" || p.length === 0) {
            report("pipeline name must be a non-empty string");
            continue;
          }
          if (seenP.has(p)) {
            report(`repeated pipeline "${p}" in pipelines`);
            continue;
          }
          seenP.add(p);
          if (!p.startsWith(`${family}/`)) {
            report(`pipeline "${p}" belongs to another family (expected "${family}/...")`);
            continue;
          }
          if (!context.knownPipelines.has(p)) {
            report(`unknown pipeline "${p}"`);
            continue;
          }
          validPipelines.push(p);
        }
      }
    }

    if ("expect" in entry && entry.expect !== undefined && entry.expect !== null) {
      if (typeof entry.expect !== "string" || !VALID_EXPECTS.has(entry.expect)) {
        report(`unknown expect value "${String(entry.expect)}"`);
      } else {
        if (entry.expect === "accepted" && entry.stage !== undefined) {
          report('stage is forbidden when expect is "accepted"');
        }
        if (
          STAGE_REQUIRED_EXPECTS.has(entry.expect) &&
          (typeof entry.stage !== "string" || entry.stage.length === 0)
        ) {
          report(`stage is required when expect is "${entry.expect}"`);
        }
      }
    }

    if (entry.stage !== undefined) {
      if (typeof entry.stage !== "string" || entry.stage.length === 0) {
        report("stage must be a non-empty string");
      } else {
        for (const p of validPipelines) {
          const pInfo = context.getPipelineInfo(p);
          if (!pInfo.stages.has(entry.stage)) {
            report(`unknown stage "${entry.stage}" in pipeline "${p}"`);
          }
        }
      }
    }

    if (entry.elisionOnly !== undefined && typeof entry.elisionOnly !== "boolean") {
      report("elisionOnly must be a boolean");
    }
    if (entry.showElided !== undefined && typeof entry.showElided !== "boolean") {
      report("showElided must be a boolean");
    }
    if (entry.gloss !== undefined && (typeof entry.gloss !== "string" || entry.gloss.trim().length === 0)) {
      report("gloss must be a non-empty string");
    }
    if (entry.hint !== undefined && (typeof entry.hint !== "string" || entry.hint.trim().length === 0)) {
      report("hint must be a non-empty string");
    }
    if (entry.view !== undefined && !VALID_VIEWS.has(entry.view)) {
      report(`unknown view "${String(entry.view)}"`);
    }

    const checkFeaturesObject = (featObj, targetPipelines, whereLabel) => {
      if (!isPlainObject(featObj)) {
        report(`${whereLabel} must be an object`);
        return;
      }
      for (const [feat, val] of Object.entries(featObj)) {
        if (typeof val !== "boolean") {
          report(`feature "${feat}" in ${whereLabel} must have a boolean value`);
        }
        for (const p of targetPipelines) {
          const pInfo = context.getPipelineInfo(p);
          if (!pInfo.features.has(feat)) {
            report(`pipeline "${p}" does not declare feature "${feat}"`);
          }
        }
      }
    };

    if (entry.features !== undefined) {
      checkFeaturesObject(entry.features, validPipelines, "features");
    }

    const checkWarningsArray = (wArr, whereLabel) => {
      if (entry.expect !== "accepted") {
        report(`${whereLabel} is only allowed when expect is "accepted"`);
      }
      if (!Array.isArray(wArr) || wArr.length === 0) {
        report(`${whereLabel} must be a non-empty array`);
        return;
      }
      const seenCodes = new Set();
      for (const code of wArr) {
        if (typeof code !== "string" || code.length === 0) {
          report(`warning code in ${whereLabel} must be a non-empty string`);
        } else if (seenCodes.has(code)) {
          report(`repeated warning code "${code}" in ${whereLabel}`);
        } else {
          seenCodes.add(code);
        }
      }
    };

    if (entry.warnings !== undefined) {
      checkWarningsArray(entry.warnings, "warnings");
    }

    const checkOpenSyntax = (openObj, whereLabel) => {
      if (!isPlainObject(openObj)) {
        report(`${whereLabel} must be an object`);
        return false;
      }
      let ok = true;
      for (const k of Object.keys(openObj)) {
        if (!OPEN_FIELDS.has(k)) {
          report(`unknown field "${k}" in ${whereLabel}`);
          ok = false;
        }
      }
      if (typeof openObj.document !== "string" || openObj.document.trim().length === 0) {
        report(`${whereLabel} has no document`);
        ok = false;
      }
      const hasRule = openObj.rule !== undefined;
      const hasAnchor = openObj.anchor !== undefined;
      if ((hasRule && hasAnchor) || (!hasRule && !hasAnchor)) {
        report(`${whereLabel} must have either rule or anchor, not both or neither`);
        ok = false;
      } else if (hasRule && (typeof openObj.rule !== "string" || openObj.rule.trim().length === 0)) {
        report(`${whereLabel} rule must be a non-empty string`);
        ok = false;
      } else if (hasAnchor && (typeof openObj.anchor !== "string" || openObj.anchor.length === 0)) {
        report(`${whereLabel} anchor must be a non-empty string`);
        ok = false;
      }
      return ok;
    };

    if (entry.open !== undefined) {
      checkOpenSyntax(entry.open, "open");
    }

    if (entry.byPipeline !== undefined) {
      if (!isPlainObject(entry.byPipeline)) {
        report("byPipeline must be an object");
      } else {
        const declaredPipelines = Array.isArray(entry.pipelines) ? entry.pipelines : [];
        for (const [p, override] of Object.entries(entry.byPipeline)) {
          if (!declaredPipelines.includes(p)) {
            report(`byPipeline key "${p}" is not in pipelines`);
          }
          if (!isPlainObject(override)) {
            report(`byPipeline["${p}"] must be an object`);
            continue;
          }
          for (const k of Object.keys(override)) {
            if (!OVERRIDABLE_FIELDS.has(k)) {
              if (TOP_FIELDS.has(k)) {
                report(`byPipeline["${p}"] cannot override "${k}"`);
              } else {
                report(`unknown field "${k}" in byPipeline["${p}"]`);
              }
            }
          }
          const targetP = validPipelines.includes(p) ? [p] : [];
          if (override.features !== undefined && override.features !== null) {
            checkFeaturesObject(override.features, targetP, `byPipeline["${p}"].features`);
          }
          if ("warnings" in override) {
            if (override.warnings === null) {
              if (entry.expect !== "accepted") {
                report(`byPipeline["${p}"].warnings is only allowed when expect is "accepted"`);
              }
            } else {
              checkWarningsArray(override.warnings, `byPipeline["${p}"].warnings`);
            }
          }
          if (override.elisionOnly !== undefined && override.elisionOnly !== null && typeof override.elisionOnly !== "boolean") {
            report(`byPipeline["${p}"].elisionOnly must be a boolean or null`);
          }
          if (override.showElided !== undefined && override.showElided !== null && typeof override.showElided !== "boolean") {
            report(`byPipeline["${p}"].showElided must be a boolean or null`);
          }
          if (override.hint !== undefined && override.hint !== null && (typeof override.hint !== "string" || override.hint.trim().length === 0)) {
            report(`byPipeline["${p}"].hint must be a non-empty string or null`);
          }
          if (override.view !== undefined && override.view !== null && !VALID_VIEWS.has(override.view)) {
            report(`unknown view "${String(override.view)}" in byPipeline["${p}"]`);
          }
          if (override.open !== undefined && override.open !== null) {
            checkOpenSyntax(override.open, `byPipeline["${p}"].open`);
          }
        }
      }
    }

    for (const p of validPipelines) {
      const pInfo = context.getPipelineInfo(p);
      const merged = mergeExampleForPipeline(entry, p);

      if (Array.isArray(merged.warnings)) {
        for (const code of merged.warnings) {
          if (typeof code !== "string" || !code) continue;
          const feat = pInfo.features.get(code);
          if (!feat || feat.kind !== "warning") {
            report(`pipeline "${p}" does not declare "${code}" as a warning feature`);
          } else if (merged.features[code] === false) {
            report(`warning "${code}" is turned off by the merged features for pipeline "${p}"`);
          }
        }
      }

      if (isPlainObject(merged.open)) {
        const docRaw = merged.open.document;
        if (typeof docRaw === "string" && docRaw.trim().length > 0) {
          const resolvedDoc = resolveOpenDocument(p, docRaw);
          if (!pInfo.docs.has(resolvedDoc)) {
            report(`open document "${docRaw}" is outside pipeline "${p}"`);
          } else {
            if (typeof merged.open.rule === "string" && merged.open.rule.trim().length > 0) {
              const ruleName = merged.open.rule;
              let foundInDoc = false;
              for (const stage of pInfo.pipeline.stages) {
                const rule = stage.grammar.rules.get(ruleName);
                if (
                  rule &&
                  (rule.at?.document === resolvedDoc ||
                    rule.alternatives.some((alt) => alt.document === resolvedDoc))
                ) {
                  foundInDoc = true;
                  break;
                }
              }
              if (!foundInDoc) {
                report(`rule "${ruleName}" does not exist in "${docRaw}" for pipeline "${p}"`);
              }
            }
            if (typeof merged.open.anchor === "string" && merged.open.anchor.length > 0) {
              const docText = context.readSource(resolvedDoc) ?? "";
              const count = countOccurrences(docText, merged.open.anchor);
              if (count !== 1) {
                report(`anchor "${merged.open.anchor}" occurs ${count} times in "${docRaw}" (expected 1)`);
              }
            }
          }
        }
      }
    }

    const hasEntryFormatProblems = problems.length > beforeCount;
    if (runExamples && !hasEntryFormatProblems) {
      for (const p of validPipelines) {
        const pInfo = context.getPipelineInfo(p);
        const merged = mergeExampleForPipeline(entry, p);
        const features = Object.keys(merged.features).filter((k) => merged.features[k] === true);
        const withoutFeatures = Object.keys(merged.features).filter((k) => merged.features[k] === false);
        const expectedWarnings = Array.isArray(merged.warnings) ? merged.warnings : [];
        const expectedStage = entry.stage || null;

        let actualOutcome;
        let actualStage = null;
        let actualWarnings = [];
        try {
          const result = pInfo.pipeline.parse(entry.text, {
            features,
            withoutFeatures,
            elisionOnly: merged.elisionOnly,
          });
          actualOutcome = result.ok
            ? "accepted"
            : result.error.kind === "ambiguous"
              ? "tie"
              : result.error.kind;
          actualStage = result.ok ? null : result.error.stage || null;
          actualWarnings = [...new Set((result.warnings || []).map((w) => w.code))];
        } catch (error) {
          actualOutcome = error && error.name === "GencmuError" ? error.kind : "internal";
          actualStage = (error && error.where && error.where.stage) || null;
        }

        const outcomeMatch = actualOutcome === entry.expect;
        const stageMatch =
          expectedStage === null
            ? !STAGE_REQUIRED_EXPECTS.has(actualOutcome)
            : actualStage === expectedStage;
        const warningsMatch =
          actualOutcome !== "accepted"
            ? expectedWarnings.length === 0
            : expectedWarnings.length === actualWarnings.length &&
              expectedWarnings.every((code) => actualWarnings.includes(code));

        const ok = outcomeMatch && stageMatch && warningsMatch;
        if (!ok) {
          const expectedDesc = formatOutcomeDesc(entry.expect, expectedStage, expectedWarnings);
          const actualDesc = formatOutcomeDesc(actualOutcome, actualStage, actualWarnings);
          problems.push(`${file} (${entry.id}, ${p}): expected ${expectedDesc}, got ${actualDesc}`);
        }
        runs.push({
          file,
          id: entry.id,
          title: entry.title,
          pipeline: p,
          expectedOutcome: entry.expect,
          actualOutcome,
          expectedStage,
          actualStage,
          expectedWarnings,
          actualWarnings,
          ok,
        });
      }
    }
  });

  return { problems, runs };
}

export function checkExampleFile(file, family, rawText, context, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return {
      problems: [`${file} (file): invalid JSON: ${error.message}`],
      runs: [],
    };
  }
  return checkExampleEntries(file, family, parsed, context, options);
}

export function exampleProblems(root, options = {}) {
  const context = options.context || createExampleContext(root, options);
  const grammarsDir = path.join(root, "grammars");
  const problems = [];
  const runs = [];

  const findExampleFiles = (dir, prefix = "") => {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        for (const item of findExampleFiles(path.join(dir, entry.name), rel + "/")) files.push(item);
      } else if (entry.name === "examples.json") {
        files.push(`grammars/${rel}`);
      }
    }
    return files;
  };

  for (const file of findExampleFiles(grammarsDir)) {
    const match = /^grammars\/([^/]+)\/examples\.json$/.exec(file);
    if (!match) {
      problems.push(`${file} (file): examples.json must be at grammars/FAMILY/examples.json`);
      continue;
    }
    const family = match[1];
    const rawText = context.readSource(file);
    const result = checkExampleFile(file, family, rawText, context, options);
    for (const problem of result.problems) problems.push(problem);
    for (const run of result.runs) runs.push(run);
  }

  return { problems, runs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { problems, runs } = exampleProblems(root, { runExamples: true });
  for (const run of runs) {
    const stageStr = run.actualStage ? ` (${run.actualStage})` : "";
    const warnStr = run.actualWarnings.length ? ` warnings=[${run.actualWarnings.join(",")}]` : "";
    console.log(
      `${run.ok ? "PASS" : "FAIL"} ${run.file} ${run.id} on ${run.pipeline}: ${run.actualOutcome}${stageStr}${warnStr}`
    );
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Checked ${runs.length} example runs across ${new Set(runs.map((r) => r.file)).size} files: 0 problems.`);
}
