// main/src/capture/frame_store.ts
// 按局存帧:每局一个 game_<ISO时间> 文件夹,只留最近 keepGames 局。
// 只管自己建的 game_ 文件夹;root 下原有的散放 PNG(老帧,本地回归测试在读)一律不动。
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { RgbFrame } from "@ad/core/recognition/rgb";

const GAME_PREFIX = "game_";

/** 帧文件名里的「轮到谁」:行号 0–4 → L1–L5(左列),5–9 → R1–R5(右列),认不出 → unknown。
 *  文件名只留 ASCII(save 会把其他字符换成下划线),所以别直接用「左3」。 */
export function frameRowLabel(row: number | null): string {
  if (row === null) return "unknown";
  return row < 5 ? `L${row + 1}` : `R${row - 4}`;
}

export class FrameStore {
  private gameDir: string | null = null; // 当前局文件夹;null = 还没建(新局第一次 save 才建)
  private lastStamp = 0; // 上一个文件夹用的毫秒时间,保证文件夹名严格递增、不重名
  private seq = 0; // 当前局内帧序号
  private pending = new Set<Promise<string | null>>(); // 还没写完的帧(删文件夹前要等它们)

  constructor(private readonly root: string, private readonly keepGames = 5) {}

  /** 开始新的一局。只是标记,不建文件夹;这局第一次 save 才建。 */
  newGame(): void {
    this.gameDir = null;
  }

  /** 存一帧,返回存下的文件路径;任何失败返回 null,不抛错。 */
  save(rgb: RgbFrame, label: string): Promise<string | null> {
    const p = this.write(rgb, label);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    return p;
  }

  /** 删掉当前这一局的文件夹(正式版选人结束时用:截图里有其他玩家的名字,用完不留)。
   *  先等这一局还没写完的帧写完再删。返回删掉的文件夹;没有当前局返回 null。 */
  async discardCurrentGame(): Promise<string | null> {
    const dir = this.gameDir;
    if (dir === null) return null;
    this.gameDir = null;
    await Promise.allSettled([...this.pending]);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 删不掉就留着 */ }
    return dir;
  }

  private async write(rgb: RgbFrame, label: string): Promise<string | null> {
    try {
      if (this.gameDir === null) {
        mkdirSync(this.root, { recursive: true });
        const stamp = Math.max(Date.now(), this.lastStamp + 1);
        this.lastStamp = stamp;
        const name = `${GAME_PREFIX}${new Date(stamp).toISOString().replace(/[:.]/g, "-")}`;
        const dir = join(this.root, name);
        mkdirSync(dir, { recursive: true });
        this.gameDir = dir;
        this.seq = 0;
        try { this.prune(); } catch { /* 清理失败不挡存帧 */ }
      }
      const safeLabel = label.replace(/[^\w.-]/g, "_");
      const file = join(this.gameDir, `${String(++this.seq).padStart(3, "0")}_${safeLabel}.png`);
      await sharp(Buffer.from(rgb.data), { raw: { width: rgb.width, height: rgb.height, channels: 3 } }).png().toFile(file);
      return file;
    } catch {
      return null;
    }
  }

  /** 删掉所有 game_ 文件夹(正式版启动时清掉上次没来得及删的)。散放 PNG 不动;失败不抛错。 */
  clearAllGames(): void {
    this.gameDir = null;
    try { this.removeOldest(0); } catch { /* 文件夹不存在等,忽略 */ }
  }

  // 删掉最旧的 game_ 文件夹,只留 keepGames 个。
  private prune(): void {
    this.removeOldest(this.keepGames);
  }

  // ISO 时间按名字排就是按时间排;删到只剩 keep 个。
  private removeOldest(keep: number): void {
    const dirs = readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(GAME_PREFIX))
      .map((e) => e.name)
      .sort();
    for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
      try { rmSync(join(this.root, name), { recursive: true, force: true }); } catch { /* 删不掉就留着 */ }
    }
  }
}
