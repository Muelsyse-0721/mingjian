#!/usr/bin/env python3
"""Measure a cloned clip against its reference, and gate it.

Single pair:
  python evaluate.py --ref refs/alice.wav --gen out/alice/000.wav

Several candidates at once:
  python evaluate.py --ref refs/alice.wav --gen a.wav b.wav c.wav

Corpus only (before cloning):
  python evaluate.py --corpus corpus/

Outputs a table plus a verdict per the thresholds in references/evaluation.md.
Add --json for machine-readable output.
"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np


def load(path):
    w = wave.open(str(path), "rb")
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(float) / 32768
    w.close()
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def prosody(x, sr):
    fl = int(0.04 * sr)
    f0, rms, cent = [], [], []
    for i in range(0, len(x) - fl, int(0.02 * sr)):
        fr = x[i:i + fl]
        e = float(np.sqrt(np.mean(fr ** 2)))
        if e < 0.02:
            continue
        rms.append(e)
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[fl - 1:]
        ac /= (ac[0] + 1e-12)
        seg = ac[int(sr / 400):int(sr / 70)]
        if len(seg):
            k = int(np.argmax(seg)) + int(sr / 400)
            if ac[k] > 0.3:
                f0.append(sr / k)
        sp = np.abs(np.fft.rfft(fr * np.hanning(fl)))
        fh = np.fft.rfftfreq(fl, 1 / sr)
        cent.append(float((sp * fh).sum() / (sp.sum() + 1e-9)))
    if not f0:
        return dict(f0=0, spread=0, energy=0, centroid=0, dur=len(x) / sr)
    return dict(
        f0=round(float(np.median(f0))),
        spread=round(float(np.percentile(f0, 95) - np.percentile(f0, 5))),
        energy=round(float(np.mean(rms)), 3),
        centroid=round(float(np.mean(cent))),
        dur=round(len(x) / sr, 2),
    )


def similarity(ref, gen):
    from resemblyzer import VoiceEncoder, preprocess_wav
    enc = VoiceEncoder()
    a = enc.embed_utterance(preprocess_wav(str(ref)))
    b = enc.embed_utterance(preprocess_wav(str(gen)))
    return round(float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))), 3)


def verdict(sim):
    if sim >= 0.85:
        return "strong"
    if sim >= 0.80:
        return "good"
    if sim >= 0.75:
        return "acceptable"
    return "NOT THE SAME VOICE"


def check_corpus(corpus: Path):
    mf = corpus / "manifest.json"
    if not mf.exists():
        print(f"no manifest in {corpus}")
        return
    data = json.loads(mf.read_text(encoding="utf-8"))
    agg = {}
    for e in data:
        v = e.get("voice") or e.get("ai") or "?"
        a = agg.setdefault(v, {"n": 0, "dur": 0.0, "f0": [], "short": 0})
        a["n"] += 1
        a["dur"] += e.get("dur", 0)
        if e.get("dur", 0) < 1.5:
            a["short"] += 1
        if e.get("f0"):
            a["f0"].append(e["f0"])
    print(f"{'voice':14}{'clips':>6}{'sec':>7}{'F0':>6}{'<1.5s':>7}  gate")
    for v, a in sorted(agg.items(), key=lambda kv: -kv[1]["dur"]):
        f0 = int(np.median(a["f0"])) if a["f0"] else 0
        gate = "ok" if a["dur"] >= 10 else "too little (<10s) — get more audio"
        print(f"{v:14}{a['n']:6}{a['dur']:7.1f}{f0:6}{a['short']:7}  {gate}")

    texts = {}
    for e in data:
        t = (e.get("text") or "").strip()
        if t:
            texts.setdefault(t, []).append(e.get("file"))
    dups = {t: f for t, f in texts.items() if len(f) > 1}
    if dups:
        print(f"\nduplicate lines ({len(dups)}): keep one each")
        for t, f in list(dups.items())[:5]:
            print(f"  {t[:28]}… → {f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref")
    ap.add_argument("--gen", nargs="*", default=[])
    ap.add_argument("--corpus")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.corpus:
        check_corpus(Path(args.corpus))
        return
    if not args.ref:
        ap.print_help()
        return

    rx, rsr = load(args.ref)
    ref_m = prosody(rx, rsr)
    rows = []
    for g in args.gen:
        gx, gsr = load(g)
        m = prosody(gx, gsr)
        sim = similarity(args.ref, g)
        rows.append({"gen": str(g), "similarity": sim, "verdict": verdict(sim), **m})

    if args.json:
        print(json.dumps({"ref": ref_m, "gens": rows}, ensure_ascii=False, indent=1))
        return

    print(f"reference  F0 {ref_m['f0']}Hz  spread {ref_m['spread']}  energy {ref_m['energy']}  centroid {ref_m['centroid']}Hz  {ref_m['dur']}s")
    print(f"\n{'file':34}{'sim':>6}{'F0':>6}{'spread':>7}{'energy':>8}{'centroid':>10}{'dur':>7}  verdict")
    for r in rows:
        print(f"{Path(r['gen']).name:34}{r['similarity']:6.3f}{r['f0']:6}{r['spread']:7}{r['energy']:8.3f}{r['centroid']:10}{r['dur']:7}  {r['verdict']}")

    print("\nchecks")
    for r in rows:
        notes = []
        if r["similarity"] < 0.75:
            notes.append("BELOW GATE → swap reference or add source audio")
        if ref_m["f0"] and r["f0"] > 1.15 * ref_m["f0"]:
            notes.append("register too high → lower pitch, pick calmer reference")
        if ref_m["f0"] and r["f0"] < 0.85 * ref_m["f0"]:
            notes.append("register too low → sox pitch 120, treble +2")
        if ref_m["centroid"] and r["centroid"] < 0.9 * ref_m["centroid"]:
            notes.append("dull → pitch 120 treble +2")
        if ref_m["centroid"] and r["centroid"] > 1.2 * ref_m["centroid"]:
            notes.append("harsh → reduce pitch/treble")
        if ref_m["energy"] and r["energy"] > 1.2 * ref_m["energy"]:
            notes.append("forceful → try --xvec")
        if ref_m["spread"] and r["spread"] < 0.5 * ref_m["spread"]:
            notes.append("flat → reference too monotone")
        print(f"  {Path(r['gen']).name}: {'; '.join(notes) if notes else 'no red flags'}")


if __name__ == "__main__":
    main()
