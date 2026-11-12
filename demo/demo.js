// Demo controller for the melee guard adjudicator.
//
// The arena is advanced by logical milliseconds. The render loop only reads
// snapshots and draws them; changing the requested frame rate changes how often
// the picture is refreshed, never what any verdict is.

import { createArena } from '../src/sim/arena.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { GUARD_RULES } from '../src/guard/rules.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const timelineCanvas = document.getElementById('timeline');
const tctx = timelineCanvas.getContext('2d');

const ui = {
  hud: document.getElementById('hud'),
  pop: document.getElementById('pop'),
  scenarioList: document.getElementById('scenarios'),
  blurb: document.getElementById('blurb'),
  play: document.getElementById('play'),
  step: document.getElementById('step'),
  pause: document.getElementById('pause'),
  fpsLabel: document.getElementById('fps-label'),
  verdict: document.getElementById('verdict'),
  log: document.getElementById('log'),
  hpbar: document.getElementById('hpbar'),
  guardbar: document.getElementById('guardbar'),
  gearLabel: document.getElementById('gear-label'),
};

const state = {
  scenarioIndex: 0,
  arena: null,
  paused: false,
  playing: false,
  fps: 60,
  stepMs: 10,
  lastFrame: 0,
  renderAccumulator: 0,
};


function selectedScenario() {
  return SCENARIOS[state.scenarioIndex];
}

function rebuild() {
  const scenario = selectedScenario();
  const arena = createArena();
  scenario.build(arena);
  state.arena = arena;
  state.playing = false;
  state.paused = false;
  ui.pop.className = 'result-pop';
  delete ui.pop.dataset.attackId;
  ui.verdict.textContent = '—';
  renderFpsLabel();
  draw();
}

// --- Controls that act on the live arena while it is paused -----------------

function withArena(action) {
  if (!state.arena) return;
  const at = state.arena.now;
  action(state.arena, at);
  state.arena.advanceTo(at);
  draw();
}

const equipmentCycle = ['sword_shield', 'greatsword', 'unarmed'];

function currentEquipment(snapshot) {
  return snapshot.equipmentId;
}

function toggleGuard() {
  withArena((arena, at) => {
    const snap = arena.snapshot();
    if (snap.guardActive) arena.actions.exitGuard(at);
    else arena.actions.startGuard(at);
  });
}

function cycleEquipment() {
  withArena((arena, at) => {
    const current = currentEquipment(arena.snapshot());
    const next = equipmentCycle[(equipmentCycle.indexOf(current) + 1) % equipmentCycle.length];
    arena.actions.equipment(at, next);
  });
}

function turn(deltaDeg) {
  withArena((arena, at) => {
    const snap = arena.snapshot();
    arena.actions.facing(at, normalize(snap.facingDeg + deltaDeg));
  });
}

function normalize(degValue) {
  return ((degValue % 360) + 540) % 360 - 180;
}

// --- Playback --------------------------------------------------------------

function play() {
  if (!state.arena) return;
  const duration = selectedScenario().durationMs;
  if (state.arena.now >= duration) {
    rebuild();
  }
  state.playing = true;
  state.paused = false;
  state.lastFrame = performance.now();
}

function pause() {
  state.paused = !state.paused;
  state.playing = !state.paused;
  state.lastFrame = performance.now();
}

function stepForward() {
  if (!state.arena) return;
  if (state.arena.now >= selectedScenario().durationMs) return;
  state.playing = false;
  state.paused = true;
  state.arena.advanceTo(Math.min(state.arena.now + state.stepMs, selectedScenario().durationMs));
  draw();
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(now - state.lastFrame, 250);
  state.lastFrame = now;
  if (!state.playing || state.paused || !state.arena) return;

  // Render frame gating: at low fps the logical clock advances in fewer, larger
  // jumps. advanceTo replays every event in timeline order either way, so the
  // verdicts cannot depend on this cadence.
  state.renderAccumulator += dt;
  const framePeriod = 1000 / state.fps;
  if (state.renderAccumulator < framePeriod) return;
  const advanceMs = state.renderAccumulator;
  state.renderAccumulator = 0;

  const duration = selectedScenario().durationMs;
  const logical = Math.min(state.arena.now + advanceMs, duration);
  state.arena.advanceTo(logical);
  maybeAnnounce(state.arena.snapshot());
  draw();

  if (state.arena.now >= duration) {
    state.playing = false;
    ui.hud.textContent = '播放结束 · 可重放或操作角色';
  }
}

function maybeAnnounce(snapshot) {
  const latest = snapshot.results[snapshot.results.length - 1];
  if (!latest || !latest.settled) return;
  if (ui.pop.dataset.attackId === latest.attackId) return;
  ui.pop.dataset.attackId = latest.attackId;
  ui.pop.textContent = labelFor(latest.outcome);
  ui.pop.className = `result-pop show ${latest.outcome}`;
}

function labelFor(outcome) {
  if (outcome === 'block') return '格挡';
  if (outcome === 'parry') return '招架';
  if (outcome === 'hit') return '受击';
  return '—';
}

// --- Rendering -------------------------------------------------------------

const VIEW = {
  width: canvas.width,
  height: canvas.height,
  cx: canvas.width / 2,
  cy: canvas.height / 2 + 40,
  scale: 190,
};

function draw() {
  if (!state.arena) return;
  const snapshot = state.arena.snapshot();
  paintStage(snapshot);
  paintTimeline(snapshot);
  paintPanel(snapshot);
}

function paintStage(snapshot) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawArenaRing();
  drawCones(snapshot);
  drawDefender(snapshot);
  drawAttackers(snapshot);
}

function drawArenaRing() {
  ctx.save();
  ctx.strokeStyle = '#1b2230';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(VIEW.cx, VIEW.cy, VIEW.scale * 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCones(snapshot) {
  const equipment = GUARD_RULES.equipment[snapshot.equipmentId];
  const facingRad = (snapshot.facingDeg * Math.PI) / 180;

  // Block cone (wide) and parry cone (narrow) are drawn around current facing.
  ctx.save();
  ctx.translate(VIEW.cx, VIEW.cy);
  ctx.rotate(facingRad);
  const width = equipment.blockHalfAngleDeg * 2;
  ctx.fillStyle = 'rgba(79,156,240,.10)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, VIEW.scale * 1.45, (-width / 2) * Math.PI / 180, (width / 2) * Math.PI / 180);
  ctx.closePath();
  ctx.fill();

  const parryWidth = equipment.parryHalfAngleDeg * 2;
  ctx.fillStyle = 'rgba(240,193,79,.16)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, VIEW.scale * 0.9, (-parryWidth / 2) * Math.PI / 180, (parryWidth / 2) * Math.PI / 180);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Rear zone marker.
  ctx.save();
  ctx.translate(VIEW.cx, VIEW.cy);
  ctx.rotate(facingRad);
  ctx.strokeStyle = 'rgba(239,91,91,.35)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(0, 0, VIEW.scale * 1.45, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.stroke();
  ctx.restore();
}

function drawDefender(snapshot) {
  ctx.save();
  ctx.translate(VIEW.cx, VIEW.cy);
  ctx.rotate((snapshot.facingDeg * Math.PI) / 180);

  // Body.
  ctx.fillStyle = snapshot.guardActive ? '#63d08a' : '#3b465a';
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();

  // Facing wedge.
  ctx.fillStyle = '#dbe3ef';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(46, -12);
  ctx.lineTo(46, 12);
  ctx.closePath();
  ctx.fill();

  // Shield arc — the real guard state, not the animation.
  if (snapshot.guardActive) {
    ctx.strokeStyle = '#63d08a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 52, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();

  // Cosmetic animation ring, drawn separately to expose the distinction.
  const anim = snapshot.cosmetic.guardAnim;
  if (anim && anim.startedAt <= snapshot.now && snapshot.now < anim.endsAt) {
    ctx.save();
    ctx.translate(VIEW.cx, VIEW.cy);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(219,227,239,.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 66, -1.2, 1.2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAttackers(snapshot) {
  const positions = attackerPositions(snapshot);
  for (const attacker of positions) {
    ctx.save();
    ctx.translate(attacker.x, attacker.y);
    ctx.fillStyle = attacker.color;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(219,227,239,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#dbe3f0';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const label = attacker.tag.length > 10 ? `${attacker.tag.slice(0, 9)}…` : attacker.tag;
    ctx.fillText(label, 0, 40);
    ctx.restore();
  }
  drawAdoptedTags(snapshot, positions);
}

function drawAdoptedTags(snapshot, positions) {
  const tagByActor = new Map(positions.map((position) => [position.tag, position]));
  for (const attack of snapshot.attacks) {
    if (!attack.result?.settled) continue;
    const elapsed = snapshot.now - attack.result.settledAt;
    if (elapsed < 0 || elapsed > 1100) continue;
    const anchor = tagByActor.get(attack.actorTag);
    if (!anchor) continue;
    const alpha = Math.max(0, 1 - elapsed / 1100);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = resultColor(attack.result.outcome);
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${labelFor(attack.result.outcome)} @${attack.result.settledAt}ms`, anchor.x, anchor.y - 34);
    ctx.restore();
  }
}

function attackerPositions(snapshot) {
  const groups = new Map();
  for (const attack of snapshot.attacks) {
    if (!groups.has(attack.actorTag)) groups.set(attack.actorTag, []);
    groups.get(attack.actorTag).push(attack);
  }
  const result = [];
  const radius = VIEW.scale * 1.5;
  for (const [tag, attacks] of groups) {
    const worldAngle = attacks[0].worldAngleDeg ?? attacks[0].contacts[0]?.arrivalAngleDeg ?? 0;
    const rad = (worldAngle * Math.PI) / 180;
    const settled = attacks.some((attack) => attack.status === 'settled' || attack.status === 'cancelled');
    const color = !settled ? '#8a95a8' : attacks.some((a) => a.result?.outcome === 'hit') ? '#ef5b5b' : attacks.some((a) => a.result?.outcome === 'parry') ? '#f0c14f' : '#4f9cf0';
    result.push({
      tag,
      x: VIEW.cx + Math.sin(rad) * radius,
      y: VIEW.cy - Math.cos(rad) * radius * 0.75,
      color,
    });
  }
  return result;
}


// --- Timeline strip --------------------------------------------------------

const TL = { w: 0, h: 0, dpr: 1 };

function sizeTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = timelineCanvas.clientWidth || 332;
  const cssHeight = timelineCanvas.clientHeight || 148;
  timelineCanvas.width = Math.round(cssWidth * dpr);
  timelineCanvas.height = Math.round(cssHeight * dpr);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  TL.w = cssWidth;
  TL.h = cssHeight;
  TL.dpr = dpr;
}

function paintTimeline(snapshot) {
  sizeTimeline();
  const duration = selectedScenario().durationMs;
  tctx.clearRect(0, 0, TL.w, TL.h);
  tctx.fillStyle = '#0b0e14';
  tctx.fillRect(0, 0, TL.w, TL.h);

  const xOf = (t) => (t / duration) * (TL.w - 24) + 12;
  const bandTop = 14;
  const bandH = 8;

  // Guard coverage band.
  for (const interval of snapshot.guardIntervals) {
    const start = xOf(interval.startAt);
    const end = xOf(interval.endAt ?? Math.min(duration, snapshot.now));
    tctx.fillStyle = 'rgba(99,208,138,.30)';
    tctx.fillRect(start, bandTop, Math.max(2, end - start), bandH);
  }

  // Axis ticks.
  tctx.strokeStyle = '#2a3242';
  tctx.lineWidth = 1;
  tctx.beginPath();
  tctx.moveTo(12, bandTop + bandH + 2);
  tctx.lineTo(TL.w - 12, bandTop + bandH + 2);
  tctx.stroke();

  tctx.fillStyle = '#5a6577';
  tctx.font = '10px ui-monospace, monospace';
  tctx.textAlign = 'center';
  const tickStep = duration > 2000 ? 1000 : 500;
  for (let t = 0; t <= duration; t += tickStep) {
    tctx.fillRect(xOf(t), bandTop + bandH + 2, 1, 5);
    tctx.fillText(`${t}`, xOf(t), bandTop + bandH + 16);
  }
  tctx.textAlign = 'start';

  // Contacts and adopted instants, one lane per attack.
  const laneTop = bandTop + bandH + 26;
  const laneH = Math.max(18, (TL.h - laneTop - 6) / Math.max(1, snapshot.attacks.length));
  snapshot.attacks.forEach((attack, index) => {
    const y = laneTop + index * laneH + laneH / 2;
    const adopted = attack.result?.adoptedContactIndex;
    for (const contact of attack.contacts) {
      const x = xOf(contact.arrivalAt);
      const isAdopted = contact.contactIndex === adopted;
      tctx.fillStyle = isAdopted ? '#f0c14f' : 'rgba(140,153,175,.35)';
      tctx.beginPath();
      tctx.arc(x, y, isAdopted ? 4.5 : 2.6, 0, Math.PI * 2);
      tctx.fill();
      if (isAdopted) {
        tctx.strokeStyle = '#f0c14f';
        tctx.lineWidth = 1.5;
        tctx.beginPath();
        tctx.moveTo(x, y - 7);
        tctx.lineTo(x, y - 14);
        tctx.stroke();
      }
    }
    if (attack.result?.settledAt != null) {
      const x = xOf(attack.result.settledAt);
      tctx.fillStyle = resultColor(attack.result.outcome);
      tctx.font = '10px ui-monospace, monospace';
      tctx.textAlign = 'left';
      const label = `${attack.attackId} @${attack.result.settledAt}`;
      tctx.fillText(label, Math.min(x + 7, TL.w - tctx.measureText(label).width - 4), y + 3.5);
      tctx.textAlign = 'start';
    }
  });

  // Playhead.
  const px = xOf(snapshot.now);
  tctx.strokeStyle = '#dbe3ef';
  tctx.lineWidth = 1;
  tctx.beginPath();
  tctx.moveTo(px, bandTop - 4);
  tctx.lineTo(px, TL.h - 2);
  tctx.stroke();
}

function resultColor(outcome) {
  if (outcome === 'parry') return '#f0c14f';
  if (outcome === 'block') return '#4f9cf0';
  if (outcome === 'hit') return '#ef5b5b';
  return '#8592a6';
}

// --- Side panel ------------------------------------------------------------

function paintPanel(snapshot) {
  const scenario = selectedScenario();
  ui.blurb.textContent = scenario.blurb;
  ui.hud.textContent = `t = ${Math.round(snapshot.now)}ms · ${GUARD_RULES.equipment[snapshot.equipmentId].label} · 朝向 ${snapshot.facingDeg}°`;
  ui.gearLabel.textContent = GUARD_RULES.equipment[snapshot.equipmentId].label;
  ui.hpbar.style.width = `${(snapshot.hp / snapshot.maxHp) * 100}%`;

  ui.guardbar.style.width = snapshot.guardActive ? '100%' : '0%';

  renderVerdict(snapshot);
  renderLog(snapshot);
}

function activeGuardStart(snapshot) {
  const open = snapshot.guardIntervals.filter((interval) => interval.endAt == null);
  return open.length > 0 ? open[open.length - 1].startAt : null;
}

function renderVerdict(snapshot) {
  const settled = snapshot.results.filter((result) => result.settled);
  if (settled.length === 0) {
    ui.verdict.textContent = '尚无已结算的攻击。';
    return;
  }
  ui.verdict.innerHTML = settled.map((result) => {
    const windowText = result.parryWindow
      ? `窗口 [${result.parryWindow.startAt}, ${result.parryWindow.endAt}]`
      : result.reason === 'no-guard-active' || result.reason === 'guard-exited-before-arrival'
        ? '未抬盾（无招架窗口）'
        : '无招架窗口';
    const superseded = result.superseded.length > 0
      ? ` · 其余 ${result.superseded.length} 个接触点已取代`
      : '';
    return `<span class="chip ${result.outcome}">${labelFor(result.outcome)}</span>` +
      `<b>${result.attackId}</b> 采用 t=${result.settledAt}ms（接触点 #${result.adoptedContactIndex}）` +
      ` ${windowText}${superseded}`;
  }).join('<br>');
}

function renderLog(snapshot) {
  const rows = snapshot.eventLog.slice(-90).reverse();
  ui.log.innerHTML = rows.map((entry) => {
    if (entry.type === 'settled') {
      return `<div class="settled ${entry.outcome}">t=${entry.at} 结算 ${entry.attackId} → ${labelFor(entry.outcome)} (${entry.reason})</div>`;
    }
    if (entry.type === 'attack-launched') {
      return `<div>t=${entry.at} 攻击 ${entry.attackId} 由 ${entry.sourceId} 发起，${entry.contacts} 个接触点</div>`;
    }
    if (entry.type === 'attack-cancelled') {
      return `<div class="settled hit">t=${entry.at} 攻击 ${entry.attackId} 作废 (${entry.reason})</div>`;
    }
    return `<div>t=${entry.at} ${entry.type}${describe(entry)}</div>`;
  }).join('');
}

function describe(entry) {
  if (entry.type === 'spawn') return ` ${entry.actorTag} → ${entry.sourceId}`;
  if (entry.type === 'despawn') return ` ${entry.actorTag}`;
  if (entry.type === 'equipment') return ` ${entry.equipmentId}`;
  if (entry.type === 'facing') return ` ${entry.facingDeg}°`;
  if (entry.type === 'anim-guard') return ' (仅动作)';
  return '';
}

// --- Wiring ----------------------------------------------------------------

function renderScenarioList() {
  ui.scenarioList.innerHTML = '';
  SCENARIOS.forEach((scenario, index) => {
    const button = document.createElement('button');
    button.textContent = `${index + 1}. ${scenario.title}`;
    if (index === state.scenarioIndex) button.classList.add('active');
    button.addEventListener('click', () => {
      state.scenarioIndex = index;
      rebuild();
      renderScenarioList();
      play();
    });
    ui.scenarioList.appendChild(button);
  });
}

function renderFpsLabel() {
  ui.fpsLabel.textContent = `${state.fps}fps`;
}

function setFps(fps) {
  state.fps = fps;
  renderFpsLabel();
}

ui.play.addEventListener('click', play);
ui.step.addEventListener('click', stepForward);
ui.pause.addEventListener('click', pause);
document.getElementById('act-guard').addEventListener('click', toggleGuard);
document.getElementById('act-turn').addEventListener('click', () => turn(180));
document.getElementById('act-gear').addEventListener('click', cycleEquipment);
document.querySelectorAll('[data-face]').forEach((button) => {
  button.addEventListener('click', () => {
    withArena((arena, at) => arena.actions.facing(at, Number(button.dataset.face)));
  });
});
document.getElementById('fps-30').addEventListener('click', () => setFps(30));
document.getElementById('fps-144').addEventListener('click', () => setFps(144));
document.getElementById('fps-1').addEventListener('click', () => setFps(1));

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.key === 'j' || event.key === 'J') toggleGuard();
  if (event.key === 'k' || event.key === 'K') turn(180);
  if (event.key === 'l' || event.key === 'L') cycleEquipment();
  if (event.key === ' ') play();
});

renderScenarioList();
rebuild();
requestAnimationFrame((t) => {
  state.lastFrame = t;
  tick(t);
});

// Expose a tiny hook for the browser test harness.
window.__guardDemo = {
  getSnapshot: () => state.arena.snapshot(),
  getScenario: () => selectedScenario(),
  rebuild,
  play,
  stepForward,
  refresh: draw,
  advanceTo: (t) => {
    state.arena.advanceTo(t);
    draw();
  },
  setFps,
  state,
};
