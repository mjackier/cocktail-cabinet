/* SONAR HUNT — roles: [0] Sub (escapes the maze), [1] Hunter (catches the sub).
   The maze is pitch black. The sub always knows where the exit beacon is, but not where the
   walls are. Pressing ping sends out a sonar ring that lights up nearby walls for a few
   seconds (and shows the hunter if it's in range), but it also tells the hunter exactly where
   the ping came from. Bumping into a wall reveals that one wall, silently.
   The hunter knows the whole maze but NOT where the sub or the exit is. It only learns from
   pings, and from a short-range "contact" when the two are very close (both sides get that).
   Each round is a new maze. The sub scores by escaping; the hunter scores by catching it or
   when the sub's air runs out. First to 3.
   Fairness: the computer players only read their own side's information (see sInfo / hInfo
   below), move at the same speeds a human does, and the hunter is never told where the exit is. */
(function () {
  'use strict';
  const W = 800, H = 600, TOP = 50, AREA = 546, WIN = 3;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const KEYS = [['ArrowRight', 'KeyD'], ['ArrowDown', 'KeyS'], ['ArrowLeft', 'KeyA'], ['ArrowUp', 'KeyW']];
  const SUB_SPEED = 2.4, RING_SPEED = 11, PING_CD = 0.8, CONTACT = 1.5, CATCH = 0.6; // in cells and seconds

  function makeMaze(C, R, rng, loops) {
    const east = new Uint8Array(C * R).fill(1), south = new Uint8Array(C * R).fill(1);
    const carve = (c, r, d) => { if (d === 0) east[r * C + c] = 0; else if (d === 2) east[r * C + c - 1] = 0; else if (d === 1) south[r * C + c] = 0; else south[(r - 1) * C + c] = 0; };
    const seen = new Uint8Array(C * R), stack = [rng.int(0, C * R - 1)];
    seen[stack[0]] = 1;
    while (stack.length) { // recursive backtracker
      const i = stack[stack.length - 1], c = i % C, r = (i / C) | 0, opts = [];
      for (let d = 0; d < 4; d++) { const nc = c + DX[d], nr = r + DY[d]; if (nc >= 0 && nr >= 0 && nc < C && nr < R && !seen[nr * C + nc]) opts.push(d); }
      if (!opts.length) { stack.pop(); continue; }
      const d = rng.pick(opts), ni = (r + DY[d]) * C + c + DX[d];
      carve(c, r, d); seen[ni] = 1; stack.push(ni);
    }
    // knock out extra walls so there are loops and more than one route
    for (let k = 0, removed = 0; k < C * R * 6 && removed < loops * C * R; k++) {
      const c = rng.int(0, C - 1), r = rng.int(0, R - 1);
      if (rng() < 0.5) { if (c < C - 1 && east[r * C + c]) { east[r * C + c] = 0; removed++; } } else if (r < R - 1 && south[r * C + c]) { south[r * C + c] = 0; removed++; }
    }
    return { C, R, east, south };
  }

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const view = ai[0] === ai[1] ? 'all' : !ai[0] ? 'sub' : 'hunter';
    const g = {
      over: false, result: null, t: 0, round: 0, score: [0, 0], phase: 'play', phaseT: 0, msg: '', msgT: 0,
      m: null, s: 0, ox: 0, oy: 0, sub: null, hunter: null, exit: 0, air: 0, pingCd: 0, rings: [],
      sInfo: null, hInfo: null, sb: {}, hb: {}, lastKey: -1, dest: null, bumpT: 0,
    };
    const prog = () => g.round / 4; // rounds 1..5
    const hunterSpeed = () => SUB_SPEED * CC.lerp(1.05, 1.25, prog());
    const pingRange = () => CC.lerp(4.8, 3.4, prog());
    const fade = () => CC.lerp(3.5, 1.8, prog());
    const airTime = () => CC.lerp(70, 62, prog());

    // ----- geometry helpers -----
    const cx = (c) => g.ox + (c + 0.5) * g.s, cy = (r) => g.oy + (r + 0.5) * g.s;
    function open(c, r, d) {
      const m = g.m;
      if (d === 0) return c < m.C - 1 && !m.east[r * m.C + c];
      if (d === 2) return c > 0 && !m.east[r * m.C + c - 1];
      if (d === 1) return r < m.R - 1 && !m.south[r * m.C + c];
      return r > 0 && !m.south[(r - 1) * m.C + c];
    }
    // Wall "slots": every place a wall could be (vertical lines first, then horizontal).
    function slotOf(c, r, d) {
      const m = g.m, NV = (m.C + 1) * m.R;
      if (d === 0) return r * (m.C + 1) + c + 1;
      if (d === 2) return r * (m.C + 1) + c;
      if (d === 1) return NV + (r + 1) * m.C + c;
      return NV + r * m.C + c;
    }
    function buildSlots() {
      const m = g.m, NV = (m.C + 1) * m.R, N = NV + m.C * (m.R + 1);
      g.slotWall = new Uint8Array(N); g.slotSeg = new Float32Array(N * 4);
      for (let id = 0; id < N; id++) {
        let x0, y0, x1, y1, wall;
        if (id < NV) { const x = id % (m.C + 1), r = (id / (m.C + 1)) | 0; wall = x === 0 || x === m.C ? 1 : m.east[r * m.C + x - 1]; x0 = x1 = g.ox + x * g.s; y0 = g.oy + r * g.s; y1 = y0 + g.s; }
        else { const k = id - NV, y = (k / m.C) | 0, c = k % m.C; wall = y === 0 || y === m.R ? 1 : m.south[(y - 1) * m.C + c]; y0 = y1 = g.oy + y * g.s; x0 = g.ox + c * g.s; x1 = x0 + g.s; }
        g.slotWall[id] = wall; g.slotSeg.set([x0, y0, x1, y1], id * 4);
      }
    }
    function bfs(c0, r0) {
      const m = g.m, dist = new Int16Array(m.C * m.R).fill(-1), q = [r0 * m.C + c0];
      dist[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], c = i % m.C, r = (i / m.C) | 0;
        for (let d = 0; d < 4; d++) if (open(c, r, d)) { const ni = (r + DY[d]) * m.C + c + DX[d]; if (dist[ni] < 0) { dist[ni] = dist[i] + 1; q.push(ni); } }
      }
      return dist;
    }
    // first step from (c0,r0) toward cell `goal` on the real maze (hunter knows the maze)
    function stepToward(c0, r0, goal) {
      const dist = bfs(goal % g.m.C, (goal / g.m.C) | 0), here = dist[r0 * g.m.C + c0];
      let best = -1;
      for (let d = 0; d < 4; d++) if (open(c0, r0, d)) { const v = dist[(r0 + DY[d]) * g.m.C + c0 + DX[d]]; if (v >= 0 && v < here) best = d; }
      return best;
    }
    const ent = (c, r) => ({ c, r, x: cx(c), y: cy(r), moving: false, d: -1 });
    function stepEnt(e, want, speed, dt) { // grid movement: returns the direction of a bumped wall, or -1
      if (e.moving && want === (e.d + 2) % 4) { e.c -= DX[e.d]; e.r -= DY[e.d]; e.d = want; } // turn around mid-corridor
      if (!e.moving) {
        if (want < 0) return -1;
        if (!open(e.c, e.r, want)) return want;
        e.c += DX[want]; e.r += DY[want]; e.d = want; e.moving = true;
      }
      const tx = cx(e.c), ty = cy(e.r), dist = Math.hypot(tx - e.x, ty - e.y), step = speed * g.s * dt;
      if (dist <= step) { e.x = tx; e.y = ty; e.moving = false; } else { e.x += ((tx - e.x) / dist) * step; e.y += ((ty - e.y) / dist) * step; }
      return -1;
    }

    function newRound() {
      const p = prog(), C = Math.round(CC.lerp(14, 20, p)), R = Math.round(CC.lerp(9, 13, p));
      g.m = makeMaze(C, R, rng, 0.12);
      g.s = Math.floor(Math.min((W - 20) / C, (AREA - 10) / R));
      g.ox = Math.floor((W - C * g.s) / 2); g.oy = TOP + Math.floor((AREA - R * g.s) / 2) + 2;
      buildSlots();
      const start = rng.int(0, C * R - 1), ds = bfs(start % C, (start / C) | 0);
      const maxD = Math.max(...ds);
      const far = []; for (let i = 0; i < ds.length; i++) if (ds[i] >= maxD * 0.85) far.push(i);
      g.exit = rng.pick(far);
      const de = bfs(g.exit % C, (g.exit / C) | 0), hs = [];
      for (let i = 0; i < ds.length; i++) if (ds[i] >= maxD * 0.35 && ds[i] <= maxD * 0.7 && de[i] >= 5) hs.push(i); // somewhere in the middle
      const h = hs.length ? rng.pick(hs) : far[0];
      g.sub = ent(start % C, (start / C) | 0); g.hunter = ent(h % C, (h / C) | 0);
      g.air = airTime(); g.pingCd = 0; g.rings = []; g.dest = null;
      // What each side knows. The computer players read only their own object.
      g.sInfo = { seenAt: new Float32Array(g.slotWall.length).fill(-99), known: new Uint8Array(g.slotWall.length), hunter: null };
      g.hInfo = { pings: [], contact: null };
      g.sb = { lastPing: -9, wrong: 0 }; g.hb = { t: 0, target: -1, guess: [rng.range(-1, 1), rng.range(-1, 1)] };
      g.phase = 'play';
    }

    function reveal(id) { g.sInfo.seenAt[id] = g.t; g.sInfo.known[id] = 1; }
    function ping() {
      if (g.pingCd > 0 || g.phase !== 'play') return;
      g.pingCd = PING_CD;
      const e = g.sub;
      g.rings.push({ x: e.x, y: e.y, t0: g.t, prev: 0, range: pingRange() * g.s });
      g.hInfo.pings.push({ c: e.c, r: e.r, x: e.x, y: e.y, t: g.t }); // the hunter hears where it came from
      g.sb.lastPing = g.t;
      CC.sfx.play('shoot');
    }
    function endRound(winner, why) {
      g.score[winner]++;
      g.msg = why; g.msgT = 1.8;
      CC.sfx.play(winner === 0 ? 'point' : 'die');
      if (g.score[winner] >= WIN) {
        g.over = true;
        g.result = { winner, reason: winner === 0 ? `The sub escaped ${WIN} mazes (score ${g.score[0]}–${g.score[1]}).` : `The hunter won ${g.score[1]}–${g.score[0]}.` };
        return;
      }
      g.phase = 'between'; g.phaseT = 2;
    }

    // ---------- computer sub: plans on what it has learned, unknown walls assumed open ----------
    function aiSub() {
      const m = g.m, C = m.C, N = C * m.R, info = g.sInfo, e = g.sub, skill = CC.lerp(0.3, 0.9, prog());
      const hz = info.hunter && g.t - info.hunter.t < CC.lerp(3, 8, skill) ? info.hunter : null;
      const dist = new Float64Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
      const s0 = e.r * C + e.c;
      dist[s0] = 0;
      for (;;) {
        let i = -1, bd = 1e9;
        for (let k = 0; k < N; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; i = k; }
        if (i < 0 || i === g.exit) break;
        done[i] = 1;
        const c = i % C, r = (i / C) | 0;
        for (let d = 0; d < 4; d++) {
          const nc = c + DX[d], nr = r + DY[d];
          if (nc < 0 || nr < 0 || nc >= C || nr >= m.R) continue;
          const sl = slotOf(c, r, d);
          if (info.known[sl] && g.slotWall[sl]) continue; // a wall I know about
          let cost = info.known[sl] ? 1 : 1.4;
          if (hz) cost += CC.lerp(2, 8, skill) * Math.max(0, 3.5 - Math.abs(nc - hz.c) - Math.abs(nr - hz.r));
          const ni = nr * C + nc;
          if (bd + cost < dist[ni]) { dist[ni] = bd + cost; prev[ni] = i; }
        }
      }
      const path = [];
      for (let i = g.exit; i >= 0 && i !== s0; i = prev[i]) path.push(i);
      path.reverse();
      if (!path.length) return -1;
      // Ping when the next few steps go through walls I haven't seen, unless the hunter is close.
      let unknown = 0, pc = e.c, pr = e.r;
      for (let k = 0; k < Math.min(3, path.length); k++) {
        const nc = path[k] % C, nr = (path[k] / C) | 0, d = DX.findIndex((dx, j) => dx === nc - pc && DY[j] === nr - pr);
        if (d >= 0 && !info.known[slotOf(pc, pr, d)]) unknown++;
        pc = nc; pr = nr;
      }
      const quiet = skill > 0.5 && info.contact != null && g.t - info.contact < 2.5;
      if (unknown >= (skill > 0.55 ? 2 : 1) && g.t - g.sb.lastPing > CC.lerp(1.2, 3.2, skill) && !quiet) ping();
      const nc = path[0] % C, nr = (path[0] / C) | 0;
      let d = DX.findIndex((dx, j) => dx === nc - e.c && DY[j] === nr - e.r);
      if (rng() < CC.lerp(0.06, 0, skill)) d = rng.int(0, 3); // the occasional wrong turn
      return d;
    }

    // ---------- computer hunter: knows the maze, hunts from pings and contacts ----------
    function aiHunter(dt) {
      const m = g.m, C = m.C, info = g.hInfo, br = g.hb, h = g.hunter, skill = CC.lerp(0.25, 0.9, prog());
      br.t -= dt;
      if (br.t <= 0 || br.target < 0 || br.target === h.r * C + h.c) {
        br.t = CC.lerp(0.7, 0.18, skill) * rng.range(0.8, 1.2);
        let target = -1;
        const sp = SUB_SPEED;
        if (info.contact && g.t - info.contact.t < 0.6) target = info.contact.r * C + info.contact.c; // close: chase
        else if (info.pings.length && g.t - info.pings[info.pings.length - 1].t < CC.lerp(7, 20, skill)) {
          const L = info.pings[info.pings.length - 1], F = info.pings[Math.max(0, info.pings.length - 4)];
          let hx = L.c - F.c, hy = L.r - F.r;
          if (!hx && !hy) [hx, hy] = br.guess; // only one ping so far: guess a heading
          const norm = Math.hypot(hx, hy) || 1;
          // Where could it be by now? Cells about that far from the ping, in the direction it's been heading.
          const reach = sp * (g.t - L.t + skill * 1.5) * CC.lerp(0.4, 1, skill);
          const dl = bfs(L.c, L.r);
          let best = -1, bs = -1e9;
          for (let i = 0; i < dl.length; i++) {
            if (dl[i] < 0 || Math.abs(dl[i] - reach) > 1.5) continue;
            const sc = ((i % C - L.c) * hx + (((i / C) | 0) - L.r) * hy) / norm + rng.gauss() * CC.lerp(3, 0.5, skill);
            if (sc > bs) { bs = sc; best = i; }
          }
          target = best >= 0 ? best : L.r * C + L.c;
        }
        if (target < 0) { // nothing to go on: patrol
          if (br.target < 0 || br.target === h.r * C + h.c || rng() < 0.05) br.target = rng.int(0, C * m.R - 1);
          target = br.target;
        }
        br.target = target;
      }
      return stepToward(h.c, h.r, br.target);
    }

    newRound();

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.msgT > 0) g.msgT -= dt;
      if (g.phase === 'between') { g.phaseT -= dt; if (g.phaseT <= 0) { g.round++; newRound(); } return; }
      g.air -= dt; g.pingCd -= dt; g.bumpT -= dt;
      const C = g.m.C;
      // --- sub ---
      let want = -1;
      if (ai[0]) { if (!g.sub.moving) want = aiSub(); }
      else {
        for (let d = 0; d < 4; d++) if (KEYS[d].some((k) => input.pressed(k))) g.lastKey = d;
        if (g.lastKey >= 0 && KEYS[g.lastKey].some((k) => input.down(k))) want = g.lastKey;
        else for (let d = 0; d < 4; d++) if (KEYS[d].some((k) => input.down(k))) want = d;
        if (input.pressed('Space')) ping();
      }
      const bump = stepEnt(g.sub, want, SUB_SPEED, dt);
      if (bump >= 0) { reveal(slotOf(g.sub.c, g.sub.r, bump)); if (g.bumpT <= 0 && !ai[0]) { CC.sfx.play('bad'); g.bumpT = 0.4; } }
      // --- hunter ---
      let hw = -1;
      if (ai[1]) { if (!g.hunter.moving) hw = aiHunter(dt); }
      else {
        for (const c of input.clicks) {
          const cc = Math.floor((c.x - g.ox) / g.s), rr = Math.floor((c.y - g.oy) / g.s);
          if (cc >= 0 && rr >= 0 && cc < C && rr < g.m.R) g.dest = rr * C + cc;
        }
        if (ai[0]) for (let d = 0; d < 4; d++) if (KEYS[d].some((k) => input.down(k))) { hw = d; g.dest = null; }
        if (hw < 0 && g.dest != null && !g.hunter.moving) hw = stepToward(g.hunter.c, g.hunter.r, g.dest);
      }
      stepEnt(g.hunter, hw, hunterSpeed(), dt);
      // --- sonar rings ---
      for (const ring of g.rings) {
        const rr = Math.min(ring.range, (g.t - ring.t0) * RING_SPEED * g.s);
        for (let id = 0; id < g.slotWall.length; id++) {
          const sx = (g.slotSeg[id * 4] + g.slotSeg[id * 4 + 2]) / 2, sy = (g.slotSeg[id * 4 + 1] + g.slotSeg[id * 4 + 3]) / 2;
          const d = Math.hypot(sx - ring.x, sy - ring.y);
          if (d > ring.prev && d <= rr) reveal(id);
        }
        const dh = Math.hypot(g.hunter.x - ring.x, g.hunter.y - ring.y);
        if (dh > ring.prev && dh <= rr) g.sInfo.hunter = { c: g.hunter.c, r: g.hunter.r, x: g.hunter.x, y: g.hunter.y, t: g.t };
        ring.prev = rr;
      }
      g.rings = g.rings.filter((r) => g.t - r.t0 < r.range / (RING_SPEED * g.s) + 0.6);
      // --- close contact: both sides sense each other ---
      const dist = Math.hypot(g.sub.x - g.hunter.x, g.sub.y - g.hunter.y) / g.s;
      if (dist < CONTACT) {
        g.hInfo.contact = { c: g.sub.c, r: g.sub.r, x: g.sub.x, y: g.sub.y, t: g.t };
        g.sInfo.hunter = { c: g.hunter.c, r: g.hunter.r, x: g.hunter.x, y: g.hunter.y, t: g.t };
        g.sInfo.contact = g.t;
      }
      // --- round end ---
      if (dist < CATCH) return endRound(1, 'Caught!');
      if (g.sub.c === g.exit % C && g.sub.r === ((g.exit / C) | 0) && !g.sub.moving) return endRound(0, 'Escaped!');
      if (g.air <= 0) return endRound(1, 'Out of air!');
    };

    // ---------- drawing ----------
    g.draw = function (ctx) {
      ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, W, H);
      const s = g.s, C = g.m.C, t = g.t;
      // walls
      ctx.lineCap = 'round';
      for (let id = 0; id < g.slotWall.length; id++) {
        if (!g.slotWall[id]) continue;
        let a;
        if (view === 'sub') a = CC.clamp(1 - (t - g.sInfo.seenAt[id]) / fade(), 0, 1);
        else a = view === 'hunter' ? 0.45 : 0.35 + 0.65 * CC.clamp(1 - (t - g.sInfo.seenAt[id]) / fade(), 0, 1);
        if (a <= 0.01) continue;
        ctx.strokeStyle = view === 'hunter' ? `rgba(255,120,140,${a})` : `rgba(62,224,208,${a})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(g.slotSeg[id * 4], g.slotSeg[id * 4 + 1]); ctx.lineTo(g.slotSeg[id * 4 + 2], g.slotSeg[id * 4 + 3]); ctx.stroke();
      }
      // exit beacon (the hunter can't see it)
      if (view !== 'hunter') {
        const ex = cx(g.exit % C), ey = cy((g.exit / C) | 0), pulse = 0.5 + 0.5 * Math.sin(t * 4);
        CC.glow(ctx, CC.pal.good, 16); ctx.strokeStyle = CC.pal.good; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ex, ey, s * (0.22 + 0.1 * pulse), 0, 7); ctx.stroke(); CC.noGlow(ctx);
        CC.text(ctx, 'EXIT', ex, ey - s * 0.45, 14, CC.pal.good, 'center');
      }
      // sonar rings
      for (const ring of g.rings) {
        const rr = Math.min(ring.range, (t - ring.t0) * RING_SPEED * s), a = 1 - (t - ring.t0) / (ring.range / (RING_SPEED * s) + 0.6);
        ctx.strokeStyle = view === 'hunter' ? `rgba(255,77,109,${a})` : `rgba(62,224,208,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ring.x, ring.y, rr, 0, 7); ctx.stroke();
      }
      // the hunter's view of where pings came from
      if (view !== 'sub') for (const p of g.hInfo.pings) {
        const a = CC.clamp(1 - (t - p.t) / 6, 0, 1);
        if (a <= 0) continue;
        ctx.strokeStyle = `rgba(255,77,109,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 7); ctx.lineTo(p.x + 7, p.y + 7); ctx.moveTo(p.x + 7, p.y - 7); ctx.lineTo(p.x - 7, p.y + 7); ctx.stroke();
      }
      const contactA = (k) => CC.clamp(1 - (t - k) / 0.8, 0, 1);
      // sub
      if (view !== 'hunter') {
        CC.glow(ctx, CC.pal.c, 12); ctx.fillStyle = CC.pal.c;
        ctx.beginPath(); ctx.ellipse(g.sub.x, g.sub.y, s * 0.26, s * 0.17, g.sub.d === 1 || g.sub.d === 3 ? Math.PI / 2 : 0, 0, 7); ctx.fill(); CC.noGlow(ctx);
      } else if (g.hInfo.contact && contactA(g.hInfo.contact.t) > 0) { // fuzzy contact blip
        ctx.fillStyle = `rgba(255,210,63,${0.5 * contactA(g.hInfo.contact.t)})`;
        ctx.beginPath(); ctx.arc(g.hInfo.contact.x, g.hInfo.contact.y, s * 0.5, 0, 7); ctx.fill();
      }
      // hunter
      const drawHunter = (x, y, a) => {
        ctx.globalAlpha = a; CC.glow(ctx, CC.pal.a, 14); ctx.fillStyle = CC.pal.a;
        ctx.beginPath(); ctx.moveTo(x, y - s * 0.3); ctx.lineTo(x + s * 0.26, y + s * 0.22); ctx.lineTo(x - s * 0.26, y + s * 0.22); ctx.closePath(); ctx.fill();
        CC.noGlow(ctx); ctx.globalAlpha = 1;
      };
      if (view !== 'sub') drawHunter(g.hunter.x, g.hunter.y, 1);
      else if (g.sInfo.hunter) { const a = CC.clamp(1 - (t - g.sInfo.hunter.t) / 1.5, 0, 1); if (a > 0) drawHunter(g.sInfo.hunter.x, g.sInfo.hunter.y, a * 0.8); }
      if (view === 'sub' && g.sInfo.contact != null && contactA(g.sInfo.contact) > 0) {
        ctx.strokeStyle = `rgba(255,77,109,${contactA(g.sInfo.contact)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.sub.x, g.sub.y, s * CONTACT, 0, 7); ctx.stroke();
      }
      if (!ai[1] && g.dest != null) { ctx.strokeStyle = 'rgba(255,77,109,0.6)'; ctx.setLineDash([3, 4]); ctx.strokeRect(g.ox + (g.dest % C) * s + 3, g.oy + ((g.dest / C) | 0) * s + 3, s - 6, s - 6); ctx.setLineDash([]); }
      CC.hud(ctx, [
        { label: 'Round', value: (g.round + 1), color: CC.pal.text },
        { label: 'Sub escapes', value: g.score[0] + ' / ' + WIN, color: CC.pal.c },
        { label: 'Hunter catches', value: g.score[1] + ' / ' + WIN, color: CC.pal.a },
        { label: 'Air', value: Math.max(0, Math.ceil(g.air)) + 's', color: g.air < 10 ? CC.pal.a : CC.pal.b },
        { label: 'Ping', value: g.pingCd > 0 ? '…' : 'ready', color: g.pingCd > 0 ? CC.pal.dim : CC.pal.b },
      ]);
      if (view === 'all' && !ai[0]) CC.text(ctx, 'Two players on one screen: nothing is hidden. Best played against the computer.', W / 2, H - 10, 16, CC.pal.dim, 'center');
      if (g.msgT > 0) CC.banner(ctx, g.msg, g.msg === 'Escaped!' ? CC.pal.good : CC.pal.a, g.msgT);
    };
    g.stats = () => ({ score: g.score, rounds: g.round + 1 });
    return g;
  }

  CC.register({
    id: 'sonar', name: 'Sonar Hunt', color: '#3ee0d0', glyph: '◎',
    blurb: 'A mini-sub creeps through a pitch-black maze toward the exit. Each sonar ping lights up the walls nearby, but it also tells the hunter where you are.',
    roles: [
      { name: 'Sub', controls: 'Arrow keys or WASD to move, Space to ping. Bumping a wall reveals it' },
      { name: 'Hunter', controls: 'Click a spot in the maze to head there (arrow keys also work vs a computer sub). You see the maze and pings, but not the sub or the exit' },
    ],
    goals: 'Each round is a new maze. The sub scores by reaching the exit; the hunter scores by catching it or when its air runs out. First to 3.',
    create,
  });
})();
