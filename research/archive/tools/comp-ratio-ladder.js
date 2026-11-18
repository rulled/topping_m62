/**
 * ЛЕСТНИЦА RATIO.
 *
 * Ratio: min=1, max=1000000, шаг у значения 4 равен 0.4.
 * Значит шкала НЕЛИНЕЙНАЯ — как Q у EQ. Нужна таблица.
 *
 * Метод: встаём на минимум (1), затем шаг за шагом вверх, записывая
 * значение после каждого нажатия. Так получаем точную лестницу.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'research/comp-nudge2.ps1';

const ratio = () => {
  const ws = findActiveWorkspace();
  return Number(readWorkspace(ws.path).Compressor.Ratio);
};

function nudge(key, times, delay = 70) {
  execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, 'Ratio', key, String(times), String(delay)],
    { encoding: 'utf8' });
}

const STEPS = Number(process.argv[2] ?? 60);

console.log('=== ЛЕСТНИЦА RATIO ===\n');
console.log('старт:', ratio());

// 1. вниз до упора
console.log('вниз до минимума...');
let last = ratio();
for (let i = 0; i < 20; i++) {
  nudge('{DOWN}', 10);
  await sleep(700);
  const cur = ratio();
  if (cur === last) break;
  last = cur;
}
const minVal = ratio();
console.log('минимум:', minVal, '\n');

// 2. вверх по одному нажатию
console.log('лестница вверх (по 1 нажатию):');
const ladder = [minVal];
let presses = 0;
for (let i = 0; i < STEPS; i++) {
  nudge('{UP}', 1, 60);
  await sleep(380);
  const cur = ratio();
  presses++;
  ladder.push(cur);
  if (presses <= 40 || presses % 5 === 0) console.log(`  ${String(presses).padStart(3)}: ${cur}`);
  if (cur === 1000000) { console.log(`  достигнут максимум на ${presses} нажатиях`); break; }
}

console.log('\n=== ЛЕСТНИЦА (JSON) ===');
console.log(JSON.stringify(ladder));

// 3. вернуть на 4
console.log('\nвозврат к 4...');
let guard = 0;
while (Math.abs(ratio() - 4) > 0.001 && guard < 400) {
  const cur = ratio();
  const down = cur > 4;
  nudge(down ? '{DOWN}' : '{UP}', 1, 60);
  await sleep(360);
  guard++;
}
console.log('итог Ratio =', ratio());
