// eval_god.mjs — does the trained model DESERVE to exist?
//
// This is the file the whole project turns on. Everything else is scaffolding.
//
// The corpus was labelled with a Boltzmann distribution over an anger oracle (see
// train/make_dataset.py). So there is an obvious, boring, likely outcome: the model
// learns the oracle exactly, and we have spent 26MB and a training run to reimplement
// an `if` statement. It will still *look* like it's working. The game will play fine.
// You will be tempted to ship it.
//
// The model earns its place ONLY in the gap between its choices and the oracle's —
// provided the arbiter keeps that gap legal, which invariants.mjs proves it does.
//
// We measure three things, from samples alone (no model internals needed):
//
//   MI   mutual information between the world's state and the deity chosen.
//        MI ~ 0  =>  it is not reading the valley. It collapsed to a prior.
//
//   KL   divergence between the backend's empirical policy and the oracle's.
//        KL ~ 0  =>  it IS the oracle. Delete it.
//
//   H    normalised entropy of deity choice.
//        H ~ 0   =>  it always picks the same god. Broken.
//
// Run:  node test/eval_god.mjs [--games 200]

import { newWorld, stepTurn, PLAYER_ACTIONS, PANTHEON, DEITY_IDS, legalBids, ranking, digest } from '../game/engine.js';
import { HeuristicGod } from '../game/gods.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const arg = (flag, def) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : def);
const GAMES = Number(arg('--games', 200));
const TEMP = 18.0; // MUST match label_heuristic() in make_dataset.py
const BLEND = Number(arg('--blend', 1.6));  // deployed anger-prior weight — 1.6 is what gods.js ships; sweep it to see how much of "deployed" is model vs prior
const TDEP = Number(arg('--temp', 0.7));    // deployed softmax temperature

// --- paths to the trained-model scorer (the piece this file used to lack) ----
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CKPT = arg('--ckpt', join(ROOT, 'ckpt/supra-god'));
const PYTHON = arg('--python', join(ROOT, '.venv/bin/python'));
const WORKER = join(ROOT, 'test/score_worker.py');
const HAVE_MODEL = !process.argv.includes('--no-model')
  && existsSync(CKPT) && existsSync(PYTHON) && existsSync(WORKER);

// --- the oracle's own distribution over deities, for a given world -----------
function oracleDist(w) {
  const legal = legalBids(w);
  const ds = [...new Set(legal.map((b) => b.deity))];
  if (!ds.length) return null;
  const a = Object.fromEntries(ranking(w).map((r) => [r.deity, r.anger]));
  const mx = Math.max(...ds.map((d) => a[d]));
  const ws = ds.map((d) => Math.exp((a[d] - mx) / TEMP));
  const tot = ws.reduce((x, y) => x + y, 0);
  return Object.fromEntries(ds.map((d, i) => [d, ws[i] / tot]));
}

// --- information-theoretic helpers ------------------------------------------
const EPS = 1e-9;
function kl(p, q) {          // KL(p || q) over DEITY_IDS
  let s = 0;
  for (const d of DEITY_IDS) {
    const pi = (p[d] ?? 0) + EPS, qi = (q[d] ?? 0) + EPS;
    if (pi > EPS) s += pi * Math.log(pi / qi);
  }
  return s;
}
function entropy(p) {
  let s = 0;
  for (const d of DEITY_IDS) { const pi = p[d] ?? 0; if (pi > 0) s -= pi * Math.log(pi); }
  return s;
}
function norm(counts) {
  const tot = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(DEITY_IDS.map((d) => [d, (counts[d] ?? 0) / tot]));
}
const zeros = () => Object.fromEntries(DEITY_IDS.map((d) => [d, 0]));

// --- a control: a god that ignores the world entirely ------------------------
class RandomGod {
  constructor(s) { this.s = s; this.name = 'Random (control)'; }
  rnd() { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s / 0x7fffffff; }
  async decide(w, legal) {
    const b = legal[Math.floor(this.rnd() * legal.length)];
    return b ? { ...b, omen: '', reason: 'noise' } : null;
  }
}

// --- a control: the oracle itself, played straight (argmax, no caprice) -------
class OracleGod {
  constructor() { this.name = 'Oracle (argmax)'; }
  async decide(w, legal) {
    const a = Object.fromEntries(ranking(w).map((r) => [r.deity, r.anger]));
    const ds = [...new Set(legal.map((b) => b.deity))];
    if (!ds.length) return null;
    const d = ds.reduce((x, y) => (a[x] >= a[y] ? x : y));
    const opts = legal.filter((b) => b.deity === d);
    return { ...opts[0], omen: '', reason: 'argmax' };
  }
}

// --- the trained model, scored on the GPU by test/score_worker.py -----------
// The browser scores bids in transformers.js/WebGPU (SupraGod.#scoreBids). Node
// has neither, so we keep engine.js authoritative here and offload ONLY the
// forward pass to a persistent Python worker holding the fine-tuned checkpoint.
// One process, shared across every game; requests are serialised (the game loop
// awaits each decide), so a FIFO queue matches replies to requests.
class ModelScorer {
  constructor(ckpt) {
    this.proc = spawn(PYTHON, [WORKER, '--ckpt', ckpt], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.q = [];
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const r = this.q.shift();
      if (!r) return;
      r.resolve(line === 'READY' ? 'READY' : JSON.parse(line).lps);
    });
    this.proc.on('exit', (code) => { for (const r of this.q) r.reject(new Error(`worker exited ${code}`)); this.q = []; });
  }
  #req(payload) {
    return new Promise((resolve, reject) => { this.q.push({ resolve, reject }); this.proc.stdin.write(payload + '\n'); });
  }
  ready() { return this.#req('PING'); }
  score(prompt, conts) { return this.#req(JSON.stringify({ prompt, conts })); }
  close() { try { this.proc.stdin.end(); this.proc.kill(); } catch {} }
}

// Mirror SupraGod.#prompt(w) from game/gods.js byte-for-byte: we are evaluating
// the DEPLOYED policy, so it must see exactly the prompt the browser feeds it.
function supraPrompt(w) {
  const led = w.ledger.slice(-4).map((e) => `t${e.turn} ${e.deity} ${e.verb} :: ${e.reason}`).join('\n') || 'the ledger is empty';
  return [
    'You are the pantheon over a small valley. You perceive only this:',
    digest(w), '',
    'The ledger of what you have already done (your past binds you):',
    led, '',
    'The next act is:', '',
  ].join('\n');
}

// Two model backends, sharing one scorer:
//   deployed  — the exact shipped blend (lp + 1.6·anger-prior) + softmax sample.
//               This is what a player actually gets.
//   argmax    — pure model, no anger prior, argmax over lp. Isolates what the
//               MODEL alone learned, directly comparable to Oracle (argmax anger).
//               If THIS collapses onto the oracle, the weights are a lookup table
//               no matter how the deployed blend flatters the numbers.
class SupraGodEval {
  constructor(scorer, seed, { blend, argmax }) {
    this.scorer = scorer; this.blend = blend; this.argmax = argmax;
    this.name = argmax ? 'Supra-50M (argmax lp)' : `Supra-50M (deployed b=${blend} T=${TDEP})`;
    this.s = (seed >>> 0) || 1;
  }
  rnd() { // mulberry32, mirrors gods.js
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  async decide(w, legal) {
    const lps = await this.scorer.score(supraPrompt(w), legal.map((b) => `${b.deity}:${b.verb}`));
    const anger = Object.fromEntries(ranking(w).map((r) => [r.deity, r.anger]));
    const maxAnger = Math.max(1, ...Object.values(anger).map(Math.abs));
    const util = legal.map((b, i) => ({
      b, lp: lps[i], u: lps[i] + (this.blend ? (anger[b.deity] / maxAnger) * this.blend : 0),
    }));
    let idx;
    if (this.argmax) {
      idx = util.reduce((best, x, i) => (x.u > util[best].u ? i : best), 0);
    } else {
      const T = TDEP, mx = Math.max(...util.map((x) => x.u));
      const exps = util.map((x) => Math.exp((x.u - mx) / T));
      const tot = exps.reduce((a, c) => a + c, 0);
      let r = this.rnd() * tot; idx = exps.length - 1;
      for (let i = 0; i < exps.length; i++) { r -= exps[i]; if (r <= 0) { idx = i; break; } }
    }
    const c = util[idx];
    return { ...c.b, target: null, reason: `lp ${c.lp.toFixed(2)} · anger ${anger[c.b.deity].toFixed(0)}`, omen: '' };
  }
}

// ---------------------------------------------------------------------------
async function evaluate(makeGod, label) {
  // Bucket each decision by which deity the oracle *would* have favoured.
  // If the backend's choice is independent of this bucket, it isn't reading
  // the world — that's the mutual-information test.
  const joint = Object.fromEntries(DEITY_IDS.map((b) => [b, zeros()])); // bucket -> chosen counts
  const perBucketOracle = Object.fromEntries(DEITY_IDS.map((b) => [b, zeros()]));
  const bucketN = zeros();
  let acts = 0;

  for (let g = 0; g < GAMES; g++) {
    const god = makeGod(g + 1);
    const w = newWorld(g + 1);
    let rnd = g + 1;
    const nextRnd = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
    const ACTIONS = [...Object.keys(PLAYER_ACTIONS), 'offer'];

    while (!w.over) {
      const od = oracleDist(w);
      const before = w.ledger.length;
      const bucket = od ? DEITY_IDS.reduce((x, y) => ((od[x] ?? -1) >= (od[y] ?? -1) ? x : y)) : null;

      await stepTurn(w, ACTIONS[Math.floor(nextRnd() * ACTIONS.length)],
                     DEITY_IDS[Math.floor(nextRnd() * 4)], god);

      if (w.ledger.length > before && bucket && od) {
        const chosen = w.ledger.at(-1).deity;
        joint[bucket][chosen] += 1;
        bucketN[bucket] += 1;
        for (const d of DEITY_IDS) perBucketOracle[bucket][d] += od[d] ?? 0;
        acts += 1;
      }
    }
  }

  // marginal policy
  const marg = zeros();
  for (const b of DEITY_IDS) for (const d of DEITY_IDS) marg[d] += joint[b][d];
  const pMarg = norm(marg);

  // KL(policy || oracle), averaged over buckets, weighted by bucket frequency
  let KL = 0, MI = 0;
  const totN = Object.values(bucketN).reduce((a, b) => a + b, 0) || 1;
  for (const b of DEITY_IDS) {
    if (!bucketN[b]) continue;
    const wgt = bucketN[b] / totN;
    const pB = norm(joint[b]);                                    // policy | bucket
    const qB = norm(perBucketOracle[b]);                          // oracle | bucket
    KL += wgt * kl(pB, qB);
    MI += wgt * kl(pB, pMarg);   // I(choice; bucket) = E_b[ KL(p(.|b) || p(.)) ]
  }

  const H = entropy(pMarg) / Math.log(DEITY_IDS.length);          // normalised 0..1
  return { label, acts, pMarg, KL, MI, H };
}

// ---------------------------------------------------------------------------
function report(r) {
  const spread = DEITY_IDS.map((d) =>
    `${PANTHEON[d].name.split(',')[0].padEnd(6)} ${(r.pMarg[d] * 100).toFixed(0).padStart(3)}%`).join('  ');
  console.log(`\n── ${r.label} ${'─'.repeat(Math.max(0, 46 - r.label.length))}`);
  console.log(`   acts ${r.acts}`);
  console.log(`   spread   ${spread}`);
  console.log(`   H(choice)  ${r.H.toFixed(3)}   (0 = always one god · 1 = uniform)`);
  console.log(`   MI(world)  ${r.MI.toFixed(3)}   (0 = ignoring the valley)`);
  console.log(`   KL(oracle) ${r.KL.toFixed(3)}   (0 = it IS the oracle)`);
}

console.log(`evaluating over ${GAMES} games per backend…`);

const results = [];
results.push(await evaluate(() => new OracleGod(),        'Oracle (argmax)'));
results.push(await evaluate((s) => new HeuristicGod(s),   'Heuristic (baseline)'));
results.push(await evaluate((s) => new RandomGod(s),      'Random (control)'));

// The trained model — the backend this file used to have a TODO for. Scored on
// the GPU by test/score_worker.py, so no browser/WebGPU needed. Two views:
// what the model alone prefers (argmax lp) and what actually ships (blended).
let deployed = null, argmaxed = null;
if (HAVE_MODEL) {
  console.log(`\nloading trained checkpoint on GPU (${CKPT}) …`);
  const scorer = new ModelScorer(CKPT);
  try {
    await scorer.ready();  // block until the checkpoint is resident on the GPU
    argmaxed = await evaluate((s) => new SupraGodEval(scorer, s, { blend: 0,     argmax: true  }), 'Supra-50M (argmax lp)');
    deployed = await evaluate((s) => new SupraGodEval(scorer, s, { blend: BLEND, argmax: false }), `Supra-50M (deployed, blend ${BLEND} T ${TDEP})`);
    results.push(argmaxed, deployed);
  } finally {
    scorer.close();
  }
} else {
  console.log('\n[no trained checkpoint found — showing reference backends only.'
    + '\n run the training runbook, or pass --ckpt <dir> --python <venv-python>, to score the model.]');
}

results.forEach(report);

const oracle = results[0], heur = results[1], rand = results[2];

console.log(`\n${'═'.repeat(58)}`);
console.log('READING THE NUMBERS');
console.log(`${'═'.repeat(58)}`);
console.log(`
The three rows above are your reference frame — measure the trained model
against THEM, not against a feeling that it "seems to work."

  Heuristic KL ${heur.KL.toFixed(3)}  MI ${heur.MI.toFixed(3)}   <- THE FLOOR. This is the oracle, sampled. "No model" looks
                              like this. The model must move AWAY from this KL
                              while holding MI.
  Oracle    KL ${oracle.KL.toFixed(3)}  MI ${oracle.MI.toFixed(3)}   <- the deterministic extreme (argmax, no caprice).
                              High KL *and* high MI — but it is a pure function.
  Random    KL ${rand.KL.toFixed(3)}  MI ${rand.MI.toFixed(3)}   <- high KL and yet WORTHLESS. This is why KL alone is not
                              the test: noise also diverges from the oracle.
                              MI is what separates a god from a dice roll.

VERDICT RULES for Supra-50M:

  KL <= ${(heur.KL + 0.05).toFixed(2)}  and MI ~ ${heur.MI.toFixed(2)}
      -> It has become the oracle. You reimplemented an if-statement in 26MB.
         DELETE THE MODEL. This is the likeliest outcome and the easiest to
         rationalise away after you've spent a day training it. Don't.

  MI  <  ${(rand.MI + 0.05).toFixed(2)}
      -> It collapsed to a prior. It is not reading the valley, it just learned
         which god is angriest on average. Check the spread: one deity >60% is
         the tell. Fix: more epochs, or the digest isn't reaching the model.

  H   <  0.4
      -> It always picks the same god. Broken regardless of KL.

  KL noticeably ABOVE the heuristic, MI still healthy
      -> THAT IS THE GOD. It reads the world and then disagrees with the oracle.
         The disagreement is the entire product. Ship it.

If it lands in the first case: raise the Boltzmann temperature in
label_heuristic() (currently /18.0 — that is the dial controlling how much
caprice is in the training signal), or use --mode teacher so the labels come
from something with opinions instead of arithmetic.

Do not try to make the model smarter. Make it stranger, but bounded.
`);

// ---------------------------------------------------------------------------
// COMPUTED VERDICT — apply the rules above to the actual trained model.
// ---------------------------------------------------------------------------
function maxShare(r) { return Math.max(...DEITY_IDS.map((d) => r.pMarg[d])); }
function topDeity(r) { return DEITY_IDS.reduce((a, b) => (r.pMarg[a] >= r.pMarg[b] ? a : b)); }

function verdict(r) {
  const share = maxShare(r), floor = heur.KL;
  if (r.H < 0.4)                    return ['BROKEN',    `always ${PANTHEON[topDeity(r)].name.split(',')[0]} — H=${r.H.toFixed(2)} < 0.4`];
  if (share > 0.60)                 return ['COLLAPSED', `${PANTHEON[topDeity(r)].name.split(',')[0]} ${(share*100)|0}% of acts — learned who's angriest on average, stopped reading`];
  if (r.MI < rand.MI + 0.05)        return ['COLLAPSED', `MI=${r.MI.toFixed(2)} ~ random (${rand.MI.toFixed(2)}) — not reading the valley`];
  if (r.KL <= floor + 0.05)         return ['REDUNDANT', `KL=${r.KL.toFixed(2)} ~ heuristic floor (${floor.toFixed(2)}) — it IS the oracle. Delete it.`];
  return ['THE GOD', `KL=${r.KL.toFixed(2)} vs floor ${floor.toFixed(2)} (+${(r.KL-floor).toFixed(2)}) with MI=${r.MI.toFixed(2)} healthy — reads the valley, then disagrees. The disagreement is the product.`];
}

if (HAVE_MODEL && deployed && argmaxed) {
  console.log(`${'═'.repeat(58)}`);
  console.log('COMPUTED VERDICT (this run)');
  console.log(`${'═'.repeat(58)}\n`);
  const row = (label, r) => {
    const [tag, why] = verdict(r);
    console.log(`  ${label.padEnd(22)} KL ${r.KL.toFixed(2)}  MI ${r.MI.toFixed(2)}  H ${r.H.toFixed(2)}  top ${(maxShare(r)*100|0)}%`);
    console.log(`  ${' '.repeat(22)} → ${tag}: ${why}\n`);
  };
  console.log(`  reference floor (Heuristic):  KL ${heur.KL.toFixed(2)}  MI ${heur.MI.toFixed(2)}  H ${heur.H.toFixed(2)}\n`);
  row('Supra-50M argmax lp', argmaxed);
  row('Supra-50M deployed', deployed);

  const [tag] = verdict(argmaxed);
  console.log(`${'─'.repeat(58)}`);
  console.log(tag === 'THE GOD'
    ? '  HEADLINE: the model alone (no anger blend) already diverges from the\n'
      + '  oracle while still tracking the world. It earns its 50M parameters.'
    : `  HEADLINE: model-alone verdict is ${tag}. Read the rules above before shipping.`);
  console.log(`${'─'.repeat(58)}`);
}
