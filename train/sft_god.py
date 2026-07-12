#!/usr/bin/env python3
"""
sft_god.py — fine-tune Supra-50M-Base into a god policy. Sized for one RTX 3060.

51.8M params @ bf16. Full fine-tune, no LoRA needed — the whole model is ~104MB
of weights and optimizer state fits in 12GB with room to spare. On a 3060 this
is minutes, not hours. That is the entire point of working at 50M: the model is
cheap enough to be *disposable*, so you can iterate on the god's personality the
way you'd iterate on a config file.

Loss is masked to the completion only — we do not train it to predict the world
digest (that's our text, not its job). It learns exactly one thing: given a
world, emit `<deity>:<verb>`.

Usage (on the 3060 box):
    pip install -r requirements.txt
    python make_dataset.py --n 20000 --out data/god_bids.jsonl
    python sft_god.py --data data/god_bids.jsonl --out ckpt/supra-god
    python export_onnx.py --ckpt ckpt/supra-god --out ckpt/supra-god-onnx
"""
import argparse, json, os
import torch
from torch.utils.data import Dataset
from transformers import (AutoTokenizer, AutoModelForCausalLM, TrainingArguments,
                          Trainer, DataCollatorForSeq2Seq)

BASE = "SupraLabs/Supra-50M-Base"

class GodBids(Dataset):
    def __init__(self, path, tok, max_len=320):
        self.rows = [json.loads(l) for l in open(path)]
        self.tok, self.max_len = tok, max_len

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        p = self.tok(r["prompt"], add_special_tokens=False)["input_ids"]
        c = self.tok(r["completion"] + self.tok.eos_token, add_special_tokens=False)["input_ids"]
        ids = (p + c)[-self.max_len:]
        n_prompt = max(0, len(ids) - len(c))
        labels = [-100] * n_prompt + ids[n_prompt:]   # <- mask the prompt
        return {"input_ids": ids, "labels": labels, "attention_mask": [1] * len(ids)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/god_bids.jsonl")
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--out", default="ckpt/supra-god")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--bs", type=int, default=32)      # 3060 12GB handles this easily at 50M
    ap.add_argument("--lr", type=float, default=3e-4)  # small model, hot LR
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.bfloat16)
    model.config.pad_token_id = tok.pad_token_id
    print(f"params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")

    ds = GodBids(args.data, tok)
    print(f"examples: {len(ds)}")

    targs = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.bs,
        gradient_accumulation_steps=1,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        bf16=True,
        logging_steps=25,
        save_strategy="epoch",
        save_total_limit=1,
        report_to=[],
        dataloader_num_workers=4,
    )

    Trainer(
        model=model, args=targs, train_dataset=ds,
        data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100),
    ).train()

    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    print(f"saved -> {args.out}")

    # --- sanity: does it emit legal-looking bids? -----------------------------
    model.eval().cuda()
    probe = ds.rows[0]["prompt"]
    ids = tok(probe, return_tensors="pt").to("cuda")
    with torch.no_grad():
        out = model.generate(**ids, max_new_tokens=8, do_sample=False,
                             pad_token_id=tok.pad_token_id)
    print("probe ->", repr(tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)))
    print("(expect something like 'kel:raid'. If it's prose, raise epochs.)")

if __name__ == "__main__":
    main()
