import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // 本地真帧测试(runtime_frames / board_change_frames / ratio_frames)每个都要跑几分钟分类器,
  // 并行时互相抢 CPU(onnxruntime 各自开满线程),beforeAll 会超时;按文件顺序跑。
  test: { environment: "node", fileParallelism: false },
  resolve: {
    alias: {
      "@ad/core": fileURLToPath(new URL("../core/src", import.meta.url)),
    },
  },
});
