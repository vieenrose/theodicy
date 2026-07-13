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

// LiveLLMGod is defined at the bottom of this file.

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
      'https://esm.sh/@huggingface/transformers@3.7.5'   // esm.sh: the CDN the static Space's CSP allows
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
      // The model was fine-tuned to emit "<deity>:<verb>". So we GENERATE its bid
      // and validate it against the legal menu — robust, and it's the format the
      // model actually knows. (The old log-likelihood scorer was never browser-
      // tested and threw.) Off-menu output falls to an anger-weighted legal pick,
      // so the god is always capricious-but-lawful.
      const prompt = this.#prompt(w);
      const inputs = await this.tok(prompt);
      const out = await this.model.generate({
        ...inputs, max_new_tokens: 8, do_sample: true, temperature: 1.0,
        top_p: 0.95, repetition_penalty: 1.1,
      });
      const full = this.tok.batch_decode(out, { skip_special_tokens: true })[0];
      const tail = full.slice(prompt.length);
      const m = tail.match(/(vurm|kel|oss|ithra)\s*:\s*([a-z]+)/i);   // anchored to real deity ids — a stray "word:word" in prose can't false-match
      let chosen = m ? legal.find((b) => b.deity === m[1].toLowerCase() && b.verb === m[2].toLowerCase()) : null;
      let src = 'supra';
      if (!chosen) {                                   // off-menu → anger-weighted legal pick
        const rank = ranking(w).filter((r) => legal.some((b) => b.deity === r.deity));
        const pick = (Math.random() < 0.75 ? rank[0] : (rank[1] || rank[0]));
        const opts = legal.filter((b) => b.deity === pick.deity);
        chosen = opts[Math.floor(Math.random() * opts.length)];
        src = 'prior';
      }
      const omen = await this.#omen(w, chosen);
      return {
        deity: chosen.deity, verb: chosen.verb, target: null,
        reason: `${src}${m ? ' ' + m[1] + ':' + m[2] : ''}`, omen,
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
      const ids = await this.tok(p);
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

// ---------------------------------------------------------------------------
// BACKEND B2 — InstructGod (in-browser instruct LLM, WebGPU/WASM), two modes:
//   mode 'choose' — the model PICKS deity:verb from the menu AND writes the omen
//                   (Qwen2.5-0.5B-Instruct does this 4/4 — a real model-driven god).
//   mode 'voice'  — a weaker model can't hold the format (SmolLM2-360M = 0/4), so
//                   the lawful oracle chooses and the model only writes the omen.
// Either way legalBids/validateBid still gate every act: capricious-but-lawful.
// ---------------------------------------------------------------------------
export class InstructGod {
  constructor(modelId = 'HuggingFaceTB/SmolLM2-360M-Instruct', opts = {}) {
    this.modelId = modelId;
    this.name = opts.name || 'LLM';
    this.mode = opts.mode || 'choose';                  // 'choose' (model picks) | 'voice' (model only speaks)
    this.ready = false;
    this.dtype = opts.dtype || 'q4f16';
    this.device = opts.device || 'webgpu';
    this.temperature = opts.temperature ?? 0.9;
    this.fallback = new HeuristicGod(7);
  }

  async load(onProgress) {
    const { AutoTokenizer, AutoModelForCausalLM } = await import(
      'https://esm.sh/@huggingface/transformers@3.7.5'
    );
    this.tok = await AutoTokenizer.from_pretrained(this.modelId);
    this.model = await AutoModelForCausalLM.from_pretrained(this.modelId, {
      dtype: this.dtype, device: this.device, progress_callback: onProgress,
    });
    this.ready = true;
  }

  // decode only the GENERATED tokens (slicing by prompt string length cuts mid-word)
  async #gen(messages, maxTok, temp, rep) {
    const prompt = this.tok.apply_chat_template(messages, { add_generation_prompt: true, tokenize: false });
    const ids = this.tok(prompt);
    const inLen = ids.input_ids.dims[ids.input_ids.dims.length - 1];
    const out = await this.model.generate({
      ...ids, max_new_tokens: maxTok, do_sample: true, temperature: temp,
      top_p: 0.92, repetition_penalty: rep,
    });
    return this.tok.decode(Array.from(out.tolist()[0]).slice(inLen), { skip_special_tokens: true }).trim();
  }

  async decide(w, legal) {
    if (!this.ready) return this.fallback.decide(w, legal);
    if (this.mode === 'choose') {
      try { return await this.#chooseAndVoice(w, legal); }
      catch (e) { console.warn('InstructGod failed, falling back:', e); return this.fallback.decide(w, legal); }
    }
    const bid = await this.fallback.decide(w, legal);             // 'voice': the oracle ALWAYS picks the act — never re-rolled
    if (bid) {
      try { bid.omen = await this.#omen(w, bid); }                // model only speaks; if even that fails, keep the bid's own canned omen
      catch (e) { console.warn('InstructGod omen failed, keeping the already-chosen act:', e); }
    }
    return bid;
  }

  // 'choose': the model reads the world, picks one act from the menu, and speaks its omen
  async #chooseAndVoice(w, legal) {
    const menu = [...new Set(legal.map((b) => `${b.deity}:${b.verb}`))];
    const tail = await this.#gen([
      { role: 'system', content: 'You are the capricious pantheon of four gods — Vurm (water, drought), Kel (war), Oss (mercy), Ithra (judgement) — acting upon a small failing valley. From the MENU pick exactly one act, then utter a single short cryptic omen. Answer EXACTLY as: deity:verb | omen' },
      { role: 'user', content: 'The valley now: the well is fouled, tension high.\nMENU: kel:raid, oss:mend\nYour act:' },
      { role: 'assistant', content: 'kel:raid | Smoke stains the dawn; the ridge has found its appetite.' },
      { role: 'user', content: `The valley now:\n${digest(w)}\nMENU: ${menu.join(', ')}\nYour act:` },
    ], 46, this.temperature, 1.1);
    const m = tail.match(/(vurm|kel|oss|ithra)\s*:\s*([a-z_]+)\s*[|\-–—:]*\s*(.*)/i);   // anchored to real deity ids, so a stray "word:word" earlier in the prose can't steal the match (and pollute the omen capture)
    let chosen = m ? legal.find((b) => b.deity === m[1].toLowerCase() && b.verb === m[2].toLowerCase()) : null;
    const reason = chosen ? this.name : 'prior';
    if (!chosen) {                                     // off-menu → anger-weighted lawful pick
      const rank = ranking(w).filter((r) => legal.some((b) => b.deity === r.deity));
      const pk = (Math.random() < 0.75 ? rank[0] : (rank[1] || rank[0]));
      const opts = legal.filter((b) => b.deity === pk.deity);
      chosen = opts[Math.floor(Math.random() * opts.length)];
    }
    let omen = (m && m[3]) ? m[3] : tail.replace(/^[a-z]+\s*:\s*[a-z_]+\s*[|\-–—:]*/i, '');
    omen = (omen || '').split('\n')[0].replace(/["]/g, '').trim();
    const letters = (omen.match(/[a-z]/gi) || []).length;
    if (omen.length < 10 || letters < omen.length * 0.6) omen = pick(OMENS[chosen.verb], Math.random);
    return { deity: chosen.deity, verb: chosen.verb, target: null, reason, omen: omen.slice(0, 160) };
  }

  // 'voice': one short prophecy for the act the oracle chose (hallucination wanted)
  async #omen(w, bid) {
    const g = PANTHEON[bid.deity];
    const ctx = `water ${w.village.water}, morale ${w.village.morale}, tension ${w.tension}`;
    let text = await this.#gen([
      { role: 'system', content: 'You are a doom-prophet of a dying valley. When a god acts, you speak ONE short, cryptic, ominous sentence of prophecy — vivid and strange. Reply with only that sentence.' },
      { role: 'user', content: 'The god of war sends raiders down from the ridge.' },
      { role: 'assistant', content: 'Smoke stains the dawn, and the ridge has found its appetite.' },
      { role: 'user', content: `${g.name}, ${g.epithet || 'the unseen'}, works "${bid.verb}" upon the valley (${ctx}).` },
    ], 32, this.temperature, 1.3);
    text = text.split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const cut = text.lastIndexOf('.'); if (cut > 12) text = text.slice(0, cut + 1);
    const letters = (text.match(/[a-z]/gi) || []).length;
    if (text.length < 12 || letters < text.length * 0.6) return pick(OMENS[bid.verb], Math.random);
    return text.slice(0, 160);
  }
}

// ---------------------------------------------------------------------------
// BACKEND C — LiveLLMGod (ConicCat/Qwen3.5-0.8B-Text-Only, via game/god_server.py)
//
// Runs a real 0.8B LLM AS the god, live. It is world-blind (measured), but the
// arbiter guarantees legality and the action space guarantees character, so a
// capricious-but-lawful god is exactly the thesis — we just want its strange voice.
//
// Needs the local server running (it can't run on a static HF Space):
//     .venv-teacher/bin/python game/god_server.py --port 8008
// If the server is absent/unreachable, it falls back to HeuristicGod, so the game
// stays playable everywhere (including the deployed static Space).
// ---------------------------------------------------------------------------
export class LiveLLMGod {
  constructor(url = 'http://localhost:8008', opts = {}) {
    this.url = url;
    this.name = 'Qwen3.5-0.8B';
    this.ready = false;
    this.fallback = new HeuristicGod(opts.seed ?? 9);
  }

  async load() {
    try {
      const r = await fetch(this.url + '/', { method: 'GET' });
      this.ready = r.ok;
    } catch {
      this.ready = false;
      throw new Error('god_server not reachable at ' + this.url);
    }
  }

  async decide(w, legal) {
    if (!this.ready) return this.fallback.decide(w, legal);
    try {
      const r = await fetch(this.url + '/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest: digest(w), legal: legal.map((b) => ({ deity: b.deity, verb: b.verb })) }),
      });
      const j = await r.json();
      const hit = legal.find((b) => b.deity === j.deity && b.verb === j.verb);
      if (!hit) return this.fallback.decide(w, legal);      // arbiter would reject anyway
      return {
        deity: hit.deity, verb: hit.verb, target: null,
        reason: j.reason || 'qwen3.5-0.8b',
        omen: j.omen || pick(OMENS[hit.verb], Math.random),
      };
    } catch {
      return this.fallback.decide(w, legal);
    }
  }
}
