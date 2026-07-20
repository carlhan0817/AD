// core/src/recognition/hero_layout.ts
// 标准技能池两端 12 英雄格的坐标提供。坐标来源:仓库根 layout_coordinates.json 的
// resolutions["1920x1080"].models_coords(逐格 {x,y,width,height,hero_order})。
// 该坐标是上游 ability-draft-plus 项目为"点击命中检测"标定的(容差达 35-48px),
// 不是为像素级识别标的——必须叠加固定偏移 + 每格小范围 refine(见 hero_recognize.ts)
// 才能用于识别。本模块只负责"坐标 → 像素 Rect"的纯几何推导,不做识别。
// 见 docs/superpowers/specs/2026-07-07-hero-cell-recognition-design.md。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rect, ClientRect } from "./roi";

export interface HeroCell extends Rect {
  order: number;             // models_coords 的 hero_order(0..11)
  side: "left" | "right";    // order < 6 → left,否则 right
}

/** 全局平移校正(1080p 像素)。models_coords 原点与 gameClientRect 客户区原点存在固定偏移,
 *  4 帧真机实测一致(dy=-4),故按此定值校正,不逐帧重新求解。见 spec"定位"节。 */
export const HERO_OFFSET_1080P = { dx: 0, dy: -4 };

interface ModelsCoordEntry { x: number; y: number; width: number; height: number; hero_order: number; }

function loadModelsCoords1080p(): ModelsCoordEntry[] {
  const here = fileURLToPath(import.meta.url);
  // core/src/recognition/hero_layout.ts → 仓库根:向上 3 层(recognition→src→core)+ 1(core→根)。
  const repoRoot = join(here, "..", "..", "..", "..");
  const raw = readFileSync(join(repoRoot, "layout_coordinates.json"), "utf-8");
  const parsed = JSON.parse(raw) as { resolutions: Record<string, { models_coords: ModelsCoordEntry[] }> };
  return parsed.resolutions["1920x1080"].models_coords;
}

// 模块加载时读一次(与 POOL_CELLS_1080P 的常量表用法一致,运行期不重复读文件)。
const MODELS_COORDS_1080P = loadModelsCoords1080p();

/** 返回技能池两端 12 个英雄格的绝对像素 Rect,按 hero_order 0..11 升序。
 *  非 1920×1080 时按 rect 尺寸等比缩放(与 poolCellRects 同规则);1080p 下为恒等(仅叠加偏移)。 */
export function heroCellRects(rect: ClientRect): HeroCell[] {
  // 真机截屏常为 1918x1078 一类的近 1080p 尺寸(同一 1080p 显示器的 capture-crop/DPI 伪影,
  // 并非真实异分辨率);逐格 pHash 识别对像素极敏感,哪怕 sx/sy≈0.998 的缩放也会让多格收敛到
  // 错误英雄(已实测验证,非理论推测),故在容差内直接按恒等处理,不缩放。
  const near1080p = Math.abs(rect.width - 1920) <= 10 && Math.abs(rect.height - 1080) <= 10;
  const sx = near1080p ? 1 : rect.width / 1920;
  const sy = near1080p ? 1 : rect.height / 1080;
  const ox = HERO_OFFSET_1080P.dx * sx;
  const oy = HERO_OFFSET_1080P.dy * sy;
  return [...MODELS_COORDS_1080P]
    .sort((a, b) => a.hero_order - b.hero_order)
    .map((c) => ({
      x: rect.x + Math.round(c.x * sx + ox),
      y: rect.y + Math.round(c.y * sy + oy),
      w: Math.round(c.width * sx),
      h: Math.round(c.height * sy),
      order: c.hero_order,
      side: c.hero_order < 6 ? "left" as const : "right" as const,
    }));
}
