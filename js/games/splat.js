/* SPLAT — roles: [0] Flyer (flaps through gaps), [1] Builder (lays out the columns).
   The flyer wins by passing 40 columns. The builder wins if the flyer splats 3 times.
   The computer flyer only gets the same information a human sees (bird position and speed,
   column gaps on screen) and only one control: flap. Fairness rule for any builder: a gap can
   only move a limited distance from the previous gap and must stay inside the screen. */
(function () {
  'use strict';
  const W = 800, H = 600, GROUND = 560, BX = 210, R = 13;
  const GRAV = 1500, FLAP = -470, COL_W = 72, SPACING = 290, TARGET = 40, LIVES = 3;

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null, y: 300, vy: 0, cols: [], passed: 0, lives: LIVES,
      nextX: W + 40, lastCenter: 300, builderY: 300, grace: 1.2, msg: '', msgT: 0, t: 0,
      flyBrain: { t: 0, noise: 0, noiseT: 0, cd: 0 }, buildBrain: { plan: null, dir: 1 },
    };
    const prog = () => g.passed / TARGET;
    const speed = () => CC.lerp(175, 265, prog());
    const gap = () => CC.lerp(205, 138, prog());
    const maxDelta = () => CC.lerp(150, 230, prog());

    function clampCenter(c) {
      const m = gap() / 2 + 28;
      c = CC.clamp(c, g.lastCenter - maxDelta(), g.lastCenter + maxDelta());
      return CC.clamp(c, m, GROUND - m);
    }
    function aiBuilderCenter() {
      const s = CC.lerp(0.2, 0.95, prog());
      const md = maxDelta();
      if (rng() < s) {
        // Make the flyer change direction hard: jump far, often reversing.
        if (rng() < 0.6) g.buildBrain.dir *= -1;
        return g.lastCenter + g.buildBrain.dir * md * rng.range(0.6, 1.0);
      }
      return g.lastCenter + rng.range(-1, 1) * md * 0.45;
    }
    function spawnColumn() {
      let c;
      if (ai[1]) c = aiBuilderCenter();
      else c = g.builderY;
      c = clampCenter(c);
      // If clamping pinned us against a wall, bounce the AI's direction.
      if (ai[1] && (c <= gap() / 2 + 29 || c >= GROUND - gap() / 2 - 29)) g.buildBrain.dir *= -1;
      g.cols.push({ x: W + 10, c, gap: gap(), passed: false });
      g.lastCenter = c;
    }

    function flap() { g.vy = FLAP; CC.sfx.play('flap'); }

    // ---- AI flyer: looks at the next gap and flaps when its projected path drops too low ----
    function aiFly(dt) {
      const br = g.flyBrain;
      const skill = CC.lerp(0.3, 0.9, prog());
      br.cd -= dt; br.t -= dt; br.noiseT -= dt;
      if (br.noiseT <= 0) { br.noise = rng.gauss() * CC.lerp(30, 11, skill); br.noiseT = rng.range(0.3, 0.7); }
      if (br.t > 0) return;
      br.t = CC.lerp(0.075, 0.03, skill); // how often it re-decides (reaction time)
      // Next column the bird still has to clear.
      const next = g.cols.find((c) => c.x + COL_W > BX - R);
      // Aim at the lower part of the gap: a flap lifts the bird ~70px, so the arc stays centered.
      const low = (c) => c.c + Math.min(c.gap / 2 - R - 14, 42);
      let target = next ? low(next) : 300;
      // Once inside a column, start lining up for the one after it if it is close.
      const after = next ? g.cols.find((c) => c.x > next.x) : null;
      if (next && after && next.x < BX - COL_W * 0.4 && skill > 0.45) {
        target = CC.clamp(low(after), next.c - next.gap / 2 + R + 75, low(next));
      }
      target += br.noise;
      // Simulate a short glide without flapping.
      const look = CC.lerp(0.09, 0.045, skill);
      const yFuture = g.y + g.vy * look + 0.5 * GRAV * look * look;
      const ceilingSafe = next ? next.c - next.gap / 2 + R + 6 : R + 4;
      if (yFuture > target && br.cd <= 0 && g.y > ceilingSafe + 20) { flap(); br.cd = 0.14; }
    }

    function crash() {
      g.lives--;
      CC.sfx.play('die');
      g.msg = 'SPLAT!'; g.msgT = 1;
      if (g.lives <= 0) {
        g.over = true;
        g.result = { winner: 1, reason: 'The flyer splatted three times.' };
        return;
      }
      g.cols = g.cols.filter((c) => c.x > BX + 260);
      g.y = 300; g.vy = 0; g.grace = 1.2; g.lastCenter = 300;
      g.nextX = Math.max(W + 40, ...g.cols.map((c) => c.x + SPACING));
    }

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      // Builder input (human): mouse Y or ↑/↓ chooses the next gap's height.
      if (!ai[1]) {
        if (input.mouse.inside) g.builderY = input.mouse.y;
        if (input.down('ArrowUp') && ai[0]) g.builderY -= 300 * dt;
        if (input.down('ArrowDown') && ai[0]) g.builderY += 300 * dt;
        g.builderY = CC.clamp(g.builderY, 0, GROUND);
      }
      if (g.grace > 0) {
        g.grace -= dt;
        g.y = 300 + Math.sin(g.t * 6) * 6;
        return;
      }
      // Flyer input
      if (ai[0]) aiFly(dt);
      else {
        const k = input.pressed('Space') || input.pressed('KeyW') || (ai[1] && input.pressed('ArrowUp'));
        const click = ai[1] && input.clicks.length > 0;
        if (k || click) flap();
      }
      g.vy += GRAV * dt;
      g.y += g.vy * dt;
      if (g.y < R) { g.y = R; g.vy = 0; }

      const v = speed();
      for (const c of g.cols) c.x -= v * dt;
      g.nextX -= v * dt;
      if (g.nextX <= W + 10) { spawnColumn(); g.nextX += SPACING; }
      g.cols = g.cols.filter((c) => c.x > -COL_W - 10);

      if (g.y + R >= GROUND) return crash();
      for (const c of g.cols) {
        if (BX + R > c.x && BX - R < c.x + COL_W) {
          // circle vs. the two rectangles
          const top = c.c - c.gap / 2, bot = c.c + c.gap / 2;
          const nx = CC.clamp(BX, c.x, c.x + COL_W);
          if ((g.y - R < top && Math.hypot(BX - nx, g.y - CC.clamp(g.y, 0, top)) < R) ||
              (g.y + R > bot && Math.hypot(BX - nx, g.y - CC.clamp(g.y, bot, GROUND)) < R)) return crash();
        }
        if (!c.passed && c.x + COL_W < BX - R) {
          c.passed = true; g.passed++;
          CC.sfx.play('point');
          if (g.passed >= TARGET) { g.over = true; g.result = { winner: 0, reason: 'The flyer made it through ' + TARGET + ' columns.' }; return; }
        }
      }
    };

    g.draw = function (ctx) {
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, '#0d0a24'); sky.addColorStop(1, '#2a1640');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1b2b1b'; ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = CC.pal.good; ctx.fillRect(0, GROUND, W, 3);
      for (const c of g.cols) {
        ctx.fillStyle = '#5ad15a';
        ctx.fillRect(c.x, 0, COL_W, c.c - c.gap / 2);
        ctx.fillRect(c.x, c.c + c.gap / 2, COL_W, GROUND - (c.c + c.gap / 2));
        ctx.fillStyle = '#2e8b3e';
        ctx.fillRect(c.x - 4, c.c - c.gap / 2 - 18, COL_W + 8, 18);
        ctx.fillRect(c.x - 4, c.c + c.gap / 2, COL_W + 8, 18);
      }
      if (!ai[1] && !g.over) {
        const c = clampCenter(g.builderY), gp = gap();
        ctx.strokeStyle = CC.pal.c; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
        ctx.strokeRect(W - COL_W - 6, c - gp / 2, COL_W, gp);
        ctx.setLineDash([]);
        CC.text(ctx, 'next gap', W - COL_W / 2 - 6, c, 16, CC.pal.c, 'center');
      }
      CC.glow(ctx, CC.pal.c, 14);
      ctx.fillStyle = CC.pal.c;
      ctx.beginPath(); ctx.arc(BX, g.y, R, 0, 7); ctx.fill();
      CC.noGlow(ctx);
      ctx.fillStyle = '#07060d';
      ctx.beginPath(); ctx.arc(BX + 5, g.y - 4, 3, 0, 7); ctx.fill();
      ctx.fillStyle = CC.pal.warn;
      ctx.beginPath(); ctx.moveTo(BX + 11, g.y); ctx.lineTo(BX + 20, g.y + 3); ctx.lineTo(BX + 11, g.y + 6); ctx.fill();
      CC.hud(ctx, [
        { label: 'Columns', value: g.passed + ' / ' + TARGET, color: CC.pal.good },
        { label: 'Flyer lives', value: '♥'.repeat(Math.max(0, g.lives)), color: CC.pal.c },
        { label: 'Gap', value: Math.round(gap()) + 'px', color: CC.pal.b },
      ]);
      if (g.grace > 0 && !g.over) CC.text(ctx, 'Get ready…', W / 2, 300 + 50, 26, CC.pal.text, 'center');
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.a, g.msgT);
    };
    g.stats = () => ({ passed: g.passed, lives: g.lives, t: Math.round(g.t) });
    return g;
  }

  CC.register({
    id: 'splat', name: 'Splat', color: '#ffd23f', glyph: '✦',
    blurb: 'One side flaps a bird through the gaps. The other side decides where each gap goes.',
    roles: [
      { name: 'Flyer', controls: 'Space / W to flap (click also works vs a computer builder)' },
      { name: 'Builder', controls: 'Move the mouse up and down to set the next gap (↑/↓ also works)' },
    ],
    goals: 'The flyer needs to clear 40 columns. The builder needs the flyer to splat 3 times.',
    create,
  });
})();
