/* Cabinet shell: menu, side pickers, input, fixed-step loop, overlays, sound. */
(function () {
  'use strict';
  const CC = window.CC;
  const $ = (s) => document.querySelector(s);

  // ---------------- sound ----------------
  let actx = null, muted = false;
  try { muted = localStorage.getItem('cc-muted') === '1'; } catch (e) { /* ignore */ }
  const SOUNDS = {
    eat: [660, 0.08, 'square'], place: [440, 0.05, 'triangle'], die: [110, 0.35, 'sawtooth'], bad: [140, 0.08, 'square'],
    brick: [520, 0.04, 'square'], paddle: [300, 0.05, 'triangle'], flap: [480, 0.05, 'triangle'], point: [880, 0.06, 'square'],
    shoot: [900, 0.04, 'square'], rock: [160, 0.12, 'sawtooth'], throw: [220, 0.08, 'triangle'], launch: [200, 0.1, 'sawtooth'],
    boom: [90, 0.2, 'sawtooth'], line: [700, 0.12, 'square'], lock: [250, 0.03, 'triangle'],
    pad0: [330, 0.25, 'sine'], pad1: [392, 0.25, 'sine'], pad2: [494, 0.25, 'sine'], pad3: [587, 0.25, 'sine'],
  };
  let lastSound = {};
  CC.sfx = {
    play(name) {
      if (muted || !SOUNDS[name]) return;
      const now = performance.now();
      if (now - (lastSound[name] || 0) < 40) return; // don't machine-gun the speakers
      lastSound[name] = now;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const [f, d, type] = SOUNDS[name];
        const o = actx.createOscillator(), gn = actx.createGain();
        o.type = type; o.frequency.value = f;
        if (name === 'die' || name === 'boom') o.frequency.exponentialRampToValueAtTime(f * 0.4, actx.currentTime + d);
        gn.gain.setValueAtTime(0.08, actx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
        o.connect(gn).connect(actx.destination);
        o.start(); o.stop(actx.currentTime + d + 0.02);
      } catch (e) { /* audio unavailable */ }
    },
  };

  // ---------------- input ----------------
  const canvas = $('#screen'), ctx = canvas.getContext('2d');
  const input = {
    keys: new Set(), pressedSet: new Set(),
    mouse: { x: CC.W / 2, y: CC.H / 2, down: false, inside: false },
    clicks: [], presses: [], releases: [], wheel: 0,
    down(c) { return this.keys.has(c); },
    pressed(c) { return this.pressedSet.has(c); },
    endStep() { this.pressedSet.clear(); this.clicks = []; this.presses = []; this.releases = []; this.wheel = 0; },
  };
  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (playing() && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.code === 'KeyP' || e.code === 'Escape') { if (inst && !inst.over) togglePause(); return; }
    if (!input.keys.has(e.code)) input.pressedSet.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); if (inst && !inst.over && !paused && !current.custom) togglePause(); });
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CC.W, y: ((e.clientY - r.top) / r.height) * CC.H };
  }
  canvas.addEventListener('pointermove', (e) => { Object.assign(input.mouse, toCanvas(e), { inside: true }); });
  canvas.addEventListener('pointerleave', () => { input.mouse.inside = false; });
  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    Object.assign(input.mouse, p, { down: true, inside: true });
    input.clicks.push(p); input.presses.push(p);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => { const p = toCanvas(e); input.mouse.down = false; input.releases.push(p); });
  canvas.addEventListener('wheel', (e) => { if (playing()) { e.preventDefault(); input.wheel += Math.sign(e.deltaY); } }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------- state ----------------
  let current = null, inst = null, paused = false, sides = [false, true], lastOpts = null;
  const playing = () => inst && !inst.over && !paused;
  const overlay = $('#overlay'), domlayer = $('#domlayer');

  function showOverlay(html) { overlay.innerHTML = html; overlay.hidden = false; }
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }

  // ---------------- menu ----------------
  const menu = $('#menu');
  CC.games.forEach((def, i) => {
    const a = document.createElement('a');
    a.className = 'card'; a.href = '#' + def.id;
    a.style.setProperty('--accent', def.color);
    a.innerHTML = `<span class="num">${i + 1}</span><span class="glyph">${def.glyph}</span>
      <h3>${def.name}</h3><p>${def.blurb}</p>
      <span class="roles">${def.roles[0].name} <i>vs</i> ${def.roles[1].name}</span>`;
    menu.appendChild(a);
  });

  // ---------------- game screen ----------------
  const panel = $('#panel');
  function sideLabel(ai) { return ai ? 'Computer' : 'Human'; }

  function renderPanel() {
    const def = current;
    if (def.custom) {
      panel.innerHTML = '<div id="custom"></div>' + helpHtml(def);
      def.mount($('#custom'), customApi);
      return;
    }
    panel.innerHTML = `
      <div class="presets">
        <button class="btn" data-p="classic">Classic</button>
        <button class="btn" data-p="flip">Flipped</button>
        <button class="btn" data-p="watch">Watch</button>
        <button class="btn" data-p="duel">2 humans</button>
      </div>
      ${def.roles.map((r, i) => `
        <div class="side">
          <div class="side-name"><b>${r.name}</b></div>
          <div class="seg" role="group" aria-label="${r.name} is played by">
            <button data-side="${i}" data-ai="0" class="${!sides[i] ? 'on' : ''}">Human</button>
            <button data-side="${i}" data-ai="1" class="${sides[i] ? 'on' : ''}">Computer</button>
          </div>
          <div class="ctl">${r.controls}</div>
        </div>`).join('')}
      <button class="btn primary big" id="start">${inst ? 'Restart' : 'Start'} ▶</button>
      ${helpHtml(def)}`;
  }
  function helpHtml(def) {
    return `<div class="goals"><h4>How to win</h4><p>${def.goals}</p>
      <p class="fine">Every game starts easy and gets harder as it goes, whichever side you play. P or Esc pauses.</p></div>`;
  }
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || current.custom) return;
    if (t.dataset.side) { sides[+t.dataset.side] = t.dataset.ai === '1'; renderPanel(); preview(); }
    if (t.dataset.p) {
      sides = { classic: [false, true], flip: [true, false], watch: [true, true], duel: [false, false] }[t.dataset.p];
      renderPanel(); preview();
    }
    if (t.id === 'start') start();
  });

  function preview() {
    if (inst && !inst.over) return;
    showOverlay(`<div class="ov"><h2>${current.name}</h2>
      <p>${current.roles[0].name}: <b>${sideLabel(sides[0])}</b> · ${current.roles[1].name}: <b>${sideLabel(sides[1])}</b></p>
      <button class="btn primary big" data-act="start">Start ▶</button></div>`);
  }

  const customApi = {
    token: 0,
    status(title, sub, isError) {
      if (inst && !inst.over) return;
      showOverlay(`<div class="ov"><h2 class="${isError ? 'err' : ''}">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}${isError ? '' : '<div class="spinner"></div>'}</div>`);
    },
    begin(opts) { start(opts); },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function start(opts) {
    opts = Object.assign({}, opts || { ai: sides.slice() });
    lastOpts = opts;
    inst = current.create(Object.assign({ rng: CC.rng((Date.now() ^ (Math.random() * 1e9)) >>> 0), input }, opts));
    paused = false;
    hideOverlay();
    if (!current.custom) renderPanel();
    domlayer.innerHTML = '';
    if (inst.dom) { domlayer.appendChild(inst.dom); if (inst.focus) inst.focus(); } else canvas.focus();
  }
  function togglePause() {
    paused = !paused;
    if (paused) showOverlay('<div class="ov"><h2>Paused</h2><p>Press P or Esc to resume</p></div>');
    else hideOverlay();
  }
  function showResult() {
    const r = inst.result, ai = lastOpts.ai, def = current;
    const humans = ai.filter((x) => !x).length;
    let head;
    if (def.custom) head = r.head || (r.winner === 0 ? 'You win!' : 'You lose');
    else if (humans === 1) head = !ai[r.winner] ? 'You win!' : 'The computer wins';
    else head = def.roles[r.winner].name + ' wins!';
    const sub = def.custom ? '' : `${def.roles[r.winner].name} (${sideLabel(ai[r.winner])}) wins.`;
    showOverlay(`<div class="ov"><h2>${esc(head)}</h2><p>${esc(r.reason)}</p>${sub ? `<p class="fine">${esc(sub)}</p>` : ''}
      <div class="row">${def.custom ? '<button class="btn primary" data-act="again-custom">New match</button>'
        : '<button class="btn primary" data-act="again">Play again</button><button class="btn" data-act="swap">Swap sides</button>'}</div></div>`);
  }
  overlay.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'start' || a === 'again') start();
    if (a === 'swap') { sides = [sides[1], sides[0]]; renderPanel(); start(); }
    if (a === 'again-custom') { inst = null; domlayer.innerHTML = ''; hideOverlay(); showOverlay('<div class="ov"><h2>Imitation</h2><p>Choose how to play on the right.</p></div>'); }
  });

  // ---------------- routing ----------------
  function route() {
    const id = location.hash.slice(1);
    const def = CC.games.find((g) => g.id === id);
    if (inst && inst.link) inst.link.close();
    customApi.token = Math.random();
    inst = null; paused = false; domlayer.innerHTML = '';
    if (!def) { current = null; $('#play').hidden = true; $('#menu-wrap').hidden = false; document.title = 'Cocktail Cabinet'; return; }
    current = def;
    sides = [false, true];
    $('#menu-wrap').hidden = true; $('#play').hidden = false;
    $('#title').textContent = def.name;
    document.title = def.name + ' · Cocktail Cabinet';
    $('#play').style.setProperty('--accent', def.color);
    renderPanel();
    if (def.custom) showOverlay('<div class="ov"><h2>Imitation</h2><p>Choose how to play on the right.</p></div>');
    else preview();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('#mute').addEventListener('click', () => {
    muted = !muted; try { localStorage.setItem('cc-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    $('#mute').textContent = muted ? 'Sound: off' : 'Sound: on';
  });
  $('#mute').textContent = muted ? 'Sound: off' : 'Sound: on';

  // ---------------- loop ----------------
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (current) {
      if (inst && !paused && !inst.over) {
        acc += dt;
        let steps = 0;
        while (acc >= CC.STEP && steps < 6) {
          inst.update(CC.STEP); input.endStep(); acc -= CC.STEP; steps++;
          if (inst.over) { showResult(); break; }
        }
      } else { acc = 0; input.endStep(); }
      if (inst) inst.draw(ctx);
      else idle(now);
    }
    requestAnimationFrame(frame);
  }
  function idle(now) { // attract screen behind the overlay
    ctx.fillStyle = CC.pal.bg; ctx.fillRect(0, 0, CC.W, CC.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 20; i++) { const y = (i * 37 + now * 0.03) % CC.H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CC.W, y); ctx.stroke(); }
  }
  route();
  requestAnimationFrame(frame);

  // Expose a tiny hook for automated smoke tests.
  window.__cabinet = { get inst() { return inst; }, start, input };
})();
