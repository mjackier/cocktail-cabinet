/* TETRIS — roles: [0] Stacker (moves/rotates/drops), [1] Picker (chooses upcoming pieces).
   The stacker wins by clearing 40 lines. The picker wins if the stack tops out.
   Fairness rules for any picker: the stacker always sees the next piece, and no piece can be
   sent more than twice in a row. The computer stacker presses the same move, rotate and drop
   buttons a human does, at a limited rate, and every move is collision-checked. */
(function () {
  'use strict';
  const COLS = 10, ROWS = 20, CELL = 26, BX = 270, BY = 40, TARGET = 40;
  const NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const COLORS = { I: '#3ee0d0', O: '#ffd23f', T: '#9b7bff', S: '#7cff6b', Z: '#ff4d6d', J: '#4d7bff', L: '#ff9f1c' };
  const SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  // Rotate cells clockwise inside an n×n box (I uses 4, O does not rotate, others 3).
  function cellsOf(type, rot) {
    let c = SHAPES[type].map((p) => p.slice());
    if (type === 'O') return c;
    const n = type === 'I' ? 4 : 3;
    for (let r = 0; r < (rot & 3); r++) c = c.map(([x, y]) => [n - 1 - y, x]);
    return c;
  }

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null, t: 0, board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      cur: null, next: null, picked: null, history: [], bag: [], lines: 0, score: 0,
      fallT: 0, lockT: 0, msg: '', msgT: 0, sBrain: { plan: null, t: 0 }, pBrain: {},
      das: { dir: 0, t: 0 },
    };
    const prog = () => g.lines / TARGET;
    const gravity = () => CC.lerp(0.75, 0.1, prog()); // seconds per row
    const allowed = (type) => !(g.history.length >= 2 && g.history[g.history.length - 1] === type && g.history[g.history.length - 2] === type);

    function fromBag() {
      for (let k = 0; k < 20; k++) {
        if (!g.bag.length) { g.bag = NAMES.slice(); for (let i = g.bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [g.bag[i], g.bag[j]] = [g.bag[j], g.bag[i]]; } }
        const t = g.bag.pop();
        if (allowed(t)) return t;
      }
      return NAMES.find(allowed);
    }
    function nextType() {
      let t = null;
      if (ai[1]) t = aiPick();
      else if (g.picked && allowed(g.picked)) t = g.picked;
      if (!t) t = fromBag();
      g.picked = null;
      g.history.push(t); if (g.history.length > 10) g.history.shift();
      return t;
    }

    const fits = (b, type, rot, x, y) => cellsOf(type, rot).every(([cx, cy]) => {
      const X = x + cx, Y = y + cy;
      return X >= 0 && X < COLS && Y < ROWS && (Y < 0 || !b[Y][X]);
    });

    function spawn() {
      g.cur = { type: g.next, rot: 0, x: 3, y: -1 };
      g.next = nextType();
      g.fallT = 0; g.lockT = 0; g.sBrain.plan = null;
      if (!fits(g.board, g.cur.type, 0, 3, -1)) {
        g.over = true; g.result = { winner: 1, reason: 'The stack topped out at ' + g.lines + ' lines.' };
      }
    }
    function tryMove(dx, dy, dr) {
      const c = g.cur, nr = (c.rot + (dr || 0) + 4) & 3;
      const kicks = dr ? [0, -1, 1, -2, 2] : [0];
      for (const k of kicks) if (fits(g.board, c.type, nr, c.x + dx + k, c.y + dy)) { c.x += dx + k; c.y += dy; c.rot = nr; if (dy === 0) g.lockT = 0; return true; }
      return false;
    }
    function lock() {
      for (const [cx, cy] of cellsOf(g.cur.type, g.cur.rot)) {
        const Y = g.cur.y + cy;
        if (Y < 0) { g.over = true; g.result = { winner: 1, reason: 'The stack topped out at ' + g.lines + ' lines.' }; return; }
        g.board[Y][g.cur.x + cx] = g.cur.type;
      }
      const full = [];
      for (let y = 0; y < ROWS; y++) if (g.board[y].every(Boolean)) full.push(y);
      if (full.length) {
        for (const y of full) { g.board.splice(y, 1); g.board.unshift(Array(COLS).fill(null)); }
        g.lines += full.length; g.score += [0, 100, 300, 500, 800][full.length];
        CC.sfx.play('line');
        if (full.length === 4) { g.msg = 'TETRIS!'; g.msgT = 1; }
        if (g.lines >= TARGET) { g.over = true; g.result = { winner: 0, reason: 'The stacker cleared ' + TARGET + ' lines.' }; return; }
      } else CC.sfx.play('lock');
      spawn();
    }
    function hardDrop() { while (tryMove(0, 1, 0)); lock(); }

    // ---------- evaluation shared by both AIs ----------
    function evaluate(b) {
      let agg = 0, holes = 0, bump = 0, prevH = -1, maxH = 0, wells = 0;
      const hs = [];
      for (let x = 0; x < COLS; x++) {
        let h = 0, seen = false;
        for (let y = 0; y < ROWS; y++) {
          if (b[y][x]) { if (!seen) { h = ROWS - y; seen = true; } } else if (seen) holes++;
        }
        hs.push(h); agg += h; maxH = Math.max(maxH, h);
        if (prevH >= 0) bump += Math.abs(h - prevH);
        prevH = h;
      }
      for (let x = 0; x < COLS; x++) { const l = x ? hs[x - 1] : 99, r = x < COLS - 1 ? hs[x + 1] : 99; const d = Math.min(l, r) - hs[x]; if (d > 2) wells += d - 2; }
      return -0.51 * agg - 0.36 * holes * 2 - 0.18 * bump - 0.3 * wells - (maxH > 14 ? (maxH - 14) * 2 : 0);
    }
    function place(b, type, rot, x) {
      let y = -2;
      if (!fits(b, type, rot, x, y)) return null;
      while (fits(b, type, rot, x, y + 1)) y++;
      const nb = b.map((r) => r.slice());
      for (const [cx, cy] of cellsOf(type, rot)) { if (y + cy < 0) return null; nb[y + cy][x + cx] = type; }
      let cleared = 0;
      for (let yy = ROWS - 1; yy >= 0; yy--) if (nb[yy].every(Boolean)) { nb.splice(yy, 1); cleared++; }
      while (nb.length < ROWS) nb.unshift(Array(COLS).fill(null));
      return { b: nb, cleared, y };
    }
    function options(b, type) {
      const out = [];
      for (let rot = 0; rot < (type === 'O' ? 1 : 4); rot++) for (let x = -2; x < COLS; x++) {
        const p = place(b, type, rot, x);
        if (p) out.push({ rot, x, b: p.b, cleared: p.cleared, v: evaluate(p.b) + 0.76 * p.cleared + (p.cleared === 4 ? 1.5 : 0) });
      }
      return out;
    }
    const bestValue = (b, type) => options(b, type).reduce((m, o) => Math.max(m, o.v), -1e9);

    // ---------- AI stacker ----------
    function aiPlan() {
      const skill = CC.lerp(0.35, 0.95, prog());
      const opts = options(g.board, g.cur.type);
      if (!opts.length) return { rot: 0, x: g.cur.x };
      if (skill > 0.55) for (const op of opts) op.v2 = op.v + 0.5 * (bestValue(op.b, g.next) - op.v);
      const key = skill > 0.55 ? 'v2' : 'v';
      opts.sort((a, b) => b[key] - a[key]);
      // Mistakes: sometimes settle for a decent-but-not-best placement.
      const k = rng() < CC.lerp(0.35, 0.04, skill) ? Math.min(opts.length - 1, rng.int(1, 3)) : 0;
      return { rot: opts[k].rot, x: opts[k].x, rate: CC.lerp(7, 22, skill), hard: skill > 0.6 };
    }
    function aiStack(dt) {
      const br = g.sBrain;
      if (!br.plan) { br.plan = aiPlan(); br.t = rng.range(0.12, 0.3) / (1 + prog() * 2); }
      br.t -= dt;
      if (br.t > 0) return;
      br.t = 1 / br.plan.rate;
      const c = g.cur, p = br.plan;
      if (c.rot !== p.rot) { if (!tryMove(0, 0, 1)) br.plan = aiPlan(); return; }
      if (c.x !== p.x) { if (!tryMove(Math.sign(p.x - c.x), 0, 0)) { if (!tryMove(0, 1, 0)) lock(); } return; }
      if (p.hard) hardDrop(); else if (!tryMove(0, 1, 0)) lock();
    }

    // ---------- AI picker ----------
    function aiPick() {
      const skill = CC.lerp(0.2, 0.9, prog());
      const cands = NAMES.filter(allowed);
      if (rng() < CC.lerp(0.08, 0.7, skill)) {
        // Adversarial: send the piece that fits the current board worst.
        let worst = null;
        for (const t of cands) { const v = bestValue(g.board, t); if (!worst || v < worst.v) worst = { t, v }; }
        return worst.t;
      }
      return null; // fall back to the fair bag
    }

    g.next = nextType();
    spawn();

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      // Picker input (human): keys 1–7 or click a piece in the palette.
      if (!ai[1]) {
        for (let k = 1; k <= 7; k++) if (input.pressed('Digit' + k)) g.picked = NAMES[k - 1];
        for (const c of input.clicks) {
          const i = paletteHit(c.x, c.y);
          if (i >= 0) g.picked = NAMES[i];
        }
        if (g.picked && !allowed(g.picked)) { g.msg = 'No triples!'; g.msgT = 0.7; g.picked = null; }
      }
      if (ai[0]) aiStack(dt);
      else {
        // Human stacker with simple auto-repeat on left/right.
        const L = input.down('ArrowLeft') || input.down('KeyA'), R = input.down('ArrowRight') || input.down('KeyD');
        const dir = (R ? 1 : 0) - (L ? 1 : 0);
        if (dir !== g.das.dir) { g.das.dir = dir; g.das.t = 0.16; if (dir) tryMove(dir, 0, 0); }
        else if (dir) { g.das.t -= dt; if (g.das.t <= 0) { g.das.t = 0.05; tryMove(dir, 0, 0); } }
        if (input.pressed('ArrowUp') || input.pressed('KeyW') || input.pressed('KeyX')) tryMove(0, 0, 1);
        if (input.pressed('KeyZ')) tryMove(0, 0, -1);
        if (input.pressed('Space')) { hardDrop(); return; }
        if (input.down('ArrowDown') || input.down('KeyS')) g.fallT += dt * 12;
      }
      if (g.over) return;
      g.fallT += dt;
      if (g.fallT >= gravity()) {
        g.fallT = 0;
        if (!tryMove(0, 1, 0)) { g.lockT += gravity(); }
      }
      if (!fits(g.board, g.cur.type, g.cur.rot, g.cur.x, g.cur.y + 1)) {
        g.lockT += dt;
        if (g.lockT > 0.5) lock();
      }
    };

    const PAL_X = 580, PAL_Y = 300;
    function paletteHit(x, y) {
      for (let i = 0; i < 7; i++) { const px = PAL_X + (i % 4) * 52, py = PAL_Y + Math.floor(i / 4) * 52; if (x > px && x < px + 46 && y > py && y < py + 46) return i; }
      return -1;
    }
    function drawPiece(ctx, type, rot, ox, oy, size, alpha) {
      ctx.globalAlpha = alpha || 1;
      ctx.fillStyle = COLORS[type];
      for (const [cx, cy] of cellsOf(type, rot)) ctx.fillRect(ox + cx * size + 1, oy + cy * size + 1, size - 2, size - 2);
      ctx.globalAlpha = 1;
    }

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, CC.W, CC.H);
      ctx.fillStyle = '#0f0c20'; ctx.fillRect(BX, BY, COLS * CELL, ROWS * CELL);
      ctx.strokeStyle = '#2a2450'; ctx.lineWidth = 2; ctx.strokeRect(BX - 1, BY - 1, COLS * CELL + 2, ROWS * CELL + 2);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g.board[y][x]) { ctx.fillStyle = COLORS[g.board[y][x]]; ctx.fillRect(BX + x * CELL + 1, BY + y * CELL + 1, CELL - 2, CELL - 2); }
      if (g.cur && !g.over) {
        let gy = g.cur.y; while (fits(g.board, g.cur.type, g.cur.rot, g.cur.x, gy + 1)) gy++;
        ctx.save(); ctx.beginPath(); ctx.rect(BX, BY, COLS * CELL, ROWS * CELL); ctx.clip();
        drawPiece(ctx, g.cur.type, g.cur.rot, BX + g.cur.x * CELL, BY + gy * CELL, CELL, 0.2);
        drawPiece(ctx, g.cur.type, g.cur.rot, BX + g.cur.x * CELL, BY + g.cur.y * CELL, CELL);
        ctx.restore();
      }
      CC.text(ctx, 'NEXT', 600, 60, 22, CC.pal.dim);
      if (g.next) drawPiece(ctx, g.next, 0, 600, 80, 22);
      CC.text(ctx, 'LINES', 40, 70, 20, CC.pal.dim); CC.text(ctx, g.lines + ' / ' + TARGET, 40, 96, 34, CC.pal.b);
      CC.text(ctx, 'SCORE', 40, 140, 20, CC.pal.dim); CC.text(ctx, String(g.score), 40, 166, 34, CC.pal.c);
      CC.text(ctx, 'SPEED', 40, 210, 20, CC.pal.dim); CC.text(ctx, (1 / gravity()).toFixed(1) + ' rows/s', 40, 236, 28, CC.pal.a);
      CC.text(ctx, 'RECENT', 40, 290, 20, CC.pal.dim);
      g.history.slice(-8).forEach((t, i) => CC.text(ctx, t, 40 + i * 24, 316, 26, COLORS[t]));
      if (!ai[1]) {
        CC.text(ctx, 'PICK THE PIECE', 580, 256, 20, CC.pal.c);
        CC.text(ctx, 'AFTER NEXT', 580, 278, 20, CC.pal.c);
        NAMES.forEach((t, i) => {
          const px = PAL_X + (i % 4) * 52, py = PAL_Y + Math.floor(i / 4) * 52;
          ctx.strokeStyle = g.picked === t ? CC.pal.c : allowed(t) ? '#2a2450' : '#552222'; ctx.lineWidth = 2;
          ctx.strokeRect(px, py, 46, 46);
          drawPiece(ctx, t, 0, px + 5, py + 10, 9, allowed(t) ? 1 : 0.3);
          CC.text(ctx, String(i + 1), px + 40, py + 8, 14, CC.pal.dim, 'right');
        });
        CC.text(ctx, g.picked ? 'Queued: ' + g.picked : 'None queued', 580, 420, 20, g.picked ? CC.pal.c : CC.pal.dim);
      }
      if (g.msgT > 0) CC.banner(ctx, g.msg, CC.pal.c, g.msgT);
    };
    g.stats = () => ({ lines: g.lines, t: Math.round(g.t) });
    return g;
  }

  CC.register({
    id: 'tetris', name: 'Tetris', color: '#9b7bff', glyph: '▦',
    blurb: 'My pick for the seventh game. One side stacks the pieces. The other side chooses which piece comes next, and can be as nasty as the rules allow.',
    roles: [
      { name: 'Stacker', controls: '← → move, ↑ or X rotate, Z rotate back, ↓ soft drop, Space hard drop' },
      { name: 'Picker', controls: 'Keys 1–7 or click a piece to queue the one after next. No piece three times in a row' },
    ],
    goals: 'The stacker needs to clear 40 lines. The picker needs the stack to top out.',
    create,
  });
})();
