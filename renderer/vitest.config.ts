// renderer/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
      "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
});
