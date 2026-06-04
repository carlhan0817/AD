"""生成确定性测试 PNG,并用 Python 权威管线算出 phash 写入 json。
运行(在 pipeline venv 下):python core/tests/fixtures/make_xval_png.py
"""
import json
import pathlib

from PIL import Image

from ad_pipeline.imageio import to_gray32
from ad_pipeline.phash import phash_from_gray

HERE = pathlib.Path(__file__).parent
PNG = HERE / "xval_sprite.png"


def main() -> None:
    # 非平凡确定性图案:渐变 + 方块,尺寸非 32 整数倍(逼出 resize 分歧)
    w, h = 53, 47
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            r = (x * 5) % 256
            g = (y * 7) % 256
            b = ((x + y) * 3) % 256
            if 10 <= x < 25 and 8 <= y < 30:
                r, g, b = 240, 12, 200  # 一个高对比方块
            px[x, y] = (r, g, b)
    img.save(PNG)
    h32 = phash_from_gray(to_gray32(PNG))
    (HERE / "xval_expected.json").write_text(
        json.dumps({"phash": h32}), encoding="utf-8")
    print("wrote", PNG.name, "phash=", h32)


if __name__ == "__main__":
    main()
