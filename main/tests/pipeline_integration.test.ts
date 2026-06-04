import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { toGrayFrame } from "../src/decode";
import { cropGrid, type GridSpec } from "@ad/core/recognition/grid";
import { rawRgbToGray } from "@ad/core/recognition/gray";
import { resizeGrayTo32 } from "@ad/core/recognition/resize";
import { phashFromGray } from "@ad/core/recognition/phash";
import { recognizeCell } from "@ad/core/recognition/recognize";
import type { IndexEntry } from "@ad/core/recognition/index_store";

// 端到端(无真实游戏帧):造一张已知 sprite,建小索引,把它原样贴进一帧的某格,
// 走 decode → cropGrid → recognizeCell,断言识别回该 sprite 的 valveId。
// 关键:贴帧不二次缩放(格尺寸 = sprite 尺寸),让查询与建索引走同一缩放链,
// 避免「合成步骤本身引入的缩放分歧」干扰这条管线连通性验证。
// 真实游戏帧的识别(含分辨率缩放鲁棒性)留作手动冒烟(recognize_once.ts,Step 6)。

const SW = 53, SH = 47;

function spriteRaw(seed: number): Buffer {
  const raw = Buffer.alloc(SW * SH * 3);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 3;
      raw[i] = (x * 5 + seed) % 256;
      raw[i + 1] = (y * 7 + seed) % 256;
      raw[i + 2] = ((x + y) * 3 + seed) % 256;
    }
  }
  return raw;
}

function spritePng(seed: number): Promise<Buffer> {
  return sharp(spriteRaw(seed), { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer();
}

async function phashOfPng(png: Buffer): Promise<string> {
  const { data, info } = await sharp(png).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const gray = rawRgbToGray(data, info.width, info.height, info.channels);
  return phashFromGray(resizeGrayTo32(gray));
}

describe("end-to-end recognition pipeline (synthetic frame)", () => {
  it("recognizes a known sprite placed in a grid cell", async () => {
    const target = await spritePng(0);
    const index: IndexEntry[] = [
      { valveId: 5051, shortName: "test_sprite", phash: await phashOfPng(target) },
      { valveId: -9, shortName: "decoy", phash: await phashOfPng(await spritePng(99)) },
    ];

    // 格尺寸 = sprite 原尺寸(SW×SH),贴帧不二次缩放
    const spec: GridSpec = { x: 480, y: 200, cellW: SW, cellH: SH, gapX: 0, gapY: 0, rows: 1, cols: 1 };
    const framePng = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).composite([{ input: target, left: spec.x, top: spec.y }]).png().toBuffer();
    const frame = await toGrayFrame(framePng);

    const cells = cropGrid(frame, spec);
    const m = recognizeCell(cells[0], index, 8);
    expect(m?.valveId).toBe(5051);
    expect(m?.distance).toBeLessThanOrEqual(8);
  });
});
