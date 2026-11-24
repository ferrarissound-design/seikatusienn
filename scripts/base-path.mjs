import { loadEnv } from "vite";

/** A deployment is always rooted at an absolute, trailing-slash directory. */
export function normalizeBasePath(value = "/") {
  const path = value.trim() || "/";
  if (
    path.includes("//") ||
    !/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*\/?$/.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "VITE_BASE_PATH は / または /seikatusienn/ のような公開先ディレクトリを指定してください。",
    );
  }
  return path === "/" ? "/" : `${path.replace(/\/$/, "")}/`;
}

/** Match Vite's mode/env resolution, including existing process env precedence. */
export function resolveBasePath(mode = "production", cwd = process.cwd()) {
  return normalizeBasePath(loadEnv(mode, cwd, "VITE_").VITE_BASE_PATH);
}
