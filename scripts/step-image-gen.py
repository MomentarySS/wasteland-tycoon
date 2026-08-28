#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
废土大亨 · StepFun Step Plan 批量生图脚本

用法（在项目根目录执行）:
  pip install -r scripts/requirements-step-image.txt
  python scripts/step-image-gen.py --test          # 试生成 1 张
  python scripts/step-image-gen.py --lite          # 精简版 ~22 张
  python scripts/step-image-gen.py                 # 完整版 86 张
  python scripts/step-image-gen.py --id A-01       # 只生成指定 id
  python scripts/step-image-gen.py --fix           # 补跑 11 张（fix manifest）
  python scripts/step-image-gen.py --fix --force     # 覆盖已有文件
  python scripts/step-image-gen.py --icon          # App Icon 试稿 3 张（防毒面具+瓶盖）
  python scripts/export-icon.py --pick 1 --apply   # 选定概念稿并导出 192/512

API Key 三选一:
  1. 项目根目录 .step-api-key 文件（推荐，一行粘贴 Key）
  2. 环境变量 STEP_API_KEY
  3. 命令行 --key YOUR_KEY
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
from pathlib import Path

try:
    import httpx
    from openai import OpenAI
except ImportError:
    print("缺少依赖，请先运行: pip install -r scripts/requirements-step-image.txt")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("缺少 Pillow，请先运行: pip install -r scripts/requirements-step-image.txt")
    sys.exit(1)


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = Path(__file__).resolve().parent / "step-image-jobs.json"
FIX_MANIFEST = Path(__file__).resolve().parent / "step-image-fix-jobs.json"
TILES_V3_MANIFEST = Path(__file__).resolve().parent / "step-image-tiles-v3-jobs.json"
EVENTS_V2_MANIFEST = Path(__file__).resolve().parent / "step-image-events-v2-jobs.json"
ICON_MANIFEST = Path(__file__).resolve().parent / "step-image-icon-jobs.json"
KEY_FILE = ROOT / ".step-api-key"
BASE_URL = "https://api.stepfun.com/step_plan/v1"
MODEL = "step-image-edit-2"
PROMPT_LIMIT = 512


def load_manifest() -> dict:
    with MANIFEST.open(encoding="utf-8") as f:
        return json.load(f)


def load_api_key(cli_key: str | None) -> str:
    if cli_key:
        return cli_key.strip()
    if KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
        if key:
            return key
    import os

    env = os.environ.get("STEP_API_KEY", "").strip()
    if env:
        return env
    print(
        "未找到 API Key。请任选一种方式:\n"
        f"  1. 在项目根目录创建 {KEY_FILE.name}，写入 Step Plan Key\n"
        "  2. 设置环境变量 STEP_API_KEY\n"
        "  3. 使用 --key 参数"
    )
    sys.exit(1)


def pick_stepfun_size(width: int, height: int) -> str:
    """StepFun size 格式为 高x宽。"""
    ratio = width / height
    if abs(ratio - 1.0) < 0.15:
        return "1024x1024"
    if ratio >= 1.2:
        return "768x1360"
    return "896x1184"


def fit_image(img: Image.Image, width: int, height: int) -> Image.Image:
    target_ratio = width / height
    src_w, src_h = img.size
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.02:
        return img.resize((width, height), Image.Resampling.LANCZOS)

    if src_ratio > target_ratio:
        new_w = int(src_h * target_ratio)
        left = (src_w - new_w) // 2
        img = img.crop((left, 0, left + new_w, src_h))
    else:
        new_h = int(src_w / target_ratio)
        top = (src_h - new_h) // 2
        img = img.crop((0, top, src_w, top + new_h))

    return img.resize((width, height), Image.Resampling.LANCZOS)


def make_client(api_key: str) -> OpenAI:
    """trust_env=False：不走系统代理，避免 Clash 把国内 API 绕到海外节点。"""
    http_client = httpx.Client(
        trust_env=False,
        timeout=httpx.Timeout(120.0, connect=30.0),
    )
    return OpenAI(api_key=api_key, base_url=BASE_URL, http_client=http_client)


def download_url(url: str) -> bytes:
    with httpx.Client(trust_env=False, timeout=120.0) as client:
        resp = client.get(url, headers={"User-Agent": "wasteland-tycoon-step-image-gen/1.0"})
        resp.raise_for_status()
        return resp.content


def generate_one(client: OpenAI, prompt: str, width: int, height: int, seed: int) -> Image.Image:
    size = pick_stepfun_size(width, height)
    if len(prompt) > PROMPT_LIMIT:
        prompt = prompt[: PROMPT_LIMIT - 1]

    result = client.images.generate(
        model=MODEL,
        prompt=prompt,
        size=size,
        response_format="b64_json",
        extra_body={"steps": 8, "cfg_scale": 1.0, "seed": seed, "text_mode": False},
    )

    item = result.data[0]
    finish = getattr(item, "finish_reason", None) or "success"
    if finish == "content_filtered":
        raise RuntimeError("内容审核未通过，请修改 prompt 后重试")

    if getattr(item, "b64_json", None):
        raw = base64.b64decode(item.b64_json)
    elif getattr(item, "url", None):
        raw = download_url(item.url)
    else:
        raise RuntimeError("API 未返回图片数据")

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return fit_image(img, width, height)


def save_webp(img: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="WEBP", quality=88, method=6)


def prefix_for_job(manifest: dict, job: dict) -> str:
    style = job.get("style")
    if style == "zone":
        return manifest.get("stylePrefixZone") or manifest.get("stylePrefix", "")
    if style == "bg":
        return manifest.get("stylePrefixBg") or manifest.get("stylePrefix", "")
    if style == "tile":
        return manifest.get("stylePrefixTile") or manifest.get("stylePrefix", "")
    if style == "event":
        return manifest.get("stylePrefixEvent") or manifest.get("stylePrefix", "")
    if style == "icon":
        return manifest.get("stylePrefixIcon") or manifest.get("stylePrefix", "")
    return manifest.get("stylePrefix", "")


def select_jobs(manifest: dict, args: argparse.Namespace) -> list[dict]:
    jobs = manifest["jobs"]

    if args.id:
        wanted = {x.strip() for x in args.id.split(",") if x.strip()}
        jobs = [j for j in jobs if j["id"] in wanted]
    elif getattr(args, "fix", False):
        fix_ids = set(manifest.get("fixIds", []))
        jobs = [j for j in jobs if j["id"] in fix_ids]
    elif getattr(args, "tiles", False):
        tile_ids = set(manifest.get("tileIds", []))
        jobs = [j for j in jobs if j["id"] in tile_ids]
    elif getattr(args, "events", False):
        event_ids = set(manifest.get("eventIds", []))
        jobs = [j for j in jobs if j["id"] in event_ids]
    elif getattr(args, "icon", False):
        icon_ids = set(manifest.get("iconIds", []))
        jobs = [j for j in jobs if j["id"] in icon_ids]
    elif args.lite:
        lite = set(manifest.get("liteIds", []))
        jobs = [j for j in jobs if j["id"] in lite]
    elif args.test:
        jobs = [j for j in jobs if j["id"] in ("A-01", "F-01")] or jobs[:1]

    for job in jobs:
        prefix = prefix_for_job(manifest, job)
        job["full_prompt"] = f"{prefix}，{job['prompt']}" if prefix else job["prompt"]

    return jobs


def main() -> None:
    parser = argparse.ArgumentParser(description="StepFun Step Plan 批量生图")
    parser.add_argument("--test", action="store_true", help="试生成 1 张（A-01 或 F-01）")
    parser.add_argument("--fix", action="store_true", help="补跑 fix manifest（11 张）")
    parser.add_argument("--tiles", action="store_true", help="重生成 44 格地点场景横条（tiles-v3 manifest）")
    parser.add_argument("--events", action="store_true", help="重生成 50 张事件纯场景插画（events-v2 manifest）")
    parser.add_argument("--icon", action="store_true", help="App Icon 试稿 3 张（防毒面具+瓶盖）")
    parser.add_argument("--lite", action="store_true", help="精简版任务集")
    parser.add_argument("--id", help="只生成指定 id，逗号分隔，如 A-01,C-E17")
    parser.add_argument("--list", action="store_true", help="列出将生成的任务")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的文件")
    parser.add_argument("--key", help="Step Plan API Key")
    parser.add_argument("--delay", type=float, default=1.5, help="每张图之间的间隔秒数")
    parser.add_argument("--seed", type=int, default=42, help="随机种子（同 seed 风格更接近）")
    args = parser.parse_args()

    manifest_path = (
        FIX_MANIFEST if args.fix
        else TILES_V3_MANIFEST if getattr(args, "tiles_v3", False) or getattr(args, "tiles", False)
        else EVENTS_V2_MANIFEST if args.events
        else ICON_MANIFEST if args.icon
        else MANIFEST
    )
    with manifest_path.open(encoding="utf-8") as f:
        manifest = json.load(f)
    jobs = select_jobs(manifest, args)
    if not jobs:
        print("没有匹配的任务。")
        sys.exit(1)

    print(f"共 {len(jobs)} 个任务")
    for job in jobs:
        dest = ROOT / job["path"]
        status = "已有" if dest.exists() else "待生成"
        print(f"  [{status}] {job['id']} -> {job['path']} ({job['w']}x{job['h']})")

    if args.list:
        return

    api_key = load_api_key(args.key)
    client = make_client(api_key)
    print("网络: 已强制直连 api.stepfun.com（绕过系统代理/Clash 环境变量）")

    ok, skip, fail = 0, 0, 0
    for i, job in enumerate(jobs, 1):
        dest = ROOT / job["path"]
        if dest.exists() and not args.force:
            print(f"[{i}/{len(jobs)}] 跳过（已存在）: {job['id']}")
            skip += 1
            continue

        print(f"[{i}/{len(jobs)}] 生成中: {job['id']} ...")
        try:
            seed = job.get("seed", args.seed)
            img = generate_one(client, job["full_prompt"], job["w"], job["h"], seed)
            save_webp(img, dest)
            print(f"         完成 -> {dest.relative_to(ROOT)}")
            ok += 1
        except Exception as exc:  # noqa: BLE001 — 批量任务需逐条捕获并继续
            msg = str(exc).strip() or exc.__class__.__name__
            print(f"         失败: {msg}")
            if "connection" in msg.lower() or "connect" in msg.lower():
                print(
                    "         提示: 若开着 Clash，请把 api.stepfun.com 设为 DIRECT，"
                    "或暂时关闭「系统代理/TUN 模式」后再试"
                )
            fail += 1

        if i < len(jobs):
            time.sleep(args.delay)

    print(f"\n完成: 成功 {ok}，跳过 {skip}，失败 {fail}")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
