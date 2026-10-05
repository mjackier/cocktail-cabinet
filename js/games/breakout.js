/* BREAKOUT DUEL — roles: [0] Bottom paddle, [1] Top paddle.
   A shared brick wall sits in the middle. Each player has a ball. Break bricks for points,
   and punch holes so balls get past your opponent's paddle. Letting a ball past your paddle
   costs a life; 5 lives each. The balls speed up and the paddles shrink as the match goes on.
   Both paddles have the same top speed, whether a human or the computer moves them. */
(function () {
  'use strict';
  const W = 800, H = 600;
  const BR_COLS = 14, BR_ROWS = 6, BR_W = W / BR_COLS, BR_H = 20, BR_TOP = H / 2 - (BR_ROWS * BR_H) / 2;
  const LIVES = 5, BALL_R = 7, PADDLE_MAX = 820; // px/s, same for humans and computer
  const PY = [H - 34, 34];

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = { over: false, result: null, t: 0, msg: '', msgT: 0 };
    const prog = () => CC.clamp(g.t / 150, 0, 1);
    const paddleW = () => CC.lerp(120, 70, prog());
    const ballSpeed = () => CC.lerp(330, 600, prog());

    g.bricks = [];
    for (let r = 0; r < BR_ROWS; r++) for (let c = 0; c < BR_COLS; c++) g.bricks.push({ x: c * BR_W, y: BR_TOP + r * BR_H, alive: true, r });
    g.p = [0, 1].map((i) => ({ x: W / 2, y: PY[i], lives: LIVES, score: 0, vx: 0, brain: { t: 0, target: W / 2, err: 0 } }));
    g.balls = [0, 1].map((i) => ({ owner: i, server: i, x: W / 2, y: PY[i], vx: 0, vy: 0, held: 1.2 }));

    function serve(ball, who) {
      ball.server = who; ball.owner = who; ball.held = 1.0;
    }
    function launch(ball) {
      const who = ball.server;
      const ang = rng.range(-0.5, 0.5);
      const s = ballSpeed();
      ball.vx = Math.sin(ang) * s;
      ball.vy = (who === 0 ? -1 : 1) * Math.cos(ang) * s;
      ball.held = 0;
    }

    // ---- AI: predict where a ball crosses my paddle line, bouncing off side walls (not bricks) ----
    function predictX(ball, py) {
      if (ball.vy === 0) return ball.x;
      const t = (py - ball.y) / ball.vy;
      if (t < 0) return null;
      let x = ball.x + ball.vx * t;
      const span = W - 2 * BALL_R;
      x -= BALL_R;
      x = ((x % (2 * span)) + 2 * span) % (2 * span);
      if (x > span) x = 2 * span - x;
      return { x: x + BALL_R, t };
    }
    function aiPaddle(i, dt) {
      const pd = g.p[i], br = pd.brain;
      const skill = CC.lerp(0.25, 0.92, prog());
      br.t -= dt;
      if (br.t <= 0) {
        br.t = CC.lerp(0.26, 0.07, skill) * rng.range(0.7, 1.3); // reaction time
        let best = null;
        for (const b of g.balls) {
          if (b.held > 0) continue;
          const toward = i === 0 ? b.vy > 0 : b.vy < 0;
          if (!toward) continue;
          const pr = predictX(b, pd.y);
          if (pr && (!best || pr.t < best.t)) best = pr;
        }
        if (best) {
          if (Math.abs(best.t) > 0.05 && rng() < 0.5) br.err = rng.gauss() * CC.lerp(34, 8, skill);
          // Aim: hit with the paddle edge sometimes to angle the shot.
          br.target = best.x + br.err + (skill > 0.5 ? rng.range(-0.25, 0.25) * paddleW() : 0);
        } else {
          br.target = W / 2 + Math.sin(g.t * 0.7 + i) * 60; // drift to center
        }
      }
      return br.target;
    }

    function movePaddle(i, targetX, dt) {
      const pd = g.p[i], hw = paddleW() / 2;
      const want = CC.clamp(targetX, hw, W - hw);
      const maxStep = PADDLE_MAX * dt;
      const d = CC.clamp(want - pd.x, -maxStep, maxStep);
      pd.vx = d / dt; pd.x += d;
    }

    function humanTarget(i) {
      // First human seat uses mouse / arrow keys; second human seat uses A/D.
      const firstHuman = !ai[0] ? 0 : 1;
      const pd = g.p[i];
      if (i === firstHuman) {
        if (input.down('ArrowLeft')) return pd.x - 60;
        if (input.down('ArrowRight')) return pd.x + 60;
        if (input.mouse.inside) return input.mouse.x;
        return pd.x;
      }
      if (input.down('KeyA')) return pd.x - 60;
      if (input.down('KeyD')) return pd.x + 60;
      return pd.x;
    }

    function hitBrick(b) {
      for (const k of g.bricks) {
        if (!k.alive) continue;
        if (b.x + BALL_R < k.x || b.x - BALL_R > k.x + BR_W || b.y + BALL_R < k.y || b.y - BALL_R > k.y + BR_H) continue;
        k.alive = false;
        g.p[b.owner].score += 10 * (1 + Math.min(k.r, BR_ROWS - 1 - k.r));
        // Decide bounce axis by penetration depth.
        const ox = Math.min(b.x + BALL_R - k.x, k.x + BR_W - (b.x - BALL_R));
        const oy = Math.min(b.y + BALL_R - k.y, k.y + BR_H - (b.y - BALL_R));
        if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
        CC.sfx.play('brick');
        return true;
      }
      return false;
    }

    function stepBall(b, dt) {
      // Substeps so fast balls never skip through bricks or paddles.
      const n = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / (BALL_R * 0.8));
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        b.x += b.vx * h; b.y += b.vy * h;
        if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
        if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
        if (hitBrick(b)) continue;
        for (let i = 0; i < 2; i++) {
          const pd = g.p[i], hw = paddleW() / 2;
          const movingIn = i === 0 ? b.vy > 0 : b.vy < 0;
          const yIn = i === 0 ? b.y + BALL_R >= pd.y - 6 && b.y < pd.y + 6 : b.y - BALL_R <= pd.y + 6 && b.y > pd.y - 6;
          if (movingIn && yIn && b.x > pd.x - hw - BALL_R && b.x < pd.x + hw + BALL_R) {
            const off = CC.clamp((b.x - pd.x) / hw, -1, 1);
            const ang = off * 1.0 + CC.clamp(pd.vx / 4000, -0.15, 0.15);
            const sp = Math.max(ballSpeed(), Math.hypot(b.vx, b.vy) * 1.01);
            b.vx = Math.sin(ang) * sp;
            b.vy = (i === 0 ? -1 : 1) * Math.cos(ang) * sp;
            b.owner = i;
            CC.sfx.play('paddle');
          }
        }
        // Past a goal line?
        const lost = b.y > H + BALL_R ? 0 : b.y < -BALL_R ? 1 : -1;
        if (lost >= 0) {
          g.p[lost].lives--;
          g.msg = (lost === 0 ? 'Bottom' : 'Top') + ' loses a life'; g.msgT = 1;
          CC.sfx.play('die');
          if (g.p[lost].lives <= 0) {
            g.over = true;
            g.result = { winner: 1 - lost, reason: (lost === 0 ? 'Bottom' : 'Top') + ' ran out of lives.' };
          }
          serve(b, lost);
          return;
        }
      }
    }

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      for (let i = 0; i < 2; i++) movePaddle(i, ai[i] ? aiPaddle(i, dt) : humanTarget(i), dt);
      for (const b of g.balls) {
        if (b.held > 0) {
          const pd = g.p[b.server];
          b.x = pd.x; b.y = pd.y + (b.server === 0 ? -14 : 14);
          b.held -= dt;
          if (b.held <= 0) launch(b);
          continue;
        }
        stepBall(b, dt);
        // Keep speed in step with the ramp; avoid near-horizontal stalls.
        const sp = Math.hypot(b.vx, b.vy), want = Math.max(sp, ballSpeed());
        if (Math.abs(b.vy) < want * 0.3) b.vy = Math.sign(b.vy || 1) * want * 0.3;
        const k = want / Math.hypot(b.vx, b.vy); b.vx *= k; b.vy *= k;
      }
      // Rebuild the wall if it is nearly gone, so games always have bricks.
      if (g.bricks.filter((k) => k.alive).length < 12) {
        for (const k of g.bricks) if (k.r === 2 || k.r === 3) k.alive = true;
        g.msg = 'Wall rebuilt'; g.msgT = 1;
      }
    };

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, W, H);
      const colors = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#ffd23f', '#ff9f1c', '#ff4d6d'];
      for (const k of g.bricks) {
        if (!k.alive) continue;
        ctx.fillStyle = colors[k.r];
        ctx.fillRect(k.x + 2, k.y + 2, BR_W - 4, BR_H - 4);
      }
      const pc = [CC.pal.b, CC.pal.d];
      for (let i = 0; i < 2; i++) {
        const pd = g.p[i], w = paddleW();
        CC.glow(ctx, pc[i], 14); ctx.fillStyle = pc[i];
        ctx.fillRect(pd.x - w / 2, pd.y - 6, w, 12);
      }
      for (const b of g.balls) {
        CC.glow(ctx, pc[b.owner], 12); ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, 7); ctx.fill();
      }
      CC.noGlow(ctx);
      CC.text(ctx, 'TOP  ' + '♥'.repeat(g.p[1].lives) + '   ' + g.p[1].score, 12, 72, 22, CC.pal.d);
      CC.text(ctx, 'BOTTOM  ' + '♥'.repeat(g.p[0].lives) + '   ' + g.p[0].score, 12, H - 72, 22, CC.pal.b);
      CC.text(ctx, 'Speed ' + Math.round(ballSpeed()), W - 12, H / 2 + 80, 18, CC.pal.dim, 'right');
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.c, g.msgT);
    };
    g.stats = () => ({ t: Math.round(g.t), lives: g.p.map((p) => p.lives), score: g.p.map((p) => p.score) });
    return g;
  }

  CC.register({
    id: 'breakout', name: 'Breakout', color: '#ff9f1c', glyph: 'B',
    blurb: 'Head-to-head Breakout. There is a wall in the middle and a paddle on each end. Break through and get your ball past your opponent.',
    roles: [
      { name: 'Bottom paddle', controls: 'Mouse or ← → (A/D for the second human)' },
      { name: 'Top paddle', controls: 'Mouse or ← → (A/D for the second human)' },
    ],
    goals: 'Each side has 5 lives. You lose one whenever a ball gets past your paddle.',
    create,
  });
})();
