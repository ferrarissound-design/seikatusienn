import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const assets = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/apple-touch-icon.png",
  "/icon.svg",
  ...readdirSync("dist/assets").map((n) => "/assets/" + n),
];
const hash = createHash("sha256");
for (const f of assets.filter((x) => x !== "/"))
  hash.update(readFileSync("dist" + f));
const sw = readFileSync("public/sw.js", "utf8")
  .replace("__BUILD_ID__", hash.digest("hex").slice(0, 12))
  .replace("__PRECACHE_ASSETS__", JSON.stringify(assets));
writeFileSync("dist/sw.js", sw);
