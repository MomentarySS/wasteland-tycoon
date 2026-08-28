#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 StepFun 概念稿导出 App Icon（192 / 512 PNG），并同步到 www/

用法:
  python scripts/export-icon.py assets/brand/icon-concept-01.webp --apply
  python scripts/export-icon.py assets/brand/icon-concept-02.webp --preview
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("缺少 Pillow，请先运行: pip install -r scripts/requirements-step-image.txt")
    sys.exit(1)


ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / "www"
OUT_NAMES = ("icon-192.png", "icon-512.png")


def square_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def write_icon_svg(png_192: Path, svg_dest: Path) -> None:
    b64 = base64.b64encode(png_192.read_bytes()).decode("ascii")
    svg_dest.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192">\n'
        f'  <image width="192" height="192" xlink:href="data:image/png;base64,{b64}"/>\n'
        "</svg>\n",
        encoding="utf-8",
    )


def export_sizes(src: Path, apply: bool) -> None:
    img = Image.open(src).convert("RGBA")
    img = square_crop(img)

    targets: list[tuple[int, Path]] = []
    for name in OUT_NAMES:
        size = int(name.split("-")[1].split(".")[0])
        targets.append((size, ROOT / name))
        if apply:
            targets.append((size, WWW / name))

    for size, dest in targets:
        dest.parent.mkdir(parents=True, exist_ok=True)
        out = img.resize((size, size), Image.Resampling.LANCZOS)
        out.save(dest, format="PNG", optimize=True)
        print(f"  写入 {dest.relative_to(ROOT)} ({size}x{size})")

    if apply:
        write_icon_svg(ROOT / "icon-192.png", ROOT / "icon.svg")
        write_icon_svg(ROOT / "icon-192.png", WWW / "icon.svg")
        print("  写入 icon.svg（与 concept 同步）")
        print("\n已导出 PWA 图标。")
    else:
        print("\n预览模式：未写入项目根目录。满意后加 --apply。")


def main() -> None:
    parser = argparse.ArgumentParser(description="导出 App Icon PNG")
    parser.add_argument(
        "source",
        nargs="?",
        help="概念稿路径，如 assets/brand/icon-concept-01.webp",
    )
    parser.add_argument(
        "--pick",
        type=int,
        choices=(1, 2, 3),
        help="快捷选择 icon-concept-0N.webp",
    )
    parser.add_argument("--apply", action="store_true", help="写入 icon-192/512.png 并同步 www/")
    parser.add_argument("--preview", action="store_true", help="仅输出到 assets/brand/preview/")
    args = parser.parse_args()

    if args.pick:
        src = ROOT / "assets" / "brand" / f"icon-concept-0{args.pick}.webp"
    elif args.source:
        src = Path(args.source)
        if not src.is_absolute():
            src = ROOT / src
    else:
        parser.print_help()
        sys.exit(1)

    if not src.exists():
        print(f"找不到源图: {src}")
        sys.exit(1)

    print(f"源图: {src.relative_to(ROOT)}")
    if args.preview:
        preview_dir = ROOT / "assets" / "brand" / "preview"
        preview_dir.mkdir(parents=True, exist_ok=True)
        img = square_crop(Image.open(src).convert("RGBA"))
        for size in (192, 512):
            out = preview_dir / f"preview-{size}.png"
            img.resize((size, size), Image.Resampling.LANCZOS).save(out, format="PNG")
            print(f"  预览 {out.relative_to(ROOT)}")
        return

    export_sizes(src, apply=args.apply)


if __name__ == "__main__":
    main()
