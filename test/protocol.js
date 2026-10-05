// Imitation network protocol test: two separate game instances (as if in two browsers) joined
// by a fake link with random 30–150 ms latency. Each side's local seat is played by a bot.
// Checks that both browsers agree on the sequence and on who lost, every time.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Math, setTimeout: (f) => f(), performance: { now: () => clock * 1000 } };
let clock = 0;
ctx.globalThis = ctx; vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
load('js/core.js'); load('js/games/imitation.js');
const CC = ctx.CC, def = CC.games[0];

function pair(rng) {
  const q = []; // [deliverAt, toSide, msg]
  const mk = (side) => ({ handlers: { msg: [], close: [] }, send: (m) => q.push([clock + rng.range(0.03, 0.15), 1 - side, JSON.parse(JSON.stringify(m))]),
    onMessage(f) { this.handlers.msg.push(f); }, onClose(f) { this.handlers.close.push(f); }, close() {} });
  const links = [mk(0), mk(1)];
  const pump = () => { q.sort((a, b) => a[0] - b[0]); while (q.length && q[0][0] <= clock) { const [, to, m] = q.shift(); links[to].handlers.msg.forEach((f) => f(m)); } };
  return { links, pump };
}

let bad = 0;
for (let i = 0; i < 150; i++) {
  clock = 0;
  const rng = CC.rng(77 + i);
  const { links, pump } = pair(rng);
  const starts = rng.int(0, 1);
  const A = def.create({ ai: [true, true], rng: CC.rng(1 + i), input: CC.nullInput, link: links[0], starts, oppIsBot: false });
  const B = def.create({ ai: [true, true], rng: CC.rng(9999 + i), input: CC.nullInput, link: links[1], starts: 1 - starts, oppIsBot: false });
  while ((!A.over || !B.over) && clock < 600) { clock += CC.STEP; pump(); A.update(CC.STEP); B.update(CC.STEP); }
  const a = A.stats(), b = B.stats();
  // A's loser 0 means "A lost"; from B's point of view that is loser 1.
  const agree = A.over && B.over && a.loser === 1 - b.loser && Math.abs(a.len - b.len) <= 1;
  if (!agree) { bad++; console.log('mismatch', i, a, b, A.over, B.over); }
}
console.log(bad ? `${bad} mismatches` : '150 networked matches: both browsers always agreed on the result.');
process.exit(bad ? 1 : 0);
