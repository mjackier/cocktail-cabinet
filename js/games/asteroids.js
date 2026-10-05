/* ASTEROIDS — roles: [0] Pilot (flies and shoots), [1] Thrower (sends asteroids).
   The pilot wins by surviving 2:30. The thrower wins by destroying the ship 3 times.
   The thrower spends energy that regenerates faster as time goes on. Asteroids enter from the
   screen edge, never within 170px of the ship, and the total rock mass on screen is capped (a big rock counts as 4).
   The computer pilot uses the same rotate, thrust and fire controls (with the same fire rate)
   as a human. */
(function () {
  'use strict';
  const W = 800, H = 600, DURATION = 150, LIVES = 3;
  const MASS = { 3: 4, 2: 2, 1: 1 }, MAX_MASS = 20;
  const SIZES = { 3: { r: 38, cost: 4, pts: 20 }, 2: { r: 22, cost: 2.5, pts: 50 }, 1: { r: 12, cost: 1.5, pts: 100 } };
  const ROT = 4.2, THRUST = 260, DRAG = 0.55, VMAX = 360, BSPEED = 540, BLIFE = 0.95, FIRE_CD = 0.22, MAX_B = 5;

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null, t: 0, lives: LIVES, score: 0,
      ship: { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, inv: 2, cd: 0, thrust: false },
      rocks: [], bullets: [], parts: [], energy: 4, sel: 3, drag: null, msg: '', msgT: 0,
      pBrain: { t: 0, rot: 0, thrust: false, fire: false, aimErr: 0, target: null },
      tBrain: { t: 1.5 },
    };
    const prog = () => CC.clamp(g.t / DURATION, 0, 1);
    const regen = () => CC.lerp(0.6, 1.8, prog());
    const rockSpeed = (s) => (s === 3 ? CC.lerp(55, 95, prog()) : s === 2 ? CC.lerp(85, 145, prog()) : CC.lerp(115, 190, prog()));

    // Shortest wrapped offset from a to b.
    const wd = (d, span) => (d > span / 2 ? d - span : d < -span / 2 ? d + span : d);
    const wrapDist = (a, b) => Math.hypot(wd(b.x - a.x, W), wd(b.y - a.y, H));

    function edgePoint(px, py) {
      // Nearest point on the screen border.
      const dl = px, dr = W - px, dt = py, db = H - py, m = Math.min(dl, dr, dt, db);
      if (m === dl) return { x: -30, y: py };
      if (m === dr) return { x: W + 30, y: py };
      if (m === dt) return { x: px, y: -30 };
      return { x: px, y: H + 30 };
    }
    const mass = () => g.rocks.reduce((m, r) => m + MASS[r.s], 0);
    function canThrow(size, ex, ey) {
      if (g.energy < SIZES[size].cost) return 'not enough energy';
      if (mass() + MASS[size] > MAX_MASS) return 'too many rocks on screen';
      const cx = CC.clamp(ex, 0, W), cy = CC.clamp(ey, 0, H);
      if (wrapDist({ x: cx, y: cy }, g.ship) < 170) return 'too close to the ship';
      return null;
    }
    function throwRock(size, ex, ey, ang) {
      g.energy -= SIZES[size].cost;
      const sp = rockSpeed(size);
      g.rocks.push({ x: ex, y: ey, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, s: size, r: SIZES[size].r, spin: rng.range(-1, 1), rot: 0, shape: Array.from({ length: 10 }, () => rng.range(0.75, 1.15)), entering: true });
      CC.sfx.play('throw');
    }

    // ---------- AI thrower ----------
    function aiThrower(dt) {
      const br = g.tBrain;
      br.t -= dt;
      if (br.t > 0) return;
      const skill = CC.lerp(0.25, 0.92, prog());
      br.t = CC.lerp(1.4, 0.45, skill) * rng.range(0.6, 1.4);
      const sizes = skill > 0.5 && rng() < 0.45 ? [1, 2, 3] : [3, 2];
      const size = rng.pick(sizes);
      if (g.energy < SIZES[size].cost + (skill > 0.6 ? 0 : 1)) return;
      for (let tries = 0; tries < 8; tries++) {
        const side = rng.int(0, 3);
        const ex = side === 0 ? -30 : side === 1 ? W + 30 : rng.range(0, W);
        const ey = side === 2 ? -30 : side === 3 ? H + 30 : rng.range(0, H);
        if (canThrow(size, ex, ey)) continue;
        // Lead the ship a little, plus aiming error that shrinks with skill.
        const s = g.ship, tt = Math.hypot(s.x - ex, s.y - ey) / rockSpeed(size);
        const tx = s.x + s.vx * tt * skill * 0.8, ty = s.y + s.vy * tt * skill * 0.8;
        const ang = Math.atan2(ty - ey, tx - ex) + rng.gauss() * CC.lerp(0.45, 0.1, skill);
        throwRock(size, ex, ey, ang);
        return;
      }
    }

    // ---------- AI pilot ----------
    function aiPilot(dt) {
      const br = g.pBrain, s = g.ship;
      const skill = CC.lerp(0.3, 0.9, prog());
      br.t -= dt;
      if (br.t > 0) return br;
      br.t = CC.lerp(0.15, 0.05, skill); // reaction time
      br.thrust = false; br.fire = false;
      const look = CC.lerp(0.9, 1.5, skill), margin = CC.lerp(14, 34, skill);
      // Closest approach of every rock, using wrapped positions.
      let threat = null, nearest = null;
      for (const r of g.rocks) {
        const dx = wd(r.x - s.x, W), dy = wd(r.y - s.y, H), d = Math.hypot(dx, dy);
        const rvx = r.vx - s.vx, rvy = r.vy - s.vy, vv = rvx * rvx + rvy * rvy || 1;
        const tca = CC.clamp(-(dx * rvx + dy * rvy) / vv, 0, 4);
        const mx = dx + rvx * tca, my = dy + rvy * tca;
        const miss = Math.hypot(mx, my) - r.r - 10;
        if (tca < look && miss < margin && (!threat || tca < threat.tca)) threat = { r, d, dx, dy, mx, my, tca };
        if (!nearest || d < nearest.d) nearest = { r, d, dx, dy };
      }
      const aimAt = (o) => {
        if (o.r !== br.target) { br.target = o.r; br.aimErr = rng.gauss() * CC.lerp(0.13, 0.03, skill); }
        const tHit = o.d / BSPEED;
        return Math.atan2(o.dy + (o.r.vy - s.vy) * tHit, o.dx + (o.r.vx - s.vx) * tHit) + br.aimErr;
      };
      let desired = s.a;
      if (threat) {
        const aim = aimAt(threat);
        const turnTime = Math.abs(CC.wrapAngle(aim - s.a)) / ROT;
        if (turnTime + threat.d / BSPEED < threat.tca * 0.9 || threat.r.s === 1 && turnTime < 0.15) {
          desired = aim; // can shoot it first
        } else {
          // Dodge at right angles to the rock's approach, on the side we are already drifting to.
          const ax = threat.mx, ay = threat.my;
          const away = Math.hypot(ax, ay) > 2 ? Math.atan2(-ay, -ax) : Math.atan2(-threat.dy, -threat.dx) + Math.PI / 2;
          desired = away;
          br.thrust = Math.abs(CC.wrapAngle(away - s.a)) < 0.5;
        }
      } else if (nearest) {
        desired = aimAt(nearest);
      }
      if (nearest || threat) {
        const o = threat || nearest;
        const err = Math.abs(CC.wrapAngle(aimAt(o) - s.a));
        br.fire = err < Math.max(0.1, Math.atan2(o.r.r, o.d) * 0.9) && o.d < 450;
      }
      // Brake if drifting fast with nothing to dodge.
      const sp = Math.hypot(s.vx, s.vy);
      if (!threat && sp > 150 && skill > 0.4) { desired = Math.atan2(-s.vy, -s.vx); br.thrust = Math.abs(CC.wrapAngle(desired - s.a)) < 0.4; br.fire = false; }
      if (sp > 230) br.thrust = false;
      const e = CC.wrapAngle(desired - s.a);
      br.rot = Math.abs(e) < 0.04 ? 0 : Math.sign(e);
      return br;
    }

    function shipDie() {
      g.lives--;
      boom(g.ship.x, g.ship.y, CC.pal.b, 30);
      CC.sfx.play('die');
      g.msg = 'Ship destroyed'; g.msgT = 1.1;
      if (g.lives <= 0) { g.over = true; g.result = { winner: 1, reason: 'The ship was destroyed three times.' }; return; }
      Object.assign(g.ship, { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, inv: 2.5 });
      // Clear the respawn zone so a respawn is never an instant death.
      g.rocks = g.rocks.filter((r) => wrapDist(r, g.ship) > 140);
    }
    function boom(x, y, c, n) {
      for (let i = 0; i < n; i++) { const a = rng.range(0, 7), v = rng.range(40, 220); g.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rng.range(0.3, 0.8), c }); }
    }
    function splitRock(r) {
      g.score += SIZES[r.s].pts;
      boom(r.x, r.y, CC.pal.dim, 10);
      CC.sfx.play('rock');
      if (r.s > 1) for (let k = 0; k < 2; k++) {
        const a = Math.atan2(r.vy, r.vx) + (k ? 0.6 : -0.6), sp = rockSpeed(r.s - 1);
        g.rocks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: r.s - 1, r: SIZES[r.s - 1].r, spin: rng.range(-2, 2), rot: 0, shape: r.shape.slice().reverse(), entering: false });
      }
    }

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      if (g.t >= DURATION) { g.over = true; g.result = { winner: 0, reason: 'The pilot survived the full ' + Math.round(DURATION / 60 * 10) / 10 + ' minutes.' }; return; }
      g.energy = Math.min(10, g.energy + regen() * dt);

      // Thrower
      if (ai[1]) aiThrower(dt);
      else {
        for (const k of [1, 2, 3]) if (input.pressed('Digit' + k)) g.sel = 4 - k; // 1=big,2=medium,3=small
        if (input.wheel) g.sel = ((g.sel - 1 + (input.wheel > 0 ? 1 : 2)) % 3) + 1;
        for (const p of input.presses) g.drag = { start: edgePoint(p.x, p.y) };
        for (const p of input.releases) {
          if (!g.drag) continue;
          const e = g.drag.start; g.drag = null;
          const why = canThrow(g.sel, e.x, e.y);
          if (why) { g.msg = 'Can\'t throw: ' + why; g.msgT = 0.8; CC.sfx.play('bad'); continue; }
          let ang = Math.atan2(p.y - e.y, p.x - e.x);
          if (Math.hypot(p.y - e.y, p.x - e.x) < 25) ang = Math.atan2(H / 2 - e.y, W / 2 - e.x);
          throwRock(g.sel, e.x, e.y, ang);
        }
      }

      // Pilot
      const s = g.ship;
      let rot = 0, thrust = false, fire = false;
      if (ai[0]) { const b = aiPilot(dt); rot = b.rot; thrust = b.thrust; fire = b.fire; }
      else {
        rot = (input.down('ArrowRight') || input.down('KeyD') ? 1 : 0) - (input.down('ArrowLeft') || input.down('KeyA') ? 1 : 0);
        thrust = input.down('ArrowUp') || input.down('KeyW');
        fire = input.down('Space');
      }
      s.a += rot * ROT * dt;
      s.thrust = thrust;
      if (thrust) { s.vx += Math.cos(s.a) * THRUST * dt; s.vy += Math.sin(s.a) * THRUST * dt; }
      const k = Math.exp(-DRAG * dt); s.vx *= k; s.vy *= k;
      const sp = Math.hypot(s.vx, s.vy); if (sp > VMAX) { s.vx *= VMAX / sp; s.vy *= VMAX / sp; }
      s.x = (s.x + s.vx * dt + W) % W; s.y = (s.y + s.vy * dt + H) % H;
      s.cd -= dt; if (s.inv > 0) s.inv -= dt;
      if (fire && s.cd <= 0 && g.bullets.length < MAX_B) {
        s.cd = FIRE_CD;
        g.bullets.push({ x: s.x + Math.cos(s.a) * 14, y: s.y + Math.sin(s.a) * 14, vx: Math.cos(s.a) * BSPEED + s.vx, vy: Math.sin(s.a) * BSPEED + s.vy, life: BLIFE });
        CC.sfx.play('shoot');
      }

      for (const b of g.bullets) { b.x = (b.x + b.vx * dt + W) % W; b.y = (b.y + b.vy * dt + H) % H; b.life -= dt; }
      g.bullets = g.bullets.filter((b) => b.life > 0);
      for (const r of g.rocks) {
        r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
        if (r.entering) { if (r.x > r.r && r.x < W - r.r && r.y > r.r && r.y < H - r.r) r.entering = false; }
        else { r.x = (r.x + W) % W; r.y = (r.y + H) % H; }
      }
      // Bullet hits
      const dead = new Set();
      for (const b of g.bullets) for (const r of g.rocks) {
        if (dead.has(r) || b.life <= 0) continue;
        if (wrapDist(b, r) < r.r) { dead.add(r); b.life = 0; }
      }
      if (dead.size) { const hit = g.rocks.filter((r) => dead.has(r)); g.rocks = g.rocks.filter((r) => !dead.has(r)); hit.forEach(splitRock); }
      g.bullets = g.bullets.filter((b) => b.life > 0);
      // Ship collision
      if (s.inv <= 0) for (const r of g.rocks) if (wrapDist(r, s) < r.r + 10) { shipDie(); break; }

      for (const p of g.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      g.parts = g.parts.filter((p) => p.life > 0);
    };

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#d6cfe8';
      for (const r of g.rocks) {
        ctx.beginPath();
        r.shape.forEach((m, i) => { const a = r.rot + (i / r.shape.length) * Math.PI * 2; const px = r.x + Math.cos(a) * r.r * m, py = r.y + Math.sin(a) * r.r * m; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.closePath(); ctx.stroke();
      }
      const s = g.ship;
      if (!(s.inv > 0 && Math.floor(g.t * 10) % 2)) {
        CC.glow(ctx, CC.pal.b, 12); ctx.strokeStyle = CC.pal.b;
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, 9); ctx.lineTo(-6, 0); ctx.lineTo(-10, -9); ctx.closePath(); ctx.stroke();
        if (s.thrust) { ctx.strokeStyle = CC.pal.warn; ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-18 - Math.random() * 6, 0); ctx.lineTo(-8, -4); ctx.stroke(); }
        ctx.restore(); CC.noGlow(ctx);
      }
      ctx.fillStyle = CC.pal.c;
      for (const b of g.bullets) ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
      for (const p of g.parts) { ctx.globalAlpha = CC.clamp(p.life * 2, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 2, 2); }
      ctx.globalAlpha = 1;
      // Thrower UI
      if (!ai[1]) {
        const m = input.mouse;
        if (g.drag) {
          ctx.strokeStyle = CC.pal.a; ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(CC.clamp(g.drag.start.x, 0, W), CC.clamp(g.drag.start.y, 0, H)); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
        } else if (m.inside) {
          const e = edgePoint(m.x, m.y);
          ctx.fillStyle = CC.pal.a; ctx.beginPath(); ctx.arc(CC.clamp(e.x, 4, W - 4), CC.clamp(e.y, 4, H - 4), 6, 0, 7); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,77,109,0.3)'; ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.arc(s.x, s.y, 170, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        CC.text(ctx, 'Size: ' + ['', 'small [3]', 'medium [2]', 'big [1]'][g.sel] + '  cost ' + SIZES[g.sel].cost, 12, H - 18, 20, CC.pal.a);
      }
      const left = Math.max(0, DURATION - g.t);
      CC.hud(ctx, [
        { label: 'Survive', value: Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0'), color: CC.pal.b },
        { label: 'Ships', value: '▲'.repeat(Math.max(0, g.lives)), color: CC.pal.b },
        { label: 'Score', value: g.score, color: CC.pal.c },
        { label: 'Thrower energy', value: g.energy.toFixed(1), color: CC.pal.a },
      ]);
      CC.bar(ctx, 600, 40, 200, 4, g.energy / 10, CC.pal.a);
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.a, g.msgT);
    };
    g.stats = () => ({ t: Math.round(g.t), lives: g.lives, score: g.score });
    return g;
  }

  CC.register({
    id: 'asteroids', name: 'Asteroids', color: '#d6cfe8', glyph: '◇',
    blurb: 'One side flies the ship. The other side hurls rocks at it, spending energy that refills over time.',
    roles: [
      { name: 'Pilot', controls: '← → rotate, ↑ thrust, Space fire (or WASD + Space)' },
      { name: 'Thrower', controls: 'Press on an edge and drag to aim, then release. Keys 1/2/3 or the scroll wheel pick the rock size' },
    ],
    goals: 'The pilot needs to survive 2:30. The thrower needs to destroy the ship 3 times.',
    create,
  });
})();
