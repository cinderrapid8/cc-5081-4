(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./adjudicator'));
  } else root.MeleeSim = factory(root.MeleeCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
'use strict';

// 演示用模拟层：负责驱动角色、生成攻击并做最小化的接触检测。
// 注意：这里的碰撞只负责产出"已确认接触事件"，所有资格判定仍由 Adjudicator 完成。

const {
  MOVE_NATURE,
  EQUIPMENT,
  Adjudicator,
  AttackSource,
} = core;

const FIXED_DT_MS = 10; // 固定逻辑步长，渲染频率与它无关

class Orb {
  constructor(attack, startPos, velocity, radius) {
    this.attack = attack;
    this.x = startPos.x;
    this.y = startPos.y;
    this.vx = velocity.x;
    this.vy = velocity.y;
    this.radius = radius;
    this.began = false;
    this.ended = false;
    this.verdict = null; // 结算后写入，渲染用
  }
}

class World {
  constructor() {
    this.tMs = 0;
    this.player = {
      x: 0,
      y: 0,
      radius: 18,
      facingDeg: 0,
      equipmentId: 'buckler',
      guardInput: false, // 玩家是否按住防御（不等于招架成功）
      fakeAnim: null,    // 仅播放动作但不进入姿态的演示动画 {startMs, durationMs}
    };
    this.adj = new Adjudicator({ initialEquipment: this.player.equipmentId });
    this.adj.facingDeg = this.player.facingDeg;
    this.sources = new Map();
    this.orbs = [];
    this.timeline = []; // {tMs, fn} 一次性脚本事件
    this.verdicts = []; // 全部已裁决快照（按产生顺序）
    this.markers = [];  // 无物理体的注入事件的画面标记
    this._guardWasActive = false;
    this.log = [];
  }

  reset(tMs = 0) {
    this.tMs = tMs;
    this.player.x = 0;
    this.player.y = 0;
    this.player.facingDeg = 0;
    this.player.equipmentId = 'buckler';
    this.player.guardInput = false;
    this.player.fakeAnim = null;
    this.adj = new Adjudicator({ initialEquipment: this.player.equipmentId });
    this.adj.facingDeg = 0;
    this.sources.clear();
    this.orbs.length = 0;
    this.timeline.length = 0;
    this.verdicts.length = 0;
    this.markers.length = 0;
    this.log.length = 0;
    this._guardWasActive = false;
  }

  source(label) {
    const s = new AttackSource(label);
    this.sources.set(s.sourceId, s);
    return s;
  }

  at(tMs, fn) {
    this.timeline.push({ tMs, fn });
    this.timeline.sort((a, b) => a.tMs - b.tMs);
  }

  setFacing(deg) {
    this.player.facingDeg = deg;
    this.adj.facingDeg = deg; // 无姿态时也要同步，进入姿态瞬间才能拿到正确朝向
    if (this.adj.guarding) {
      for (const v of this.adj.reevaluatePending(this.tMs)) this._record(v);
    }
  }

  setEquipment(equipmentId) {
    if (!EQUIPMENT[equipmentId]) throw new Error(`未知装备: ${equipmentId}`);
    this.player.equipmentId = equipmentId;
    const issued = this.adj.switchEquipment(equipmentId, this.tMs);
    for (const v of issued) this._record(v);
    this.log.push({ tMs: this.tMs, text: `切换装备 -> ${EQUIPMENT[equipmentId].name}` });
  }

  setGuardInput(active) {
    this.player.guardInput = active;
    // 脚本/手动直接调用时，姿态在当前逻辑时刻立即生效，不延迟到下一个固定步
    if (this.adj.guarding !== active) {
      const issued = active ? this.adj.enterGuard(this.tMs) : this.adj.exitGuard(this.tMs);
      this._guardWasActive = active;
      for (const v of issued) this._record(v);
    }
  }

  /** 只播放防御动作动画，不进入防御姿态：用于证明"播动作 ≠ 招架成功"。 */
  playFakeGuardAnim(durationMs = 400) {
    this.player.fakeAnim = { startMs: this.tMs, durationMs };
  }

  /**
   * 生成一个攻击体并安排接触生命周期。
   * @returns 攻击事件（含唯一 instanceId）
   */
  fire(source, spec, { startPos, velocity, radius = 14 } = {}) {
    const attack = source.cast({
      nature: spec.nature,
      incomingDirDeg: spec.incomingDirDeg,
      startMs: spec.startMs,
      endMs: spec.endMs ?? null,
    });
    this.orbs.push(new Orb(attack, startPos, velocity, radius));
    this.log.push({
      tMs: this.tMs,
      text: `生成攻击 ${attack.instanceId}（${attack.nature}，来袭角 ${attack.incomingDirDeg}°）`,
    });
    return attack;
  }

  /** 不经过物理体，直接注入一个已确认接触事件（窗口边缘等精确时刻场景用）。 */
  injectContact(attack, tMs, point = null) {
    const v = this.adj.beginContact(attack, tMs, point);
    if (v) this._record(v, point);
    return v;
  }

  injectContactPoint(instanceId, tMs, point = null) {
    const v = this.adj.addContactPoint(instanceId, tMs, point);
    if (v) this._record(v, point);
    return v;
  }

  injectEnd(instanceId, tMs, point = null) {
    const v = this.adj.endContact(instanceId, tMs, point);
    if (v) this._record(v, point);
    return v;
  }

  _record(v, point = null) {
    if (!this.verdicts.some((x) => x.instanceId === v.instanceId && x.judgedAtMs === v.judgedAtMs)) {
      const marker = this._markerFor(v.instanceId) ?? point;
      this.verdicts.push({ ...v, marker });
      if (point && !this._markerFor(v.instanceId)) {
        this.markers.push({ instanceId: v.instanceId, ...point });
      }
    }
  }

  _markerFor(instanceId) {
    const orb = this.orbs.find((o) => o.attack.instanceId === instanceId);
    return orb ? { x: orb.x, y: orb.y } : null;
  }

  _flushTimeline() {
    while (this.timeline.length && this.timeline[0].tMs <= this.tMs) {
      const ev = this.timeline.shift();
      ev.fn(this);
    }
  }

  _syncGuard() {
    const active = this.player.guardInput;
    if (active && !this._guardWasActive) {
      this.adj.enterGuard(this.tMs);
    } else if (!active && this._guardWasActive) {
      this.adj.exitGuard(this.tMs);
    }
    this._guardWasActive = active;
    this.adj.setFacing(this.player.facingDeg, this.tMs);
  }

  _processContacts() {
    const p = this.player;
    for (const orb of this.orbs) {
      if (orb.ended) continue;
      const dx = orb.x - p.x;
      const dy = orb.y - p.y;
      const touching = Math.hypot(dx, dy) <= p.radius + orb.radius;
      if (touching && !orb.began) {
        orb.began = true;
        const v = this.adj.beginContact(orb.attack, this.tMs, { x: orb.x, y: orb.y });
        if (v) orb.verdict = v, this._record(v);
      } else if (touching && orb.began && !orb.verdict) {
        const v = this.adj.addContactPoint(orb.attack.instanceId, this.tMs, { x: orb.x, y: orb.y });
        if (v) orb.verdict = v, this._record(v);
      } else if (!touching && orb.began && !orb.verdict) {
        orb.ended = true;
        const v = this.adj.endContact(orb.attack.instanceId, this.tMs, { x: orb.x, y: orb.y });
        orb.verdict = v;
        this._record(v);
      }
    }
  }

  /** 推进一个固定逻辑步。 */
  step() {
    // 1) 到期脚本（setGuardInput 等会在当前时刻立即改变裁决器状态）
    this._flushTimeline();

    // 2) 玩家姿态同步（兜底处理步间直接改 guardInput 的情况）+ 朝向
    this._syncGuard();

    // 3) 攻击体运动
    for (const orb of this.orbs) {
      if (orb.ended) continue;
      orb.x += orb.vx * (FIXED_DT_MS / 1000);
      orb.y += orb.vy * (FIXED_DT_MS / 1000);
    }

    // 4) 接触检测 -> 已确认接触事件 -> 裁决
    this._processContacts();
    this.tMs += FIXED_DT_MS;
    return this.tMs;
  }

  /** 推进到目标时间（按固定步长），并最终排空所有到期脚本事件。 */
  advanceTo(targetMs) {
    let guard = 0;
    while (this.tMs < targetMs && guard < 100000) {
      this.step();
      guard += 1;
    }
    this._flushTimeline();
  }
}

return { World, Orb, FIXED_DT_MS, MOVE_NATURE, EQUIPMENT };
});
