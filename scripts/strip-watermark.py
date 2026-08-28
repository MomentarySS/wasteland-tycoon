#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WorkBuddy / 混元 右下角水印批量去除。

原理：OpenCV inpaint (TELEA) — 在右下角固定区域 + 自动检测白色低饱和文字，合并 mask 后填充。

用法（项目根目录）:
  python scripts/strip-watermark.py generated-images/*.png
  python scripts/strip-watermark.py generated-images --out generated-images/clean
  python scripts/strip-watermark.py assets --inplace
  python scripts/strip-watermark.py generated-images --deploy-wb

依赖: pip install opencv-python-headless numpy pillow
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# WorkBuddy 水印区域（右下 ~22% 宽 × ~12% 高，略外扩）
CORNER_X0 = 0.68
CORNER_Y0 = 0.86
INPAINT_RADIUS = 6

# WB 原图 → assets（按文件名时间戳后缀匹配，避免 preview 干扰）
WB_DEPLOY_SUFFIX = [
    ("08-13-24", "assets/ui/zone-tech.webp", 512, 512),
    ("08-18-03", "assets/ui/zone-bio.webp", 512, 512),
    ("08-21-40", "assets/tiles/tile-43-event.webp", 512, 256),
]


def cv_imread(path: str | Path) -> np.ndarray | None:
    data = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def cv_imwrite(path: str | Path, img: np.ndarray, ext: str | None = None) -> None:
    path = Path(path)
    ext = ext or path.suffix.lower()
    if ext == ".webp":
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        ok, buf = cv2.imencode(".webp", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_WEBP_QUALITY, 90])
    else:
        ok, buf = cv2.imencode(ext if ext.startswith(".") else f".{ext}", img)
    if not ok:
        raise RuntimeError(f"encode failed: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    buf.tofile(str(path))


def workbuddy_mask(img: np.ndarray) -> np.ndarray:
    """右下角 WorkBuddy「AI生成 WORKBUDDY」水印 mask。"""
    h, w = img.shape[:2]
    y0, x0 = int(h * CORNER_Y0), int(w * CORNER_X0)
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y0:h, x0:w] = 255

    roi = img[y0:h, x0:w]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    # 白色文字：高亮度 + 低饱和度（避开青色电路/紫色气泡）
    auto = cv2.inRange(hsv, (0, 0, 155), (180, 75, 255))
    auto = cv2.morphologyEx(auto, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    auto = cv2.dilate(auto, np.ones((5, 5), np.uint8), iterations=2)
    mask[y0:h, x0:w] = np.maximum(mask[y0:h, x0:w], auto)
    return mask


def strip_one(path: Path, dry_run: bool = False) -> tuple[bool, str]:
    img = cv_imread(path)
    if img is None:
        return False, "read_failed"
    mask = workbuddy_mask(img)
    out = cv2.inpaint(img, mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
    if dry_run:
        px = int(mask.sum() // 255)
        return True, f"mask_pixels={px}"
    cv_imwrite(path, out)
    return True, f"inpaint ok, mask_pixels={int(mask.sum() // 255)}"


def strip_to_file(src: Path, dest: Path, dry_run: bool = False) -> tuple[bool, str]:
    img = cv_imread(src)
    if img is None:
        return False, "read_failed"
    mask = workbuddy_mask(img)
    out = cv2.inpaint(img, mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
    if dry_run:
        return True, f"-> {dest.name} (dry-run)"
    dest.parent.mkdir(parents=True, exist_ok=True)
    cv_imwrite(dest, out)
    return True, f"-> {dest}"


def save_webp_resized(img_bgr: np.ndarray, dest: Path, tw: int, th: int) -> None:
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb).resize((tw, th), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    pil.save(dest, format="WEBP", quality=88, method=6)


def match_deploy(name: str) -> tuple[str, int, int] | None:
    for suffix, rel, w, h in WB_DEPLOY_SUFFIX:
        if suffix in name:
            return rel, w, h
    return None


def is_wb_source(name: str) -> bool:
    if name.startswith("_") or name.startswith("preview"):
        return False
    return any(s in name for s, _, _, _ in WB_DEPLOY_SUFFIX) or "平铺" in name or "棋盘格" in name


def deploy_wb(clean_dir: Path, dry_run: bool = False) -> None:
    files = sorted(clean_dir.glob("*.png")) + sorted(clean_dir.glob("*.webp"))
    deployed: set[str] = set()
    for f in files:
        if f.name.startswith("_") or f.name.startswith("preview"):
            continue
        hit = match_deploy(f.name)
        if not hit:
            continue
        rel, tw, th = hit
        if rel in deployed:
            continue
        dest = ROOT / rel
        img = cv_imread(f)
        if img is None:
            print(f"  ERR 读取失败: {f.name}")
            continue
        mask = workbuddy_mask(img)
        out = cv2.inpaint(img, mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
        if dry_run:
            print(f"  DRY {f.name} -> {rel} ({tw}x{th})")
            deployed.add(rel)
            continue
        backup = dest.with_suffix(dest.suffix + ".orig.webp")
        if dest.exists() and not backup.exists():
            shutil.copy2(dest, backup)
        save_webp_resized(out, dest, tw, th)
        print(f"  OK  {f.name} -> {rel}")
        deployed.add(rel)
    missing = {r for _, r, _, _ in WB_DEPLOY_SUFFIX} - deployed
    for rel in sorted(missing):
        print(f"  未部署: {rel}")


def collect_inputs(patterns: list[str]) -> list[Path]:
    out: list[Path] = []
    for pat in patterns:
        p = Path(pat)
        if p.is_dir():
            out.extend(sorted(p.glob("*.png")))
            out.extend(sorted(p.glob("*.webp")))
        else:
            out.extend(Path(x) for x in glob.glob(pat))
    seen: set[str] = set()
    files: list[Path] = []
    for f in out:
        s = str(f.resolve())
        if s in seen:
            continue
        if f.name.startswith("_") or ".orig." in f.name:
            continue
        seen.add(s)
        files.append(f)
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description="去除 WorkBuddy/混元 右下角水印")
    ap.add_argument("inputs", nargs="*", help="文件或目录，如 generated-images/")
    ap.add_argument("--out", help="输出目录（默认覆盖原文件需 --inplace）")
    ap.add_argument("--inplace", action="store_true", help="直接覆盖输入文件（会先 .orig 备份 webp）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--deploy-wb", action="store_true", help="处理 generated-images 并部署 F-04/F-05/F-11 到 assets/")
    ap.add_argument("--only-assets", action="store_true", help="只处理 assets/{ui,events,tiles}/*.webp")
    args = ap.parse_args()

    if args.deploy_wb:
        src = ROOT / "generated-images"
        out_dir = ROOT / "generated-images" / "clean"
        out_dir.mkdir(exist_ok=True)
        files = [f for f in collect_inputs([str(src)]) if is_wb_source(f.name)]
        if not files:
            print("generated-images/ 无 WB 原图（需含 08-13-24 / 08-18-03 / 08-21-40）")
            sys.exit(1)
        for f in files:
            dest = out_dir / f.name
            ok, info = strip_to_file(f, dest, dry_run=args.dry_run)
            print(f"  {'OK' if ok else 'ERR'} {f.name}  {info}")
        if not args.dry_run:
            deploy_wb(out_dir)
        return

    if args.only_assets:
        files = []
        for sub in ("ui", "events", "tiles"):
            files.extend(sorted((ROOT / "assets" / sub).glob("*.webp")))
    elif args.inputs:
        files = collect_inputs(args.inputs)
    else:
        ap.print_help()
        sys.exit(1)

    if not files:
        print("没有匹配的文件")
        sys.exit(1)

    ok_n = fail_n = 0
    for f in files:
        try:
            if args.out:
                dest = Path(args.out) / f.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                ok, info = strip_to_file(f, dest, dry_run=args.dry_run)
            elif args.inplace:
                if f.suffix.lower() == ".webp":
                    bak = f.with_suffix(f.suffix + ".orig.webp")
                    if not bak.exists() and not args.dry_run:
                        shutil.copy2(f, bak)
                ok, info = strip_one(f, dry_run=args.dry_run)
            else:
                print("请指定 --out、--inplace 或 --deploy-wb")
                sys.exit(1)
            print(f"  {'OK' if ok else 'ERR'} {f.name}  {info}")
            ok_n += 1 if ok else 0
            fail_n += 0 if ok else 1
        except Exception as exc:  # noqa: BLE001
            print(f"  ERR {f.name}  {exc}")
            fail_n += 1

    print(f"\n完成: {ok_n} 成功 / {fail_n} 失败")


if __name__ == "__main__":
    main()
