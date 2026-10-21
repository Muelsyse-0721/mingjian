#!/usr/bin/env python3
"""Render cloned speech from a corpus, one voice at a time, with the guard rails baked in.

Single line:
  python clone.py --model MODEL_DIR --ref a.wav --ref-text "reference transcript" \
      --text "要合成的一句" --out out.wav [--xvec] [--seed 4] [--pitch 120] [--treble 2]

Whole pack (voices.json describes each voice, lines.json lists what to say):
  python clone.py --model MODEL_DIR --voices voices.json --lines lines.json --out out/

voices.json:
  {
    "alice": {"ref": "refs/alice.wav", "ref_text": "…", "xvec": true, "seed": 4,
              "pitch": 120, "treble": 2},
    "bob":   {"ref": "refs/bob.wav",   "ref_text": "…", "seed": 4}
  }

lines.json:
  {"alice": ["第一句", "第二句"], "bob": ["…"]}

Guard rails (see references/pitfalls.md):
  * max_new_tokens is always set — otherwise the model occasionally never stops
  * one seed per voice for the whole pack — mixed seeds make a character drift
  * existing files are skipped, so an interrupted pack resumes
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np


def load_model(model_dir, device):
    import torch
    from qwen_tts import Qwen3TTSModel

    print(f"loading {model_dir} on {device}")
    kw = dict(dtype=torch.float32)
    try:
        return Qwen3TTSModel.from_pretrained(model_dir, device_map=device, **kw)
    except Exception as e:
        print(f"  device_map={device} failed ({e}); falling back to cpu")
        return Qwen3TTSModel.from_pretrained(model_dir, device_map="cpu", **kw)


def build_prompt(model, ref, ref_text, xvec):
    return model.create_voice_clone_prompt(
        ref_audio=str(ref), ref_text=ref_text, x_vector_only_mode=bool(xvec)
    )


def token_cap(text):
    est = max(1.0, len(text) / 3.2)          # ~3.2 chars per second of speech
    return min(600, int(est * 12 * 2.5) + 24)  # 12 tokens/s at the 12Hz tokeniser


def generate(model, prompt, text, out: Path, seed=42, pitch=0, treble=0):
    import soundfile as sf
    import torch

    torch.manual_seed(seed)
    wavs, sr = model.generate_voice_clone(
        text=text, language="Chinese", voice_clone_prompt=prompt,
        max_new_tokens=token_cap(text),
    )
    y = np.asarray(wavs[0])
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), y, sr)

    if pitch or treble:
        tmp = out.with_suffix(".pp.wav")
        cmd = ["sox", str(out), str(tmp)]
        if pitch:
            cmd += ["pitch", str(int(pitch))]
        if treble:
            cmd += ["treble", f"{treble:+d}"]
        subprocess.run(cmd, check=True, capture_output=True)
        tmp.replace(out)

    dur = len(y) / sr
    flag = "  [RUNAWAY?]" if dur > len(text) / 2.5 else ""
    print(f"  → {out}  {dur:.2f}s  {sr}Hz{flag}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--ref")
    ap.add_argument("--ref-text", default="")
    ap.add_argument("--text")
    ap.add_argument("--out", default="out")
    ap.add_argument("--xvec", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--pitch", type=int, default=0, help="sox pitch shift in cents, e.g. 120")
    ap.add_argument("--treble", type=int, default=0, help="sox treble gain dB, e.g. 2")
    ap.add_argument("--voices", help="voices.json for pack mode")
    ap.add_argument("--lines", help="lines.json for pack mode")
    args = ap.parse_args()

    model = load_model(args.model, args.device)

    if args.text and args.ref:
        prompt = build_prompt(model, args.ref, args.ref_text, args.xvec)
        out = Path(args.out if args.out.endswith((".wav", ".mp3")) else Path(args.out) / "line.wav")
        generate(model, prompt, args.text, out, args.seed, args.pitch, args.treble)
        return

    if not (args.voices and args.lines):
        ap.print_help()
        sys.exit(1)

    voices = json.loads(Path(args.voices).read_text(encoding="utf-8"))
    lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    out_root = Path(args.out)
    manifest = {"profiles": {}}

    for voice, cfg in voices.items():
        texts = lines.get(voice, [])
        if not texts:
            continue
        print(f"[{voice}] {len(texts)} lines · ref={cfg['ref']} xvec={cfg.get('xvec', False)} seed={cfg.get('seed', args.seed)}")
        prompt = build_prompt(model, cfg["ref"], cfg.get("ref_text", ""), cfg.get("xvec", False))
        files = {}
        for i, text in enumerate(texts):
            target = out_root / voice / f"{i:03d}.wav"
            if target.exists() and target.stat().st_size > 2000:
                files[text] = f"{voice}/{i:03d}.wav"
                continue
            generate(model, prompt, text, target, cfg.get("seed", args.seed),
                     cfg.get("pitch", args.pitch), cfg.get("treble", args.treble))
            files[text] = f"{voice}/{i:03d}.wav"
        manifest["profiles"][voice] = {
            "engine": "zero-shot-clone",
            "seed": cfg.get("seed", args.seed),
            "xvec": bool(cfg.get("xvec", False)),
            "post": {"pitch": cfg.get("pitch", 0), "treble": cfg.get("treble", 0)},
            "files": files,
        }

    (out_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
    print(f"manifest → {out_root/'manifest.json'}")


if __name__ == "__main__":
    main()
