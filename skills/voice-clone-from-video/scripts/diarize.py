#!/usr/bin/env python3
"""Diagnose whether speakers can be separated automatically. Often the answer is no.

  python diarize.py --media ep1.m4a --k 3 --out work/diar

Splits by silence, embeds each utterance, clusters with k-means and reports the silhouette
score. Read it before trusting any automatic attribution:

  silhouette > 0.35   clusters are probably meaningful
  0.2 – 0.35          weak — verify every cluster by hand before using it
  < 0.2               unusable; cut by transcript timestamps and label by hand instead

Also prints the cosine between cluster centroids. Two characters that sit above ~0.85 are not
separable by embedding, no matter what k you choose.
"""
import argparse
import csv
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 16000


def load(p):
    w = wave.open(str(p), "rb")
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    sr = w.getframerate()
    ch = w.getnchannels()
    w.close()
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def split(x, sr, min_len=0.8, max_len=4.5, gap=0.25):
    fl = int(0.04 * sr)
    rms = np.array([np.sqrt(np.mean(x[i:i + fl] ** 2)) for i in range(0, len(x) - fl, int(0.02 * sr))])
    if not len(rms):
        return []
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


def f0(x, sr):
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
    ap.add_argument("--out", default="work/diar")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "utt").mkdir(parents=True, exist_ok=True)
    wav = out / "full.wav"
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", args.media, str(wav)],
                   check=True, capture_output=True)

    x, sr = load(wav)
    segs = split(x, sr)
    print(f"{len(segs)} utterances, {sum(b - a for a, b in segs):.1f}s total")

    from resemblyzer import VoiceEncoder, preprocess_wav
    enc = VoiceEncoder()
    rows, embs = [], []
    for i, (a, b) in enumerate(segs):
        p = out / "utt" / f"{i:03d}.wav"
        subprocess.run(["sox", str(wav), str(p), "trim", f"{a:.3f}", f"{b-a:.3f}",
                        "highpass", "70", "norm", "-3"], check=True, capture_output=True)
        y, _ = load(p)
        embs.append(enc.embed_utterance(preprocess_wav(p)))
        rows.append({"i": i, "start": round(a, 2), "end": round(b, 2),
                     "dur": round(b - a, 2), "f0": round(f0(y, sr))})

    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    X = np.array(embs)
    X = X / np.linalg.norm(X, axis=1, keepdims=True)
    labels = KMeans(n_clusters=args.k, n_init=10, random_state=0).fit(X).labels_
    sil = silhouette_score(X, labels, metric="cosine")
    print(f"k={args.k}  silhouette {sil:.3f}  → " + (
        "usable" if sil > 0.35 else "weak, verify by hand" if sil > 0.2 else "UNUSABLE"))

    cent = {}
    for c in range(args.k):
        idx = [i for i, l in enumerate(labels) if l == c]
        cent[c] = X[idx].mean(axis=0) / np.linalg.norm(X[idx].mean(axis=0))
    pairs = [(round(float(cent[a] @ cent[b]), 3), a, b)
             for a in cent for b in cent if a < b]
    print("centroid cosine: " + "  ".join(f"c{a}-c{b}={v}" for v, a, b in pairs))
    if max(v for v, _, _ in pairs) > 0.85:
        print("  [WARN] some centroids are >0.85 similar — these voices are not separable; "
              "label by hand from the transcript")

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
        print(f"  c{c}: {len(idx)} utt / {dur:.1f}s / F0 {int(np.median(f0s)) if f0s else 0}Hz")


if __name__ == "__main__":
    main()
