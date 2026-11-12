// Public entry point.
//
// `adjudicate` is the callable decision interface: feed it confirmed contact
// events plus the defender's timeline ledger and it returns block / parry / hit
// together with the adopted adjudication instant.

import { adjudicateAttack } from './guard/adjudicate.js';
import { startGuard } from './guard/events.js';

export {
  adjudicateAttack,
  parryWindowFor,
  RESULT,
  REASON,
} from './guard/adjudicate.js';

export {
  GUARD_RULES,
} from './guard/rules.js';

export {
  createLedger,
  makeContact,
  makeAttack,
  startGuard,
  exitGuard,
  setEquipment,
  setFacing,
  switchEquipment,
} from './guard/events.js';

export { createSourceRegistry } from './guard/identity.js';

export { createArena, makeContacts } from './sim/arena.js';
export { SCENARIOS, SCENARIO_BY_ID } from './sim/scenarios.js';

/**
 * Minimal single-shot helper for callers that only have one attack to settle.
 *
 *   adjudicate({
 *     ledger: createLedger({ equipmentId: 'sword_shield' }),
 *     guardStartedAt: 720,
 *     attack: makeAttack({ ... contacts: [makeContact({ arrivalAt: 1000, ... })] }),
 *   })
 */
export function adjudicate({ ledger, guardStartedAt, attack, sourceRegistry = null, rules }) {
  if (guardStartedAt !== undefined) startGuard(ledger, { at: guardStartedAt });
  return adjudicateAttack({ attack, ledger, sourceRegistry, ...(rules ? { rules } : {}) });
}
