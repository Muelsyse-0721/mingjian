# Evaluation

Judgement must come from numbers, not from repeated listening. Compute these before deciding to
continue, and record them when reporting.

## Metrics

| Metric | How | What it tells you |
|---|---|---|
| **Speaker similarity** | `resemblyzer` utterance embeddings, cosine to the reference | timbre match — the primary gate |
| **F0 median** | autocorrelation over 40ms frames, median of voiced frames | register; compare to the reference's own median |
| **F0 spread** | p95 − p5 of voiced frames | expressiveness / emotional intensity |
| **RMS energy** | mean over voiced frames | forcefulness; anger and shouting raise it |
| **Spectral centroid** | mean of Σ(f·|X|)/Σ|X| | brightness; low = dull / "coarse" |
| **Duration vs length** | seconds ÷ characters | runaway detection and pacing |

Use `scripts/evaluate.py` for all of them; it prints a table and can emit JSON.

## Pass / fail thresholds

Judged on the *rendered* clip against the *reference*, same text and seed across variants:

| Similarity | Verdict |
|---|---|
| ≥ 0.85 | strong; ship it |
| 0.80 – 0.85 | good; typical ceiling for a 0.6B zero-shot clone |
| 0.75 – 0.80 | usable but recognisably off; try reference swap once |
| < 0.75 | not the same voice; do not ship |

| Check | Fail condition | First fix |
|---|---|---|
| Runaway | duration > len(text)/2.5 s | set `max_new_tokens`, regenerate |
| Too dull | centroid < 0.9 × reference | `sox pitch 120 treble +2` |
| Too shrill | centroid > 1.2 × reference or F0 > 1.15 × reference | reduce pitch shift, drop treble |
| Too forceful | energy > 1.2 × reference | switch to `xvec`, or pick a calmer reference |
| Too flat | F0 spread < 0.5 × reference | reference too monotone; add an expressive clip |
| Inconsistent | F0 spread across a pack > 40Hz | fix one seed for the whole pack |

## Fair comparison

When comparing variants, hold everything else constant: same text, same seed, same reference
text. Changing two things at once is how a session burns hours without learning anything.

Report the numbers side by side; a variant that "sounds better" but scores 0.06 lower on
similarity is usually a regression in disguise.

## Corpus gate (before cloning at all)

| Check | Threshold |
|---|---|
| Per-character duration | ≥ 10s usable, 30s+ preferred |
| Clip length | 1.5–10s; shorter clips give unstable embeddings |
| Purity | no clip containing two speakers |
| Duplicates | same performance not counted twice |

Under 10 seconds, zero-shot cloning is dominated by the reference's single emotional take; more
audio is worth more than any parameter change.

## When the ceiling is the model

If similarity plateaus below ~0.78 across reference swaps and post-processing, stop tuning.
Zero-shot cloning of a stylised voice (cartoon, acted, heavily processed) is limited by the model's
speaker space, not by parameters. Say so plainly, and name the two levers that would actually
change the outcome:

1. **Fine-tune** on the corpus (GPT-SoVITS-class, minutes of audio, needs a real GPU).
2. **Better source audio** — 30s+ of neutral, close-mic, single-speaker speech per character.
