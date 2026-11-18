/**
 * КЛАВИАТУРНАЯ ПРОБА КОМПРЕССОРА — с поднятием окна.
 *
 * Найдено: окно компрессора CompressorS1M1 — ОТДЕЛЬНОЕ top-level окно.
 * SendKeys уходит в foreground, поэтому окно надо поднимать (AttachThreadInput + SetForegroundWindow).
 * Класс дилов тот же DialS1M5/DialS1M1, автоматизация та же, что у EQ.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const comp = () => {
  const ws = findActiveWorkspace();
  const c = readWorkspace(ws.path).Compressor ?? {};
  return {
    switch: String(c.Switch),
    thr: Number(c.Threshold), ratio: Number(c.Ratio), att: Number(c.Attack),
    rel: Number(c.Release), gain: Number(c.Gain), mix: Number(c.Mix),
    auto: String(c.GainAuto),
  };
};

const PS = 'research/comp-nudge.ps1';
function nudge(param, key, times) {
  return execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, param, key, String(times)],
    { encoding: 'utf8' }).trim();
}

/** Сколько «единиц» даёт 1 нажатие — определяем измерением. */
const PARAMS = ['Threshold', 'Ratio', 'Attack', 'Release', 'Gain', 'Mix'];
const FIELD = { Threshold: 'thr', Ratio: 'ratio', Attack: 'att', Release: 'rel', Gain: 'gain', Mix: 'mix' };

console.log('=== КЛАВИАТУРА НА КОМПРЕССОРЕ (окно поднимается) ===\n');
console.log('до:', JSON.stringify(comp()));
console.log('');

const summary = [];

for (const param of PARAMS) {
  const field = FIELD[param];
  const b = comp();

  nudge(param, '{UP}', 3);
  await sleep(1000);
  const a = comp();

  const delta = a[field] - b[field];
  const works = delta !== 0;
  console.log(`${param.padEnd(10)} ${String(b[field]).padStart(6)} -> ${String(a[field]).padStart(6)}  дельта ${String(delta).padStart(5)} за 3 нажатия  ${works ? '✓ РАБОТАЕТ' : '— нет'}`);

  summary.push({ param, before: b[field], after: a[field], delta, works });
}

console.log('\n=== ОТКАТ ===');
for (const s of summary) {
  if (!s.works) continue;
  const presses = Math.abs(s.delta);
  const key = s.delta > 0 ? '{DOWN}' : '{UP}';
  nudge(s.param, key, presses);
  await sleep(800);
}
await sleep(600);
const fin = comp();
console.log('после отката:', JSON.stringify(fin));

const bad = summary.filter((s) => s.works).filter((s) => {
  const fld = FIELD[s.param];
  return fin[fld] !== s.before;
});
console.log(bad.length ? `⚠ не восстановлены: ${bad.map((b) => b.param).join(', ')}` : '✓ всё восстановлено');

console.log('\n=== ИТОГ ===');
for (const s of summary) {
  console.log(`  ${s.param.padEnd(10)} ${s.works ? `РАБОТАЕТ, ${s.delta / 3} ед/нажатие` : 'НЕ РАБОТАЕТ'}`);
}
