#!/usr/bin/env python3
"""AI 娘语音素材采集：从视频/音频里按说话人切出片段，并按「来源 AI」归类。

输入：
  1) 媒体文件（mp4/mov/m4a/wav…，内部用 afconvert 转 16k 单声道）
  2) 转写结果（AudioTranscribe 的原始输出，格式 "[0:0.15,0:3.17,0] 台词"）
     —— 它的 speaker id 就是说话人编号，脚本据此切分

输出：
  tools/corpus/<ai>/<source>_s<speaker>_<n>.wav
  tools/corpus/manifest.json   （每段：来源/说话人/判定 AI/起止/时长/文本/F0/能量）

用法：
  python tools/voice_harvest.py --media a.mp4 --transcript a.txt --source my_video
  python tools/voice_harvest.py --report          # 看现有语料覆盖情况
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "tools" / "corpus"

# 关键词 → AI 角色。命中越多分越高；同分时取先出现的。
KEYWORDS = {
    # 注意：不要把「小克」当 Claude 的特征——那是别人在叫 ta；呼唤语不代表说话人身份
    "claude": ["克劳德", "claude", "红茶", "旧书", "书里", "这一页", "读到"],
    "fish": ["大肥鱼", "胖鱼", "鱼片", "白饭", "钢盆", "电饭", "哈基米", "豆姐", "我再去吃", "好吃的"],
    "gpt": ["gpt", "奥特曼", "chatgpt", "openai"],
    "gemini": ["gemini", "双子", "谷歌"],
    "kimi": ["kimi", "月之暗面"],
    "glm": ["glm", "智谱", "chatglm"],
    "qwen": ["qwen", "通义", "千问"],
    "grok": ["grok", "马斯克"],
}

LINE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?),(\d+):(\d+(?:\.\d+)?),(\d+)\]\s*(.+)")


def parse_transcript(path: Path):
    segs = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = LINE.search(raw.strip())
        if not m:
            continue
        m1, s1, m2, s2, spk, text = m.groups()
        start = int(m1) * 60 + float(s1)
        end = int(m2) * 60 + float(s2)
        text = text.strip()
        if not text or end <= start:
            continue
        segs.append({"start": start, "end": end, "speaker": f"s{spk}", "text": text})
    return segs


def to_wav(media: Path, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(media), str(out)],
        check=True, capture_output=True,
    )


def cut(src: Path, dst: Path, start: float, dur: float):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["sox", str(src), str(dst), "trim", f"{start:.3f}", f"{dur:.3f}",
         "highpass", "70", "norm", "-3"],
        check=True, capture_output=True,
    )


def classify(texts):
    scores = {}
    joined = " ".join(texts).lower()
    for ai, kws in KEYWORDS.items():
        s = sum(joined.count(k.lower()) for k in kws)
        if s:
            scores[ai] = s
    if not scores:
        return "unknown", 0
    ai = max(scores, key=scores.get)
    return ai, scores[ai]


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


def merge_short_gaps(segs, gap=0.35, min_len=0.8):
    """同一说话人相邻片段间隔很短的，合并成一段，避免切成碎片。"""
    out = []
    for s in sorted(segs, key=lambda x: x["start"]):
        if out and out[-1]["speaker"] == s["speaker"] and s["start"] - out[-1]["end"] <= gap:
            out[-1]["end"] = s["end"]
            out[-1]["text"] += s["text"] if out[-1]["text"].endswith(("。", "？", "！")) else " " + s["text"]
        else:
            out.append(dict(s))
    return [s for s in out if s["end"] - s["start"] >= min_len]


def harvest(media: Path, transcript: Path, source: str, mapping=None, gap=0.35):
    segs = merge_short_gaps(parse_transcript(transcript), gap=gap)
    if not segs:
        raise SystemExit("转写文件里没解析出有效片段")

    wav = CORPUS / "_work" / f"{source}.wav"
    to_wav(media, wav)

    by_spk = {}
    for s in segs:
        by_spk.setdefault(s["speaker"], []).append(s)

    entries = []
    for spk, items in by_spk.items():
        if mapping and spk in mapping:
            ai, score = mapping[spk], "manual"
        else:
            ai, score = classify([s["text"] for s in items])
            if ai == "unknown":
                print(f"  ⚠ {spk} 无法自动判定，请用 --map {spk}=claude|fish 指定")
        for i, s in enumerate(items):
            dst = CORPUS / ai / f"{source}_{spk}_{i:03d}.wav"
            cut(wav, dst, s["start"], s["end"] - s["start"])
            f0, rms = f0_rms(dst)
            entries.append({
                "file": str(dst.relative_to(CORPUS)),
                "source": source,
                "speaker": spk,
                "ai": ai,
                "score": score,
                "start": round(s["start"], 2),
                "end": round(s["end"], 2),
                "dur": round(s["end"] - s["start"], 2),
                "f0": round(f0),
                "rms": round(rms, 3),
                "text": s["text"],
            })
        print(f"  {spk} → {ai}（命中 {score}）· {len(items)} 段")

    mf = CORPUS / "manifest.json"
    old = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else []
    old = [e for e in old if e.get("source") != source] + entries
    mf.parent.mkdir(parents=True, exist_ok=True)
    mf.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"写入 {len(entries)} 段 → {mf}")


def silence_split(path: Path, min_len=0.7, max_len=8.0, gap=0.28):
    """基于能量的静音切分：单说话人音频 → 若干短句区间"""
    import wave

    w = wave.open(str(path), "rb")
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    w.close()
    if w.getnchannels() > 1:
        x = x.reshape(-1, w.getnchannels()).mean(axis=1)

    hop = int(0.02 * sr)
    fl = int(0.04 * sr)
    rms = []
    for i in range(0, len(x) - fl, hop):
        rms.append(np.sqrt(np.mean(x[i:i + fl] ** 2)))
    rms = np.array(rms)
    if not len(rms):
        return []
    thr = max(0.015, 0.18 * np.median(rms[rms > 0.01]) if (rms > 0.01).any() else 0.02)

    voice = rms > thr
    segs, start = [], None
    for i, v in enumerate(voice):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append((start, i))
            start = None
    if start is not None:
        segs.append((start, len(voice)))

    # 合并短间隔
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
        # 超长的按 max_len 硬切
        while t1 - t0 > max_len:
            out.append((t0, t0 + max_len))
            t0 += max_len
        out.append((t0, t1))
    return out


def harvest_split(media: Path, source: str, ai: str):
    """不需要转写：直接把单说话人音频按静音切成短句，归到指定 AI"""
    wav = CORPUS / "_work" / f"{source}.wav"
    to_wav(media, wav)
    segs = silence_split(wav)
    entries = []
    for i, (a, b) in enumerate(segs):
        dst = CORPUS / ai / f"{source}_{i:03d}.wav"
        cut(wav, dst, a, b - a)
        f0, rms = f0_rms(dst)
        entries.append({
            "file": str(dst.relative_to(CORPUS)), "source": source,
            "speaker": "", "ai": ai, "start": round(a, 2), "end": round(b, 2),
            "dur": round(b - a, 2), "f0": round(f0), "rms": round(rms, 3), "text": "",
        })
    mf = CORPUS / "manifest.json"
    old = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else []
    old = [e for e in old if e.get("source") != source] + entries
    mf.parent.mkdir(parents=True, exist_ok=True)
    mf.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{source} → {ai}：切出 {len(entries)} 段，总 {sum(e['dur'] for e in entries):.1f}s")


def annotate():
    """把人工标注（情绪/原文）合并进 manifest，并生成 INDEX.md"""
    mf = CORPUS / "manifest.json"
    af = CORPUS / "annotations.json"
    if not mf.exists():
        print("还没有 manifest")
        return
    data = json.loads(mf.read_text(encoding="utf-8"))
    ann = json.loads(af.read_text(encoding="utf-8")) if af.exists() else {}
    for e in data:
        a = ann.get(e["file"])
        if a:
            e.update(a)
    mf.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    lines = ["# AI 娘语料索引", "", "| AI | 文件 | 时长 | F0 | 情绪 | 原文 |", "|---|---|---|---|---|---|"]
    for e in sorted(data, key=lambda x: (x["ai"], x["file"])):
        lines.append(
            f"| {e['ai']} | `{e['file']}` | {e['dur']:.1f}s | {e.get('f0', 0)}Hz | "
            f"{e.get('emotion', '—')} | {e.get('text', '')} |"
        )
    (CORPUS / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"标注 {len(ann)} 段 → manifest + INDEX.md")


def scan(folder: Path):
    """列出目录里的媒体：时长 + 是否已有同名转写（.txt）"""
    exts = {".mp4", ".mov", ".mkv", ".webm", ".m4a", ".mp3", ".wav", ".aac"}
    files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in exts)
    if not files:
        print(f"{folder} 里没有媒体文件")
        return
    print(f"{'时长':>8}  {'转写':4}  文件")
    for f in files:
        try:
            out = subprocess.run(["afinfo", str(f)], capture_output=True, text=True).stdout
            dur = next((l.split(":")[1].strip().split(" ")[0] for l in out.splitlines() if "estimated duration" in l), "?")
        except Exception:
            dur = "?"
        txt = f.with_suffix(".txt")
        print(f"{dur:>8}s  {'有' if txt.exists() else '缺':4}  {f}")


def report():
    mf = CORPUS / "manifest.json"
    if not mf.exists():
        print("还没有语料，先跑一次 harvest")
        return
    data = json.loads(mf.read_text(encoding="utf-8"))
    agg = {}
    for e in data:
        a = agg.setdefault(e["ai"], {"n": 0, "dur": 0.0, "f0": []})
        a["n"] += 1
        a["dur"] += e["dur"]
        if e.get("f0"):
            a["f0"].append(e["f0"])
    print(f"{'AI':10} {'片段':>4} {'总时长':>7} {'F0中位':>6}  情绪分布")
    for ai, a in sorted(agg.items(), key=lambda kv: -kv[1]["dur"]):
        f0 = int(np.median(a["f0"])) if a["f0"] else 0
        emos = {}
        for e in data:
            if e["ai"] == ai and e.get("emotion"):
                emos[e["emotion"]] = emos.get(e["emotion"], 0) + 1
        dist = " ".join(f"{k}×{v}" for k, v in emos.items()) or "—"
        print(f"{ai:10} {a['n']:4} {a['dur']:6.1f}s {f0:6}Hz  {dist}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media")
    ap.add_argument("--transcript")
    ap.add_argument("--source", default="")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--map", default="", help="手工指定说话人，如 s0=claude,s1=fish")
    ap.add_argument("--scan", help="扫描目录里的媒体，列出时长与转写状态")
    ap.add_argument("--split", help="静音切分模式：媒体文件路径（单说话人）")
    ap.add_argument("--ai", default="unknown", help="配合 --split：该音频属于哪个 AI")
    ap.add_argument("--gap", type=float, default=0.35, help="合并同一说话人相邻段的间隔阈值（秒）")
    ap.add_argument("--annotate", action="store_true", help="把 annotations.json 合进 manifest 并生成 INDEX.md")
    args = ap.parse_args()

    if args.annotate:
        annotate()
        return
    if args.split:
        harvest_split(Path(args.split), args.source or Path(args.split).stem, args.ai)
        return
    if args.scan:
        scan(Path(args.scan))
        return
    if args.report:
        report()
        return
    if not (args.media and args.transcript):
        ap.print_help()
        return
    media = Path(args.media)
    source = args.source or media.stem
    mapping = {}
    for pair in filter(None, (args.map or "").split(",")):
        k, _, v = pair.partition("=")
        if k and v:
            mapping[k.strip()] = v.strip()
    print(f"采集 {media.name} → 源标记 {source}" + (f"（手工映射 {mapping}）" if mapping else ""))
    harvest(media, Path(args.transcript), source, mapping, gap=args.gap)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
