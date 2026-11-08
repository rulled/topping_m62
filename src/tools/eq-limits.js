/**
 * ОПРЕДЕЛЕНИЕ ДИАПАЗОНОВ EQ: тянем полосы до упора.
 *
 * Нужны точные min/max для частоты, Q и gain, а также список типов фильтров.
 */
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps2 = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const band = (n = 1) => {
  const i = readWorkspace(findActiveWorkspace().path);
  return i.EQ_IN1?.[`Eq%40${n}`];
};

function parseBand(s) {
  if (!s) return null;
  const parts = String(s).split('|').filter((x) => x !== '');
  return { type: Number(parts[0]), freq: Number(parts[1]), q: Number(parts[2]), gain: Number(parts[3]), raw: s };
}

console.log('=== 1. ИСХОДНАЯ ПОЛОСА 1 ===');
const b1 = parseBand(band(1));
console.log(`  ${b1.raw}`);
console.log(`  тип=${b1.type} freq=${b1.freq} Q=${b1.q} gain=${b1.gain}`);

console.log('\n=== 2. ИЩУ ЭЛЕМЕНТЫ УПРАВЛЕНИЯ EQ В UI ===');
// EQ-панель обычно внизу: gain-слайдеры полос, комбобокс типа, поля частоты/Q
const { items } = dumpTree();
const eqArea = items.filter((x) =>
  (x.cls === 'QSlider' || /ComboBox/.test(x.cls ?? '') || /Dial/.test(x.cls ?? ''))
  && x.ly > 1100 && x.ly < 1500 && x.lx < 1200
);
console.log(`  элементов в области EQ: ${eqArea.length}`);
for (const e of eqArea.slice(0, 12)) {
  console.log(`    [${e.i}] ${e.cls} (${e.lx},${e.ly})`);
}

console.log('\n=== 3. ЗАПИСЬ ЧЕРЕЗ ФАЙЛ: проверяю допустимые значения ===');
console.log('  (MCC не запущен? останавливаю для чистого теста)');
const cnt = Number(ps2('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count'));
const hadMcc = cnt > 0;
if (hadMcc) {
  ps2('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
  await sleep(4000);
}

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
const orig = ini.EQ_IN1['Eq%401'];

// Пробуем разные типы фильтров
console.log('\n  пробую типы фильтров 0..5:');
for (const type of [0, 1, 2, 3, 4, 5]) {
  ini.EQ_IN1['Eq%401'] = `|${type}|1000|1|3`;
  writeWorkspace(ws.path, ini);
  const after = readWorkspace(ws.path).EQ_IN1['Eq%401'];
  console.log(`    тип ${type} -> файл "${after}"`);
}

// границы gain
console.log('\n  пробую границы gain (при типе 0, freq 1000, Q 1):');
for (const g of [-24, -18, -12, 6, 12, 18, 24]) {
  ini.EQ_IN1['Eq%401'] = `|0|1000|1|${g}`;
  writeWorkspace(ws.path, ini);
  const after = parseBand(readWorkspace(ws.path).EQ_IN1['Eq%401']);
  console.log(`    gain ${String(g).padStart(3)} -> "${after?.raw}"  (получили gain=${after?.gain})`);
}

// границы частоты
console.log('\n  пробую границы частоты:');
for (const f of [20, 50, 100, 20000, 30000]) {
  ini.EQ_IN1['Eq%401'] = `|0|${f}|1|0`;
  writeWorkspace(ws.path, ini);
  const after = parseBand(readWorkspace(ws.path).EQ_IN1['Eq%401']);
  console.log(`    freq ${String(f).padStart(5)} -> freq=${after?.freq}`);
}

// границы Q
console.log('\n  пробую границы Q:');
for (const q of [0.1, 0.3, 0.7, 5, 10, 20]) {
  ini.EQ_IN1['Eq%401'] = `|0|1000|${q}|0`;
  writeWorkspace(ws.path, ini);
  const after = parseBand(readWorkspace(ws.path).EQ_IN1['Eq%401']);
  console.log(`    Q ${String(q).padStart(4)} -> Q=${after?.q}`);
}

// восстановим
ini.EQ_IN1['Eq%401'] = orig;
writeWorkspace(ws.path, ini);
console.log(`\n  восстановил полосу 1: "${orig}"`);

if (hadMcc) {
  console.log('  запускаю MCC...');
  ps2('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
  await sleep(15000);
}
