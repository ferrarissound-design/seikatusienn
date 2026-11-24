import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveBasePath } from "./scripts/base-path.mjs";
export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode),
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "cloud";
          if (id.includes("zod")) return "validation";
          if (id.includes("dexie")) return "storage";
          if (id.includes("/react")) return "react";
        },
      },
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
}));
