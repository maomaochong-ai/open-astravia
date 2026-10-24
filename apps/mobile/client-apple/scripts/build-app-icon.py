#!/usr/bin/env python3
"""从一张品牌图生成 iOS / Android / 官网所需的全部图标尺寸。

为什么需要它：App Store 与 iOS 系统图标必须是**不透明、满幅**的方图（系统自己加圆角），
而设计稿通常是一枚四周透明的图形。直接塞进 Assets.xcassets 会得到一圈白边，
所以这里先把透明区域按最近的边缘颜色填满，再按各平台尺寸导出，保证每端都是同一张图。

用法：
    python3 scripts/build-app-icon.py                  # 用默认源图（docs/assets/banner.webp）
    python3 scripts/build-app-icon.py <源图.png|webp>   # 换一张源图

默认源图取自仓库的 docs/assets/banner.webp（512×512，与桌面端打包图标同一枚图形），
这样桌面、iOS、Android、官网不会各用一套图标。banner.png 只有 160，细节不够 1024 图标用。
"""

from __future__ import annotations

import struct
import zlib
import subprocess
import sys
from collections import deque
from pathlib import Path

APPLE_ROOT = Path(__file__).resolve().parent.parent            # apps/mobile/client-apple
REPO_ROOT = APPLE_ROOT.parents[2]                               # 仓库根
DEFAULT_SOURCE = REPO_ROOT / "docs/assets/banner.webp"
WORK = APPLE_ROOT / "build/icon-work"

# iOS：一张 1024 的满幅方图，系统负责圆角与投影
IOS_ICON = APPLE_ROOT / "Astravia/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

# Android：传统位图 + 自适应图标的两层
ANDROID_RES = REPO_ROOT / "apps/mobile/client-android/androidApp/src/main/res"
LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# 官网：站点图标与 iOS 主屏书签图标
SITE_ICONS = {
    REPO_ROOT / "website/public/favicon.png": 512,
    REPO_ROOT / "website/public/apple-touch-icon.png": 180,
}


def run(*args: str) -> None:
    subprocess.run(args, check=True, capture_output=True)


def load_bmp(path: Path) -> tuple[int, int, list[list[tuple[int, int, int, int]]]]:
    """读 24/32 位未压缩 BMP，返回自顶向下的像素矩阵。"""
    data = path.read_bytes()
    offset = struct.unpack_from("<I", data, 10)[0]
    width = struct.unpack_from("<i", data, 18)[0]
    height = abs(struct.unpack_from("<i", data, 22)[0])
    bpp = struct.unpack_from("<H", data, 28)[0]
    step = bpp // 8
    stride = (width * step + 3) // 4 * 4
    pixels: list[list[tuple[int, int, int, int]]] = []
    for y in range(height):
        row = offset + (height - 1 - y) * stride
        line = []
        for x in range(width):
            i = row + x * step
            b, g, r = data[i], data[i + 1], data[i + 2]
            a = data[i + 3] if step == 4 else 255
            line.append((r, g, b, a))
        pixels.append(line)
    return width, height, pixels


def save_bmp(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    """写 24 位未压缩 BMP —— 没有 alpha 通道，转成 PNG 后系统不会因透明像素报错。"""
    height = len(pixels)
    width = len(pixels[0])
    stride = (width * 3 + 3) // 4 * 4
    body = bytearray()
    for y in range(height - 1, -1, -1):
        row = bytearray()
        for r, g, b, _ in pixels[y]:
            row += bytes((b, g, r))
        row += b"\x00" * (stride - len(row))
        body += row
    header = b"BM" + struct.pack("<IHHI", 14 + 40 + len(body), 0, 0, 14 + 40)
    info = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, len(body), 2835, 2835, 0, 0)
    path.write_bytes(header + info + bytes(body))


def fill_transparency(pixels: list[list[tuple[int, int, int, int]]]) -> int:
    """把透明像素用最近的已填充邻居颜色补齐，返回修补的像素数。

    迭代扩散而不是一次性取平均：品牌图的底色是渐变，逐圈继承边缘色
    才能让补出来的外圈和内部几乎无缝，而不是糊成一块纯色。
    """
    height = len(pixels)
    width = len(pixels[0])
    pending = {
        (x, y)
        for y in range(height)
        for x in range(width)
        if pixels[y][x][3] < 250
    }
    fixed = 0
    while pending:
        next_round: set[tuple[int, int]] = set()
        updates: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for x, y in pending:
            acc = [0, 0, 0]
            n = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in pending:
                    r, g, b, _ = pixels[ny][nx]
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
                    n += 1
            if n:
                updates.append((x, y, (acc[0] // n, acc[1] // n, acc[2] // n, 255)))
            else:
                next_round.add((x, y))
        if not updates:
            break
        for x, y, colour in updates:
            pixels[y][x] = colour
            fixed += 1
        pending = next_round
    return fixed


def emit_transparent(path: Path, size: int) -> None:
    """写一张全透明的正方形 PNG（自适应图标的前景层）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * size for _ in range(size))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def crop_to_content(
    pixels: list[list[tuple[int, int, int, int]]], threshold: int = 32
) -> list[list[tuple[int, int, int, int]]]:
    """裁到不透明内容的外接框，再居中补成正方形。

    设计稿四周留了大块透明边距，而图形自身在右下带着一圈立体暗边。直接对外圈做扩散
    填充，那道暗边会被一层层推出去，糊成一大块脏影（实测右下四分之一都变暗）。
    裁到内容再补方，图形自然满幅，需要填的只剩圆角那几个像素。
    """
    height = len(pixels)
    width = len(pixels[0])
    solid = [(x, y) for y in range(height) for x in range(width) if pixels[y][x][3] >= threshold]
    if not solid:
        return pixels
    x0 = min(p[0] for p in solid)
    x1 = max(p[0] for p in solid)
    y0 = min(p[1] for p in solid)
    y1 = max(p[1] for p in solid)
    box_w, box_h = x1 - x0 + 1, y1 - y0 + 1
    side = max(box_w, box_h)
    out = [[(0, 0, 0, 0) for _ in range(side)] for _ in range(side)]
    ox, oy = (side - box_w) // 2, (side - box_h) // 2
    for y in range(box_h):
        out[oy + y][ox : ox + box_w] = pixels[y0 + y][x0 : x1 + 1]
    return out


def emit(master: Path, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    run("sips", "-z", str(size), str(size), "-s", "format", "png", str(master), "--out", str(path))

def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        print(f"源图不存在：{source}")
        return 1

    WORK.mkdir(parents=True, exist_ok=True)
    raw = WORK / "source.bmp"
    run("sips", "-s", "format", "bmp", str(source), "--out", str(raw))

    width, height, pixels = load_bmp(raw)
    if width != height:
        print(f"源图不是正方形（{width}x{height}），图标会被拉伸")
    pixels = crop_to_content(pixels)
    patched = fill_transparency(pixels)
    master = WORK / "master.bmp"
    save_bmp(master, pixels)
    print(f"源图 {source.relative_to(REPO_ROOT)}  {width}x{height}，补齐透明像素 {patched}")

    emit(master, IOS_ICON, 1024)
    print(f"  iOS      1024  → {IOS_ICON.relative_to(REPO_ROOT)}")

    for bucket, size in LEGACY_SIZES.items():
        folder = ANDROID_RES / f"mipmap-{bucket}"
        emit(master, folder / "ic_launcher.png", size)
        emit(master, folder / "ic_launcher_round.png", size)
    print("  Android  传统位图 → mipmap-*/ic_launcher{,_round}.png")

    # 自适应图标是「背景+前景」两层。品牌图本身就是满幅方形，所以整张图放进背景层，
    # 前景层留全透明；否则旧的前景图形会盖在这张图上，正是之前那个上游图标。
    for bucket, size in ADAPTIVE_SIZES.items():
        folder = ANDROID_RES / f"mipmap-{bucket}"
        emit(master, folder / "ic_launcher_background.png", size)
        emit_transparent(folder / "ic_launcher_foreground.png", size)
    print("  Android  自适应 → mipmap-*/ic_launcher_{background,foreground}.png")

    for path, size in SITE_ICONS.items():
        emit(master, path, size)
    print(f"  官网     favicon 512 / apple-touch-icon 180")
    return 0


if __name__ == "__main__":
    sys.exit(main())
