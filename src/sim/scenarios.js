// Scripted demonstrations.
//
// Each scenario builds a deterministic action list on the arena timeline and
// declares the results it is meant to show. The test suite keeps its own
// independently authored copy of these expectations; the copies are cross-checked
// so a mistaken demo label cannot silently mask a wrong verdict.

import { makeContacts } from './arena.js';

const contact = (arrivalAt, angleDeg, weapon, move, contactIndex = 0, confirmed = true) => ({
  contactIndex,
  arrivalAt,
  arrivalAngleDeg: angleDeg,
  weapon,
  move,
  confirmed,
});

function slashScrape({ startAt, count, gapMs, angleDeg = 0, weapon = 'sword', move = 'slash' }) {
  const contacts = [];
  for (let i = 0; i < count; i += 1) {
    contacts.push(contact(startAt + i * gapMs, angleDeg, weapon, move, i));
  }
  return contacts;
}

export const SCENARIOS = [
  {
    id: 'front-and-back',
    title: '前后方同时到达',
    blurb: '正面接触按普通防御覆盖，背后来袭即使同时到达也只能受击。',
    durationMs: 1500,
    expected: [
      { attackId: 'front-0', outcome: 'block', reason: 'block-cover', settledAt: 1000, adoptedContactIndex: 0, damage: 4 },
      { attackId: 'back-0', outcome: 'hit', reason: 'rear-attack', settledAt: 1000, adoptedContactIndex: 0, damage: 14 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'front-brute');
      arena.actions.spawn(0, 'back-brute');
      arena.actions.startGuard(700);
      arena.actions.attack(900, {
        attackId: 'front-0',
        actorTag: 'front-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
      arena.actions.attack(900, {
        attackId: 'back-0',
        actorTag: 'back-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 180, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'long-contact',
    title: '长持续接触',
    blurb: '同一次攻击有 9 个接触点，只采用最早一个判定时刻，其余全部标记为已取代。',
    durationMs: 1600,
    expected: [
      { attackId: 'scrape-0', outcome: 'parry', reason: 'parry-window', settledAt: 1000, adoptedContactIndex: 0, damage: 0, contactsSeen: 9, superseded: 8 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'scraper');
      arena.actions.startGuard(900);
      arena.actions.facing(900, 0);
      arena.actions.attack(950, {
        attackId: 'scrape-0',
        actorTag: 'scraper',
        weapon: 'sword',
        move: 'slash',
        contacts: slashScrape({ startAt: 1000, count: 9, gapMs: 50, angleDeg: 10 }),
      });
    },
  },
  {
    id: 'window-edge',
    title: '窗口边缘',
    blurb: '抬盾时刻恰好落在窗口起点、起点前 1ms、撞击瞬间；另有在撞击瞬间退出防御。',
    durationMs: 2700,
    expected: [
      { attackId: 'edge-in', outcome: 'parry', reason: 'parry-window', settledAt: 1000, adoptedContactIndex: 0, damage: 0 },
      { attackId: 'edge-before', outcome: 'block', reason: 'block-cover', settledAt: 1500, adoptedContactIndex: 0, damage: 4 },
      { attackId: 'edge-instant', outcome: 'parry', reason: 'parry-window', settledAt: 2000, adoptedContactIndex: 0, damage: 0 },
      { attackId: 'edge-exit', outcome: 'hit', reason: 'guard-exited-before-arrival', settledAt: 2500, adoptedContactIndex: 0, damage: 14 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'edge-brute');
      arena.actions.startGuard(720);
      arena.actions.attack(800, {
        attackId: 'edge-in',
        actorTag: 'edge-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
      arena.actions.exitGuard(1100);
      arena.actions.startGuard(1219);
      arena.actions.attack(1300, {
        attackId: 'edge-before',
        actorTag: 'edge-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1500, 0, 'sword', 'slash')],
      });
      arena.actions.exitGuard(1600);
      arena.actions.startGuard(2000);
      arena.actions.attack(1900, {
        attackId: 'edge-instant',
        actorTag: 'edge-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(2000, 0, 'sword', 'slash')],
      });
      arena.actions.exitGuard(2100);
      arena.actions.startGuard(2200);
      arena.actions.exitGuard(2500);
      arena.actions.attack(2300, {
        attackId: 'edge-exit',
        actorTag: 'edge-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(2500, 0, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'equipment-switch',
    title: '装备切换即时生效',
    blurb: '抬盾后在窗口内卸下武器：精准窗口命中但装备无法招架，判普通防御；再装回后恢复招架。',
    durationMs: 1800,
    expected: [
      { attackId: 'gear-drop', outcome: 'block', reason: 'equipment-cannot-parry', settledAt: 1000, adoptedContactIndex: 0, damage: 14 },
      { attackId: 'gear-restore', outcome: 'parry', reason: 'parry-window', settledAt: 1400, adoptedContactIndex: 0, damage: 0 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'gear-brute');
      arena.actions.startGuard(800);
      arena.actions.equipment(900, 'unarmed');
      arena.actions.attack(950, {
        attackId: 'gear-drop',
        actorTag: 'gear-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
      arena.actions.exitGuard(1100);
      arena.actions.equipment(1150, 'sword_shield');
      arena.actions.startGuard(1250);
      arena.actions.equipment(1300, 'unarmed');
      arena.actions.equipment(1350, 'sword_shield');
      arena.actions.attack(1300, {
        attackId: 'gear-restore',
        actorTag: 'gear-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1400, 0, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'facing-at-arrival',
    title: '朝向在撞击时刻结算',
    blurb: '抬盾时背对攻击，撞击前 50ms 转身：按撞击时刻朝向判定为招架；随后转回则锥外受击。',
    durationMs: 1900,
    expected: [
      { attackId: 'facing-in', outcome: 'parry', reason: 'parry-window', settledAt: 1000, adoptedContactIndex: 0, damage: 0 },
      { attackId: 'facing-out', outcome: 'hit', reason: 'outside-block-cone', settledAt: 1600, adoptedContactIndex: 0, damage: 14 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'facing-brute');
      arena.actions.startGuard(800);
      arena.actions.facing(950, 90);
      arena.actions.attack(900, {
        attackId: 'facing-in',
        actorTag: 'facing-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 90, 'sword', 'slash')],
      });
      arena.actions.facing(1500, 0);
      arena.actions.attack(1550, {
        attackId: 'facing-out',
        actorTag: 'facing-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1600, 90, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'guard-exit-immediate',
    title: '防御姿态退出即时生效',
    blurb: '退出后 100ms 到达的攻击直接受击；重新抬盾后恢复招架。',
    durationMs: 1700,
    expected: [
      { attackId: 'exit-early', outcome: 'hit', reason: 'guard-exited-before-arrival', settledAt: 1000, adoptedContactIndex: 0, damage: 14 },
      { attackId: 'exit-recover', outcome: 'parry', reason: 'parry-window', settledAt: 1400, adoptedContactIndex: 0, damage: 0 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'exit-brute');
      arena.actions.startGuard(800);
      arena.actions.exitGuard(900);
      arena.actions.attack(850, {
        attackId: 'exit-early',
        actorTag: 'exit-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
      arena.actions.startGuard(1300);
      arena.actions.attack(1350, {
        attackId: 'exit-recover',
        actorTag: 'exit-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1400, 0, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'animation-trap',
    title: '播放防御动作 ≠ 招架成功',
    blurb: '只播放抬盾动画，台账里没有防御区间，判定为受击。',
    durationMs: 1500,
    expected: [
      { attackId: 'anim-0', outcome: 'hit', reason: 'no-guard-active', settledAt: 1000, adoptedContactIndex: 0, damage: 14 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'anim-brute');
      arena.actions.animGuard(700, 1200);
      arena.actions.attack(900, {
        attackId: 'anim-0',
        actorTag: 'anim-brute',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'respawn-identity',
    title: '重复生成不混淆攻击源',
    blurb: '旧生成本体在死亡前发出的攻击抵达时已失效；新生成本体使用全新编号并正常结算。',
    durationMs: 1600,
    expected: [
      { attackId: 'stale-0', outcome: null, reason: 'unknown-or-dead-source', settled: false, settledAt: null },
      { attackId: 'fresh-0', outcome: 'parry', reason: 'parry-window', settledAt: 1000, adoptedContactIndex: 0, damage: 0 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'grunt');
      arena.actions.attack(300, {
        attackId: 'stale-0',
        actorTag: 'grunt',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
      arena.actions.despawn(400, 'grunt');
      arena.actions.spawn(500, 'grunt');
      arena.actions.startGuard(800);
      arena.actions.attack(900, {
        attackId: 'fresh-0',
        actorTag: 'grunt',
        weapon: 'sword',
        move: 'slash',
        contacts: [contact(1000, 0, 'sword', 'slash')],
      });
    },
  },
  {
    id: 'move-nature',
    title: '招式性质决定资格',
    blurb: '盾击可挡不可招；抓取无视防御；劈砍在精准窗口内可招架。',
    durationMs: 1900,
    expected: [
      { attackId: 'move-bash', outcome: 'block', reason: 'unparryable-move', settledAt: 1000, adoptedContactIndex: 0, damage: 3 },
      { attackId: 'move-grab', outcome: 'hit', reason: 'guard-bypass', settledAt: 1200, adoptedContactIndex: 0, damage: 10 },
      { attackId: 'move-over', outcome: 'parry', reason: 'parry-window', settledAt: 1700, adoptedContactIndex: 0, damage: 0 },
    ],
    build(arena) {
      arena.actions.spawn(0, 'move-brute');
      arena.actions.startGuard(800);
      arena.actions.attack(900, {
        attackId: 'move-bash',
        actorTag: 'move-brute',
        weapon: 'sword',
        move: 'bash',
        contacts: [contact(1000, 0, 'sword', 'bash')],
      });
      arena.actions.attack(1100, {
        attackId: 'move-grab',
        actorTag: 'move-brute',
        weapon: 'dagger',
        move: 'grab',
        contacts: [contact(1200, 0, 'dagger', 'grab')],
      });
      arena.actions.exitGuard(1450);
      arena.actions.startGuard(1500);
      arena.actions.attack(1600, {
        attackId: 'move-over',
        actorTag: 'move-brute',
        weapon: 'sword',
        move: 'overhead',
        contacts: [contact(1700, 0, 'sword', 'overhead')],
      });
    },
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.id, scenario]));
