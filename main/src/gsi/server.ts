// main/src/gsi/server.ts
// 收 Dota 发来的 GSI 数据的本机服务器。只听 127.0.0.1(别的电脑连不上),只收 POST,
// 口令对不上的一律丢掉。只接收、不往外发任何东西。
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseGsi, tokenOf, type GsiState } from "@ad/core/gsi/gsi";

/** 一次 POST 最多收这么多字节。只要 map 段时每次不到 2KB;超过就当作不是 Dota 发的。 */
const MAX_BODY_BYTES = 1_000_000;

export interface GsiServer {
  port: number;
  close(): Promise<void>;
}

/** 在本机开服务器。port=0 时由系统挑一个空闲端口(实际端口见返回值)。 */
export function startGsiServer(
  port: number, token: string, onState: (s: GsiState) => void,
): Promise<GsiServer> {
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")); }
      catch { res.writeHead(400).end(); return; }
      if (tokenOf(payload) !== token) { res.writeHead(403).end(); return; }
      res.writeHead(200).end();
      onState(parseGsi(payload));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
