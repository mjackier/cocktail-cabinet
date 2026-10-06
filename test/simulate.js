// Headless balance test: plays every game computer-vs-computer many times.
// Usage: node test/simulate.js [gameId] [matches]
// Checks: no exceptions, every match ends, and neither side wins (almost) always.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, Set, Map, Int16Array, Int8Array, Uint8Array, Float32Array, Array, Object, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
load('js/core.js');
for (const f of fs.readdirSync(path.join(root, 'js/games')).sort()) load('js/games/' + f);
const CC = ctx.CC;

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const N = +process.argv[3] || 40;
const MAX_MIN = 15; // a match longer than this is a failure ("never ends")

let failed = false;
for (const def of CC.games) {
  if (only && def.id !== only) continue;
  if (def.headless === false) continue;
  const wins = [0, 0];
  let timeouts = 0, totalT = 0;
  const samples = [];
  for (let i = 0; i < N; i++) {
    const g = def.create({ ai: [true, true], rng: CC.rng(1000 + i * 7919), input: CC.nullInput, seed: i });
    let t = 0;
    try {
      while (!g.over && t < MAX_MIN * 60) { g.update(CC.STEP); t += CC.STEP; }
    } catch (e) {
      console.error(`${def.id} match ${i} threw:`, e.stack);
      failed = true; break;
    }
    if (!g.over) timeouts++;
    else if (g.result.winner >= 0) wins[g.result.winner]++;
    totalT += t;
    if (samples.length < 4 && g.stats) samples.push(JSON.stringify(g.stats()));
  }
  const pct = (n) => ((100 * n) / N).toFixed(0) + '%';
  console.log(`${def.name.padEnd(16)} ${def.roles[0].name} ${pct(wins[0])}  ${def.roles[1].name} ${pct(wins[1])}  unfinished ${timeouts}  avg ${(totalT / N / 60).toFixed(1)} min`);
  for (const s of samples) console.log('    ' + s);
  if (timeouts > 0 || (def.balance !== false && Math.min(...wins) < N * 0.15)) { console.log('    ⚠ balance outside 15–85% or unfinished matches'); failed = true; }
}
process.exit(failed ? 1 : 0);
