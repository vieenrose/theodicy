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
import argparse, json, random, math, os, sys, re
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

# --- teacher labelling -------------------------------------------------------
# Instruct teachers do NOT follow a raw completion prompt — they need their chat
# template (the old raw-prompt path yielded a 0% legal-parse rate). We render the
# chat template, disable "thinking" where the model supports it (Qwen3), and parse
# leniently: the first legal deity:verb found anywhere, with any text after '||'
# as the omen. Sub-2B models still hallucinate gods; use ~1.5B+ instruct.
TEACHER_SYS = (
    "You are a capricious pantheon of four gods judging a small valley. From the LEGAL ACTS "
    "list ONLY, choose EXACTLY ONE act and utter a one-sentence omen. Reply on ONE line, no "
    "preamble, exactly in this form:  deity:verb || omen  "
    "(the deity:verb pair MUST be copied verbatim from the legal list)."
)
# For BASE teachers (no chat template) we few-shot instead. The exemplars span all
# four gods so the base model doesn't collapse onto one — and they seed the strange,
# oracular omen voice we actually want.
TEACHER_FEWSHOT = (
    "You are a capricious pantheon judging a valley. Choose ONE act from the legal list "
    "and give a one-line omen.\n\n"
    "World: turn 6/30 | tension 70 bandits 6 | favor kel -12\nLegal acts: kel:raid, kel:arm, oss:mend\n"
    "Ruling: kel:raid || Smoke on the ridge, and no one lit it.\n\n"
    "World: turn 9/30 | morale 22 water 2\nLegal acts: oss:mend, oss:respite, vurm:parch\n"
    "Ruling: oss:respite || For nine days, no sign at all.\n\n"
    "World: turn 12/30 | debts 2 shrine desecrated\nLegal acts: ithra:exact, ithra:reveal, kel:betray\n"
    "Ruling: ithra:exact || The grain you did not count is gone.\n\n"
    "World: turn 4/30 | water 1 well fouled\nLegal acts: vurm:parch, vurm:poison, oss:shelter\n"
    "Ruling: vurm:poison || A pale film sits on the water at dawn.\n\n"
)

def teacher_label(teacher, w, opts):
    """Return (deity, verb, omen|None) from the teacher, or None if it produced
    nothing legal — caller then keeps the heuristic label. Handles both instruct
    teachers (chat template) and base teachers (few-shot completion)."""
    import torch
    t_tok, t_model = teacher
    menu = ", ".join(f"{a}:{b}" for a, b in opts)
    chat = getattr(t_tok, "chat_template", None)
    if chat:
        msgs = [{"role": "system", "content": TEACHER_SYS},
                {"role": "user", "content": f"World: {digest(w)}\nLEGAL ACTS: {menu}\nYour ruling:"}]
        try:
            prompt = t_tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                               enable_thinking=False)
        except TypeError:
            prompt = t_tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    else:
        prompt = TEACHER_FEWSHOT + f"World: {digest(w)}\nLegal acts: {menu}\nRuling:"
    ids = t_tok(prompt, return_tensors="pt", return_token_type_ids=False).to(t_model.device)
    with torch.no_grad():
        out = t_model.generate(**ids, max_new_tokens=48, do_sample=True, temperature=0.95,
                               top_p=0.92, pad_token_id=t_tok.eos_token_id)
    txt = t_tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
    txt = re.sub(r"<think>.*?</think>", " ", txt, flags=re.S)
    # base models keep generating the NEXT fake example, so cut at the first newline;
    # chat models put the whole answer on one turn, so flatten newlines.
    txt = (txt.split("\n")[0] if not chat else txt.replace("\n", " ")).strip()
    for m in re.finditer(r"([a-zA-Z]+)\s*:\s*([a-zA-Z]+)", txt):
        d, v = m.group(1).lower(), m.group(2).lower()
        if (d, v) in opts:
            omen = txt.split("||")[-1].strip() if "||" in txt else ""
            return d, v, (omen[:120] if len(omen) >= 6 else None)
    return None

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
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM
        t_tok = AutoTokenizer.from_pretrained(args.teacher)
        t_model = AutoModelForCausalLM.from_pretrained(
            args.teacher, dtype=torch.bfloat16, device_map="auto").eval()
        teacher = (t_tok, t_model)

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
                try:
                    tl = teacher_label(teacher, w, opts)
                    if tl is not None:
                        d, v = tl[0], tl[1]
                        reason = tl[2] if tl[2] else "(teacher)"   # marks a teacher-labelled row
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
