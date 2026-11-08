/**
 * ОПРЕДЕЛЕНИЕ ДИАПАЗОНОВ КОМПРЕССОРА.
 *
 * Шлём пачки по N нажатий, пока значение не перестанет меняться.
 * Каждый параметр: вниз до упора -> вверх до упора -> запомнить min/max.
 * В конце возвращаем исходные значения.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'research/comp-nudge2.ps1';

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return {
    thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack),
    rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix),
  };
};

function nudge(param, key, times, delay = 90) {
  execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, param, key, String(times), String(delay)],
    { encoding: 'utf8' });
}

const FIELD = { Threshold: 'thr', Ratio: 'ratio', Attack: 'att', Release: 'rel', Gain: 'gain', Mix: 'mix' };
const CHUNK = 10;
const SETTLE = 800;

async function toLimit(param, key) {
  const f = FIELD[param];
  let presses = 0;
  let last = comp()[f];
  for (let i = 0; i < 60; i++) {
    nudge(param, key, CHUNK);
    await sleep(SETTLE);
    presses += CHUNK;
    const cur = comp()[f];
    if (cur === last) break;
    last = cur;
  }
  return { value: comp()[f], presses };
}

const only = process.argv[2];
const params = only ? [only] : Object.keys(FIELD);

console.log('=== ДИАПАЗОНЫ КОМПРЕССОРА ===\n');
const before = comp();
console.log('исходное:', JSON.stringify(before), '\n');

const result = {};

for (const p of params) {
  const f = FIELD[p];
  console.log(`--- ${p} (старт ${comp()[f]}) ---`);
  const lo = await toLimit(p, '{DOWN}');
  console.log(`  низ:  ${lo.value}   (${lo.presses} нажатий)`);
  const hi = await toLimit(p, '{UP}');
  console.log(`  верх: ${hi.value}   (${hi.presses} нажатий)`);
  result[p] = { min: lo.value, max: hi.value, start: before[f] };
  console.log('');
}

console.log('=== РЕЗУЛЬТАТ ===');
for (const [p, r] of Object.entries(result)) {
  console.log(`  ${p.padEnd(10)} ${String(r.min).padStart(8)} .. ${String(r.max).padStart(8)}   (было ${r.start})`);
}

// ─── восстановление ───
console.log('\n=== ВОССТАНОВЛЕНИЕ ===');
for (const p of params) {
  const f = FIELD[p];
  const want = before[f];
  const cur = comp()[f];
  if (cur === want) { console.log(`  ${p.padEnd(10)} уже ${want}`); continue; }
  const step = Math.abs((result[p].max - result[p].min) / 100) || 1;
  const key = want > cur ? '{UP}' : '{DOWN}';
  let guard = 0;
  while (comp()[f] !== want && guard < 300) {
    nudge(p, key, 1, 70);
    await sleep(420);
    guard++;
    if (guard % 25 === 0) console.log(`    ${p}: ${comp()[f]} -> цель ${want}`);
  }
  console.log(`  ${p.padEnd(10)} ${comp()[f]} ${comp()[f] === want ? '✓' : '⚠'}`);
}

console.log('\nитоговое:', JSON.stringify(comp()));
