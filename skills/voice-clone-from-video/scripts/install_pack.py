#!/usr/bin/env python3
"""Install a rendered pack for the web: wav → compressed audio + text→file manifest.

  python install_pack.py --src out/ --dst app/assets/voice/ --format m4a

Reads <src>/manifest.json (written by clone.py), transcodes each file, hashes the text into the
filename, and writes <dst>/manifest.json as:

  {"profiles": {"alice": {"files": {"要合成的句子": "alice/3f2a1b.m4a"}}}}

Keeping the previous pack on disk and letting the app search newest-first makes rollback a
directory rename rather than a rebuild.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def transcode(src: Path, dst: Path, fmt: str, bitrate: str):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "m4a":
        cmd = ["afconvert", "-f", "m4af", "-d", "aac", "-b", bitrate, "-c", "1", str(src), str(dst)]
    elif fmt == "mp3":
        cmd = ["sox", str(src), "-C", bitrate, str(dst)]
    elif fmt == "copy":
        shutil.copy2(src, dst)
        return
    else:
        raise SystemExit(f"unsupported format {fmt}")
    subprocess.run(cmd, check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--format", default="m4a", choices=["m4a", "mp3", "copy"])
    ap.add_argument("--bitrate", default="64000")
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    mf = src / "manifest.json"
    if not mf.exists():
        raise SystemExit(f"{mf} not found — run clone.py --voices/--lines first")

    data = json.loads(mf.read_text(encoding="utf-8"))
    out = {"version": 1, "profiles": {}}
    total = 0

    for voice, info in data.get("profiles", {}).items():
        files = {}
        for text, rel in info.get("files", {}).items():
            s = src / rel
            if not s.exists():
                continue
            name = hashlib.md5(text.encode("utf-8")).hexdigest()[:12] + "." + (
                "m4a" if args.format == "m4a" else "mp3" if args.format == "mp3" else s.suffix.lstrip(".")
            )
            d = dst / voice / name
            transcode(s, d, args.format, args.bitrate)
            files[text] = f"{voice}/{name}"
            total += 1
        out["profiles"][voice] = {
            "engine": info.get("engine", "zero-shot-clone"),
            "seed": info.get("seed"),
            "files": files,
        }

    (dst / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
    print(f"{total} clips → {dst}  ({size/1024/1024:.1f}MB)")
    for v, p in out["profiles"].items():
        print(f"  {v}: {len(p['files'])} lines")


if __name__ == "__main__":
    main()
