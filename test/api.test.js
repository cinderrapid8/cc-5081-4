import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adjudicate,
  createLedger,
  makeAttack,
  makeContact,
  GUARD_RULES,
  parryWindowFor,
  createSourceRegistry,
} from '../src/index.js';

const attack = (sourceId = 'atk-1', actorTag = 'grunt') => makeAttack({
  attackId: 'a1',
  sourceId,
  actorTag,
  contacts: [
    makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
    makeContact({ contactIndex: 1, arrivalAt: 1040, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
  ],
});

test('public adjudicate() settles a documented example', () => {
  const ledger = createLedger({ equipmentId: 'sword_shield' });
  ledger.guardIntervals.push({ startAt: 720, endAt: null });
  const result = adjudicate({ ledger, attack: attack() });
  assert.equal(result.outcome, 'parry');
  assert.equal(result.settledAt, 1000);
  assert.equal(result.adoptedContactIndex, 0);
  assert.equal(result.superseded.length, 1);
  assert.deepEqual(result.parryWindow, {
    startAt: 720,
    endAt: 1000,
    startAtInclusive: true,
    endAtInclusive: true,
  });
});

test('public adjudicate() accepts guardStartedAt shorthand', () => {
  const ledger = createLedger({ equipmentId: 'sword_shield' });
  const result = adjudicate({ ledger, guardStartedAt: 800, attack: attack() });
  assert.equal(result.outcome, 'parry');
});

test('public adjudicate() rejects attacks from an unknown source', () => {
  const registry = createSourceRegistry();
  registry.spawn('grunt');
  const ledger = createLedger({ equipmentId: 'sword_shield' });
  ledger.guardIntervals.push({ startAt: 800, endAt: null });
  const result = adjudicate({ ledger, attack: attack('atk-9', 'grunt'), sourceRegistry: registry });
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'unknown-or-dead-source');
});

test('public parryWindowFor exposes inclusive endpoints', () => {
  const w = parryWindowFor(GUARD_RULES.weapons.sword, 1000);
  assert.equal(w.startAtInclusive, true);
  assert.equal(w.endAtInclusive, true);
  assert.equal(w.startAt, 1000 - GUARD_RULES.weapons.sword.parryLeadMs);
});
