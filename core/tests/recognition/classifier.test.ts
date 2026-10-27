// core/tests/recognition/classifier.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadClassifier, CLASSIFIER_INPUT_SIZE, type Classifier } from "../../src/recognition/classifier";

const MODEL = fileURLToPath(new URL("../../../models/classifier/ability_classifier_fp16.onnx", import.meta.url));
const NAMES = fileURLToPath(new URL("../../../models/classifier/class_names.json", import.meta.url));
// 真选取截图里裁下的一格(viper_corrosive_skin,53×47),已入库。
const CELL = fileURLToPath(new URL("./fixtures/cell_viper_corrosive_skin.png", import.meta.url));

// 与训练侧一致:双线性缩放到 96×96(sharp 默认 lanczos3 会带来模型没见过的锐化)。
// 本版 sharp 运行时支持 "linear" 但类型声明里还没有,故断言。
async function toRgb96(path: string): Promise<Uint8Array> {
  const buf = await sharp(path).removeAlpha()
    .resize(CLASSIFIER_INPUT_SIZE, CLASSIFIER_INPUT_SIZE, { kernel: "linear" as keyof sharp.KernelEnum, fit: "fill" })
    .raw().toBuffer();
  return new Uint8Array(buf);
}

describe("classifier", () => {
  let clf: Classifier;
  beforeAll(async () => { clf = await loadClassifier(MODEL, NAMES); }, 30_000);

  it("加载模型与类别名单", () => {
    expect(clf.classNames.length).toBe(528);
    expect(clf.classNames).toContain("viper_corrosive_skin");
  });

  it("认对一张真机裁格,且把握 ≥ 0.9", async () => {
    const [p] = await clf.classify(await toRgb96(CELL));
    expect(p.name).toBe("viper_corrosive_skin");
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
    expect(p.runnerUp).not.toBe(p.name);
  });

  it("批量:两格进、两条结果出,顺序对应", async () => {
    const one = await toRgb96(CELL);
    const two = new Uint8Array(one.length * 2);
    two.set(one, 0); two.set(one, one.length);
    const res = await clf.classify(two);
    expect(res.map((r) => r.name)).toEqual(["viper_corrosive_skin", "viper_corrosive_skin"]);
  });

  it("空输入返回空数组;长度不是整格倍数时报错", async () => {
    expect(await clf.classify(new Uint8Array(0))).toEqual([]);
    await expect(clf.classify(new Uint8Array(10))).rejects.toThrow();
  });
});
