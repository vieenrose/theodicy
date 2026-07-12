// gods.js — the pluggable god backends.
//
// Backend A: HeuristicGod  — deterministic, zero download, always works.
// Backend B: SupraGod      — Supra-50M via transformers.js, in-browser, WebGPU.
//
// THE CENTRAL TRICK (read this before touching SupraGod):
// A 50M model reliably reproduces STRUCTURE and reliably CONFABULATES CONTENT.
// So we never ask it to *generate* a decision. We enumerate the legal bids in
// code, then ask the model to *score* them — one forward pass, argmax over a
// closed menu. Its confabulation collapses into a distribution over legal moves.
// It cannot be wrong. It can only be capricious. That is what a god is.
//
// Then we let it hallucinate FREELY for the omen text — because oracular
// utterance is *supposed* to be semantically slippery. The weakness is the
// aesthetic. We are not fighting the model. We are casting it.

import { PANTHEON, VERBS, digest, ranking } from './engine.js';

// ---------------------------------------------------------------------------
// Omen templates (used by HeuristicGod, and as fallback when the model errors)
// ---------------------------------------------------------------------------
const OMENS = {
  parch:   ['The stream runs thin and tastes of rust.', 'Dew does not come. The stones stay dry.', 'Buckets come up half, then less.'],
  poison:  ['A pale film sits on the water at dawn.', 'The dog drinks, then will not rise.', 'Something has died upstream, and knows it.'],
  flood:   ['Rain in a season that has none.', 'The lower field is a brown mirror.', 'Water where water has never been.'],
  raid:    ['Smoke on the ridge, and no one lit it.', 'The dogs face the treeline and do not bark.', 'Hoofprints in the barley, turning back.'],
  arm:     ['Someone has been selling iron on the road.', 'Fires on the ridge, more than last week.', 'A stranger counted your gate and left.'],
  betray:  ['A gate was found open. No one opened it.', 'The watchman will not meet your eye.', 'Rope cut from the inside.'],
  mend:    ['A child who was sick is not.', 'The roof holds through the night.', 'Someone is singing in the mill again.'],
  shelter: ['The wind turns at the palisade and goes around.', 'The wall settles as if pressed.', 'You sleep, and nothing comes.'],
  respite: ['A week passes and nothing happens. It is unbearable.', 'The sky is only sky.', 'For nine days, no sign at all.'],
  bargain: ['A stranger leaves grain at the gate and asks nothing. Yet.', 'The stores are fuller than you filled them.', 'A gift, unsigned, and heavy.'],
  exact:   ['The grain you did not count is gone.', 'A price is taken. You were not asked.', 'The ledger closes a line.'],
  reveal:  ['A dream, very clear, of who is angry.', 'The shape of an intent, briefly, and then not.', 'You wake knowing something you did not learn.'],
};

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// BACKEND A — HeuristicGod
// The angriest deity that can afford to act, acts. Verb by weighted whim.
// This is your baseline. If the model can't beat this, the model is decoration.
// ---------------------------------------------------------------------------
export class HeuristicGod {
  constructor(seed = 1) { this.rnd = mulberry(seed); this.name = 'Heuristic'; this.ready = true; }
  async load() {}
  async decide(w, legal) {
    const rank = ranking(w).filter((r) => legal.some((b) => b.deity === r.deity));
    if (!rank.length) return null;
    // softmax-ish over anger, so it isn't purely predictable
    const top = rank.slice(0, 2);
    const chosen = this.rnd() < 0.78 ? top[0] : (top[1] || top[0]);
    const options = legal.filter((b) => b.deity === chosen.deity);
    const bid = pick(options, this.rnd);
    return {
      deity: bid.deity,
      verb: bid.verb,
      target: null,
      reason: `anger ${chosen.anger.toFixed(0)}`,
      omen: pick(OMENS[bid.verb], this.rnd),
    };
  }
}

// ---------------------------------------------------------------------------
// BACKEND B — SupraGod (transformers.js, WebGPU)
//
// Requires an ONNX build of Supra-50M. The HF repo ships safetensors only, so
// run train/export_onnx.py and point MODEL_ID at your converted repo or a
// local path served over HTTP.
// ---------------------------------------------------------------------------
export class SupraGod {
  constructor(modelId = 'SupraLabs/Supra-50M-Base-ONNX', opts = {}) {
    this.modelId = modelId;
    this.name = 'Supra-50M';
    this.ready = false;
    this.dtype = opts.dtype || 'q4';
    this.device = opts.device || 'webgpu';
    this.temperature = opts.temperature ?? 1.15; // omens want heat
    this.fallback = new HeuristicGod(7);
  }

  async load(onProgress) {
    const { AutoTokenizer, AutoModelForCausalLM } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5'
    );
    this.tok = await AutoTokenizer.from_pretrained(this.modelId);
    this.model = await AutoModelForCausalLM.from_pretrained(this.modelId, {
      dtype: this.dtype,
      device: this.device,
      progress_callback: onProgress,
    });
    this.ready = true;
  }

  // -- the scoring pass -----------------------------------------------------
  // Score every legal bid by its sequence log-likelihood under the model,
  // then sample from the softmax. One batch, no free generation, no parsing,
  // nothing to validate. The menu IS the grammar.
  async #scoreBids(w, legal) {
    const prompt = this.#prompt(w);
    const scored = [];
    for (const bid of legal) {
      const cont = `${bid.deity}:${bid.verb}`;
      const full = prompt + cont;
      const ids = this.tok(full, { return_tensor: true });
      const out = await this.model(ids);
      const logits = out.logits;
      const [, seqLen, vocab] = logits.dims;
      const flat = logits.data;
      const contIds = this.tok(cont, { add_special_tokens: false }).input_ids;
      const nCont = contIds.length ?? contIds.dims?.[1] ?? 0;
      let lp = 0;
      for (let k = 0; k < nCont; k++) {
        const pos = seqLen - nCont + k - 1;      // predict token at pos+1
        if (pos < 0) continue;
        const tgt = Number(Array.isArray(contIds) ? contIds[k] : contIds.data[k]);
        const off = pos * vocab;
        let max = -Infinity;
        for (let j = 0; j < vocab; j++) if (flat[off + j] > max) max = flat[off + j];
        let sum = 0;
        for (let j = 0; j < vocab; j++) sum += Math.exp(flat[off + j] - max);
        lp += (flat[off + tgt] - max) - Math.log(sum);
      }
      scored.push({ bid, lp: lp / Math.max(1, nCont) }); // length-normalised
    }
    return scored;
  }

  #prompt(w) {
    const led = w.ledger.slice(-4).map((e) =>
      `t${e.turn} ${e.deity} ${e.verb} :: ${e.reason}`).join('\n') || 'the ledger is empty';
    return [
      'You are the pantheon over a small valley. You perceive only this:',
      digest(w),
      '',
      'The ledger of what you have already done (your past binds you):',
      led,
      '',
      'The next act is:',
      '',
    ].join('\n');
  }

  async decide(w, legal) {
    if (!this.ready) return this.fallback.decide(w, legal);
    try {
      const scored = await this.#scoreBids(w, legal);

      // Blend the model's preference with the arbiter's anger prior. The prior
      // keeps the world coherent; the model supplies the caprice. Pure model =
      // noise. Pure prior = a state machine. The mix is the god.
      const anger = Object.fromEntries(ranking(w).map((r) => [r.deity, r.anger]));
      const maxAnger = Math.max(1, ...Object.values(anger).map(Math.abs));
      const util = scored.map((s) => ({
        ...s,
        u: s.lp * 1.0 + (anger[s.bid.deity] / maxAnger) * 1.6,
      }));

      const T = 0.7;
      const mx = Math.max(...util.map((u) => u.u));
      const exps = util.map((u) => Math.exp((u.u - mx) / T));
      const tot = exps.reduce((a, b) => a + b, 0);
      let r = Math.random() * tot, idx = 0;
      for (let i = 0; i < exps.length; i++) { r -= exps[i]; if (r <= 0) { idx = i; break; } }
      const chosen = util[idx].bid;

      const omen = await this.#omen(w, chosen);
      return {
        deity: chosen.deity,
        verb: chosen.verb,
        target: null,
        reason: `lp ${util[idx].lp.toFixed(2)} · anger ${anger[chosen.deity].toFixed(0)}`,
        omen,
      };
    } catch (e) {
      console.warn('SupraGod failed, falling back:', e);
      return this.fallback.decide(w, legal);
    }
  }

  // -- the confabulation pass ----------------------------------------------
  // Here we WANT it to hallucinate. Prophecy that parses cleanly is not prophecy.
  async #omen(w, bid) {
    try {
      const p = `${PANTHEON[bid.deity].name}, ${PANTHEON[bid.deity].epithet}, acts upon the valley: ${bid.verb}.\nThe sign given to the people, in one sentence, is:`;
      const ids = this.tok(p, { return_tensor: true });
      const out = await this.model.generate({
        ...ids,
        max_new_tokens: 28,
        do_sample: true,
        temperature: this.temperature,
        top_p: 0.92,
        repetition_penalty: 1.15,
      });
      let text = this.tok.batch_decode(out, { skip_special_tokens: true })[0].slice(p.length).trim();
      text = text.split('\n')[0].trim();
      const cut = text.lastIndexOf('.');
      if (cut > 12) text = text.slice(0, cut + 1);
      if (text.length < 12) throw new Error('too short');
      return text;
    } catch {
      return pick(OMENS[bid.verb], Math.random);
    }
  }
}
