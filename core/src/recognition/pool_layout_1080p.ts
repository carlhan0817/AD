// core/src/recognition/pool_layout_1080p.ts
// 1920×1080 真机技能池逐格绝对像素坐标(48 格 = 终极区 2×6 + 标准区 6×6,每行左3右2组共6)。
// 用逐格绝对坐标而非「行起点 + 统一步距」模型,因为池是 3D 透视梯形台:每格 w/h/间距都不同,
// 统一步距会从左到右、从上到下累积发散。逐格坐标各自独立,无累积误差。
//
// 重标定 v6(2026-06-26,多源多帧定稿):训练集 = docs/screenshot 下 10 张 Steam jpg 选取截图
// + 1 张 desktopCapturer 实时抓帧(fixtures/dota_pool_real.pgm,偏暗,= 运行时真实来源),共 11 帧,
// 覆盖 draft 各阶段(满池 + 中期空格)与两种采集来源(jpg 亮/压缩 vs 实时灰度偏暗)。
// 对每格 ±6px 搜「让最多帧命中正id技能(d≤20)」,平手取 distance 和最小。
// 判据=pHash 最近邻 distance + 无英雄(见 memory phash-distance-is-ground-truth)。
// 结果:48 格全部 11/11 帧命中正确技能,无系统性英雄误收/重复。
// 演进:v3(社区坐标)仅44/48+3英雄;v4(单 pgm 帧拟合)pgm 48/48 但 jpg 多帧暴露 #30 等 7/10 误收 axe;
// v5(仅 10 jpg 综合)jpg 全48但运行时 pgm 掉到 43/48——【关键教训:必须含运行时来源(desktopCapturer)
// 的帧,jpg 与实时抓帧亮度/对比度不同,pHash 不同】;v6 含两源后双稳。
// ⚠️ 局限:实时来源样本仅 1 帧。后续多抓几张 desktopCapturer 真帧(不同局)加入 fixtures 重求解更稳。
// 仅此 1920×1080 分辨率标定;其它分辨率本阶段不接。
import type { Rect } from "./roi";

export interface PoolCell extends Rect { zone: "ultimate" | "standard"; }

/** 1920×1080 客户区下技能池 48 格(坐标为客户区本地;运行时加 rect.x/rect.y 偏移)。 */
export const POOL_CELLS_1080P: PoolCell[] = [
  { x: 695, y: 166, w: 53, h: 58, zone: "ultimate" },
  { x: 787, y: 166, w: 56, h: 58, zone: "ultimate" },
  { x: 884, y: 166, w: 57, h: 58, zone: "ultimate" },
  { x: 980, y: 166, w: 57, h: 58, zone: "ultimate" },
  { x: 1078, y: 166, w: 56, h: 58, zone: "ultimate" },
  { x: 1175, y: 166, w: 53, h: 58, zone: "ultimate" },
  { x: 698, y: 264, w: 52, h: 56, zone: "ultimate" },
  { x: 792, y: 264, w: 54, h: 56, zone: "ultimate" },
  { x: 886, y: 264, w: 55, h: 56, zone: "ultimate" },
  { x: 981, y: 264, w: 55, h: 56, zone: "ultimate" },
  { x: 1075, y: 265, w: 54, h: 56, zone: "ultimate" },
  { x: 1171, y: 263, w: 52, h: 56, zone: "ultimate" },
  { x: 732, y: 344, w: 47, h: 42, zone: "standard" },
  { x: 809, y: 343, w: 48, h: 42, zone: "standard" },
  { x: 884, y: 343, w: 50, h: 42, zone: "standard" },
  { x: 987, y: 343, w: 50, h: 42, zone: "standard" },
  { x: 1065, y: 344, w: 48, h: 42, zone: "standard" },
  { x: 1144, y: 344, w: 47, h: 42, zone: "standard" },
  { x: 725, y: 408, w: 48, h: 45, zone: "standard" },
  { x: 803, y: 409, w: 49, h: 45, zone: "standard" },
  { x: 882, y: 408, w: 51, h: 45, zone: "standard" },
  { x: 987, y: 409, w: 51, h: 45, zone: "standard" },
  { x: 1068, y: 409, w: 49, h: 45, zone: "standard" },
  { x: 1148, y: 408, w: 48, h: 45, zone: "standard" },
  { x: 718, y: 477, w: 49, h: 47, zone: "standard" },
  { x: 800, y: 477, w: 51, h: 47, zone: "standard" },
  { x: 880, y: 477, w: 53, h: 47, zone: "standard" },
  { x: 988, y: 477, w: 53, h: 47, zone: "standard" },
  { x: 1071, y: 477, w: 51, h: 47, zone: "standard" },
  { x: 1154, y: 478, w: 49, h: 47, zone: "standard" },
  { x: 708, y: 593, w: 49, h: 51, zone: "standard" },
  { x: 791, y: 593, w: 52, h: 51, zone: "standard" },
  { x: 876, y: 593, w: 54, h: 51, zone: "standard" },
  { x: 991, y: 592, w: 54, h: 51, zone: "standard" },
  { x: 1077, y: 593, w: 52, h: 51, zone: "standard" },
  { x: 1164, y: 593, w: 49, h: 51, zone: "standard" },
  { x: 698, y: 671, w: 52, h: 55, zone: "standard" },
  { x: 787, y: 672, w: 54, h: 55, zone: "standard" },
  { x: 874, y: 671, w: 57, h: 55, zone: "standard" },
  { x: 990, y: 673, w: 57, h: 55, zone: "standard" },
  { x: 1081, y: 669, w: 54, h: 55, zone: "standard" },
  { x: 1169, y: 672, w: 52, h: 55, zone: "standard" },
  { x: 693, y: 756, w: 55, h: 58, zone: "standard" },
  { x: 781, y: 756, w: 57, h: 58, zone: "standard" },
  { x: 871, y: 757, w: 58, h: 58, zone: "standard" },
  { x: 991, y: 759, w: 58, h: 58, zone: "standard" },
  { x: 1082, y: 756, w: 57, h: 58, zone: "standard" },
  { x: 1177, y: 757, w: 55, h: 58, zone: "standard" },
];
