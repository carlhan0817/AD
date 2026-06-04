// 8x8 DCT 感知哈希。算法必须与 pipeline/src/ad_pipeline/phash.py 完全一致。

const EPS = 1e-6; // 中位数比较的浮点临界带;必须与 phash.py 的 EPS 同值

function dct1d(vec: number[]): number[] {
  const n = vec.length;
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += vec[i] * Math.cos((Math.PI * (2 * i + 1) * k) / (2 * n));
    }
    out[k] = s;
  }
  return out;
}

function dct2d(mat: number[][]): number[][] {
  const rows = mat.map(dct1d);
  const n = rows.length;
  const cols: number[][] = [];
  for (let k = 0; k < rows[0].length; k++) {
    cols.push(dct1d(rows.map((_, i) => rows[i][k])));
  }
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: cols.length }, (_, k) => cols[k][i]));
}

export function phashFromGray(gray32: number[][]): string {
  const dct = dct2d(gray32.map((r) => r.map(Number)));
  const low: number[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) low.push(dct[r][c]);
  const rest = low.filter((_, i) => i !== 0).slice().sort((a, b) => a - b);
  const m = rest.length;
  const median = m % 2 ? rest[(m - 1) / 2] : (rest[m / 2 - 1] + rest[m / 2]) / 2;
  let bits = 0n;
  for (const v of low) bits = (bits << 1n) | (v > median + EPS ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x > 0n) { count += Number(x & 1n); x >>= 1n; }
  return count;
}
