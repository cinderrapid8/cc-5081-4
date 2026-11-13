'use strict';

// 演示入口：固定步长逻辑（10ms）与渲染频率解耦。
// 渲染频率下拉框只改变画面重绘节奏；逻辑步进次数完全由累计真实时间决定，
// 因此降低渲染频率不会改变任何裁决结果或防御成功率。

/* global MeleeCore, MeleeSim, MeleeScenarios, Renderer, makeHudRefs, updateHud, bindManualControls, applyManualMovement */

const { World } = MeleeSim;
const { scenarios } = MeleeScenarios;
const canvas = document.getElementById('stage');
const hud = makeHudRefs();

let world = new World();
let renderer = new Renderer(canvas, world);
let mode = 'A';
let running = false;
let lastFrameMs = performance.now();
let simTimeMs = 0;
let renderEveryMs = 16.7;
let lastDrawMs = 0;
let keys = new Set();

function expectedMapFor(id) {
  const map = new Map();
  const sc = scenarios.find((s) => s.id === id);
  if (!sc) return map;
  for (const exp of sc.expected) {
    const srcNum = exp.match.sourceId ? Number(exp.match.sourceId.split('-')[1]) : 1;
    const cast = exp.match.castSerial ?? 1;
    map.set(`src-${srcNum}#${cast}`, exp);
  }
  return map;
}

function scheduleManualAttacks(w) {
  const src = w.source('manual-spawner');
  const natures = ['slash', 'thrust', 'heavy'];
  for (let i = 0; i < 6; i += 1) {
    const t = 1500 + i * 1800;
    w.at(t, (inner) => {
      const bearing = i % 2 === 0 ? -90 : 45;
      const range = 200;
      const rad = (bearing * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = -Math.sin(rad);
      inner.fire(src, {
        nature: natures[i % natures.length],
        incomingDirDeg: bearing,
        startMs: t,
      }, {
        startPos: { x: range * ux, y: range * uy },
        velocity: { x: -90 * ux, y: -90 * uy },
        radius: 14,
      });
    });
  }
}

function loadScenario(id) {
  mode = id;
  running = false;
  simTimeMs = 0;
  lastFrameMs = performance.now();

  if (id === 'M') {
    world = new World();
    world.setFacing(-90);
    scheduleManualAttacks(world);
    keys = bindManualControls(world);
    document.getElementById('scenario-title').textContent = '手动模式：空格防御 / A·D 转向 / 1-4 换装 / G 假动作';
  } else {
    const sc = scenarios.find((s) => s.id === id);
    world = new World();
    sc.build(world);
    document.getElementById('scenario-title').textContent = sc.title;
  }
  renderer = new Renderer(canvas, world);
  updateHud(hud, world, expectedMapFor(mode));
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(100, nowMs - lastFrameMs);
  lastFrameMs = nowMs;

  if (running) {
    simTimeMs += elapsed;
    // 逻辑始终按固定 10ms 步长追赶模拟时间，与重绘节奏无关
    let guard = 0;
    while (world.tMs < simTimeMs && guard < 1000) {
      world.step();
      guard += 1;
    }
    if (mode !== 'M') {
      const sc = scenarios.find((s) => s.id === mode);
      if (world.tMs >= sc.durationMs && world.timeline.length === 0) running = false;
    }
  }

  if (mode === 'M') applyManualMovement(world, keys);

  // 渲染节流：仅控制何时重绘，不触碰逻辑时间
  if (nowMs - lastDrawMs >= renderEveryMs) {
    lastDrawMs = nowMs;
    renderer.render();
    updateHud(hud, world, expectedMapFor(mode));
  }
}

document.getElementById('btn-play').addEventListener('click', () => {
  running = true;
  lastFrameMs = performance.now();
});
document.getElementById('btn-pause').addEventListener('click', () => { running = false; });
document.getElementById('btn-reset').addEventListener('click', () => loadScenario(mode));
document.getElementById('scenario-select').addEventListener('change', (e) => loadScenario(e.target.value));
document.getElementById('render-rate').addEventListener('change', (e) => {
  renderEveryMs = Number(e.target.value);
  document.getElementById('rate-label').textContent = `${renderEveryMs}ms/帧（仅画面）`;
});

requestAnimationFrame(frame);
loadScenario('A');
