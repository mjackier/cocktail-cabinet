/* SHADOW WALKER — roles: [0] Walker (crosses the room), [1] Lightkeeper (slides the lamps).
   A creature that burns in light must cross a room from the left doorway to the right doorway.
   Two lamps hang on rails along the top and bottom walls, each lighting a limited circle. Furniture casts real
   shadows from wherever each lamp is, so the shadows swing as the lamps move.
   Standing in light heats the walker up; shadow cools it down. Full heat = burned.
   The walker wins by crossing 6 rooms. The lightkeeper wins by burning the walker 3 times
   (each room also has a "dawn" timer, so the walker can't hide forever). Each lamp runs on a battery:
   it stays lit for a few seconds, then goes dark to recharge, and the two batteries run out at
   different times. So two lamps can't seal the doorway forever.
   Fairness: both lamps have the same top speed for a human or the computer. The computer walker
   only knows what's on screen (lamp positions, lamp top speed, furniture) and moves at the same
   speed as a human walker; every light check is real line-of-sight geometry. */
(function () {
  'use strict';
  const W = 800, H = 600, TOP = 52, R = 11, SPEED = 170, CROSSINGS = 6, LIVES = 3, ALCOVE = 46;
  const CELL = 20, COLS = W / CELL, ROWS = Math.floor((H - TOP) / CELL);
  const SAMP = 25, NS = W / SAMP + 1; // lamp positions along a rail that are pre-computed
  const RAIL_Y = [TOP + 5, H - 5];
  const COOL_TIME = 1.4, DARK_TIME = 1.8; // DARK_TIME: how long a lamp is off while its battery recharges
  const cellX = (c) => c * CELL + CELL / 2, cellY = (r) => TOP + r * CELL + CELL / 2;

  // Does the segment (x0,y0)-(x1,y1) pass through rectangle k? (Liang–Barsky clipping)
  function blocks(x0, y0, x1, y1, k) {
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy], q = [x0 - k.x, k.x + k.w - x0, y0 - k.y, k.y + k.h - y0];
    let u0 = 0, u1 = 1;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > u1) return false; if (t > u0) u0 = t; } else { if (t < u0) return false; if (t < u1) u1 = t; }
    }
    return u0 <= u1;
  }
  const anyBlock = (x0, y0, x1, y1, rects) => rects.some((k) => blocks(x0, y0, x1, y1, k));
  function circleHits(x, y, rects, pad) {
    for (const k of rects) {
      const nx = CC.clamp(x, k.x, k.x + k.w), ny = CC.clamp(y, k.y, k.y + k.h);
      if ((x - nx) ** 2 + (y - ny) ** 2 < (R + pad) ** 2) return true;
    }
    return false;
  }
  function hull(pts) { // convex hull, monotone chain
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const g = {
      over: false, result: null, t: 0, crossing: 0, lives: LIVES, heat: 0, dawn: 0, grace: 0,
      rects: [], lamps: [], table: null, pass: null, w: { x: 24, y: 300, vx: 0, vy: 0 },
      lit: false, sel: 0, msg: '', msgT: 0, wb: { t: 0, path: null }, kb: { t: 0 }, sparks: [],
    };
    const prog = () => g.crossing / (CROSSINGS - 1);
    const lampSpeed = () => CC.lerp(100, 240, prog());
    const reach = () => CC.lerp(250, 320, prog()); // how far each lamp's light reaches
    const burnTime = () => CC.lerp(1.35, 0.8, prog());
    const nLamps = () => 2;
    const dawnTime = () => CC.lerp(30, 22, prog());
    const onTime = () => CC.lerp(6, 8, prog()); // seconds a lamp can stay lit on one charge
    const inAlcove = (x) => x < ALCOVE || x > W - ALCOVE;
    const cellOf = (x, y) => CC.clamp(Math.floor((y - TOP) / CELL), 0, ROWS - 1) * COLS + CC.clamp(Math.floor(x / CELL), 0, COLS - 1);

    function newRoom() {
      const n = Math.round(CC.lerp(9, 6, prog())), GAP = 44, rects = [];
      for (let tries = 0; rects.length < n && tries < 800; tries++) {
        const w = rng.range(50, 110), h = rng.range(28, 80);
        const x = rng.range(ALCOVE + 40, W - ALCOVE - 40 - w), y = rng.range(TOP + 34, H - 34 - h);
        if (rects.some((k) => x < k.x + k.w + GAP && x + w + GAP > k.x && y < k.y + k.h + GAP && y + h + GAP > k.y)) continue;
        rects.push({ x, y, w, h });
      }
      g.rects = rects;
      g.pass = new Uint8Array(COLS * ROWS);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g.pass[r * COLS + c] = circleHits(cellX(c), cellY(r), rects, 2) ? 0 : 1;
      // table[lamp rail][lamp position][cell] = 1 if a lamp there lights that cell
      g.table = [0, 1].map((l) => {
        const arr = [];
        for (let s = 0; s < NS; s++) {
          const lx = CC.clamp(s * SAMP, 6, W - 6), t = new Uint8Array(COLS * ROWS), rr = reach();
          for (let i = 0; i < t.length; i++) {
            const x = cellX(i % COLS), y = cellY((i / COLS) | 0);
            if (g.pass[i] && Math.hypot(x - lx, y - RAIL_Y[l]) <= rr) t[i] = anyBlock(lx, RAIL_Y[l], x, y, rects) ? 0 : 1;
          }
          arr.push(t);
        }
        return arr;
      });
      // exposure[cell] = share of all lamp positions that would light it (good hiding spots are low)
      g.expo = new Float32Array(COLS * ROWS);
      for (let i = 0; i < g.expo.length; i++) { let n = 0; for (let l = 0; l < 2; l++) for (let s = 0; s < NS; s++) n += g.table[l][s][i]; g.expo[i] = n / (2 * NS); }
      g.lamps = [0, 1].map((l) => { const x = rng.range(350, 700); return { x, tx: x, y: RAIL_Y[l], batt: onTime(), off: 0 }; });
      g.lamps[rng.int(0, 1)].batt *= 0.5; // the two batteries run out at different times
      g.w = { x: ALCOVE / 2, y: rng.range(TOP + 60, H - 60), vx: 0, vy: 0 };
      g.heat = 0; g.dawn = dawnTime(); g.grace = 1.2; g.wb.path = null;
    }

    function litAt(x, y) {
      if (inAlcove(x)) return false;
      for (let l = 0; l < nLamps(); l++) { const L = g.lamps[l]; if (L.off <= 0 && Math.hypot(x - L.x, y - L.y) <= reach() && !anyBlock(L.x, L.y, x, y, g.rects)) return true; }
      return false;
    }

    function moveWalker(dx, dy, dt) {
      const len = Math.hypot(dx, dy), w = g.w;
      if (len > 1e-6) { dx /= len; dy /= len; } else { dx = 0; dy = 0; }
      const nx = CC.clamp(w.x + dx * SPEED * dt, R, W - R);
      if (!circleHits(nx, w.y, g.rects, 0)) w.x = nx;
      const ny = CC.clamp(w.y + dy * SPEED * dt, TOP + R, H - R);
      if (!circleHits(w.x, ny, g.rects, 0)) w.y = ny;
      w.vx = dx * SPEED; w.vy = dy * SPEED;
    }

    // ---------- computer walker ----------
    // Risk that a cell is lit `t` seconds from now. A careful walker plans for the worst case:
    // each lamp could be anywhere it can reach in that time (lamp top speed is public), so a cell
    // is risky if any of those positions would light it. A careless walker only looks at where
    // the lamps are right now.
    // Is lamp L switched off t seconds from now? (Everyone can see the battery bars.)
    function lampOffAt(L, t) {
      if (L.off > 0) return t < L.off - 0.3;
      return t > L.batt + 0.3 && t < L.batt + DARK_TIME - 0.3;
    }
    function risk(ci, t, careful, scale, ignoreOff) { // scale: how far ahead the walker imagines lamps moving
      const x = cellX(ci % COLS);
      if (x < ALCOVE || x > W - ALCOVE) return 0;
      for (let l = 0; l < nLamps(); l++) {
        const L = g.lamps[l], move = careful ? lampSpeed() * t * (scale == null ? 1 : scale) : 0;
        if (!ignoreOff && lampOffAt(L, t)) continue; // a lamp that will be recharging then can't light anything
        const a = CC.clamp(Math.floor((L.x - move) / SAMP), 0, NS - 1), b = CC.clamp(Math.ceil((L.x + move) / SAMP), 0, NS - 1);
        for (let s = a; s <= b; s++) if (g.table[l][s][ci]) return 1;
      }
      return 0;
    }
    function plan(skill) {
      const careful = skill > 0.4, Wt = CC.lerp(3, 9, skill), We = CC.lerp(0, 3, skill), horizon = CC.lerp(0.2, 0.55, skill), N = COLS * ROWS;
      const dist = new Float64Array(N).fill(Infinity), time = new Float64Array(N), prev = new Int32Array(N).fill(-1);
      let s = cellOf(g.w.x, g.w.y);
      if (!g.pass[s]) { // standing next to furniture: start from the nearest open cell
        let best = -1, bd = 1e9;
        for (let i = 0; i < N; i++) if (g.pass[i]) { const d = (cellX(i % COLS) - g.w.x) ** 2 + (cellY((i / COLS) | 0) - g.w.y) ** 2; if (d < bd) { bd = d; best = i; } }
        s = best;
      }
      const heap = [[0, s]]; dist[s] = 0;
      const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      let goal = -1;
      while (heap.length) {
        const [d, i] = pop();
        if (d > dist[i]) continue;
        const c = i % COLS, r = (i / COLS) | 0;
        if (cellX(c) > W - ALCOVE + 4) { goal = i; break; }
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
          if (!dc && !dr) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          const ni = nr * COLS + nc;
          if (!g.pass[ni]) continue;
          if (dc && dr && (!g.pass[r * COLS + nc] || !g.pass[nr * COLS + c])) continue;
          const len = dc && dr ? 1.414 : 1, tt = time[i] + (len * CELL) / SPEED;
          const rk = Math.max(risk(ni, tt, false), risk(ni, tt, careful, horizon));
          const nd = d + len * (1 + Wt * rk + We * g.expo[ni]);
          if (nd < dist[ni]) { dist[ni] = nd; time[ni] = tt; prev[ni] = i; push([nd, ni]); }
        }
      }
      if (goal < 0) return null;
      const path = [];
      for (let i = goal; i >= 0; i = prev[i]) path.push(i);
      return path.reverse();
    }
    // A cell is a safe place to stop if it stays dark even once every lamp is back on.
    const safeStop = (ci, careful, skill) => risk(ci, 0.6, careful, CC.lerp(0, 0.5, skill), true) === 0 || inAlcove(cellX(ci % COLS));
    function nearestShelter(careful, skill) {
      const start = cellOf(g.w.x, g.w.y), seen = new Uint8Array(COLS * ROWS), q = [start], prev = new Int32Array(COLS * ROWS).fill(-1);
      seen[start] = 1;
      for (let h = 0; h < q.length && h < 400; h++) {
        const i = q[h];
        if (i !== start && g.pass[i] && safeStop(i, careful, skill)) { let k = i; while (prev[k] !== start && prev[k] >= 0) k = prev[k]; return k; }
        const c = i % COLS, r = (i / COLS) | 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr, ni = nr * COLS + nc;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen[ni] || !g.pass[ni]) continue;
          seen[ni] = 1; prev[ni] = i; q.push(ni);
        }
      }
      return -1;
    }
    function aiWalker(dt) {
      const br = g.wb, skill = CC.lerp(0.3, 0.92, prog()), careful = skill > 0.4;
      br.t -= dt;
      if (br.t <= 0 || !br.path) {
        br.t = CC.lerp(0.28, 0.08, skill) * rng.range(0.8, 1.25); // reaction time
        br.path = plan(skill);
        br.hold = -1; br.flee = -1;
        if (br.path) {
          // How much heat will I pick up before the next place I can safely stop?
          let t = 0, burn = 0, lastStop = g.lit ? -1 : 0, exposed = false;
          for (let k = 1; k < br.path.length; k++) {
            t += CELL / SPEED;
            const ci = br.path[k];
            const rk = Math.max(risk(ci, t, false), risk(ci, t, careful, CC.lerp(0, 0.6, skill)));
            if (rk > 0) { exposed = true; burn += (CELL / SPEED) / burnTime(); }
            if (safeStop(ci, careful, skill)) { if (exposed) break; lastStop = k; }
          }
          const limit = CC.lerp(1.05, 0.75, skill) + rng.gauss() * 0.05;
          if (g.heat + burn > limit && g.dawn > 4) {
            if (!g.lit && lastStop >= 0) br.hold = lastStop; // wait here and cool off
            else if (g.lit && skill > 0.35) br.flee = nearestShelter(careful, skill); // caught out: duck into the nearest shadow
          }
        }
      }
      const p = br.path;
      if (br.flee >= 0) {
        const dx = cellX(br.flee % COLS) - g.w.x, dy = cellY((br.flee / COLS) | 0) - g.w.y;
        return [dx, dy];
      }
      if (!p || p.length < 2) return [1, 0]; // no route known: head for the exit anyway
      // Aim at the path cell after the one I'm standing in (the plan may be a few frames old).
      const here = p.lastIndexOf(cellOf(g.w.x, g.w.y));
      const next = Math.min(p.length - 1, Math.max(1, here + 1));
      const tgt = br.hold >= 0 ? p[Math.min(br.hold, Math.max(here, 0) + 1, p.length - 1)] : p[next];
      if (br.hold >= 0 && here >= br.hold) return [0, 0];
      let tx = cellX(tgt % COLS);
      const ty = cellY((tgt / COLS) | 0);
      if (tgt === p[p.length - 1]) tx += CELL; // keep walking into the exit doorway
      const dx = tx - g.w.x, dy = ty - g.w.y;
      return Math.hypot(dx, dy) < 2 ? [0, 0] : [dx, dy];
    }

    // ---------- computer lightkeeper ----------
    function aiKeeper(dt) {
      const br = g.kb, skill = CC.lerp(0.25, 0.92, prog());
      br.t -= dt;
      if (br.t > 0) return;
      br.t = CC.lerp(0.4, 0.1, skill) * rng.range(0.8, 1.25);
      const w = g.w, lead = CC.lerp(0.05, 0.45, skill);
      const px = CC.clamp(w.x + w.vx * lead, 0, W - 1), py = CC.clamp(w.y + w.vy * lead, TOP, H - 1);
      const pc = cellOf(px, py), wc = cellOf(w.x, w.y), pcc = pc % COLS, pcr = (pc / COLS) | 0;
      const near = [];
      for (let dr = -6; dr <= 6; dr++) for (let dc = -3; dc <= 7; dc++) {
        const c = pcc + dc, r = pcr + dr;
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS || dc * dc + dr * dr > 49) continue;
        const i = r * COLS + c;
        if (g.pass[i] && !inAlcove(cellX(c))) near.push(i);
      }
      const covered = new Uint8Array(near.length);
      for (let l = 0; l < nLamps(); l++) {
        const L = g.lamps[l];
        let best = L.x, bestS = -1e9, bestTab = null;
        for (let s = 0; s < NS; s++) {
          const tab = g.table[l][s];
          let sc = (tab[pc] ? 3 : 0) + (tab[wc] ? 1 : 0), add = 0;
          for (let j = 0; j < near.length; j++) if (!covered[j] && tab[near[j]]) add++;
          sc += (2 * add) / Math.max(1, near.length);
          sc -= (Math.abs(s * SAMP - L.x) / W) * CC.lerp(0.3, 1.4, skill); // nearby positions arrive sooner
          if (sc > bestS) { bestS = sc; best = s * SAMP; bestTab = tab; }
        }
        if (bestTab) for (let j = 0; j < near.length; j++) if (bestTab[near[j]]) covered[j] = 1;
        L.tx = best + rng.gauss() * CC.lerp(70, 12, skill);
      }
    }

    function lose(why) {
      g.lives--;
      g.msg = why; g.msgT = 1.2;
      CC.sfx.play('die');
      if (g.lives <= 0) { g.over = true; g.result = { winner: 1, reason: why === 'Burned!' ? 'The walker was burned three times.' : 'Dawn caught the walker one time too many.' }; return; }
      g.w.x = ALCOVE / 2; g.w.vx = g.w.vy = 0; g.heat = 0; g.dawn = dawnTime(); g.grace = 1; g.wb.path = null;
    }

    if (o.startRoom) g.crossing = Math.min(o.startRoom, CROSSINGS - 1); // used by tests to jump to a level
    newRoom();
    g._plan = plan; // exposed for tests

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      // Lightkeeper
      if (ai[1]) aiKeeper(dt);
      else {
        // A/D slide the top lamp, ←/→ slide the bottom lamp. Both can move at once.
        const steer = (L, left, right) => { const d = (input.down(right) ? 1 : 0) - (input.down(left) ? 1 : 0); L.tx = d ? L.x + d * 80 : L.x; };
        steer(g.lamps[0], 'KeyA', 'KeyD');
        steer(g.lamps[1], 'ArrowLeft', 'ArrowRight');
      }
      for (let l = 0; l < nLamps(); l++) {
        const L = g.lamps[l], d = CC.clamp(L.tx, 6, W - 6) - L.x, m = lampSpeed() * dt;
        L.x += CC.clamp(d, -m, m);
        // Battery: a lamp stays lit for onTime() seconds, then goes dark for DARK_TIME to recharge.
        if (L.off > 0) { L.off -= dt; if (L.off <= 0) { L.off = 0; L.batt = onTime(); } }
        else { L.batt -= dt; if (L.batt <= 0) { L.off = DARK_TIME; CC.sfx.play('bad'); } }
      }
      if (g.grace > 0) { g.grace -= dt; g.lit = false; return; }
      // Walker
      let dx = 0, dy = 0;
      if (ai[0]) [dx, dy] = aiWalker(dt);
      else {
        const k = (a, b, c) => input.down(c) || (ai[1] && (input.down(a) || input.down(b))); // arrows/WASD are the lamps' keys in a 2-human game
        dx = (k('ArrowRight', 'KeyD', 'KeyL') ? 1 : 0) - (k('ArrowLeft', 'KeyA', 'KeyJ') ? 1 : 0);
        dy = (k('ArrowDown', 'KeyS', 'KeyK') ? 1 : 0) - (k('ArrowUp', 'KeyW', 'KeyI') ? 1 : 0);
      }
      moveWalker(dx, dy, dt);
      g.lit = litAt(g.w.x, g.w.y);
      if (g.lit) {
        g.heat += dt / burnTime();
        if (rng() < 0.5) g.sparks.push({ x: g.w.x + rng.range(-8, 8), y: g.w.y + rng.range(-8, 8), vy: -rng.range(20, 60), life: rng.range(0.3, 0.6) });
      } else g.heat = Math.max(0, g.heat - dt / COOL_TIME);
      g.dawn -= dt;
      for (const s of g.sparks) { s.y += s.vy * dt; s.life -= dt; }
      g.sparks = g.sparks.filter((s) => s.life > 0);
      if (g.heat >= 1) return lose('Burned!');
      if (g.dawn <= 0) return lose('Dawn broke!');
      if (g.w.x > W - ALCOVE + R) {
        g.crossing++;
        CC.sfx.play('point');
        if (g.crossing >= CROSSINGS) { g.over = true; g.result = { winner: 0, reason: 'The walker crossed all ' + CROSSINGS + ' rooms.' }; return; }
        g.msg = 'Room ' + (g.crossing + 1) + ' of ' + CROSSINGS; g.msgT = 1.4;
        newRoom();
      }
    };

    // ---------- drawing ----------
    let lightCanvas = null;
    g.draw = function (ctx) {
      ctx.fillStyle = '#08070c'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = TOP; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // Light: one layer per lamp, with each piece of furniture's shadow cut out of it.
      if (!lightCanvas) { lightCanvas = document.createElement('canvas'); lightCanvas.width = W; lightCanvas.height = H; }
      const lc = lightCanvas.getContext('2d');
      for (let l = 0; l < nLamps(); l++) {
        const L = g.lamps[l];
        if (L.off > 0) continue;
        lc.globalCompositeOperation = 'source-over';
        lc.clearRect(0, 0, W, H);
        const rr = reach(), grad = lc.createRadialGradient(L.x, L.y, 10, L.x, L.y, rr);
        grad.addColorStop(0, 'rgba(255,214,140,0.6)'); grad.addColorStop(0.85, 'rgba(255,190,110,0.3)'); grad.addColorStop(1, 'rgba(255,170,90,0.26)');
        lc.fillStyle = grad;
        lc.save(); lc.beginPath(); lc.rect(ALCOVE, TOP, W - 2 * ALCOVE, H - TOP); lc.clip();
        lc.beginPath(); lc.arc(L.x, L.y, rr, 0, 7); lc.fill(); lc.restore();
        lc.globalCompositeOperation = 'destination-out';
        lc.fillStyle = '#000';
        for (const k of g.rects) {
          const corners = [[k.x, k.y], [k.x + k.w, k.y], [k.x, k.y + k.h], [k.x + k.w, k.y + k.h]];
          const pts = corners.slice();
          for (const [cx, cy] of corners) { const dx = cx - L.x, dy = cy - L.y, d = Math.hypot(dx, dy) || 1; pts.push([cx + (dx / d) * 2000, cy + (dy / d) * 2000]); }
          const hp = hull(pts);
          lc.beginPath(); hp.forEach(([x, y], i) => (i ? lc.lineTo(x, y) : lc.moveTo(x, y))); lc.closePath(); lc.fill();
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(lightCanvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      }
      // doorways
      ctx.fillStyle = '#040306';
      ctx.fillRect(0, TOP, ALCOVE, H - TOP); ctx.fillRect(W - ALCOVE, TOP, ALCOVE, H - TOP);
      ctx.strokeStyle = 'rgba(155,123,255,0.5)'; ctx.setLineDash([6, 6]);
      ctx.strokeRect(1, TOP + 1, ALCOVE - 2, H - TOP - 2); ctx.strokeRect(W - ALCOVE + 1, TOP + 1, ALCOVE - 2, H - TOP - 2); ctx.setLineDash([]);
      ctx.save(); ctx.translate(ALCOVE / 2 + 6, H / 2 + 20); ctx.rotate(-Math.PI / 2); CC.text(ctx, 'START', 0, 0, 20, CC.pal.dim, 'center'); ctx.restore();
      ctx.save(); ctx.translate(W - ALCOVE / 2 + 6, H / 2 + 20); ctx.rotate(-Math.PI / 2); CC.text(ctx, 'EXIT', 0, 0, 20, CC.pal.good, 'center'); ctx.restore();
      // furniture
      for (const k of g.rects) {
        ctx.fillStyle = '#3b2a1c'; ctx.fillRect(k.x, k.y, k.w, k.h);
        ctx.fillStyle = '#5a412b'; ctx.fillRect(k.x, k.y, k.w, 5);
        ctx.strokeStyle = '#1e140d'; ctx.lineWidth = 2; ctx.strokeRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2);
      }
      // rails and lamps
      for (let l = 0; l < nLamps(); l++) {
        const L = g.lamps[l];
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, L.y); ctx.lineTo(W, L.y); ctx.stroke();
        if (L.off > 0) { ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.arc(L.x, L.y, 8, 0, 7); ctx.fill(); }
        else { CC.glow(ctx, '#ffd28c', 24); ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(L.x, L.y, 8, 0, 7); ctx.fill(); CC.noGlow(ctx); }
        const by = l === 0 ? L.y + 13 : L.y - 17;
        if (L.off > 0) CC.text(ctx, 'recharging ' + Math.ceil(L.off) + 's', L.x, by + 2, 16, CC.pal.dim, 'center');
        else CC.bar(ctx, L.x - 18, by, 36, 4, L.batt / onTime(), L.batt < 1.5 ? CC.pal.a : CC.pal.good);
        if (!ai[1]) CC.text(ctx, l === 0 ? 'A / D' : '← / →', L.x, l === 0 ? L.y + 30 : L.y - 33, 16, CC.pal.c, 'center');
      }
      // walker
      const w = g.w, hot = g.heat;
      ctx.fillStyle = '#ffb347';
      for (const s of g.sparks) { ctx.globalAlpha = CC.clamp(s.life * 2, 0, 1); ctx.fillRect(s.x, s.y, 2, 2); }
      ctx.globalAlpha = 1;
      CC.glow(ctx, hot > 0.05 ? '#ff4d1a' : '#9b7bff', 10 + hot * 20);
      ctx.fillStyle = '#16101f';
      ctx.beginPath(); ctx.arc(w.x, w.y, R, 0, 7); ctx.fill();
      ctx.strokeStyle = hot > 0.05 ? `rgb(255,${Math.round(180 - hot * 140)},60)` : '#9b7bff'; ctx.lineWidth = 2; ctx.stroke();
      CC.noGlow(ctx);
      ctx.fillStyle = hot > 0.5 ? '#ff6b3d' : '#e8ddff';
      const ex = Math.sign(w.vx) * 2;
      ctx.fillRect(w.x - 5 + ex, w.y - 3, 3, 3); ctx.fillRect(w.x + 2 + ex, w.y - 3, 3, 3);
      if (hot > 0.02) CC.bar(ctx, w.x - 16, w.y - R - 9, 32, 4, hot, hot > 0.6 ? CC.pal.a : CC.pal.warn);
      CC.hud(ctx, [
        { label: 'Rooms crossed', value: g.crossing + ' / ' + CROSSINGS, color: CC.pal.d },
        { label: 'Walker lives', value: '♥'.repeat(Math.max(0, g.lives)), color: CC.pal.d },
        { label: 'Dawn in', value: Math.max(0, Math.ceil(g.dawn)) + 's', color: g.dawn < 6 ? CC.pal.a : CC.pal.c },
        { label: 'Lamp speed / reach', value: Math.round(lampSpeed()) + ' / ' + Math.round(reach()), color: CC.pal.c },
      ]);
      if (g.grace > 0 && !g.over) CC.text(ctx, 'Get ready…', W / 2, H / 2 + 60, 26, CC.pal.text, 'center');
      if (g.msgT > 0) CC.banner(ctx, g.msg, g.msg.startsWith('Room') ? CC.pal.c : CC.pal.a, g.msgT);
    };
    g.stats = () => ({ crossing: g.crossing, lives: g.lives, t: Math.round(g.t) });
    return g;
  }

  CC.register({
    id: 'shadow', name: 'Shadow Walker', color: '#ffb347', glyph: '☾',
    blurb: 'A creature that burns in light must cross the room through the shadows. The other side slides the lamps, and the shadows swing with them.',
    roles: [
      { name: 'Walker', controls: 'Arrow keys or WASD (I/J/K/L when two humans play). Light heats you up, shadow cools you down' },
      { name: 'Lightkeeper', controls: 'A / D slide the top lamp, ← / → slide the bottom lamp. Each lamp\'s battery lasts a few seconds, then it goes dark to recharge' },
    ],
    goals: 'The walker needs to cross 6 rooms. The lightkeeper needs to burn the walker 3 times. A dawn timer stops the walker hiding forever, and each lamp goes dark to recharge every few seconds.',
    create,
  });
})();
