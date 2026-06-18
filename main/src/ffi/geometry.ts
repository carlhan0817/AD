// 纯几何:游戏客户区矩形 → overlay 窗口 bounds。无 koffi,可 CI 测。
export interface WindowRect { x: number; y: number; width: number; height: number }

/** overlay 完整覆盖游戏客户区(当前为 1:1;后续若需留边在此调整)。 */
export function rectToOverlayBounds(rect: WindowRect): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
