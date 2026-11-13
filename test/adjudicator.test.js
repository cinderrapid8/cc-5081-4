'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  Adjudicator,
  AttackSource,
  EQUIPMENT,
  MOVE_NATURE,
  VERDICT,
  REJECT_REASON,
  angularDistanceDeg,
  resetSourceSerial,
} = require('../src/adjudicator');

function adjAt(equipment = 'buckler') {
  const a = new Adjudicator({ initialEquipment: equipment });
  a.facingDeg = -90; // 面朝北（setFacing 会触发重新裁决，构造后直接赋值即可）
  return a;
}

function attack(over = {}) {
  return {
    instanceId: over.instanceId ?? 'i-1',
    sourceId: 'src-x',
    sourceSerial: 1,
    castSerial: 1,
    nature: over.nature ?? MOVE_NATURE.SLASH,
    incomingDirDeg: over.incomingDirDeg ?? -90,
    startMs: over.startMs ?? 1000,
    endMs: over.endMs ?? null,
    contacts: [],
  };
}

test('未防御时接触：接触结束前不裁决，结束时受击', () => {
  const a = adjAt();
  const v0 = a.beginContact(attack(), 1000);
  assert.equal(v0, null);
  assert.deepEqual(a.pendingInstanceIds(), ['i-1']);
  const v1 = a.endContact('i-1', 1500);
  assert.equal(v1.verdict, VERDICT.HIT);
  assert.equal(v1.judgedAtMs, 1500);
});

test('窗口内、精准扇形内 -> 招架', () => {
  const a = adjAt('buckler'); // 窗口 250ms，招架扇形 ±55°
  a.enterGuard(1000);
  const v = a.beginContact(attack({ startMs: 1100 }), 1100);
  assert.equal(v.verdict, VERDICT.PARRY);
  assert.equal(v.judgedAtMs, 1100);
});

test('窗口外但格挡覆盖区内 -> 格挡（短窗口与大覆盖区的区分）', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  // 300ms 时窗口 [1000,1250) 已关闭；正北仍在格挡覆盖区内
  const v = a.beginContact(attack({ startMs: 1300 }), 1300);
  assert.equal(v.verdict, VERDICT.BLOCK);
  assert.equal(v.judgedAtMs, 1300);
});

test('招架扇形外、格挡扇形内（偏角 65°）-> 格挡而非招架', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  const v = a.beginContact(attack({ incomingDirDeg: -25, startMs: 1100 }), 1100);
  assert.equal(v.verdict, VERDICT.BLOCK);
  assert.equal(a.getVerdict('i-1').rejection, null);
});

test('格挡覆盖区之外：持续等待，接触结束 -> 受击，原因记录为覆盖区外', () => {
  const a = adjAt('buckler'); // 格挡 ±75°
  a.enterGuard(1000);
  const behind = attack({ incomingDirDeg: 90, startMs: 1100 });
  assert.equal(a.beginContact(behind, 1100), null);
  const v = a.endContact('i-1', 1600);
  assert.equal(v.verdict, VERDICT.HIT);
  assert.equal(v.judgedAtMs, 1600);
});

test('窗口结束边缘：2249 招架、2250 格挡（半开区间）', () => {
  const a1 = adjAt('buckler');
  a1.enterGuard(2000);
  const inside = a1.beginContact(attack({ instanceId: 'a', startMs: 2249 }), 2249);
  assert.equal(inside.verdict, VERDICT.PARRY);

  const a2 = adjAt('buckler');
  a2.enterGuard(2000);
  const edge = a2.beginContact(attack({ instanceId: 'b', startMs: 2250 }), 2250);
  assert.equal(edge.verdict, VERDICT.BLOCK);
});

test('重击不可招架：窗口内也只能格挡', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  const v = a.beginContact(attack({ nature: MOVE_NATURE.HEAVY, startMs: 1100 }), 1100);
  assert.equal(v.verdict, VERDICT.BLOCK);
});

test('突刺可招架', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  const v = a.beginContact(attack({ nature: MOVE_NATURE.THRUST, startMs: 1100 }), 1100);
  assert.equal(v.verdict, VERDICT.PARRY);
});

test('同一攻击跨多个接触点只结算一次，裁决时刻锁定为首次满足资格的时刻', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  a.beginContact(attack({ startMs: 1100 }), 1100);
  a.addContactPoint('i-1', 1200);
  a.addContactPoint('i-1', 1400); // 此时窗口已关闭
  const v = a.endContact('i-1', 1800);
  assert.equal(v.verdict, VERDICT.PARRY);
  assert.equal(v.judgedAtMs, 1100);
  assert.equal(v.contactCount, 4);
});

test('重复的 beginContact 不产生第二次裁决，只补记接触点', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  const atk = attack({ startMs: 1100 });
  const v1 = a.beginContact(atk, 1100);
  const v2 = a.beginContact(atk, 1120); // 碰撞引擎重复上报
  assert.equal(v1.verdict, VERDICT.PARRY);
  assert.equal(v2.verdict, VERDICT.PARRY);
  assert.equal(v2.judgedAtMs, 1100);
  assert.equal(a.getVerdict('i-1').contactCount, 2);
});

test('长持续接触：先无防御，进入姿态瞬间重新裁决并采用该时刻', () => {
  const a = adjAt('buckler');
  // 偏角 65°：精准扇形外、格挡覆盖区内
  const atk = attack({ instanceId: 'i-1', incomingDirDeg: -25, startMs: 3000 });
  assert.equal(a.beginContact(atk, 3000), null);
  a.addContactPoint('i-1', 3500);
  a.enterGuard(4000); // 接触开始后 1000ms 才防御
  const v = a.getVerdict('i-1');
  assert.equal(v.verdict, VERDICT.BLOCK);
  assert.equal(v.judgedAtMs, 4000); // 采用判定时刻=防御开始，而非首次接触 3000
});

test('长持续接触：正对方向在进入姿态瞬间落入新窗口 -> 招架', () => {
  const a = adjAt('buckler');
  assert.equal(a.beginContact(attack({ startMs: 3000 }), 3000), null);
  a.enterGuard(4000);
  const v = a.getVerdict('i-1');
  assert.equal(v.verdict, VERDICT.PARRY);
  assert.equal(v.judgedAtMs, 4000);
});

test('退出防御姿态立即失去覆盖：待裁决接触在退出时刻受击', () => {
  const a = adjAt('buckler');
  const behind = attack({ incomingDirDeg: 90, startMs: 1100 });
  a.enterGuard(1000);
  assert.equal(a.beginContact(behind, 1100), null); // 覆盖区外，等待中
  a.exitGuard(1300);
  const v = a.getVerdict('i-1');
  assert.equal(v.verdict, VERDICT.HIT);
  assert.equal(v.judgedAtMs, 1300);
});

test('装备切换立即改变格挡覆盖：斜后攻击在塔盾下即时获得格挡', () => {
  const a = adjAt('buckler');
  // 斜后 135°：小圆盾格挡 ±75° 不含；塔盾 ±150° 含
  const behind = attack({ instanceId: 'r', incomingDirDeg: 45, startMs: 3000 });
  a.enterGuard(2500);
  assert.equal(a.beginContact(behind, 3000), null);
  a.switchEquipment('tower', 3500);
  const v = a.getVerdict('r');
  assert.equal(v.verdict, VERDICT.BLOCK);
  assert.equal(v.judgedAtMs, 3500);
});

test('已结算裁决不被后续装备切换/姿态退出改写', () => {
  const a = adjAt('buckler');
  a.enterGuard(5000);
  a.beginContact(attack({ instanceId: 'p', startMs: 5100 }), 5100);
  assert.equal(a.getVerdict('p').verdict, VERDICT.PARRY);
  a.switchEquipment('rapier', 5300);
  a.exitGuard(5400);
  const v = a.getVerdict('p');
  assert.equal(v.verdict, VERDICT.PARRY);
  assert.equal(v.judgedAtMs, 5100);
});

test('朝向变化立即影响资格：转身让覆盖区对准后方等待中的攻击', () => {
  const a = adjAt('buckler');
  a.enterGuard(1000);
  const behind = attack({ instanceId: 't', incomingDirDeg: 90, startMs: 1100 });
  assert.equal(a.beginContact(behind, 1100), null);
  a.setFacing(90, 1250); // 转身面朝南
  const v = a.getVerdict('t');
  assert.equal(v.verdict, VERDICT.BLOCK);
  assert.equal(v.judgedAtMs, 1250);
});

test('招架窗口绑定姿态开始时的装备，格挡覆盖使用当前装备', () => {
  const a = adjAt('buckler'); // 窗口 250ms
  a.enterGuard(1000);
  a.switchEquipment('rapier', 1050); // 迅捷剑窗口 300ms，但当前姿态仍按 250ms
  const atEdge = a.beginContact(attack({ instanceId: 'e', startMs: 1260 }), 1260);
  assert.equal(atEdge.verdict, VERDICT.BLOCK); // 1260 >= 1250，旧窗口已关闭
  assert.equal(a.equipment.id, 'rapier');
});

test('攻击源重复生成：编号单调且互不混淆', () => {
  resetSourceSerial();
  const s1 = new AttackSource('a');
  const s2 = new AttackSource('b');
  const a1 = s1.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: 0, startMs: 0 });
  const a2 = s1.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: 0, startMs: 10 });
  const b1 = s2.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: 0, startMs: 0 });
  assert.equal(a1.instanceId, 'src-1#1');
  assert.equal(a2.instanceId, 'src-1#2');
  assert.equal(b1.instanceId, 'src-2#1');
  assert.notEqual(a2.instanceId, b1.instanceId);
});

test('角度工具：归一化与夹角', () => {
  assert.equal(angularDistanceDeg(-90, 90), 180);
  assert.equal(angularDistanceDeg(-90, -25), 65);
  assert.equal(angularDistanceDeg(170, -170), 20);
});

test('只播放防御动作而不进入姿态，不会产生招架', () => {
  const a = adjAt('buckler');
  // 模拟"动画在播但没有 enterGuard"：裁决器仍处于无姿态状态
  const v0 = a.beginContact(attack({ startMs: 1100 }), 1100);
  assert.equal(v0, null);
  const v1 = a.endContact('i-1', 1400);
  assert.equal(v1.verdict, VERDICT.HIT);
});
