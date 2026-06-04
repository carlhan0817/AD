from ad_pipeline.phash import phash_from_gray, hamming


def _solid(value):  # 32x32 纯色灰度,二维 list
    return [[value] * 32 for _ in range(32)]


def test_phash_is_16_hex_chars():
    h = phash_from_gray(_solid(128))
    assert isinstance(h, str) and len(h) == 16
    int(h, 16)  # 可解析为十六进制


def test_identical_images_zero_distance():
    a = phash_from_gray(_solid(100))
    b = phash_from_gray(_solid(100))
    assert hamming(a, b) == 0


def test_different_images_nonzero_distance():
    # 左半暗右半亮 vs 纯色,应有差异
    half = [[0] * 16 + [255] * 16 for _ in range(32)]
    assert hamming(phash_from_gray(half), phash_from_gray(_solid(128))) > 0
