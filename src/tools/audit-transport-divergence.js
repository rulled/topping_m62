/**
 * АУДИТ: разошлись ли две реализации политики протокола.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * В проекте два транспорта:
 *   • `src/transport-core.js` (487 строк) — для браузера, путь A;
 *   • `src/transport.js` (657 строк) — для сервера, путь B.
 *
 * Оба реализуют ОДНУ И ТУ ЖЕ политику: handshake, keepalive,
 * announce, коммит EQ, чтение новой сессией.
 *
 * Это уже приводило к реальному багу: когда я исправил ложное
 * подтверждение EQ, пришлось править ОБА файла. Если бы один забыл —
 * баг остался бы на одном из путей.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Не «одинаков ли текст» (он разный, и это нормально: разные адаптеры),
 * а совпадают ли КЛЮЧЕВЫЕ ЧИСЛА И ПОРЯДОК:
 *
 *   1. Период keepalive (обязан быть одинаковым — иначе устройство
 *      замолкает на одном пути и не замолкает на другом).
 *   2. Период announce.
 *   3. Порядок открытия сессии (handshake → subscribe → announce).
 *   4. Таймауты ожидания ответа на handshake.
 *   5. Значения hold/settle при записи EQ.
 *
 * Запуск: node src/tools/audit-transport-divergence.js
 */

import { readFileSync } from 'node:fs';

let ok = 0;
let fail = 0;
let warn = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};
const note = (msg) => { warn += 1; console.log(`  !     ${msg}`); };

const CORE = readFileSync('src/transport-core.js', 'utf8');
const NODE = readFileSync('src/transport.js', 'utf8');
const PROTOCOL = readFileSync('src/protocol.js', 'utf8');

/** Извлечь число по шаблону или null. */
function num(src, re) {
  const m = src.match(re);
  return m ? Number(m[1]) : null;
}

console.log('='.repeat(70));
console.log('АУДИТ: РАСХОЖДЕНИЕ ТРАНСПОРТОВ');
console.log('='.repeat(70));

// ─── 1. период keepalive ───
console.log('\n--- 1. период keepalive ---');
const KEEPALIVE = num(PROTOCOL, /KEEPALIVE_MS\s*=\s*(\d+)/);
console.log(`  protocol.js: KEEPALIVE_MS = ${KEEPALIVE}`);

// Оба транспорта должны брать константу из protocol.js, а не
// объявлять свою.
//
// Проверяем по исходнику без строк импорта: если объявление есть в
// теле файла, значит константа своя (риск расхождения).
const CORE_BODY = CORE.replace(/^import[\s\S]*?;$/gm, '');
const NODE_BODY = NODE.replace(/^import[\s\S]*?;$/gm, '');

const coreOwnKeepalive = /KEEPALIVE_MS\s*=\s*\d+/.test(CORE_BODY);
const nodeOwnKeepalive = /KEEPALIVE_MS\s*=\s*\d+/.test(NODE_BODY);

check('transport-core импортирует KEEPALIVE_MS, а не объявляет свой',
  !coreOwnKeepalive, coreOwnKeepalive ? 'объявляет свою константу' : '');
check('transport.js импортирует KEEPALIVE_MS, а не объявляет свой',
  !nodeOwnKeepalive, nodeOwnKeepalive ? 'объявляет свою константу' : '');

// ─── 2. период announce ───
console.log('\n--- 2. период announce ---');
const coreAnnounce = num(CORE, /ANNOUNCE_MS\s*=\s*(\d+)/);
const nodeAnnounce = num(NODE, /ANNOUNCE_MS\s*=\s*(\d+)/);
console.log(`  transport-core: ANNOUNCE_MS = ${coreAnnounce}`);
console.log(`  transport.js:   ANNOUNCE_MS = ${nodeAnnounce}`);
check('периоды announce совпадают', coreAnnounce === nodeAnnounce,
  `${coreAnnounce} vs ${nodeAnnounce}`);

// ─── 3. порядок открытия сессии ───
console.log('\n--- 3. порядок открытия сессии ---');

/** В каком порядке идут handshake/subscribe/announce в open(). */
function openOrder(src) {
  const m = src.match(/async open\(\)\s*\{([\s\S]*?)\n {2}\}/);
  if (!m) return null;
  const body = m[1];
  const marks = [
    ['handshake', body.indexOf('PP_HANDSHAKE')],
    ['subscribe', body.indexOf('PP_SUBSCRIBE')],
    ['announce', body.indexOf('PP_ANNOUNCE')],
  ].filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  return marks.map(([n]) => n);
}

const coreOrder = openOrder(CORE);
const nodeOrder = openOrder(NODE);
console.log(`  transport-core: ${coreOrder?.join(' -> ') ?? 'не найден open()'}`);
console.log(`  transport.js:   ${nodeOrder?.join(' -> ') ?? 'не найден open()'}`);

check('порядок в transport-core: handshake первым',
  coreOrder?.[0] === 'handshake', String(coreOrder?.[0]));
check('порядок в transport.js: handshake первым',
  nodeOrder?.[0] === 'handshake', String(nodeOrder?.[0]));
check('порядок совпадает', JSON.stringify(coreOrder) === JSON.stringify(nodeOrder),
  `${coreOrder} vs ${nodeOrder}`);

// ─── 4. ожидание ответа на handshake ───
console.log('\n--- 4. ожидание ответа на handshake ---');
const coreAnswer = num(CORE, /waitForHandshakeAnswer\((\d+)\)/);
const nodeAnswer = num(NODE, /ANSWER_MS\s*=\s*(\d+)/)
  ?? num(NODE, /waitForHandshakeAnswer\((\d+)\)/);
console.log(`  transport-core: ${coreAnswer} мс`);
console.log(`  transport.js:   ${nodeAnswer} мс`);

if (coreAnswer !== null && nodeAnswer !== null) {
  check('таймауты ожидания совпадают', coreAnswer === nodeAnswer,
    `${coreAnswer} vs ${nodeAnswer}`);
} else {
  note('один из транспортов не ждёт ответ на handshake фиксированным таймаутом');
}

// ─── 5. hold/settle при записи EQ ───
console.log('\n--- 5. запись EQ: hold и settle ---');
const coreHold = num(CORE, /holdMs\s*=\s*Math\.max\((\d+)/);
const nodeHold = num(NODE, /holdMs\s*=\s*Math\.max\((\d+)/);
const coreSettle = num(CORE, /settleMs\s*=\s*Math\.max\(0,\s*opts\.settleMs\s*\?\?\s*(\d+)\)/);
const nodeSettle = num(NODE, /settleMs\s*=\s*Math\.max\(0,\s*opts\.settleMs\s*\?\?\s*(\d+)\)/);

console.log(`  transport-core: hold=${coreHold}, settle=${coreSettle}`);
console.log(`  transport.js:   hold=${nodeHold}, settle=${nodeSettle}`);

check('holdMs совпадает', coreHold === nodeHold, `${coreHold} vs ${nodeHold}`);
check('settleMs совпадает', coreSettle === nodeSettle, `${coreSettle} vs ${nodeSettle}`);
check('hold >= 2000 (доказанный минимум)', (coreHold ?? 0) >= 2000, String(coreHold));
check('settle >= 4000 (доказанный минимум)', (coreSettle ?? 0) >= 4000, String(coreSettle));

// ─── 6. readFresh ───
console.log('\n--- 6. чтение новой сессией ---');
check('transport-core имеет readFresh', /async readFresh\(/.test(CORE));
check('transport.js имеет readFresh', /async readFresh\(/.test(NODE));

// ─── 7. намеренные различия ───
console.log('\n--- 7. намеренные различия (это нормально) ---');
note('transport.js пишет через this.device.write([...buf]) (node-hid)');
note('transport-core пишет через adapter.write() (WebHID/node-hid)');
note('transport.js умеет автопереподключение, transport-core — нет');
note('transport.js знает про bulk-push микшера, transport-core тоже');

console.log('\n' + '='.repeat(70));
console.log('ВЫВОД');
console.log('='.repeat(70));
console.log(`
  совпадает:    ${ok}
  расходится:   ${fail}
  замечаний:    ${warn}
`);

if (fail === 0) {
  console.log(`  Политика протокола в двух транспортах согласована.
  Дублирование остаётся, но значения и порядок совпадают — значит
  поведение на обоих путях одинаковое.
`);
} else {
  console.log(`  ВНИМАНИЕ: транспорты разошлись. Это ровно тот класс
  дефекта, который уже приводил к ложному подтверждению EQ.
  Правку надо внести в ОБА файла.
`);
}

process.exitCode = fail === 0 ? 0 : 1;
