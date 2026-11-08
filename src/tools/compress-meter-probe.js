/**
 * ВЫЯСНИТЬ, ЧТО ТАКОЕ compressMeter (QProgressBar 0..360).
 *
 * Гипотеза: это индикатор гребёнки редукции (gain reduction) в окне COMP.
 * Тогда при сильном сжатии и громком входе он должен расти от 0.
 *
 * Метод: поднимаем громкость mic1 до максимума, включаем компрессор,
 * ставим агрессивные настройки (Threshold 0, Ratio ∞), читаем бар.
 *
 * Безопасность: HP замьючен.
 */
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PS = 'src/tools/comp-key.ps1';

function ps(args) {
  try {
    return execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args.map(String)],
      { encoding: 'utf8' }).trim();
  } catch (e) { return String(e.stdout ?? '').trim() || 'ERR'; }
}

/** Прочитать compressMeter (RangeValue) из окна COMP. */
function readBar() {
  const script = 'research/read-comp-bar.ps1';
  try {
    return execFileSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8' }).trim();
  } catch (e) { return String(e.stdout ?? '').trim() || 'ERR'; }
}

async function api(path, body) {
  const r = await fetch('http://127.0.0.1:8787/api/' + path,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return r.json();
}

console.log('открываю окно COMP...');
console.log(' ', ps(['open']));

// агрессивные настройки, чтобы редукция была заметна
console.log('\nставлю Threshold=0, Ratio=inf...');
await api('compressor/param', { param: 'Threshold', value: 0 });
console.log(' threshold ->', (await api('compressor')).values.Threshold);
await api('compressor/param', { param: 'Ratio', value: 1000000 });
console.log(' ratio ->', (await api('compressor')).values.Ratio);

console.log('\nчтение бара при разной громкости входа\n');
console.log('  mic1   bar   comp13(raw)  comp12(raw)');

for (const gain of [20, 40, 60, 80, 88]) {
  await api('volume', { id: 'mic1', value: gain });
  await sleep(2000);
  const bar = readBar();
  const m = (await api('meters')).meters;
  const c13 = m.find((x) => x.id === 'meter_comp13')?.raw;
  const c12 = m.find((x) => x.id === 'meter_comp12')?.raw;
  console.log(`  ${String(gain).padStart(3)}   ${String(bar).padStart(5)}   ${String(c13).padStart(9)}  ${String(c12).padStart(10)}`);
}

console.log('\nвозвращаю mic1=44');
await api('volume', { id: 'mic1', value: 44 });
