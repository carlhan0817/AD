// app/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
    },
  },
});
