/**
 * ЧЕСТНЫЙ ПЕРЕСЧЁТ ЗАВИСИМОСТИ МАРШРУТОВ ОТ MCC.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `autonomy-report.js` ищет подстроки-маркеры и ошибается:
 * он ждёт 'compressor.open', а код вызывает `comp.openCompWindow()`,
 * поэтому POST /api/compressor/open попадает в «чистый HID», хотя
 * открывает окно MCC.
 *
 * Здесь проверка по ФАКТИЧЕСКИМ вызовам: для каждого маршрута ищем
 * в его теле функции, которые умеют работать только с запущенным MCC
 * или только с файлами MCC.
 *
 * Запуск: node src/tools/autonomy-audit.js
 */

import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.js', 'utf8');

/**
 * Функции, требующие ЗАПУЩЕННОГО MCC (UIAutomation над его окном).
 * Проверено чтением src/eq-control.js, src/comp-control.js,
 * src/ui-control.js: все они в итоге вызывают ensureMcc()/dumpTree()
 * либо двигают контролы через паттерны доступности.
 */
const NEEDS_RUNNING_MCC = [
  'isEqWindowOpen',      // проверяет наличие окна EQ в дереве UIA
  'setEqParamTo',
  'nudgeEqParam',
  'setEqSwitch',
  'readEqSwitch',        // -> ensureMcc()
  'bandEnableState',
  'readEqTypes',
  'openEqWindow',
  'pressDial',
  'setReverbType',
  'nudgeReverb',
  'clickByName',
  'openCompWindow',
  'closeCompWindow',
  'compWindowState',
  'setCompressorParam',
  'nudgeCompressorParam',
  'setCompressorSwitch',
  'readCompressorValues', // читает workspace-INI
];

/** Функции, требующие УСТАНОВЛЕННОГО MCC (читают/пишут его INI). */
const NEEDS_MCC_FILES = [
  'workspace.describe',
  'workspace.list',
  'workspace.invalidate',
  'workspace.applyChanges',
  'createWorkspace',
  'deleteWorkspace',
  'switchWorkspace',
  'findActiveWorkspace',
  'readWorkspace',
];

/** Маршруты, которые сами управляют процессом MCC (особый класс). */
const MANAGES_MCC_PROCESS = ['settings.setMode', 'stopMcc', 'mccFriendly'];

const routeRe =
  /if \(req\.method === '(\w+)' && url\.pathname === '([^']+)'\) \{([\s\S]*?)\n    \}/g;

const routes = [];
let m;
while ((m = routeRe.exec(server)) !== null) {
  routes.push({ method: m[1], path: m[2], body: m[3] });
}

const seen = new Set();
const rows = [];

for (const r of routes) {
  const id = `${r.method} ${r.path}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const ui = NEEDS_RUNNING_MCC.filter((k) => r.body.includes(k));
  const files = NEEDS_MCC_FILES.filter((k) => r.body.includes(k));
  const proc = MANAGES_MCC_PROCESS.filter((k) => r.body.includes(k));
  rows.push({ id, ui, files, proc });
}

const buckets = { ui: [], proc: [], files: [], hid: [] };
for (const r of rows) {
  if (r.ui.length) buckets.ui.push(r);
  else if (r.proc.length) buckets.proc.push(r);
  else if (r.files.length) buckets.files.push(r);
  else buckets.hid.push(r);
}

const total = rows.length;
const pct = (n) => ((n / total) * 100).toFixed(0);

console.log('='.repeat(72));
console.log(`ВСЕГО маршрутов (метод+путь): ${total}`);
console.log('='.repeat(72));

const show = (title, list, note) => {
  console.log('');
  console.log('-'.repeat(72));
  console.log(`${title}: ${list.length} из ${total}  (${pct(list.length)}%)  ${note}`);
  console.log('-'.repeat(72));
  for (const r of list) {
    const why = [...new Set([...r.ui, ...r.proc, ...r.files])].slice(0, 3).join(', ');
    console.log(`  ${r.id.padEnd(38)} ${why}`);
  }
};

show('1. Нужен ЗАПУЩЕННЫЙ MCC (UIAutomation)', buckets.ui, 'падает без окна');
show('2. Управляет процессом MCC', buckets.proc, 'смена режима / apply');
show('3. Нужен УСТАНОВЛЕННЫЙ MCC (INI)', buckets.files, 'читает/пишет файлы');
show('4. Чистый HID', buckets.hid, 'MCC не нужен вообще');

console.log('');
console.log('='.repeat(72));
console.log('ИТОГ');
console.log('='.repeat(72));
console.log(`  чистый HID:                 ${String(buckets.hid.length).padStart(3)}  (${pct(buckets.hid.length)}%)`);
console.log(`  нужны файлы MCC:            ${String(buckets.files.length).padStart(3)}  (${pct(buckets.files.length)}%)`);
console.log(`  управляет процессом MCC:    ${String(buckets.proc.length).padStart(3)}  (${pct(buckets.proc.length)}%)`);
console.log(`  нужен запущенный MCC:       ${String(buckets.ui.length).padStart(3)}  (${pct(buckets.ui.length)}%)`);
console.log('');
console.log(`  без запущенного MCC:  ${buckets.hid.length + buckets.files.length}/${total}`
  + ` = ${pct(buckets.hid.length + buckets.files.length)}%`);
console.log(`  без MCC вообще:       ${buckets.hid.length}/${total} = ${pct(buckets.hid.length)}%`);
