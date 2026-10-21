#!/usr/bin/env python3
"""多角色音频自动分离：静音切句 → 声纹聚类 → 按角色输出。

为什么不用转写的 speaker id：
  ASR 的 diarization 很粗，一段 28 秒里两三人的话会被并成一条，
  靠时间戳切必然串音。声纹聚类看的是「声音本身像不像」，
  在同一场景里比 ASR 靠谱得多。

用法：
  python tools/diarize_cluster.py --media /tmp/dfy.m4a --k 3 --out tools/corpus/_dfy

输出：
  <out>/utt/NNN.wav        切好的句子
  <out>/cluster.csv        每句：文件、起止、时长、F0、聚类号
  <out>/c00_*.wav ...      按聚类合并的长样本（供试听/识别角色）
"""
import argparse
import csv
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 16000


def load_wav(p):
    w = wave.open(str(p), "rb")
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    sr = w.getframerate()
    w.close()
    if w.getnchannels() > 1:
        x = x.reshape(-1, w.getnchannels()).mean(axis=1)
    return x, sr


def split_by_silence(x, sr, min_len=0.8, max_len=4.5, gap=0.25):
    fl, hop = int(0.04 * sr), int(0.02 * sr)
    rms = np.array([np.sqrt(np.mean(x[i:i + fl] ** 2)) for i in range(0, len(x) - fl, hop)])
    voiced = rms > max(0.012, 0.16 * np.median(rms[rms > 0.008]))
    segs, start = [], None
    for i, v in enumerate(voiced):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append((start, i))
            start = None
    if start is not None:
        segs.append((start, len(voiced)))

    merged = []
    for a, b in segs:
        if merged and (a - merged[-1][1]) * 0.02 <= gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))

    out = []
    for a, b in merged:
        t0, t1 = a * 0.02, b * 0.02
        if t1 - t0 < min_len:
            continue
        while t1 - t0 > max_len:
            out.append((t0, t0 + max_len))
            t0 += max_len
        out.append((t0, t1))
    return out


def f0_of(x, sr):
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
        if not len(seg):
            continue
        k = int(np.argmax(seg)) + int(sr / 400)
        if ac[k] > 0.3:
            vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", required=True)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--out", default="tools/corpus/_diar")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "utt").mkdir(parents=True, exist_ok=True)

    wav = out / "full.wav"
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", args.media, str(wav)],
                   check=True, capture_output=True)
    x, sr = load_wav(wav)
    segs = split_by_silence(x, sr)
    print(f"切出 {len(segs)} 句，总时长 {sum(b - a for a, b in segs):.1f}s")

    from resemblyzer import VoiceEncoder, preprocess_wav

    enc = VoiceEncoder()
    rows, embs = [], []
    for i, (a, b) in enumerate(segs):
        p = out / "utt" / f"{i:03d}.wav"
        subprocess.run(["sox", str(wav), str(p), "trim", f"{a:.3f}", f"{b-a:.3f}",
                        "highpass", "70", "norm", "-3"], check=True, capture_output=True)
        y, _ = load_wav(p)
        embs.append(enc.embed_utterance(preprocess_wav(p)))
        rows.append({"i": i, "start": round(a, 2), "end": round(b, 2),
                     "dur": round(b - a, 2), "f0": round(f0_of(y, sr))})

    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    X = np.array(embs)
    X = X / np.linalg.norm(X, axis=1, keepdims=True)
    km = KMeans(n_clusters=args.k, n_init=10, random_state=0).fit(X)
    labels = km.labels_
    sil = silhouette_score(X, labels, metric="cosine")
    print(f"聚类 k={args.k}，轮廓系数 {sil:.3f}")

    with open(out / "cluster.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["i", "start", "end", "dur", "f0", "cluster"])
        w.writeheader()
        for r, lab in zip(rows, labels):
            r["cluster"] = int(lab)
            w.writerow(r)

    for c in range(args.k):
        idx = [r["i"] for r, l in zip(rows, labels) if l == c]
        dur = sum(rows[i]["dur"] for i in idx)
        f0s = [rows[i]["f0"] for i in idx if rows[i]["f0"]]
        print(f"  c{c}: {len(idx)} 句 / {dur:.1f}s / F0 {int(np.median(f0s)) if f0s else 0}Hz")
        # 合并该类的所有句子，方便试听与识别身份
        if idx:
            lst = out / f"c{c}.txt"
            lst.write_text("\n".join(f"file '{out/'utt'/f'{i:03d}.wav'}'" for i in idx), encoding="utf-8")
            subprocess.run(["sox", "-f", str(lst.with_suffix(".wav")), "-t", "wav", "concat"],
                           check=False, capture_output=True)
            if out.joinpath(f"c{c}.wav").exists():
                subprocess.run(["sox", str(out / f"c{c}.wav"), str(out / f"c{c}_norm.wav"), "norm", "-3"],
                               check=False, capture_output=True)

    print(f"输出目录 {out}")


if __name__ == "__main__":
    main()
