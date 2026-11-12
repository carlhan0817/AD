// main/src/assets/hero_art.ts
// 从用户本机的 Dota 安装里读英雄选取立绘(认「我的英雄」要用)。
// 安装包里不带这些图(Valve 的美术素材),用的时候直接从游戏资源包里读。
// 全程只读:只打开 game/dota 下的 pak01_*.vpk 读几段字节,不写、不改任何游戏文件。
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { vpkArchiveName, vpkEntriesIn } from "./vpk";
import { decodeVtex, type VtexImage } from "./vtex";

const SELECTION_DIR = "panorama/images/heroes/selection";

export interface HeroArt {
  /** 资源包里有多少张选取立绘(只用来记日志)。 */
  count: number;
  /** 按 reference.db 里的 picture 名取一张立绘;没有或认不出返回 null。 */
  read(picture: string): VtexImage | null;
}

/** 打开 Dota 的资源包目录。读不到或格式不对时抛错(调用方记日志,按没有立绘处理)。 */
export function openHeroArt(dotaDir: string): HeroArt {
  const pakDir = join(dotaDir, "game", "dota");
  const entries = vpkEntriesIn(readFileSync(join(pakDir, "pak01_dir.vpk")), "vtex_c", SELECTION_DIR);
  return {
    count: entries.size,
    read(picture) {
      const e = entries.get(`npc_dota_hero_${picture}_png`);
      if (e === undefined) return null;
      try {
        const fd = openSync(join(pakDir, vpkArchiveName(e.archive)), "r");
        try {
          const buf = Buffer.alloc(e.length);
          if (readSync(fd, buf, 0, e.length, e.offset) !== e.length) return null;
          return decodeVtex(buf);
        } finally { closeSync(fd); }
      } catch {
        return null;
      }
    },
  };
}
