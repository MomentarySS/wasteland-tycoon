#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
废土大亨 · MiniMax Token Plan 批量生图脚本

用法（在项目根目录执行）:
  pip install -r scripts/requirements-step-image.txt
  python scripts/minimax-image-gen.py --test          # 试生成 1 张
  python scripts/minimax-image-gen.py --lite          # 精简版 ~22 张
  python scripts/minimax-image-gen.py                 # 完整版
  python scripts/minimax-image-gen.py --events --force  # 50 张事件
  python scripts/minimax-image-gen.py --tiles --force   # 44 格棋盘
  python scripts/minimax-image-gen.py --id A-01 --force # 指定单张

API Key 三选一:
  1. 项目根目录 .minimax-api-key（推荐，Token Plan Subscription Key）
  2. 环境变量 MINIMAX_API_KEY
  3. 命令行 --key YOUR_KEY

可选: 环境变量 MINIMAX_API_BASE（默认 https://api.minimaxi.com，海外用 https://api.minimax.io）
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

try:
    import httpx
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
KEY_FILE = ROOT / ".minimax-api-key"
API_BASE = os.environ.get("MINIMAX_API_BASE", "https://api.minimaxi.com").rstrip("/")
API_URL = f"{API_BASE}/v1/image_generation"
MODEL = "image-01"
PROMPT_LIMIT = 1500

STATUS_MESSAGES = {
    1002: "触发限速，请稍后重试",
    1004: "认证失败，请检查 Subscription Key",
    1008: "账户余额/配额不足",
    1026: "Prompt 含敏感内容",
    1033: "服务端临时错误",
    2013: "参数无效",
    2049: "API Key 无效",
}

RETRYABLE_MARKERS = (
    "1002",
    "1033",
    "rate limit",
    "system error",
    "timed out",
    "timeout",
    "connection",
    "connect",
    "503",
    "429",
)


def load_api_key(cli_key: str | None) -> str:
    if cli_key:
        return cli_key.strip()
    if KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
        if key:
            return key
    env = os.environ.get("MINIMAX_API_KEY", "").strip()
    if env:
        return env
    print(
        "未找到 API Key。请任选一种方式:\n"
        f"  1. 在项目根目录创建 {KEY_FILE.name}，写入 Token Plan Subscription Key\n"
        "  2. 设置环境变量 MINIMAX_API_KEY\n"
        "  3. 使用 --key 参数"
    )
    sys.exit(1)


def align_dim(value: int) -> int:
    value = max(512, min(2048, value))
    return value // 8 * 8


def pick_minimax_size(width: int, height: int) -> dict:
    """选择 MiniMax 请求尺寸。返回 payload 片段（aspect_ratio 或 width/height）。"""
    target_ratio = width / height

    standard = {
        "16:9": (16 / 9, 1280, 720),
        "1:1": (1.0, 1024, 1024),
        "21:9": (21 / 9, 1344, 576),
        "4:3": (4 / 3, 1152, 864),
        "3:2": (3 / 2, 1248, 832),
        "9:16": (9 / 16, 720, 1280),
    }

    for aspect_ratio, (ratio, gen_w, gen_h) in standard.items():
        if width == gen_w and height == gen_h:
            return {"aspect_ratio": aspect_ratio}
        if abs(target_ratio - ratio) < 0.02 and width <= gen_w and height <= gen_h:
            if width == gen_w and height == gen_h:
                return {"aspect_ratio": aspect_ratio}

    scale = max(512 / width, 512 / height, 1.0)
    gen_w = align_dim(int(width * scale))
    gen_h = align_dim(int(height * scale))

    for aspect_ratio, (ratio, _, _) in standard.items():
        if abs(gen_w / gen_h - ratio) < 0.03:
            return {"aspect_ratio": aspect_ratio}

    return {"width": gen_w, "height": gen_h}


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


def make_client() -> httpx.Client:
    return httpx.Client(
        trust_env=False,
        timeout=httpx.Timeout(180.0, connect=30.0),
    )


def parse_response_body(body: dict) -> bytes:
    base_resp = body.get("base_resp") or {}
    status_code = base_resp.get("status_code", 0)
    if status_code != 0:
        msg = STATUS_MESSAGES.get(status_code, base_resp.get("status_msg", "未知错误"))
        raise RuntimeError(f"API 错误 {status_code}: {msg}")

    data = body.get("data") or {}
    if data.get("image_base64"):
        return base64.b64decode(data["image_base64"][0])
    if data.get("image_urls"):
        url = data["image_urls"][0]
        with httpx.Client(trust_env=False, timeout=120.0) as client:
            resp = client.get(url, headers={"User-Agent": "wasteland-tycoon-minimax-image-gen/1.0"})
            resp.raise_for_status()
            return resp.content

    failed = (body.get("metadata") or {}).get("failed_count", 0)
    if failed:
        raise RuntimeError("内容审核未通过，请修改 prompt 后重试")
    raise RuntimeError("API 未返回图片数据")


def generate_one(
    client: httpx.Client,
    api_key: str,
    prompt: str,
    width: int,
    height: int,
    seed: int | None,
) -> Image.Image:
    if len(prompt) > PROMPT_LIMIT:
        prompt = prompt[: PROMPT_LIMIT - 1]

    payload: dict = {
        "model": MODEL,
        "prompt": prompt,
        "response_format": "base64",
        "n": 1,
        "prompt_optimizer": False,
    }
    payload.update(pick_minimax_size(width, height))
    if seed is not None:
        payload["seed"] = seed

    resp = client.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    resp.raise_for_status()
    raw = parse_response_body(resp.json())
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


def resolve_dest(job_path: str, out_dir: str | None) -> Path:
    rel = Path(job_path)
    if out_dir:
        return ROOT / out_dir / rel
    return ROOT / rel


def main() -> None:
    parser = argparse.ArgumentParser(description="MiniMax Token Plan 批量生图")
    parser.add_argument("--test", action="store_true", help="试生成 1 张（A-01 或 F-01）")
    parser.add_argument("--fix", action="store_true", help="补跑 fix manifest")
    parser.add_argument("--tiles", action="store_true", help="重生成 44 格地点场景")
    parser.add_argument("--events", action="store_true", help="重生成 50 张事件插画")
    parser.add_argument("--icon", action="store_true", help="App Icon 试稿 3 张")
    parser.add_argument("--lite", action="store_true", help="精简版任务集")
    parser.add_argument("--id", help="只生成指定 id，逗号分隔")
    parser.add_argument("--list", action="store_true", help="列出将生成的任务")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的文件")
    parser.add_argument(
        "--out-dir",
        help="输出到独立目录（保留 assets/ 子路径，不覆盖正式 assets/），如 generated/minimax-lite",
    )
    parser.add_argument("--key", help="MiniMax Subscription Key")
    parser.add_argument("--delay", type=float, default=6.5, help="每张图间隔秒数（默认 6.5，适配 10 RPM）")
    parser.add_argument("--retries", type=int, default=3, help="单张失败后的重试次数")
    parser.add_argument("--seed", type=int, default=None, help="随机种子（可选）")
    args = parser.parse_args()

    manifest_path = (
        FIX_MANIFEST if args.fix
        else TILES_V3_MANIFEST if args.tiles
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

    print(f"清单: {manifest_path.name}")
    if args.out_dir:
        print(f"输出目录: {args.out_dir}/（不写入正式 assets/）")
    print(f"共 {len(jobs)} 个任务")
    for job in jobs:
        dest = resolve_dest(job["path"], args.out_dir)
        status = "已有" if dest.exists() else "待生成"
        rel = dest.relative_to(ROOT)
        print(f"  [{status}] {job['id']} -> {rel} ({job['w']}x{job['h']})")

    if args.list:
        return

    api_key = load_api_key(args.key)
    print(f"API: {API_URL}")
    print("网络: 已强制直连（绕过系统代理/Clash 环境变量）")

    ok, skip, fail = 0, 0, 0
    with make_client() as client:
        for i, job in enumerate(jobs, 1):
            dest = resolve_dest(job["path"], args.out_dir)
            if dest.exists() and not args.force:
                print(f"[{i}/{len(jobs)}] 跳过（已存在）: {job['id']}")
                skip += 1
                continue

            print(f"[{i}/{len(jobs)}] 生成中: {job['id']} ...", flush=True)
            last_err = ""
            succeeded = False
            for attempt in range(1, max(1, args.retries) + 1):
                try:
                    seed = job.get("seed", args.seed)
                    img = generate_one(
                        client, api_key, job["full_prompt"], job["w"], job["h"], seed
                    )
                    save_webp(img, dest)
                    print(f"         完成 -> {dest.relative_to(ROOT)}", flush=True)
                    ok += 1
                    succeeded = True
                    break
                except Exception as exc:  # noqa: BLE001 — 批量任务需逐条捕获并继续
                    last_err = str(exc).strip() or exc.__class__.__name__
                    retryable = any(m in last_err.lower() for m in RETRYABLE_MARKERS)
                    if retryable and attempt < max(1, args.retries):
                        wait = args.delay * attempt
                        print(
                            f"         重试 {attempt}/{args.retries}: {last_err}，{wait:.0f}s 后继续",
                            flush=True,
                        )
                        time.sleep(wait)
                        continue
                    print(f"         失败: {last_err}", flush=True)
                    if "connection" in last_err.lower() or "connect" in last_err.lower():
                        print(
                            "         提示: 若 API 连不上，可尝试设置环境变量 "
                            "MINIMAX_API_BASE=https://api.minimax.io",
                            flush=True,
                        )
                    fail += 1
                    break
            if not succeeded and last_err and fail == 0:
                fail += 1

            if i < len(jobs):
                time.sleep(args.delay)

    print(f"\n完成: 成功 {ok}，跳过 {skip}，失败 {fail}")
    if ok:
        if args.out_dir:
            print(f"输出目录: {ROOT / args.out_dir}")
        else:
            print("下一步: node scripts/sync-www.mjs  （同步到 www/）")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
