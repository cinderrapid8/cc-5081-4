// Figma-style event and ledger primitives.
//
// All timestamps are logical simulation milliseconds. Contact events arrive
// already confirmed; the adjudicator never re-runs collision.

import { GUARD_RULES } from './rules.js';

export const RESULT = Object.freeze({
  BLOCK: 'block',
  PARRY: 'parry',
  HIT: 'hit',
});

export const REASON = Object.freeze({
  NOT_CONFIRMED: 'not-confirmed',
  SUPERSEDED: 'superseded-contact',
  REAR: 'rear-attack',
  OUTSIDE_BLOCK_CONE: 'outside-block-cone',
  OUTSIDE_PARRY_CONE: 'outside-parry-cone',
  PARRY_WINDOW: 'parry-window',
  BLOCK_COVER: 'block-cover',
  GUARD_EXITED: 'guard-exited-before-arrival',
  NO_GUARD: 'no-guard-active',
  UNPARRYABLE_MOVE: 'unparryable-move',
  NO_PARRY_GEAR: 'equipment-cannot-parry',
  GUARD_BYPASS: 'guard-bypass',
  BAD_SOURCE_ID: 'unknown-or-dead-source',
});

export function makeContact({ contactIndex, arrivalAt, arrivalAngleDeg, weapon, move, confirmed = true }) {
  return { contactIndex, arrivalAt, arrivalAngleDeg, weapon, move, confirmed };
}

export function makeAttack({ attackId, sourceId, actorTag, contacts }) {
  return { attackId, sourceId, actorTag, contacts };
}

export function createLedger({ equipmentId = GUARD_RULES.defaultEquipment, facingDeg = GUARD_RULES.defaultFacingDeg } = {}) {
  return {
    equipmentEntries: [{ fromAt: -1e9, equipmentId }],
    facingEntries: [{ fromAt: -1e9, facingDeg }],
    guardIntervals: [],
  };
}

export function setEquipment(ledger, { at, equipmentId }) {
  if (!GUARD_RULES.equipment[equipmentId]) throw new Error(`unknown equipment: ${equipmentId}`);
  ledger.equipmentEntries.push({ fromAt: at, equipmentId });
}

export function setFacing(ledger, { at, facingDeg }) {
  ledger.facingEntries.push({ fromAt: at, facingDeg: ((facingDeg % 360) + 540) % 360 - 180 });
}

// Guard coverage is [startAt, endAt). Releasing guard closes it at that instant,
// so an impact at exactly the release time is already unguarded.
export function startGuard(ledger, { at }) {
  if (ledger.guardIntervals.some((interval) => interval.endAt == null)) return;
  ledger.guardIntervals.push({ startAt: at, endAt: null });
}

export function exitGuard(ledger, { at }) {
  for (const interval of ledger.guardIntervals) {
    if (interval.endAt == null) interval.endAt = at;
  }
}

// Adopt a different equipment mid-guard. The rules that apply at impact are
// whatever the ledger last recorded at or before that instant.
export function switchEquipment(ledger, { at, equipmentId }) {
  setEquipment(ledger, { at, equipmentId });
}
