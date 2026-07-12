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

import { newWorld, stepTurn, PLAYER_ACTIONS, PANTHEON, DEITY_IDS, legalBids, ranking } from '../game/engine.js';
import { HeuristicGod } from '../game/gods.js';

const GAMES = Number(process.argv.includes('--games')
  ? process.argv[process.argv.indexOf('--games') + 1] : 200);
const TEMP = 18.0; // MUST match label_heuristic() in make_dataset.py

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

// To evaluate the trained model, run this in a browser (SupraGod needs WebGPU),
// or port the scoring pass to onnxruntime-node and add it here:
//   results.push(await evaluate(() => supra, 'Supra-50M (trained)'));

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
