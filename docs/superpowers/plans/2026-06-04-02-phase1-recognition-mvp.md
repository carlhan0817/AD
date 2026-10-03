# 阶段 1 · 识别 MVP(模板匹配 / 感知哈希)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。前置:阶段 0 已产出 `pipeline/out/reference.db` 与可下载的 CDN 参考图。先读 `...-00-project-structure-and-roadmap.md` §2/§4。

**Goal:** 给定一张选取界面截图(或单个裁好的图标),用感知哈希(pHash)对照参考库识别出它是哪个技能/英雄,产出 `valveId`,并查 DB 得到 `slot_type`。不训练、不标注(计划书 §七 MVP 阶段)。

**Architecture:** 两段。①**离线建索引**(Python,`pipeline/`):下载 CDN 参考图 → 计算每张参考图的 pHash → 写出 `models/templates/phash_index.json`。②**热路径识别核心**(TS,`core/recognition/`):纯函数,加载 pHash 索引,对输入图标算 pHash,按汉明距离取最近邻;含一个 `single-ROI` 裁切器把整帧切成图标格。识别核心零 Electron 依赖,Vitest 可测。截屏(`screenshot-desktop`)只在一个薄 `main/` 入口里,阶段 2 才进捕获循环。

**Tech Stack:** Python 侧 Pillow + 一个自实现的 8×8 DCT pHash(避免额外依赖锁版);TS 侧纯 TypeScript pHash(与 Python 实现位对齐)+ sharp(解码 PNG→灰度像素)+ Vitest。**resize 与 pHash 两个步骤都必须两端逐位对齐**,不复用任何库的内置缩放(Pillow `BILINEAR` 与 sharp/手写缩放各有不同的核与边界处理,直接混用会让两端 DCT 系数发散——见「关键设计决策」与 §「已知问题修正」)。

---

## 关键设计决策

- **resize 与 pHash 都必须两端位对齐**:Python(建索引,缩放 CDN sprite)与 TS(查询,缩放截图裁出的格)各跑一次「缩放到 32×32 → DCT pHash」。**两个步骤都得逐位一致**,汉明距离才有意义。因此:① **不**用任一语言的现成 imagehash 库;② **不**用 Pillow `BILINEAR`、sharp 内置 resize 或最近邻这类「各库实现不同」的缩放——而是双方都实现**同一个明确定义的双线性缩放**(见 Task 1 规格:输入任意尺寸灰度 → 32×32,半像素中心对齐、clamp 边界),再接同一个 8×8 DCT-pHash。最近邻缩放(原 `grid.ts` 的实现)与 Pillow 双线性核完全不同,会让同图两端 DCT 系数发散、中位数漂移、产生大量错位 bit,**直接废掉汉明距离**——这是本阶段最高优先级的一致性约束。
- **中位数比较的浮点临界区**:`v > median` 在 CPython 与 V8 下因 IEEE-754 舍入差异,可能在「系数恰好等于/极接近中位数」时一端判 1、一端判 0。纯色图是最坏情形(全部低频系数≈0、median=0、每个比较都在临界)。缓解:比较改为带 epsilon 的 `v > median + EPS`(两端同一 `EPS`,如 `1e-6`),把临界区统一归零;并以「真实 sprite」而非纯色图做两端交叉验证(见 Task 4 Step 1)。
- **交叉验证必须用真实图、过完整管线**:仅用合成纯色数组喂 `phashFromGray` 无法暴露 resize 分歧(它跳过了缩放)。两端一致性测试必须从**同一张真实 PNG**出发,各自走完「解码灰度 → 32×32 缩放 → pHash」,断言两端 hamming ≤ 阈值(目标 0,容忍 ≤4 应对极少数浮点临界 bit)。
- **参考图键 = valveId**:索引每项 `{valveId, shortName, phash}`。英雄用其负 valveId(`-heroId`),sprite 来自 mini 头像;真实技能用正 valveId,sprite 来自 ability 图。识别输出 valveId 后,`slot_type` 一律查阶段 0 的 `abilities` 表,不在识别层重判(计划书 §一:槽位类型由技能身份决定)。
- **单 ROI(本阶段)**:只做「整帧 → 规则网格裁切成 N 个图标格」的最简版,验证识别管线。多 ROI / Active Picker / frame-diff 是阶段 2。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `pipeline/src/ad_pipeline/phash.py` | 8×8 DCT pHash(Python 权威实现) |
| `pipeline/src/ad_pipeline/build_index.py` | 下载参考图 → 算 pHash → 写 `phash_index.json` |
| `models/templates/phash_index.json` | 产物:`[{valveId, shortName, phash}]` |
| `core/package.json` / `core/tsconfig.json` / `core/vitest.config.ts` | TS 领域核心工程 |
| `core/src/recognition/phash.ts` | TS pHash,与 Python 位对齐 |
| `core/src/recognition/index_store.ts` | 加载 phash_index.json,提供最近邻查询 |
| `core/src/recognition/grid.ts` | 单 ROI:整帧裁成图标格(灰度像素块) |
| `core/src/recognition/recognize.ts` | 编排:像素块 → pHash → 最近邻 → {valveId, distance} |
| `core/src/db/reference.ts` | 只读查 reference.db(better-sqlite3):valveId → slot_type |
| `core/tests/**` | Vitest 测试 |
| `core/tests/fixtures/` | 几张已知 sprite + 期望 phash |

---

## Task 1: Python pHash 权威实现

**Files:**
- Create: `pipeline/src/ad_pipeline/phash.py`
- Test: `pipeline/tests/test_phash.py`

定义(双端共用,**不可偏离**):
1. 输入**已是 32×32 的灰度图**(缩放由独立的共享模块负责,见 Task 1b);本函数不做缩放。
2. 对 32×32 做二维 DCT-II。
3. 取左上 8×8 低频块(含 DC)。
4. 取这 64 值的中位数(**排除 DC 项 [0,0]** 后的 63 个值的中位数);
5. 每个低频值 `> median + EPS` → bit 1,否则 0(`EPS = 1e-6`,两端同值,统一吃掉浮点临界区);行优先展开成 64-bit。
6. 输出 16 位十六进制字符串。

> **拆分说明:** 「缩放」与「pHash」分成两个模块(Task 1b `resize` + Task 1 `phash`),因为这是两端最容易发散的两步,各自独立测+独立交叉验证更稳。`phash_from_gray` 只接收 32×32,职责单一。

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_phash.py
from ad_pipeline.phash import phash_from_gray, hamming

def _solid(value):  # 32x32 纯色灰度,二维 list
    return [[value]*32 for _ in range(32)]

def test_phash_is_16_hex_chars():
    h = phash_from_gray(_solid(128))
    assert isinstance(h, str) and len(h) == 16
    int(h, 16)  # 可解析为十六进制

def test_identical_images_zero_distance():
    a = phash_from_gray(_solid(100))
    b = phash_from_gray(_solid(100))
    assert hamming(a, b) == 0

def test_different_images_nonzero_distance():
    # 左半暗右半亮 vs 纯色,应有差异
    half = [[0]*16 + [255]*16 for _ in range(32)]
    assert hamming(phash_from_gray(half), phash_from_gray(_solid(128))) > 0
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_phash.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/phash.py
"""8x8 DCT 感知哈希(权威实现,TS 端必须位对齐)。无第三方依赖。"""
import math

def _dct_1d(vec: list[float]) -> list[float]:
    n = len(vec)
    out = []
    for k in range(n):
        s = 0.0
        for i in range(n):
            s += vec[i] * math.cos(math.pi * (2*i + 1) * k / (2*n))
        out.append(s)
    return out

def _dct_2d(mat: list[list[float]]) -> list[list[float]]:
    rows = [_dct_1d(r) for r in mat]
    cols = []
    n = len(rows)
    for k in range(len(rows[0])):
        col = _dct_1d([rows[i][k] for i in range(n)])
        cols.append(col)
    # cols[k][i] = 第 k 列的 DCT;转回 [i][k]
    return [[cols[k][i] for k in range(len(cols))] for i in range(n)]

EPS = 1e-6  # 中位数比较的浮点临界带;TS 端必须用同一常量

def phash_from_gray(gray32: list[list[int]]) -> str:
    assert len(gray32) == 32 and len(gray32[0]) == 32
    dct = _dct_2d([[float(v) for v in row] for row in gray32])
    low = [dct[r][c] for r in range(8) for c in range(8)]
    rest = [v for i, v in enumerate(low) if i != 0]  # 排除 DC [0,0]
    rest_sorted = sorted(rest)
    m = len(rest_sorted)
    median = (rest_sorted[m//2] if m % 2 else
              (rest_sorted[m//2 - 1] + rest_sorted[m//2]) / 2)
    bits = 0
    for v in low:
        bits = (bits << 1) | (1 if v > median + EPS else 0)
    return f"{bits:016x}"

def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")
```

> 注:纯色图下 63 个低频项全为 0、median=0,带 EPS 后每个 `0 > 0+1e-6` 为假 → 全 0 → `0000000000000000`(与原期望一致)。

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_phash.py -q`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/phash.py pipeline/tests/test_phash.py
git commit -m "feat(pipeline): authoritative 8x8 DCT phash"
```

---

## Task 1b: 共享双线性缩放(权威实现)

> **这是修掉「两端缩放核不一致」的核心任务。** 不依赖 Pillow `BILINEAR`,不依赖 sharp resize,不用最近邻——双方逐位实现同一个双线性核,接收任意尺寸灰度、输出 32×32 灰度。

**Files:**
- Create: `pipeline/src/ad_pipeline/resize.py`
- Test: `pipeline/tests/test_resize.py`

权威定义(Python 与 TS 必须**逐位一致**):
- 输入:`src`(`H×W` 灰度,int 0–255)、目标 `32×32`。
- 对目标像素 `(ry, rx)`,用**半像素中心对齐**映射回源坐标:
  `sy = (ry + 0.5) * H/32 - 0.5`,`sx = (rx + 0.5) * W/32 - 0.5`。
- `y0 = floor(sy)`,`fy = sy - y0`;`x0 = floor(sx)`,`fx = sx - x0`。
- 四邻点坐标各自 **clamp 到 [0, H-1] / [0, W-1]**(边界外取边缘像素)。
- 双线性插值:
  `top = src[y0c][x0c]*(1-fx) + src[y0c][x1c]*fx`
  `bot = src[y1c][x0c]*(1-fx) + src[y1c][x1c]*fx`
  `val = top*(1-fy) + bot*fy`
- 输出像素 = `round(val)`(banker's? 否——用 `floor(val + 0.5)`,两端同规则,避免 Python `round` 的银行家舍入与 JS `Math.round` 分歧)。

- [ ] **Step 1: 写失败测试**

```python
# pipeline/tests/test_resize.py
from ad_pipeline.resize import resize_gray_to_32

def test_output_is_32x32():
    src = [[100] * 10 for _ in range(10)]
    out = resize_gray_to_32(src)
    assert len(out) == 32 and all(len(r) == 32 for r in out)
    assert all(isinstance(v, int) for v in out[0])

def test_solid_image_preserved():
    src = [[128] * 64 for _ in range(64)]
    out = resize_gray_to_32(src)
    assert all(v == 128 for row in out for v in row)

def test_known_2x2_upscale_center_alignment():
    # 2x2 棋盘放大到 32x32:四角应分别接近四个源值
    src = [[0, 255], [255, 0]]
    out = resize_gray_to_32(src)
    assert out[0][0] == 0       # 左上角对齐源 (0,0)=0
    assert out[0][31] == 255    # 右上角对齐源 (0,1)=255
    assert out[31][0] == 255    # 左下角
    assert out[31][31] == 0     # 右下角
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_resize.py -q`
Expected: FAIL,`ModuleNotFoundError`。

- [ ] **Step 3: 最小实现**

```python
# pipeline/src/ad_pipeline/resize.py
"""权威双线性缩放到 32x32(灰度)。TS 端必须逐位对齐。

半像素中心对齐 + clamp 边界 + floor(v+0.5) 舍入。
不用 Pillow/sharp 的内置 resize——各库核不同会破坏两端 pHash 一致性。
"""
import math

_N = 32


def resize_gray_to_32(src: list[list[int]]) -> list[list[int]]:
    h = len(src)
    w = len(src[0])
    out: list[list[int]] = []
    for ry in range(_N):
        sy = (ry + 0.5) * h / _N - 0.5
        y0 = math.floor(sy)
        fy = sy - y0
        y0c = min(max(y0, 0), h - 1)
        y1c = min(max(y0 + 1, 0), h - 1)
        row: list[int] = []
        for rx in range(_N):
            sx = (rx + 0.5) * w / _N - 0.5
            x0 = math.floor(sx)
            fx = sx - x0
            x0c = min(max(x0, 0), w - 1)
            x1c = min(max(x0 + 1, 0), w - 1)
            top = src[y0c][x0c] * (1 - fx) + src[y0c][x1c] * fx
            bot = src[y1c][x0c] * (1 - fx) + src[y1c][x1c] * fx
            val = top * (1 - fy) + bot * fy
            row.append(int(math.floor(val + 0.5)))
        out.append(row)
    return out
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_resize.py -q`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/ad_pipeline/resize.py pipeline/tests/test_resize.py
git commit -m "feat(pipeline): authoritative bilinear resize to 32x32"
```

---

## Task 2: 灰度化 + 建索引(imageio.py / build_index.py)

**Files:**
- Create: `pipeline/src/ad_pipeline/imageio.py`(Pillow 只负责**解码 + 灰度**,缩放走共享 `resize_gray_to_32`)
- Create: `pipeline/src/ad_pipeline/build_index.py`
- Modify: `pipeline/pyproject.toml`(加 `Pillow` 依赖)
- Test: `pipeline/tests/test_build_index.py`

> **关键:** `to_gray32` **不**调用 `Image.resize(..., BILINEAR)`——Pillow 只 `convert("L")` 解码出原生分辨率灰度,缩放交给 Task 1b 的 `resize_gray_to_32`。这样建索引(此处)与查询(TS `grid.ts`)走的是**同一个双线性核**,两端 pHash 才对得上。

- [ ] **Step 1: 写失败测试(用生成的小 PNG,不打网)**

```python
# pipeline/tests/test_build_index.py
import json
from PIL import Image
from ad_pipeline.imageio import load_gray, to_gray32
from ad_pipeline.build_index import build_index_from_files

def _make_png(path, color, size=(64, 64)):
    Image.new("RGB", size, color).save(path)

def test_load_gray_keeps_native_resolution(tmp_path):
    p = tmp_path/"x.png"; _make_png(p, (10,20,30), size=(48, 40))
    g = load_gray(p)
    assert len(g) == 40 and len(g[0]) == 48  # H×W,未缩放

def test_to_gray32_routes_through_shared_resize(tmp_path):
    p = tmp_path/"x.png"; _make_png(p, (10,20,30))
    g = to_gray32(p)
    assert len(g) == 32 and len(g[0]) == 32 and all(isinstance(v,int) for v in g[0])

def test_build_index_writes_entries(tmp_path):
    a = tmp_path/"mirana_starfall.png"; _make_png(a, (200,50,50))
    h = tmp_path/"mirana.png"; _make_png(h, (50,50,200))
    entries = [
        {"valveId":5051,"shortName":"mirana_starfall","path":str(a)},
        {"valveId":-9,"shortName":"mirana","path":str(h)},
    ]
    out = tmp_path/"phash_index.json"
    build_index_from_files(entries, out)
    data = json.loads(out.read_text())
    by_id = {e["valveId"]: e for e in data}
    assert set(by_id) == {5051, -9}
    assert len(by_id[5051]["phash"]) == 16
```

- [ ] **Step 2: 跑测试确认失败**

Run:`python -m pytest tests/test_build_index.py -q`
Expected: FAIL,`ModuleNotFoundError`(并提示装 Pillow)。

- [ ] **Step 3: 最小实现**

`pyproject.toml` 依赖加 `"Pillow>=10"`,重装 `pip install -e ".[dev]"`。

```python
# pipeline/src/ad_pipeline/imageio.py
"""Pillow 只做解码 + 灰度;缩放交给共享的 resize_gray_to_32。"""
from pathlib import Path
from PIL import Image

from .resize import resize_gray_to_32


def load_gray(path: Path) -> list[list[int]]:
    """解码为原生分辨率灰度二维 list(H×W),不缩放。"""
    img = Image.open(path).convert("L")
    w, h = img.size
    px = list(img.getdata())
    return [[px[r * w + c] for c in range(w)] for r in range(h)]


def to_gray32(path: Path) -> list[list[int]]:
    """解码 → 灰度 → 共享双线性缩放到 32×32。"""
    return resize_gray_to_32(load_gray(path))
```

```python
# pipeline/src/ad_pipeline/build_index.py
"""下载/读取参考图 → pHash → phash_index.json。"""
import json
from pathlib import Path
from .imageio import to_gray32
from .phash import phash_from_gray

def build_index_from_files(entries: list[dict], out_path: Path) -> None:
    """entries: [{valveId, shortName, path}]。写 [{valveId, shortName, phash}]。"""
    index = []
    for e in entries:
        index.append({"valveId": e["valveId"], "shortName": e["shortName"],
                      "phash": phash_from_gray(to_gray32(Path(e["path"])))})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
```

- [ ] **Step 4: 跑测试确认通过**

Run:`python -m pytest tests/test_build_index.py -q`
Expected: PASS(4 passed)。

- [ ] **Step 5: 加 CLI 子命令把 assets→index 串起来**

在 `cli.py` 的 `main` 中新增 `build-index` 子命令:从 `reference.db` 读 abilities+heroes,用阶段 0 的 `assets.build_asset_manifest` 得到下载清单,下载到 `models/templates/sprites/`,再 `build_index_from_files` 写 `models/templates/phash_index.json`。下载用 `WindrunClient` 加一个 `get_bytes` 方法(在 client.py 补:`def get_bytes(self,url): r=self._client.get(url); r.raise_for_status(); return r.content`,注意 CDN 是绝对 URL,需用独立 httpx.get 或允许绝对 path)。

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/ad_pipeline/imageio.py pipeline/src/ad_pipeline/build_index.py pipeline/src/ad_pipeline/cli.py pipeline/src/ad_pipeline/windrun/client.py pipeline/pyproject.toml pipeline/tests/test_build_index.py
git commit -m "feat(pipeline): build phash index from reference sprites"
```

---

## Task 3: TS 领域核心工程骨架

**Files:**
- Create: `core/package.json`
- Create: `core/tsconfig.json`
- Create: `core/vitest.config.ts`
- Create: `core/src/index.ts`(空导出占位)

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@ad/core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./recognition/grid": "./src/recognition/grid.ts",
    "./recognition/resize": "./src/recognition/resize.ts",
    "./recognition/index_store": "./src/recognition/index_store.ts",
    "./recognition/recognize": "./src/recognition/recognize.ts",
    "./recognition/phash": "./src/recognition/phash.ts",
    "./db/reference": "./src/db/reference.ts"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "better-sqlite3": "^11.0.0", "sharp": "^0.33.0" },
  "devDependencies": {
    "typescript": "^5.5.0", "vitest": "^2.0.0",
    "@types/better-sqlite3": "^7.6.0", "@types/node": "^20.0.0"
  }
}
```

> **⚠️ Phase 2/4 预警(现在不处理,但记下来):** `better-sqlite3` 是原生 C++ 模块。本阶段它只在 Vitest 的纯 Node 环境(`environment: "node"`)下运行,**无需特殊处理**。但当阶段 2/4 把它装进 Electron 时,Electron 自带独立 V8,**必须用 `electron-rebuild`(或 electron-builder 的 `postinstall` 重建)对其重新编译**,否则报 `Module did not self-register` / `NODE_MODULE_VERSION` 不匹配。届时方案:在 `main/`(而非 `core/`)管理 Electron 运行时依赖,并在打包脚本里加 `electron-rebuild -f -w better-sqlite3`。`core/` 保持只在 Node 下被测,DB 访问通过 `ReferenceDb` 这层抽象,便于阶段 2 决定是主进程持有连接还是改用其他绑定。

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "types": ["node"], "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 写 vitest.config.ts 与占位入口**

```ts
// core/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```
```ts
// core/src/index.ts
export {};
```

- [ ] **Step 4: 安装并验证**

Run(在 `core/` 下):`npm install`
Run:`npm run typecheck`
Expected: 无类型错误。
Run:`npm test`
Expected: `No test files found`(退出非零可接受,确认 vitest 能跑)。

- [ ] **Step 5: Commit**

```bash
git add core/package.json core/tsconfig.json core/vitest.config.ts core/src/index.ts
git commit -m "chore(core): scaffold zero-electron TS domain core"
```

---

## Task 3b: TS 共享双线性缩放(与 Python 逐位对齐)

> 与 Task 1b 的 `resize.py` 严格对应。同一算法、同一边界、同一舍入。

**Files:**
- Create: `core/src/recognition/resize.ts`
- Test: `core/tests/recognition/resize.test.ts`

- [ ] **Step 1: 写失败测试(数值对齐 Python 用例)**

```ts
// core/tests/recognition/resize.test.ts
import { describe, it, expect } from "vitest";
import { resizeGrayTo32 } from "../../src/recognition/resize";

describe("resizeGrayTo32", () => {
  it("outputs 32x32 ints", () => {
    const src = Array.from({ length: 10 }, () => Array(10).fill(100));
    const out = resizeGrayTo32(src);
    expect(out.length).toBe(32);
    expect(out.every((r) => r.length === 32)).toBe(true);
    expect(Number.isInteger(out[0][0])).toBe(true);
  });

  it("preserves a solid image", () => {
    const src = Array.from({ length: 64 }, () => Array(64).fill(128));
    expect(resizeGrayTo32(src).every((r) => r.every((v) => v === 128))).toBe(true);
  });

  it("matches Python corner alignment for 2x2 upscale", () => {
    // 与 test_resize.py::test_known_2x2_upscale_center_alignment 同输入同期望
    const out = resizeGrayTo32([[0, 255], [255, 0]]);
    expect(out[0][0]).toBe(0);
    expect(out[0][31]).toBe(255);
    expect(out[31][0]).toBe(255);
    expect(out[31][31]).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `core/` 下):`npx vitest run recognition/resize`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现(逐行对齐 resize.py)**

```ts
// core/src/recognition/resize.ts
// 权威双线性缩放到 32x32。必须与 pipeline/src/ad_pipeline/resize.py 逐位一致。
// 半像素中心对齐 + clamp 边界 + Math.floor(v + 0.5) 舍入(不用 Math.round,避免 .5 方向分歧)。

const N = 32;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function resizeGrayTo32(src: number[][]): number[][] {
  const h = src.length;
  const w = src[0].length;
  const out: number[][] = [];
  for (let ry = 0; ry < N; ry++) {
    const sy = ((ry + 0.5) * h) / N - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y0c = clamp(y0, 0, h - 1);
    const y1c = clamp(y0 + 1, 0, h - 1);
    const row: number[] = [];
    for (let rx = 0; rx < N; rx++) {
      const sx = ((rx + 0.5) * w) / N - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x0c = clamp(x0, 0, w - 1);
      const x1c = clamp(x0 + 1, 0, w - 1);
      const top = src[y0c][x0c] * (1 - fx) + src[y0c][x1c] * fx;
      const bot = src[y1c][x0c] * (1 - fx) + src[y1c][x1c] * fx;
      const val = top * (1 - fy) + bot * fy;
      row.push(Math.floor(val + 0.5));
    }
    out.push(row);
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/resize`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/resize.ts core/tests/recognition/resize.test.ts
git commit -m "feat(core): TS bilinear resize bit-aligned with python authority"
```

---

## Task 4: TS pHash(与 Python 位对齐)

**Files:**
- Create: `core/src/recognition/phash.ts`
- Test: `core/tests/recognition/phash.test.ts`

- [ ] **Step 1: 写失败测试(本任务只做 32×32 数组级的合成对齐)**

> ⚠️ **注意:** 合成数组只验证 `phashFromGray` 本身,**不覆盖 resize**(它跳过了缩放步骤)。真正暴露「两端缩放核分歧」的端到端交叉验证放在 **Task 4b**(用真实 PNG 走完整管线)。本步骤只是 phash 函数的便宜 sanity。

先在 Python 端为一张确定性灰度图(纯色 128)算出权威哈希,写进测试作为期望值:
Run:`python -c "from ad_pipeline.phash import phash_from_gray; print(phash_from_gray([[128]*32 for _ in range(32)]))"`
记下输出(纯色图 DCT 仅 DC 非零,低频余项全 0,median=0,各值 `0 > 0+EPS` 为假 → 全 0 → `0000000000000000`)。

```ts
// core/tests/recognition/phash.test.ts
import { describe, it, expect } from "vitest";
import { phashFromGray, hamming } from "../../src/recognition/phash";

function solid(v: number): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(v));
}

describe("phash", () => {
  it("produces 16 hex chars", () => {
    const h = phashFromGray(solid(128));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches Python authoritative hash for solid image", () => {
    // 来自:python -c '...phash_from_gray([[128]*32]*32)'
    expect(phashFromGray(solid(128))).toBe("0000000000000000");
  });

  it("identical images have zero hamming distance", () => {
    expect(hamming(phashFromGray(solid(100)), phashFromGray(solid(100)))).toBe(0);
  });

  it("different images differ", () => {
    const half = Array.from({ length: 32 }, () =>
      [...Array(16).fill(0), ...Array(16).fill(255)]);
    expect(hamming(phashFromGray(half), phashFromGray(solid(128)))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `core/` 下):`npx vitest run recognition/phash`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现(算法逐行对齐 Python)**

```ts
// core/src/recognition/phash.ts
// 8x8 DCT 感知哈希。算法必须与 pipeline/src/ad_pipeline/phash.py 完全一致。

const EPS = 1e-6; // 中位数比较的浮点临界带;必须与 phash.py 的 EPS 同值

function dct1d(vec: number[]): number[] {
  const n = vec.length;
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += vec[i] * Math.cos((Math.PI * (2 * i + 1) * k) / (2 * n));
    }
    out[k] = s;
  }
  return out;
}

function dct2d(mat: number[][]): number[][] {
  const rows = mat.map(dct1d);
  const n = rows.length;
  const cols: number[][] = [];
  for (let k = 0; k < rows[0].length; k++) {
    cols.push(dct1d(rows.map((_, i) => rows[i][k])));
  }
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: cols.length }, (_, k) => cols[k][i]));
}

export function phashFromGray(gray32: number[][]): string {
  const dct = dct2d(gray32.map((r) => r.map(Number)));
  const low: number[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) low.push(dct[r][c]);
  const rest = low.filter((_, i) => i !== 0).slice().sort((a, b) => a - b);
  const m = rest.length;
  const median = m % 2 ? rest[(m - 1) / 2] : (rest[m / 2 - 1] + rest[m / 2]) / 2;
  let bits = 0n;
  for (const v of low) bits = (bits << 1n) | (v > median + EPS ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x > 0n) { count += Number(x & 1n); x >>= 1n; }
  return count;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/phash`
Expected: PASS(4 passed)。**若 `matches Python` 失败,两端算法已偏离 —— 必须修到一致,不可改期望值绕过。**

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/phash.ts core/tests/recognition/phash.test.ts
git commit -m "feat(core): TS phash bit-aligned with python authority"
```

---

## Task 4b: 端到端跨语言交叉验证(真实 PNG,过完整管线)

> **这是修掉「合成测试假绿、真实识别失败」的关键守门任务。** 不用纯色数组——用一张**确定性的真实 PNG**,让 Python(`to_gray32 → phash_from_gray`)与 TS(`sharp 解码灰度 → resizeGrayTo32 → phashFromGray`)各自走完整管线,断言两端 hash 相同(或 hamming ≤ 4)。任何一端的 resize/median 偏离都会在这里暴露。

**Files:**
- Create: `core/tests/fixtures/make_xval_png.py`(生成确定性 PNG + 写出 Python 权威 hash)
- Create: `core/tests/fixtures/xval_sprite.png`(产物,提交进库)
- Create: `core/tests/fixtures/xval_expected.json`(产物:`{"phash": "...."}`)
- Test: `core/tests/recognition/cross_lang.test.ts`

- [ ] **Step 1: 写生成脚本(Python 侧产出 PNG + 权威 hash)**

```python
# core/tests/fixtures/make_xval_png.py
"""生成确定性测试 PNG,并用 Python 权威管线算出 phash 写入 json。
运行:python core/tests/fixtures/make_xval_png.py
依赖 pipeline 包(同仓):确保 PYTHONPATH 含 pipeline/src,或在 pipeline venv 下跑。
"""
import json
import pathlib

from PIL import Image

from ad_pipeline.imageio import to_gray32
from ad_pipeline.phash import phash_from_gray

HERE = pathlib.Path(__file__).parent
PNG = HERE / "xval_sprite.png"


def main() -> None:
    # 非平凡确定性图案:渐变 + 方块,尺寸非 32 整数倍(逼出 resize 分歧)
    w, h = 53, 47
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            r = (x * 5) % 256
            g = (y * 7) % 256
            b = ((x + y) * 3) % 256
            if 10 <= x < 25 and 8 <= y < 30:
                r, g, b = 240, 12, 200  # 一个高对比方块
            px[x, y] = (r, g, b)
    img.save(PNG)
    h32 = phash_from_gray(to_gray32(PNG))
    (HERE / "xval_expected.json").write_text(
        json.dumps({"phash": h32}), encoding="utf-8")
    print("wrote", PNG.name, "phash=", h32)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 生成 fixture(在 pipeline venv 下)**

Run:`python core/tests/fixtures/make_xval_png.py`
Expected: 打印 `wrote xval_sprite.png phash= <16hex>`,并生成 `xval_sprite.png` 与 `xval_expected.json`。

- [ ] **Step 3: 写 TS 端到端交叉验证测试(先失败)**

```ts
// core/tests/recognition/cross_lang.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resizeGrayTo32 } from "../../src/recognition/resize";
import { phashFromGray, hamming } from "../../src/recognition/phash";

const png = fileURLToPath(new URL("../fixtures/xval_sprite.png", import.meta.url));
const expected = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/xval_expected.json", import.meta.url)), "utf-8"),
) as { phash: string };

async function decodeGray(path: string): Promise<number[][]> {
  const { data, info } = await sharp(path).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(data[y * w + x]);
    out.push(row);
  }
  return out;
}

describe("cross-language phash (real PNG, full pipeline)", () => {
  it("TS pipeline matches Python authoritative hash", async () => {
    const gray = await decodeGray(png);
    const ts = phashFromGray(resizeGrayTo32(gray));
    // 目标 0;容忍 <=4 应对极少数浮点临界 bit
    expect(hamming(ts, expected.phash)).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 4: 跑测试**

Run(在 `core/` 下):`npx vitest run recognition/cross_lang`
Expected: **首跑可能 FAIL**(若 sharp 的灰度系数与 Pillow `convert("L")` 不同,见下)。

> **若 hamming 偏大:** 极可能是**灰度公式**两端不一致——Pillow `convert("L")` 用 ITU-R 601-2:`L = 0.299R + 0.587G + 0.114B`;sharp `greyscale()` 用 Rec.709。这是与 resize 同类的「第三个必须对齐的步骤」。修法二选一:① Python 端也按 Rec.709 手算灰度(在 `load_gray` 里改用 `0.2126R+0.7152G+0.0722B` 而非 `convert("L")`);② TS 端取原始 RGB 后按 601 手算。**任选一种,两端统一**,并把该决定写进 `resize.py`/`resize.ts` 顶部注释。修到 hamming ≤ 4 为止,**不可调大阈值绕过**。

- [ ] **Step 5: Commit**

```bash
git add core/tests/fixtures/make_xval_png.py core/tests/fixtures/xval_sprite.png core/tests/fixtures/xval_expected.json core/tests/recognition/cross_lang.test.ts
git commit -m "test(core): end-to-end cross-language phash xval on real png"
```

---

## Task 5: 索引加载 + 最近邻查询(index_store.ts)

**Files:**
- Create: `core/src/recognition/index_store.ts`
- Test: `core/tests/recognition/index_store.test.ts`
- Create: `core/tests/fixtures/phash_index.json`

- [ ] **Step 1: 落 fixture 与失败测试**

`core/tests/fixtures/phash_index.json`:
```json
[
 {"valveId":5051,"shortName":"mirana_starfall","phash":"ffffffff00000000"},
 {"valveId":-9,"shortName":"mirana","phash":"0000000000000000"},
 {"valveId":5048,"shortName":"mirana_arrow","phash":"f0f0f0f0f0f0f0f0"}
]
```
```ts
// core/tests/recognition/index_store.test.ts
import { describe, it, expect } from "vitest";
import { loadIndex, nearest } from "../../src/recognition/index_store";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../fixtures/phash_index.json", import.meta.url));

describe("index_store", () => {
  it("loads entries", () => {
    expect(loadIndex(fixture).length).toBe(3);
  });

  it("nearest returns exact match at distance 0", () => {
    const idx = loadIndex(fixture);
    const hit = nearest(idx, "0000000000000000");
    expect(hit.valveId).toBe(-9);
    expect(hit.distance).toBe(0);
  });

  it("nearest respects maxDistance, returns null when too far", () => {
    const idx = loadIndex(fixture);
    // 与三者都很远的哈希
    const hit = nearest(idx, "0f0f0f0f0f0f0f0f", 4);
    expect(hit).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/index_store`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// core/src/recognition/index_store.ts
import { readFileSync } from "node:fs";
import { hamming } from "./phash";

export interface IndexEntry { valveId: number; shortName: string; phash: string; }
export interface Match { valveId: number; shortName: string; distance: number; }

export function loadIndex(path: string): IndexEntry[] {
  return JSON.parse(readFileSync(path, "utf-8")) as IndexEntry[];
}

export function nearest(
  index: IndexEntry[], queryPhash: string, maxDistance = 10,
): Match | null {
  let best: Match | null = null;
  for (const e of index) {
    const d = hamming(queryPhash, e.phash);
    if (best === null || d < best.distance) {
      best = { valveId: e.valveId, shortName: e.shortName, distance: d };
    }
  }
  if (best === null || best.distance > maxDistance) return null;
  return best;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/index_store`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/index_store.ts core/tests/recognition/index_store.test.ts core/tests/fixtures/phash_index.json
git commit -m "feat(core): phash index loader + nearest-neighbor lookup"
```

---

## Task 6: 单 ROI 网格裁切(grid.ts)

把一帧的「选取池」区域按规则网格切成 N 个图标格,每格**先按原始像素裁出子矩形,再经共享 `resizeGrayTo32` 缩放到 32×32**。坐标用可配置的 `GridSpec`(本阶段手填一组对 1920×1080 标定的值;阶段 2 再做分辨率映射)。

> **修正要点:** 原实现自带一个最近邻 `sample()` 缩放——这与建索引侧的双线性核不一致,是两端 pHash 对不上的根因之一。改为:`cropRaw`(只切原始像素子矩形,不缩放)→ `resizeGrayTo32`(共享双线性)。这样查询侧与建索引侧走**同一缩放核**。

**Files:**
- Create: `core/src/recognition/grid.ts`
- Test: `core/tests/recognition/grid.test.ts`

- [ ] **Step 1: 写失败测试(用合成像素缓冲,不依赖真截图)**

```ts
// core/tests/recognition/grid.test.ts
import { describe, it, expect } from "vitest";
import { cropRaw, cropGrid, type GridSpec, type GrayFrame } from "../../src/recognition/grid";

// 像素值 = 行*10+列,便于断言裁切位置
function frame(w: number, h: number): GrayFrame {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (y * 10 + x) & 0xff;
  return { width: w, height: h, data };
}

describe("cropRaw", () => {
  it("extracts the exact sub-rectangle without scaling", () => {
    const spec: GridSpec = { x: 1, y: 1, cellW: 2, cellH: 2, gapX: 0, gapY: 0, rows: 1, cols: 1 };
    const raw = cropRaw(frame(4, 4), spec.x, spec.y, spec.cellW, spec.cellH);
    // (1,1)=11, (2,1)=12, (1,2)=21, (2,2)=22
    expect(raw).toEqual([[11, 12], [21, 22]]);
  });
});

describe("cropGrid", () => {
  it("yields rows*cols cells, each resized to 32x32", () => {
    const spec: GridSpec = { x: 0, y: 0, cellW: 8, cellH: 8, gapX: 0, gapY: 0, rows: 2, cols: 2 };
    const cells = cropGrid(frame(16, 16), spec);
    expect(cells.length).toBe(4);
    expect(cells[0].length).toBe(32);
    expect(cells[0][0].length).toBe(32);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run recognition/grid`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 最小实现(原始裁切 → 共享双线性缩放)**

```ts
// core/src/recognition/grid.ts
import { resizeGrayTo32 } from "./resize";

export interface GrayFrame { width: number; height: number; data: Uint8Array; }
export interface GridSpec {
  x: number; y: number;          // 网格左上角(像素)
  cellW: number; cellH: number;  // 单格尺寸
  gapX: number; gapY: number;    // 格间距
  rows: number; cols: number;
}

/** 切出原始像素子矩形(不缩放),越界 clamp 到边缘。 */
export function cropRaw(
  frame: GrayFrame, sx: number, sy: number, sw: number, sh: number,
): number[][] {
  const out: number[][] = [];
  for (let dy = 0; dy < sh; dy++) {
    const py = Math.min(frame.height - 1, Math.max(0, sy + dy));
    const row: number[] = [];
    for (let dx = 0; dx < sw; dx++) {
      const px = Math.min(frame.width - 1, Math.max(0, sx + dx));
      row.push(frame.data[py * frame.width + px]);
    }
    out.push(row);
  }
  return out;
}

export function cropGrid(frame: GrayFrame, spec: GridSpec): number[][][] {
  const cells: number[][][] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const sx = spec.x + c * (spec.cellW + spec.gapX);
      const sy = spec.y + r * (spec.cellH + spec.gapY);
      const raw = cropRaw(frame, sx, sy, spec.cellW, spec.cellH);
      cells.push(resizeGrayTo32(raw)); // 共享双线性核,与建索引侧一致
    }
  }
  return cells;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:`npx vitest run recognition/grid`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add core/src/recognition/grid.ts core/tests/recognition/grid.test.ts
git commit -m "feat(core): single-ROI grid cropper to 32x32 gray cells"
```

---

## Task 7: 识别编排 + DB 查 slot_type(recognize.ts + reference.ts)

**Files:**
- Create: `core/src/db/reference.ts`
- Create: `core/src/recognition/recognize.ts`
- Test: `core/tests/recognition/recognize.test.ts`
- Test: `core/tests/db/reference.test.ts`

- [ ] **Step 1: reference.ts 失败测试(用临时 sqlite)**

```ts
// core/tests/db/reference.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { ReferenceDb } from "../../src/db/reference";

let dbPath: string;
beforeAll(() => {
  dbPath = join(tmpdir(), `ref-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE abilities (valve_id INTEGER PRIMARY KEY, short_name TEXT,
    english_name TEXT, slot_type TEXT, is_ultimate INTEGER, has_scepter INTEGER,
    has_shard INTEGER, owner_hero_id INTEGER, needs_review INTEGER)`);
  db.prepare(`INSERT INTO abilities VALUES (5048,'mirana_arrow','Sacred Arrow','ultimate',1,1,0,9,0)`).run();
  db.prepare(`INSERT INTO abilities VALUES (-9,'mirana','Hero: Mirana','hero',null,null,null,null,0)`).run();
  db.close();
});
afterAll(() => rmSync(dbPath, { force: true }));

describe("ReferenceDb", () => {
  it("looks up slot_type by valveId", () => {
    const ref = new ReferenceDb(dbPath);
    expect(ref.slotType(5048)).toBe("ultimate");
    expect(ref.slotType(-9)).toBe("hero");
    expect(ref.slotType(99999)).toBeNull();
    ref.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:`npx vitest run db/reference`
Expected: FAIL,模块不存在。

- [ ] **Step 3: reference.ts 实现**

```ts
// core/src/db/reference.ts
import Database from "better-sqlite3";

export type SlotType = "hero" | "normal" | "ultimate";

export class ReferenceDb {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path, { readonly: true });  // 只读消费(计划书 §三)
  }
  slotType(valveId: number): SlotType | null {
    const row = this.db
      .prepare("SELECT slot_type FROM abilities WHERE valve_id = ?")
      .get(valveId) as { slot_type: SlotType } | undefined;
    return row ? row.slot_type : null;
  }
  close(): void { this.db.close(); }
}
```

- [ ] **Step 4: 跑通 reference 测试**

Run:`npx vitest run db/reference`
Expected: PASS(1 passed)。

- [ ] **Step 5: recognize.ts 失败测试**

```ts
// core/tests/recognition/recognize.test.ts
import { describe, it, expect } from "vitest";
import { recognizeCell } from "../../src/recognition/recognize";
import type { IndexEntry } from "../../src/recognition/index_store";

const index: IndexEntry[] = [
  { valveId: -9, shortName: "mirana", phash: "0000000000000000" },
  { valveId: 5048, shortName: "mirana_arrow", phash: "ffffffffffffffff" },
];

function solid(v: number): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(v));
}

describe("recognizeCell", () => {
  it("returns matched valveId for a known sprite", () => {
    // 纯色 → phash 0000... → 命中 -9
    const r = recognizeCell(solid(128), index, 6);
    expect(r?.valveId).toBe(-9);
  });
  it("returns null when nothing within maxDistance", () => {
    const sparse: IndexEntry[] = [{ valveId: 1, shortName: "x", phash: "ffffffffffffffff" }];
    const r = recognizeCell(solid(128), sparse, 3);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 6: recognize.ts 实现**

```ts
// core/src/recognition/recognize.ts
import { phashFromGray } from "./phash";
import { nearest, type IndexEntry, type Match } from "./index_store";

export function recognizeCell(
  cellGray32: number[][], index: IndexEntry[], maxDistance = 10,
): Match | null {
  return nearest(index, phashFromGray(cellGray32), maxDistance);
}
```

- [ ] **Step 7: 跑通 recognize 测试**

Run:`npx vitest run recognition/recognize`
Expected: PASS(2 passed)。

- [ ] **Step 8: Commit**

```bash
git add core/src/db/reference.ts core/src/recognition/recognize.ts core/tests/db/reference.test.ts core/tests/recognition/recognize.test.ts
git commit -m "feat(core): recognize cell -> valveId, slot_type via reference db"
```

---

## Task 8: 薄截屏入口(main/)+ 端到端冒烟

唯一接触 Electron 生态(`screenshot-desktop`)的薄层:截全屏 → sharp 转灰度 → `cropGrid` → `recognizeCell`。本阶段是手动冒烟脚本,不进捕获循环。

**Files:**
- Create: `main/package.json`(依赖 `screenshot-desktop`、`sharp`、`@ad/core`)
- Create: `main/src/recognize_once.ts`(脚本)
- Create: `main/tests/decode.test.ts`(sharp 解码可单测的部分)

- [ ] **Step 1: decode 失败测试(sharp PNG→GrayFrame)**

```ts
// main/tests/decode.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { toGrayFrame } from "../src/decode";

describe("toGrayFrame", () => {
  it("decodes png buffer to grayscale frame", async () => {
    const png = await sharp({
      create: { width: 8, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
    }).png().toBuffer();
    const f = await toGrayFrame(png);
    expect(f.width).toBe(8);
    expect(f.height).toBe(4);
    expect(f.data.length).toBe(32);
    expect(f.data[0]).toBeGreaterThan(90);  // 灰度 ~100
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run(在 `main/` 下,先 `npm install`):`npx vitest run decode`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 decode.ts**

```ts
// main/src/decode.ts
import sharp from "sharp";
import type { GrayFrame } from "@ad/core/recognition/grid";

export async function toGrayFrame(pngBuffer: Buffer): Promise<GrayFrame> {
  const { data, info } = await sharp(pngBuffer)
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}
```
> **⚠️ 灰度公式必须与 Task 4b 的决定一致。** `sharp.greyscale()` 用 Rec.709,Pillow `convert("L")` 用 601。Task 4b 已强制两端统一到同一公式——本文件的 `toGrayFrame` 必须用**那个**公式。若 Task 4b 选了 601,这里不能直接用 `sharp.greyscale()`,需取 RGB 后按 601 手算(或反之)。否则查询侧灰度与建索引侧不一致,识别必偏。
>
> (导入:`@ad/core` 子路径 exports 已在 Task 3 的 `package.json` 配好;`main/` 需把 `@ad/core` 加为依赖,或在 `main/tsconfig.json` 配 path 映射到 `../core/src`。)

- [ ] **Step 4: 跑通 decode 测试**

Run:`npx vitest run decode`
Expected: PASS(1 passed)。

- [ ] **Step 5: 写手动冒烟脚本**

```ts
// main/src/recognize_once.ts
import screenshot from "screenshot-desktop";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toGrayFrame } from "./decode";
import { cropGrid, type GridSpec } from "@ad/core/recognition/grid";
import { loadIndex } from "@ad/core/recognition/index_store";
import { recognizeCell } from "@ad/core/recognition/recognize";

// 索引路径相对于本脚本文件解析(不依赖 CWD),否则从仓库根运行会找不到。
// main/src/recognize_once.ts → 仓库根 → models/templates/phash_index.json
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, "../../models/templates/phash_index.json");

// 1920x1080 选取池标定值(阶段2 做分辨率映射前先手填)
const POOL: GridSpec = { x: 480, y: 200, cellW: 64, cellH: 64, gapX: 8, gapY: 8, rows: 4, cols: 12 };

async function run() {
  const png = await screenshot({ format: "png" });
  const frame = await toGrayFrame(png);
  const index = loadIndex(INDEX_PATH);
  const cells = cropGrid(frame, POOL);
  cells.forEach((cell, i) => {
    const m = recognizeCell(cell, index, 12);
    console.log(`cell ${i}: ${m ? `${m.shortName} (d=${m.distance})` : "—"}`);
  });
}
run();
```

- [ ] **Step 6: 手动冒烟(需真截取一帧 AD 选取界面)**

准备:进入一局 AD 选取界面(或用一张已保存的截图替换 `screenshot()` 调用)。先按 Task 2 Step 5 跑 `python -m ad_pipeline build-index` 生成 `models/templates/phash_index.json`。
Run(在 `main/` 下):`npx tsx src/recognize_once.ts`
Expected: 控制台逐格打印识别到的技能 shortName;**池中可见图标应被正确识别**(验收门,计划书 §十「阶段1:给定一帧能正确识别池中图标」)。GridSpec 坐标可能需按实际截图微调。

- [ ] **Step 7: Commit**

```bash
git add main/package.json main/src/decode.ts main/src/recognize_once.ts main/tests/decode.test.ts
git commit -m "feat(main): thin screenshot entry + manual single-frame recognition smoke"
```

---

## 阶段 1 验收清单(对应计划书 §十「阶段 1」)

- [ ] `core/` 下 `npm test` 全绿(resize / phash / cross_lang / index_store / grid / recognize / reference)。
- [ ] **三步两端对齐**:resize、灰度公式、pHash 在 Python 与 TS 逐位一致。
- [ ] **端到端跨语言交叉验证通过**(`cross_lang.test.ts`:真实 PNG 过完整管线,hamming ≤ 4)——这是「合成测试假绿」的守门。
- [ ] `python -m ad_pipeline build-index` 从参考图生成 `models/templates/phash_index.json`(建索引与查询走**同一双线性核**)。
- [ ] 验收门:**给定一帧能正确识别池中图标** —— Task 8 Step 6 手动冒烟通过。
- [ ] slot_type 由 `valveId` 查 DB 得到,识别层不自行判定普通/终极/英雄。
- [ ] 识别核心零 Electron 依赖;唯一截屏代码隔离在 `main/`;脚本路径相对自身文件解析,不依赖 CWD。

## 已知问题修正(本次评审纳入,逐条对应)

1. **缩放核两端不一致(最高危,已修)**:原 `grid.ts` 用最近邻、建索引用 Pillow `BILINEAR`,核不同→ pHash 发散。修法:抽出**共享双线性 `resize`(Task 1b / 3b),两端逐位对齐**;`grid.ts` 改为 `cropRaw` + `resizeGrayTo32`;`imageio.to_gray32` 不再用 `Image.resize`。
2. **中位数浮点临界区(已修)**:`v > median` 改为 `v > median + EPS`(两端同 `EPS=1e-6`),统一吃掉临界 bit。
3. **灰度公式两端不一致(评审中新发现,Task 4b 强制对齐)**:Pillow 601 vs sharp 709。端到端交叉验证会暴露,Task 4b 要求两端统一到同一公式。
4. **`recognize_once.ts` CWD 相对路径(已修)**:改为相对脚本文件(`import.meta.url`)解析,从任意 CWD 运行都正确。
5. **`better-sqlite3` × Electron 重编译(本阶段无碍,已预警)**:Phase 1 仅在 Node/Vitest 下用,无需处理;阶段 2/4 进 Electron 时须 `electron-rebuild`,已在 Task 3 写明预警与方案。

> **下一步依赖:** 本阶段的 `cropGrid` + `recognizeCell` 是阶段 2「多 ROI + frame-diff + 草稿状态机」的识别原语;`GridSpec` 手填坐标将在阶段 2 升级为分辨率映射。共享 `resize` + 统一灰度公式同样被阶段 2 的实时识别复用。
