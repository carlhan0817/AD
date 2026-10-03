# 阶段 5 · 升级(可选)实现计划 — NN 识别 / LLM 解释层

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。前置:阶段 1–4 已落地(pHash 识别、状态机、打分内核、overlay 全链路 = MVP 闭环)。先读计划书 §五/§七。**本阶段可选,触发条件明确——不满足就不做。**

**Goal:** 两个互相独立、均不得拖慢关键路径的增强:**5a NN 识别**(pHash 在缩放/光照下遇鲁棒性瓶颈时,用 ONNX 分类器替换/兜底)与 **5b LLM 解释层**(把阶段 3 已产出的结构化 `breakdown` 转成可读、grounded 的解释,异步惰性,不进排序关键路径)。

**Architecture:** 5a 与 5b 各自独立,可单独做。
- **5a:** `pipeline/` 收集/标注图标 → PyTorch 训练分类器 → 导出 ONNX 到 `models/onnx/`;`main/` 用 ONNX Runtime + DirectML 独立 worker 加载,**与 pHash 同接口**(输入 32×32 灰度格,输出 valveId),做替换或兜底。关键:NN 推理在 worker 线程,不阻塞捕获循环。
- **5b:** `core/` 纯函数把 `ScoredCandidate.breakdown` 渲染成结构化解释文本模板(grounded、确定性、可测);可选地由本地 Ollama/云端小模型润色。LLM 只读结构化理由、只解释、不改排序、异步。

**Tech Stack:** 5a:Python(PyTorch、ONNX 导出)+ TS(onnxruntime-node + DirectML、worker_threads);5b:TS(模板渲染纯函数)+ 可选 Ollama HTTP。Vitest / pytest。

---

## 触发条件(不满足则跳过整阶段)

- **5a NN 识别**:仅当 pHash 在真实对局中**确实**遇到缩放/光照鲁棒性瓶颈(误识别率超标)才上。MVP 用 pHash 通常够(计划书 §七)。**不要为做而做。**
- **5b LLM 解释层**:仅当需要提升推荐可读性、且能保证「不臆造 + 不拖慢每手 5 秒窗口」时才上。

---

## 关键设计决策

- **NN 与 pHash 同接口、可热替换。** 定义统一 `Recognizer` 接口(`recognize(cell32) → Match | null`),pHash 与 NN 都实现它。替换/兜底是注入不同实现,捕获循环不感知。
- **NN 推理离开热路径主线程。** ONNX Runtime 在 `worker_threads`,主线程只发 32×32 灰度、收 valveId,避免阻塞捕获循环(计划书 §三/§七)。
- **LLM 不进关键路径。** 排序由阶段 3 确定性完成;解释层是排序**之后**的异步、惰性渲染。即便 LLM 超时/失败,也回落到确定性模板文本——推荐永远先于解释存在。
- **解释必须 grounded。** LLM 输入只能是阶段 3 的结构化 `breakdown`(各信号贡献),禁止让它自由发挥编造未在数据中的理由。模板层先产出 grounded 事实句,LLM 仅润色措辞。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `shared/types/recognizer.ts` | 统一 `Recognizer` 接口(pHash 与 NN 共用) |
| `core/src/recognition/phash_recognizer.ts` | 把阶段 1 的 `recognizeCell` 包成 `Recognizer` |
| `pipeline/src/ad_pipeline/train/dataset.py` | 收集/标注图标数据集(从 CDN sprite 合成增广) |
| `pipeline/src/ad_pipeline/train/train.py` | PyTorch 训练分类器 + 导出 ONNX |
| `pipeline/src/ad_pipeline/train/labels.py` | classIndex ↔ valveId 映射(导出到 json) |
| `main/src/recognition/onnx_worker.ts` | worker:加载 ONNX,推理 32×32 → classIndex |
| `main/src/recognition/onnx_recognizer.ts` | `Recognizer` 实现:主线程侧,与 worker 通信 |
| `core/src/explain/template.ts` | 由 `breakdown` 渲染 grounded 解释文本(纯函数) |
| `core/src/explain/llm.ts` | 可选 LLM 润色(异步、超时回落模板) |

---

# 5a · NN 识别

## Task 1: 统一 Recognizer 接口 + pHash 适配(shared + core)

先抽象出 pHash 与 NN 共用的接口,使后续替换是注入不同实现。

**Files:**
- Create: `shared/types/recognizer.ts`
- Modify: `shared/package.json`(加 exports)
- Create: `core/src/recognition/phash_recognizer.ts`
- Test: `core/tests/recognition/phash_recognizer.test.ts`

- [ ] **Step 1: 写接口**

```ts
// shared/types/recognizer.ts
// 统一识别接口:pHash 与 NN 都实现它,捕获循环对实现无知(可热替换/兜底)。
export interface RecognitionResult {
  valveId: number;
  /** 置信度量纲随实现不同(pHash: 越小越好的距离取负;NN: softmax 概率)。统一为「越大越可信」。 */
  confidence: number;
}

export interface Recognizer {
  /** 输入 32×32 灰度;无可信匹配返回 null。 */
  recognize(cell32: number[][]): RecognitionResult | null;
}
```

`shared/package.json` exports 加:`"./types/recognizer": "./types/recognizer.ts"`

- [ ] **Step 2: 写 pHash 适配失败测试**

```ts
// core/tests/recognition/phash_recognizer.test.ts
import { describe, it, expect } from "vitest";
import { PhashRecognizer } from "../../src/recognition/phash_recognizer";
import type { IndexEntry } from "../../src/recognition/index_store";

const index: IndexEntry[] = [
  { valveId: -9, shortName: "mirana", phash: "0000000000000000" },
  { valveId: 5048, shortName: "mirana_arrow", phash: "ffffffffffffffff" },
];
function solid(v: number): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(v));
}

describe("PhashRecognizer", () => {
  it("implements Recognizer, returns matched valveId with confidence", () => {
    const rec = new PhashRecognizer(index, 6);
    const r = rec.recognize(solid(128)); // → phash 0000... → -9
    expect(r?.valveId).toBe(-9);
    expect(r?.confidence).toBeGreaterThan(0); // 距离 0 → 高置信
  });
  it("returns null past maxDistance", () => {
    const rec = new PhashRecognizer([{ valveId: 1, shortName: "x", phash: "ffffffffffffffff" }], 3);
    expect(rec.recognize(solid(128))).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run:`npx vitest run recognition/phash_recognizer`
Expected: FAIL,模块不存在。

- [ ] **Step 4: 最小实现**

```ts
// core/src/recognition/phash_recognizer.ts
// 把阶段 1 的 recognizeCell 包成统一 Recognizer。confidence = (maxDistance - distance)/maxDistance。
import type { Recognizer, RecognitionResult } from "@ad/shared/types/recognizer";
import { recognizeCell } from "./recognize";
import type { IndexEntry } from "./index_store";

export class PhashRecognizer implements Recognizer {
  constructor(private index: IndexEntry[], private maxDistance = 10) {}
  recognize(cell32: number[][]): RecognitionResult | null {
    const m = recognizeCell(cell32, this.index, this.maxDistance);
    if (!m) return null;
    return { valveId: m.valveId, confidence: (this.maxDistance - m.distance) / this.maxDistance };
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:`npx vitest run recognition/phash_recognizer`
Expected: PASS(2 passed)。

- [ ] **Step 6: Commit**

```bash
git add shared/types/recognizer.ts shared/package.json core/src/recognition/phash_recognizer.ts core/tests/recognition/phash_recognizer.test.ts
git commit -m "feat(core): unified Recognizer interface + pHash adapter"
```

---

## Task 2: 标签映射 + 数据集合成(pipeline/train/)

classIndex ↔ valveId 映射(NN 输出 classIndex,系统要 valveId);从 CDN sprite 合成增广训练集(缩放/亮度/噪声扰动模拟实战鲁棒性问题)。

**Files:**
- Create: `pipeline/src/ad_pipeline/train/__init__.py`(空)
- Create: `pipeline/src/ad_pipeline/train/labels.py`
- Create: `pipeline/src/ad_pipeline/train/dataset.py`
- Test: `pipeline/tests/test_train_labels.py`

- [ ] **Step 1: 写 labels 失败测试**

```python
# pipeline/tests/test_train_labels.py
from ad_pipeline.train.labels import build_label_map, valve_id_for_class

def test_label_map_round_trips_valve_ids():
    valve_ids = [5051, -9, 5048]
    m = build_label_map(valve_ids)
    # class_index 连续从 0;两向可查
    assert set(m["class_to_valve"].values()) == {5051, -9, 5048}
    assert valve_id_for_class(m, m["valve_to_class"][5048]) == 5048

def test_label_map_is_deterministic():
    a = build_label_map([5051, -9, 5048])
    b = build_label_map([5048, 5051, -9])  # 不同顺序
    # 排序后类索引应一致(可复现训练)
    assert a["valve_to_class"] == b["valve_to_class"]
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `pipeline/` 下):`python -m pytest tests/test_train_labels.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/train/__init__.py
__all__ = []
```

```python
# pipeline/src/ad_pipeline/train/labels.py
"""classIndex ↔ valveId 映射。NN 输出 classIndex,系统消费 valveId。"""

def build_label_map(valve_ids: list[int]) -> dict:
    ordered = sorted(set(valve_ids))  # 排序 → 可复现
    valve_to_class = {vid: i for i, vid in enumerate(ordered)}
    class_to_valve = {i: vid for vid, i in valve_to_class.items()}
    return {"valve_to_class": valve_to_class, "class_to_valve": class_to_valve}

def valve_id_for_class(label_map: dict, class_index: int) -> int:
    return label_map["class_to_valve"][class_index]
```

```python
# pipeline/src/ad_pipeline/train/dataset.py
"""从 CDN sprite 合成增广数据集:缩放/亮度/噪声,模拟实战鲁棒性问题。
   纯增广逻辑可测;真实训练读 models/templates/sprites/ 下的图。"""
import random

def augment_gray(gray: list[list[int]], *, scale_jitter=0.1, brightness=20, rng=None) -> list[list[int]]:
    """对一张 32×32 灰度做亮度+噪声扰动(缩放在调用前用阶段 1 resize 完成)。"""
    r = rng or random.Random(0)
    b = r.randint(-brightness, brightness)
    out = []
    for row in gray:
        out.append([max(0, min(255, v + b + r.randint(-5, 5))) for v in row])
    return out
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_train_labels.py -q`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/train/ pipeline/tests/test_train_labels.py
git commit -m "feat(pipeline): NN label map + dataset augmentation"
```

---

## Task 3: 训练 + 导出 ONNX(pipeline/train/train.py)——手动,需 PyTorch + 真图

训练一个 MobileNet 量级小分类器,导出 ONNX 到 `models/onnx/recognizer.onnx` + 旁路 `labels.json`。需 GPU/真图,**手动跑**;但导出后的 ONNX 形状契约用一个小测试守住(用随机权重导一个 dummy ONNX 验证 I/O 形状)。

**Files:**
- Create: `pipeline/src/ad_pipeline/train/train.py`
- Modify: `pipeline/pyproject.toml`(加可选 `train` 依赖组:`torch`、`onnx`)
- Test: `pipeline/tests/test_onnx_export_shape.py`(标 `@pytest.mark.train`,默认跳过)

- [ ] **Step 1: 注册 marker + 写形状契约测试**

`pyproject.toml` 的 markers 加:`"train: needs torch (skipped by default)"`;`addopts` 改为 `-m 'not live and not train'`;加可选依赖:
```toml
[project.optional-dependencies]
train = ["torch>=2.2", "onnx>=1.16"]
```

```python
# pipeline/tests/test_onnx_export_shape.py
import pytest

@pytest.mark.train
def test_exported_onnx_io_shape(tmp_path):
    import numpy as np, onnxruntime as ort
    from ad_pipeline.train.train import export_dummy_onnx
    path = tmp_path / "r.onnx"
    export_dummy_onnx(path, num_classes=5)
    sess = ort.InferenceSession(str(path))
    inp = sess.get_inputs()[0]
    # 输入 [1,1,32,32] 灰度;输出 [1,5] logits
    assert inp.shape[-1] == 32 and inp.shape[-2] == 32
    out = sess.run(None, {inp.name: np.zeros((1, 1, 32, 32), dtype=np.float32)})
    assert out[0].shape == (1, 5)
```

- [ ] **Step 2: 实现 train.py(含 dummy 导出供形状测试)**

```python
# pipeline/src/ad_pipeline/train/train.py
"""训练分类器 + 导出 ONNX。真实训练手动跑(需 GPU/真图);export_dummy_onnx 供形状契约测试。"""
from pathlib import Path

def _build_model(num_classes: int):
    import torch.nn as nn
    # MobileNet 量级:小 CNN 足够区分固定 sprite。
    return nn.Sequential(
        nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),  # 32→16
        nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), # 16→8
        nn.Flatten(), nn.Linear(32 * 8 * 8, num_classes),
    )

def export_dummy_onnx(path: Path, num_classes: int) -> None:
    """随机权重导出,只为验证 I/O 形状契约([1,1,32,32]→[1,num_classes])。"""
    import torch
    model = _build_model(num_classes).eval()
    dummy = torch.zeros(1, 1, 32, 32)
    torch.onnx.export(
        model, dummy, str(path),
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    )

# 真实训练入口(手动):读增广数据集 → 训练 _build_model → 导出 ONNX + labels.json。
# def train_and_export(sprite_dir, out_onnx, out_labels, epochs=20): ...
```

- [ ] **Step 3: 默认套件跳过 train;手动跑形状测试(需装 train 依赖)**

Run:`python -m pytest -q`
Expected: 全绿,train 测试 deselected。
Run(手动,装好 torch+onnx+onnxruntime 后):`python -m pytest -m train -q`
Expected: PASS(导出的 ONNX I/O 形状符合契约)。

- [ ] **Step 4: Commit**

```bash
git add pipeline/src/ad_pipeline/train/train.py pipeline/pyproject.toml pipeline/tests/test_onnx_export_shape.py
git commit -m "feat(pipeline): classifier model + ONNX export with shape contract test"
```

---

## Task 4: ONNX Recognizer(main/)——worker 线程,不阻塞热路径

`main/` 侧用 onnxruntime-node(DirectML)在 worker 线程加载 ONNX;主线程的 `OnnxRecognizer` 实现统一 `Recognizer` 接口,与 worker 通信。**手动冒烟**(需真 ONNX + Windows GPU);worker 消息协议的纯部分(序列化 32×32、解析 logits→valveId)单测。

**Files:**
- Create: `main/src/recognition/onnx_protocol.ts`(纯:logits→valveId via argmax + 阈值 + label map)
- Create: `main/src/recognition/onnx_worker.ts`(worker:加载并推理)
- Create: `main/src/recognition/onnx_recognizer.ts`(主线程 Recognizer)
- Test: `main/tests/recognition/onnx_protocol.test.ts`

- [ ] **Step 1: 写协议纯函数失败测试**

```ts
// main/tests/recognition/onnx_protocol.test.ts
import { describe, it, expect } from "vitest";
import { argmaxToValveId, softmaxMax } from "../../src/recognition/onnx_protocol";

const labelMap = { 0: 5051, 1: -9, 2: 5048 } as Record<number, number>;

describe("onnx protocol", () => {
  it("maps argmax class to valveId", () => {
    expect(argmaxToValveId([0.1, 0.7, 0.2], labelMap, 0.5)).toEqual({ valveId: -9, confidence: expect.any(Number) });
  });
  it("returns null below confidence threshold", () => {
    expect(argmaxToValveId([0.34, 0.33, 0.33], labelMap, 0.5)).toBeNull();
  });
  it("softmaxMax is in (0,1]", () => {
    const p = softmaxMax([2, 1, 0]);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `main/` 下):`npx vitest run recognition/onnx_protocol`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现协议层**

```ts
// main/src/recognition/onnx_protocol.ts
// logits → valveId 的纯转换(argmax + softmax 阈值 + label map)。worker 与主线程共用。
import type { RecognitionResult } from "@ad/shared/types/recognizer";

export function softmaxMax(logits: number[]): number {
  const m = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Math.max(...exps) / sum;
}

export function argmaxToValveId(
  logits: number[], labelMap: Record<number, number>, threshold: number,
): RecognitionResult | null {
  let bestI = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[bestI]) bestI = i;
  const conf = softmaxMax(logits);
  if (conf < threshold) return null;
  return { valveId: labelMap[bestI], confidence: conf };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/onnx_protocol`
Expected: PASS(3 passed)。

- [ ] **Step 5: 实现 worker + 主线程 recognizer(手动冒烟,不纯测)**

```ts
// main/src/recognition/onnx_worker.ts
// worker 线程:加载 ONNX(DirectML),收 Float32 32×32,回 logits。不阻塞主线程捕获循环。
import { parentPort, workerData } from "node:worker_threads";
import * as ort from "onnxruntime-node";

let session: ort.InferenceSession | null = null;

async function init() {
  session = await ort.InferenceSession.create(workerData.onnxPath, {
    executionProviders: ["dml"], // DirectML;不可用时回退 cpu
  });
  parentPort!.postMessage({ type: "ready" });
}

parentPort!.on("message", async (msg: { type: string; cell?: number[] }) => {
  if (msg.type === "init") return init();
  if (msg.type === "infer" && session && msg.cell) {
    const input = new ort.Tensor("float32", Float32Array.from(msg.cell), [1, 1, 32, 32]);
    const out = await session.run({ input });
    parentPort!.postMessage({ type: "logits", logits: Array.from(out.logits.data as Float32Array) });
  }
});
```

```ts
// main/src/recognition/onnx_recognizer.ts
// 主线程 Recognizer:把 32×32 发给 worker,异步收 logits → valveId。
// 注:本类 recognize 为同步接口的兼容包装——实际走异步 inferAsync;
// 捕获循环用 inferAsync,避免阻塞(同步 recognize 仅用于离线评测)。
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import type { Recognizer, RecognitionResult } from "@ad/shared/types/recognizer";
import { argmaxToValveId } from "./onnx_protocol";

export class OnnxRecognizer implements Recognizer {
  private worker: Worker;
  private labelMap: Record<number, number>;
  constructor(onnxPath: string, labelsPath: string, private threshold = 0.6) {
    this.labelMap = JSON.parse(readFileSync(labelsPath, "utf-8")).class_to_valve;
    this.worker = new Worker(new URL("./onnx_worker.js", import.meta.url), { workerData: { onnxPath } });
    this.worker.postMessage({ type: "init" });
  }
  async inferAsync(cell32: number[][]): Promise<RecognitionResult | null> {
    const flat = cell32.flat().map((v) => v / 255);
    return new Promise((resolve) => {
      const onMsg = (m: { type: string; logits?: number[] }) => {
        if (m.type === "logits" && m.logits) {
          this.worker.off("message", onMsg);
          resolve(argmaxToValveId(m.logits, this.labelMap, this.threshold));
        }
      };
      this.worker.on("message", onMsg);
      this.worker.postMessage({ type: "infer", cell: flat });
    });
  }
  recognize(): RecognitionResult | null {
    throw new Error("use inferAsync in hot path; sync recognize unsupported for NN");
  }
}
```

- [ ] **Step 6: 手动冒烟(需真 ONNX + Windows DirectML)**

准备:Task 3 真实训练导出 `models/onnx/recognizer.onnx` + `labels.json`;装 `onnxruntime-node`。
写个小脚本喂一张已知 sprite 的 32×32,断言识别回正确 valveId,且推理在 worker 不阻塞主循环(主循环 tick 不被卡)。
Expected(验收门,计划书 §十阶段 5):识别**鲁棒性提升**(对缩放/亮度扰动样本比 pHash 更稳),**识别延迟仍在预算内**(worker 异步,主循环不卡)。

- [ ] **Step 7: Commit**

```bash
git add main/src/recognition/onnx_protocol.ts main/src/recognition/onnx_worker.ts main/src/recognition/onnx_recognizer.ts main/tests/recognition/onnx_protocol.test.ts
git commit -m "feat(main): ONNX recognizer in worker thread (DirectML), pHash-compatible"
```

---

# 5b · LLM 解释层

## Task 5: grounded 解释模板(core/src/explain/template.ts)——纯函数,确定性

把阶段 3 的 `ScoredCandidate.breakdown` 渲染成 grounded 解释句:只陈述数据中存在的贡献(哪个信号贡献多少),不编造。这是确定性回落文本——即便不接 LLM 也能用。

**Files:**
- Create: `core/src/explain/template.ts`
- Test: `core/tests/explain/template.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/explain/template.test.ts
import { describe, it, expect } from "vitest";
import { explainGrounded } from "../../src/explain/template";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const sc: ScoredCandidate = {
  candidate: { valveId: 5052, slotType: "normal" },
  score: 0.32,
  breakdown: { base: 0.08, synergy: 0.20, pos: 0.04 },
};

describe("explainGrounded", () => {
  it("names the dominant signal first", () => {
    const text = explainGrounded(sc);
    expect(text).toContain("synergy"); // 最大贡献
    // 主导信号应排在解释最前
    expect(text.indexOf("synergy")).toBeLessThan(text.indexOf("base"));
  });
  it("only mentions signals actually present in breakdown (grounded, no invention)", () => {
    const text = explainGrounded(sc);
    expect(text).not.toContain("aghs"); // 不在 breakdown 里 → 不得出现
  });
  it("handles empty breakdown gracefully", () => {
    const empty: ScoredCandidate = { candidate: { valveId: 1, slotType: "normal" }, score: 0, breakdown: {} };
    expect(explainGrounded(empty)).toMatch(/no scoring signals|无打分信号/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `core/` 下):`npx vitest run explain/template`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/explain/template.ts
// 由 breakdown 渲染 grounded 解释。只陈述数据中存在的贡献,按贡献降序。确定性、可测。
import type { ScoredCandidate, SignalId } from "@ad/shared/types/scoring";

export function explainGrounded(sc: ScoredCandidate): string {
  const entries = (Object.entries(sc.breakdown) as [SignalId, number][])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "no scoring signals contributed (无打分信号)";
  const parts = entries.map(([id, v]) => `${id} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
  return `candidate ${sc.candidate.valveId}: ${parts.join(", ")} (total ${sc.score.toFixed(2)})`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run explain/template`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/explain/template.ts core/tests/explain/template.test.ts
git commit -m "feat(core): grounded explanation template from scoring breakdown"
```

---

## Task 6: 可选 LLM 润色(core/src/explain/llm.ts)——异步、超时回落模板

LLM 只读 grounded 模板文本,润色措辞;超时/失败回落到模板。**不进排序关键路径**:解释在排序之后异步触发。可注入 fake LLM 客户端测「超时回落」与「grounded 约束」。

**Files:**
- Create: `core/src/explain/llm.ts`
- Test: `core/tests/explain/llm.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// core/tests/explain/llm.test.ts
import { describe, it, expect } from "vitest";
import { explainWithLlm, type LlmClient } from "../../src/explain/llm";
import type { ScoredCandidate } from "@ad/shared/types/scoring";

const sc: ScoredCandidate = {
  candidate: { valveId: 5052, slotType: "normal" },
  score: 0.3, breakdown: { synergy: 0.2, base: 0.1 },
};

const fastClient: LlmClient = { complete: async (prompt) => `polished: ${prompt.slice(0, 10)}` };
const slowClient: LlmClient = { complete: () => new Promise((r) => setTimeout(() => r("late"), 1000)) };
const failClient: LlmClient = { complete: async () => { throw new Error("down"); } };

describe("explainWithLlm", () => {
  it("returns polished text when LLM responds in time", async () => {
    const out = await explainWithLlm(sc, fastClient, 200);
    expect(out).toContain("polished:");
  });
  it("falls back to grounded template on timeout", async () => {
    const out = await explainWithLlm(sc, slowClient, 50);
    expect(out).toContain("synergy"); // 模板回落
  });
  it("falls back to grounded template on LLM error", async () => {
    const out = await explainWithLlm(sc, failClient, 200);
    expect(out).toContain("synergy");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run explain/llm`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/explain/llm.ts
// 可选 LLM 润色:输入只能是 grounded 模板(不让 LLM 自由发挥)。超时/失败回落模板。
// 异步、惰性,绝不进排序关键路径(计划书 §三/§五)。
import type { ScoredCandidate } from "@ad/shared/types/scoring";
import { explainGrounded } from "./template";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("llm timeout")), ms)),
  ]);
}

export async function explainWithLlm(
  sc: ScoredCandidate, client: LlmClient, timeoutMs: number,
): Promise<string> {
  const grounded = explainGrounded(sc);
  try {
    // prompt 仅含 grounded 事实,要求 LLM 只润色不新增理由。
    const prompt = `Rephrase concisely, do not add facts: ${grounded}`;
    return await withTimeout(client.complete(prompt), timeoutMs);
  } catch {
    return grounded; // 超时/失败 → 确定性回落
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run explain/llm`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/explain/llm.ts core/tests/explain/llm.test.ts
git commit -m "feat(core): optional LLM explanation polish with grounded fallback"
```

---

## 阶段 5 验收清单(对应计划书 §十「阶段 5」)

**通用门:**
- [ ] 默认 `npm test`(core/main)+ `python -m pytest -q`(pipeline)全绿;train/live 测试默认 deselected。
- [ ] **不拖慢关键路径** —— NN 推理在 worker 异步(`inferAsync`);LLM 解释异步、超时回落,排序仍由阶段 3 确定性完成。

**5a NN 识别(若触发):**
- [ ] 统一 `Recognizer` 接口落地,pHash 与 ONNX 都实现 → 可热替换/兜底。
- [ ] ONNX I/O 形状契约测试通过(`[1,1,32,32]→[1,N]`)。
- [ ] 协议层 logits→valveId 纯函数测齐(argmax + 阈值 + label map)。
- [ ] 手动冒烟:对缩放/亮度扰动样本**鲁棒性优于 pHash**,延迟在预算内(验收门)。

**5b LLM 解释层(若触发):**
- [ ] grounded 模板纯函数:只陈述 breakdown 中存在的信号,**不臆造**(`template.test.ts`)。
- [ ] LLM 润色异步、超时/失败回落模板(`llm.test.ts`)。
- [ ] 解释只读阶段 3 结构化理由,不改排序、不进关键路径(验收门)。

> **整阶段可选边界:** 5a 与 5b 独立,任一可单独做或都不做。不满足触发条件(pHash 够用 / 不需要解释)时**整阶段跳过**,MVP(阶段 1–4)已是可演示闭环(计划书 §十)。
