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
  // 强制 preload 输出为 .js(CJS):包是 "type":"module",默认会出 .mjs,
  // 而 main 进程按 ../preload/index.js 引用——Electron preload 沙箱也更稳用 CJS。
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: "src/preload/index.ts",
        output: { format: "cjs", entryFileNames: "index.js" },
      },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: "src/renderer/index.html" } },
  },
});
