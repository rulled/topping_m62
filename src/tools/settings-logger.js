/**
 * ЛОГГЕР НАСТРОЙКИ УСТРОЙСТВА.
 *
 * ЗАЧЕМ: пользователь сообщает, что "режим зарядки сам по себе меняется".
 * Нужно выявить: кто и когда меняет настройки.
 *
 * КАК: следим за счётчиком 0x11:0x18 (растёт при любом изменении
 * настроек). При изменении читаем все настройки и пишем в лог.
 *
 * Запуск:
 *   node src/tools/settings-logger.js [длительность_сек]
 *
 * Лог: research/settings-log.txt
 */
import HID from 'node-hid';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = String.raw`research\settings-log.txt`;

const DURATION_S = Number(process.argv[2] ?? 3600); // по умолчанию 1 час

/** Интересующие нас настройки. */
const WATCHED = [
  [0x11, 0x04, 'brightness'],
  [0x11, 0x1a, 'bluetooth'],
  [0x11, 0x1b, 'otgPower'],
  [0x11, 0x1c, 'usbCPower'],
  [0x11, 0x1e, 'autoPower'],
  [0x11, 0x22, 'mainButtonSingle'],
  [0x11, 0x23, 'mainButtonDouble'],
  // ВАЖНО (§108): 0x1118 — ЗАРЯД БАТАРЕИ (%), 0x1119 — статус зарядки
  [0x11, 0x18, 'battery'],
  [0x11, 0x19, 'charging'],
  // дополнительные — джеки и служебные
  [0x12, 0x01, 'x1201'],
  [0x12, 0x02, 'x1202'],
  [0x12, 0x03, 'x1203'],
  [0x12, 0x04, 'x1204'],
  [0x12, 0x05, 'x1205'],
  [0x12, 0x06, 'x1206'],
  [0x21, 0x06, 'in1jack'],
  [0x22, 0x06, 'in2jack'],
  [0x25, 0x06, 'btjack'],
  [0x62, 0x06, 'otgoutPresent'],
  [0x64, 0x06, 'hpPresent'],
];

/** Дополнительно логировать изменение батареи каждые N% */
const BATTERY_LOG_STEP = 1;

/** Все известные теги для полного дампа при изменении счётчика. */
const DUMP_ALL = true;

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
if (!found.length) { console.error('M62 не найден'); process.exit(1); }
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);
dev.on('error', (e) => {
  log(`ERROR ${e.message}`);
});

const seen = new Map();
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  seen.set((m.target << 8) | m.prop, m.value);
});

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(line) {
  const s = `[${ts()}] ${line}`;
  console.log(s);
  try {
    if (!existsSync('research')) mkdirSync('research', { recursive: true });
    appendFileSync(LOG, s + '\n', 'utf8');
  } catch { /* */ }
}

/** Прочитать все наблюдаемые настройки через ANNOUNCE. */
async function readAll() {
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(3500);
  const out = {};
  for (const [tt, pp, name] of WATCHED) {
    out[name] = seen.get((tt << 8) | pp);
  }
  return out;
}

console.log(`═══ ЛОГГЕР НАСТРОЕК ═══`);
console.log(`  лог: ${LOG}`);
console.log(`  длительность: ${DURATION_S} с (${(DURATION_S / 60).toFixed(1)} мин)`);
console.log(`  следим: ${WATCHED.map((w) => w[2]).join(', ')}`);
console.log('');

log('=== СТАРТ ЛОГГЕРА ===');

let prev = await readAll();
log(`начальное состояние: ${JSON.stringify(prev)}`);

const t0 = Date.now();
let lastCounter = prev.counter;
let checks = 0;

while (Date.now() - t0 < DURATION_S * 1000) {
  await sleep(5000);
  checks++;

  const cur = await readAll();

  // Сравниваем НЕ счётчик (он оказался счётчиком запусков, §98),
  // а сами настройки — это реальный детектор изменений.
  // Батарея и статус зарядки меняются сами по себе — не считаем их «изменением настроек»,
  // но логируем отдельно как событие батареи (§108).
  const battDiff = [];
  if (String(prev.battery) !== String(cur.battery)) {
    battDiff.push(`battery: ${prev.battery}% -> ${cur.battery}%`);
  }
  if (String(prev.charging) !== String(cur.charging)) {
    battDiff.push(`charging: ${prev.charging} -> ${cur.charging}`);
  }
  if (battDiff.length) {
    log(`БАТАРЕЯ | ${battDiff.join(', ')}` + ` | usbCPower=${cur.usbCPower} otgPower=${cur.otgPower}`);
  }

  const diff = [];
  for (const [, , name] of WATCHED) {
    if (name === 'battery' || name === 'charging') continue;
    if (String(prev[name]) !== String(cur[name])) {
      diff.push(`${name}: ${prev[name]} -> ${cur[name]}`);
    }
  }

  if (diff.length > 0) {
    log(`ИЗМЕНЕНИЕ НАСТРОЕК | ${diff.join(', ')}`);

    // при изменении — дамп всех тегов, чтобы понять контекст
    if (DUMP_ALL) {
      const all = {};
      for (const [k, v] of seen) {
        if (typeof v === 'number' && v < -100) continue; // метры
        all['0x' + k.toString(16)] = v;
      }
      log(`  ДАМП (${Object.keys(all).length} тегов): ${JSON.stringify(all)}`);
    }
  }

  if (checks % 60 === 0) {
    // раз в 5 минут — отметка, что живы
    log(`жив, проверок ${checks}, battery=${cur.battery}% charging=${cur.charging} usbCPower=${cur.usbCPower}`);
  }

  // prev обновляем ВСЕГДА — иначе изменение батареи логируется повторно
  // на каждом тике, пока не случится изменение настройки.
  prev = cur;
  lastCounter = cur.counter;
}

log('=== КОНЕЦ ЛОГГЕРА ===');
dev.close();
process.exit(0);


