#!/usr/bin/env python3
"""
score_worker.py — a persistent GPU bid-scorer for test/eval_god.mjs.

The browser ships the model as ONNX-q4 and scores bids in JS (SupraGod.#scoreBids).
For a 200-games-x-2-backends evaluation that is ~tens of thousands of forward
passes; on a CPU-only Node/transformers.js path that is an hour. So the eval
keeps engine.js (the source of truth) authoritative in Node and offloads ONLY the
model forward pass to this worker, which holds the fine-tuned torch checkpoint on
the 3060.

We score the *policy*, not the q4 artifact: the ONNX build is a faithful
compression of exactly these weights, and the properties the eval measures
(deity spread, world-reading, KL-vs-oracle) are policy-level, not affected by q4
rounding.

Scoring mirrors SupraGod.#scoreBids EXACTLY:
  - length-normalised sum of token log-probs of the continuation
  - tokenised the way training tokenised (add_special_tokens=False for BOTH the
    prompt and the continuation — sft_god.py never prepended a BOS)

Protocol: one JSON request per stdin line, one JSON response per stdout line.
  request : {"prompt": "...", "conts": ["kel:raid", "oss:mend", ...]}
  response: {"lps": [-1.83, -2.40, ...]}   # length-normalised, same order
A line == "PING" answers "READY" (used by the Node side to await warmup).
"""
import sys, json, argparse
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForCausalLM


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ckpt/supra-god")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.ckpt)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.ckpt, dtype=torch.float32).to(args.device).eval()
    pad_id = tok.pad_token_id

    def score(prompt, conts):
        # prompt length is constant across all conts for this request, so every
        # sequence shares the same continuation start index P.
        p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
        P = len(p_ids)
        c_ids = [tok(c, add_special_tokens=False)["input_ids"] for c in conts]
        seqs = [p_ids + c for c in c_ids]
        maxlen = max(len(s) for s in seqs)
        n = len(seqs)
        # right-pad: real tokens occupy positions 0..len-1, so default arange
        # position ids stay correct for every real token (pad sits at the tail).
        input_ids = torch.full((n, maxlen), pad_id, dtype=torch.long)
        attn = torch.zeros((n, maxlen), dtype=torch.long)
        for i, s in enumerate(seqs):
            input_ids[i, :len(s)] = torch.tensor(s)
            attn[i, :len(s)] = 1
        input_ids = input_ids.to(args.device)
        attn = attn.to(args.device)
        with torch.no_grad():
            logits = model(input_ids=input_ids, attention_mask=attn).logits
            logprobs = F.log_softmax(logits.float(), dim=-1)
        lps = []
        for i, c in enumerate(c_ids):
            lc = len(c)
            total = 0.0
            for k in range(lc):
                pos = P + k - 1          # logits at pos predict the token at pos+1
                if pos < 0:
                    continue
                total += logprobs[i, pos, c[k]].item()
            lps.append(total / max(1, lc))   # length-normalised, as in the browser
        return lps

    sys.stderr.write(f"[score_worker] loaded {args.ckpt} on {args.device}\n")
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "PING":
            sys.stdout.write("READY\n"); sys.stdout.flush(); continue
        req = json.loads(line)
        lps = score(req["prompt"], req["conts"])
        sys.stdout.write(json.dumps({"lps": lps}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
