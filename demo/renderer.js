'use strict';

// Canvas 渲染器与手动操控。仅负责表现与输入，所有裁决来自 src 下的核心模块。
// 浏览器中核心模块通过 UMD 暴露为 window.MeleeCore / window.MeleeSim。

/* global MeleeCore */

const { EQUIPMENT, VERDICT } = MeleeCore;

const COLORS = {
  parry: '#39d98a',
  block: '#4aa3ff',
  hit: '#ff5d5d',
  guard: 'rgba(74,163,255,0.18)',
  parryZone: 'rgba(57,217,138,0.30)',
  blockZone: 'rgba(74,163,255,0.14)',
  player: '#f2f2f2',
  orb: '#ffb347',
  marker: '#ffd166',
};

const VERDICT_TEXT = { parry: '招架 PARRY', block: '格挡 BLOCK', hit: '受击 HIT' };

class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.scale = 1.7;
    this.originX = canvas.width / 2;
    this.originY = canvas.height / 2;
  }

  toScreen(x, y) {
    return [this.originX + x * this.scale, this.originY + y * this.scale];
  }

  drawArcZone(bearingCenterDeg, halfArcDeg, radius, fillStyle) {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(this.world.player.x, this.world.player.y);
    const start = ((bearingCenterDeg - halfArcDeg) * Math.PI) / 180;
    const end = ((bearingCenterDeg + halfArcDeg) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius * this.scale, start, end);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  drawPlayer() {
    const ctx = this.ctx;
    const p = this.world.player;
    const [cx, cy] = this.toScreen(p.x, p.y);
    const gear = EQUIPMENT[p.equipmentId];

    if (this.world.adj.guarding) {
      this.drawArcZone(p.facingDeg, gear.blockArc, 120, COLORS.blockZone);
      // 仅在精准招架窗口存续期间高亮精准扇形
      const windowEnd = this.world.adj.guardStartMs + EQUIPMENT[this.world.adj.guardEquipmentId].parryWindow;
      if (this.world.tMs < windowEnd) {
        this.drawArcZone(p.facingDeg, gear.parryArc, 120, COLORS.parryZone);
      }
    }

    // 身体
    ctx.beginPath();
    ctx.arc(cx, cy, p.radius * this.scale, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.player;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#222';
    ctx.stroke();

    // 朝向指示
    const rad = (p.facingDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(rad) * 30, cy - Math.sin(rad) * 30);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111';
    ctx.stroke();

    // 仅播放动作但无姿态的假动画
    if (p.fakeAnim && this.world.tMs - p.fakeAnim.startMs < p.fakeAnim.durationMs) {
      ctx.beginPath();
      ctx.arc(cx, cy, (p.radius + 8) * this.scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,71,0.8)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawOrbs() {
    const ctx = this.ctx;
    for (const orb of this.world.orbs) {
      if (orb.ended && orb.verdict) continue;
      const [x, y] = this.toScreen(orb.x, orb.y);
      ctx.beginPath();
      ctx.arc(x, y, orb.radius * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = orb.verdict ? COLORS[orb.verdict.verdict] : COLORS.orb;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#5a3b00';
      ctx.stroke();

      // 攻击编号
      ctx.fillStyle = '#1d1d1d';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(orb.attack.instanceId, x, y - orb.radius * this.scale - 4);
    }
  }

  drawInjectedMarkers() {
    const ctx = this.ctx;
    for (const m of this.world.markers) {
      const [x, y] = this.toScreen(m.x, m.y);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.marker;
      ctx.fill();
      ctx.strokeStyle = '#7a5b00';
      ctx.stroke();
    }
  }

  drawJudgmentMarkers() {
    const ctx = this.ctx;
    for (const v of this.world.verdicts) {
      if (!v.marker) continue;
      const [x, y] = this.toScreen(v.marker.x, v.marker.y);
      ctx.strokeStyle = COLORS[v.verdict];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 18, y);
      ctx.lineTo(x + 18, y);
      ctx.moveTo(x, y - 18);
      ctx.lineTo(x, y + 18);
      ctx.stroke();
      ctx.fillStyle = COLORS[v.verdict];
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`采用判定时刻 t=${v.judgedAtMs}ms`, x + 20, y - 6);
      ctx.fillText(VERDICT_TEXT[v.verdict], x + 20, y + 9);
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#10141b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawPlayer();
    this.drawInjectedMarkers();
    this.drawOrbs();
    this.drawJudgmentMarkers();
  }
}

function makeHudRefs() {
  return {
    time: document.getElementById('hud-time'),
    gear: document.getElementById('hud-gear'),
    guard: document.getElementById('hud-guard'),
    window: document.getElementById('hud-window'),
    facing: document.getElementById('hud-facing'),
    verdicts: document.getElementById('hud-verdicts'),
    log: document.getElementById('hud-log'),
  };
}

function updateHud(refs, world, expectedMap) {
  const p = world.player;
  refs.time.textContent = `${world.tMs} ms`;
  refs.gear.textContent = EQUIPMENT[p.equipmentId].name;
  refs.guard.textContent = world.adj.guarding ? '防御中' : '未防御';
  refs.facing.textContent = `${p.facingDeg}°`;
  if (world.adj.guarding) {
    const gear = EQUIPMENT[world.adj.guardEquipmentId];
    const end = world.adj.guardStartMs + gear.parryWindow;
    const remain = Math.max(0, end - world.tMs);
    refs.window.textContent = `${remain}ms（${gear.parryWindow}ms 窗口，${world.tMs < end ? '开启' : '已关闭'}）`;
  } else {
    refs.window.textContent = '—';
  }

  const rows = world.verdicts.map((v) => {
    const exp = expectedMap.get(v.instanceId);
    const expText = exp
      ? `预期 ${VERDICT_TEXT[exp.verdict]}${exp.judgedAtMs !== undefined ? ` @${exp.judgedAtMs}` : ''}`
      : '';
    return `<tr>
      <td>${v.instanceId}</td>
      <td style="color:${COLORS[v.verdict]}">${VERDICT_TEXT[v.verdict]}</td>
      <td>${v.judgedAtMs}</td>
      <td class="muted">${expText}</td>
    </tr>`;
  }).join('');
  refs.verdicts.innerHTML = rows || '<tr><td colspan="4" class="muted">尚无裁决</td></tr>';

  refs.log.innerHTML = world.log
    .slice(-8)
    .map((l) => `<div class="muted">[${l.tMs}ms] ${l.text}</div>`)
    .join('');
}

// 手动模式：可操作角色
function bindManualControls(world) {
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') {
      e.preventDefault();
      world.setGuardInput(true);
    }
    if (e.key.toLowerCase() === 'g') {
      world.playFakeGuardAnim(); // 只播动作，不进姿态
    }
    const gearCycle = ['bare', 'buckler', 'rapier', 'tower'];
    if (e.key >= '1' && e.key <= '4') {
      world.setEquipment(gearCycle[Number(e.key) - 1]);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
    if (e.key === ' ') world.setGuardInput(false);
  });
  return keys;
}

function applyManualMovement(world, keys) {
  const turn = 90; // deg/s
  if (keys.has('arrowleft') || keys.has('a')) world.setFacing(world.player.facingDeg - turn * 0.016);
  if (keys.has('arrowright') || keys.has('d')) world.setFacing(world.player.facingDeg + turn * 0.016);
}

window.Renderer = Renderer;
window.makeHudRefs = makeHudRefs;
window.updateHud = updateHud;
window.bindManualControls = bindManualControls;
window.applyManualMovement = applyManualMovement;
window.VERDICT_TEXT = VERDICT_TEXT;
