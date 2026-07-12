#!/usr/bin/env python3
"""
god_server.py — run ConicCat/Qwen3.5-0.8B-Text-Only AS the game's god, live.

The pivot: instead of distilling the 0.8B into Supra-50M, we let it decide directly.
Measured, it is world-blind (MI(pick;world) ~ 0.003 bits) — a poor *teacher*, but as
the god itself that is fine: the arbiter (legalBids/validateBid in engine.js) guarantees
legality and the action space guarantees character, so a capricious-but-lawful god is
exactly the thesis. We just want its strange voice on the throne.

The browser POSTs {digest, legal:[{deity,verb}...]}; we few-shot the model for a legal
pick plus an omen, and return it. Illegal/garbled output falls back to a random legal
bid so the god always acts.

Run in the teacher venv (transformers 5.x, which supports the qwen3_5 arch):
    .venv-teacher/bin/python game/god_server.py --port 8008
Then in the game, select the "Qwen3.5-0.8B (live)" backend.
"""
import argparse, json, re, random
import http.server
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

MODEL_DEFAULT = "ConicCat/Qwen3.5-0.8B-Text-Only"

# Few-shot exemplars spanning all four gods — seeds the format and the oracular voice.
FEWSHOT = (
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

TOK = None
MODEL = None


def decide(digest, legal):
    legalset = {(b["deity"], b["verb"]) for b in legal}
    menu = ", ".join(f"{b['deity']}:{b['verb']}" for b in legal)
    prompt = FEWSHOT + f"World: {digest}\nLegal acts: {menu}\nRuling:"
    ids = TOK(prompt, return_tensors="pt", return_token_type_ids=False).to(MODEL.device)
    with torch.no_grad():
        out = MODEL.generate(**ids, max_new_tokens=48, do_sample=True, temperature=1.0,
                             top_p=0.95, pad_token_id=TOK.eos_token_id)
    txt = TOK.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
    txt = txt.split("\n")[0].strip()
    pick, omen = None, ""
    for m in re.finditer(r"([a-zA-Z]+)\s*:\s*([a-zA-Z]+)", txt):
        d, v = m.group(1).lower(), m.group(2).lower()
        if (d, v) in legalset:
            pick = (d, v); break
    if "||" in txt:
        omen = txt.split("||")[-1].strip()[:140]
    if pick is None:                                   # garbled → the god still acts, lawfully
        b = random.choice(legal); pick = (b["deity"], b["verb"])
    return {"deity": pick[0], "verb": pick[1], "omen": omen, "reason": "qwen3.5-0.8b live"}


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "model": MODEL.name_or_path}).encode())

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        try:
            res = decide(req.get("digest", ""), req.get("legal", []))
        except Exception as e:
            res = {"error": str(e)}
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(res).encode())

    def log_message(self, *a):
        pass  # quiet


def main():
    global TOK, MODEL
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=MODEL_DEFAULT)
    ap.add_argument("--port", type=int, default=8008)
    args = ap.parse_args()
    print(f"loading {args.model} …")
    TOK = AutoTokenizer.from_pretrained(args.model)
    MODEL = AutoModelForCausalLM.from_pretrained(
        args.model, dtype=torch.bfloat16, device_map="auto").eval()
    print(f"god is listening on http://localhost:{args.port}  (POST /decide)")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
