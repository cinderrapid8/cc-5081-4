// Scenario expectations, authored independently from src/sim/scenarios.js.
//
// Each entry below was written by hand from the guard rules and the demo
// timelines, so the demo's own labels cannot silently bless a wrong verdict.
// Time values are logical milliseconds; contact points are listed explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createArena } from '../src/sim/arena.js';
import { SCENARIOS } from '../src/sim/scenarios.js';

// Hand-written expectations. Keyed by attackId; every field here is a claim
// about the design, not a copy from the scenario builder.
const HAND_WRITTEN = {
  'front-and-back': {
    'front-0': { outcome: 'block', damage: 4, settledAt: 1000, adoptedContactIndex: 0 },
    'back-0': { outcome: 'hit', damage: 14, settledAt: 1000, adoptedContactIndex: 0 },
  },
  'long-contact': {
    // Guard rose at 900; sword window for 1000 is [720,1000], so contact 0 parries.
    // Later contacts are superseded even though contact 8 (1400) would be a plain block.
    'scrape-0': { outcome: 'parry', damage: 0, settledAt: 1000, adoptedContactIndex: 0, superseded: 8 },
  },
  'window-edge': {
    // 720 = 1000 - 280 exactly: inclusive parry.
    'edge-in': { outcome: 'parry', damage: 0, settledAt: 1000 },
    // 1219 = 1500 - 280 - 1: one millisecond too early, block only.
    'edge-before': { outcome: 'block', damage: 4, settledAt: 1500 },
    // Guard began exactly at impact: still inside the inclusive window.
    'edge-instant': { outcome: 'parry', damage: 0, settledAt: 2000 },
    // Guard ended at 2500, the same instant the hit arrives: exit wins.
    'edge-exit': { outcome: 'hit', damage: 14, settledAt: 2500 },
  },
  'equipment-switch': {
    // Window hit but gear is unarmed at impact: block, full chip damage.
    'gear-drop': { outcome: 'block', damage: 14, settledAt: 1000 },
    // Gear restored before impact: parry stands.
    'gear-restore': { outcome: 'parry', damage: 0, settledAt: 1400 },
  },
  'facing-at-arrival': {
    'facing-in': { outcome: 'parry', damage: 0, settledAt: 1000 },
    'facing-out': { outcome: 'hit', damage: 14, settledAt: 1600 },
  },
  'guard-exit-immediate': {
    'exit-early': { outcome: 'hit', damage: 14, settledAt: 1000 },
    'exit-recover': { outcome: 'parry', damage: 0, settledAt: 1400 },
  },
  'animation-trap': {
    'anim-0': { outcome: 'hit', damage: 14, settledAt: 1000 },
  },
  'respawn-identity': {
    'stale-0': { outcome: null, settled: false, settledAt: null },
    'fresh-0': { outcome: 'parry', damage: 0, settledAt: 1000 },
  },
  'move-nature': {
    'move-bash': { outcome: 'block', damage: 3, settledAt: 1000 },
    'move-grab': { outcome: 'hit', damage: 10, settledAt: 1200 },
    'move-over': { outcome: 'parry', damage: 0, settledAt: 1700 },
  },
};

function run(scenario) {
  const arena = createArena();
  scenario.build(arena);
  arena.advanceTo(scenario.durationMs);
  return arena.snapshot();
}

test('every scenario is covered by an independent hand-written table', () => {
  for (const scenario of SCENARIOS) {
    assert.ok(HAND_WRITTEN[scenario.id], `missing independent expectations for ${scenario.id}`);
  }
});

for (const scenario of SCENARIOS) {
  test(`hand-written verdicts: ${scenario.id}`, () => {
    const snap = run(scenario);
    const expected = HAND_WRITTEN[scenario.id];
    const byId = Object.fromEntries(snap.results.map((result) => [result.attackId, result]));

    for (const attackId of Object.keys(expected)) {
      const actual = byId[attackId];
      assert.ok(actual, `scenario did not settle ${attackId}`);
      const claim = expected[attackId];
      for (const field of Object.keys(claim)) {
        if (field === 'superseded') {
          assert.equal(actual.superseded.length, claim.superseded, `${attackId} superseded count`);
        } else {
          assert.equal(actual[field], claim[field], `${attackId}.${field}`);
        }
      }
    }
    assert.equal(snap.results.length, Object.keys(expected).length, `${scenario.id} result count`);
  });
}

test('demo-described settled times match the computed ones', () => {
  for (const scenario of SCENARIOS) {
    const snap = run(scenario);
    const byId = Object.fromEntries(snap.results.map((result) => [result.attackId, result]));
    for (const label of scenario.expected) {
      const actual = byId[label.attackId];
      assert.ok(actual, `${scenario.id}: missing ${label.attackId}`);
      assert.equal(actual.outcome, label.outcome ?? null, `${scenario.id}/${label.attackId} outcome`);
      assert.equal(actual.reason, label.reason, `${scenario.id}/${label.attackId} reason`);
      assert.equal(actual.settledAt, label.settledAt, `${scenario.id}/${label.attackId} settledAt`);
      if (label.settled !== undefined) assert.equal(actual.settled, label.settled);
      if (label.adoptedContactIndex !== undefined) {
        assert.equal(actual.adoptedContactIndex, label.adoptedContactIndex);
      }
      if (label.damage !== undefined) assert.equal(actual.damage, label.damage);
      if (label.contactsSeen !== undefined) assert.equal(actual.contactsSeen, label.contactsSeen);
      if (label.superseded !== undefined) assert.equal(actual.superseded.length, label.superseded);
    }
  }
});

test('front and back attacks arriving at the same instant both settle', () => {
  const snap = run(SCENARIOS.find((s) => s.id === 'front-and-back'));
  const front = snap.results.find((r) => r.attackId === 'front-0');
  const back = snap.results.find((r) => r.attackId === 'back-0');
  assert.equal(front.settledAt, 1000);
  assert.equal(back.settledAt, 1000);
  assert.equal(front.outcome, 'block');
  assert.equal(back.outcome, 'hit');
  assert.notEqual(front.sourceId, back.sourceId);
});
