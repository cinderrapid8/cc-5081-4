# 近战格挡裁决模块

输入**已确认的接触事件**，输出 **格挡 / 招架 / 受击** 三种结果。本模块不做碰撞检测，也不重新实现碰撞引擎；它只负责裁决。

```bash
npm test          # 56 项单元 / 场景 / 不变性 / 接口测试
npm run serve     # http://localhost:4180/ 可操作演示
```

## 判定模型

一次攻击的资格由四件事共同决定，全部按**逻辑时间戳**取值：

| 输入 | 取值时刻 | 作用 |
| --- | --- | --- |
| 角色朝向 | 攻击到达时刻 | 决定相对夹角，判断是否在锥内 |
| 防御开始时间 | 防御区间 | 决定是普通覆盖还是精准窗口 |
| 攻击到达时刻 | 接触事件自带 | 唯一判定时刻 |
| 招式性质 | 攻击事件自带 | 决定能否招架、是否无视防御 |

规则要点：

- **普通防御覆盖区**：防御区间 `[startAt, endAt)` 覆盖到达时刻，且相对夹角在装备的 `blockHalfAngleDeg` 内。
- **精准招架窗口**：更短的夹角（`parryHalfAngleDeg`），并且防御**恰好在** `[到达 - 武器提前量, 到达]`（含两端）内抬起。抬起过早只算普通格挡。
- **窗口边界**：起点、终点均含。`到达 - 280ms` 抬盾可招架，`到达 - 281ms` 只能格挡。
- **防御退出即时生效**：`[startAt, endAt)` 左闭右开，在到达同一瞬间松盾即为受击。
- **朝向按到达时刻结算**：抬盾后转身，按撞击瞬间朝向判定。
- **装备切换即时生效**：到达时刻的装备决定能否招架、锥角大小与削伤比例。
- **后方攻击**：相对夹角超过 `rearThresholdDeg` 直接受击，理由单独标注。

### 一次攻击只结算一次

同一次攻击的所有接触点一起结算：

- 采用**最早确认的接触点**的到达时刻作为判定时刻；
- 其余接触点标记为 `superseded-contact`，不再单独结算；
- 长持续接触（刮蹭、多接触点）因此不会重复计伤，也不会“后段翻盘”。

## 可调用接口

```js
import {
  adjudicate, createLedger, makeAttack, makeContact, setEquipment,
} from './src/index.js';

const ledger = createLedger({ equipmentId: 'sword_shield' });
ledger.guardIntervals.push({ startAt: 720, endAt: null });

const result = adjudicate({
  ledger,
  attack: makeAttack({
    attackId: 'a1',
    sourceId: 'atk-1',
    actorTag: 'grunt',
    contacts: [
      makeContact({ contactIndex: 0, arrivalAt: 1000, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
      makeContact({ contactIndex: 1, arrivalAt: 1060, arrivalAngleDeg: 0, weapon: 'sword', move: 'slash' }),
    ],
  }),
});

result.outcome;      // 'parry'
result.settledAt;    // 1000  —— 被采用的判定时刻
result.parryWindow;   // { startAt: 720, endAt: 1000, startAtInclusive: true, endAtInclusive: true }
result.adoptedContactIndex; // 0
result.superseded;   // [{ contactIndex: 1, reason: 'superseded-contact' }]
```

底层纯函数是 `adjudicateAttack({ attack, ledger, sourceRegistry, rules })`。
完整事件流 / 仿真驱动使用 `createArena()`：

```js
import { createArena, makeContacts } from './src/index.js';

const arena = createArena();
arena.actions.spawn(0, 'grunt');                 // 分配 atk-1
arena.actions.startGuard(720);
arena.actions.attack(900, {
  actorTag: 'grunt',
  weapon: 'sword',
  move: 'slash',
  contacts: makeContacts({ arrivalAt: 1000, angleDeg: 0, count: 3, gapMs: 60 }),
});
arena.advanceTo(2000);
arena.snapshot().results;                        // 只有一行结算
```

## 攻击源编号

`createSourceRegistry` 单调分配 `atk-1, atk-2, ...`，**永不回收**。重复生成同一角色得到全新编号；死亡生成本体的在途攻击会以 `unknown-or-dead-source` 作废，不会借用新生成本体的编号。攻击事件必须同时带上 `sourceId` 与 `actorTag`，两者不匹配即作废。

## 渲染频率无关

仲裁只读时间线台账与事件自带时间戳，不读帧、不读动画。`advanceTo(t)` 每次都按 `(时间, 入队序)` 排空队列：

- 测试以 1 / 4 / 16 / 33 / 100 / 500 / 2000ms 七种步长跑完整场景，逐字段比对结果、伤害、结算时刻；
- `advanceTo` 一次跳跃与逐毫秒推进结果一致；
- 演示界面可切换 30 / 144 / 1 fps，只影响画面刷新。

## 动画不是证据

抬盾动画（`animGuard`）存放在独立的 `cosmetic` 状态里，裁决永远不读取它。`animation-trap` 场景展示了“播放了防御动作但没有防御台账 → 受击”。测试断言动画字段不会出现在任何结果中。

## 演示场景

| 场景 | 展示内容 |
| --- | --- |
| 前后方同时到达 | 同一时刻，正面格挡、背后受击，两个攻击源分别结算 |
| 长持续接触 | 9 个接触点只结算一次，其余标记已取代 |
| 窗口边缘 | 窗口起点 / 起点前 1ms / 撞击瞬间 / 撞击瞬间退出防御 |
| 装备切换即时生效 | 窗口内卸甲 → 格挡；装回 → 招架 |
| 朝向在撞击时刻结算 | 抬盾后背对、撞击前转身 → 招架；转回 → 锥外受击 |
| 防御姿态退出即时生效 | 退出后到达的攻击受击；重新抬盾恢复招架 |
| 播放防御动作 ≠ 招架 | 仅播放动画 → 受击 |
| 重复生成不混淆攻击源 | 死亡生成本体的攻击作废，新生成本体正常结算 |
| 招式性质决定资格 | 盾击可挡不可招、抓取无视防御、劈砍可招架 |

界面上同时显示被采用的判定时刻：结果面板的 `采用 t=…ms（接触点 #…）`、画布中的漂浮标签，以及时间线条上一枚高亮的接触点。

## 测试

```bash
npm test
```

- `test/adjudicate.test.js` — 裁决核心、窗口边界、锥角、装备 / 朝向 / 招式、多接触点、身份。
- `test/scenarios.test.js` — **独立手写**的预期结果表，与演示自带标签分开维护并交叉校验。
- `test/sim.test.js` — 渲染步长不变性、事件重放一致性、攻击源编号、动画非证据。
- `test/api.test.js` — 公开 `adjudicate()` 接口的文档示例与错误路径。

## 目录

```
src/guard/rules.js       规则常量（锥角、窗口提前量、招式 / 装备）
src/guard/events.js      接触事件与台账原语
src/guard/timeline.js    按时间戳的台账查询
src/guard/adjudicate.js  纯裁决函数
src/guard/identity.js    攻击源编号登记
src/sim/arena.js         确定性事件驱动仿真
src/sim/scenarios.js     演示场景与预期标签
src/index.js             公开接口
demo/                    浏览器演示
```
