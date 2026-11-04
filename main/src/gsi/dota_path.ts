// main/src/gsi/dota_path.ts
// 找 Dota 安装位置,并读写 GSI 配置文件。找位置全程只读:注册表里的 Steam 路径 → Steam 的库列表
// (libraryfolders.vdf)→ 各个库里的 "dota 2 beta"。写文件只写 cfg/gamestate_integration/ 下这一个文件,
// 而且调用方必须先征得用户同意(见 app 里的确认弹窗)。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GSI_CFG_FILE_NAME } from "@ad/core/gsi/gsi";

/** 从 libraryfolders.vdf 里取出所有库的路径(含 Dota 的库排在最前)。纯函数,方便测试。 */
export function libraryPathsFromVdf(vdf: string): string[] {
  const libs: { path: string; hasDota: boolean }[] = [];
  const blocks = vdf.split(/"\d+"\s*\{/).slice(1);
  for (const b of blocks) {
    const p = /"path"\s+"([^"]+)"/.exec(b);
    if (p === null) continue;
    libs.push({ path: p[1].replace(/\\\\/g, "\\"), hasDota: /"570"\s+"/.test(b) });
  }
  return [...libs.filter((l) => l.hasDota), ...libs.filter((l) => !l.hasDota)].map((l) => l.path);
}

/** 注册表里的 Steam 安装路径(只读查询)。 */
function steamPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true }, (err, out) => {
      if (err) { resolve(null); return; }
      const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
      resolve(m ? m[1].trim().replace(/\//g, "\\") : null);
    });
  });
}

/** 找 "dota 2 beta" 文件夹;找不到返回 null(调用方让用户手动选)。 */
export async function findDotaDir(): Promise<string | null> {
  const steam = await steamPath();
  if (steam === null) return null;
  const libs: string[] = [];
  try { libs.push(...libraryPathsFromVdf(readFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "utf-8"))); }
  catch { /* 没有库列表就只看 Steam 根目录 */ }
  libs.push(steam);
  for (const lib of libs) {
    const dir = join(lib, "steamapps", "common", "dota 2 beta");
    if (existsSync(join(dir, "game", "dota"))) return dir;
  }
  return null;
}

/** 配置文件的完整路径。 */
export function gsiCfgPath(dotaDir: string): string {
  return join(dotaDir, "game", "dota", "cfg", "gamestate_integration", GSI_CFG_FILE_NAME);
}

/** 写配置文件(调用前必须已征得用户同意)。只建 gamestate_integration 这一级文件夹。 */
export function writeGsiCfg(dotaDir: string, content: string): string {
  const path = gsiCfgPath(dotaDir);
  mkdirSync(join(dotaDir, "game", "dota", "cfg", "gamestate_integration"), { recursive: true });
  writeFileSync(path, content, "utf-8");
  return path;
}

/** 删掉我们写的配置文件(只删这一个文件)。 */
export function removeGsiCfg(dotaDir: string): void {
  rmSync(gsiCfgPath(dotaDir), { force: true });
}

/** 读已有的配置文件;没有返回 null。 */
export function readGsiCfg(dotaDir: string): string | null {
  try { return readFileSync(gsiCfgPath(dotaDir), "utf-8"); } catch { return null; }
}
