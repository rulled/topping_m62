/**
 * РАСКЛАДКА МАРШРУТОВ ПО ЗАВИСИМОСТЯМ ОТ MCC.
 *
 * ═══ УСТАРЕЛО: ИСПОЛЬЗУЙТЕ autonomy-audit.js ═══
 *
 * Этот скрипт ищет ПОДСТРОКИ-МАРКЕРЫ в теле маршрута, и на этом
 * ошибается. Конкретный провал, найденный ревью:
 *
 *   маркер:   'compressor.open'
 *   код:      comp.openCompWindow()
 *   итог:     POST /api/compressor/open попал в «чистый HID»,
 *             хотя открывает окно MCC
 *
 * Плюс классификация завязана на `workspace.invalidate`: если маршрут
 * пишет в очередь HID, но всё ещё инвалидирует INI-кеш, он останется
 * в «файловом» ведре, и переход на HID не будет виден в цифрах.
 *
 * Правильный инструмент — `autonomy-audit.js`: он перечисляет
 * конкретные функции (ensureMcc, readCompressorValues, ...) и по ним
 * решает, нужен ли запущенный MCC.
 *
 * Этот файл оставлен, потому что на него ссылаются заметки; он
 * печатает предупреждение и работает как раньше.
 *
 * Запуск: node src/tools/autonomy-report.js
 */

import { readFileSync } from 'node:fs';

const src = readFileSync('src/server.js', 'utf8');

/** Признаки зависимости от файлов MCC. */
const FILE_MARKERS = [
  'workspace.describe',
  'workspace.list',
  'workspace.invalidate',
  'workspace.applyChanges',
  'workspaces.',
  'createWorkspace',
  'deleteWorkspace',
  'switchWorkspace',
  'applyChanges',
];

/** Признаки зависимости от запущенного UI MCC. */
const UI_MARKERS = [
  'setReverbType',
  'nudgeReverb',
  'clickByName',
  'settings.setMode',
  'compressor.open',
  'compressor.close',
  'compressor.param',
  'compressor.switch',
  'eq.open',
  'setEqParamTo',
  'nudgeEqParam',
  'setEqSwitch',
  'bandEnableState',
  'isEqWindowOpen',
];

// --- режем файл на блоки эндпоинтов ---
const routeRe =
  /if \(req\.method === '(\w+)' && url\.pathname === '([^']+)'\) \{([\s\S]*?)\n    \}/g;

const routes = [];
let m;
while ((m = routeRe.exec(src)) !== null) {
  routes.push({
    method: m[1],
    path: m[2],
    body: m[3],
    at: m.index,
  });
}

const classify = (body) => {
  const ui = UI_MARKERS.filter((k) => body.includes(k));
  const file = FILE_MARKERS.filter((k) => body.includes(k));
  if (ui.length) return { cls: 'UI MCC', marks: ui };
  if (file.length) return { cls: 'файл MCC', marks: file };
  return { cls: 'чистый HID', marks: [] };
};

const buckets = { 'чистый HID': [], 'файл MCC': [], 'UI MCC': [] };

for (const r of routes) {
  const { cls, marks } = classify(r.body);
  buckets[cls].push({ ...r, marks });
}

const total = routes.length;

console.log('='.repeat(66));
console.log('ВНИМАНИЕ: скрипт устарел и даёт неверную раскладку.');
console.log('Он ищет подстроки и промахивается (см. шапку файла).');
console.log('Правильные цифры: node src/tools/autonomy-audit.js');
console.log('='.repeat(66));
console.log(`всего маршрутов найдено: ${total}`);
console.log('');

for (const cls of ['чистый HID', 'файл MCC', 'UI MCC']) {
  const list = buckets[cls];
  const pct = ((list.length / total) * 100).toFixed(0);
  console.log('─'.repeat(66));
  console.log(`${cls}: ${list.length} из ${total}  (${pct}%)`);
  console.log('─'.repeat(66));
  for (const r of list) {
    const mark = r.marks.length ? `  <- ${[...new Set(r.marks)].join(', ')}` : '';
    console.log(`  ${r.method.padEnd(4)} ${r.path}${mark}`);
  }
  console.log('');
}

console.log('='.repeat(66));
console.log('ИТОГ');
console.log('='.repeat(66));
const hid = buckets['чистый HID'].length;
const file = buckets['файл MCC'].length;
const ui = buckets['UI MCC'].length;
console.log(`  чистый HID (MCC не нужен вообще):       ${hid}`);
console.log(`  нужен файл MCC (установка, не процесс): ${file}`);
console.log(`  нужен запущенный MCC (UI):              ${ui}`);
console.log('');
console.log(`  полностью автономно: ${((hid / total) * 100).toFixed(0)}%`);
console.log(`  без запущенного MCC (но с установленным): ${(((hid + file) / total) * 100).toFixed(0)}%`);
