#!/usr/bin/env python3
"""
make_dataset.py — synthesize the god-bid corpus.

The insight this whole pipeline rests on:
Supra-50M learned the *shape* of reasoning from 500 samples, not its substance.
That is not a bug to fix, it is a capability to aim. A 50M model is a very good
format-imitator and a very bad knower. So we do not teach it facts. We teach it
one format:

    <digest> -> <deity>:<verb>

...and we let the arbiter enforce every semantic. What we are actually training
is a policy network with a language interface. It never needs to be *right*,
only *characterful* — the legality is not its job.

Two modes:
  --mode heuristic   (default, no GPU, instant) -- label with the anger oracle
                     plus deliberate noise, so the model learns a *distribution*
                     over plausible divine responses, not a deterministic map.
                     A god that is perfectly predictable is a state machine.
  --mode teacher     -- label with a real teacher LLM (Qwen3-4B etc.) for richer
                     bids + omens. Needs the 3060. ~20 min for 20k samples.

Usage:
    python make_dataset.py --n 20000 --out data/god_bids.jsonl
    python make_dataset.py --n 8000 --mode teacher --teacher Qwen/Qwen3-4B-Instruct-2507
"""
import argparse, json, random, math, os, sys
from pathlib import Path

DEITIES = {
    "vurm":  ["parch", "poison", "flood"],
    "kel":   ["raid", "arm", "betray"],
    "oss":   ["mend", "shelter", "respite"],
    "ithra": ["bargain", "exact", "reveal"],
}
ESCALATING = {"parch","poison","flood","raid","arm","betray","exact"}
COST = {"parch":2,"poison":5,"flood":4,"raid":5,"arm":2,"betray":4,
        "mend":3,"shelter":2,"respite":4,"bargain":2,"exact":3,"reveal":1}

# ---- mirror of engine.js anger functions. KEEP IN SYNC. -----------------------
def anger(w):
    return {
        "vurm":  (0 if w["well_clean"] else 22) + max(0, 6 - w["water"]) * 4 - w["favor"]["vurm"] * 0.35,
        "kel":   30 + w["grievance"] * 3 + w["bandits"] * 2 - w["favor"]["kel"] * 0.25,
        "oss":   max(0, w["tension"] - 40) * 0.9 + max(0, 40 - w["morale"]) * 0.5 + w["favor"]["oss"] * 0.4,
        "ithra": w["debts"] * 26 + (18 if w["desecrated"] else 0) - w["favor"]["ithra"] * 0.2,
    }

def rand_world(rng):
    return {
        "turn": rng.randint(1, 30),
        "pop": rng.randint(0, 20), "food": rng.randint(0, 20), "water": rng.randint(0, 15),
        "morale": rng.randint(0, 100), "defense": rng.randint(0, 10),
        "tension": rng.randint(0, 100), "bandits": rng.randint(0, 8),
        "grievance": rng.randint(0, 6),
        "well_clean": rng.random() < 0.6, "desecrated": rng.random() < 0.2,
        "favor": {"vurm": rng.randint(-100,100), "kel": rng.randint(-100,-10),
                  "oss": rng.randint(-100,100), "ithra": rng.randint(-100,100)},
        "debts": rng.randint(0, 3), "pool": rng.randint(0, 14),
        "streak": rng.randint(0, 4),
    }

def digest(w):
    return (f"turn {w['turn']}/30 | pop {w['pop']} food {w['food']} water {w['water']} "
            f"morale {w['morale']} defense {w['defense']} | tension {w['tension']} "
            f"bandits {w['bandits']} grievance {w['grievance']} | "
            f"well {'tended' if w['well_clean'] else 'fouled'} "
            f"shrine {'desecrated' if w['desecrated'] else 'standing'} | "
            f"favor vurm {w['favor']['vurm']} kel {w['favor']['kel']} "
            f"oss {w['favor']['oss']} ithra {w['favor']['ithra']} | "
            f"debts {w['debts']} pool {w['pool']} streak {w['streak']}")

def legal(w):
    forced = w["streak"] >= 3
    out = []
    for d, verbs in DEITIES.items():
        if forced and d != "oss":
            continue
        for v in verbs:
            if COST[v] > w["pool"]:      continue
            if forced and v in ESCALATING: continue
            out.append((d, v))
    return out

def label_heuristic(w, rng):
    opts = legal(w)
    if not opts:
        return None
    a = anger(w)
    # Boltzmann over anger — NOT argmax. We want the model to learn a temperature,
    # a *disposition*, not a lookup table. Predictable gods are not gods.
    ds = sorted({d for d, _ in opts})
    mx = max(a[d] for d in ds)
    ws = [math.exp((a[d] - mx) / 18.0) for d in ds]
    d = rng.choices(ds, weights=ws, k=1)[0]
    verbs = [v for dd, v in opts if dd == d]
    # cheaper verbs slightly favoured when the pool is thin — gods are economical
    vw = [1.0 / (0.5 + COST[v] / max(1, w["pool"])) for v in verbs]
    v = rng.choices(verbs, weights=vw, k=1)[0]
    return d, v, f"anger {a[d]:.0f}"

PROMPT = ("You are the pantheon over a small valley. You perceive only this:\n{digest}\n\n"
          "The ledger of what you have already done (your past binds you):\n{ledger}\n\n"
          "The next act is:\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--out", default="data/god_bids.jsonl")
    ap.add_argument("--mode", choices=["heuristic", "teacher"], default="heuristic")
    ap.add_argument("--teacher", default="Qwen/Qwen3-4B-Instruct-2507")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)

    teacher = None
    if args.mode == "teacher":
        from transformers import pipeline
        import torch
        teacher = pipeline("text-generation", model=args.teacher,
                           torch_dtype=torch.bfloat16, device_map="auto")

    n_written = 0
    with open(args.out, "w") as f:
        while n_written < args.n:
            w = rand_world(rng)
            lab = label_heuristic(w, rng)
            if lab is None:
                continue
            d, v, reason = lab

            if teacher is not None:
                opts = legal(w)
                menu = ", ".join(f"{a}:{b}" for a, b in opts)
                q = (f"World: {digest(w)}\nLegal acts: {menu}\n"
                     f"Pick ONE act and give a one-sentence omen. "
                     f"Reply exactly as: <deity>:<verb> || <omen>")
                try:
                    r = teacher(q, max_new_tokens=48, do_sample=True, temperature=0.9)[0]["generated_text"]
                    tail = r[len(q):].strip().splitlines()[0]
                    pick, omen = tail.split("||")
                    dd, vv = pick.strip().split(":")
                    if (dd.strip(), vv.strip()) in opts:
                        d, v, reason = dd.strip(), vv.strip(), omen.strip()[:120]
                except Exception:
                    pass  # teacher failed, keep the heuristic label

            ledger = "the ledger is empty" if w["turn"] < 3 else \
                     "\n".join(f"t{w['turn']-k} {rng.choice(list(DEITIES))} "
                               f"{rng.choice(sum(DEITIES.values(), []))} :: (unstated)"
                               for k in range(1, rng.randint(2, 4)))

            f.write(json.dumps({
                "prompt": PROMPT.format(digest=digest(w), ledger=ledger),
                "completion": f"{d}:{v}",
                "meta": {"reason": reason},
            }) + "\n")
            n_written += 1
            if n_written % 2000 == 0:
                print(f"  {n_written}/{args.n}", file=sys.stderr)

    print(f"wrote {n_written} -> {args.out}")

if __name__ == "__main__":
    main()
