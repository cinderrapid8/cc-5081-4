// Guard adjudication tuning.
// Times are integer milliseconds on the simulation timeline.
// Angles are degrees at the public boundary.

const equipment = {
  sword_shield: {
    label: '剑 + 盾',
    blockHalfAngleDeg: 75,
    parryHalfAngleDeg: 32,
    canParry: true,
    chipFraction: 0.30,
  },
  greatsword: {
    label: '双手剑',
    blockHalfAngleDeg: 62,
    parryHalfAngleDeg: 26,
    canParry: true,
    chipFraction: 0.55,
  },
  unarmed: {
    label: '空手',
    blockHalfAngleDeg: 45,
    parryHalfAngleDeg: 18,
    canParry: false,
    chipFraction: 1.0,
  },
};

// The incoming weapon sets how early a guard may start and still count as a
// precise parry. The window closes exactly at impact: [arrival - lead, arrival].
const weapons = {
  sword: { label: '剑', parryLeadMs: 280 },
  spear: { label: '矛', parryLeadMs: 220 },
  dagger: { label: '匕首', parryLeadMs: 180 },
  hammer: { label: '战锤', parryLeadMs: 240 },
};

// Move nature decides whether a parry is possible and whether guard is bypassed.
const moves = {
  slash: { label: '横斩', parryable: true, ignoresGuard: false, damage: 14 },
  thrust: { label: '突刺', parryable: true, ignoresGuard: false, damage: 12 },
  overhead: { label: '劈砍', parryable: true, ignoresGuard: false, damage: 16 },
  bash: { label: '盾击', parryable: false, ignoresGuard: false, damage: 9 },
  grab: { label: '抓取', parryable: false, ignoresGuard: true, damage: 10 },
  guardBreak: { label: '破防', parryable: false, ignoresGuard: true, damage: 18 },
};

export const GUARD_RULES = Object.freeze({
  equipment: Object.freeze(equipment),
  weapons: Object.freeze(weapons),
  moves: Object.freeze(moves),
  defaultEquipment: 'sword_shield',
  defaultFacingDeg: 0,
  // A guard counts as a parry only if it rose within this window before impact.
  // Window is inclusive at both ends; guard must also still cover the impact.
  parryWindowInclusive: true,
  // Guard coverage is [startAt, endAt): releasing at the impact instant is
  // already an exit.
  guardEndExclusive: true,
  // Attacks outside this angle from facing are rear attacks with their own
  // verdict reason; no guard can ever apply.
  rearThresholdDeg: 90,
});
