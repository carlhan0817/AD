// shared/types/draft.ts
// 草稿领域类型(跨 core/main/renderer 共用)。计划书 §一/§四。
// slot_type 与阶段 1 ReferenceDb.SlotType 同集合;此处独立声明避免 core→shared 反向依赖。

export type SlotType = "hero" | "normal" | "ultimate";

/** 一名玩家的配额记账。剩余配额 = 上限 - 已用。 */
export interface PlayerState {
  /** 玩家行索引 0..9(对齐十行 UI 顺序)。 */
  row: number;
  /** 已选英雄的 valveId(负数 = -heroId);未选为 null。 */
  hero: number | null;
  /** 已选普通技能的 valveId 列表(正数),上限 3。 */
  normals: number[];
  /** 已选终极技能的 valveId 列表(正数),上限 1。 */
  ultimates: number[];
}

/** 配额上限(AD 模式硬约束:1 英雄 + 3 普通 + 1 终极)。 */
export const QUOTA = { hero: 1, normal: 3, ultimate: 1 } as const;

/** Active Picker 探头读出的「当前轮到谁」。none = 本帧未检出高亮(可能动画中)。 */
export interface ActivePicker {
  /** 当前活动玩家行;未检出为 null。 */
  row: number | null;
}

/** 单行槽位占用快照(整帧重读,用于对账)。 */
export interface SlotOccupancy {
  row: number;
  hero: number | null;
  normals: number[];
  ultimates: number[];
}

/** 一个有效帧的整帧观察结果,喂给对账器。 */
export interface FrameObservation {
  activePicker: ActivePicker;
  /** 十行槽位占用(长度 10)。 */
  slots: SlotOccupancy[];
}

/** 完整草稿状态。生命周期 = 一局,纯内存,不落库。 */
export interface DraftState {
  players: PlayerState[]; // 长度 10
  /** 当前轮到的玩家行;未知为 null。 */
  activeRow: number | null;
}
