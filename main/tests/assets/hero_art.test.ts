import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vpkArchiveName, vpkEntriesIn } from "../../src/assets/vpk";
import { decodeDxt5Rgb, decodeVtex } from "../../src/assets/vtex";
import { openHeroArt } from "../../src/assets/hero_art";

const SELECTION = "panorama/images/heroes/selection";

/** 拼一个 VPK 目录文件(版本 2)。 */
function vpkDir(files: { ext: string; dir: string; name: string; archive: number; offset: number; length: number; preload?: number }[]): Buffer {
  const parts: Buffer[] = [];
  const str = (s: string) => parts.push(Buffer.from(s + "\0", "utf8"));
  for (const f of files) {
    str(f.ext); str(f.dir); str(f.name);
    const e = Buffer.alloc(18 + (f.preload ?? 0));
    e.writeUInt16LE(f.preload ?? 0, 4); e.writeUInt16LE(f.archive, 6);
    e.writeUInt32LE(f.offset, 8); e.writeUInt32LE(f.length, 12); e.writeUInt16LE(0xffff, 16);
    parts.push(e);
    str(""); str(""); // 这个文件夹、这个扩展名结束
  }
  str("");
  const tree = Buffer.concat(parts);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0x55aa1234, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree]);
}

/** 拼一个 .vtex_c:文件头 + 一个 DATA 块 + 像素数据。 */
function vtex(width: number, height: number, format: number, pixels: Buffer): Buffer {
  const head = Buffer.alloc(16 + 12 + 40);
  head.writeUInt32LE(head.length, 0);
  head.writeUInt32LE(8, 8);  // 块表在偏移 16
  head.writeUInt32LE(1, 12); // 一个块
  head.write("DATA", 16, "ascii");
  head.writeUInt32LE(8, 20); // 块内容在偏移 28
  head.writeUInt32LE(40, 24);
  head.writeUInt16LE(width, 28 + 20); head.writeUInt16LE(height, 28 + 22); head.writeUInt8(format, 28 + 26);
  return Buffer.concat([head, pixels]);
}

/** 色差接近 0 的端点色(红 132、绿 130、蓝 0 → 放大倍数 1,色差 Co=4、Cg=2)。 */
const NEAR_GRAY = (16 << 11) | (32 << 5);

/** 一个 DXT5 块:亮度(透明度通道)两个端点 + 前 8 个像素的 3 位下标,颜色全用同一个端点色。 */
function dxt5Block(a0: number, a1: number, alphaBits = 0): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt8(a0, 0); b.writeUInt8(a1, 1); b.writeUIntLE(alphaBits, 2, 3);
  b.writeUInt16LE(NEAR_GRAY, 8); b.writeUInt16LE(NEAR_GRAY, 10);
  return b;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("vpkEntriesIn", () => {
  it("只取指定文件夹和扩展名的文件", () => {
    const dir = vpkDir([
      { ext: "vtex_c", dir: SELECTION, name: "npc_dota_hero_axe_png", archive: 62, offset: 100, length: 50 },
      { ext: "vtex_c", dir: "panorama/images/other", name: "x", archive: 1, offset: 0, length: 5 },
      { ext: "txt", dir: SELECTION, name: "readme", archive: 1, offset: 0, length: 5 },
    ]);
    const got = vpkEntriesIn(dir, "vtex_c", SELECTION);
    expect([...got.keys()]).toEqual(["npc_dota_hero_axe_png"]);
    expect(got.get("npc_dota_hero_axe_png")).toEqual({ archive: 62, offset: 100, length: 50 });
  });

  it("跳过数据在目录文件里的和带预载数据的文件,后面的文件照常解析", () => {
    const dir = vpkDir([
      { ext: "vtex_c", dir: SELECTION, name: "a", archive: 0x7fff, offset: 0, length: 5 },
      { ext: "vtex_c", dir: SELECTION, name: "b", archive: 1, offset: 0, length: 5, preload: 7 },
      { ext: "vtex_c", dir: SELECTION, name: "c", archive: 3, offset: 9, length: 5 },
    ]);
    expect([...vpkEntriesIn(dir, "vtex_c", SELECTION).keys()]).toEqual(["c"]);
  });

  it("不是 VPK 就抛错", () => {
    expect(() => vpkEntriesIn(Buffer.alloc(64), "vtex_c", SELECTION)).toThrow();
  });

  it("分包文件名补零到三位", () => {
    expect(vpkArchiveName(62)).toBe("pak01_062.vpk");
    expect(vpkArchiveName(671)).toBe("pak01_671.vpk");
  });
});

describe("decodeVtex", () => {
  it("里面是 PNG 的,原样交出 PNG 字节", () => {
    const got = decodeVtex(vtex(142, 188, 18, PNG));
    expect(got?.kind).toBe("png");
    expect(got?.kind === "png" && Buffer.from(got.png).equals(PNG)).toBe(true);
  });

  it("DXT5 的按「亮度 + 色差」换算成 RGB", () => {
    const got = decodeVtex(vtex(4, 4, 2, dxt5Block(100, 100)));
    expect(got?.kind).toBe("rgb");
    if (got?.kind !== "rgb") return;
    expect(got.frame.width).toBe(4);
    // 亮度 100,Co=4,Cg=2 → 红 100+4-2,绿 100+2,蓝 100-4-2
    for (let i = 0; i < 16; i++) expect([...got.frame.data.subarray(i * 3, i * 3 + 3)]).toEqual([102, 102, 94]);
  });

  it("亮度按下标在两个端点之间取值,结果超出范围时截到 0–255", () => {
    // 前三个像素的下标是 0、1、2 → 亮度 255、0、round(6×255/7)=219
    const frame = decodeDxt5Rgb(dxt5Block(255, 0, 0 | (1 << 3) | (2 << 6)), 4, 4);
    expect([...frame!.data.subarray(0, 9)]).toEqual([255, 255, 249, 2, 2, 0, 221, 221, 213]);
  });

  it("宽高不是 4 的倍数时只取图内的像素", () => {
    const frame = decodeDxt5Rgb(Buffer.concat([dxt5Block(50, 50), dxt5Block(200, 200)]), 6, 3);
    expect(frame?.data.length).toBe(6 * 3 * 3);
    expect([...frame!.data.subarray(0, 3)]).toEqual([52, 52, 44]);
    expect([...frame!.data.subarray(4 * 3, 4 * 3 + 3)]).toEqual([202, 202, 194]);
  });

  it("数据不够、存法不认识、文件太短都返回 null", () => {
    expect(decodeDxt5Rgb(Buffer.alloc(8), 4, 4)).toBeNull();
    expect(decodeVtex(vtex(4, 4, 4, Buffer.alloc(64)))).toBeNull();
    expect(decodeVtex(Buffer.alloc(4))).toBeNull();
  });
});

describe("openHeroArt", () => {
  it("按 picture 名从分包里读出立绘;没有的返回 null", () => {
    const dota = mkdtempSync(join(tmpdir(), "ad-hero-art-"));
    const pak = join(dota, "game", "dota");
    mkdirSync(pak, { recursive: true });
    const file = vtex(142, 188, 18, PNG);
    writeFileSync(join(pak, "pak01_007.vpk"), Buffer.concat([Buffer.alloc(33, 0xee), file, Buffer.alloc(9, 0xee)]));
    writeFileSync(join(pak, "pak01_dir.vpk"), vpkDir([
      { ext: "vtex_c", dir: SELECTION, name: "npc_dota_hero_axe_png", archive: 7, offset: 33, length: file.length },
      { ext: "vtex_c", dir: SELECTION, name: "npc_dota_hero_lost_png", archive: 8, offset: 0, length: 10 },
    ]));
    const art = openHeroArt(dota);
    expect(art.count).toBe(2);
    const axe = art.read("axe");
    expect(axe?.kind === "png" && Buffer.from(axe.png).equals(PNG)).toBe(true);
    expect(art.read("nobody")).toBeNull();
    expect(art.read("lost")).toBeNull(); // 分包文件不在
  });

  it("没有资源包目录就抛错", () => {
    expect(() => openHeroArt(mkdtempSync(join(tmpdir(), "ad-hero-art-")))).toThrow();
  });
});
