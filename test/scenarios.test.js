'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { World } = require('../src/simulation');
const { scenarios } = require('../src/scenarios');
const { Adjudicator, AttackSource, MOVE_NATURE, VERDICT, resetSourceSerial } = require('../src/adjudicator');

function runScenario(scenario, stepBatch = 1) {
  resetSourceSerial(); // 每次运行从同一编号开始，保证签名可跨频率比较
  const world = new World();
  scenario.build(world);
  if (stepBatch === 1) {
    world.advanceTo(scenario.durationMs);
  } else {
    // 模拟稀疏的渲染/观测频率：逻辑仍按固定步长推进，只是外层批量推进
    let t = 0;
    while (t < scenario.durationMs) {
      for (let i = 0; i < stepBatch && t < scenario.durationMs; i += 1) {
        world.step();
        t = world.tMs;
      }
    }
  }
  return world;
}

function findVerdict(world, matcher) {
  return world.verdicts.find((v) =>
    Object.entries(matcher).every(([k, val]) => v[k] === val),
  );
}

function checkExpectation(scenario, world, exp) {
  const v = findVerdict(world, exp.match);
  assert.ok(v, `场景 ${scenario.id}: 未找到匹配 ${JSON.stringify(exp.match)} 的裁决`);
  assert.equal(
    v.verdict, exp.verdict,
    `场景 ${scenario.id} ${JSON.stringify(exp.match)}: 预期 ${exp.verdict}，实际 ${v.verdict}（${exp.note}）`,
  );
  if (exp.judgedAtMs !== undefined) {
    assert.equal(v.judgedAtMs, exp.judgedAtMs, `场景 ${scenario.id}: 判定时刻应为 ${exp.judgedAtMs}`);
  }
  if (exp.judgedAtMsBetween) {
    const [lo, hi] = exp.judgedAtMsBetween;
    assert.ok(
      v.judgedAtMs >= lo && v.judgedAtMs <= hi,
      `场景 ${scenario.id}: 判定时刻 ${v.judgedAtMs} 不在 [${lo},${hi}]`,
    );
  }
}

for (const scenario of scenarios) {
  test(`场景 ${scenario.id}：${scenario.title} —— 预期结果逐条核对`, () => {
    const world = runScenario(scenario);
    assert.equal(
      world.verdicts.length, scenario.expected.length,
      `场景 ${scenario.id}: 裁决数量应等于预期条目数`,
    );
    for (const exp of scenario.expected) checkExpectation(scenario, world, exp);
  });
}

test('场景 A：两个攻击的采用判定时刻均被记录并可展示', () => {
  const world = runScenario(scenarios.find((s) => s.id === 'A'));
  for (const v of world.verdicts) {
    assert.equal(typeof v.judgedAtMs, 'number');
    assert.ok(v.adoptedContact, '应记录被采用的接触点用于画面标注');
  }
});

test('渲染/观测频率变化不改变防御成功率：4 种批量步长下裁决完全一致', () => {
  const signatures = [];
  for (const batch of [1, 2, 3, 7]) {
    const sig = scenarios.map((scenario) => {
      const world = runScenario(scenario, batch);
      return world.verdicts
        .map((v) => `${v.instanceId}:${v.verdict}@${v.judgedAtMs}`)
        .join('|');
    });
    signatures.push(sig);
  }
  for (let i = 1; i < signatures.length; i += 1) {
    assert.deepEqual(signatures[i], signatures[0], `批量 ${i + 1} 与基准裁决不一致`);
  }
});

test('防御成功率统计在不同频率下恒定', () => {
  function successRate(batch) {
    let parry = 0;
    let block = 0;
    let hit = 0;
    for (const scenario of scenarios) {
      const world = runScenario(scenario, batch);
      for (const v of world.verdicts) {
        if (v.verdict === VERDICT.PARRY) parry += 1;
        else if (v.verdict === VERDICT.BLOCK) block += 1;
        else hit += 1;
      }
    }
    return { parry, block, hit };
  }
  const base = successRate(1);
  for (const batch of [2, 3, 7]) {
    assert.deepEqual(successRate(batch), base);
  }
  assert.ok(base.parry > 0 && base.block > 0 && base.hit > 0, '三类结果都应在样例中出现');
});

test('接触点上报落在不同时间栅格上，裁决结果与判定时刻不变', () => {
  function drive(gridMs) {
    const adj = new Adjudicator({ initialEquipment: 'buckler' });
    adj.setFacing(-90, 0);
    const src = new AttackSource('grid');
    const atk = src.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 0 });
    adj.enterGuard(100);
    adj.beginContact(atk, 100);
    for (let t = 100 + gridMs; t < 500; t += gridMs) {
      adj.addContactPoint(atk.instanceId, t);
    }
    return adj.endContact(atk.instanceId, 500);
  }
  const r1 = drive(16);
  const r2 = drive(33);
  const r3 = drive(50);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.verdict, VERDICT.PARRY);
    assert.equal(r.judgedAtMs, 100);
  }
});

test('长时间不推进逻辑、只改变渲染节奏（无事件）不会产生或改写裁决', () => {
  const world = new World();
  scenarios[0].build(world);
  world.advanceTo(2050);
  const before = world.verdicts.length;
  // 空闲推进：没有新接触/姿态事件
  world.advanceTo(2050);
  world.advanceTo(2060);
  assert.equal(world.verdicts.length, before);
});

test('无姿态时设定朝向，进入姿态瞬间按该朝向裁决（朝向同步回归）', () => {
  const world = new World();
  const src = world.source('facing-sync');
  world.setFacing(-90); // 朝北，此时无姿态
  const atk = src.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 100 });
  world.injectContact(atk, 100, { x: 0, y: -30 }); // 无防御 -> 等待
  assert.deepEqual(world.adj.pendingInstanceIds(), [atk.instanceId]);
  world.tMs = 200;
  world.setGuardInput(true); // 进入姿态瞬间重新裁决等待中的接触
  const v = world.verdicts.find((x) => x.instanceId === atk.instanceId);
  assert.ok(v, '进入姿态后应立即裁决等待中的接触');
  assert.equal(v.verdict, VERDICT.PARRY);
  assert.equal(v.judgedAtMs, 200);
});
