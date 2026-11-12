// core/src/scoring/pair_key.ts
/** 顺序无关的 pair 键:两 valveId 升序拼接。 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
