"""Pillow 只做解码 + 灰度;缩放交给共享的 resize_gray_to_32。"""
from pathlib import Path

from PIL import Image

from .resize import resize_gray_to_32


def load_gray(path: Path) -> list[list[int]]:
    """解码为原生分辨率灰度二维 list(H×W),不缩放。"""
    img = Image.open(path).convert("L")
    w, h = img.size
    px = list(img.tobytes())  # 灰度 "L" 每像素 1 字节,行优先
    return [[px[r * w + c] for c in range(w)] for r in range(h)]


def to_gray32(path: Path) -> list[list[int]]:
    """解码 → 灰度 → 共享双线性缩放到 32×32。"""
    return resize_gray_to_32(load_gray(path))
