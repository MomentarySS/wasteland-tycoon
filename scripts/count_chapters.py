import os
import sys

files = [
    r"D:\AI\work\wasteland-tycoon\wasteland-tycoon_2D_new\世界观\修复版\小说分支-雨\短篇_正文_第1章_洗杯.md",
    r"D:\AI\work\wasteland-tycoon\wasteland-tycoon_2D_new\世界观\修复版\小说分支-雨\短篇_正文_第2章_跪.md",
    r"D:\AI\work\wasteland-tycoon\wasteland-tycoon_2D_new\世界观\修复版\小说分支-雨\短篇_正文_第3章_开路.md",
    r"D:\AI\work\wasteland-tycoon\wasteland-tycoon_2D_new\世界观\修复版\小说分支-雨\短篇_正文_第4章_三股.md",
]

total_zh = 0
for f in files:
    with open(f, "r", encoding="utf-8") as fh:
        text = fh.read()
    zh = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    total_zh += zh
    name = os.path.basename(f)
    print(f"{name}: 中文字 {zh}")
print(f"\n四章总中文字数: {total_zh}")