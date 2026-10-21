#!/usr/bin/env python3
"""从语料拼参考音频（多情绪平均，降低单一情绪渗透）。

用法：
  python tools/build_refs.py            # 生成 tools/refs/{claude,fish}_v2.wav
  python tools/build_refs.py --list     # 只看会拼哪些段
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "tools" / "corpus"
REFS = ROOT / "tools" / "refs"

# 参考段挑选原则：吐字清楚、情绪不过度（避免气声/尖叫），总长 15~25 秒
PICKS = {
    "claude": [  # 4 段共 20.6s：恼火、嫌弃、制止、温柔 —— 覆盖多种语气
        "claude/dfy_s0_000.wav",
        "claude/dfy_s0_001.wav",
        "claude/dfy_s0_002.wav",
        "claude/dfy_s0_003.wav",
    ],
    "fish": [    # 挑中性偏稳的段落，避开气声惊喜/撑到求饶
        "fish/ep2_man_04.wav",
        "fish/dfy_fish_s0_001.wav",
        "fish/ep2_man_05.wav",
        "fish/dfy_fish_s0_005.wav",
        "fish/ep1_man_02.wav",
    ],
}


def build(char):
    parts = PICKS[char]
    tmp = REFS / f"_{char}_parts"
    tmp.mkdir(parents=True, exist_ok=True)
    wavs = []
    for i, rel in enumerate(parts):
        src = CORPUS / rel
        if not src.exists():
            print(f"  跳过（缺失）{rel}")
            continue
        dst = tmp / f"{i:02d}.wav"
        subprocess.run(
            ["sox", str(src), str(dst), "highpass", "70", "lowpass", "7500", "norm", "-3",
             "pad", "0", "0.15"],
            check=True, capture_output=True,
        )
        wavs.append(dst)
    if not wavs:
        raise SystemExit(f"{char}: 没有可用片段")
    # 用 wave 直接拼接（sox 的 concat 语法在不同版本不一致）
    import wave
    import numpy as np

    data, sr = [], None
    for w in wavs:
        wf = wave.open(str(w), "rb")
        sr = wf.getframerate()
        data.append(np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16))
        wf.close()
    y = np.concatenate(data)
    out = REFS / f"{char}_v2.wav"
    ow = wave.open(str(out), "wb")
    ow.setnchannels(1); ow.setsampwidth(2); ow.setframerate(sr)
    ow.writeframes(y.tobytes()); ow.close()
    dur = float(subprocess.run(["afinfo", str(out)], capture_output=True, text=True)
                .stdout.split("estimated duration:")[1].split("sec")[0])
    print(f"{char}_v2.wav  {dur:.1f}s  ({len(wavs)} 段拼接)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list:
        for c, v in PICKS.items():
            print(c)
            for p in v:
                print("  ", p)
        return
    REFS.mkdir(parents=True, exist_ok=True)
    for c in PICKS:
        build(c)


if __name__ == "__main__":
    main()
