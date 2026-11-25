#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { notation50Resources } from "./notation50-resources.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const { bundle, bootstrap } = notation50Resources(root);
const file = path.join(root, bundle.bootstrap);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, bootstrap);
console.log(`${createHash("sha256").update(bootstrap).digest("hex")}  ${bundle.bootstrap}`);
