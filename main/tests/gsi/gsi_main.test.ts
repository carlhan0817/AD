// main/tests/gsi/gsi_main.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGsiServer, type GsiServer } from "../../src/gsi/server";
import { libraryPathsFromVdf, writeGsiCfg, removeGsiCfg, readGsiCfg, gsiCfgPath } from "../../src/gsi/dota_path";
import { buildGsiCfg, GSI_CFG_FILE_NAME, type GsiState } from "@ad/core/gsi/gsi";

let server: GsiServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

const post = (port: number, body: string, method = "POST") =>
  fetch(`http://127.0.0.1:${port}/`, { method, body: method === "POST" ? body : undefined }).then((r) => r.status);

describe("GSI 本机服务器", () => {
  it("口令对的数据收下并读出阶段", async () => {
    const got: GsiState[] = [];
    server = await startGsiServer(0, "tok", (s) => got.push(s));
    const body = JSON.stringify({ map: { game_state: "DOTA_GAMERULES_STATE_STRATEGY_TIME", matchid: "9", clock_time: 1 }, auth: { token: "tok" } });
    expect(await post(server.port, body)).toBe(200);
    expect(got).toEqual([{ phase: "DOTA_GAMERULES_STATE_STRATEGY_TIME", matchId: "9", clock: 1 }]);
  });
  it("口令不对、没有口令、不是 JSON、不是 POST 都拒绝,且不触发回调", async () => {
    const got: GsiState[] = [];
    server = await startGsiServer(0, "tok", (s) => got.push(s));
    const map = { map: { game_state: "X" } };
    expect(await post(server.port, JSON.stringify({ ...map, auth: { token: "bad" } }))).toBe(403);
    expect(await post(server.port, JSON.stringify(map))).toBe(403);
    expect(await post(server.port, "not json")).toBe(400);
    expect(await post(server.port, "", "GET")).toBe(405);
    expect(got).toEqual([]);
  });
});

describe("找 Dota 与配置文件", () => {
  it("从 Steam 库列表里取路径,装了 Dota(570)的库排最前", () => {
    const vdf = `"libraryfolders"
{
  "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "228980" "1" } }
  "1" { "path" "D:\\\\SteamLibrary" "apps" { "570" "123" } }
}`;
    expect(libraryPathsFromVdf(vdf)).toEqual(["D:\\SteamLibrary", "C:\\Program Files (x86)\\Steam"]);
    expect(libraryPathsFromVdf("garbage")).toEqual([]);
  });
  it("只在 cfg/gamestate_integration/ 下写我们这一个文件,能读回、能删掉", () => {
    const dota = mkdtempSync(join(tmpdir(), "dota-"));
    try {
      const content = buildGsiCfg(39871, "tok");
      const path = writeGsiCfg(dota, content);
      expect(path).toBe(join(dota, "game", "dota", "cfg", "gamestate_integration", GSI_CFG_FILE_NAME));
      expect(readFileSync(path, "utf-8")).toBe(content);
      expect(readGsiCfg(dota)).toBe(content);
      removeGsiCfg(dota);
      expect(existsSync(gsiCfgPath(dota))).toBe(false);
      expect(readGsiCfg(dota)).toBeNull();
    } finally { rmSync(dota, { recursive: true, force: true }); }
  });
});
