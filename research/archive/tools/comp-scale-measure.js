/**
 * ИЗМЕРЕНИЕ ШКАЛ КОМПРЕССОРА.
 *
 * Известно: 1 нажатие = 1 единица для Threshold/Attack/Release/Gain.
 * Ratio — дробный (~0.4/нажатие). Mix — не проверен вниз.
 * Надо: точные min/max и шаг для каждого параметра.
 *
 * Метод: идём вниз до упора, считая нажатия; затем вверх до упора.
 * Ratio пишется как float (4 -> 4.699999809265137), значит внутри шкала ступенчатая.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'research/comp-nudge.ps1';

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return {
    thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack),
    rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix),
  };
};

function nudge(param, key, times) {
  execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, param, key, String(times)],
    { encoding: 'utf8' });
}

const FIELD = { Threshold: 'thr', Ratio: 'ratio', Attack: 'att', Release: 'rel', Gain: 'gain', Mix: 'mix' };

/** Один шаг вверх — сколько даёт. */
async function measureStep(param) {
  const f = FIELD[param];
  const b = comp();
  nudge(param, '{UP}', 1);
  await sleep(900);
  const a = comp();
  const step = a[f] - b[f];
  // вернуть
  if (step !== 0) { nudge(param, '{DOWN}', 1); await sleep(700); }
  return { step, from: b[f], to: a[f] };
}

/** Сколько шагов до низа (не больше max). */
async function downToLimit(param, maxSteps) {
  const f = FIELD[param];
  const startVal = comp()[f];
  let presses = 0;
  let prev = comp()[f];
  let stable = 0;
  for (let i = 1; i <= maxSteps; i += 5) {
    nudge(param, '{DOWN}', 5);
    await sleep(650);
    const cur = comp()[f];
    presses += 5;
    if (cur === prev) { stable += 5; if (stable >= 15) break; } else { stable = 0; }
    prev = cur;
  }
  const finalVal = comp()[f];
  return { startVal, finalVal, presses, atLimit: true };
}

const WHICH = process.argv[2];

if (WHICH === 'step') {
  console.log('=== ШАГ (одно нажатие UP) ===\n');
  for (const p of Object.keys(FIELD)) {
    const r = await measureStep(p);
    console.log(`${p.padEnd(10)} ${String(r.from).padStart(8)} -> ${String(r.to).padStart(8)}  шаг = ${r.step}`);
  }
} else if (WHICH === 'train') {
  // Быстрый поезд вниз и обратно для одного параметра
  const p = process.argv[3];
  const f = FIELD[p];
  console.log(`=== ${p}: вниз до упора ===`);
  const b = comp();
  console.log('старт:', b[f]);
  let presses = 0;
  let last = b[f];
  let same = 0;
  for (let i = 0; i < 120; i++) {
    nudge(p, '{DOWN}', 1);
    await sleep(520);
    presses++;
    const cur = comp()[f];
    if (cur === last) { same++; if (same >= 4) { console.log(`  упор после ${presses} нажатий, значение ${cur}`); break; } }
    else { same = 0; }
    if (presses % 10 === 0) console.log(`  ${presses}: ${cur}`);
    last = cur;
  }
  console.log('низ:', comp()[f]);
  // вверх до возврата
  console.log('\nвозврат вверх...');
  let up = 0;
  let lastU = comp()[f];
  let sameU = 0;
  for (let i = 0; i < 200; i++) {
    nudge(p, '{UP}', 1);
    await sleep(520);
    up++;
    const cur = comp()[f];
    if (cur === lastU) { sameU++; if (sameU >= 4) { console.log(`  верх после ${up} нажатий, значение ${cur}`); break; } }
    else { sameU = 0; }
    if (up % 10 === 0) console.log(`  +${up}: ${cur}`);
    lastU = cur;
  }
  console.log('финал:', JSON.stringify(comp()));
} else {
  console.log('usage: node comp-scale-measure.js step | train <Param>');
}
