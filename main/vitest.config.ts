import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
    },
  },
});
