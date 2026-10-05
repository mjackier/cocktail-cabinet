/* SNAKE — roles: [0] Snake (steers), [1] Feeder (places apples).
   Snake wins by eating 25 apples. Feeder wins if the snake loses 3 lives
   (crashing into a wall or itself, or starving because an apple's step timer ran out).
   Fairness rule (applies to human AND computer feeder): an apple must be at least
   5 cells from the head and reachable within its step timer at the moment it is placed. */
(function () {
  'use strict';
  const COLS = 24, ROWS = 16, CELL = 33, TOP = 58, LEFT = 4;
  const TARGET = 30, LIVES = 3;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null,
      body: [], dir: 0, queue: [], stepT: 0,
      apple: null, waitT: 0, eaten: 0, lives: LIVES, grow: 0,
      msg: '', msgT: 0, flash: null, steps: 0,
      aiFeed: { think: 0 }, aiSnake: {},
    };
    const prog = () => g.eaten / TARGET;
    const stepTime = () => CC.lerp(0.13, 0.065, prog());
    const snakeSkill = () => CC.lerp(0.3, 0.85, prog());
    const feederSkill = () => CC.lerp(0.25, 0.95, prog());

    function reset() {
      const cx = 6, cy = Math.floor(ROWS / 2);
      g.body = [];
      for (let i = 0; i < 4; i++) g.body.push({ x: cx - i, y: cy });
      g.dir = 0; g.queue = []; g.apple = null; g.waitT = 0; g.grow = 0;
    }
    reset();

    const key = (x, y) => y * COLS + x;
    function occupied() {
      const s = new Set();
      for (const p of g.body) s.add(key(p.x, p.y));
      return s;
    }
    // BFS distances from (sx,sy); body except tail is blocked.
    function bfs(sx, sy, blocked) {
      const dist = new Int16Array(COLS * ROWS).fill(-1);
      const q = [key(sx, sy)];
      dist[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const k = q[h], x = k % COLS, y = (k / COLS) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const nk = key(nx, ny);
          if (dist[nk] >= 0 || blocked.has(nk)) continue;
          dist[nk] = dist[k] + 1;
          q.push(nk);
        }
      }
      return dist;
    }
    function blockedNow() {
      const s = occupied();
      const t = g.body[g.body.length - 1];
      if (g.grow === 0) s.delete(key(t.x, t.y));
      return s;
    }
    function allowedSteps(manh) {
      const p = prog();
      return Math.ceil(manh * CC.lerp(1.6, 1.05, p) + CC.lerp(9, 1, p));
    }
    // Validate a placement. Returns null if OK, else a reason string.
    function checkPlace(x, y) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return 'off board';
      const h = g.body[0];
      if (occupied().has(key(x, y))) return 'on the snake';
      if (Math.max(Math.abs(x - h.x), Math.abs(y - h.y)) < 5) return 'too close';
      const d = bfs(h.x, h.y, blockedNow())[key(x, y)];
      const manh = Math.abs(x - h.x) + Math.abs(y - h.y);
      if (d < 0 || d > allowedSteps(manh)) return 'unreachable';
      return null;
    }
    function place(x, y) {
      const h = g.body[0];
      const manh = Math.abs(x - h.x) + Math.abs(y - h.y);
      const steps = allowedSteps(manh);
      g.apple = { x, y, steps, max: steps };
      CC.sfx.play('place');
    }
    function validCells() {
      const out = [];
      const h = g.body[0];
      const dist = bfs(h.x, h.y, blockedNow());
      const occ = occupied();
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const k = key(x, y);
        if (occ.has(k)) continue;
        if (Math.max(Math.abs(x - h.x), Math.abs(y - h.y)) < 5) continue;
        const manh = Math.abs(x - h.x) + Math.abs(y - h.y);
        const d = dist[k];
        if (d < 0 || d > allowedSteps(manh)) continue;
        out.push({ x, y, d, manh });
      }
      return out;
    }

    function loseLife(why) {
      g.lives--;
      g.msg = why; g.msgT = 1.2;
      CC.sfx.play('die');
      if (g.lives <= 0) {
        g.over = true;
        g.result = { winner: 1, reason: why === 'Starved!' ? 'The snake starved.' : 'The snake crashed.' };
      }
    }

    // ---------- Snake brain ----------
    function floodSize(sx, sy, blocked) {
      const d = bfs(sx, sy, blocked);
      let n = 0;
      for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++;
      return n;
    }
    function safeMoves() {
      const h = g.body[0];
      const blocked = blockedNow();
      const res = [];
      for (let di = 0; di < 4; di++) {
        if ((di + 2) % 4 === g.dir) continue;
        const nx = h.x + DIRS[di][0], ny = h.y + DIRS[di][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (blocked.has(key(nx, ny))) continue;
        res.push({ di, nx, ny });
      }
      return res;
    }
    function aiSnakeDir() {
      const moves = safeMoves();
      if (!moves.length) return g.dir; // doomed
      const skill = snakeSkill();
      const h = g.body[0];
      const blocked = blockedNow();
      // Space after each move (skilled snakes avoid boxing themselves in).
      for (const m of moves) {
        const b2 = new Set(blocked); b2.add(key(h.x, h.y));
        m.space = floodSize(m.nx, m.ny, b2);
      }
      const need = g.body.length + 2;
      const roomy = moves.filter((m) => m.space >= need);
      if (g.apple && rng() > skill * 0.55 + 0.35) {
        // Lazy/greedy moment: head straight at the apple, ignoring the bigger picture.
        const pool = rng() < skill ? (roomy.length ? roomy : moves) : moves;
        pool.sort((a, b) => (Math.abs(a.nx - g.apple.x) + Math.abs(a.ny - g.apple.y)) - (Math.abs(b.nx - g.apple.x) + Math.abs(b.ny - g.apple.y)));
        return pool[0].di;
      }
      if (g.apple) {
        const distA = bfs(g.apple.x, g.apple.y, blocked);
        const pool = roomy.length ? roomy : moves;
        let best = null;
        for (const m of pool) {
          const d = distA[key(m.nx, m.ny)];
          if (d < 0) continue;
          if (!best || d < best.d || (d === best.d && m.space > best.space)) best = Object.assign({ d }, m);
        }
        if (best) return best.di;
      }
      // No apple or no path: wander toward open space, preferring to follow the tail.
      const tail = g.body[g.body.length - 1];
      moves.sort((a, b) => (b.space - a.space) || ((Math.abs(a.nx - tail.x) + Math.abs(a.ny - tail.y)) - (Math.abs(b.nx - tail.x) + Math.abs(b.ny - tail.y))));
      return moves[0].di;
    }

    // ---------- Feeder brain ----------
    function aiFeederPick() {
      const cells = validCells();
      if (!cells.length) return null;
      const s = feederSkill();
      // Hardness: path length close to the allowed limit, near walls, behind the body.
      for (const c of cells) {
        const allow = allowedSteps(c.manh);
        const wall = (c.x === 0 || c.y === 0 || c.x === COLS - 1 || c.y === ROWS - 1) ? 0.15 : 0;
        c.hard = c.d / allow + wall + (c.d - c.manh) * 0.02;
      }
      if (rng() < s) {
        cells.sort((a, b) => b.hard - a.hard);
        const top = Math.max(1, Math.floor(cells.length * CC.lerp(0.25, 0.04, s)));
        return cells[Math.floor(rng() * top)];
      }
      const near = cells.filter((c) => c.manh < 14);
      return rng.pick(near.length ? near : cells);
    }

    // ---------- update ----------
    function humanSnake() {
      const map = { ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowUp: 3, KeyW: 3 };
      for (const code in map) if (input.pressed(code)) {
        const d = map[code];
        const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
        if (d !== last && (d + 2) % 4 !== last && g.queue.length < 3) g.queue.push(d);
      }
    }
    function humanFeeder() {
      for (const c of input.clicks) {
        if (g.apple) { g.flash = { text: 'Wait for the snake to eat', t: 1 }; continue; }
        const x = Math.floor((c.x - LEFT) / CELL), y = Math.floor((c.y - TOP) / CELL);
        const why = checkPlace(x, y);
        if (why) { g.flash = { text: 'Can\'t place: ' + why, t: 1, x, y }; CC.sfx.play('bad'); }
        else place(x, y);
      }
    }

    g.update = function (dt) {
      if (g.over) return;
      if (g.msgT > 0) g.msgT -= dt;
      if (g.flash) { g.flash.t -= dt; if (g.flash.t <= 0) g.flash = null; }
      if (!ai[0]) humanSnake();
      if (!ai[1]) humanFeeder();

      // Apple placement window
      if (!g.apple) {
        g.waitT += dt;
        if (ai[1]) {
          if (g.aiFeed.think <= 0) g.aiFeed.think = rng.range(0.35, 0.9);
          if (g.waitT >= g.aiFeed.think) {
            const c = aiFeederPick();
            if (c) place(c.x, c.y);
            g.aiFeed.think = 0;
          }
        } else if (g.waitT > 4) { // human feeder dawdled: random placement
          const cells = validCells();
          if (cells.length) { const c = rng.pick(cells); place(c.x, c.y); }
        }
        if (g.apple) g.waitT = 0;
      }

      g.stepT += dt;
      if (g.stepT < stepTime()) return;
      g.stepT = 0;
      g.steps++;
      if (ai[0]) g.dir = aiSnakeDir();
      else if (g.queue.length) g.dir = g.queue.shift();

      const h = g.body[0];
      const nx = h.x + DIRS[g.dir][0], ny = h.y + DIRS[g.dir][1];
      const blocked = blockedNow();
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || blocked.has(key(nx, ny))) {
        loseLife('Crash!');
        if (!g.over) reset();
        return;
      }
      g.body.unshift({ x: nx, y: ny });
      if (g.grow > 0) g.grow--; else g.body.pop();

      if (g.apple) {
        if (nx === g.apple.x && ny === g.apple.y) {
          g.eaten++; g.grow += 3; g.apple = null;
          CC.sfx.play('eat');
          if (g.eaten >= TARGET) { g.over = true; g.result = { winner: 0, reason: 'The snake ate ' + TARGET + ' apples.' }; }
        } else if (--g.apple.steps <= 0) {
          g.apple = null;
          loseLife('Starved!');
        }
      }
    };

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, CC.W, CC.H);
      ctx.fillStyle = CC.pal.grid;
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2 === 0) ctx.fillRect(LEFT + x * CELL, TOP + y * CELL, CELL, CELL);
      // valid-placement hint for a human feeder
      if (!ai[1] && !g.apple && !g.over) {
        const m = input.mouse;
        const x = Math.floor((m.x - LEFT) / CELL), y = Math.floor((m.y - TOP) / CELL);
        if (y >= 0 && y < ROWS) {
          const ok = !checkPlace(x, y);
          ctx.strokeStyle = ok ? CC.pal.good : CC.pal.a; ctx.lineWidth = 2;
          ctx.strokeRect(LEFT + x * CELL + 1, TOP + y * CELL + 1, CELL - 2, CELL - 2);
        }
        const h = g.body[0];
        ctx.strokeStyle = 'rgba(255,77,109,0.35)'; ctx.setLineDash([4, 4]);
        ctx.strokeRect(LEFT + (h.x - 4) * CELL, TOP + (h.y - 4) * CELL, 9 * CELL, 9 * CELL);
        ctx.setLineDash([]);
      }
      if (g.apple) {
        const a = g.apple, f = a.steps / a.max;
        CC.glow(ctx, CC.pal.a, 14);
        ctx.fillStyle = CC.pal.a;
        ctx.beginPath(); ctx.arc(LEFT + a.x * CELL + CELL / 2, TOP + a.y * CELL + CELL / 2, CELL * 0.38, 0, 7); ctx.fill();
        CC.noGlow(ctx);
        ctx.strokeStyle = f > 0.35 ? CC.pal.c : CC.pal.warn; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(LEFT + a.x * CELL + CELL / 2, TOP + a.y * CELL + CELL / 2, CELL * 0.55, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f); ctx.stroke();
      }
      CC.glow(ctx, CC.pal.b, 10);
      g.body.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? '#c9fff9' : CC.pal.b;
        ctx.globalAlpha = i === 0 ? 1 : CC.lerp(1, 0.55, i / g.body.length);
        ctx.fillRect(LEFT + p.x * CELL + 2, TOP + p.y * CELL + 2, CELL - 4, CELL - 4);
      });
      ctx.globalAlpha = 1; CC.noGlow(ctx);
      CC.hud(ctx, [
        { label: 'Apples', value: g.eaten + ' / ' + TARGET, color: CC.pal.a },
        { label: 'Snake lives', value: '♥'.repeat(Math.max(0, g.lives)), color: CC.pal.b },
        { label: 'Speed', value: 'L' + (1 + Math.floor(prog() * 9)), color: CC.pal.c },
        { label: 'Apple timer', value: g.apple ? g.apple.steps : (g.over ? '-' : 'placing…'), color: CC.pal.c },
      ]);
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.warn, g.msgT);
      if (g.flash) CC.text(ctx, g.flash.text, CC.W / 2, CC.H - 20, 22, CC.pal.a, 'center');
    };

    g.stats = () => ({ eaten: g.eaten, lives: g.lives, steps: g.steps, len: g.body.length });
    return g;
  }

  CC.register({
    id: 'snake', name: 'Snake', color: '#3ee0d0', glyph: 'S',
    blurb: 'One side steers the snake. The other side drops the apples, and each apple has a step timer.',
    roles: [
      { name: 'Snake', controls: 'Arrow keys or WASD' },
      { name: 'Feeder', controls: 'Click an empty cell to drop the next apple (green outline = legal)' },
    ],
    goals: 'The snake needs 30 apples. The feeder needs the snake to lose 3 lives by crashing or starving.',
    create,
  });
})();
