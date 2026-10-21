#!/usr/bin/env python3
"""Preflight: can this machine run a local TTS clone at all?

Usage:
  python preflight.py --model-dir /path/to/model [--corpus corpus/]
"""
import argparse
import shutil
import sys
from pathlib import Path


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir")
    ap.add_argument("--corpus", default="corpus")
    args = ap.parse_args()

    # memory (macOS sysctl, Linux /proc)
    ram = None
    try:
        import subprocess
        out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True)
        ram = int(out.stdout.strip()) / 1024 ** 3
    except Exception:
        try:
            with open("/proc/meminfo") as f:
                ram = int(f.readline().split()[1]) / 1024 ** 2
        except Exception:
            pass
    if ram:
        verdict = "OK" if ram >= 6 else "TIGHT"
        print(f"RAM        {ram:.1f} GB  [{verdict}]  (0.6B model needs ~3.5GB free)")
    else:
        print("RAM        unknown")

    free = shutil.disk_usage(Path.cwd()).free
    print(f"Disk free  {human(free)}  {'[OK]' if free > 6 * 1024**3 else '[LOW] need ~4GB'}")

    try:
        import torch
        print(f"torch      {torch.__version__}  cuda={torch.cuda.is_available()}  mps={torch.backends.mps.is_available()}")
        if torch.backends.mps.is_available():
            print("           note: MPS can report True then abort on first op in sandboxed sessions; verify with a real tensor op")
    except Exception as e:
        print(f"torch      MISSING ({e}) — see references/setup.md")

    # find_spec 只查是否安装，不触发导入（导入 qwen_tts 会打印 flash-attn 警告）
    import importlib.util
    for mod in ("qwen_tts", "soundfile", "resemblyzer", "sklearn", "numpy"):
        print(f"{mod:14} {'ok' if importlib.util.find_spec(mod) else 'MISSING'}")

    print(f"sox binary {'ok' if shutil.which('sox') else 'MISSING — brew install sox'}")

    if args.model_dir:
        d = Path(args.model_dir)
        if not d.exists():
            print(f"model      MISSING at {d}")
        else:
            total = sum(f.stat().st_size for f in d.rglob("*.safetensors"))
            print(f"model      {human(total)} in {d}")
            if total < 100 * 1024 ** 2:
                print("           [WARN] suspiciously small — download may be incomplete")

    c = Path(args.corpus)
    c.mkdir(parents=True, exist_ok=True)
    print(f"corpus dir {c.resolve()} writable")


if __name__ == "__main__":
    main()
