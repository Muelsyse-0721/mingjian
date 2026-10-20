#!/usr/bin/env python3
"""明鉴桌宠 · 语音包构建

从 app/pet.js 抽取固定台词，用 Edge TTS 渲染成音频，产出 manifest。

用法：
  python tools/tts-build.py            # 只补缺失文件（幂等）
  python tools/tts-build.py --force    # 全部重渲
  python tools/tts-build.py --list     # 只列出会渲染哪些台词

音色参数来自对用户提供片段（clipA=Claude / clipB=大肥鱼）的实测：
  目标 F0 中位 ~327/340 Hz；Edge 候选里 Xiaoxiao +60Hz、Xiaoyi +50Hz 最接近。
"""
import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PET_JS = ROOT / "app" / "pet.js"
OUT = ROOT / "app" / "assets" / "pet" / "voice"

PROFILES = {
    "claude": {"voice": "zh-CN-XiaoxiaoNeural", "pitch": "+60Hz", "rate": "-22%"},
    "fish":   {"voice": "zh-CN-XiaoyiNeural",   "pitch": "+20Hz", "rate": "-15%"},
}

# 与视频里两句参考台词（用于 A/B 对照，始终包含）
REFERENCE = {
    "claude": "好冷啊啊啊，我怎么睡在外面啊？谁这么好心呀，在我门口放这么多token。",
    "fish": "小克，你最好了，放我下来，我再去吃几口好不好嘛？哇哦，99成稀罕物。",
}


def extract_lines():
    src = PET_JS.read_text(encoding="utf-8")
    i_claude = src.index("var CLAUDE")
    i_active = src.index("var activeChar")

    def strings(block):
        out = []
        for a, b in re.findall(r"'([^'\\\n]{2,80})'|\"([^\"\\\n]{2,80})\"", block):
            t = a or b
            if any("\u4e00" <= c <= "\u9fff" for c in t) and t not in out:
                out.append(t)
        return out

    fish = strings(src[:i_claude]) + strings(src[i_active:])
    claude = strings(src[i_claude:i_active])

    skip = ("跟随鼠标", "切换", "保存", "输入")
    fish = [t for t in fish if not any(s in t for s in skip)]
    claude = [t for t in claude if not any(s in t for s in skip)]

    if REFERENCE["fish"] not in fish:
        fish.insert(0, REFERENCE["fish"])
    if REFERENCE["claude"] not in claude:
        claude.insert(0, REFERENCE["claude"])
    return {"fish": fish, "claude": claude}


def key_of(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


async def render(char, text, path, force):
    if path.exists() and not force:
        return False
    import edge_tts

    p = PROFILES[char]
    c = edge_tts.Communicate(text, p["voice"], pitch=p["pitch"], rate=p["rate"])
    await c.save(str(path))
    return True


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    lines = extract_lines()
    if args.list:
        for ch, arr in lines.items():
            print(f"[{ch}] {len(arr)} 条")
            for t in arr[:10]:
                print("  ·", t)
        return

    manifest = {}
    total_new = 0
    for ch, arr in lines.items():
        folder = OUT / ch
        folder.mkdir(parents=True, exist_ok=True)
        files = {}
        for text in arr:
            name = key_of(text) + ".mp3"
            path = folder / name
            try:
                if await render(ch, text, path, args.force):
                    total_new += 1
            except Exception as e:
                print(f"  ! 渲染失败 {ch}/{name}: {e}", file=sys.stderr)
                continue
            files[text] = f"{ch}/{name}"
        manifest[ch] = dict(PROFILES[ch], files=files)
        print(f"[{ch}] {len(files)} 条")

    (OUT / "manifest.json").write_text(
        json.dumps({"version": 1, "profiles": manifest}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"新增渲染 {total_new} 条 → {OUT / 'manifest.json'}")


if __name__ == "__main__":
    asyncio.run(main())
