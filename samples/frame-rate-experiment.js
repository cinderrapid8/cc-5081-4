'use strict';

// 帧率/观测频率不变性实验：以不同的外层批量步长重放全部场景，
// 比对裁决结果与判定时刻是否完全一致。
// 运行：node samples/frame-rate-experiment.js

const { World } = require('../src/simulation');
const { scenarios } = require('../src/scenarios');
const { resetSourceSerial } = require('../src/adjudicator');

function replay(scenario, batchSteps) {
  resetSourceSerial();
  const world = new World();
  scenario.build(world);
  let steps = 0;
  while (world.tMs < scenario.durationMs) {
    for (let i = 0; i < batchSteps && world.tMs < scenario.durationMs; i += 1) {
      world.step();
      steps += 1;
    }
    if (batchSteps > 1 && world.tMs < scenario.durationMs) {
      // 模拟更低观测频率下两次采样之间没有任何外部读取
    }
  }
  return {
    steps,
    signature: world.verdicts
      .map((v) => `${v.instanceId}:${v.verdict}@${v.judgedAtMs}`)
      .join('|'),
    counts: world.verdicts.reduce((acc, v) => {
      acc[v.verdict] = (acc[v.verdict] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

const batches = [1, 2, 3, 5, 10]; // 相当于 100Hz / 50Hz / 33Hz / 20Hz / 10Hz 观测
let allEqual = true;

for (const scenario of scenarios) {
  console.log(`场景 ${scenario.id}：${scenario.title}`);
  const baseline = replay(scenario, 1);
  for (const b of batches) {
    const r = replay(scenario, b);
    const ok = r.signature === baseline.signature;
    allEqual = allEqual && ok;
    console.log(
      `  批量 ${String(b).padStart(2)} 步 | 逻辑步 ${String(r.steps).padStart(4)} | ` +
      `${JSON.stringify(r.counts).padEnd(34)} | ${ok ? '一致' : '不一致'}`,
    );
  }
}

console.log(allEqual
  ? '\n结论：改变渲染/观测频率不改变任何裁决与防御成功率。'
  : '\n结论：检测到差异！');
process.exitCode = allEqual ? 0 : 1;
