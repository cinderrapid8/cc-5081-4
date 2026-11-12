import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createArena, makeContacts } from '../src/sim/arena.js';
import { RESULT, REASON } from '../src/guard/events.js';
import { SCENARIOS } from '../src/sim/scenarios.js';

function runScenario(arena, scenario, stepMs) {
  scenario.build(arena);
  for (let t = 0; t <= scenario.durationMs; t += stepMs) arena.advanceTo(t);
  arena.advanceTo(scenario.durationMs);
  return arena.snapshot();
}

// --- Render-frequency invariance -------------------------------------------

const STEP_SETS = [1, 4, 16, 33, 100, 500, 2000];

test('render step size never changes any verdict', () => {
  for (const scenario of SCENARIOS) {
    const snapshots = STEP_SETS.map((stepMs) => runScenario(createArena(), scenario, stepMs));
    const reference = summarize(snapshots[0]);
    for (let i = 1; i < snapshots.length; i += 1) {
      assert.deepEqual(
        summarize(snapshots[i]),
        reference,
        `scenario "${scenario.id}" diverged at step ${STEP_SETS[i]}ms`,
      );
    }
  }
});

test('render step size never changes parry rate or damage', () => {
  for (const scenario of SCENARIOS) {
    const rates = STEP_SETS.map((stepMs) => {
      const snap = runScenario(createArena(), scenario, stepMs);
      return {
        stats: snap.stats,
        hp: snap.hp,
        settledAt: snap.results.map((r) => r.settledAt),
      };
    });
    for (const rate of rates) assert.deepEqual(rate, rates[0], scenario.id);
  }
});

function summarize(snapshot) {
  return {
    stats: snapshot.stats,
    hp: snapshot.hp,
    results: snapshot.results.map((result) => ({
      attackId: result.attackId,
      sourceId: result.sourceId,
      outcome: result.outcome,
      reason: result.reason,
      settledAt: result.settledAt,
      adoptedContactIndex: result.adoptedContactIndex,
      contactsSettled: result.contactsSettled,
    })),
  };
}

// --- Single settlement invariant -------------------------------------------

test('one attack with many contacts yields exactly one result row', () => {
  const arena = createArena();
  arena.actions.spawn(0, 'brute');
  arena.advanceTo(0);
  const sourceId = arena.snapshot().registry.issued[0].sourceId;
  arena.actions.startGuard(800);
  arena.actions.attack(1000, {
    actorTag: 'brute',
    sourceId,
    weapon: 'sword',
    move: 'slash',
    worldAngleDeg: 0,
    contacts: makeContacts({ arrivalAt: 1000, angleDeg: 0, count: 6, gapMs: 120 }),
  });
  arena.advanceTo(3000);
  const snap = arena.snapshot();
  assert.equal(snap.attacks.length, 1);
  assert.equal(snap.results.length, 1);
  assert.equal(snap.results[0].contactsSettled, 1);
  assert.equal(snap.results[0].contactsSeen, 6);
  assert.equal(snap.results[0].superseded.length, 5);
  assert.equal(snap.stats.total, 1);
});

// --- Source identity through the arena ------------------------------------

test('despawned and respawned grunt can never alias an older attack', () => {
  const arena = createArena();
  arena.actions.spawn(0, 'grunt');
  arena.advanceTo(0);
  const first = arena.snapshot().registry.issued[0].sourceId;
  arena.actions.despawn(500, 'grunt');
  arena.actions.spawn(600, 'grunt');

  arena.actions.startGuard(800);
  // A stale attack from the dead spawn lands at 1000.
  arena.actions.attack(900, {
    actorTag: 'grunt',
    sourceId: first,
    weapon: 'sword',
    move: 'slash',
    worldAngleDeg: 0,
    contacts: makeContacts({ arrivalAt: 1000, angleDeg: 0 }),
  });
  arena.advanceTo(2000);
  const snap = arena.snapshot();
  const staleResult = snap.results.find((r) => r.sourceId === first);
  assert.equal(staleResult.settled, false);
  assert.equal(staleResult.reason, REASON.BAD_SOURCE_ID);
  assert.equal(staleResult.outcome, null);
});

test('repeated spawns allocate fresh, monotonically increasing source ids', () => {
  const arena = createArena();
  for (let i = 0; i < 5; i += 1) {
    arena.actions.spawn(i * 10, 'grunt');
    arena.actions.despawn(i * 10 + 5, 'grunt');
  }
  arena.advanceTo(100);
  const ids = arena.snapshot().registry.issued.map((record) => record.sourceId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['atk-1', 'atk-2', 'atk-3', 'atk-4', 'atk-5']);
});

// --- Animation is not evidence ---------------------------------------------

test('playing the guard animation without raising guard does not parry', () => {
  const arena = createArena();
  arena.actions.spawn(0, 'brute');
  arena.advanceTo(0);
  const sourceId = arena.snapshot().registry.issued[0].sourceId;
  arena.actions.animGuard(700, 1100); // cosmetic swing of the arm only
  arena.actions.attack(1000, {
    actorTag: 'brute',
    sourceId,
    weapon: 'sword',
    move: 'slash',
    worldAngleDeg: 0,
    contacts: makeContacts({ arrivalAt: 1000, angleDeg: 0 }),
  });
  arena.advanceTo(2000);
  const snap = arena.snapshot();
  assert.equal(snap.cosmetic.guardAnim !== null, true);
  assert.equal(snap.results[0].outcome, RESULT.HIT);
  assert.equal(snap.results[0].reason, REASON.NO_GUARD);
});

test('animation state does not appear in any adjudication result', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'animation-trap');
  const arena = createArena();
  scenario.build(arena);
  arena.advanceTo(scenario.durationMs);
  const snap = arena.snapshot();
  for (const result of snap.results) {
    assert.equal('cosmetic' in result, false);
    assert.equal('guardAnim' in result, false);
  }
});

// --- Replay determinism -----------------------------------------------------

test('replaying the same action log reproduces the same event log', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'front-and-back');
  const build = () => {
    const arena = createArena();
    scenario.build(arena);
    arena.advanceTo(scenario.durationMs);
    return arena.snapshot().eventLog;
  };
  assert.deepEqual(build(), build());
});

test('advanceTo in one jump equals advancing in many small steps', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'long-contact');
  const coarse = createArena();
  scenario.build(coarse);
  coarse.advanceTo(scenario.durationMs);

  const fine = createArena();
  scenario.build(fine);
  for (let t = 0; t <= scenario.durationMs; t += 1) fine.advanceTo(t);

  assert.deepEqual(summarize(coarse.snapshot()), summarize(fine.snapshot()));
});
