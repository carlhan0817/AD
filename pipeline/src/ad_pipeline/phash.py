"""8x8 DCT 感知哈希(权威实现,TS 端必须位对齐)。无第三方依赖。

接收已是 32x32 的灰度图(缩放由 resize.resize_gray_to_32 负责)。
"""
import math

EPS = 1e-6  # 中位数比较的浮点临界带;TS 端必须用同一常量


def _dct_1d(vec: list[float]) -> list[float]:
    n = len(vec)
    out = []
    for k in range(n):
        s = 0.0
        for i in range(n):
            s += vec[i] * math.cos(math.pi * (2 * i + 1) * k / (2 * n))
        out.append(s)
    return out


def _dct_2d(mat: list[list[float]]) -> list[list[float]]:
    rows = [_dct_1d(r) for r in mat]
    cols = []
    n = len(rows)
    for k in range(len(rows[0])):
        col = _dct_1d([rows[i][k] for i in range(n)])
        cols.append(col)
    # cols[k][i] = 第 k 列的 DCT;转回 [i][k]
    return [[cols[k][i] for k in range(len(cols))] for i in range(n)]


def phash_from_gray(gray32: list[list[int]]) -> str:
    assert len(gray32) == 32 and len(gray32[0]) == 32
    dct = _dct_2d([[float(v) for v in row] for row in gray32])
    low = [dct[r][c] for r in range(8) for c in range(8)]
    rest = [v for i, v in enumerate(low) if i != 0]  # 排除 DC [0,0]
    rest_sorted = sorted(rest)
    m = len(rest_sorted)
    median = (rest_sorted[m // 2] if m % 2 else
              (rest_sorted[m // 2 - 1] + rest_sorted[m // 2]) / 2)
    bits = 0
    for v in low:
        bits = (bits << 1) | (1 if v > median + EPS else 0)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")
