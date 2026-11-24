import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBasePath,
  resolveBasePath,
} from "../../scripts/base-path.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("deployment base configuration", () => {
  it("keeps the default Vercel root and normalizes Pages directories", () => {
    expect(normalizeBasePath()).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath(" /seikatusienn ")).toBe("/seikatusienn/");
    expect(normalizeBasePath("/seikatusienn/")).toBe("/seikatusienn/");
  });
  it("rejects origins, traversal, query strings and ambiguous double slashes", () => {
    for (const path of [
      "https://example.test/",
      "//example.test/",
      "/a/../",
      "/a/./",
      "/app?x=1",
      "/app#one",
      "/app\\child",
      "/app//",
    ]) {
      expect(() => normalizeBasePath(path)).toThrow("VITE_BASE_PATH");
    }
  });
  it("uses the same env files and process override for Vite and worker builds", () => {
    const directory = mkdtempSync(join(tmpdir(), "life-partner-base-"));
    try {
      writeFileSync(
        join(directory, ".env.production"),
        "VITE_BASE_PATH=/from-env-file/\n",
      );
      vi.stubEnv("VITE_BASE_PATH", undefined);
      expect(resolveBasePath("production", directory)).toBe("/from-env-file/");
      vi.stubEnv("VITE_BASE_PATH", "/seikatusienn/");
      expect(resolveBasePath("production", directory)).toBe("/seikatusienn/");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("manifest install URLs stay inside the directory hosting the manifest", () => {
    const manifest = JSON.parse(
      readFileSync("public/manifest.webmanifest", "utf8"),
    );
    for (const base of ["/", "/seikatusienn/"]) {
      const origin = "https://example.test";
      const url = origin + base + "manifest.webmanifest";
      for (const key of ["start_url", "scope"])
        expect(new URL(manifest[key], url).href).toBe(origin + base);
      // Explicit id resolves against the start URL origin; omitting it uses
      // the resolved start_url, preserving distinct identities on GitHub Pages.
      const startUrl = new URL(manifest.start_url, url);
      const identity = manifest.id ? new URL(manifest.id, startUrl.origin) : startUrl;
      expect(identity.href).toBe(origin + base);
      for (const icon of manifest.icons)
        expect(new URL(icon.src, url).pathname.startsWith(base)).toBe(true);
    }
  });
});

function workerHarness(base: string) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const assets = [base, base + "index.html", base + "assets/app.js"];
  const cachePrefix = "life-partner-" + encodeURIComponent(base) + "-";
  const cacheName = cachePrefix + "test-build";
  const addAll = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn().mockResolvedValue("cached app shell");
  const remove = vi.fn().mockResolvedValue(true);
  const claim = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  const cacheKeys = [
    cacheName,
    cachePrefix + "old-build",
    "life-partner-" + encodeURIComponent("/other-app/") + "-build",
    "unrelated-cache",
  ];
  const template = readFileSync("public/sw.js", "utf8")
    .replace("__BASE_PATH__", JSON.stringify(base))
    .replace("__BUILD_ID__", "test-build")
    .replace("__PRECACHE_ASSETS__", JSON.stringify(assets));
  runInNewContext(template, {
    URL,
    fetch,
    caches: {
      open: vi.fn().mockResolvedValue({ addAll }),
      match,
      keys: vi.fn().mockResolvedValue(cacheKeys),
      delete: remove,
    },
    self: {
      location: { origin: "https://example.test" },
      clients: { claim },
      skipWaiting: vi.fn(),
      addEventListener: (
        event: string,
        handler: (event: Record<string, unknown>) => void,
      ) => {
        handlers[event] = handler;
      },
    },
  });
  return { handlers, assets, cachePrefix, addAll, match, remove, claim, fetch };
}

describe("service worker subpath behavior", () => {
  it("precaches only its own app directory", async () => {
    const harness = workerHarness("/seikatusienn/");
    let done: Promise<unknown> | undefined;
    harness.handlers.install({
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    expect(harness.addAll).toHaveBeenCalledWith(harness.assets);
  });
  it("offline navigation falls back to the app directory shell", async () => {
    for (const base of ["/", "/seikatusienn/"]) {
      const harness = workerHarness(base);
      let response: Promise<unknown> | undefined;
      harness.handlers.fetch({
        request: {
          method: "GET",
          mode: "navigate",
          url: "https://example.test" + base,
        },
        respondWith: (promise: Promise<unknown>) => {
          response = promise;
        },
      });
      expect(await response).toBe("cached app shell");
      expect(harness.match).toHaveBeenCalledWith(base + "index.html");
    }
  });
  it("does not intercept requests for another Pages app", () => {
    const harness = workerHarness("/seikatusienn/");
    const respondWith = vi.fn();
    harness.handlers.fetch({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://example.test/other-app/",
      },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });
  it("updates remove only old caches from the same app scope", async () => {
    const harness = workerHarness("/seikatusienn/");
    let done: Promise<unknown> | undefined;
    harness.handlers.activate({
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    expect(harness.remove).toHaveBeenCalledExactlyOnceWith(
      harness.cachePrefix + "old-build",
    );
    expect(harness.claim).toHaveBeenCalledOnce();
  });
});
