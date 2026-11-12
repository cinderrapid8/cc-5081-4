import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adjudicateAttack, RESULT, REASON, parryWindowFor } from '../src/guard/adjudicate.js';
import { createLedger, setEquipment, setFacing, startGuard, exitGuard, makeContact } from '../src/guard/events.js';
import { GUARD_RULES } from '../src/guard/rules.js';
import { createSourceRegistry } from '../src/guard/identity.js';

const attackWith = (contacts, extra = {}) => ({
  attackId: 'a1',
  sourceId: 'atk-1',
  actorTag: 'grunt',
  ...extra,
  contacts,
});

function guardLedger({ startedAt, ...rest } = {}) {
  const ledger = createLedger(rest);
  if (startedAt !== undefined) startGuard(ledger, { at: startedAt });
  return ledger;
}

// --- Core verdict table -----------------------------------------------------

test('guard never raised: hit, with no parry window applied', () => {
  const ledger = guardLedger({});
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.NO_GUARD);
  assert.equal(result.damage, 14);
});

test('guard held long before impact: normal block, not parry', () => {
  // Sword parry lead is 280ms; raising 400ms early is outside the precise window.
  const ledger = guardLedger({ startedAt: 600 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.BLOCK_COVER);
  assert.equal(result.parryWindow.startAt, 720);
  assert.equal(result.parryWindow.endAt, 1000);
});

test('guard raised inside the precise window: parry', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
  assert.equal(result.reason, REASON.PARRY_WINDOW);
  assert.equal(result.damage, 0);
});

// --- Window edges -----------------------------------------------------------

test('window start edge is inclusive: guard at arrival - lead parries', () => {
  const ledger = guardLedger({ startedAt: 720 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
});

test('one millisecond before the window start: block only', () => {
  const ledger = guardLedger({ startedAt: 719 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
});

test('guard raised at the impact instant still parries (window end inclusive)', () => {
  const ledger = guardLedger({ startedAt: 1000 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
  assert.equal(result.settledAt, 1000);
});

test('guard released at the impact instant: guard is already gone', () => {
  const ledger = guardLedger({ startedAt: 800 });
  exitGuard(ledger, { at: 1000 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.GUARD_EXITED);
});

test('guard released one millisecond after impact keeps the parry', () => {
  const ledger = guardLedger({ startedAt: 800 });
  exitGuard(ledger, { at: 1001 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
});

test('guard raised after the impact is no guard, never a late parry', () => {
  const ledger = guardLedger({ startedAt: 1100 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.NO_GUARD);
});

test('parry cone edge is inclusive', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const inside = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 32, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(inside.outcome, RESULT.PARRY);

  const outside = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 32.1, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(outside.outcome, RESULT.BLOCK);
  assert.equal(outside.reason, REASON.OUTSIDE_PARRY_CONE);
});

test('equipment switched to a narrower cone turns a block into a hit', () => {
  // 70° is inside sword+shield (75°) but outside greatsword (62°). Switching
  // 50ms before impact must apply the greatsword cone at impact.
  const ledger = guardLedger({ startedAt: 800, equipmentId: 'sword_shield' });
  const block = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 70, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(block.outcome, RESULT.BLOCK);

  const switched = guardLedger({ startedAt: 800, equipmentId: 'sword_shield' });
  setEquipment(switched, { at: 950, equipmentId: 'greatsword' });
  const hit = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 70, weapon: 'sword', move: 'slash' })]),
    ledger: switched,
  });
  assert.equal(hit.outcome, RESULT.HIT);
  assert.equal(hit.reason, REASON.OUTSIDE_BLOCK_CONE);
});

// --- Facing and cones -------------------------------------------------------

test('rear attack is reported as rear and cannot be guarded', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 180, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.REAR);
});

test('attack at the block cone edge is blocked but cannot parry', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 75, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.OUTSIDE_PARRY_CONE);
});

test('attack just outside the block cone is a hit', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 75.5, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.OUTSIDE_BLOCK_CONE);
});

test('attack outside the narrower parry cone blocks even when the timing is precise', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 40, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.OUTSIDE_PARRY_CONE);
});

test('facing is resolved at the impact instant, not the guard instant', () => {
  const ledger = guardLedger({ startedAt: 800, facingDeg: 0 });
  setFacing(ledger, { at: 990, facingDeg: 90 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 90, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
});

// --- Move nature and equipment ---------------------------------------------

test('unparryable move inside the window blocks instead of parrying', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'bash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.UNPARRYABLE_MOVE);
});

test('guard-bypassing move ignores an otherwise perfect parry', () => {
  const ledger = guardLedger({ startedAt: 900 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'dagger', move: 'grab' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.HIT);
  assert.equal(result.reason, REASON.GUARD_BYPASS);
});

test('unarmed defender can block but never parries', () => {
  const ledger = guardLedger({ startedAt: 800, equipmentId: 'unarmed' });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.NO_PARRY_GEAR);
  assert.equal(result.damage, 14);
});

test('equipment switched after the guard rose applies immediately at impact', () => {
  // Guard rose inside the sword+shield precise window, then dropped to unarmed
  // 100ms before impact. The parry must fail because gear changed.
  const ledger = guardLedger({ startedAt: 800, equipmentId: 'sword_shield' });
  setEquipment(ledger, { at: 900, equipmentId: 'unarmed' });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.reason, REASON.NO_PARRY_GEAR);
});

test('equipment switched to a parry-capable kit just before impact enables parry', () => {
  const ledger = guardLedger({ startedAt: 800, equipmentId: 'unarmed' });
  setEquipment(ledger, { at: 950, equipmentId: 'sword_shield' });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })]),
    ledger,
  });
  assert.equal(result.outcome, RESULT.PARRY);
});

test('per-weapon parry lead is honored', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'dagger', move: 'thrust' })]),
    ledger,
  });
  // Dagger lead is 180ms, so 800 is outside [820, 1000]: block only.
  assert.equal(result.outcome, RESULT.BLOCK);
  assert.equal(result.parryWindow.startAt, 820);
});

// --- Multi-contact settlement -----------------------------------------------

test('multiple contacts of one attack settle once and adopt the earliest contact', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const contacts = [
    makeContact({ contactIndex: 0, arrivalAt: 1010, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
    makeContact({ contactIndex: 1, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
    makeContact({ contactIndex: 2, arrivalAt: 1060, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
  ];
  const result = adjudicateAttack({ attack: attackWith(contacts), ledger });
  assert.equal(result.contactsSettled, 1);
  assert.equal(result.adoptedContactIndex, 1);
  assert.equal(result.settledAt, 1000);
  assert.equal(result.superseded.length, 2);
  for (const contact of result.superseded) assert.equal(contact.reason, REASON.SUPERSEDED);
});

test('a long continuous scrape does not re-roll into a late parry', () => {
  // Guard rises at 950, inside [720,1000] for the first contact. A long scrape
  // touches at 1000..1400; the outcome must stay whatever contact 0 decided.
  const ledger = guardLedger({ startedAt: 950 });
  const contacts = [0, 1, 2, 3, 4].map((i) => makeContact({
    contactIndex: i,
    arrivalAt: 1000 + i * 100,
    arrivalAngleDeg: 0,
    weapon: 'sword',
    move: 'slash',
  }));
  const result = adjudicateAttack({ attack: attackWith(contacts), ledger });
  assert.equal(result.outcome, RESULT.PARRY);
  assert.equal(result.adoptedContactIndex, 0);
  assert.equal(result.contactsSettled, 1);
});

test('unconfirmed contacts are ignored, and an all-unconfirmed attack is not settled', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([
      makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash', confirmed: false }),
    ]),
    ledger,
  });
  assert.equal(result.settled, false);
  assert.equal(result.reason, REASON.NOT_CONFIRMED);
  assert.equal(result.contactsSettled, 0);
});

test('duplicate contactIndex within one attack is counted once', () => {
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith([
      makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
      makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
    ]),
    ledger,
  });
  assert.equal(result.contactsConfirmed, 1);
  assert.equal(result.contactsSettled, 1);
});

// --- Source identity --------------------------------------------------------

test('source ids are never reused across respawns', () => {
  const registry = createSourceRegistry();
  const first = registry.spawn('grunt');
  registry.despawn('grunt');
  const second = registry.spawn('grunt');
  assert.notEqual(first, second);
  assert.equal(registry.isAlive(first), false);
  assert.equal(registry.isAlive(second), true);
});

test('an attack from a despawned source cannot inherit a new source id', () => {
  const registry = createSourceRegistry();
  registry.spawn('grunt'); // atk-1
  registry.despawn('grunt');
  registry.spawn('grunt'); // atk-2
  const ledger = guardLedger({ startedAt: 800 });

  const stale = adjudicateAttack({
    attack: attackWith(
      [makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })],
      { sourceId: 'atk-1' },
    ),
    ledger,
    sourceRegistry: registry,
  });
  assert.equal(stale.settled, false);
  assert.equal(stale.reason, REASON.BAD_SOURCE_ID);

  const fresh = adjudicateAttack({
    attack: attackWith(
      [makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })],
      { sourceId: 'atk-2' },
    ),
    ledger,
    sourceRegistry: registry,
  });
  assert.equal(fresh.settled, true);
  assert.equal(fresh.outcome, RESULT.PARRY);
});

test('an attack tagged with the wrong actor cannot borrow a live source id', () => {
  const registry = createSourceRegistry();
  const grunt = registry.spawn('grunt');
  registry.spawn('brute');
  const ledger = guardLedger({ startedAt: 800 });
  const result = adjudicateAttack({
    attack: attackWith(
      [makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' })],
      { sourceId: grunt, actorTag: 'brute' },
    ),
    ledger,
    sourceRegistry: registry,
  });
  assert.equal(result.settled, false);
  assert.equal(result.reason, REASON.BAD_SOURCE_ID);
});

// --- Invariants -------------------------------------------------------------

test('parry window helper and adjudicator agree at the boundary', () => {
  for (const weapon of Object.keys(GUARD_RULES.weapons)) {
    const window = parryWindowFor(GUARD_RULES.weapons[weapon], 5000);
    assert.equal(window.endAt, 5000);
    assert.equal(window.endAt - window.startAt, GUARD_RULES.weapons[weapon].parryLeadMs);
  }
});

test('adjudication is pure: the same inputs give byte-identical results', () => {
  const build = () => {
    const ledger = guardLedger({ startedAt: 800 });
    setEquipment(ledger, { at: 900, equipmentId: 'greatsword' });
    return adjudicateAttack({
      attack: attackWith([
        makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 15, weapon: 'spear', move: 'thrust' }),
        makeContact({ contactIndex: 1, arrivalAt: 1040, arrivalAngleDeg: 15, weapon: 'spear', move: 'thrust' }),
      ]),
      ledger,
    });
  };
  assert.deepEqual(build(), build());
});
