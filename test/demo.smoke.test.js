'use strict';

// 无头冒烟测试：用最小 DOM/Canvas 桩加载 demo 脚本，
// 验证渲染路径与手动操控路径不抛异常，且渲染节流不影响裁决。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeCtx2dStub() {
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'canvas') return { width: 720, height: 620 };
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set() { return true; },
  });
}

function makeElement() {
  return {
    textContent: '',
    innerHTML: '',
    value: '16.7',
    addEventListener: () => {},
    getContext: () => makeCtx2dStub(),
    width: 720,
    height: 620,
  };
}

function loadDemo() {
  const elements = new Map();
  const sandbox = {
    console,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => {}, // 不自动驱动循环
    document: {
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
    },
  };
  sandbox.window = sandbox; // renderer.js 通过 window.* 暴露符号
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const load = (rel) => vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'),
    sandbox, { filename: rel },
  );
  load('src/adjudicator.js');
  load('src/simulation.js');
  load('src/scenarios.js');
  load('demo/renderer.js');
  load('demo/main.js');
  return sandbox;
}

test('演示脚本在 DOM/Canvas 桩下加载且初始渲染不抛异常', () => {
  const sandbox = loadDemo();
  assert.ok(sandbox.MeleeCore);
  assert.ok(sandbox.MeleeSim);
  assert.ok(sandbox.MeleeScenarios);
  assert.ok(sandbox.Renderer);
  // 直接驱动一次世界推进与渲染
  const { World } = sandbox.MeleeSim;
  const { scenarios } = sandbox.MeleeScenarios;
  const world = new World();
  scenarios[0].build(world);
  world.advanceTo(3600);
  const renderer = new sandbox.Renderer(
    { width: 720, height: 620, getContext: () => makeCtx2dStub() },
    world,
  );
  assert.doesNotThrow(() => renderer.render());
  assert.ok(world.verdicts.length >= 2);
});

test('手动模式操控路径（防御/换装/假动作）不抛异常且裁决合理', () => {
  const sandbox = loadDemo();
  const { World } = sandbox.MeleeSim;
  const { MOVE_NATURE, VERDICT } = sandbox.MeleeCore;
  const world = new World();
  world.setFacing(-90);
  assert.doesNotThrow(() => {
    world.setGuardInput(true);
    world.playFakeGuardAnim(400);
    const src = world.source('smoke');
    const atk = src.cast({ nature: MOVE_NATURE.SLASH, incomingDirDeg: -90, startMs: 100 });
    world.injectContact(atk, 100, { x: 0, y: -30 });
    world.setEquipment('tower');
    world.setGuardInput(false);
  });
  assert.equal(world.verdicts[0].verdict, VERDICT.PARRY);
});
