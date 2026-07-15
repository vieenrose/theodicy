# CLAUDE.md

Handoff brief. This project was designed in a Cowork session and moved here to continue in
Claude Code. Read this before touching anything.

## Machines

- **`training-machine`** — where Claude Code sessions now run: this IS the RTX 3060 box
  (check `hostname` before ssh'ing anywhere — `ssh user@training-machine` from here is a
  loopback). Repo at `/home/user/god-rpg`; training ckpts in `ckpt/`, GPU local. Git remote is
  `github.com/vieenrose/theodicy` over HTTPS (`gh auth setup-git` handles credentials).
- **`luigi-inspiron135330`** (Luigi's Dell) — the original home; repo at `~/Games/god-rpg`.

## The one idea — do not lose this

[`SupraLabs/Supra-50M-Reasoning`](https://huggingface.co/SupraLabs/Supra-50M-Reasoning) emits
flawless R1-style reasoning traces containing no reasoning. It believes HTML was invented at MIT
in 1965. It has produced the phrase *"fast-drying fasties."*

That is the diagnostic, not a defect:

> **A 50M model reliably reproduces STRUCTURE and reliably CONFABULATES CONTENT.**

Every design decision here follows from that sentence. The model gets exactly two jobs, both
chosen so its failure mode is harmless or *desirable*:

1. **It chooses — from a menu it cannot escape.** `legalBids()` enumerates every legal act in
   code. The model scores that closed set in one forward pass and samples. It never *generates*
   a decision, so there is nothing to parse and nothing to validate. It cannot be wrong. It can
   only be capricious — and a god that chooses capriciously but lawfully is a god.
2. **It speaks the omens — and here the hallucination is wanted.** Prophecy that parses cleanly
   isn't prophecy. Its confabulation, routed into portents, becomes the voice.

It is not a knowledge base. It is **a trainable policy network that happens to speak.**

## Invariants — the safety case

`test/invariants.mjs` runs 400 games, half against an *adversarial* god that emits garbage,
steals other deities' verbs, and overspends. All must hold:

- **Kel (war) can never be merciful.** Personality lives in the ACTION SPACE, not the weights —
  a 50M model cannot hold a character across two calls, so we don't ask it to. Kel has no mercy
  verb, therefore Kel cannot be merciful, no matter what the model says.
- **Kel's favor is capped at −10.** Hostility is structural, unbuyable. Guards against the
  sycophantic drift every LM has.
- **Escalation streak ≤ 3**, then Oss (mercy) is the only legal actor. LMs escalate forever
  unless a de-escalating actor is *structurally guaranteed* a turn.
- Divine budget never negative. Ledger is append-only — the god's past commitments are fed back
  into its prompt. That's how you get consistency from a model with no memory: **externalize it.**
- Mercy rate > 15%, or the game is unwinnable misery.

**Any change to the pantheon → re-run `node test/invariants.mjs`.** This test already caught one
real bug (`desecrate` pushed tension to 126, unclamped when no god acted). It earns its keep.

## State of play

Done and green:

- `game/engine.js` — deterministic world, rules, arbiter, ledger. The model never touches truth.
- `game/gods.js` — `HeuristicGod` (baseline, zero download) + `SupraGod` (transformers.js/WebGPU)
  + `InstructGod` (tiered in-browser instruct LLM: Qwen3-0.6B chooses+speaks on WebGPU,
  SmolLM2-360M voice-only on WASM; speaks the UI language, with a language gate on garble).
- `game/index.html` — React + Tailwind, no build step (esm.sh + htm). Playable now.
- `game/world3d.html` — the flagship: a Three.js ARPG over the same engine. Rigged CC0 character
  models (`game/models/`, Kenney), 5 named NPCs with branching dialogue + trust, the Kaine
  antagonist arc with a peace ending earned through Harl's charge, full EN/FR/zh-TW i18n
  (text-as-key `t()`; keys are extracted programmatically — never retyped), touch controls,
  save/load. Live at `luigi-theodicy.static.hf.space/game/world3d.html` (HF Space `Luigi/theodicy`).
- `train/` — corpus gen, full SFT of Supra-50M-Base, ONNX q4 export. Sized for the 3060.
- `test/eval_god.mjs` — WRITTEN (despite item 2 below in older copies of this brief), with a GPU
  score-worker for trained checkpoints. Reference frame at 200 games:
  heuristic KL 0.208 / MI 0.466 · oracle-argmax KL 0.685 / MI 0.714 · random KL 0.566 / MI 0.104.
- Tests pass: 3934 divine acts, 33.3% mercy rate, longest escalation run 3 (re-verified July 2026).

Open:

1. **The training question is ANSWERED (July 2026). The god exists; it is `ckpt/supra-god-mix`,
   and it must be deployed GREEDY.** The full experiment, so nobody re-runs it blind:
   - v1 (`supra-god`, 20k oracle rows): probe clean, but deployed KL 0.107 / MI 0.414 — became
     the oracle, more faithfully than the oracle's own samples. Verdict rule one.
   - v2 (`supra-god-teacher`, 5k teacher rows): argmax has real taste (KL 0.444, Vurm-heavy,
     Ithra-starved) but MI only 0.248 — the teacher itself is world-blind, and every SAMPLED
     config destroys the taste anyway.
   - The deployed blend was a confound: `lp + 1.6·anger-prior` at T 0.7 measures the PRIOR, not
     the model. Swept blend {0,.5,1,1.6} × T {0.7,.35,.2}: the frontier bends AROUND the target
     zone. 50M logit margins are too shallow to survive ANY softmax sampling (pure model at
     T 0.7 ≈ random, MI 0.077); sharpening T amplifies the prior instead (larger margins).
   - v3 (**`supra-god-mix`**, 20k oracle + 5k teacher, 3 epochs): argmax **KL 0.887 / MI 0.265 /
     H 0.917**, spread Vurm 40 / Ithra 31 / Kel 20 / Oss 9 — the eval's own verdict line:
     "THE GOD: reads the valley, then disagrees." A mercy-starved pantheon; invariants still
     force respite structurally, so it's capricious-but-lawful by construction.
   - **Deployment = greedy decode, NO anger blend, NO sampling.** The caprice comes from the
     world varying, not the dice. `SupraGod` in gods.js now does exactly this, pointed at a
     same-origin ONNX copy (`game/models/supra-god-mix-onnx/`, 52MB q4, served by the Space;
     `*.onnx` is git-ignored — the Space carries the binary, the 3060 keeps the source ckpt).
     Publishing it as a proper hub model repo is Luigi's call (name/visibility) — auto mode
     correctly refused to create that public surface unprompted.
   - Gotchas: hub `SupraLabs/Supra-50M-Base` now ships a transformers-v5 tokenizer config that
     breaks v4 installs — train with `--base models/supra-base-local` (snapshot on the 3060).
     And `pgrep -f` in remote one-liners matches its own command line — use `[b]racket` patterns.
2. ~~`test/eval_god.mjs` does not exist yet.~~ It exists. See above.
3. **A pending judgment call:** the README leads with the Supra-50M critique, quoting its worst
   outputs, because that failure *is* the design rationale. Luigi hasn't decided whether to soften
   it. Don't change it unilaterally.

## The evaluation that decides whether any of this was worth it

Heuristic labels in `make_dataset.py` are a **Boltzmann distribution over an anger oracle, not an
argmax** (`/18.0` is the temperature). We are teaching a *disposition*, not a lookup table. Which
sets up the only question worth asking:

> **If the trained model exactly reproduces the anger oracle, you spent 26MB and a training run
> to reimplement an `if` statement.**

Write `test/eval_god.mjs`: 200 games per backend, comparing —

- **Deity spread.** Always picks Kel → broken; it learned that Kel is angriest on average and
  stopped reading.
- **Correlation between world digest and choice.** Is it reading the valley at all?
- **KL between the model's bid distribution and the anger oracle's.** This is the number.
  - `KL ≈ 0` → lookup table. **Delete the model.** This is the likeliest failure and the one
    that's easiest to rationalize away. Don't.
  - `KL` high, play incoherent → collapsed to a prior.
  - `KL` moderate, choice still tracks world state → **that's the god.** The disagreement *is*
    the product.

If it lands in failure mode one: raise the Boltzmann temperature in `label_heuristic`, or switch
to `--mode teacher` so labels come from something with actual opinions instead of arithmetic.

## Standing instruction

**Do not try to make the model smarter. It will not get smarter. Make it stranger, but bounded.**

## Layout

```
game/engine.js        deterministic truth. The model never touches it.
game/gods.js          HeuristicGod (baseline) + SupraGod (transformers.js / WebGPU).
game/index.html       React + Tailwind, no build step.
train/make_dataset.py world_digest → deity:verb corpus.
train/sft_god.py      full fine-tune, 51.8M bf16, fits 12GB trivially. Minutes, not hours.
train/export_onnx.py  → ONNX q4 (~26MB). Supra is Llama arch, so Optimum exports cleanly.
test/invariants.mjs   the safety case. Run it.
```

Serve the game over HTTP (`python3 -m http.server 8000` → `/game/index.html`); ES modules will
not load from `file://`.
