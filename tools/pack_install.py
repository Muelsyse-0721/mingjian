#!/usr/bin/env python3
"""把克隆渲染出的 wav 包转成网页可用的 m4a 包，并写 manifest。

用法：python tools/pack_install.py
输入：tools/voice-out/{fish,claude}/NNN.wav + tools/voice-out/manifest.json
输出：app/assets/pet/voice-clone/{fish,claude}/<hash>.m4a + manifest.json
"""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "voice-out"
DST = ROOT / "app" / "assets" / "pet" / "voice-clone"


def to_m4a(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", "-c", "1", str(src), str(dst)],
        check=True, capture_output=True,
    )


def main():
    manifest_in = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    out = {"version": 1, "profiles": {}}
    total = 0
    for char, info in manifest_in.items():
        files = {}
        for text, rel in info.get("files", {}).items():
            src = SRC / rel
            if not src.exists():
                continue
            name = hashlib.md5(text.encode("utf-8")).hexdigest()[:12] + ".m4a"
            dst = DST / char / name
            to_m4a(src, dst)
            files[text] = f"{char}/{name}"
            total += 1
        out["profiles"][char] = {
            "engine": info.get("engine", "qwen3-tts-0.6b-clone"),
            "seed": info.get("seed"),
            "files": files,
        }
    (DST / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"打包完成：{total} 条 → {DST}")
    for c, p in out["profiles"].items():
        print(f"  {c}: {len(p['files'])} 条")


if __name__ == "__main__":
    main()
