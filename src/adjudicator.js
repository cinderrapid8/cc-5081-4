(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MeleeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// 格挡/招架裁决核心。
// 所有时间均由外部显式传入（模拟时间，单位：毫秒），模块自身不读取时钟，
// 因此裁决结果与渲染/逻辑帧率完全无关。

// 招式性质
const MOVE_NATURE = Object.freeze({
  SLASH: 'slash',   // 普通斩击：可格挡、可招架
  THRUST: 'thrust', // 突刺：可格挡、可招架
  HEAVY: 'heavy',   // 重击：可格挡，不可招架
});

// 裁决结果
const VERDICT = Object.freeze({
  PARRY: 'parry',
  BLOCK: 'block',
  HIT: 'hit',
});

// 未通过资格判定的原因（仅用于解释/展示，不影响裁决本身）
const REJECT_REASON = Object.freeze({
  NO_GUARD: 'no_guard',
  OUT_OF_ARC: 'out_of_arc',
  WINDOW_CLOSED: 'window_closed',
  UNPARRYABLE: 'unparryable',
  PARRY_ARC_TOO_NARROW: 'parry_arc_too_narrow',
});

const REJECT_LABEL = Object.freeze({
  no_guard: '未处于防御姿态',
  out_of_arc: '攻击来自格挡覆盖区之外',
  window_closed: '精准招架窗口已关闭（普通格挡仍可能生效）',
  unparryable: '该招式不可招架',
  parry_arc_too_narrow: '攻击角度超出精准招架扇形',
});

// 装备规则表。
// blockArc / parryArc 为以角色朝向为中心的半角（度），即覆盖区是 ±半角。
// parryWindow 为进入防御姿态后精准招架窗口的时长（毫秒，半开区间）。
const EQUIPMENT = Object.freeze({
  bare:      { id: 'bare',   name: '徒手',     blockArc: 60,  parryArc: 45, parryWindow: 150 },
  buckler:   { id: 'buckler', name: '小圆盾',  blockArc: 75,  parryArc: 55, parryWindow: 250 },
  rapier:    { id: 'rapier', name: '迅捷剑',  blockArc: 50,  parryArc: 40, parryWindow: 300 },
  tower:     { id: 'tower',  name: '塔盾',     blockArc: 150, parryArc: 30, parryWindow: 120 },
});

function normalizeAngleDeg(a) {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

// 攻击来袭方向（世界角度）与角色朝向之间的夹角，0..180 度。
function angularDistanceDeg(facingDeg, incomingDirDeg) {
  return Math.abs(normalizeAngleDeg(incomingDirDeg - facingDeg));
}

let _seq = 0;
function nextSourceSerial() {
  _seq += 1;
  return _seq;
}
function resetSourceSerial() {
  _seq = 0;
}

/**
 * 攻击事件（输入来自碰撞引擎，接触已确认）。
 * @typedef {Object} AttackEvent
 * @property {string} sourceId      攻击源编号，含单调序列号，重复生成也不会重复
 * @property {number} sourceSerial  攻击源序列号（数值）
 * @property {MOVE_NATURE} nature   招式性质
 * @property {number} incomingDirDeg 攻击来袭方向（世界角度，指向防守者）
 * @property {number} startMs       首次接触时刻
 * @property {number} [endMs]       接触结束时刻；持续接触可在结束后补报
 * @property {Array<{tMs:number, point?:object}>} contacts 接触点列表
 */

/**
 * 单防守者裁决器。多角色场景为每个防守者各持一个实例。
 */
class Adjudicator {
  constructor({ initialEquipment = 'bare' } = {}) {
    this.equipmentId = initialEquipment;
    this.guarding = false;
    this.guardStartMs = null;
    this.guardEquipmentId = null; // 进入当前姿态时使用的装备（招架窗口绑定它）
    this._instances = new Map(); // instanceId -> 内部实例
  }

  get equipment() {
    return EQUIPMENT[this.equipmentId];
  }

  /**
   * 切换装备：立即改变适用规则。若新装备存在（装备表均可用，切换不会取消姿态，
   * 但姿态内装备变化会立即用于格挡覆盖判定；招架窗口仍绑定姿态开始时的装备）。
   * 若调用方在切换时需要退出姿态，应显式调用 exitGuard。
   */
  switchEquipment(equipmentId, tMs) {
    if (!EQUIPMENT[equipmentId]) throw new Error(`未知装备: ${equipmentId}`);
    if (equipmentId === this.equipmentId) return [];
    this.equipmentId = equipmentId;
    return this.guarding ? this._reevaluateAll(tMs) : [];
  }

  /** 进入防御姿态；重复进入会刷新姿态开始时间（新的招架窗口）。 */
  enterGuard(tMs) {
    this.guarding = true;
    this.guardStartMs = tMs;
    this.guardEquipmentId = this.equipmentId;
    return this._reevaluateAll(tMs);
  }

  /** 退出防御姿态：立即失去全部防御覆盖，所有尚未结算的接触当场受击。 */
  exitGuard(tMs) {
    this.guarding = false;
    this.guardStartMs = null;
    this.guardEquipmentId = null;
    const out = [];
    for (const inst of this._instances.values()) {
      if (!inst.verdict) {
        this._finalizeHit(inst, tMs);
        out.push(this._snapshot(inst));
      }
    }
    return out;
  }

  /** 角色朝向变化（外部每帧/每步调用）；立即影响覆盖区资格。 */
  setFacing(facingDeg, tMs) {
    this.facingDeg = facingDeg;
    if (this.guarding) this._reevaluateAll(tMs);
  }

  /** 首次接触。返回本次调用产生的裁决（可能为 null，表示接触仍在等待）。 */
  beginContact(attack, tMs = attack.startMs, contactPoint = null) {
    if (this._instances.has(attack.instanceId)) {
      // 同一攻击实例只结算一次：重复的首次接触直接补记接触点，不再裁决。
      return this.addContactPoint(attack.instanceId, tMs, contactPoint);
    }
    const inst = {
      attack,
      startMs: attack.startMs,
      endMs: attack.endMs ?? null,
      contacts: [{ tMs, point: contactPoint }],
      verdict: null,
      judgedAtMs: null,
      rejection: null,
    };
    this._instances.set(attack.instanceId, inst);
    this._evaluate(inst, tMs);
    return inst.verdict ? this._snapshot(inst) : null;
  }

  /** 持续接触：追加接触点，并在尚未裁决时尝试裁决。 */
  addContactPoint(instanceId, tMs, contactPoint = null) {
    const inst = this._instances.get(instanceId);
    if (!inst) throw new Error(`未知攻击实例: ${instanceId}`);
    inst.contacts.push({ tMs, point: contactPoint });
    if (!inst.verdict) this._evaluate(inst, tMs);
    return inst.verdict ? this._snapshot(inst) : null;
  }

  /** 接触结束：补记结束点，未裁决者此刻强制结算为受击。 */
  endContact(instanceId, tMs, contactPoint = null) {
    const inst = this._instances.get(instanceId);
    if (!inst) throw new Error(`未知攻击实例: ${instanceId}`);
    inst.contacts.push({ tMs, point: contactPoint });
    inst.endMs = tMs;
    if (!inst.verdict) this._finalizeHit(inst, tMs);
    return this._snapshot(inst);
  }

  /** 对仍未结算的接触按当前规则重新裁决（内部状态变化时调用）。 */
  reevaluatePending(tMs) {
    return this._reevaluateAll(tMs);
  }

  _reevaluateAll(tMs) {
    const out = [];
    for (const inst of this._instances.values()) {
      if (!inst.verdict) {
        this._evaluate(inst, tMs);
        if (inst.verdict) out.push(this._snapshot(inst));
      }
    }
    return out;
  }

  /** 在 tMs 时刻按当前角色状态对单个实例做一次资格判定。 */
  _evaluate(inst, tMs) {
    const attack = inst.attack;
    const incoming = attack.incomingDirDeg;

    if (!this.guarding) {
      inst.rejection = REJECT_REASON.NO_GUARD;
      return;
    }

    // 1) 精准招架：资格更严格、窗口更短。
    // 窗口为半开区间 [guardStart, guardStart + parryWindow)，
    // 恰好落在结束边缘的事件不算招架（由测试固定该语义）。
    const parryGear = EQUIPMENT[this.guardEquipmentId];
    const windowEnd = this.guardStartMs + parryGear.parryWindow;
    const withinParryWindow = tMs >= this.guardStartMs && tMs < windowEnd;
    const withinParryArc =
      angularDistanceDeg(this.facingDeg, incoming) <= parryGear.parryArc;

    if (attack.nature === MOVE_NATURE.HEAVY) {
      inst.rejection = REJECT_REASON.UNPARRYABLE; // 重击不可招架，继续走格挡
    } else if (!withinParryWindow) {
      inst.rejection = REJECT_REASON.WINDOW_CLOSED;
    } else if (!withinParryArc) {
      inst.rejection = REJECT_REASON.PARRY_ARC_TOO_NARROW;
    } else {
      this._issue(inst, VERDICT.PARRY, tMs);
      return;
    }

    // 2) 普通格挡：覆盖区更大，只要仍在防御姿态内即持续有效，无短窗口。
    const blockGear = this.equipment; // 格挡覆盖使用当前装备（切换立即生效）
    const withinBlockArc =
      angularDistanceDeg(this.facingDeg, incoming) <= blockGear.blockArc;
    if (!withinBlockArc) {
      inst.rejection = REJECT_REASON.OUT_OF_ARC;
      return;
    }
    this._issue(inst, VERDICT.BLOCK, tMs);
  }

  _issue(inst, verdict, tMs) {
    inst.verdict = verdict;
    inst.judgedAtMs = tMs;
    inst.adoptedContact = inst.contacts.length
      ? inst.contacts[inst.contacts.length - 1]
      : null;
    inst.rejection = null;
  }

  _finalizeHit(inst, tMs) {
    this._issue(inst, VERDICT.HIT, tMs);
  }

  _snapshot(inst) {
    return {
      instanceId: inst.attack.instanceId,
      sourceId: inst.attack.sourceId,
      sourceSerial: inst.attack.sourceSerial,
      castSerial: inst.attack.castSerial,
      nature: inst.attack.nature,
      verdict: inst.verdict,
      judgedAtMs: inst.judgedAtMs,
      startMs: inst.startMs,
      endMs: inst.endMs,
      rejection: inst.rejection,
      contactCount: inst.contacts.length,
      adoptedContact: inst.adoptedContact,
    };
  }

  getVerdict(instanceId) {
    const inst = this._instances.get(instanceId);
    return inst && inst.verdict ? this._snapshot(inst) : null;
  }

  /** 已产生裁决的全部实例快照（按裁决时刻排序）。 */
  allVerdicts() {
    return [...this._instances.values()]
      .filter((i) => i.verdict)
      .sort((a, b) => a.judgedAtMs - b.judgedAtMs)
      .map((i) => this._snapshot(i));
  }

  /** 仍未结算（接触中、等待资格）的实例。 */
  pendingInstanceIds() {
    return [...this._instances.values()]
      .filter((i) => !i.verdict)
      .map((i) => i.attack.instanceId);
  }
}

/**
 * 攻击源：负责生成带唯一编号的攻击事件。
 * 同一个源重复生成时序列号单调递增，sourceId 形如 "src-3#7"，
 * 跨源、跨次生成均不会混淆。
 */
class AttackSource {
  constructor(label = 'source') {
    this.serial = nextSourceSerial();
    this.label = label;
    this.sourceId = `src-${this.serial}`;
    this._castCount = 0;
  }

  /**
   * @param {object} spec { nature, incomingDirDeg, startMs, endMs?, contacts? }
   */
  cast(spec) {
    this._castCount += 1;
    const castSerial = this._castCount;
    const startMs = spec.startMs;
    return {
      instanceId: `${this.sourceId}#${castSerial}`,
      sourceId: this.sourceId,
      sourceSerial: this.serial,
      castSerial,
      nature: spec.nature,
      incomingDirDeg: spec.incomingDirDeg,
      startMs,
      endMs: spec.endMs ?? null,
      contacts: spec.contacts ?? [],
    };
  }
}

return {
  MOVE_NATURE,
  VERDICT,
  REJECT_REASON,
  REJECT_LABEL,
  EQUIPMENT,
  normalizeAngleDeg,
  angularDistanceDeg,
  nextSourceSerial,
  resetSourceSerial,
  Adjudicator,
  AttackSource,
};
});
