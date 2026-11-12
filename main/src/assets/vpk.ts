// main/src/assets/vpk.ts
// 读 Valve 资源包(VPK)的目录:pak01_dir.vpk 里是一棵「扩展名 → 文件夹 → 文件名」的树,
// 每个文件记着它在哪个分包(pak01_NNN.vpk)的哪一段。这里只解析目录,纯函数,不碰磁盘。

/** 一个文件在分包里的位置。 */
export interface VpkEntry { archive: number; offset: number; length: number; }

const SIGNATURE = 0x55aa1234;
/** 分包号是这个值时,数据在目录文件自己里面(我们要的图不在这种情况里,跳过)。 */
const IN_DIR_FILE = 0x7fff;

/** 取出某个文件夹下某种扩展名的全部文件(文件名不带扩展名)。格式不对时抛错。 */
export function vpkEntriesIn(dirVpk: Buffer, ext: string, dir: string): Map<string, VpkEntry> {
  if (dirVpk.length < 12 || dirVpk.readUInt32LE(0) !== SIGNATURE) throw new Error("不是 VPK 目录文件");
  const version = dirVpk.readUInt32LE(4);
  if (version !== 1 && version !== 2) throw new Error(`不认识的 VPK 版本 ${version}`);
  let p = version === 2 ? 28 : 12;
  const readStr = (): string => {
    const end = dirVpk.indexOf(0, p);
    if (end < 0) throw new Error("VPK 目录不完整");
    const s = dirVpk.toString("utf8", p, end);
    p = end + 1;
    return s;
  };
  const out = new Map<string, VpkEntry>();
  for (;;) {
    const e = readStr();
    if (e === "") break;
    for (;;) {
      const d = readStr();
      if (d === "") break;
      for (;;) {
        const name = readStr();
        if (name === "") break;
        if (p + 18 > dirVpk.length) throw new Error("VPK 目录不完整");
        const preload = dirVpk.readUInt16LE(p + 4);
        const archive = dirVpk.readUInt16LE(p + 6);
        const offset = dirVpk.readUInt32LE(p + 8);
        const length = dirVpk.readUInt32LE(p + 12);
        p += 18 + preload;
        if (e === ext && d === dir && preload === 0 && archive !== IN_DIR_FILE) out.set(name, { archive, offset, length });
      }
    }
  }
  return out;
}

/** 分包的文件名:pak01_062.vpk。 */
export function vpkArchiveName(archive: number): string {
  return `pak01_${String(archive).padStart(3, "0")}.vpk`;
}
