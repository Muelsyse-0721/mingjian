#!/usr/bin/env python3
"""克隆音色一致性回补。

问题：同一 seed 下，模型对长句/感叹句的音高仍会漂移（实测极差 40-60Hz），
      一个角色听起来会像两三个人。

做法：逐句测 F0，偏离角色目标超过阈值就换 seed 重生成，取最接近的一版。
      只重生成离群句，不动已经合适的文件。

用法：
  python tools/consistency_pass.py                 # 用默认目标（fish 316 / claude 273）
  python tools/consistency_pass.py --tolerance 0.05
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

OUT = ROOT / "tools" / "voice-out"
TARGET = {"fish": 316.0, "claude": 273.0}   # 由参考音频实测 + seed 校准得到
EXTRA_SEEDS = [5, 6, 7, 8]


def f0_of(path):
    import wave

    w = wave.open(str(path), "rb")
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    w.close()
    fl = int(0.04 * sr)
    vals = []
    for i in range(0, len(x) - fl, int(0.02 * sr)):
        fr = x[i:i + fl]
        if np.sqrt(np.mean(fr ** 2)) < 0.02:
            continue
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[fl - 1:]
        ac /= (ac[0] + 1e-12)
        seg = ac[int(sr / 400):int(sr / 70)]
        if len(seg) == 0:
            continue
        k = int(np.argmax(seg)) + int(sr / 400)
        if ac[k] > 0.3:
            vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=float, default=0.06)
    ap.add_argument("--seed", type=int, default=4)
    args = ap.parse_args()

    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    from voice_clone import REF_TEXT, load_model, gen

    model = load_model("cpu")
    total_fixed = 0

    for char, info in manifest.items():
        target = TARGET[char]
        files = info["files"]
        ref = ROOT / "tools" / "refs" / f"{char}.wav"
        prompt = model.create_voice_clone_prompt(
            ref_audio=str(ref), ref_text=REF_TEXT[char], x_vector_only_mode=False
        )
        fixed_here = 0
        for text, rel in files.items():
            path = OUT / rel
            if not path.exists():
                continue
            cur = f0_of(path)
            if cur <= 0 or abs(cur - target) / target <= args.tolerance:
                continue
            best, best_gap = None, abs(cur - target) / target
            for s in EXTRA_SEEDS:
                tmp = path.with_suffix(".try.wav")
                gen(model, prompt, text, tmp, seed=s)
                v = f0_of(tmp)
                gap = abs(v - target) / target
                if gap < best_gap:
                    tmp.replace(path)
                    best, best_gap = (v, s), gap
                    if gap <= args.tolerance:
                        break
                else:
                    tmp.unlink(missing_ok=True)
            if best:
                fixed_here += 1
                print(f"  {char} {rel}: {cur:.0f} → {best[0]:.0f}Hz (seed {best[1]})")
        print(f"[{char}] 回补 {fixed_here} 句")
        total_fixed += fixed_here

    print(f"完成，共回补 {total_fixed} 句")


if __name__ == "__main__":
    main()
