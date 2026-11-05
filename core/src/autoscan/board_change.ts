// core/src/autoscan/board_change.ts
// 自动扫描用的「画面变没变」判断。只比较识别用到的区域(池格、英雄格、卡上已选格),
// 刻意不含中央倒计时、玩家卡倒计时徽章、闪烁边框——它们每秒都在变,一比就永远「变化中」。
// 每个区域缩成 4×4 的平均亮度,再比差值:抗视频流的轻微色偏,又能抓住「一格被选走」。
import type { RgbFrame } from "../recognition/rgb";
import type { Rect, ClientRect } from "../recognition/roi";
import { poolSlots } from "../recognition/pool_slots";
import { heroCellRects } from "../recognition/hero_layout";
import { cardSlots } from "../recognition/player_cards";
import { findActiveRow } from "../recognition/card_reading";

/** 每个区域缩成 GRID×GRID 块。 */
const GRID = 4;
const PER_REGION = GRID * GRID;

/** 区域平均绝对差(0–255 亮度)超过它就算「这个区域变了」。
 *  依据(真机帧实测,见 main/tests/capture/board_change_frames.test.ts):
 *  截图 vs 视频流同一刻(颜色偏差)任一区域最大差 3.89;同局面相邻帧(含金卡出现/消失)最大 7.52;
 *  真实换手(池格/英雄格被选走)区域差最小约 13,多数 30 以上。取 10,夹在 7.52 与 13 之间。 */
export const BOARD_CHANGE_THRESHOLD = 10;

export interface BoardSignature {
  /** 每区域 16 个值,顺序固定:池格(48)→ 英雄格(12)→ 卡上已选格。 */
  cells: Float32Array;
  activeRow: number | null;
}

/** 卡上已选格只比蓝通道:「轮到谁」的金色卡底会从空格里透出来(空格本是黑的,金卡时变成约
 *  (15,12,4)),三通道平均差约 10-12,蓝通道只差约 4-5;而放上技能图标后蓝通道差远大于此。
 *  金卡出现/消失本身不该算画面变化(见 main/tests/capture/board_change_frames.test.ts)。 */
const BLUE = 2;

interface Region { rect: Rect; channel: number } // channel: -1 = 三通道平均

function regions(rect: ClientRect): Region[] {
  return [
    ...poolSlots(rect).map((r) => ({ rect: r as Rect, channel: -1 })),
    ...heroCellRects(rect).map((r) => ({ rect: r as Rect, channel: -1 })),
    ...cardSlots(rect).map((r) => ({ rect: r as Rect, channel: BLUE })),
  ];
}

/** 一个区域缩成 4×4 的平均亮度(三通道平均),写进 out[off..off+16)。越界部分按帧边缘裁掉。 */
function blockMeans(frame: RgbFrame, r: Rect, channel: number, out: Float32Array, off: number): void {
  const { width, height, data } = frame;
  for (let by = 0; by < GRID; by++) {
    const y0 = Math.max(0, r.y + Math.floor((by * r.h) / GRID));
    const y1 = Math.min(height, r.y + Math.max(Math.floor(((by + 1) * r.h) / GRID), Math.floor((by * r.h) / GRID) + 1));
    for (let bx = 0; bx < GRID; bx++) {
      const x0 = Math.max(0, r.x + Math.floor((bx * r.w) / GRID));
      const x1 = Math.min(width, r.x + Math.max(Math.floor(((bx + 1) * r.w) / GRID), Math.floor((bx * r.w) / GRID) + 1));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * width + x0) * 3;
        for (let x = x0; x < x1; x++, i += 3) { sum += channel < 0 ? (data[i] + data[i + 1] + data[i + 2]) / 3 : data[i + channel]; n++; }
      }
      out[off + by * GRID + bx] = n === 0 ? 0 : sum / n;
    }
  }
}

export function boardSignature(frame: RgbFrame, rect: ClientRect): BoardSignature {
  const rs = regions(rect);
  const cells = new Float32Array(rs.length * PER_REGION);
  rs.forEach((r, i) => blockMeans(frame, r.rect, r.channel, cells, i * PER_REGION));
  return { cells, activeRow: findActiveRow(frame, rect) };
}

/** 任一区域平均绝对差超过阈值,或「轮到谁」换了人(两边都读到才算,读成 null 当没信息)。 */
export function boardChanged(a: BoardSignature, b: BoardSignature): boolean {
  if (a.activeRow !== null && b.activeRow !== null && a.activeRow !== b.activeRow) return true;
  if (a.cells.length !== b.cells.length) return true;
  for (let o = 0; o < a.cells.length; o += PER_REGION) {
    let d = 0;
    for (let k = 0; k < PER_REGION; k++) d += Math.abs(a.cells[o + k] - b.cells[o + k]);
    if (d / PER_REGION > BOARD_CHANGE_THRESHOLD) return true;
  }
  return false;
}

/** 放行原因:first = 首帧;settled = 变化后已静止;timeout = 满 maxWaitMs 还在变,照样放行。
 *  调用方据此决定读数能不能写进本局记忆(只有 settled 的画面才可靠)。 */
export type SettleRelease = "first" | "settled" | "timeout";

/** 「等画面静止再识别」的闸门。push 返回放行原因表示现在该识别了,null = 先别识别。
 *  首帧放行;画面变了开始计时,变化后同一画面再连续出现 settleFrames 次 → 放行;
 *  从变化开始满 maxWaitMs 还没静止 → 也放行并重新计时。每段变化的静止放行只一次。
 *  首帧之后也等一次静止:画面一直没变,再连续 settleFrames 次后放行一次 settled(首帧读数不写记忆,
 *  这一次补上能写的);首帧后马上变化,就当普通变化处理,超时从变化开始算。 */
export class SettleGate {
  private last: BoardSignature | null = null;
  // 超时放行后计时重新开始:画面之后静止时会再放行一次,读到强制读取之后的最终局面。
  private pendingSince: number | null = null; // 当前这段变化的计时起点;null = 没有待识别的变化
  private stable = 0;
  /** 正在等的是「首帧之后的静止」(还没出现变化)。 */
  private afterFirst = false;

  constructor(private readonly settleFrames = 2, private readonly maxWaitMs = 3000) {}

  push(sig: BoardSignature, now: number): SettleRelease | null {
    const prev = this.last;
    this.last = sig;
    if (prev === null) {
      this.pendingSince = now;
      this.stable = 0;
      this.afterFirst = true;
      return "first";
    }

    if (boardChanged(prev, sig)) {
      this.stable = 0;
      if (this.pendingSince === null || this.afterFirst) this.pendingSince = now;
      this.afterFirst = false;
    } else if (this.pendingSince !== null) {
      this.stable++;
      if (this.stable >= this.settleFrames) { this.pendingSince = null; this.stable = 0; this.afterFirst = false; return "settled"; }
    }

    // 首帧之后画面没变过:不存在「一直在变」,不走超时(取帧中途停过很久也只等静止)
    if (this.pendingSince !== null && !this.afterFirst && now >= this.pendingSince + this.maxWaitMs) {
      this.pendingSince = now; // 仍在变:放行一次,从现在重新计时
      this.stable = 0;
      return "timeout";
    }
    return null;
  }
}
