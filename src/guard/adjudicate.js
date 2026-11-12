// Pure guard adjudication.
//
// Input: contact events already confirmed by the collision layer, plus the
// defender's append-only ledger (guard, facing, equipment over time).
// Output: block / parry / hit, with the exact instant that was adopted.
//
// No rendering, no frame timing, no animation state. Decisions depend only on
// logical timestamps, so they are identical at any render frequency.

import { GUARD_RULES } from './rules.js';
import {
  activeIntervalAt,
  latestEntryAt,
  normalize180Deg,
  someGuardEndedBy,
} from './timeline.js';
import { RESULT, REASON } from './events.js';

function withinCone(relativeDeg, halfAngleDeg) {
  return Math.abs(normalize180Deg(relativeDeg)) <= halfAngleDeg;
}

function equipmentAt(ledger, at) {
  const entry = latestEntryAt(ledger.equipmentEntries, at);
  return entry ? entry.equipmentId : GUARD_RULES.defaultEquipment;
}

function facingAt(ledger, at) {
  const entry = latestEntryAt(ledger.facingEntries, at);
  return entry ? entry.facingDeg : GUARD_RULES.defaultFacingDeg;
}

function confirmedContacts(contacts) {
  const seen = new Set();
  const list = [];
  for (const contact of contacts || []) {
    if (contact.confirmed !== true) continue;
    if (seen.has(contact.contactIndex)) continue;
    seen.add(contact.contactIndex);
    list.push(contact);
  }
  list.sort((a, b) => a.arrivalAt - b.arrivalAt || a.contactIndex - b.contactIndex);
  return list;
}

/**
 * Settle one attack from its confirmed contacts.
 *
 * Contact points that belong to the same attack settle exactly once: the
 * earliest confirmed contact fixes the adjudication instant, and later contacts
 * are reported as superseded rather than re-rolled. This keeps a long scrape or
 * a multi-point collision from being counted twice.
 */
export function adjudicateAttack({ attack, ledger, sourceRegistry = null, rules = GUARD_RULES }) {
  const contacts = confirmedContacts(attack.contacts);
  const seen = (attack.contacts || []).length;

  const base = {
    attackId: attack.attackId,
    sourceId: attack.sourceId,
    contactsSeen: seen,
    contactsConfirmed: contacts.length,
    contactsSettled: 0,
    superseded: [],
    adoptedContactIndex: null,
    settledAt: null,
    parryWindow: null,
    guardStartAt: null,
  };

  if (sourceRegistry) {
    const record = sourceRegistry.get(attack.sourceId);
    if (!record || !record.alive || record.actorTag !== attack.actorTag) {
      return {
        ...base,
        outcome: RESULT.HIT,
        reason: REASON.BAD_SOURCE_ID,
        settled: false,
        staleSource: true,
      };
    }
  }

  if (contacts.length === 0) {
    return { ...base, outcome: RESULT.HIT, reason: REASON.NOT_CONFIRMED, settled: false };
  }

  const adopted = contacts[0];
  const verdict = classifyAt(adopted, ledger, rules);
  const superseded = contacts.slice(1).map((contact) => ({
    contactIndex: contact.contactIndex,
    arrivalAt: contact.arrivalAt,
    reason: REASON.SUPERSEDED,
  }));

  return {
    ...base,
    outcome: verdict.outcome,
    reason: verdict.reason,
    damage: verdict.damage,
    settled: true,
    adoptedContactIndex: adopted.contactIndex,
    settledAt: adopted.arrivalAt,
    contactsSettled: 1,
    superseded,
    equipmentId: verdict.equipmentId,
    relativeAngleDeg: round(verdict.relativeAngleDeg),
    guardStartAt: verdict.guardStartAt ?? null,
    guardExitedAt: verdict.guardExitedAt ?? null,
    parryWindow: verdict.parryWindow ?? null,
    parryPossible: verdict.parryPossible ?? false,
  };
}

function classifyAt(contact, ledger, rules) {
  const at = contact.arrivalAt;
  const equipmentId = equipmentAt(ledger, at);
  const facingDeg = facingAt(ledger, at);
  const relativeAngleDeg = normalize180Deg(contact.arrivalAngleDeg - facingDeg);
  const equipment = rules.equipment[equipmentId];
  const weapon = rules.weapons[contact.weapon] || rules.weapons.sword;
  const move = rules.moves[contact.move] || rules.moves.slash;

  const base = {
    equipmentId,
    relativeAngleDeg,
    guardStartAt: null,
    parryWindow: null,
  };

  if (Math.abs(relativeAngleDeg) > rules.rearThresholdDeg) {
    return { ...base, outcome: RESULT.HIT, reason: REASON.REAR, damage: move.damage };
  }
  if (move.ignoresGuard) {
    return { ...base, outcome: RESULT.HIT, reason: REASON.GUARD_BYPASS, damage: move.damage };
  }

  const guard = activeIntervalAt(ledger.guardIntervals, at);
  if (!guard) {
    const exitedAt = someGuardEndedBy(ledger.guardIntervals, at);
    return {
      ...base,
      outcome: RESULT.HIT,
      reason: exitedAt ? REASON.GUARD_EXITED : REASON.NO_GUARD,
      damage: move.damage,
      guardExitedAt: exitedAt ? latestGuardEnd(ledger.guardIntervals, at) : null,
    };
  }

  const guardStartAt = guard.startAt;
  if (!withinCone(relativeAngleDeg, equipment.blockHalfAngleDeg)) {
    return {
      ...base,
      outcome: RESULT.HIT,
      reason: REASON.OUTSIDE_BLOCK_CONE,
      guardStartAt,
      damage: move.damage,
    };
  }

  const precise = parryWindowFor(weapon, at);
  const inParryCone = withinCone(relativeAngleDeg, equipment.parryHalfAngleDeg);
  const preciseHit =
    (rules.parryWindowInclusive
      ? guardStartAt >= precise.startAt
      : guardStartAt > precise.startAt) && guardStartAt <= at;

  const parryPossible = equipment.canParry && move.parryable && inParryCone;

  if (preciseHit && parryPossible) {
    return {
      ...base,
      outcome: RESULT.PARRY,
      reason: REASON.PARRY_WINDOW,
      damage: 0,
      guardStartAt,
      parryWindow: precise,
      parryPossible: true,
    };
  }

  let reason = REASON.BLOCK_COVER;
  if (preciseHit && !equipment.canParry) reason = REASON.NO_PARRY_GEAR;
  else if (preciseHit && !move.parryable) reason = REASON.UNPARRYABLE_MOVE;
  else if (preciseHit && !inParryCone) reason = REASON.OUTSIDE_PARRY_CONE;

  return {
    ...base,
    outcome: RESULT.BLOCK,
    reason,
    damage: Math.round(move.damage * equipment.chipFraction),
    guardStartAt,
    parryWindow: precise,
    parryPossible,
    preciseWindowHit: preciseHit,
  };
}

export function parryWindowFor(weapon, arrivalAt) {
  return {
    startAt: arrivalAt - weapon.parryLeadMs,
    endAt: arrivalAt,
    startAtInclusive: true,
    endAtInclusive: true,
  };
}

function latestGuardEnd(intervals, at) {
  let latest = null;
  for (const interval of intervals || []) {
    if (interval.endAt != null && interval.endAt <= at) {
      if (latest === null || interval.endAt > latest) latest = interval.endAt;
    }
  }
  return latest;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export { RESULT, REASON };
