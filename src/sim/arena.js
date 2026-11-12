// Deterministic melee arena.
//
// The arena is event-driven on a logical millisecond timeline. Guard presses,
// facing changes, equipment switches, spawns and contact events are all
// scheduled with explicit timestamps and processed in (time, insertion-order).
// Rendering cadence is irrelevant: advanceTo(t) always drains every event at or
// before t in timeline order.

import { GUARD_RULES } from '../guard/rules.js';
import {
  RESULT,
  REASON,
  createLedger,
  startGuard,
  exitGuard,
  switchEquipment,
  setFacing,
} from '../guard/events.js';
import { createSourceRegistry } from '../guard/identity.js';
import { adjudicateAttack } from '../guard/adjudicate.js';

// Same-instant ordering is by phase, never by insertion order, so a ledger
// change at the impact instant applies before the attack settles regardless of
// which was scheduled first.
const PHASE = {
  state: 0, // spawn, despawn, guard, equipment, facing
  launch: 1,
  settle: 2,
  contact: 3,
};

function phaseOf(op) {
  switch (op) {
    case 'attack':
      return PHASE.launch;
    case 'settle':
      return PHASE.settle;
    case 'contact':
      return PHASE.contact;
    default:
      return PHASE.state;
  }
}

function binaryInsert(queue, item) {
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const other = queue[mid];
    if (
      other.at < item.at ||
      (other.at === item.at && other.phase < item.phase) ||
      (other.at === item.at && other.phase === item.phase && other.seq < item.seq)
    ) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  queue.splice(lo, 0, item);
}

export function createArena({ rules = GUARD_RULES, equipmentId, facingDeg } = {}) {
  const ledger = createLedger({ equipmentId, facingDeg });
  const registry = createSourceRegistry();
  const queue = [];
  const attacks = [];
  const results = [];
  const eventLog = [];
  const cosmetic = {
    // Animation is deliberately separate from the ledger: adjudication never
    // reads it. This exists so the demo can prove that playing a guard
    // animation is not evidence of a successful parry.
    guardAnim: null,
    lastStrike: null,
  };
  let seq = 0;
  let now = 0;
  let nextAttackId = 1;
  let hp = 100;
  let maxHp = 100;

  function schedule(at, op, data = {}) {
    binaryInsert(queue, { at, seq: seq++, op, phase: phaseOf(op), data });
  }

  function log(entry) {
    eventLog.push({ ...entry });
  }

  function apply(op, data, at) {
    switch (op) {
      case 'guard-start':
        startGuard(ledger, { at });
        log({ at, type: 'guard-start' });
        break;
      case 'guard-exit':
        exitGuard(ledger, { at });
        log({ at, type: 'guard-exit' });
        break;
      case 'equipment':
        switchEquipment(ledger, { at, equipmentId: data.equipmentId });
        log({ at, type: 'equipment', equipmentId: data.equipmentId });
        break;
      case 'facing':
        setFacing(ledger, { at, facingDeg: data.facingDeg });
        log({ at, type: 'facing', facingDeg: data.facingDeg });
        break;
      case 'spawn': {
        const sourceId = registry.spawn(data.actorTag);
        log({ at, type: 'spawn', actorTag: data.actorTag, sourceId });
        break;
      }
      case 'despawn': {
        const dead = registry.despawn(data.actorTag);
        log({ at, type: 'despawn', actorTag: data.actorTag, sourceIds: dead });
        break;
      }
      case 'anim-guard': {
        cosmetic.guardAnim = { startedAt: at, endsAt: data.endsAt ?? at + 240 };
        log({ at, type: 'anim-guard', note: 'cosmetic only' });
        break;
      }
      case 'attack':
        spawnAttack(data, at);
        break;
      case 'settle':
        settleAttack(data.attack, at);
        break;
      case 'contact':
        noteContact(data.attack, data.contact, at);
        break;
      default:
        throw new Error(`unknown op: ${op}`);
    }
  }

  function spawnAttack(data, at) {
    const sourceId = data.sourceId || registry.currentForActor(data.actorTag);
    const actorTag = data.actorTag;
    const attack = {
      attackId: data.attackId || `atk-${nextAttackId++}`,
      sourceId,
      actorTag,
      move: data.move,
      weapon: data.weapon,
      worldAngleDeg: data.worldAngleDeg,
      contacts: data.contacts,
      status: 'pending',
      launchedAt: at,
    };
    attacks.push(attack);

    const ordered = [...data.contacts].sort(
      (a, b) => a.arrivalAt - b.arrivalAt || a.contactIndex - b.contactIndex,
    );
    const first = ordered[0];
    schedule(first.arrivalAt, 'settle', { attack });
    for (const contact of ordered.slice(1)) {
      schedule(contact.arrivalAt, 'contact', { attack, contact });
    }
    log({ at, type: 'attack-launched', attackId: attack.attackId, sourceId, contacts: ordered.length });
  }

  function settleAttack(attack, at) {
    if (attack.status !== 'pending') return;
    const record = registry.get(attack.sourceId);
    if (!record || !record.alive || record.actorTag !== attack.actorTag) {
      attack.status = 'cancelled';
      const result = {
        attackId: attack.attackId,
        sourceId: attack.sourceId,
        actorTag: attack.actorTag,
        outcome: null,
        reason: REASON.BAD_SOURCE_ID,
        settled: false,
        staleSource: true,
        settledAt: null,
        adoptedContactIndex: null,
        contactsSeen: attack.contacts.length,
        contactsSettled: 0,
        superseded: [],
      };
      results.push(result);
      log({
        at,
        type: 'attack-cancelled',
        attackId: attack.attackId,
        sourceId: attack.sourceId,
        reason: result.reason,
      });
      return;
    }

    const result = adjudicateAttack({
      attack: {
        attackId: attack.attackId,
        sourceId: attack.sourceId,
        actorTag: attack.actorTag,
        contacts: attack.contacts,
      },
      ledger,
      sourceRegistry: registry,
      rules,
    });
    attack.status = 'settled';
    attack.result = result;
    if (result.damage) hp = Math.max(0, hp - result.damage);
    results.push(result);
    log({
      at,
      type: 'settled',
      attackId: attack.attackId,
      sourceId: attack.sourceId,
      outcome: result.outcome,
      reason: result.reason,
      settledAt: result.settledAt,
    });
  }

  function noteContact(attack, contact, at) {
    log({
      at,
      type: 'contact-superseded',
      attackId: attack.attackId,
      contactIndex: contact.contactIndex,
    });
  }

  function advanceTo(t) {
    while (queue.length > 0 && queue[0].at <= t) {
      const item = queue.shift();
      now = item.at;
      apply(item.op, item.data, item.at);
    }
    if (t > now) now = t;
  }

  const actions = {
    at(at, op, payload = {}) {
      if (at < now) throw new Error('cannot schedule in the past');
      schedule(at, op, payload);
      return actions;
    },
    startGuard(at = now) {
      return actions.at(at, 'guard-start');
    },
    exitGuard(at = now) {
      return actions.at(at, 'guard-exit');
    },
    equipment(at, equipmentId) {
      return actions.at(at, 'equipment', { equipmentId });
    },
    facing(at, facingDeg) {
      return actions.at(at, 'facing', { facingDeg });
    },
    spawn(at, actorTag) {
      return actions.at(at, 'spawn', { actorTag });
    },
    despawn(at, actorTag) {
      return actions.at(at, 'despawn', { actorTag });
    },
    animGuard(at, endsAt) {
      return actions.at(at, 'anim-guard', { endsAt });
    },
    attack(at, spec) {
      return actions.at(at, 'attack', spec);
    },
  };

  function snapshot() {
    return {
      now,
      hp,
      maxHp,
      facingDeg: latestFacing(ledger, now),
      equipmentId: latestEquipment(ledger, now),
      guardActive: ledger.guardIntervals.some(
        (interval) => interval.endAt == null && interval.startAt <= now,
      ),
      guardIntervals: ledger.guardIntervals.map((interval) => ({ ...interval })),
      ledger: {
        equipmentEntries: ledger.equipmentEntries.map((entry) => ({ ...entry })),
        facingEntries: ledger.facingEntries.map((entry) => ({ ...entry })),
        guardIntervals: ledger.guardIntervals.map((interval) => ({ ...interval })),
      },
      attacks: attacks.map((attack) => ({ ...attack, contacts: attack.contacts.map((c) => ({ ...c })) })),
      results: results.map((result) => ({ ...result })),
      eventLog: eventLog.map((entry) => ({ ...entry })),
      registry: registry.snapshot(),
      cosmetic: {
        guardAnim: cosmetic.guardAnim ? { ...cosmetic.guardAnim } : null,
      },
      stats: countResults(results),
    };
  }

  return {
    actions,
    advanceTo,
    snapshot,
    get now() {
      return now;
    },
    setHp(nextMax) {
      maxHp = nextMax;
      hp = nextMax;
    },
    resetHp() {
      hp = maxHp;
    },
    _registry: registry,
    _ledger: ledger,
  };
}

function latestEntry(entries, at) {
  let found = entries[0];
  for (const entry of entries) if (entry.fromAt <= at) found = entry;
  return found;
}

function latestFacing(ledger, at) {
  return latestEntry(ledger.facingEntries, at).facingDeg;
}

function latestEquipment(ledger, at) {
  return latestEntry(ledger.equipmentEntries, at).equipmentId;
}

function countResults(results) {
  const stats = { total: 0, block: 0, parry: 0, hit: 0, cancelled: 0 };
  for (const result of results) {
    if (result.outcome === RESULT.BLOCK) stats.block += 1;
    else if (result.outcome === RESULT.PARRY) stats.parry += 1;
    else if (result.outcome === RESULT.HIT) stats.hit += 1;
    else stats.cancelled += 1;
    if (result.outcome) stats.total += 1;
  }
  return stats;
}

// Build a contact list from a simple attack spec. Contacts are already
// confirmed by the collision layer when they reach the adjudicator.
export function makeContacts({ arrivalAt, angleDeg, weapon = 'sword', move = 'slash', count = 1, gapMs = 0, confirmed = true }) {
  const contacts = [];
  for (let i = 0; i < count; i += 1) {
    contacts.push({
      contactIndex: i,
      arrivalAt: arrivalAt + i * gapMs,
      arrivalAngleDeg: angleDeg,
      weapon,
      move,
      confirmed,
    });
  }
  return contacts;
}
