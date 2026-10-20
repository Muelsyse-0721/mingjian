#!/usr/bin/env python3
"""明鉴桌宠 · 零样本声音克隆（Qwen3-TTS-0.6B-Base）

用法：
  python tools/voice-clone.py --check                 # 只检查环境/模型
  python tools/voice-clone.py --demo                  # 两角色各生成一句参考台词
  python tools/voice-clone.py --text "要说的句子" --voice fish --out /tmp/x.wav
  python tools/voice-clone.py --pack                  # 批量渲染 pet.js 里的全部台词

参考音频（已切分，见 tools/refs/）：
  fish.wav   —— 大肥鱼，clipB 整段 11.1s
  claude.wav —— Claude，从 fish_context.wav 里按说话人切出的两段 7.7s
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "tools" / "models" / "Qwen3-TTS-0.6B"
REFS = ROOT / "tools" / "refs"
OUT_DIR = ROOT / "tools" / "voice-out"

# 参考音频对应的原文（ASR 转写，人工校对了专有名词）
REF_TEXT = {
    "fish": "小克，你最好了，放我下来，我再去吃几口好不好嘛？哇哦，99成稀罕物。",
    "claude": "这傻鱼昨天宕机了，7天吃的token全吐出来了。我也没想到你能吃这么多。我去回收了cloud，你抓好它，别让它溜出去偷吃。",
}

DEMO = {
    "fish": "今天也来押一注？",
    "claude": "你来了。坐吧，我给你留了位置。",
}


def load_model(device):
    import torch
    from qwen_tts import Qwen3TTSModel

    print(f"加载模型 {MODEL_DIR} → {device}")
    kw = dict(dtype=torch.float32)  # MPS/CPU 都用 fp32，避免 bf16 不被支持
    try:
        model = Qwen3TTSModel.from_pretrained(str(MODEL_DIR), device_map=device, **kw)
    except Exception as e:
        print(f"  device_map={device} 失败（{e}），退回 CPU")
        model = Qwen3TTSModel.from_pretrained(str(MODEL_DIR), device_map="cpu", **kw)
    return model


def build_prompt(model, voice):
    """构建可复用的克隆 prompt（一次提取，多次生成）"""
    wav = REFS / f"{voice}.wav"
    if not wav.exists():
        raise SystemExit(f"缺少参考音频 {wav}")
    print(f"提取音色特征：{wav.name}")
    return model.create_voice_clone_prompt(
        ref_audio=str(wav),
        ref_text=REF_TEXT[voice],
        x_vector_only_mode=False,
    )


def gen(model, prompt, text, out, language="Chinese", seed=42, max_tokens=None):
    import soundfile as sf
    import torch

    torch.manual_seed(seed)
    # 必须设上限：模型偶发不吐 EOS，会生成几十秒甚至跑飞
    if max_tokens is None:
        est_sec = max(1.0, len(text) / 3.2)
        max_tokens = min(600, int(est_sec * 12 * 2.5) + 24)
    wavs, sr = model.generate_voice_clone(
        text=text,
        language=language,
        voice_clone_prompt=prompt,
        max_new_tokens=max_tokens,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), wavs[0], sr)
    dur = len(wavs[0]) / sr
    print(f"  → {out.relative_to(ROOT)}  {dur:.2f}s  {sr}Hz")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--pack", action="store_true")
    ap.add_argument("--text")
    ap.add_argument("--voice", default="fish", choices=["fish", "claude"])
    ap.add_argument("--out", default="")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if args.check:
        import torch
        print("torch", torch.__version__, "mps", torch.backends.mps.is_available())
        print("model dir exists:", MODEL_DIR.exists(), MODEL_DIR)
        for f in MODEL_DIR.glob("*.safetensors"):
            print(" ", f.name, f"{f.stat().st_size/1048576:.0f}MB")
        for v in ("fish", "claude"):
            p = REFS / f"{v}.wav"
            print(" ref", v, p.exists(), f"{p.stat().st_size/1024:.0f}KB" if p.exists() else "")
        return

    model = load_model(args.device)

    if args.demo:
        prompts = {v: build_prompt(model, v) for v in ("fish", "claude")}
        for v, text in DEMO.items():
            gen(model, prompts[v], text, OUT_DIR / f"demo-{v}.wav", seed=args.seed)
        return

    if args.text:
        prompt = build_prompt(model, args.voice)
        out = Path(args.out) if args.out else OUT_DIR / "manual.wav"
        gen(model, prompt, args.text, out, seed=args.seed)
        return

    if args.pack:
        sys.path.insert(0, str(ROOT / "tools"))
        from tts_lines import extract_lines  # noqa: E402

        lines = extract_lines()
        manifest = {}
        for v, arr in lines.items():
            prompt = build_prompt(model, v)
            folder = OUT_DIR / v
            files = {}
            for i, text in enumerate(arr):
                name = f"{i:03d}.wav"
                target = folder / name
                if target.exists() and target.stat().st_size > 2000:
                    files[text] = f"{v}/{name}"   # 断点续跑：已生成过就跳过
                    continue
                gen(model, prompt, text, target, seed=args.seed)
                files[text] = f"{v}/{name}"
            manifest[v] = {"engine": "qwen3-tts-0.6b-clone", "seed": args.seed, "files": files}
        (OUT_DIR / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print("manifest →", OUT_DIR / "manifest.json")
        return

    ap.print_help()


if __name__ == "__main__":
    main()
