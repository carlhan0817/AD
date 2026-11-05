import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { FrameStore } from "../../src/capture/frame_store";

const frame = { width: 4, height: 2, data: new Uint8Array(4 * 2 * 3).fill(128) };

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "frame_store_")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const gameDirs = () => readdirSync(root).filter((n) => n.startsWith("game_")).sort();

describe("FrameStore", () => {
  it("连续 7 局各存 1 帧,只剩最新的 5 个 game_ 文件夹", async () => {
    const store = new FrameStore(root, 5);
    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      store.newGame();
      const p = await store.save(frame, `g${i}`);
      expect(p).not.toBeNull();
      expect(existsSync(p!)).toBe(true);
      created.push(basename(dirname(p!)));
    }
    const dirs = gameDirs();
    expect(dirs).toHaveLength(5);
    const expected = created.slice(2).sort();
    expect(dirs).toEqual(expected);
  });

  it("newGame 之后不存帧,不建空文件夹", async () => {
    const store = new FrameStore(root);
    store.newGame();
    store.newGame();
    expect(gameDirs()).toHaveLength(0);
  });

  it("同一局多帧存在同一个文件夹", async () => {
    const store = new FrameStore(root);
    store.newGame();
    const a = await store.save(frame, "a");
    const b = await store.save(frame, "b");
    expect(gameDirs()).toHaveLength(1);
    expect(a).not.toBe(b);
  });

  it("root 下原有的散放 PNG 始终保留", async () => {
    writeFileSync(join(root, "scan_old.png"), "x");
    const store = new FrameStore(root, 2);
    for (let i = 0; i < 4; i++) { store.newGame(); await store.save(frame, "f"); }
    expect(existsSync(join(root, "scan_old.png"))).toBe(true);
    expect(gameDirs()).toHaveLength(2);
  });

  it("存失败返回 null 不抛错", async () => {
    const store = new FrameStore(root);
    store.newGame();
    const bad = { width: 4, height: 2, data: new Uint8Array(3) };
    expect(await store.save(bad, "bad")).toBeNull();
  });
});
