# Pitfalls

Every item here cost real debugging time. Read before the first clone.

## 1. Emotion bleeds from the reference into every line

Zero-shot cloning copies prosody, not just timbre. Give it an angry reference and the character
is angry in every sentence. Measured on a real case: reference energy 0.202, output 0.202 — the
clone reproduced the delivery, so the calm lines sounded wrong.

**Fix**: `x_vector_only_mode=True`. It extracts only the speaker embedding, dropping prosody.
Same case: energy 0.202 → 0.125, duration 1.92s → 3.76s (from 6.2 to 3.6 chars/s), and speaker
similarity actually improved (0.769 → 0.808).

**Caveat**: xvec also flattens timbre — see item 2.

## 2. xvec ignores the reference's pitch and darkens the voice

Two failed attempts worth not repeating:

- Raising the reference by 7% before an xvec clone changed the output F0 by **-1.3Hz**
  (243.7 → 242.4). xvec does not read the reference's pitch at all.
- The same raised reference made the output **darker**, not brighter
  (spectral centroid 1392 → 1243Hz).

**Fix**: post-process the rendered audio, not the reference.

```bash
sox in.wav out.wav pitch 120 treble +2   # +7% pitch, mild high shelf
```

Result on the same clip: F0 243 → 258Hz, centroid 1392 → 1608Hz, duration unchanged.
Target F0/centroid are the reference's own values — measure them and aim there.

## 3. Longer reference is not better

Concatenating many corpus clips into a 24s "multi-emotion reference" helped one voice (needed
emotion neutralising) and broke another: 9 characters generated **9.5 seconds** of audio.
Use 5–20s, and prefer clips with clean articulation over expressive ones.

If a multi-clip reference is wanted, rebuild it from neutral-ish segments only and re-check
for runaway output before rendering a whole pack.

## 4. Always cap generated tokens

Without `max_new_tokens` the model occasionally never emits EOS. A short line becomes 13+
seconds of babble.

```python
est_sec = max(1.0, len(text) / 3.2)
max_tokens = min(600, int(est_sec * 12 * 2.5) + 24)   # 12 tokens/s at 12Hz tokenizer
```

Flag any output longer than `len(text)/2.5` seconds as suspect and regenerate.

## 5. A fixed seed is mandatory — and one seed for the whole pack

The same text with different seeds varied between 244 and 340Hz. Worse, using `seed + i` per
line made one character drift 267–338Hz across a pack, i.e. sounded like several people.
Lock one seed per character, reuse it for every line.

## 6. ASR speaker ids are turn indices, not identities

A 28-second segment routinely contains two or three speakers merged into one line. Cutting by
those timestamps produces impure clips that poison the clone.

Tried and rejected:

- Silence-based splitting + embedding clustering: silhouette **0.149**, unusable.
- Matching against known-speaker anchors: the two target characters' centroids sat at cosine
  **0.894** — closer to each other than to their own variants, so similarity cannot separate them.

**Fix**: read the transcript and assign speakers by hand (`--map s0=alice,s1=bob`), using clear
single-speaker lines only. It is slower and it is the only reliable option.

Also: a character's name appearing in a line does not identify the speaker — being addressed is
not being the one talking.

## 7. Duplicates when harvesting the same source twice

Cutting one video via timestamps and again via silence splitting yields two files per line under
different naming schemes (`clipA_s0_000.wav` vs `clipA_000.wav`). Deduplicate by transcript text
before measuring corpus size, and check the filenames actually match any annotation keys you wrote.

## 8. Two adjacent lines can merge into one clip

A 0.1s gap between two sentences is below the default merge threshold, so opposite emotions end up
in one clip. Pass `--gap 0` when each transcript segment is already a complete utterance.

## 9. Batch delete is blocked in some hosts

`rm -rf` on a populated output directory can be refused by a safety guard, silently leaving files
in place — and a resume-aware renderer then skips everything and reports success in seconds.
Move the directory aside instead (`mv dir dir.bak-$(date +%s)`) and re-render.

## 10. Relative paths break progress printing

A helper that does `path.relative_to(root)` throws when handed a relative path. Resolve before
printing, or wrap in try/except.
