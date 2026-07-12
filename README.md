# THEODICY

**An RPG whose gods are a 50M-parameter language model — and whose subject is that fact.**

Four deities act on a valley. They never announce themselves. You see only omens, and the
consequences, and you must reason backward from your suffering to the nature of the minds
causing it. That is the whole game.

It is also, exactly, what interacting with a small language model is like. The architecture
and the theme are the same object.

---

## The idea

[`SupraLabs/Supra-50M-Reasoning`](https://huggingface.co/SupraLabs/Supra-50M-Reasoning) emits
flawless R1-style reasoning traces with no reasoning in them. It believes HTML was invented at
MIT in 1965. It has produced the phrase *"fast-drying fasties."*

That is not a defect to route around. It is the diagnostic:

> **A 50M model reliably reproduces *structure* and reliably confabulates *content*.**

So don't fight it. Aim it. The model gets exactly two jobs, and both are chosen so that its
failure mode is either harmless or *desirable*:

**1. It chooses — but only from a menu it cannot escape.**
The engine enumerates every legal bid in code. The model scores that closed set in one forward
pass and samples. It never generates a decision, so there is nothing to parse and nothing to
validate. It cannot be wrong. It can only be *capricious* — and a god that chooses capriciously
but lawfully is not a broken god. It's a god.

**2. It speaks the omens — and here we want the hallucination.**
Oracular utterance is *supposed* to be semantically slippery, associatively true, literally
wrong. Prophecy that parses cleanly isn't prophecy. The model's confabulation, routed into the
portents, stops being a bug and becomes the voice.

It is not a knowledge base. It is **a trainable policy network that happens to speak.**

---

## Why the engine owns everything

All truth — state, causality, rules, consequence — lives in `game/engine.js`. The model touches
none of it. Personality is enforced by the **action space**, not by the weights, because a 50M
model cannot hold a character across two calls:

| Deity | Domain | Verbs |
|---|---|---|
| **Vurm, the Thirst** | water, drought, the uncovered well | `parch` `poison` `flood` |
| **Kel, the Iron Grudge** | war, grievance, the debt of blood | `raid` `arm` `betray` |
| **Oss, the Quiet Hand** | mercy, respite, the mended roof | `mend` `shelter` `respite` |
| **Ithra, the Ledger** | bargains, debts, irony | `bargain` `exact` `reveal` |

Kel has no mercy verb. Kel therefore *cannot* be merciful — not because the model was persuaded,
but because the word does not exist in its vocabulary. This is the load-bearing trick.

### The four guarantees

Language models have two reliable pathologies. Both are handled structurally:

- **They escalate forever.** So Oss is the only actor who can lower tension, and after three
  consecutive escalations Oss is the *only legal actor*. De-escalation is guaranteed by the
  arbiter, not hoped for from the model.
- **They drift toward pleasing you.** So Kel's favor is hard-capped at −10. No quantity of player
  virtue buys peace from the war god. Hostility is structural.

Plus: the divine budget can never go negative, and the ledger is append-only — the god's past
commitments are fed back into its prompt, which is how you get consistency out of a model with
no memory. **You externalize the memory.**

`test/invariants.mjs` asserts all of this over 400 games, half of them against an *adversarial*
god that emits garbage, steals other deities' verbs, and overspends its budget:

```
divine acts:        3934
mercy rate:         33.3%  (must be >15%)
longest esc. run:   3      (must be <=3)

✓ all invariants hold, including against a god that actively cheats.
  The model can be as wrong as it likes. It cannot break the world.
```

---

## Run it

```bash
python3 -m http.server 8000
# → localhost:8000/game/index.html    (ES modules need HTTP, not file://)
node test/invariants.mjs
```

Ships playable with `HeuristicGod` — zero download, no model. That's the baseline, and it's
deliberately competent: **if the trained model can't beat it, the model is decoration.**

## Train the god

Supra-50M is a Llama architecture, so Optimum exports it to ONNX cleanly and transformers.js
runs it in the browser today — ~26MB at q4, smaller than most game textures. (This is why it
beats the discrete-diffusion path in practice, despite diffusion being the more elegant fit:
no custom denoising loop, no hand-written ONNX graph.)

A full fine-tune of 51.8M params fits on an RTX 3060 in minutes. The model is cheap enough to be
**disposable** — you iterate on the god's personality the way you'd iterate on a config file.

```bash
pip install -r train/requirements.txt
python train/make_dataset.py --n 20000 --out data/god_bids.jsonl
python train/sft_god.py      --data data/god_bids.jsonl --out ckpt/supra-god
python train/export_onnx.py  --ckpt ckpt/supra-god --out ckpt/supra-god-onnx
```

Then point `SupraGod` in `game/gods.js` at your ONNX repo.

## The evaluation that actually matters

The heuristic labels are a **Boltzmann distribution over an anger oracle, not an argmax** — we
are teaching the model a *disposition*, not a lookup table. Which sets up the only question worth
asking about the result:

> **If the trained model exactly reproduces the anger oracle, you have spent 26MB and a training
> run to reimplement an `if` statement.**

The model earns its place only in the **gap** between its choices and the heuristic's — measured
as KL divergence — *provided the arbiter keeps that gap legal*. Which the tests say it does.

- KL ≈ 0 → it's a lookup table. Delete it.
- KL high, play incoherent → it collapsed to a prior; it isn't reading the world.
- KL moderate, deity choice still tracks the world state → **that's the god.** The disagreement
  is the whole point.

Don't try to make it smarter. It will not get smarter. Make it *stranger, but bounded.*

---

## Layout

```
game/engine.js        deterministic truth: world, rules, arbiter, ledger. The model never touches it.
game/gods.js          HeuristicGod (baseline) + SupraGod (transformers.js / WebGPU).
game/index.html       React + Tailwind. No build step (esm.sh + htm).
train/make_dataset.py synthetic world_digest → deity:verb corpus.
train/sft_god.py      full fine-tune of Supra-50M-Base. One 3060.
train/export_onnx.py  → ONNX q4 for the browser.
test/invariants.mjs   the safety case. Run it after any change to the pantheon.
CLAUDE.md             brief for a Claude Code session on the training box.
```

MIT.
