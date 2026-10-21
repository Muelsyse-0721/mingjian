# Setup

## Hardware budget

Zero-shot cloning needs the model resident in memory. Rough fit:

| Model | Params | Disk | RAM needed | Verdict on 8GB machines |
|---|---|---|---|---|
| Qwen3-TTS-12Hz-0.6B-Base | 0.6B | 2.4GB | ~3.5GB | fits, CPU inference ≈ 1 line/min |
| Qwen3-TTS-12Hz-1.7B-Base | 1.7B | ~6GB | ~9GB | does not fit |
| VoxCPM2 | 2B | ~5GB | ~10GB (official: 8GB VRAM) | does not fit |
| GPT-SoVITS v2 | ~0.3B + vocoder | ~2GB | ~4GB | fits, but needs fine-tuning for best quality |

Check free disk before downloading: model + venv ≈ 4GB.

## Environment

Keep this out of the project's main environment — the dependency tree is large.

```bash
python3 -m venv .tts-venv
V=.tts-venv/bin

# torch and torchaudio MUST be the same minor version, otherwise pip raises
# ResolutionImpossible while resolving torchaudio's pin on torch.
$V/pip install --only-binary=:all: torch==2.8.0 torchaudio==2.8.0 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

# qwen-tts pulls gradio (heavy, not needed for CLI work) — install bare, then add runtime deps
$V/pip install --no-deps qwen-tts -i https://pypi.tuna.tsinghua.edu.cn/simple
$V/pip install --only-binary=:all: transformers==4.57.3 accelerate==1.12.0 \
    librosa soundfile einops onnxruntime sox numpy -i https://pypi.tuna.tsinghua.edu.cn/simple

# sox is both a python wrapper and a real binary; the model imports it at load time
brew install sox

# evaluation extras
$V/pip install resemblyzer scikit-learn "setuptools<81"
```

Notes that cost time if you skip them:

- `import sox` succeeds without the binary, but model loading then fails with
  `SoX could not be found`. Install the binary.
- `resemblyzer` (via `webrtcvad`) imports `pkg_resources`, removed in setuptools ≥ 81.
  Pin `setuptools<81`.
- Resolution can hang for minutes when a package has no binary wheel for the active Python.
  Use `--only-binary=:all:` so it fails fast instead of trying to build.

## Apple Silicon

`torch.backends.mps.is_available()` may report True while the first real tensor op aborts with
`Unable to reach MTLCompilerService ... Broken pipe` — common in sandboxed or headless sessions.
Treat MPS as unavailable and run on CPU. Expect roughly one short line per minute for a 0.6B
model; plan batch jobs accordingly.

## Model download

HuggingFace may be unreachable; ModelScope mirrors the same weights and **supports HTTP Range**,
which is what makes parallel downloads possible.

```bash
BASE="https://modelscope.cn/api/v1/models/Qwen/Qwen3-TTS-12Hz-0.6B-Base/repo?Revision=master&FilePath="
curl -sIL "$BASE/model.safetensors" | grep -i content-length     # confirm size first
```

Download each large file in N ranged chunks and concatenate, then verify byte length. Four to
eight streams is a good balance; single-stream throughput is often ~100–400KB/s, so a 2.4GB
model is 30–90 minutes without parallelism.

Do not use `hf-mirror.com` for this: it ignores `Range`, so parallel workers each download from
byte zero and the concatenation is garbage.

## Sanity check

```bash
python scripts/preflight.py --model-dir /path/to/model
```

It reports RAM, disk, torch/MPS status, model file sizes and whether the corpus dir is writable.
