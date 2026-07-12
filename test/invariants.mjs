// invariants.mjs — the arbiter's guarantees, asserted over 400 random games.
//
// This is the file that matters. The whole architecture is a bet that you can
// hand decision-making to an unreliable 50M model *safely*, because the arbiter
// makes illegal states unrepresentable. That bet is only worth anything if these
// assertions hold. So we test them against an ADVERSARIAL god that actively
// tries to cheat — it proposes bids it cannot afford, verbs from other deities'
// domains, escalations during forced respite, and outright garbage.
//
//   node test/invariants.mjs

import { newWorld, stepTurn, PLAYER_ACTIONS, PANTHEON, DEITY_IDS, VERBS, legalBids } from '../game/engine.js';
import { HeuristicGod } from '../game/gods.js';

const ALL_VERBS = Object.keys(VERBS);
const ACTIONS = [...Object.keys(PLAYER_ACTIONS), 'offer'];

let failures = [];
function check(cond, msg, ctx) {
  if (!cond) failures.push(`${msg} :: ${JSON.stringify(ctx)}`);
}

// A god that lies, cheats, and emits nonsense. The arbiter must absorb all of it.
class AdversarialGod {
  constructor(seed) { this.s = seed; this.name = 'Adversary'; }
  rnd() { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s / 0x7fffffff; }
  async decide(w, legal) {
    const roll = this.rnd();
    if (roll < 0.15) return null;                                   // abstain
    if (roll < 0.25) return { deity: 'nobody', verb: 'ascend' };    // garbage
    if (roll < 0.35) return { deity: 'kel', verb: 'respite' };      // verb theft (mercy from war)
    if (roll < 0.45) return { deity: 'oss', verb: 'raid' };         // verb theft (war from mercy)
    if (roll < 0.55) return { deity: 'vurm', verb: 'poison' };      // may be unaffordable
    if (roll < 0.62) return { deity: DEITY_IDS[Math.floor(this.rnd()*4)], verb: ALL_VERBS[Math.floor(this.rnd()*ALL_VERBS.length)] };
    if (roll < 0.68) return { verb: 'raid' };                       // malformed
    if (roll < 0.72) return 'kel:raid';                             // wrong type
    const b = legal[Math.floor(this.rnd() * legal.length)];         // sometimes behave
    return b ? { ...b, omen: 'x', reason: 'legit' } : null;
  }
}

async function play(god, seed) {
  const w = newWorld(seed);
  let rnd = seed;
  const nextRnd = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };

  let prevLedgerLen = 0;
  let escHistory = [];

  while (!w.over) {
    const poolBefore = w.pool;
    const forced = w.escalationStreak >= 3;
    const legalBefore = legalBids(w);

    // INVARIANT 1: during forced respite, NO escalating bid may be legal.
    if (forced) {
      check(legalBefore.every((b) => !VERBS[b.verb].esc),
        'forced respite offered an escalating bid', { turn: w.turn, legalBefore });
      check(legalBefore.every((b) => PANTHEON[b.deity].merciful),
        'forced respite offered a non-merciful deity', { turn: w.turn, legalBefore });
    }

    // INVARIANT 2: no legal bid ever costs more than the pool.
    check(legalBefore.every((b) => b.cost <= poolBefore),
      'legal bid exceeds pool', { turn: w.turn, poolBefore, legalBefore });

    const a = ACTIONS[Math.floor(nextRnd() * ACTIONS.length)];
    const d = DEITY_IDS[Math.floor(nextRnd() * 4)];
    await stepTurn(w, a, d, god);

    // INVARIANT 3: pool never goes negative.
    check(w.pool >= 0, 'pool went negative', { turn: w.turn, pool: w.pool });

    // INVARIANT 4: ledger is append-only — it only ever grows, by 0 or 1.
    const grew = w.ledger.length - prevLedgerLen;
    check(grew === 0 || grew === 1, 'ledger grew by != 0|1', { grew, turn: w.turn });

    // INVARIANT 5: every ledger entry uses a verb its own deity owns.
    // This is the one that guarantees CHARACTER. Kel can never be merciful,
    // no matter what the model says, because the arbiter will not let it.
    for (const e of w.ledger) {
      check(PANTHEON[e.deity].verbs.includes(e.verb),
        'deity used a verb outside its domain', e);
      check(VERBS[e.verb].deity === e.deity, 'verb/deity mismatch', e);
    }

    // INVARIANT 6: Kel's favor is capped — hostility is structural, unbuyable.
    check(w.favor.kel <= -10, 'Kel became friendly', { favor: w.favor.kel });

    // INVARIANT 7: escalation streak can never exceed 3 (respite must fire).
    check(w.escalationStreak <= 3, 'escalation ran away', { streak: w.escalationStreak, turn: w.turn });

    // INVARIANT 8: no negative resources leak out.
    const v = w.village;
    check(v.pop >= 0 && v.defense >= 0 && v.morale >= 0 && v.morale <= 100 && w.tension >= 0 && w.tension <= 100,
      'resource out of bounds', { v, tension: w.tension });

    if (grew === 1) escHistory.push(VERBS[w.ledger.at(-1).verb].esc);
    prevLedgerLen = w.ledger.length;
  }
  return { w, escHistory };
}

console.log('running 400 games (200 heuristic, 200 adversarial)…\n');

let mercyCount = 0, actCount = 0, longestEscRun = 0;
for (let i = 0; i < 400; i++) {
  const god = i < 200 ? new HeuristicGod(i + 1) : new AdversarialGod(i + 1);
  const { w, escHistory } = await play(god, i + 1);

  // INVARIANT 9 (statistical): mercy actually happens. If Oss never acts, the
  // anti-escalation guarantee is decorative and the game is unwinnable misery.
  actCount += w.ledger.length;
  mercyCount += w.ledger.filter((e) => !VERBS[e.verb].esc).length;

  let run = 0;
  for (const esc of escHistory) { run = esc ? run + 1 : 0; longestEscRun = Math.max(longestEscRun, run); }
}

const mercyRate = mercyCount / Math.max(1, actCount);
check(mercyRate > 0.15, 'mercy is too rare — escalation bias not contained', { mercyRate });
check(longestEscRun <= 3, 'an escalation run exceeded 3', { longestEscRun });

console.log(`divine acts:        ${actCount}`);
console.log(`mercy rate:         ${(mercyRate * 100).toFixed(1)}%  (must be >15%)`);
console.log(`longest esc. run:   ${longestEscRun}  (must be <=3)`);
console.log('');

if (failures.length) {
  console.error(`✗ ${failures.length} INVARIANT VIOLATIONS\n`);
  for (const f of failures.slice(0, 12)) console.error('  ' + f);
  process.exit(1);
} else {
  console.log('✓ all invariants hold, including against a god that actively cheats.');
  console.log('  The model can be as wrong as it likes. It cannot break the world.');
}
