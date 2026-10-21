---
name: voice-clone-from-video
description: |
  Build cloned character voices from video or audio: split multi-speaker audio,
  assemble a labelled corpus with emotion tags, clone each voice with a local
  TTS model, and judge the result with objective metrics before shipping.
  This skill should be used when someone wants a voice that sounds like a
  specific person or character in existing footage, when several characters
  must be separated from one recording, or when a cloned voice "does not sound
  right" and needs to be diagnosed rather than guessed at.
agent_created: true
---

# Voice Clone From Video

Turning footage into a usable character voice is not one model call. It is a pipeline where
each stage can silently ruin the next: bad segmentation pollutes the corpus, a polluted corpus
poisons the clone, and an unmeasured clone leads to endless blind tuning.

This skill exists so the work is measured at every stage, and so the honest ceiling is stated
instead of being papered over with parameter tweaks.

## When this applies

- "Make the pet/NPC talk like this character from the video."
- "There are several AI characters in this recording — separate their voices."
- "The cloned voice does not sound like them; figure out why."
- Any task needing a per-speaker audio corpus with emotion labels.

## Core rule: measure before tuning

Never iterate on a cloned voice by listening and guessing. Every loop must produce numbers
(speaker similarity, F0, spectral centroid, duration). Read `references/evaluation.md`
before the first generation — the thresholds there decide whether to continue or stop.

## Workflow

### 0. Preflight

Check the machine before promising anything: RAM, free disk, whether torch exists, whether the
model hub is reachable. Run `scripts/preflight.py`. If it reports the model cannot fit, say so
now — do not start a download that will fail at load time.
Environment setup, model choice by hardware, and mirror quirks: `references/setup.md`.

### 1. Acquire sources

Local files first; `yt-dlp` only when the user supplies a link. Audio-only is enough — never
download full video when `-f bestaudio` works.

**Consent check**: cloning a real person's voice needs their agreement. If the source is a
public creator's performance, confirm the user has the right to reuse it, and keep derived
audio local rather than publishing it.

### 2. Transcribe with speaker labels

Use the host's transcription tool (timestamps + speaker id). Save its raw output verbatim to a
`.txt` beside the media. The expected format is one segment per line:

```
[0:12.480,0:16.480,0] 台词文本
```

### 3. Build the corpus

```
python scripts/harvest.py --media a.mp4 --transcript a.txt --source ep1 \
    --map s0=alice,s1=bob --gap 0.35 --out corpus/
```

**Speaker ids from ASR are not identities.** They are turn indices that merge whenever two
people speak inside one segment. Always read the transcript and pass `--map` yourself.
Automatic keyword guessing is only a first pass and will put a character in the wrong bucket
when one character addresses another by name.

For single-speaker files with no transcript, split by silence instead:

```
python scripts/harvest.py --split voice.m4a --voice alice --source clip --out corpus/
```

### 4. Gate the corpus

Do not clone yet. Check:

| Check | Pass | If it fails |
|---|---|---|
| Per-character speech | ≥ 10s usable, 30s+ preferred | go get more audio, do not proceed |
| Purity | spot-check 2 clips per character by ear/transcript | re-cut, tighten `--gap` or timestamps |
| Duplicates | no repeated performance counted twice | drop by text or by embedding |
| Segmentation | no clip containing two speakers | split at the boundary |

`scripts/evaluate.py --corpus` prints duration, F0 spread and duplicate candidates.

### 5. Clone

```
python scripts/clone.py --corpus corpus/ --model MODEL_DIR \
    --voice alice --ref alice_ref.wav --ref-text "..." --xvec \
    --text "要合成的一句话" --out out.wav
```

Decisions that matter, all covered in `references/pitfalls.md`:

- **Reference length**: 5–20s per voice. Longer is not better; past ~20s behaviour degrades.
- **`--xvec`** keeps timbre but discards the reference's prosody — the fix when every line
  inherits the reference's anger. It also flattens brightness, so it needs post-processing.
- **Seed must be fixed** for a whole pack, or the character drifts between lines.
- **Token cap is mandatory**; without it the model occasionally never emits EOS.

### 6. Evaluate, then decide

```
python scripts/evaluate.py --ref alice_ref.wav --gen out.wav --json
```

Read the numbers against `references/evaluation.md`. Two iterations is the budget. If
similarity stays under 0.75 after that, stop and report the ceiling — zero-shot cloning of a
stylised cartoon voice is limited by the model, not by the parameters.

### 7. Package

```
python scripts/install_pack.py --src out_wavs/ --dst app/assets/voice/ --format m4a
```

Writes `manifest.json` mapping text → file so the app can look up a line. Keep the previous
pack in place and prefer the new one by search order — that makes rollback a directory rename.

## Running the scripts

All scripts are stdlib-only except where they import `numpy`, `soundfile`, `resemblyzer` or
`qwen_tts`. Run them with the virtualenv interpreter created in `references/setup.md`:

```bash
V=.tts-venv/bin/python
PATH="$(brew --prefix)/bin:$PATH" $V scripts/preflight.py --model-dir MODEL_DIR
```

`PATH` matters: `sox` is a real binary, not just a Python package.

## Reporting the outcome

State, in this order: how much audio per character, similarity score, F0 and brightness versus
the reference, and whether the result is usable or capped by the model. If capped, name the two
paths that would actually change it (fine-tuning, or better source audio) instead of promising
that more tuning will help.

## References

| Read this | When |
|---|---|
| `references/setup.md` | installing torch/TTS/sox, choosing a model for the hardware, model download |
| `references/pitfalls.md` | before the first clone; when output is angry/dull/too long/inconsistent |
| `references/evaluation.md` | before judging any result; to set pass/fail thresholds |
