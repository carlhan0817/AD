from ad_pipeline.resize import resize_gray_to_32


def test_output_is_32x32():
    src = [[100] * 10 for _ in range(10)]
    out = resize_gray_to_32(src)
    assert len(out) == 32 and all(len(r) == 32 for r in out)
    assert all(isinstance(v, int) for v in out[0])


def test_solid_image_preserved():
    src = [[128] * 64 for _ in range(64)]
    out = resize_gray_to_32(src)
    assert all(v == 128 for row in out for v in row)


def test_known_2x2_upscale_center_alignment():
    # 2x2 棋盘放大到 32x32:四角应分别接近四个源值
    src = [[0, 255], [255, 0]]
    out = resize_gray_to_32(src)
    assert out[0][0] == 0       # 左上角对齐源 (0,0)=0
    assert out[0][31] == 255    # 右上角对齐源 (0,1)=255
    assert out[31][0] == 255    # 左下角
    assert out[31][31] == 0     # 右下角
