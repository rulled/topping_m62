/**
 * ЧТО РЕАЛЬНО ДОСТУПНО ЧЕРЕЗ WebHID — пересчёт после 2026-11-10.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * `research/WEBHID.md` написан 2026-11-07, когда считалось, что EQ,
 * компрессор и реверб живут только в файлах MCC. С тех пор выяснилось:
 * всё это пишется прямой записью в HID. Значит список возможностей
 * браузерного клиента СИЛЬНО вырос и старую заметку пора пересчитать.
 *
 * ═══ ЧТО СЧИТАЕТ ═══
 *
 * Берёт каталог маршрутов бекенда и делит их по тому, что нужно
 * для работы: HID / файлы MCC / окно MCC. Затем показывает, какая
 * доля переносится в браузер через WebHID без потерь.
 *
 * Это опора для решения: делать полностью браузерный клиент
 * (WebHID напрямую) или оставить бекенд.
 *
 * Запуск: node src/tools/webhid-coverage.js
 */

import { readFileSync } from 'node:fs';

const server = readFileSync('src/server.js', 'utf8');

const routeRe =
  /if \(req\.method === '(\w+)' && url\.pathname === '([^']+)'\) \{([\s\S]*?)\n    \}/g;

const routes = [];
let m;
while ((m = routeRe.exec(server)) !== null) {
  routes.push({ method: m[1], path: m[2], body: m[3] });
}

/** Только HID: браузер сможет это повторить. */
const HID_ONLY = [
  'transport.writeFrames',
  'transport.writeBulk',
  'transport.snapshot',
  'transport.send',
  'readChannelBands',
  'readCompressorHid',
  'readReverb',
  'buildEqFrames',
  'buildCompFrames',
  'buildReverbFrames',
  'describeMixer',
  'describeEqHid',
  'snapshotValue',
  'settings.',
  'controls.',
  'stateStore.',
];

/** Нужны файлы MCC — в браузере недоступны. */
const NEEDS_FILES = [
  'workspace.describe',
  'workspace.list',
  'workspace.invalidate',
  'workspace.applyChanges',
  'createWorkspace',
  'deleteWorkspace',
  'switchWorkspace',
];

/** Нужно окно MCC — в браузере недоступно. */
const NEEDS_WINDOW = [
  'isEqWindowOpen',
  'openEqWindow',
  'compWindowState',
  'openCompWindow',
  'closeCompWindow',
  'clickByName',
  'readAllAudioParams',
];

function stripGuarded(body) {
  let out = body;
  let prev;
  do {
    prev = out;
    out = out.replace(/try\s*\{[\s\S]*?\}\s*catch\s*(\([^)]*\))?\s*\{[\s\S]*?\}/g, '');
  } while (out !== prev);
  return out;
}

const seen = new Set();
const buckets = { hid: [], files: [], win: [] };

for (const r of routes) {
  const id = `${r.method} ${r.path}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const core = stripGuarded(r.body);

  const win = NEEDS_WINDOW.filter((k) => core.includes(k));
  const files = NEEDS_FILES.filter((k) => core.includes(k));
  const hid = HID_ONLY.filter((k) => core.includes(k));

  if (win.length) buckets.win.push({ id, why: win });
  else if (files.length) buckets.files.push({ id, why: files });
  else buckets.hid.push({ id, why: hid });
}

const total = seen.size;
const pct = (n) => ((n / total) * 100).toFixed(0);

console.log('='.repeat(70));
console.log('ЧТО ПЕРЕНОСИТСЯ В БРАУЗЕР ЧЕРЕЗ WebHID');
console.log('='.repeat(70));
console.log(`всего маршрутов: ${total}`);
console.log('');

console.log(`МОЖНО ПОВТОРИТЬ В БРАУЗЕРЕ: ${buckets.hid.length} (${pct(buckets.hid.length)}%)`);
console.log('-'.repeat(70));
for (const r of buckets.hid) console.log(`  ${r.id}`);

console.log('');
console.log(`НУЖНЫ ФАЙЛЫ MCC (в браузере недоступны): ${buckets.files.length} (${pct(buckets.files.length)}%)`);
console.log('-'.repeat(70));
for (const r of buckets.files) console.log(`  ${r.id.padEnd(38)} ${r.why.join(', ')}`);

console.log('');
console.log(`НУЖНО ОКНО MCC (в браузере недоступны): ${buckets.win.length} (${pct(buckets.win.length)}%)`);
console.log('-'.repeat(70));
for (const r of buckets.win) console.log(`  ${r.id.padEnd(38)} ${r.why.join(', ')}`);

console.log('');
console.log('='.repeat(70));
console.log('ВЫВОД');
console.log('='.repeat(70));
console.log(`
  Через WebHID в браузере доступно ${pct(buckets.hid.length)}% возможностей —
  это громкости, настройки, метры, EQ входов и наушников, компрессор,
  реверб, микшер (запись), loopback, ducking, эффекты.

  Недоступно: ${pct(buckets.files.length + buckets.win.length)}% —
  профили MCC (файлы) и sample rate / открытие окон (UIAutomation).

  ВАЖНО: микшер и loopback из устройства не читаются. Браузерный
  клиент должен хранить их сам — в IndexedDB, а не в файле на диске.
  Это не проблема, но требует своей модели состояния во фронте.
`);
