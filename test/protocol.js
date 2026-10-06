// Imitation network protocol test: two separate game instances (as if in two browsers) joined
// by a fake link with random 30–150 ms latency. The local seat on each side is played by the
// built-in chat bot. Checks that messages arrive in both directions, both sides guess, each side
// learns the other's truth, and both browsers compute the same (mirrored) score.
const fs = require('fs'), path = require('path'), vm = require('vm');
let clock = 0;
const ctx = { console, Math, Date, setTimeout: (f) => f(), performance: { now: () => clock * 1000 } };
ctx.globalThis = ctx; vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
load('js/core.js'); load('js/games/imitation.js');
const CC = ctx.CC, def = CC.games[0];

function pair(rng) {
  const q = [];
  const mk = (side) => ({ h: { msg: [], close: [] }, send: (m) => q.push([clock + rng.range(0.03, 0.15), 1 - side, JSON.parse(JSON.stringify(m))]),
    onMessage(f) { this.h.msg.push(f); }, onClose(f) { this.h.close.push(f); }, close() {} });
  const links = [mk(0), mk(1)];
  const pump = () => { q.sort((a, b) => a[0] - b[0]); while (q.length && q[0][0] <= clock) { const [, to, m] = q.shift(); links[to].h.msg.forEach((f) => f(m)); } };
  return { links, pump };
}

let bad = 0;
const N = 60;
for (let i = 0; i < N; i++) {
  clock = 0;
  const rng = CC.rng(77 + i);
  const { links, pump } = pair(rng);
  const roleA = { truth: 'human', goal: rng() < 0.5 ? 'human' : 'ai' }, roleB = { truth: 'ai', goal: 'human' };
  const A = def.create({ ai: [true, true], rng: CC.rng(1 + i), input: CC.nullInput, headless: true, link: links[0], myRole: roleA });
  const B = def.create({ ai: [true, true], rng: CC.rng(9999 + i), input: CC.nullInput, headless: true, link: links[1], myRole: roleB });
  while ((!A.over || !B.over) && clock < 400) { clock += CC.STEP; pump(); A.update(CC.STEP); B.update(CC.STEP); }
  const a = A.stats(), b = B.stats();
  const ok = A.over && B.over && a.msgs > 0 && a.msgs === b.msgs &&
    a.guess[0] === b.guess[1] && a.guess[1] === b.guess[0] &&
    a.scores[0] === b.scores[1] && a.scores[1] === b.scores[0] &&
    A.opp.truth === 'ai' && B.opp.truth === 'human' && B.opp.goal === roleA.goal;
  if (!ok) { bad++; console.log('mismatch', i, JSON.stringify(a), JSON.stringify(b), A.over, B.over); }
}
console.log(bad ? `${bad} mismatches` : `${N} networked chats: both browsers always agreed on messages, guesses, roles and score.`);
process.exit(bad ? 1 : 0);
