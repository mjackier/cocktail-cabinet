/* Cocktail Cabinet — shared helpers.
   Game logic only depends on this file, so every game can also run headlessly
   (see test/simulate.js) with both sides played by the computer. */
(function (global) {
  'use strict';
  const CC = (global.CC = global.CC || {});

  CC.W = 800;
  CC.H = 600;
  CC.STEP = 1 / 60;
  CC.games = CC.games || [];
  CC.register = (def) => { CC.games.push(def); };

  CC.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  CC.lerp = (a, b, t) => a + (b - a) * CC.clamp(t, 0, 1);
  CC.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  CC.wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // Seeded PRNG (mulberry32) so simulations are reproducible.
  CC.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    const f = function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + f() * (b - a);
    f.int = (a, b) => a + Math.floor(f() * (b - a + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    f.gauss = () => { // standard normal
      let u = 0, v = 0;
      while (u === 0) u = f();
      while (v === 0) v = f();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return f;
  };

  // Input stand-in used when nobody is at the keyboard (headless tests).
  CC.nullInput = {
    down: () => false, pressed: () => false,
    mouse: { x: CC.W / 2, y: CC.H / 2, down: false, inside: false },
    clicks: [], releases: [], presses: [], wheel: 0,
  };

  CC.sfx = CC.sfx || { play() {} };

  CC.pal = {
    bg: '#07060d', grid: '#16132a', text: '#f4ecd8', dim: '#8a84a3',
    a: '#ff4d6d', b: '#3ee0d0', c: '#ffd23f', d: '#9b7bff', good: '#7cff6b', warn: '#ff9f1c',
  };

  // ---- drawing helpers (only used in the browser) ----
  CC.text = function (ctx, str, x, y, size, color, align, font) {
    ctx.font = `${size}px ${font || '"VT323", ui-monospace, monospace'}`;
    ctx.fillStyle = color || CC.pal.text;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  };
  CC.glow = function (ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; };
  CC.noGlow = function (ctx) { ctx.shadowBlur = 0; };

  // Standard HUD strip: items = [{label, value, color}]
  CC.hud = function (ctx, items, y) {
    y = y || 18;
    const n = items.length;
    ctx.fillStyle = 'rgba(7,6,13,0.55)';
    ctx.fillRect(0, y - 18, CC.W, 38);
    items.forEach((it, i) => {
      const x = (CC.W / n) * (i + 0.5);
      CC.text(ctx, it.label.toUpperCase(), x, y - 6, 14, CC.pal.dim, 'center');
      CC.text(ctx, String(it.value), x, y + 10, 22, it.color || CC.pal.text, 'center');
    });
  };
  CC.bar = function (ctx, x, y, w, h, frac, color) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * CC.clamp(frac, 0, 1), h);
  };
  CC.banner = function (ctx, str, color, t) { // short centered message, t = 0..1 remaining
    ctx.globalAlpha = CC.clamp(t * 2, 0, 1);
    let size = 46;
    ctx.font = `${size}px "VT323", ui-monospace, monospace`;
    const w = ctx.measureText(str).width;
    if (w > CC.W - 60) size = Math.floor(size * (CC.W - 60) / w);
    CC.text(ctx, str, CC.W / 2, CC.H / 2, size, color || CC.pal.c, 'center');
    ctx.globalAlpha = 1;
  };

  if (typeof module !== 'undefined') module.exports = CC;
})(typeof window !== 'undefined' ? window : globalThis);
