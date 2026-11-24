import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolveBasePath } from "./scripts/base-path.mjs";

const base = resolveBasePath();
const files = [
  "index.html",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable.png",
  "apple-touch-icon.png",
  "icon.svg",
  ...readdirSync("dist/assets")
    .sort()
    .map((name) => "assets/" + name),
];
const assets = [base, ...files.map((file) => base + file)];
const template = readFileSync("public/sw.js", "utf8");
const hash = createHash("sha256").update(base).update(template);
for (const file of files) hash.update(readFileSync("dist/" + file));
const sw = template
  .replace("__BASE_PATH__", JSON.stringify(base))
  .replace("__BUILD_ID__", hash.digest("hex").slice(0, 12))
  .replace("__PRECACHE_ASSETS__", JSON.stringify(assets));
writeFileSync("dist/sw.js", sw);
