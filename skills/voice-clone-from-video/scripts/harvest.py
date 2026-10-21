#!/usr/bin/env python3
"""Cut per-speaker clips from media + transcript, or split a single-speaker file by silence.

Transcript line format (verbatim output of the host's transcription tool):
    [0:12.480,0:16.480,0] 台词文本
where the last integer is the ASR speaker turn id (NOT an identity).

Examples:
  # multi-speaker, identities supplied by hand (recommended)
  python harvest.py --media ep1.mp4 --transcript ep1.txt --source ep1 \
      --map s0=alice,s1=bob --gap 0.35 --out corpus/

  # single speaker, no transcript
  python harvest.py --split voice.m4a --voice alice --source clip --out corpus/

  # what is in this folder / what did I harvest
  python harvest.py --scan ./media
  python harvest.py --report --out corpus/
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import numpy as np

LINE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?),(\d+):(\d+(?:\.\d+)?),(\d+)\]\s*(.+)")


def to_wav(media: Path, out: Path, sr=16000):
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{sr}", "-c", "1", str(media), str(out)],
                   check=True, capture_output=True)


def cut(src: Path, dst: Path, start: float, dur: float):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["sox", str(src), str(dst), "trim", f"{start:.3f}", f"{dur:.3f}",
                    "highpass", "70", "norm", "-3"], check=True, capture_output=True)


def f0_rms(path):
    import wave
    w = wave.open(str(path), "rb")
    sr, n = w.getframerate(), w.getnframes()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(float) / 32768
    w.close()
    fl = int(0.04 * sr)
    f0 = []
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
            f0.append(sr / k)
    return (float(np.median(f0)) if f0 else 0.0), float(np.sqrt(np.mean(x ** 2)))


def parse_transcript(path: Path):
    segs = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = LINE.search(raw.strip())
        if not m:
            continue
        m1, s1, m2, s2, spk, text = m.groups()
        start = int(m1) * 60 + float(s1)
        end = int(m2) * 60 + float(s2)
        if text.strip() and end > start:
            segs.append({"start": start, "end": end, "speaker": f"s{spk}", "text": text.strip()})
    return segs


def merge_gaps(segs, gap=0.35, min_len=0.8):
    out = []
    for s in sorted(segs, key=lambda x: x["start"]):
        if out and out[-1]["speaker"] == s["speaker"] and s["start"] - out[-1]["end"] <= gap:
            out[-1]["end"] = s["end"]
            out[-1]["text"] += s["text"]
        else:
            out.append(dict(s))
    return [s for s in out if s["end"] - s["start"] >= min_len]


def silence_split(path: Path, min_len=0.8, max_len=8.0, gap=0.30):
    import wave
    w = wave.open(str(path), "rb")
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    w.close()
    fl = int(0.04 * sr)
    rms = np.array([np.sqrt(np.mean(x[i:i + fl] ** 2)) for i in range(0, len(x) - fl, int(0.02 * sr))])
    if not len(rms):
        return []
    thr = max(0.012, 0.16 * np.median(rms[rms > 0.008]))
    voiced = rms > thr
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


def add_entries(out_dir: Path, source: str, entries):
    mf = out_dir / "manifest.json"
    old = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else []
    old = [e for e in old if e.get("source") != source] + entries
    mf.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")


def harvest(media: Path, transcript: Path, source: str, out_dir: Path, mapping, gap):
    segs = merge_gaps(parse_transcript(transcript), gap=gap)
    if not segs:
        raise SystemExit("no usable segments parsed — check the transcript format")
    wav = out_dir / "_work" / f"{source}.wav"
    to_wav(media, wav)

    by_spk = {}
    for s in segs:
        by_spk.setdefault(s["speaker"], []).append(s)

    entries = []
    for spk, items in by_spk.items():
        voice = mapping.get(spk)
        if not voice:
            print(f"  [WARN] {spk} has no --map entry; writing to _unassigned/ "
                  f"({len(items)} segments, first: {items[0]['text'][:24]})")
            voice = "_unassigned"
        for i, s in enumerate(items):
            dst = out_dir / voice / f"{source}_{spk}_{i:03d}.wav"
            cut(wav, dst, s["start"], s["end"] - s["start"])
            f0, rms = f0_rms(dst)
            entries.append({"file": str(dst.relative_to(out_dir)), "source": source,
                            "speaker": spk, "voice": voice, "start": round(s["start"], 2),
                            "end": round(s["end"], 2), "dur": round(s["end"] - s["start"], 2),
                            "f0": round(f0), "rms": round(rms, 3), "text": s["text"]})
        print(f"  {spk} → {voice}: {len(items)} segments")
    add_entries(out_dir, source, entries)
    print(f"wrote {len(entries)} segments to {out_dir}")


def harvest_split(media: Path, source: str, voice: str, out_dir: Path):
    wav = out_dir / "_work" / f"{source}.wav"
    to_wav(media, wav)
    entries = []
    for i, (a, b) in enumerate(silence_split(wav)):
        dst = out_dir / voice / f"{source}_{i:03d}.wav"
        cut(wav, dst, a, b - a)
        f0, rms = f0_rms(dst)
        entries.append({"file": str(dst.relative_to(out_dir)), "source": source, "speaker": "",
                        "voice": voice, "start": round(a, 2), "end": round(b, 2),
                        "dur": round(b - a, 2), "f0": round(f0), "rms": round(rms, 3), "text": ""})
    add_entries(out_dir, source, entries)
    print(f"{source} → {voice}: {len(entries)} segments, {sum(e['dur'] for e in entries):.1f}s")


def report(out_dir: Path):
    mf = out_dir / "manifest.json"
    if not mf.exists():
        print("no manifest yet")
        return
    data = json.loads(mf.read_text(encoding="utf-8"))
    agg = {}
    for e in data:
        a = agg.setdefault(e.get("voice", "?"), {"n": 0, "dur": 0.0, "f0": []})
        a["n"] += 1
        a["dur"] += e.get("dur", 0)
        if e.get("f0"):
            a["f0"].append(e["f0"])
    print(f"{'voice':14}{'clips':>6}{'seconds':>9}{'F0':>7}  gate")
    for v, a in sorted(agg.items(), key=lambda kv: -kv[1]["dur"]):
        f0 = int(np.median(a["f0"])) if a["f0"] else 0
        gate = "OK" if a["dur"] >= 10 else "TOO LITTLE (<10s)"
        print(f"{v:14}{a['n']:6}{a['dur']:9.1f}{f0:7}  {gate}")


def scan(folder: Path):
    exts = {".mp4", ".mov", ".mkv", ".webm", ".m4a", ".mp3", ".wav", ".aac"}
    files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in exts)
    if not files:
        print(f"no media under {folder}")
        return
    print(f"{'duration':>10}  {'transcript':10}  file")
    for f in files:
        try:
            out = subprocess.run(["afinfo", str(f)], capture_output=True, text=True).stdout
            dur = next((l.split(":")[1].strip().split(" ")[0] for l in out.splitlines()
                        if "estimated duration" in l), "?")
        except Exception:
            dur = "?"
        print(f"{dur:>10}s  {'yes' if f.with_suffix('.txt').exists() else 'no':10}  {f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media")
    ap.add_argument("--transcript")
    ap.add_argument("--source", default="")
    ap.add_argument("--map", default="", help="s0=alice,s1=bob")
    ap.add_argument("--gap", type=float, default=0.35)
    ap.add_argument("--split", help="single-speaker file: split by silence")
    ap.add_argument("--voice", default="unknown", help="voice name for --split")
    ap.add_argument("--out", default="corpus")
    ap.add_argument("--scan")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out)
    if args.scan:
        scan(Path(args.scan))
        return
    if args.report:
        report(out_dir)
        return
    if args.split:
        harvest_split(Path(args.split), args.source or Path(args.split).stem, args.voice, out_dir)
        return
    if not (args.media and args.transcript):
        ap.print_help()
        return
    mapping = {}
    for pair in filter(None, args.map.split(",")):
        k, _, v = pair.partition("=")
        if k and v:
            mapping[k.strip()] = v.strip()
    src = args.source or Path(args.media).stem
    print(f"{Path(args.media).name} → source={src} map={mapping or 'none'}")
    harvest(Path(args.media), Path(args.transcript), src, out_dir, mapping, args.gap)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
