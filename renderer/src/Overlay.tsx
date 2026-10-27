import type { CSSProperties } from "react";
import { useOverlayStore } from "./store";
import { toViewModel } from "./view_model";

// 样式全部内联:项目没有装 Tailwind,className 写的样式不会生效(之前文字是默认黑字、看不见)。
// 面板放右上角、深色半透明底 + 亮色字,压在游戏上也读得清。
// 位置有讲究:overlay 会被扫描截屏一起拍进去,右上角避开了技能池(x≈690–1230)和
// 两侧英雄模型格(x≈570–680、1240–1350),只盖住游戏右上角的标题文字。
const panel: CSSProperties = {
  position: "fixed", top: 16, right: 16, minWidth: 260, maxWidth: 360,
  padding: "10px 14px", borderRadius: 8,
  background: "rgba(10, 12, 16, 0.85)", border: "1px solid rgba(255, 210, 80, 0.7)",
  color: "#f2f2f2", fontFamily: "'Microsoft YaHei', 'Segoe UI', sans-serif", fontSize: 15, lineHeight: 1.5,
  pointerEvents: "none", boxShadow: "0 2px 12px rgba(0, 0, 0, 0.6)",
};
const title: CSSProperties = { color: "#ffd250", fontWeight: 700, fontSize: 16, marginBottom: 4 };
const muted: CSSProperties = { color: "rgba(255, 255, 255, 0.7)", fontSize: 13 };
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" };
const top: CSSProperties = { ...row, color: "#ffd250", fontWeight: 700, fontSize: 17 };

const SLOT_TEXT: Record<string, string> = { hero: "英雄", normal: "普通", ultimate: "大招" };

export function Overlay() {
  const snapshot = useOverlayStore((s) => s.snapshot);
  // 无数据时不再隐身:画一个可见占位,证明 overlay 已置顶/穿透/未崩游戏。
  // (看不见的 overlay 等同于启动失败,用户无从判断窗口是否在跑。)
  if (!snapshot) {
    return (
      <div style={panel}>
        <div style={title}>AD 助手 · 等待数据</div>
        <div style={muted}>overlay 已就绪(置顶 · 点击穿透)</div>
        <div style={muted}>进入选取界面后按 Ctrl+Shift+S 扫描</div>
      </div>
    );
  }
  const vm = toViewModel(snapshot);
  return (
    <div style={panel}>
      <div style={title}>推荐(按 Ctrl+Shift+S 刷新)</div>
      {vm.rows.length === 0 && <div style={muted}>没有可推荐的(池子没认出来?)</div>}
      {vm.rows.map((r) => (
        <div key={r.valveId} style={r.highlighted ? top : row}>
          <span>{r.label}</span>
          <span style={r.highlighted ? undefined : muted}>{SLOT_TEXT[r.slotType] ?? r.slotType} · {r.scoreText}</span>
        </div>
      ))}
      <div style={{ ...muted, marginTop: 6 }}>
        剩余:英雄 {vm.remaining.hero} · 普通 {vm.remaining.normal} · 大招 {vm.remaining.ultimate}
      </div>
    </div>
  );
}
