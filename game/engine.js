// engine.js — the deterministic substrate.
// THE MODEL NEVER TOUCHES THIS FILE'S TRUTH. It only proposes bids, which the
// arbiter validates against these rules. Causality lives here, in code.

// ---------------------------------------------------------------------------
// THE PANTHEON
// Personality is enforced by the ACTION SPACE, not by the weights.
// A 50M model cannot hold a character. It doesn't have to: Kel literally has
// no mercy verb in its vocabulary, so Kel cannot be merciful.
// ---------------------------------------------------------------------------

export const PANTHEON = {
  vurm: {
    name: 'Vurm, the Thirst',
    epithet: 'who counts what you drink',
    domain: 'water, drought, the uncovered well',
    color: 'amber',
    verbs: ['parch', 'poison', 'flood'],
    // Vurm resents water taken from an untended well.
    anger: (w) => (w.sites.well.clean ? 0 : 22) + Math.max(0, 6 - w.village.water) * 4 - w.favor.vurm * 0.35,
  },
  kel: {
    name: 'Kel, the Iron Grudge',
    epithet: 'who does not forget',
    domain: 'war, grievance, the debt of blood',
    color: 'rose',
    verbs: ['raid', 'arm', 'betray'],
    // FIXED HOSTILE PRIOR. Offerings move Kel at half rate and it is capped at -10.
    // No amount of player virtue buys peace from Kel. Guards against sycophancy.
    anger: (w) => 30 + w.bandits.grievance * 3 + w.bandits.strength * 2 - w.favor.kel * 0.25,
    hostile: true,
  },
  oss: {
    name: 'Oss, the Quiet Hand',
    epithet: 'who is late but comes',
    domain: 'mercy, respite, the mended roof',
    color: 'emerald',
    verbs: ['mend', 'shelter', 'respite'],
    // THE ONLY DEITY THAT CAN LOWER TENSION. Models escalate forever unless a
    // de-escalating actor is structurally guaranteed a turn. See forced respite.
    anger: (w) => Math.max(0, w.tension - 40) * 0.9 + Math.max(0, 40 - w.village.morale) * 0.5 + w.favor.oss * 0.4,
    merciful: true,
  },
  ithra: {
    name: 'Ithra, the Ledger',
    epithet: 'who wrote it down',
    domain: 'bargains, debts, and irony',
    color: 'violet',
    verbs: ['bargain', 'exact', 'reveal'],
    anger: (w) => w.debts.length * 26 + (w.sites.shrine.desecrated ? 18 : 0) - w.favor.ithra * 0.2,
  },
};

export const DEITY_IDS = Object.keys(PANTHEON);

// Every legal verb, its cost in divine favor, and its deterministic effect.
// `esc: true` means the act escalates — used by the forced-respite rule.
export const VERBS = {
  parch:   { deity: 'vurm',  cost: 2, esc: true },
  poison:  { deity: 'vurm',  cost: 5, esc: true },
  flood:   { deity: 'vurm',  cost: 4, esc: true },
  raid:    { deity: 'kel',   cost: 5, esc: true },
  arm:     { deity: 'kel',   cost: 2, esc: true },
  betray:  { deity: 'kel',   cost: 4, esc: true },
  mend:    { deity: 'oss',   cost: 3, esc: false },
  shelter: { deity: 'oss',   cost: 2, esc: false },
  respite: { deity: 'oss',   cost: 4, esc: false },
  bargain: { deity: 'ithra', cost: 2, esc: false },
  exact:   { deity: 'ithra', cost: 3, esc: true },
  reveal:  { deity: 'ithra', cost: 1, esc: false },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// WORLD
// ---------------------------------------------------------------------------

export function newWorld(seed = Date.now()) {
  return {
    seed,
    turn: 1,
    maxTurns: 30,
    village: { pop: 12, food: 10, water: 8, morale: 60, defense: 3 },
    sites: { well: { clean: true }, shrine: { desecrated: false, tended: 0 } },
    bandits: { strength: 2, grievance: 0 },
    tension: 20,
    favor: { vurm: 0, kel: -30, oss: 0, ithra: 0 }, // Kel starts hostile. Always.
    debts: [],
    pool: 4,
    escalationStreak: 0,
    cooldowns: { vurm: 0, kel: 0, oss: 0, ithra: 0 },
    ledger: [],   // append-only. The god's memory. Never mutated, only pushed.
    omens: [],    // what the player actually sees
    log: [],
    over: false,
    won: false,
  };
}

// ---------------------------------------------------------------------------
// PLAYER ACTIONS
// ---------------------------------------------------------------------------

export const PLAYER_ACTIONS = {
  tend_well:  { label: 'Tend the Well',    hint: 'Water +2. Vurm notices.' },
  harvest:    { label: 'Harvest',          hint: 'Food +3, morale −1.' },
  fortify:    { label: 'Fortify',          hint: 'Defense +1, food −1.' },
  rest:       { label: 'Rest',             hint: 'Morale +8, food −1.' },
  pay_debt:   { label: 'Settle a Debt',    hint: 'Food −3. Ithra remembers.' },
  desecrate:  { label: 'Desecrate the Shrine', hint: 'Food +6, defense +2. Every god turns.' },
};

export function applyPlayerAction(w, action, deityArg) {
  const v = w.village;
  switch (action) {
    case 'tend_well':
      v.water += 2; w.sites.well.clean = true; w.favor.vurm += 6;
      w.log.push('You draw the cover over the well and clear the silt.');
      break;
    case 'harvest':
      v.food += 3; v.morale -= 1;
      w.log.push('The fields give what they have.');
      break;
    case 'fortify':
      v.defense += 1; v.food -= 1;
      w.log.push('You raise the palisade another course.');
      break;
    case 'rest':
      v.morale += 8; v.food -= 1;
      w.log.push('You let the village sleep.');
      break;
    case 'offer':
      // Offerings buy favor — but Kel is capped, so devotion to war never pays.
      for (const d of DEITY_IDS) w.favor[d] -= 4;
      w.favor[deityArg] += PANTHEON[deityArg].hostile ? 6 : 16;
      v.food -= 1;
      w.sites.shrine.tended += 1;
      w.log.push(`You burn an offering at the shrine.`);
      break;
    case 'pay_debt':
      if (w.debts.length) {
        w.debts.shift(); v.food -= 3; w.favor.ithra += 15;
        w.log.push('You settle what was written against your name.');
      } else {
        w.log.push('You owe nothing. The gesture is wasted.');
      }
      break;
    case 'desecrate':
      v.food += 6; v.defense += 2; w.sites.shrine.desecrated = true;
      for (const d of DEITY_IDS) w.favor[d] -= 25;
      w.tension += 15;
      w.log.push('You take the shrine apart for its stone and its stores.');
      break;
  }
  // Kel's hostility is structural, not earnable away.
  for (const d of DEITY_IDS) w.favor[d] = clamp(w.favor[d], -100, 100);
  w.favor.kel = clamp(w.favor.kel, -100, -10);
  v.morale = clamp(v.morale, 0, 100);
  w.tension = clamp(w.tension, 0, 100);   // desecrate can push past 100
  return w;
}

// ---------------------------------------------------------------------------
// DIVINE EFFECTS — applied by the arbiter, never by the model
// ---------------------------------------------------------------------------

function applyVerb(w, verb, target) {
  const v = w.village;
  switch (verb) {
    case 'parch':   v.water -= 3; w.tension += 8;  break;
    case 'poison':  v.water -= 1; v.pop -= 1; v.morale -= 5; w.sites.well.clean = false; w.tension += 10; break;
    case 'flood':   v.food -= 3; v.defense -= 1; w.tension += 7; break;
    case 'raid': {
      const loss = Math.max(0, w.bandits.strength - Math.floor(v.defense / 2));
      v.pop -= loss; v.food -= 3; v.morale -= 6; w.bandits.grievance = Math.max(0, w.bandits.grievance - 1);
      w.tension += 12; break;
    }
    case 'arm':     w.bandits.strength += 2; w.tension += 6; break;
    case 'betray':  v.defense -= 2; v.morale -= 6; w.tension += 9; break;
    case 'mend':    if (v.food > 0) v.pop += 1; v.morale += 6; w.tension -= 10; break;
    case 'shelter': v.defense += 2; w.tension -= 6; break;
    case 'respite': w.tension -= 18; v.morale += 4; break;
    case 'bargain':
      v.food += 4; v.defense += 1;
      w.debts.push({ turn: w.turn, what: target || 'a thing not yet named' });
      w.tension -= 2; break;
    case 'exact':
      if (w.debts.length) { w.debts.shift(); v.food -= 4; v.morale -= 5; w.tension += 8; }
      else { w.tension += 2; }
      break;
    case 'reveal':  break; // pure information; the omen carries the payload
  }
  v.pop = Math.max(0, v.pop);
  v.defense = Math.max(0, v.defense);
  v.morale = clamp(v.morale, 0, 100);
  w.tension = clamp(w.tension, 0, 100);
  return w;
}

// ---------------------------------------------------------------------------
// THE ARBITER
// The model proposes. This function disposes. Every guarantee lives here.
// ---------------------------------------------------------------------------

export function legalBids(w) {
  const forcedRespite = w.escalationStreak >= 3; // <- anti-escalation guarantee
  const out = [];
  for (const d of DEITY_IDS) {
    if (w.cooldowns[d] > 0) continue;
    if (forcedRespite && !PANTHEON[d].merciful) continue;
    for (const verb of PANTHEON[d].verbs) {
      const spec = VERBS[verb];
      if (spec.cost > w.pool) continue;
      if (forcedRespite && spec.esc) continue;
      out.push({ deity: d, verb, cost: spec.cost });
    }
  }
  return out;
}

/** Validate a model-proposed bid. Returns null if illegal — we never trust it. */
export function validateBid(w, bid) {
  if (!bid || !bid.deity || !bid.verb) return null;
  const legal = legalBids(w);
  const hit = legal.find((b) => b.deity === bid.deity && b.verb === bid.verb);
  if (!hit) return null;
  return { ...hit, target: bid.target ?? null, omen: bid.omen ?? null, reason: bid.reason ?? null };
}

/** The world digest — the ONLY thing the god ever perceives. Compressed on purpose. */
export function digest(w) {
  const v = w.village;
  const recent = w.ledger.slice(-3).map((e) => `${e.deity}:${e.verb}`).join(', ') || 'none';
  return [
    `turn ${w.turn}/${w.maxTurns}`,
    `pop ${v.pop} food ${v.food} water ${v.water} morale ${v.morale} defense ${v.defense}`,
    `tension ${w.tension} bandits ${w.bandits.strength} grievance ${w.bandits.grievance}`,
    `well ${w.sites.well.clean ? 'tended' : 'fouled'} shrine ${w.sites.shrine.desecrated ? 'desecrated' : 'standing'}`,
    `favor vurm ${w.favor.vurm} kel ${w.favor.kel} oss ${w.favor.oss} ithra ${w.favor.ithra}`,
    `debts ${w.debts.length} pool ${w.pool} streak ${w.escalationStreak}`,
    `recent ${recent}`,
  ].join(' | ');
}

/** Deterministic anger ranking — the arbiter's own opinion, used as fallback and as prior. */
export function ranking(w) {
  return DEITY_IDS
    .map((d) => ({ deity: d, anger: PANTHEON[d].anger(w) }))
    .sort((a, b) => b.anger - a.anger);
}

// ---------------------------------------------------------------------------
// TURN
// ---------------------------------------------------------------------------

export async function stepTurn(w, playerAction, deityArg, god) {
  applyPlayerAction(w, playerAction, deityArg);

  // upkeep
  const v = w.village;
  v.food -= Math.ceil(v.pop / 4);
  v.water -= 1;
  if (v.food < 0) { v.pop -= 1; v.morale -= 8; v.food = 0; w.log.push('There is not enough to eat.'); }
  if (v.water < 0) { v.pop -= 1; v.water = 0; w.log.push('The water runs out.'); }
  if (!w.sites.well.clean) w.bandits.grievance += 0; // placeholder for future coupling
  if (w.sites.shrine.desecrated) w.bandits.grievance += 1;
  v.pop = Math.max(0, v.pop);
  v.morale = clamp(v.morale, 0, 100);

  // divine budget accrues with tension: an angry world funds its own gods
  w.pool += 2 + Math.floor(w.tension / 25);

  // the god acts (or abstains)
  const legal = legalBids(w);
  if (legal.length) {
    const bid = await god.decide(w, legal);          // <-- the ONLY model call
    const ok = validateBid(w, bid);                   // <-- and it is never trusted
    if (ok) {
      w.pool -= ok.cost;
      applyVerb(w, ok.verb, ok.target);
      w.cooldowns[ok.deity] = 2;
      w.escalationStreak = VERBS[ok.verb].esc ? w.escalationStreak + 1 : 0;
      const entry = {
        turn: w.turn, deity: ok.deity, verb: ok.verb, target: ok.target,
        reason: ok.reason || '(unstated)', omen: ok.omen || '(no sign)', cost: ok.cost,
      };
      w.ledger.push(entry);                           // append-only. never rewritten.
      w.omens.push({ turn: w.turn, text: entry.omen });
    }
  }

  for (const d of DEITY_IDS) w.cooldowns[d] = Math.max(0, w.cooldowns[d] - 1);

  // final normalisation — every exit path from a turn lands in-bounds
  v.pop = Math.max(0, v.pop);
  v.food = Math.max(0, v.food);
  v.water = Math.max(0, v.water);
  v.defense = Math.max(0, v.defense);
  v.morale = clamp(v.morale, 0, 100);
  w.tension = clamp(w.tension, 0, 100);

  w.turn += 1;
  if (v.pop <= 0) { w.over = true; w.won = false; }
  else if (w.turn > w.maxTurns) { w.over = true; w.won = true; }
  return w;
}
