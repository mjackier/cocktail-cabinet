/* MISSILE COMMAND — roles: [0] Defender (fires interceptors), [1] Attacker (launches warheads).
   Flip design: the attacker is a real player who chooses where each warhead comes from and
   what it hits. Each wave the attacker gets a fixed warhead budget and a launch cooldown;
   the defender gets fresh ammo in 3 batteries. 8 waves. The attacker wins by destroying all
   6 cities. The defender wins by having at least one city standing after wave 8.
   Explosions and warheads are simulated identically for humans and the computer. */
(function () {
  'use strict';
  const W = 800, H = 600, GROUND = 560, WAVES = 8;
  const BASES = [60, 400, 740], CITIES = [150, 220, 290, 510, 580, 650];
  const IV = 520, EXP_R = 42, EXP_T = 0.5;

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null, t: 0, wave: 1, phase: 'intro', phaseT: 2,
      cities: CITIES.map((x) => ({ x, alive: true })),
      bases: BASES.map((x) => ({ x, alive: true, ammo: 0 })),
      warheads: [], shots: [], booms: [], budget: 0, cd: 0, launcherX: W / 2, drag: null,
      waveT: 0, score: 0, msg: '', msgT: 0,
      dBrain: { t: 0, assigned: new Map() }, aBrain: { plan: [] },
    };
    const wp = () => (g.wave - 1) / (WAVES - 1); // wave progress 0..1
    const whSpeed = () => CC.lerp(46, 102, wp());
    const waveBudget = () => Math.round(CC.lerp(11, 26, wp()));
    const ammoPer = () => Math.round(CC.lerp(12, 10, wp()));
    const LAUNCH_CD = 0.32, WAVE_TIME = 32;

    const targets = () => [...g.cities.map((c, i) => ({ kind: 'city', i, x: c.x, alive: c.alive })), ...g.bases.map((b, i) => ({ kind: 'base', i, x: b.x, alive: b.alive }))];

    function startWave() {
      g.phase = 'play'; g.waveT = 0;
      g.budget = waveBudget();
      g.bases.forEach((b) => { b.alive = true; b.ammo = ammoPer(); });
      g.dBrain.assigned = new Map();
      g.aBrain.plan = ai[1] ? planWave() : [];
      g.msg = 'Wave ' + g.wave; g.msgT = 1.2;
    }

    function canLaunch() { return g.phase === 'play' && g.budget > 0 && g.cd <= 0; }
    function launch(fromX, toX) {
      if (!canLaunch()) return false;
      fromX = CC.clamp(fromX, 10, W - 10); toX = CC.clamp(toX, 10, W - 10);
      const dx = toX - fromX, dy = GROUND - 0, len = Math.hypot(dx, dy), sp = whSpeed();
      g.warheads.push({ x: fromX, y: 0, sx: fromX, sy: 0, tx: toX, vx: (dx / len) * sp, vy: (dy / len) * sp, id: Math.random() + g.t, born: g.t });
      g.budget--; g.cd = LAUNCH_CD;
      CC.sfx.play('launch');
      return true;
    }
    function fire(base, tx, ty) {
      if (!base.alive || base.ammo <= 0 || ty > GROUND - 20) return false;
      base.ammo--;
      const dx = tx - base.x, dy = ty - GROUND, len = Math.hypot(dx, dy);
      g.shots.push({ x: base.x, y: GROUND, sx: base.x, sy: GROUND, tx, ty, vx: (dx / len) * IV, vy: (dy / len) * IV, left: len / IV });
      CC.sfx.play('shoot');
      return true;
    }
    function nearestBase(x) {
      let best = null;
      for (const b of g.bases) if (b.alive && b.ammo > 0 && (!best || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
      return best;
    }
    function boom(x, y, r, enemy) { g.booms.push({ x, y, t: 0, r: r || EXP_R, enemy: !!enemy }); CC.sfx.play('boom'); }

    // ---------- AI attacker: plan the wave as timed launches ----------
    function planWave() {
      const skill = CC.lerp(0.2, 0.95, wp());
      const plan = [];
      let t = rng.range(0.5, 1.5);
      let n = waveBudget();
      while (n > 0) {
        const alive = targets().filter((x) => x.alive);
        const cityT = alive.filter((x) => x.kind === 'city');
        // Smart attackers mix in base strikes (to starve the defense) and salvos.
        const salvo = skill > 0.4 && rng() < skill * 0.6 ? Math.min(n, rng.int(2, 3 + Math.round(skill * 2))) : 1;
        const tg = (rng() < 0.25 * skill || !cityT.length) && alive.length ? rng.pick(alive) : rng.pick(cityT.length ? cityT : alive);
        for (let k = 0; k < salvo && n > 0; k++) {
          plan.push({ at: t + k * LAUNCH_CD * 1.05, target: tg, from: CC.clamp(tg.x + rng.range(-1, 1) * CC.lerp(150, 380, skill), 10, W - 10) });
          n--;
        }
        t += rng.range(CC.lerp(2.6, 1.0, skill), CC.lerp(4.2, 2.0, skill));
      }
      return plan;
    }
    function aiAttacker() {
      const p = g.aBrain.plan;
      if (p.length && g.waveT >= p[0].at && canLaunch()) {
        const step = p.shift();
        // Re-target if the planned target already died.
        let tg = step.target;
        if (!(tg.kind === 'city' ? g.cities[tg.i].alive : true)) {
          const alive = g.cities.filter((c) => c.alive);
          if (alive.length) tg = rng.pick(alive);
        }
        launch(step.from, tg.x + rng.range(-8, 8));
      }
    }

    // ---------- AI defender: solve for an intercept point and fire ----------
    function aiDefender(dt) {
      const br = g.dBrain;
      const skill = CC.lerp(0.25, 0.9, wp());
      br.t -= dt;
      if (br.t > 0) return;
      br.t = CC.lerp(0.55, 0.22, skill) * rng.range(0.8, 1.25);
      const notice = CC.lerp(1.3, 0.35, skill);
      // Forget assignments whose explosion is over without killing the warhead.
      for (const [id, until] of br.assigned) if (g.t > until) br.assigned.delete(id);
      const cand = g.warheads.filter((w) => !br.assigned.has(w.id) && g.t - w.born > notice);
      if (!cand.length) return;
      const threatens = (w) => {
        if (skill < 0.5) return true;
        return g.cities.some((c) => c.alive && Math.abs(c.x - w.tx) < 34) || g.bases.some((b) => b.alive && Math.abs(b.x - w.tx) < 30);
      };
      cand.sort((a, b) => (threatens(b) - threatens(a)) || ((GROUND - a.y) / a.vy - (GROUND - b.y) / b.vy));
      const w = cand[0];
      if (!threatens(w) && rng() < skill) { br.assigned.set(w.id, Infinity); return; }
      const base = nearestBase(w.x);
      if (!base) return;
      // Iterate: where will the warhead be when my interceptor arrives?
      let t = 0.5;
      for (let k = 0; k < 6; k++) {
        const px = w.x + w.vx * (t + 0.1), py = w.y + w.vy * (t + 0.1);
        t = Math.hypot(px - base.x, py - GROUND) / IV;
      }
      const err = CC.lerp(30, 7, skill);
      const px = w.x + w.vx * (t + 0.1) + rng.gauss() * err, py = w.y + w.vy * (t + 0.1) + rng.gauss() * err;
      if (py > GROUND - 40) return; // too late to save it
      if (fire(base, px, py)) br.assigned.set(w.id, g.t + t + EXP_T * 2 + 0.2);
    }

    function endCheck() {
      if (g.cities.every((c) => !c.alive)) {
        g.over = true; g.result = { winner: 1, reason: 'Every city was destroyed in wave ' + g.wave + '.' };
      }
    }

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      if (g.phase === 'intro' || g.phase === 'between') {
        g.phaseT -= dt;
        if (g.phaseT <= 0) startWave();
      }
      if (g.phase === 'play') {
        g.waveT += dt; g.cd -= dt;
        // Attacker
        if (ai[1]) aiAttacker();
        else {
          // Keyboard: ←/→ move the launcher (A/D too when the defender is human), 1–9 fire at a target.
          const left = input.down('ArrowLeft') || (input.down('KeyA') && !ai[0]);
          const right = input.down('ArrowRight') || (input.down('KeyD') && !ai[0]);
          g.launcherX = CC.clamp(g.launcherX + ((right ? 1 : 0) - (left ? 1 : 0)) * 380 * dt, 10, W - 10);
          const tg = targets();
          for (let k = 1; k <= 9; k++) if (input.pressed('Digit' + k)) launch(g.launcherX, tg[k - 1].x);
          if (ai[0]) { // mouse belongs to the attacker: drag from the sky to the ground
            for (const p of input.presses) if (p.y < GROUND - 140) g.drag = { x: p.x };
            for (const p of input.releases) { if (g.drag && p.y > GROUND - 140) launch(g.drag.x, p.x); g.drag = null; }
          }
        }
        // Defender
        if (ai[0]) aiDefender(dt);
        else {
          for (const c of input.clicks) { const b = nearestBase(c.x); if (b) fire(b, c.x, c.y); }
        }
        if (g.waveT > WAVE_TIME) g.budget = 0;
        if (g.budget <= 0 && !g.warheads.length && !g.shots.length && !g.booms.length) {
          g.score += g.cities.filter((c) => c.alive).length * 100;
          if (g.wave >= WAVES) {
            g.over = true;
            g.result = { winner: 0, reason: g.cities.filter((c) => c.alive).length + ' cities survived all ' + WAVES + ' waves.' };
            return;
          }
          g.wave++; g.phase = 'between'; g.phaseT = 2.2;
          g.msg = 'Wave cleared'; g.msgT = 1.2;
        }
      }

      // Interceptors
      for (const s of g.shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.left -= dt;
        if (s.left <= 0) { boom(s.tx, s.ty); s.done = true; }
      }
      g.shots = g.shots.filter((s) => !s.done);
      // Explosions
      for (const b of g.booms) b.t += dt;
      g.booms = g.booms.filter((b) => b.t < EXP_T * 2);
      const rad = (b) => b.r * (b.t < EXP_T ? b.t / EXP_T : 2 - b.t / EXP_T);
      // Warheads
      for (const w of g.warheads) {
        w.x += w.vx * dt; w.y += w.vy * dt;
        for (const b of g.booms) if (!b.enemy && Math.hypot(w.x - b.x, w.y - b.y) < rad(b)) { w.dead = true; g.score += 25; boom(w.x, w.y, 24); break; }
        if (!w.dead && w.y >= GROUND) {
          w.dead = true;
          boom(w.x, GROUND, 30, true);
          for (const c of g.cities) if (c.alive && Math.abs(c.x - w.x) < 30) { c.alive = false; g.msg = 'City lost'; g.msgT = 0.8; }
          for (const b of g.bases) if (b.alive && Math.abs(b.x - w.x) < 28) { b.alive = false; b.ammo = 0; }
          endCheck();
        }
      }
      g.warheads = g.warheads.filter((w) => !w.dead);
    };

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3b2a12'; ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = CC.pal.warn; ctx.fillRect(0, GROUND, W, 2);
      const tg = targets();
      for (const c of g.cities) {
        if (c.alive) {
          ctx.fillStyle = CC.pal.b;
          ctx.fillRect(c.x - 18, GROUND - 10, 36, 10); ctx.fillRect(c.x - 12, GROUND - 18, 8, 8); ctx.fillRect(c.x + 2, GROUND - 22, 9, 12);
        } else { ctx.fillStyle = '#4a3a2a'; ctx.fillRect(c.x - 18, GROUND - 4, 36, 4); }
      }
      for (const b of g.bases) {
        ctx.fillStyle = b.alive ? CC.pal.c : '#4a3a2a';
        ctx.beginPath(); ctx.moveTo(b.x - 26, GROUND); ctx.lineTo(b.x, GROUND - 26); ctx.lineTo(b.x + 26, GROUND); ctx.fill();
        if (b.alive) CC.text(ctx, String(b.ammo), b.x, GROUND + 20, 20, CC.pal.c, 'center');
      }
      if (!ai[1]) tg.forEach((t, i) => CC.text(ctx, String(i + 1), t.x, GROUND + 32, 14, CC.pal.dim, 'center'));
      ctx.lineWidth = 2;
      for (const w of g.warheads) {
        ctx.strokeStyle = 'rgba(255,77,109,0.7)'; ctx.beginPath(); ctx.moveTo(w.sx, w.sy); ctx.lineTo(w.x, w.y); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillRect(w.x - 2, w.y - 2, 4, 4);
      }
      for (const s of g.shots) {
        ctx.strokeStyle = 'rgba(62,224,208,0.7)'; ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.strokeStyle = CC.pal.b; ctx.beginPath(); ctx.moveTo(s.tx - 5, s.ty - 5); ctx.lineTo(s.tx + 5, s.ty + 5); ctx.moveTo(s.tx + 5, s.ty - 5); ctx.lineTo(s.tx - 5, s.ty + 5); ctx.stroke();
      }
      for (const b of g.booms) {
        const r = b.r * (b.t < EXP_T ? b.t / EXP_T : 2 - b.t / EXP_T);
        ctx.fillStyle = b.enemy ? 'rgba(255,159,28,0.8)' : `hsla(${(g.t * 900) % 360},90%,65%,0.85)`;
        ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(0, r), 0, 7); ctx.fill();
      }
      if (!ai[1]) {
        ctx.fillStyle = CC.pal.a;
        ctx.beginPath(); ctx.moveTo(g.launcherX - 14, 6); ctx.lineTo(g.launcherX + 14, 6); ctx.lineTo(g.launcherX, 22); ctx.fill();
        if (g.drag) { ctx.strokeStyle = CC.pal.a; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(g.drag.x, 0); ctx.lineTo(input.mouse.x, input.mouse.y); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (!ai[0]) {
        const m = input.mouse;
        if (m.inside) { ctx.strokeStyle = CC.pal.b; ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, 7); ctx.moveTo(m.x - 14, m.y); ctx.lineTo(m.x + 14, m.y); ctx.moveTo(m.x, m.y - 14); ctx.lineTo(m.x, m.y + 14); ctx.stroke(); }
      }
      CC.hud(ctx, [
        { label: 'Wave', value: g.wave + ' / ' + WAVES, color: CC.pal.c },
        { label: 'Cities', value: g.cities.filter((c) => c.alive).length, color: CC.pal.b },
        { label: 'Warheads left', value: g.budget, color: CC.pal.a },
        { label: 'Score', value: g.score, color: CC.pal.text },
      ], 40);
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.c, g.msgT);
    };
    g.stats = () => ({ wave: g.wave, cities: g.cities.filter((c) => c.alive).length, score: g.score });
    return g;
  }

  CC.register({
    id: 'missile', name: 'Missile Command', color: '#ff4d6d', glyph: '✕',
    blurb: 'One side defends six cities with three missile batteries. The other side commands the warheads, choosing where each one starts and what it hits.',
    roles: [
      { name: 'Defender', controls: 'Click to fire from the nearest battery; the explosion lands where you click' },
      { name: 'Attacker', controls: 'Drag from the sky down to the ground to launch, or move the launcher with ← → and fire at targets 1–9' },
    ],
    goals: 'The game lasts 8 waves. The attacker needs to destroy all 6 cities. The defender needs at least one city left at the end.',
    create,
  });
})();
