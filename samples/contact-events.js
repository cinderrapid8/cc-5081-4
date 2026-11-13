'use strict';

// 可直接喂给裁决接口的事件样例。
// 运行：node samples/contact-events.js
// 这些样例只演示接口用法与输入/输出形状，不依赖渲染或物理层。

const {
  Adjudicator,
  AttackSource,
  MOVE_NATURE,
  VERDICT,
} = require('../src/adjudicator');

function line() {
  console.log('-'.repeat(72));
}

function show(title, v) {
  console.log(`【${title}】`);
  console.log(JSON.stringify(v, null, 2));
  line();
}

// --- 样例 1：招架（窗口内 + 精准扇形内） -----------------------------------
function sampleParry() {
  const adj = new Adjudicator({ initialEquipment: 'buckler' });
  adj.facingDeg = -90;
  const src = new AttackSource('training-dummy');
  const atk = src.cast({
    nature: MOVE_NATURE.SLASH,
    incomingDirDeg: -90,
    startMs: 1100,
  });
  adj.enterGuard(1000); // 1000ms 进入防御
  const verdict = adj.beginContact(atk, 1100, { x: 0, y: -32 });
  show('样例1 招架：防御后 100ms 的正面斩击', verdict);
}

// --- 样例 2：格挡（窗口已关闭，但仍在普通覆盖区） ---------------------------
function sampleBlock() {
  const adj = new Adjudicator({ initialEquipment: 'buckler' });
  adj.facingDeg = -90;
  const src = new AttackSource('training-dummy');
  const atk = src.cast({
    nature: MOVE_NATURE.SLASH,
    incomingDirDeg: -90,
    startMs: 1400,
  });
  adj.enterGuard(1000); // 招架窗口 [1000,1250)
  const verdict = adj.beginContact(atk, 1400, { x: 0, y: -32 });
  show('样例2 格挡：窗口关闭后的正面攻击', verdict);
}

// --- 样例 3：长持续接触，接触中进入防御，采用防御开始时刻 -------------------
function sampleLongContact() {
  const adj = new Adjudicator({ initialEquipment: 'buckler' });
  adj.facingDeg = -90;
  const src = new AttackSource('training-dummy');
  const atk = src.cast({
    nature: MOVE_NATURE.SLASH,
    incomingDirDeg: -25, // 与朝向夹角 65°：精准扇形外、格挡覆盖区内
    startMs: 3000,
    endMs: 6200,
  });
  adj.beginContact(atk, 3000, { x: 83, y: -39 });
  adj.addContactPoint(atk.instanceId, 3500, { x: 75, y: -35 });
  // 此时仍无防御 -> 不裁决
  adj.enterGuard(4000);
  const verdict = adj.getVerdict(atk.instanceId);
  show('样例3 长持续接触：4000ms 才防御，判定时刻锁定 4000', verdict);
}

// --- 样例 4：同一攻击多个接触点只结算一次 -----------------------------------
function sampleMultiPoint() {
  const adj = new Adjudicator({ initialEquipment: 'buckler' });
  adj.facingDeg = -90;
  const src = new AttackSource('training-dummy');
  const atk = src.cast({
    nature: MOVE_NATURE.THRUST,
    incomingDirDeg: -90,
    startMs: 1100,
  });
  adj.enterGuard(1000);
  adj.beginContact(atk, 1100);
  adj.addContactPoint(atk.instanceId, 1110);
  adj.addContactPoint(atk.instanceId, 1120);
  const verdict = adj.endContact(atk.instanceId, 1300);
  show('样例4 多接触点：一次招架，contactCount 记录全部接触', verdict);
}

// --- 样例 5：攻击源重复生成编号不混淆 ---------------------------------------
function sampleSourceIds() {
  const s1 = new AttackSource('enemy-A');
  const s2 = new AttackSource('enemy-B');
  const events = [
    s1.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: 0, startMs: 0 }),
    s1.cast({ nature: MOVE_NATURE.HEAVY, incomingDirDeg: 0, startMs: 500 }),
    s2.cast({ nature: MOVE_NATURE.THRUST, incomingDirDeg: 90, startMs: 0 }),
  ].map((a) => ({ instanceId: a.instanceId, sourceId: a.sourceId, castSerial: a.castSerial, nature: a.nature }));
  show('样例5 攻击源编号：跨源、跨次生成均唯一', events);
}

if (require.main === module) {
  sampleParry();
  sampleBlock();
  sampleLongContact();
  sampleMultiPoint();
  sampleSourceIds();
  console.log('结果类别常量：', VERDICT);
}

module.exports = { sampleParry, sampleBlock, sampleLongContact, sampleMultiPoint, sampleSourceIds };
