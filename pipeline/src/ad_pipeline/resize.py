"""权威双线性缩放到 32x32(灰度)。TS 端必须逐位对齐。

半像素中心对齐 + clamp 边界 + floor(v+0.5) 舍入。
不用 Pillow/sharp 的内置 resize——各库核不同会破坏两端 pHash 一致性。
"""
import math

_N = 32


def resize_gray_to_32(src: list[list[int]]) -> list[list[int]]:
    h = len(src)
    w = len(src[0])
    out: list[list[int]] = []
    for ry in range(_N):
        sy = (ry + 0.5) * h / _N - 0.5
        y0 = math.floor(sy)
        fy = sy - y0
        y0c = min(max(y0, 0), h - 1)
        y1c = min(max(y0 + 1, 0), h - 1)
        row: list[int] = []
        for rx in range(_N):
            sx = (rx + 0.5) * w / _N - 0.5
            x0 = math.floor(sx)
            fx = sx - x0
            x0c = min(max(x0, 0), w - 1)
            x1c = min(max(x0 + 1, 0), w - 1)
            top = src[y0c][x0c] * (1 - fx) + src[y0c][x1c] * fx
            bot = src[y1c][x0c] * (1 - fx) + src[y1c][x1c] * fx
            val = top * (1 - fy) + bot * fy
            row.append(int(math.floor(val + 0.5)))
        out.append(row)
    return out
