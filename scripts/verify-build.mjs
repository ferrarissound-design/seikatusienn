import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolveBasePath } from "./base-path.mjs";

const base = resolveBasePath();
const origin = "https://example.test";
const html = readFileSync("dist/index.html", "utf8");
const links = Array.from(
  html.matchAll(/(?:src|href)="([^"]+)"/g),
  (match) => match[1],
);
assert(
  links.some(
    (link) => link.startsWith(base + "assets/") && link.endsWith(".js"),
  ),
  "Production HTML must reference compiled JavaScript.",
);
assert(
  !links.some((link) => link.includes("/src/")),
  "Production HTML must not serve raw TypeScript/TSX.",
);
for (const link of links) {
  assert(
    link.startsWith(base),
    `Resource is outside deployment base ${base}: ${link}`,
  );
  assert(
    existsSync("dist/" + link.slice(base.length)),
    `Missing built resource: ${link}`,
  );
}
for (const resource of [
  "manifest.webmanifest",
  "icon.svg",
  "apple-touch-icon.png",
])
  assert(
    links.includes(base + resource),
    `Missing base-aware HTML link: ${resource}`,
  );
const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
for (const key of ["start_url", "scope"])
  assert.equal(
    new URL(manifest[key], origin + base + "manifest.webmanifest").href,
    origin + base,
  );
const startUrl = new URL(manifest.start_url, origin + base + "manifest.webmanifest");
const identity = manifest.id ? new URL(manifest.id, startUrl.origin) : startUrl;
assert.equal(identity.href, origin + base, "Installed app identity must stay distinct from other Pages apps.");
for (const icon of manifest.icons) {
  const path = new URL(icon.src, origin + base + "manifest.webmanifest")
    .pathname;
  assert(
    path.startsWith(base),
    `Manifest icon escapes deployment directory: ${path}`,
  );
  assert(
    existsSync("dist/" + path.slice(base.length)),
    `Missing install icon: ${path}`,
  );
}
const sw = readFileSync("dist/sw.js", "utf8");
assert(
  !/__BASE_PATH__|__BUILD_ID__|__PRECACHE_ASSETS__/.test(sw),
  "Service worker placeholders must be replaced.",
);
const workerBase = JSON.parse(
  sw.match(/^const BASE_PATH=(.*);$/m)?.[1] ?? "null",
);
const assets = JSON.parse(sw.match(/^const ASSETS=(.*);$/m)?.[1] ?? "null");
assert.equal(
  workerBase,
  base,
  "Vite and service worker must use the same deployment base.",
);
assert(
  Array.isArray(assets) && assets.includes(base + "index.html"),
  "Offline shell must be precached.",
);
for (const asset of assets) {
  assert(
    asset.startsWith(base),
    `Precache asset escapes deployment directory: ${asset}`,
  );
  if (asset !== base)
    assert(
      existsSync("dist/" + asset.slice(base.length)),
      `Missing precache resource: ${asset}`,
    );
}
console.log(
  `Production paths, compiled entry, manifest and offline shell verified for ${base}`,
);
