/**
 * ЧЕСТНЫЙ ПОДСЧЁТ: что РЕАЛЬНО переносится в браузер через WebHID.
 *
 * ═══ ЧТО БЫЛО НЕ ТАК С ПРЕДЫДУЩЕЙ ВЕРСИЕЙ ═══
 *
 * `webhid-coverage.js` вырезал блоки try/catch перед сопоставлением
 * маркеров. Из-за этого пять маршрутов, у которых вызов UIAutomation
 * или sample-rate оказался внутри try, попали в список «доступно»:
 *
 *   GET  /api/audio-params        sample rate — только UIAutomation
 *   POST /api/audio-params        то же
 *   POST /api/eq/open             открывает окно MCC
 *   POST /api/compressor/open     открывает окно MCC
 *   POST /api/compressor/close    закрывает окно MCC
 *
 * То есть цифра 85% была завышена ровно на ту функциональность,
 * которую документ сам объявил недоступной. Нашли два ревьюера
 * независимо (Goldfish, 2026-11-10).
 *
 * ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
 *
 * 1. Держит ЯВНЫЙ список маршрутов, которые в браузере невозможны.
 *    Это надёжнее, чем угадывать по подстрокам: список короткий и его
 *    можно перепроверить глазами.
 * 2. Считает остальное доступным и печатает обе цифры — по маршрутам
 *    и по возможностям.
 *
 * Запуск: node src/tools/webhid-coverage-honest.js
 */

import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.js', 'utf8');

const routeRe =
  /if \(req\.method === '(\w+)' && url\.pathname === '([^']+)'\) \{/g;

const routes = new Set();
let m;
while ((m = routeRe.exec(server)) !== null) {
  routes.add(`${m[1]} ${m[2]}`);
}

/**
 * Маршруты, которые в браузере невозможны. Проверено чтением кода.
 * Каждая запись — с причиной, чтобы список можно было перепроверить.
 */
const IMPOSSIBLE = new Map([
  // --- профили MCC: файлы на диске ---
  ['GET /api/workspace', 'читает INI MCC'],
  ['GET /api/workspaces', 'список INI MCC'],
  ['POST /api/workspaces/create', 'создаёт INI MCC'],
  ['POST /api/workspaces/delete', 'удаляет INI MCC'],
  ['POST /api/workspaces/switch', 'переключает профиль MCC через реестр'],
  ['POST /api/workspace/apply', 'правит INI и перезапускает MCC'],
  ['POST /api/state/import', 'импорт из INI MCC'],
  ['GET /api/workspace', 'читает INI MCC'],

  // --- смена режима: требует остановки и запуска MCC ---
  ['POST /api/mode', 'останавливает MCC, шлёт 0x11:0x1d, запускает MCC заново'],

  // --- окна MCC через UIAutomation ---
  ['POST /api/mcc/click', 'клик по окну MCC'],
  ['POST /api/eq/open', 'открывает окно EQ в MCC'],
  ['POST /api/compressor/open', 'открывает окно компрессора'],
  ['POST /api/compressor/close', 'закрывает окно компрессора'],

  // --- sample rate: только клавиатурой UIAutomation ---
  ['GET /api/audio-params', 'sample rate через UIAutomation'],
  ['POST /api/audio-params', 'sample rate через UIAutomation'],
]);

/**
 * ВОЗМОЖНОСТИ — то, что чувствует пользователь.
 *
 * Маршрут — артефакт HTTP, которого в браузере не будет. Считать
 * надо возможности: именно они теряются или сохраняются.
 */
const CAPABILITIES = [
  { id: 'volumes', name: 'Громкости (7)', routes: ['POST /api/volume', 'GET /api/controls'] },
  { id: 'selectors', name: 'Селекторы источников (2)', routes: ['POST /api/selector'] },
  { id: 'settings', name: 'Настройки устройства', routes: ['GET /api/settings', 'POST /api/settings/toggle', 'POST /api/settings/enum', 'POST /api/settings/command'] },
  { id: 'meters', name: 'Метры (22)', routes: ['GET /api/meters'] },
  { id: 'jacks', name: 'Джеки и зарядка', routes: ['GET /api/tags'] },
  { id: 'eqIn', name: 'EQ входов', routes: ['GET /api/eq', 'POST /api/eq/band', 'POST /api/eq/type', 'POST /api/eq/switch', 'POST /api/eq/band/enable', 'GET /api/eq/types', 'GET /api/eq/params'] },
  { id: 'eqHp', name: 'EQ наушников', routes: ['GET /api/eq-hp', 'POST /api/eq-hp'] },
  { id: 'compressor', name: 'Компрессор', routes: ['GET /api/compressor', 'POST /api/compressor/param', 'POST /api/compressor/switch'] },
  { id: 'reverb', name: 'Реверб', routes: ['GET /api/reverb', 'POST /api/reverb', 'POST /api/reverb/param'] },
  { id: 'mixer', name: 'Микшер (запись)', routes: ['GET /api/mixer', 'POST /api/mixer'] },
  { id: 'loopback', name: 'Loopback', routes: ['POST /api/state/loopback'] },
  { id: 'ducking', name: 'Ducking', routes: ['POST /api/state/ducking'] },
  { id: 'mode', name: 'Режим (чтение)', routes: ['GET /api/mode'] },
  { id: 'modeSwitch', name: 'Смена режима', routes: ['POST /api/mode'] },
  { id: 'profiles', name: 'Профили MCC', routes: ['GET /api/workspaces', 'POST /api/workspaces/create', 'POST /api/workspaces/switch', 'POST /api/workspace/apply'] },
  { id: 'sampleRate', name: 'Sample rate / buffer', routes: ['GET /api/audio-params', 'POST /api/audio-params'] },
  { id: 'windows', name: 'Открытие окон MCC', routes: ['POST /api/eq/open', 'POST /api/compressor/open', 'POST /api/compressor/close', 'POST /api/mcc/click'] },
];

const allRoutes = [...routes];
const impossible = allRoutes.filter((r) => IMPOSSIBLE.has(r));
const possible = allRoutes.filter((r) => !IMPOSSIBLE.has(r));

console.log('='.repeat(70));
console.log('ЧТО ПЕРЕНОСИТСЯ В БРАУЗЕР — ЧЕСТНЫЙ ПОДСЧЁТ');
console.log('='.repeat(70));
console.log(`всего маршрутов: ${allRoutes.length}`);
console.log(`доступно в браузере: ${possible.length}`);
console.log(`невозможно: ${impossible.length}`);
console.log('');

console.log('НЕВОЗМОЖНО В БРАУЗЕРЕ:');
console.log('-'.repeat(70));
for (const r of impossible.sort()) {
  console.log(`  ${r.padEnd(34)} ${IMPOSSIBLE.get(r)}`);
}

console.log('');
console.log('='.repeat(70));
console.log('ПО ВОЗМОЖНОСТЯМ (это то, что чувствует пользователь)');
console.log('='.repeat(70));

const available = [];
const lost = [];
for (const cap of CAPABILITIES) {
  // возможность доступна, если ВСЕ её маршруты не в списке невозможных
  const blocked = cap.routes.filter((r) => IMPOSSIBLE.has(r));
  const ok = blocked.length === 0;
  if (ok) available.push(cap);
  else lost.push({ ...cap, blocked });
}

console.log(`ДОСТУПНО: ${available.length} из ${CAPABILITIES.length}`);
for (const c of available) console.log(`  + ${c.name}`);

console.log('');
console.log(`НЕДОСТУПНО: ${lost.length} из ${CAPABILITIES.length}`);
for (const c of lost) {
  console.log(`  - ${c.name.padEnd(26)} ${c.blocked.length} маршрут(ов), напр. ${c.blocked[0]}`);
}

console.log('');
console.log('='.repeat(70));
console.log('ИТОГ');
console.log('='.repeat(70));
const capPct = ((available.length / CAPABILITIES.length) * 100).toFixed(0);
const routePct = ((possible.length / allRoutes.length) * 100).toFixed(0);
console.log(`  по возможностям: ${available.length}/${CAPABILITIES.length} = ${capPct}%`);
console.log(`  по маршрутам:    ${possible.length}/${allRoutes.length} = ${routePct}%`);
console.log('');
console.log('  Второй цифрой пользоваться нельзя как обещанием: маршрут —');
console.log('  артефакт HTTP, в браузере его не будет. Ориентир — первая.');
