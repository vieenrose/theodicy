# CLAUDE.md — context for a Claude Code session on the training box

You are running on an **RTX 3060** workstation. The human (Luigi) rsync'd this repo here to
train the god model. Everything below is already designed; your job is execution + iteration.

## The one idea

`Supra-50M-Reasoning` produces flawless R1-style reasoning *form* with zero inferential
*content* (it thinks HTML was invented at MIT in 1965). That is the diagnostic, not a defect:

> **A 50M model reliably reproduces STRUCTURE and reliably CONFABULATES CONTENT.**

So we never let it determine what is true. The architecture assigns it exactly two jobs:

1. **Choose** — but only by scoring a menu of legal bids enumerated in code (`legalBids()`).
   One forward pass, argmax/sample over a closed set. It cannot be wrong, only capricious.
   A god that chooses capriciously but lawfully is not a broken god. It is a god.
2. **Speak the omens** — here we *want* free hallucination. Oracular utterance is supposed to
   be semantically slippery. Prophecy that parses cleanly isn't prophecy. The weakness is the
   aesthetic.

It is **not** a knowledge base. It is **a trainable policy network that happens to speak.**

## Non-negotiable invariants

`test/invariants.mjs` runs 400 games, half of them against an *adversarial* god that emits
garbage, steals other deities' verbs, and overspends. All of these must hold:

- Kel (war) can never be merciful — **personality lives in the action space, not the weights.**
- Kel's favor is capped at −10. Hostility is structural. Guards against sycophantic drift.
- Escalation streak ≤ 3, then Oss (mercy) is the *only* legal actor. Models escalate forever
  unless a de-escalating actor is structurally guaranteed a turn.
- Divine budget never negative; ledger is append-only.
- Mercy rate > 15% or the game is unwinnable misery.

**If you change the pantheon, re-run `node test/invariants.mjs`.** It is the whole safety case.

## Runbook

```bash
pip install -r train/requirements.txt

# 1. corpus. heuristic labels are Boltzmann over the anger oracle, NOT argmax —
#    we want the model to learn a disposition, not a lookup table.
python train/make_dataset.py --n 20000 --out data/god_bids.jsonl
#    richer bids + omens (uses the 3060, ~20 min):
python train/make_dataset.py --n 8000 --mode teacher --teacher Qwen/Qwen3-4B-Instruct-2507

# 2. full fine-tune. 51.8M bf16 — no LoRA, fits 12GB trivially, minutes not hours.
python train/sft_god.py --data data/god_bids.jsonl --out ckpt/supra-god
#    sanity probe at the end should print something like 'kel:raid', not prose.

# 3. browser build. Supra is Llama arch → Optimum exports cleanly. ~26MB at q4.
python train/export_onnx.py --ckpt ckpt/supra-god --out ckpt/supra-god-onnx
huggingface-cli upload <you>/supra-god-onnx ckpt/supra-god-onnx

# 4. verify
node test/invariants.mjs
```

Then in `game/gods.js`, point `SupraGod` at your ONNX repo id.

## If asked to improve it

The interesting axes, roughly in order of payoff:

1. **Teacher-labelled omens.** The heuristic omens are hand-written and good; model omens are
   stranger and better. Generate them with the teacher, train Supra to imitate.
2. **Ledger conditioning.** The prompt includes the last 4 divine acts. Train on longer ledger
   context so the god's past commitments actually constrain it — this is how you get
   consistency out of a model with no memory: **externalize the memory.**
3. **Distinct per-deity heads / prefixes.** Right now one model plays all four. Try a deity
   token prefix so each has its own conditional distribution.
4. **Do NOT** try to make it smarter. It will not get smarter. Make it *stranger, but bounded.*

## Layout

```
game/engine.js       deterministic truth: world, rules, arbiter, ledger. Model never touches it.
game/gods.js         HeuristicGod (baseline) + SupraGod (transformers.js, WebGPU).
game/index.html      React + Tailwind, no build step (esm.sh + htm).
train/               dataset gen, SFT, ONNX export.
test/invariants.mjs  the safety case. Run it.
```

Open `game/index.html` with any static server (`python -m http.server`) — ES modules need HTTP,
not `file://`.
