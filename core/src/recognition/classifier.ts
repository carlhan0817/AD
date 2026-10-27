// core/src/recognition/classifier.ts
// 技能图标分类器(ONNX)。模型与类别名单来自 Tiarin-Hino/ability-draft-plus(ISC,
// 见 models/classifier/LICENSE-ability-draft-plus.txt):FP16 MobileNetV2,
// 输入 [N,96,96,3] float32、像素保持 0–255 原值(归一化在模型图内),输出 [N,类别数] 概率。
// 单一职责:加载模型 + 对已缩放好的 96×96 RGB 批量给出「最像哪个技能、多大把握」。
// 裁格/缩放/判空/阈值取舍都不在这里(调用方决定)。
import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-node";

export const CLASSIFIER_INPUT_SIZE = 96;
const PIXELS_PER_CELL = CLASSIFIER_INPUT_SIZE * CLASSIFIER_INPUT_SIZE * 3;

export interface Prediction {
  /** 概率最高的技能 shortName。 */
  name: string;
  confidence: number;
  /** 第二名(用于判断领先幅度)。 */
  runnerUp: string;
  runnerUpConfidence: number;
}

export interface Classifier {
  classNames: string[];
  /** rgb96:N 格首尾相接的 96×96 RGB 原始字节(每格 96*96*3)。 */
  classify(rgb96: Uint8Array): Promise<Prediction[]>;
}

export async function loadClassifier(modelPath: string, classNamesPath: string): Promise<Classifier> {
  const classNames = JSON.parse(readFileSync(classNamesPath, "utf-8")) as string[];
  const session = await ort.InferenceSession.create(modelPath);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  async function classify(rgb96: Uint8Array): Promise<Prediction[]> {
    if (rgb96.length % PIXELS_PER_CELL !== 0) {
      throw new Error(`classify: 输入长度 ${rgb96.length} 不是 ${PIXELS_PER_CELL} 的整数倍`);
    }
    const n = rgb96.length / PIXELS_PER_CELL;
    if (n === 0) return [];
    const input = new ort.Tensor("float32", Float32Array.from(rgb96),
      [n, CLASSIFIER_INPUT_SIZE, CLASSIFIER_INPUT_SIZE, 3]);
    const probs = (await session.run({ [inputName]: input }))[outputName].data as Float32Array;
    const c = classNames.length;
    // 类别数以名单为准;与模型输出宽度对不上说明名单和模型不是一套,直接报错而不是错位取名。
    if (probs.length !== n * c) {
      throw new Error(`classify: 模型输出 ${probs.length / n} 类,与名单 ${c} 类不一致`);
    }
    const out: Prediction[] = [];
    for (let i = 0; i < n; i++) {
      let best = 0, second = -1;
      for (let k = 1; k < c; k++) {
        if (probs[i * c + k] > probs[i * c + best]) { second = best; best = k; }
        else if (second < 0 || probs[i * c + k] > probs[i * c + second]) second = k;
      }
      out.push({
        name: classNames[best], confidence: probs[i * c + best],
        runnerUp: classNames[second], runnerUpConfidence: probs[i * c + second],
      });
    }
    return out;
  }

  return { classNames, classify };
}
