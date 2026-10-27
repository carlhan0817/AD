import type { CSSProperties } from "react";
import { useOverlayStore } from "./store";
import { toViewModel } from "./view_model";

// 样式全部内联:项目没有装 Tailwind,className 写的样式不会生效(之前文字是默认黑字、看不见)。
// 位置有讲究:overlay 会被扫描截屏一起拍进去,面板必须放在不挡识别区域的地方。
// 右下角(右列最后一张玩家卡下方到屏幕底边,聊天框右边)在选人前、选人中都是空的
// (1920×1080 下约 x 1315–1910、y 975–1075 像素),这里用视口百分比描述,换分辨率也跟着走。
// 之前放右上角会盖住右边第一张玩家卡;顶部那条在选人开始前是 20 个头像位,也不空。
const panel: CSSProperties = {
  position: "fixed", bottom: "0.4vh", right: "0.5vw", width: "31vw", maxHeight: "9.8vh", overflow: "hidden",
  boxSizing: "border-box", padding: "0.5vh 0.8vw", borderRadius: 6,
  background: "rgba(10, 12, 16, 0.85)", border: "1px solid rgba(255, 210, 80, 0.7)",
  color: "#f2f2f2", fontFamily: "'Microsoft YaHei', 'Segoe UI', sans-serif", fontSize: "1.3vh", lineHeight: 1.35,
  pointerEvents: "none", boxShadow: "0 2px 12px rgba(0, 0, 0, 0.6)",
};
const header: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "0.6vw", marginBottom: "0.2vh" };
const title: CSSProperties = { color: "#ffd250", fontWeight: 700 };
const muted: CSSProperties = { color: "rgba(255, 255, 255, 0.7)" };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "1vw" };
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "0.4vw", whiteSpace: "nowrap", overflow: "hidden" };
const top: CSSProperties = { ...row, color: "#ffd250", fontWeight: 700 };
const name: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis" };

const SLOT_TEXT: Record<string, string> = { hero: "英雄", normal: "普通", ultimate: "大招" };

export function Overlay() {
  const snapshot = useOverlayStore((s) => s.snapshot);
  // 无数据时不再隐身:画一个可见占位,证明 overlay 已置顶/穿透/未崩游戏。
  // (看不见的 overlay 等同于启动失败,用户无从判断窗口是否在跑。)
  if (!snapshot) {
    return (
      <div style={panel}>
        <div style={title}>AD 助手 · 等待数据</div>
        <div style={muted}>进入选取界面后按 Ctrl+Shift+S 扫描(扫描时鼠标别停在技能上)</div>
      </div>
    );
  }
  const vm = toViewModel(snapshot);
  return (
    <div style={panel}>
      <div style={header}>
        <span style={title}>推荐 · Ctrl+Shift+S 刷新</span>
        <span style={muted}>剩余 英雄{vm.remaining.hero} 普通{vm.remaining.normal} 大招{vm.remaining.ultimate}</span>
      </div>
      {vm.note !== null && <div style={muted}>{vm.note}</div>}
      {vm.rows.length === 0 && <div style={muted}>没有可推荐的(池子没认出来?)</div>}
      <div style={grid}>
        {vm.rows.map((r) => (
          <div key={r.valveId} style={r.highlighted ? top : row}>
            <span style={name}>{r.label}</span>
            <span style={r.highlighted ? undefined : muted}>{SLOT_TEXT[r.slotType] ?? r.slotType} {r.scoreText}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
