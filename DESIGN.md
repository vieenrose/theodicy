# THEODICY — design doc (the adventure layer)

Status: **proposal / in progress.** The god-sim core (engine, arbiter, invariants, trained
policy, ONNX build) is done and green. This doc absorbs the expansion — story, map, combat,
leveling, a competence/magic tree — into that core **without discarding its thesis**.

Inspirations named by Luigi: **Baldur's Gate 3** (story, companions, tactical combat, a real
world you move through) and **Final Fantasy XII** (the License Board; the Gambit system;
Active Dimension Battle — real-time-with-pause that *feels* like an RTS without being one).

> The single most important design fact, and why FF12 is the perfect reference:
> **FF12 Gambits are exactly this project's engine.** A gambit is `condition → score a menu of
> legal actions → act`. Our god is `world digest → score `legalBids()` → act`. They are the
> same machine. So combat AI, companion AI, and the gods can *all* run on one policy substrate —
> the thing we already built and tested. The trained Supra model becomes a gambit brain.

---

## 0. The spine we do NOT break

Three invariants make this project what it is. Every system below is built to respect them:

1. **The engine owns all truth.** Models never mutate the world; they propose bids, the arbiter
   (`validateBid`) disposes. Combat, leveling, spells — all resolve in `engine.js`.
2. **Personality lives in the action space, not the weights.** A unit/god *is* the verbs it may
   legally use. Kel has no mercy verb, so Kel cannot be merciful — no matter what any model says.
3. **`test/invariants.mjs` is the safety case.** Any new actor (enemy, companion, spell) enters
   through `legalBids()` and is proven safe against an adversarial policy before it ships.

---

## 1. World & geography

The map (`game/scene.js`, live in the app) is the board. Its geography is the pantheon made
literal — each god *is* a place:

| Region | God | Domain | On the map |
|---|---|---|---|
| **The Thirsting Well** (river) | Vurm, the Thirst | water, drought, the fouled well | amber, west |
| **The Grudge Ridge** (mountains) | Kel, the Iron Grudge | war, bandits, blood-debt | rose, north — bandit fires scale with strength |
| **Oss's Refuge** (hollow) | Oss, the Quiet Hand | mercy, shelter, the mended roof | emerald, south-west |
| **The Ledger Shrine** | Ithra, the Ledger | bargains, debts, irony | violet, east — cracks when desecrated |
| **Aldermere** (the village) | — | the mortals in the middle | center — grows with population |

Beyond the vale (the campaign's outer acts): **the Drowned March** (Vurm's flooded lowland),
**the Ashfields** (where Kel's last war ended), **the Almshold** (Oss's ruined sanctuary),
**the Counting-House** (Ithra's debt-court). These are unlocked as the story pushes outward.

Everything on the map is already **state-reactive**: fouled well runs green, tension reddens the
sky, each domain-sigil glows by its god's live wrath. Adding a region = adding an anchor + a
`legalBids` context; the map renders it for free.

---

## 2. Story & adventure

The 30 turns stop being an abstract survival timer and become a **campaign in three acts**, framed
by the title's real meaning — *theodicy: the problem of why a just god permits suffering.* You
never get to ask the gods directly. You infer them from what they do to you.

- **Act I — The Attention.** Something has begun watching the vale. Establish the four domains,
  meet the first companions, learn to read omens. Low stakes, high dread.
- **Act II — The Bargain.** Debts come due (Ithra), the ridge stirs (Kel), the well sickens
  (Vurm). You must *choose which gods to appease and which to defy* — and appeasing one slights
  the rest (the `offer` mechanic, scaled up to story branches). BG3-style companions take sides.
- **Act III — The Verdict.** The escalation streak, the mercy cap, the favor ledger all pay off.
  The ending is *the gods' judgment of you*, read back from the append-only ledger — the ledger
  literally is the game's memory of your theodicy.

Story is data, not code: a `story/acts.json` of beats keyed to `(turn, world-predicate)` so the
narrative reacts to the same digest the gods read. Companions are actors with their own
`legalBids` (their loyalties are verbs they will/won't take), so a companion can be driven by the
same policy substrate — and can betray you *lawfully*.

---

## 3. Combat — the fork that needs your call

This is the one genuine genre decision, so it's the gating question (see §7). Three coherent
options, all buildable on our engine, ranked by fit:

### Option A — **Gambit / ADB (Final Fantasy XII style)** ← recommended
Real-time-**with-pause**, on the world map. Your party + enemies are units; each acts on a cooldown
("charge time"). You don't micro every click — you set **gambits** (`if enemy.hp<30% → Oss:mend`),
and units score their `legalBids()` each tick. Pause any time to re-issue. **This is the RTS
*feel*** (armies resolving in real time, you commanding from above) **with our exact policy
engine** — gambits *are* `decide(w, legal)`. The gods intervene on the field as super-units. Least
new tech, best thematic fit, and it makes the trained model a literal combat brain.

### Option B — **True RTS** (base + unit production + real-time micro)
Full StarCraft-shape: build order, resource harvest, army micro. Maximum "RTS," but it's a
different genre and a different engine (continuous space, pathfinding, selection/control groups).
Largest build; weakest tie to the god-policy thesis; the arbiter/invariants safety case mostly
doesn't transfer. High risk of becoming a generic RTS that happens to have gods.

### Option C — **Turn-based tactical (Baldur's Gate 3 style)**
Grid, initiative order, action economy, cover. Deep and readable; the arbiter model fits perfectly
(a turn = a `legalBids` menu). But it's *slower*, and you said you prefer an RTS feel — this is the
opposite of real-time.

Combat resources bridge to the sim: **tension** funds the gods' battlefield power; **favor** gates
which divine interventions you can call; the **escalation cap** still forces an Oss (mercy) beat so
fights can't spiral into unwinnable misery — the same guarantee, now tactical.

---

## 4. Leveling & progression

Two intertwined tracks, both BG3/FF12-flavored:

- **The settlement** (Aldermere) levels: *hamlet → village → town → seat*. Each tier raises pop
  caps, unlocks buildings (well-house, palisade, almshouse, counting-house — one per god), and
  redraws bigger on the map. Driven by surviving turns + resource thresholds.
- **The protagonist + companions** level via **Devotion** (XP earned by acting within, or
  defiantly against, each god's domain). Devotion is the currency that buys nodes on the board (§5).

Leveling never buys safety from Kel (favor cap −10 holds) — you can grow strong, but war stays
structurally hostile. That's the theodicy, kept intact through progression.

---

## 5. The Covenant Board — competences & magic (FF12 License Board)

A grid you unlock with **Devotion**, split into **four quadrants, one per god** — so the skill tree
and the pantheon are the same object:

- **Vurm (Thirst) — hydromancy & blight.** Purify/foul water, summon rain/flood, drought-curse.
- **Kel (Iron) — war-arts & wrath.** Weapon licenses, armor, the raid, the betrayal, battle-fury.
- **Oss (Quiet Hand) — mercy & mending.** Heals, shelters, wards, the respite that de-escalates.
- **Ithra (Ledger) — bargains & debt-magic.** Bind a debt for power now; *exact* it later; reveal.

Each **magic = a license = a node** you buy; casting it is a **legal bid** with a cost, resolved by
the arbiter exactly like a god's verb. Because spells are verbs in the action space, a companion who
learns Kel's war-arts *cannot* accidentally cast Oss's mercy — the same personality-in-the-action-
space guarantee, now the player's magic system. Cross-quadrant nodes cost more and slight the other
gods (echoing `offer`). The board is data (`progression/board.json`); the map's four sigils are its
four roots.

---

## 6. Graphics & UI (in progress)

- **Done:** the state-reactive SVG world map; four hand-drawn god sigils; omen banner over the map.
- **Next:** unit/companion tokens on the map for combat; a Covenant Board screen (SVG grid); spell
  VFX as SVG overlays (Vurm's flood tint, Kel's smoke, Oss's warm bloom, Ithra's ledger-lines);
  portraits (SVG or embedded data-URI art). All self-contained SVG/inline → CSP-safe for HF (§8).

Aesthetic holds: dark stone, ember, EB Garamond serif + JetBrains mono. Ink-and-ember cartography.

---

## 7. The two decisions I need from you

1. **Combat architecture** — A (Gambit/ADB, recommended), B (true RTS), or C (BG3 turn-based)?
2. **The model** — the eval proved the current Supra checkpoint is a *redundant lookup table*
   (KL 0.11, below the heuristic floor 0.21): it learned the anger oracle instead of diverging from
   it. The prescribed fix is to **retrain with `--mode teacher` (Qwen3-4B labels)** so the policy
   gets real, weird opinions — "stranger, but bounded." Do that now (~20–30 min on the 3060), or
   keep shipping the always-safe HeuristicGod for gameplay while we iterate the model separately?

---

## 8. Deployment — yes, HF static Space works

Confirmed against current HF docs. The whole app is no-build static ES modules → set
`sdk: static` in a root `README.md` YAML block and serve `index.html`. CDN imports (React/htm/
Tailwind via esm.sh) and the model (transformers.js pulling ONNX from a Hub repo) are all
client-side fetches, allowed from a Space. WebGPU-less browsers fall back to HeuristicGod
automatically, so the Space is always playable. Scaffolding: a root `index.html` (or `app_file`)
and the `README.md` config block — added alongside this doc.

---

## Roadmap

- [x] God-sim core: engine, arbiter, invariants (green), corpus, SFT, ONNX.
- [x] Honest eval: model vs heuristic (verdict: redundant — needs teacher labels).
- [x] World map + geography + sigils (graphics, live in app).
- [ ] **Decision gate:** combat architecture + model roadmap (§7).
- [ ] Story data + first companions (Act I).
- [ ] Combat prototype (per §7 choice) on the map, reusing `legalBids`/policy.
- [ ] Covenant Board + magic (licenses as verbs).
- [ ] Settlement + Devotion leveling.
- [ ] HF static Space publish.
