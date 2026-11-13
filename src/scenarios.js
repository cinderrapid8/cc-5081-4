(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./adjudicator'));
  } else root.MeleeScenarios = factory(root.MeleeCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
'use strict';

// 脚本化演示场景：build 编排事件；expected 是独立列出的预期结果。
// 预期时刻：judgedAtMs 精确相等；judgedAtMsBetween:[lo,hi] 容差区间。
// 角度约定：0°=东(+x)，90°=南(+y)，-90°=北(-y)，180°=西(-x)。

const { MOVE_NATURE, VERDICT } = core;

// 角度约定：0°=东(+x)，90°=南(+y)，-90°=北(-y)，180°=西(-x)。
// 由相对防守者的来袭方位角与距离生成初始位置；速度沿该方位指向防守者。
function radial(bearingDeg, range, speed) {
  const rad = (bearingDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = -Math.sin(rad);
  return {
    startPos: { x: range * ux, y: range * uy },
    velocity: { x: -speed * ux, y: -speed * uy },
  };
}

const scenarios = [];

// ---------------------------------------------------------------------------
// 场景 A：前方与后方攻击同时到达
// 防御在接触前约 100ms 开始 -> 前方落在精准招架窗口内 -> 招架；
// 后方超出格挡覆盖区 -> 接触结束时受击。
// ---------------------------------------------------------------------------
scenarios.push({
  id: 'A',
  title: 'A. 前后方同时到达的攻击',
  durationMs: 3600,
  build(world) {
    const front = world.source('front-dummy');
    const rear = world.source('rear-dummy');
    world.at(0, (w) => {
      w.setFacing(-90); // 面朝北
      // 北侧攻击，向南飞行
      w.fire(front, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 2100,
      }, { startPos: { x: 0, y: -200 }, velocity: { x: 0, y: 80 }, radius: 14 });
      // 南侧攻击，向北飞行
      w.fire(rear, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: 90, startMs: 2100,
      }, { startPos: { x: 0, y: 200 }, velocity: { x: 0, y: -80 }, radius: 14 });
    });
    world.at(2000, (w) => w.setGuardInput(true));
  },
  expected: [
    { match: { sourceId: 'src-1' }, verdict: VERDICT.PARRY, judgedAtMsBetween: [2080, 2120], note: '前方：防御开始后约 100ms，处于精准招架窗口与扇形内' },
    { match: { sourceId: 'src-2' }, verdict: VERDICT.HIT, judgedAtMsBetween: [2880, 2920], note: '后方：超出格挡覆盖区，接触结束时结算受击' },
  ],
});

// ---------------------------------------------------------------------------
// 场景 B：长持续接触（接触约 3000ms 开始、6200ms 才结束；4000ms 才进入防御）
// 北侧攻击与朝向一致：进入姿态瞬间落入精准招架窗口与扇形 -> 招架
// 偏东攻击与朝向夹角 65°：超出精准扇形(±55°)但在格挡覆盖区(±75°)内 -> 格挡
// 两者采用的判定时刻都是防御开始时刻 4000，而不是首次接触时刻。
// ---------------------------------------------------------------------------
scenarios.push({
  id: 'B',
  title: 'B. 长持续接触（资格在接触期间变化）',
  durationMs: 7600,
  build(world) {
    const eastish = world.source('east-dummy');
    const north = world.source('north-dummy');
    world.at(0, (w) => {
      w.setFacing(-90);
      // 来袭方向 -25°，与朝向夹角 65°：精准扇形外、格挡覆盖区内
      w.fire(eastish, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: -25, startMs: 3000,
      }, { ...radial(-25, 92, 20), radius: 14 });
      // 北侧慢速攻击：与朝向夹角 0°
      w.fire(north, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 3000,
      }, { ...radial(-90, 92, 20), radius: 14 });
    });
    world.at(4000, (w) => w.setGuardInput(true)); // 接触开始约 1s 后才防御
  },
  expected: [
    { match: { sourceId: 'src-1' }, verdict: VERDICT.BLOCK, judgedAtMs: 4000, note: '偏东：精准招架扇形外但格挡覆盖区内 -> 格挡；判定时刻=防御开始 4000' },
    { match: { sourceId: 'src-2' }, verdict: VERDICT.PARRY, judgedAtMs: 4000, note: '正北：进入姿态即满足窗口与精准扇形 -> 招架；判定时刻=4000' },
  ],
});

// ---------------------------------------------------------------------------
// 场景 C：恰好位于窗口边缘（注入精确时刻的已确认接触，不依赖物理步长）
// 小圆盾招架窗口 250ms：[2000, 2250)
//   2249 接触 -> 招架；2250 接触 -> 窗口恰好关闭 -> 格挡
// 另含：突刺可招架；重击不可招架（即使在窗口内也仅格挡）。
// ---------------------------------------------------------------------------
scenarios.push({
  id: 'C',
  title: 'C. 精准招架窗口边缘（半开区间，边缘固定语义）',
  durationMs: 2600,
  build(world) {
    const s = world.source('edge-rig');
    const mk = (cast, nature, dir, start, end) =>
      s.cast({ nature, incomingDirDeg: dir, startMs: start, endMs: end });
    const front = { x: 0, y: -60 };

    world.at(0, (w) => w.setFacing(-90));
    world.at(2000, (w) => w.setGuardInput(true));
    world.at(2100, (w) => {
      w.injectContact(mk(1, MOVE_NATURE.THRUST, -90, 2100, 2300), 2100, front);
    });
    world.at(2100, (w) => {
      w.injectContact(mk(2, MOVE_NATURE.HEAVY, -90, 2100, 2300), 2100, { x: 0, y: -95 });
    });
    world.at(2249, (w) => {
      w.injectContact(mk(3, MOVE_NATURE.SLASH, -90, 2249, 2400), 2249, front);
    });
    world.at(2250, (w) => {
      w.injectContact(mk(4, MOVE_NATURE.SLASH, -90, 2250, 2400), 2250, front);
    });
  },
  expected: [
    { match: { castSerial: 1 }, verdict: VERDICT.PARRY, judgedAtMs: 2100, note: '突刺在窗口与精准扇形内 -> 招架' },
    { match: { castSerial: 2 }, verdict: VERDICT.BLOCK, judgedAtMs: 2100, note: '重击不可招架，普通格挡覆盖 -> 格挡' },
    { match: { castSerial: 3 }, verdict: VERDICT.PARRY, judgedAtMs: 2249, note: '2249ms：窗口 [2000,2250) 内最后 1ms' },
    { match: { castSerial: 4 }, verdict: VERDICT.BLOCK, judgedAtMs: 2250, note: '2250ms：恰好位于窗口结束边缘，半开区间排除招架 -> 格挡' },
  ],
});

// ---------------------------------------------------------------------------
// 场景 D：装备切换与防御姿态退出立即改变适用规则
// D1 后方接触在小圆盾下不满足覆盖 -> 等待；3500ms 切换塔盾(±150°) -> 立即格挡
// D2 前方攻击先被格挡，4600ms 退出姿态 -> 裁决保持（同一攻击只结算一次）
// D3 新姿态内招架一次，随后切换装备 -> 裁决保持
// ---------------------------------------------------------------------------
scenarios.push({
  id: 'D',
  title: 'D. 装备切换 / 姿态退出即时生效',
  durationMs: 6200,
  build(world) {
    const rear = world.source('rear-switch');
    const front = world.source('front-lock');
    const front2 = world.source('parry-lock');

    world.at(0, (w) => {
      w.setFacing(-90);
      // 斜后 135°（方位角 45°）：小圆盾格挡 ±75° 不含，塔盾 ±150° 含
      // 约 3000ms 接触开始，6200ms 结束
      w.fire(rear, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: 45, startMs: 3000,
      }, { ...radial(45, 92, 20), radius: 14 });
    });
    world.at(2500, (w) => w.setGuardInput(true));   // 小圆盾：后方超出覆盖，保持等待
    world.at(3500, (w) => w.setEquipment('tower')); // 接触中切换塔盾 -> 立即获得覆盖

    // D2：前方攻击在塔盾姿态内被格挡，随后退出姿态
    world.at(4000, (w) => {
      w.fire(front, {
        nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 4490,
      }, { startPos: { x: 0, y: -72 }, velocity: { x: 0, y: 80 }, radius: 14 });
    });
    world.at(4600, (w) => w.setGuardInput(false));

    // D3：重新进入姿态（小圆盾）招架一次，再切换迅捷剑
    world.at(5000, (w) => {
      w.setEquipment('buckler');
      w.setGuardInput(true);
    });
    world.at(5050, (w) => {
      w.fire(front2, {
        nature: MOVE_NATURE.THRUST, incomingDirDeg: -90, startMs: 5140,
      }, { startPos: { x: 0, y: -40 }, velocity: { x: 0, y: 80 }, radius: 14 });
    });
    world.at(5300, (w) => w.setEquipment('rapier'));
  },
  expected: [
    { match: { sourceId: 'src-1' }, verdict: VERDICT.BLOCK, judgedAtMs: 3500, note: '切换塔盾瞬间后方获得覆盖 -> 格挡，判定时刻=切换时刻' },
    { match: { sourceId: 'src-2' }, verdict: VERDICT.BLOCK, judgedAtMsBetween: [4460, 4520], note: '前方在塔盾覆盖区 -> 格挡；4600ms 退出姿态不改判' },
    { match: { sourceId: 'src-3' }, verdict: VERDICT.PARRY, judgedAtMsBetween: [5120, 5160], note: '新姿态窗口内招架；5300ms 换装不改判' },
  ],
});

return { scenarios };
});
