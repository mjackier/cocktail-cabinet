/* IMITATION — a Simon-style memory duel for two players.
   On your turn, repeat the whole sequence so far, then add one new pad. Then it is your
   opponent's turn. The first player to slip up or run out of time loses.
   Opponents: a human in another browser (WebRTC via PeerJS, see js/net.js) or a computer player
   that plays like a person, with human-ish timing, a limited memory and the occasional hesitation.
   In an online match you do not know which one you got. Matchmaking always takes a few seconds,
   and if nobody is online you are quietly paired with the computer. At the end you guess
   "human or computer?" and the game tells you whether you were right. */
(function () {
  'use strict';
  const W = 800, H = 600, CX = 400, CY = 330, OFF = 128, PR = 74;
  const PADS = [{ dx: 0, dy: -1, c: '#ff4d6d', key: 'ArrowUp', n: '1' }, { dx: 1, dy: 0, c: '#3ee0d0', key: 'ArrowRight', n: '2' },
    { dx: 0, dy: 1, c: '#ffd23f', key: 'ArrowDown', n: '3' }, { dx: -1, dy: 0, c: '#9b7bff', key: 'ArrowLeft', n: '4' }];
  const FIRST_LIMIT = 7, PRESS_LIMIT = 5;
  const HANDLES = ['kestrel_92', 'mossy', 'quietfox', 'rhombus', 'jun.p', 'tealcup', 'b0rk', 'nightowl7', 'pixelpine', 'Saffron', 'oatmilk', 'zed_zed', 'lumen', 'dvorak_fan', 'marigold', 'heron', 'tinycactus', 'gray.wolf', 'Ilsa', 'parsnip'];

  // Bot "personality": how many steps it can hold comfortably and how fast it presses.
  function makeBot(rng) {
    return {
      cap: CC.clamp(Math.round(9 + rng.gauss() * 2.2), 5, 15),
      tempo: rng.range(0.85, 1.25),
      fav: rng.int(0, 3),
      queue: [],
    };
  }

  function create(o) {
    const rng = o.rng, input = o.input, ai = o.ai;
    const link = o.link || null; // network link for seat 1, if any
    const g = {
      over: false, result: null, t: 0, seq: [], turn: o.starts != null ? o.starts : rng.int(0, 1), pos: 0,
      phase: 'replay', phaseT: 0, replayI: -1, lit: -1, litT: 0, litSeat: -1, deadline: 0,
      names: [o.myName || 'You', o.oppName || 'Opponent'], loser: -1, guess: null, ping: 40, msg: '', msgT: 0,
      inbox: [], remoteSilence: 0,
      bots: [ai[0] ? makeBot(rng) : null, (ai[1] && !link) ? makeBot(rng) : null],
    };
    g.link = link;
    const playerIsBot = (s) => !!g.bots[s];
    const onT = () => CC.lerp(0.55, 0.28, g.seq.length / 14);

    if (link) {
      link.onMessage((m) => g.inbox.push(m));
      link.onClose(() => g.inbox.push({ t: 'bye' }));
    }

    function light(pad, seat) { g.lit = pad; g.litT = 0.28; g.litSeat = seat; CC.sfx.play('pad' + pad); }

    function startTurn() {
      g.pos = 0; g.phase = 'replay'; g.replayI = -1; g.phaseT = 0.7;
      if (!g.seq.length) { g.phase = 'input'; g.deadline = FIRST_LIMIT; }
    }
    function beginInput() {
      g.phase = 'input'; g.deadline = FIRST_LIMIT; g.remoteSilence = 0;
      const b = g.bots[g.turn];
      if (b) planBot(b);
    }

    function press(seat, pad) {
      if (g.phase !== 'input' || seat !== g.turn || g.loser >= 0) return;
      light(pad, seat);
      if (seat === 0 && link) link.send({ t: 'press', pad });
      if (g.pos < g.seq.length) {
        if (pad !== g.seq[g.pos]) return fail(seat, 'pressed the wrong pad');
        g.pos++;
        g.deadline = PRESS_LIMIT;
      } else {
        g.seq.push(pad);
        g.turn = 1 - g.turn;
        g.msg = g.turn === 0 ? 'Your turn' : g.names[1] + '\'s turn'; g.msgT = 0.9;
        g.phase = 'gap'; g.phaseT = 0.6;
      }
    }
    function fail(seat, why) {
      if (g.loser >= 0) return;
      g.loser = seat;
      CC.sfx.play('die');
      if (seat === 0 && link && why === 'ran out of time') link.send({ t: 'timeout' });
      g.failWhy = why;
      g.phase = 'done'; g.phaseT = 1.6;
    }
    function finish() {
      const winner = 1 - g.loser;
      const who = g.loser === 0 ? 'You' : g.names[1];
      let reason = `${who} ${g.failWhy} at length ${g.seq.length + (g.pos >= g.seq.length ? 1 : 0)}.`;
      if (o.askGuess) {
        const right = (g.guess === 'computer') === !!o.oppIsBot;
        reason += ` ${g.names[1]} was ${o.oppIsBot ? 'a computer' : 'a human'}, and you guessed ${right ? 'right' : 'wrong'}.`;
      }
      g.over = true;
      g.result = { winner, reason };
      if (link) setTimeout(() => link.close(), 800);
    }

    // Plan a bot's presses for its turn as timed events.
    function planBot(b) {
      const n = g.seq.length;
      let t = rng.range(0.55, 1.2) * b.tempo + n * 0.03;
      b.queue = [];
      for (let i = 0; i < n; i++) {
        const strain = Math.max(0, i + 1 - b.cap);
        const pErr = i < b.cap ? 0.006 : 0.07 + 0.11 * strain;
        let pad = g.seq[i];
        if (rng() < pErr) pad = (pad + rng.int(1, 3)) % 4; // memory slip
        b.queue.push({ at: t, pad });
        t += CC.clamp(0.36 + rng.gauss() * 0.09, 0.2, 0.75) * b.tempo;
        if (rng() < 0.05 + strain * 0.05) t += rng.range(0.5, 1.6); // "hmm…"
      }
      t += rng.range(0.25, 0.9) * b.tempo;
      // Humans repeat pads, favour one, avoid long runs.
      let nxt = rng.int(0, 3);
      if (rng() < 0.25) nxt = b.fav;
      if (n && rng() < 0.22) nxt = g.seq[n - 1];
      b.queue.push({ at: t, pad: nxt });
      b.clock = 0;
    }

    g.update = function (dt) {
      if (g.over) return;
      g.t += dt;
      if (g.litT > 0) { g.litT -= dt; if (g.litT <= 0) g.lit = -1; }
      if (g.msgT > 0) g.msgT -= dt;
      g.ping = link ? g.ping : CC.clamp(g.ping + rng.gauss() * 2, 22, 95);

      // Network messages from the remote player (seat 1).
      while (g.inbox.length) {
        const m = g.inbox[0];
        if (m.t === 'press') { if (g.phase !== 'input' || g.turn !== 1) break; g.inbox.shift(); g.remoteSilence = 0; press(1, m.pad); continue; }
        g.inbox.shift();
        if (m.t === 'timeout' && g.loser < 0) fail(1, 'ran out of time');
        if (m.t === 'bye' && g.loser < 0) fail(1, 'left the match');
        if (m.t === 'ping' && link) link.send({ t: 'pong', at: m.at });
        if (m.t === 'pong') g.ping = Math.round(performance.now() - m.at);
      }
      if (link && Math.floor(g.t * 0.5) !== Math.floor((g.t - dt) * 0.5)) link.send({ t: 'ping', at: performance.now() });

      if (g.phase === 'gap') { g.phaseT -= dt; if (g.phaseT <= 0) startTurn(); return; }
      if (g.phase === 'replay') {
        g.phaseT -= dt;
        if (g.phaseT <= 0) {
          g.replayI++;
          if (g.replayI >= g.seq.length) return beginInput();
          light(g.seq[g.replayI], -1); g.litT = onT();
          g.phaseT = onT() * 1.45;
        }
        return;
      }
      if (g.phase === 'input') {
        const s = g.turn;
        if (s === 0 && !playerIsBot(0)) {
          PADS.forEach((p, i) => { if (input.pressed(p.key) || input.pressed('Digit' + p.n)) press(0, i); });
          for (const c of input.clicks) PADS.forEach((p, i) => { if (Math.hypot(c.x - (CX + p.dx * OFF), c.y - (CY + p.dy * OFF)) < PR) press(0, i); });
        } else if (playerIsBot(s)) {
          const b = g.bots[s];
          b.clock += dt;
          while (b.queue.length && b.clock >= b.queue[0].at && g.phase === 'input' && g.turn === s) press(s, b.queue.shift().pad);
        }
        if (g.phase !== 'input') return;
        g.deadline -= dt;
        if (s === 1 && link) {
          g.remoteSilence += dt; // their own browser judges their timeout; this is a dropped-link backstop
          if (g.remoteSilence > FIRST_LIMIT + 8) fail(1, 'lost connection');
        } else if (g.deadline <= 0) fail(s, 'ran out of time');
        return;
      }
      if (g.phase === 'done') {
        g.phaseT -= dt;
        if (g.phaseT <= 0) {
          if (o.askGuess) { g.phase = 'guess'; } else finish();
        }
        return;
      }
      if (g.phase === 'guess') {
        for (const c of input.clicks) {
          if (c.y > 470 && c.y < 530) { if (c.x > 200 && c.x < 390) g.guess = 'human'; if (c.x > 410 && c.x < 600) g.guess = 'computer'; }
        }
        if (input.pressed('KeyH')) g.guess = 'human';
        if (input.pressed('KeyC')) g.guess = 'computer';
        if (g.guess) finish();
      }
    };

    g.draw = function (ctx) {
      ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, W, H);
      PADS.forEach((p, i) => {
        const x = CX + p.dx * OFF, y = CY + p.dy * OFF, on = g.lit === i;
        if (on) CC.glow(ctx, p.c, 40);
        ctx.fillStyle = p.c; ctx.globalAlpha = on ? 1 : 0.22;
        ctx.beginPath(); ctx.arc(x, y, PR, 0, 7); ctx.fill();
        ctx.globalAlpha = 1; CC.noGlow(ctx);
        CC.text(ctx, p.n, x, y, 28, on ? '#07060d' : 'rgba(255,255,255,0.4)', 'center');
      });
      // centre: sequence length and turn
      CC.text(ctx, String(g.seq.length), CX, CY - 8, 54, CC.pal.text, 'center');
      CC.text(ctx, 'length', CX, CY + 26, 16, CC.pal.dim, 'center');
      const mine = g.turn === 0;
      CC.text(ctx, g.names[0] + ' (you)', 20, 26, 24, mine ? CC.pal.c : CC.pal.dim);
      CC.text(ctx, g.names[1], W - 20, 26, 24, !mine ? CC.pal.c : CC.pal.dim, 'right');
      CC.text(ctx, Math.round(g.ping) + ' ms', W - 20, 50, 16, CC.pal.dim, 'right');
      let line = '';
      if (g.phase === 'replay') line = mine ? 'Watch the sequence…' : 'Showing ' + g.names[1] + ' the sequence…';
      if (g.phase === 'input') line = mine ? (g.pos < g.seq.length ? `Repeat it: ${g.pos} / ${g.seq.length}` : 'Now add one new pad!') : g.names[1] + ' is playing…';
      if (g.phase === 'done') line = g.loser === 0 ? 'You ' + g.failWhy + '!' : g.names[1] + ' ' + g.failWhy + '!';
      CC.text(ctx, line, CX, 72, 28, CC.pal.text, 'center');
      if (g.phase === 'input' && (mine || !link)) CC.bar(ctx, CX - 150, 92, 300, 5, g.deadline / (g.pos === 0 ? FIRST_LIMIT : PRESS_LIMIT), g.deadline < 2 ? CC.pal.a : CC.pal.b);
      if (g.phase === 'guess') {
        ctx.fillStyle = 'rgba(7,6,13,0.86)'; ctx.fillRect(0, 380, W, 200);
        CC.text(ctx, `Was ${g.names[1]} a human or a computer?`, CX, 430, 30, CC.pal.c, 'center');
        [['Human  [H]', 200], ['Computer  [C]', 410]].forEach(([t, x]) => {
          ctx.strokeStyle = CC.pal.c; ctx.lineWidth = 2; ctx.strokeRect(x, 470, 190, 60);
          CC.text(ctx, t, x + 95, 500, 26, CC.pal.text, 'center');
        });
      }
      if (g.msgT > 0) CC.text(ctx, g.msg, CX, H - 30, 26, CC.pal.c, 'center');
    };
    g.stats = () => ({ len: g.seq.length, loser: g.loser });
    return g;
  }

  // ---------- custom controls: matchmaking UI ----------
  function mount(panel, api) {
    let myName = 'player' + Math.floor(100 + Math.random() * 900);
    try { myName = localStorage.getItem('cc-name') || myName; } catch (e) { /* storage blocked */ }
    panel.innerHTML = `
      <div class="imi">
        <label class="imi-name">Your name <input id="imi-name" maxlength="16" value=""></label>
        <div class="imi-modes">
          <button class="btn primary" data-m="online">Find an opponent</button>
          <button class="btn" data-m="host">Create private room</button>
          <span class="imi-join"><input id="imi-code" maxlength="4" placeholder="CODE"><button class="btn" data-m="join">Join</button></span>
          <button class="btn" data-m="practice">Practice vs computer</button>
          <button class="btn ghost" data-m="watch">Watch computer vs computer</button>
        </div>
        <p class="fine">Online matches pair you with whoever is searching. If nobody is around you may get a computer player instead. You'll find out at the end, after you guess.</p>
      </div>`;
    const nameEl = panel.querySelector('#imi-name');
    nameEl.value = myName;
    nameEl.addEventListener('change', () => { myName = nameEl.value.trim() || myName; try { localStorage.setItem('cc-name', myName); } catch (e) { /* ignore */ } });
    let pending = null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    async function asBot(guess) {
      const rng = CC.rng(Date.now());
      const name = rng.pick(HANDLES);
      api.status('Opponent found: ' + name, 'Connecting…');
      await wait(700 + Math.random() * 900);
      api.begin({ ai: [false, true], myName, oppName: name, askGuess: guess, oppIsBot: true });
    }
    async function handshake(link, guess) {
      api.status('Opponent found!', 'Connecting…');
      await wait(1500 + Math.random() * 1500); // no match ever connects instantly
      const roll = Math.random();
      link.send({ t: 'hello', name: myName, roll });
      const hello = await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('Handshake timed out')), 8000);
        link.onMessage((m) => { if (m && m.t === 'hello') { clearTimeout(to); res(m); } });
      });
      const starts = roll > hello.roll ? 0 : 1;
      api.begin({ ai: [false, true], myName, oppName: String(hello.name || 'stranger').slice(0, 16), askGuess: guess, oppIsBot: false, link, starts });
    }

    panel.addEventListener('click', async (ev) => {
      const m = ev.target && ev.target.dataset && ev.target.dataset.m;
      if (!m) return;
      if (pending && pending.cancel) pending.cancel();
      myName = nameEl.value.trim() || myName;
      const token = (api.token = Math.random());
      const alive = () => api.token === token;
      try {
        if (m === 'watch') { api.begin({ ai: [true, true], myName: 'CPU-A', oppName: 'CPU-B', askGuess: false, oppIsBot: true }); return; }
        if (m === 'practice') {
          api.status('Setting up a practice match…');
          await wait(1500 + Math.random() * 1500);
          if (alive()) api.begin({ ai: [false, true], myName, oppName: 'Computer', askGuess: false, oppIsBot: true });
          return;
        }
        if (m === 'online') {
          const minWait = wait(2500 + Math.random() * 2500); // never instant
          const searchFor = 12000 + Math.random() * 9000;
          let found = null;
          if (CC.Net && CC.Net.available()) {
            pending = CC.Net.findMatch({ timeoutMs: searchFor, onStatus: (s) => alive() && api.status(s, 'Online players are matched first') });
            found = await pending.catch(() => null);
          } else {
            api.status('Searching for players…');
            await wait(searchFor * 0.5);
          }
          await minWait;
          if (!alive()) { found && found.link.close(); return; }
          if (found) await handshake(found.link, true); else await asBot(true);
          return;
        }
        if (m === 'host') {
          const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
          if (!CC.Net || !CC.Net.available()) throw new Error('Online play could not load (PeerJS blocked?).');
          api.status('Room code: ' + code, 'Opening room…');
          const r = await CC.Net.hostRoom(code, (s) => alive() && api.status('Room code: ' + code, s));
          if (alive()) await handshake(r.link, false);
          return;
        }
        if (m === 'join') {
          const code = panel.querySelector('#imi-code').value.trim().toUpperCase();
          if (code.length !== 4) throw new Error('Enter the 4-letter room code.');
          if (!CC.Net || !CC.Net.available()) throw new Error('Online play could not load (PeerJS blocked?).');
          const r = await CC.Net.joinRoom(code, (s) => alive() && api.status(s));
          if (alive()) await handshake(r.link, false);
        }
      } catch (e) {
        if (alive()) api.status('Could not connect', e.message || String(e), true);
      }
    });
  }

  CC.register({
    id: 'imitation', name: 'Imitation', color: '#ff4d6d', glyph: '◉',
    blurb: 'A memory duel. Repeat the sequence and add one pad. Play the computer, a friend in another browser, or a stranger. Can you tell which one you got?',
    roles: [
      { name: 'You', controls: 'Arrow keys, 1–4, or click the pads' },
      { name: 'Opponent', controls: 'A human in another browser, or the computer' },
    ],
    goals: 'Don\'t be the first to slip up. Each pad has a time limit.',
    custom: true,
    mount,
    create,
  });
})();
