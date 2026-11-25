// The shared cases of tests/engine and tests/notation on the format 50
// loader, through their format 50 translations. A case that does not pass
// is a todo with its cause. Set SHARED50_LIMIT to run fewer cases.
import test from "node:test";
import { sharedFiles, sharedOutcome, runSharedOutcome } from "./shared50.js";

const limit = Number(process.env.SHARED50_LIMIT ?? Infinity);
for (const family of ["engine", "notation"]) {
  for (const file of sharedFiles(family).slice(0, limit)) {
    let outcome, run;
    try {
      outcome = sharedOutcome(family, file);
      run = runSharedOutcome(outcome);
    } catch (error) {
      run = { status: "fail", detail: `crash: ${String(error?.message ?? error)}` };
    }
    const name = `shared ${family}/${file}`;
    if (run.status === "pass") test(name, () => {});
    else if (run.status === "skip") test(name, { skip: run.detail.slice(0, 200) }, () => {});
    else test(name, { todo: run.detail.slice(0, 200) }, () => {});
  }
}
