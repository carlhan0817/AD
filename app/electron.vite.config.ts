// app/electron.vite.config.ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const alias = {
  "@ad/shared": fileURLToPath(new URL("../shared", import.meta.url)),
  "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
  "@ad/renderer": fileURLToPath(new URL("../renderer/src", import.meta.url)),
};

export default defineConfig({
  main: { resolve: { alias }, build: { rollupOptions: { input: "src/main/index.ts" } } },
  preload: { resolve: { alias }, build: { rollupOptions: { input: "src/preload/index.ts" } } },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: "src/renderer/index.html" } },
  },
});
