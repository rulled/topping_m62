/**
 * ПАССИВНЫЙ слушатель HID interface 4 — НИЧЕГО НЕ ОТПРАВЛЯЕТ.
 *
 * Назначение: слушать поток, который идёт, пока M Control Center работает
 * и сам держит подписку. Мы не подписываемся, не шлём keepalive,
 * не меняем состояние устройства. Только read.
 *
 * Это ключевой инструмент для съёма данных: крутит ручки пользователь
 * в штатном приложении, а мы фиксируем, какие TT/PP при этом меняются.
 *
 * Использование:
 *   node src/tools/listen.js [секунды] [файл.jsonl]
 */
import HID from 'node-hid';
import { writeFileSync } from 'node:fs';

const VID = 0x152a;
const PID = 0x875c;
const VENDOR_INTERFACE = 4;

const seconds = Number(process.argv[2] ?? 60);
const outFile = process.argv[3] ?? 'research/capture.jsonl';

function findPath() {
  const all = HID.devices().filter(
    (d) => d.vendorId === VID && d.productId === PID,
  );
  if (!all.length) return null;
  const v = all.find((d) => d.interface === VENDOR_INTERFACE);
  return (v ?? all[0]).path;
}

const path = findPath();
if (!path) {
  console.error('M62 не найден');
  process.exit(1);
}
console.log('открываю (только чтение):', path);

let dev;
try {
  dev = new HID.HID(path);
} catch (err) {
  console.error('не удалось открыть:', err.message);
  console.error('возможно, M Control Center держит устройство монопольно');
  process.exit(2);
}

const seen = new Map(); // "TT:PP" -> последнее значение
const changes = [];      // только изменения — это и есть «что крутили»
const lines = [];
let reads = 0;
let idle = 0;
let parseErr = 0;

const t0 = Date.now();
const timer = setInterval(() => {
  if (Date.now() - t0 > seconds * 1000) stop();
}, 250);

function stop() {
  clearInterval(timer);
  try { dev.close(); } catch { /* уже закрыто */ }

  console.log('\n=== ИТОГ ===');
  console.log(`время: ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  console.log(`чтений: ${reads}, холостых: ${idle}, ошибок разбора: ${parseErr}`);
  console.log(`уникальных TT/PP: ${seen.size}, изменений: ${changes.length}`);

  console.log('\n--- параметры, которые МЕНЯЛИСЬ (это и есть след действий) ---');
  const byKey = new Map();
  for (const c of changes) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c.value);
  }
  for (const [key, vals] of [...byKey.entries()].sort()) {
    const uniq = [...new Set(vals)];
    console.log(
      `  ${key.padEnd(8)} изменений ${String(vals.length).padStart(4)}` +
      `  значений: ${uniq.slice(0, 12).join(', ')}${uniq.length > 12 ? '…' : ''}`,
    );
  }

  writeFileSync(
    outFile,
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8',
  );
  console.log(`\nсырой лог: ${outFile} (${lines.length} записей)`);
  process.exit(0);
}

dev.on('data', (buf) => {
  reads++;
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);

  // Отчёт: 1 байт report id + 15 кадр (+ pad). Ищем 22 33 ... 66 77.
  let off = -1;
  for (let i = 0; i + 15 <= b.length; i++) {
    if (b[i] === 0x22 && b[i + 1] === 0x33 && b[i + 13] === 0x66 && b[i + 14] === 0x77) {
      off = i;
      break;
    }
  }
  if (off < 0) {
    // холостой (16 нулей) или мусор
    let allZero = true;
    for (const x of b) if (x !== 0) { allZero = false; break; }
    if (allZero) idle++; else parseErr++;
    return;
  }

  const target = b[off + 5];
  const prop = b[off + 6];
  const value =
    (b[off + 7] << 24) | (b[off + 8] << 16) | (b[off + 9] << 8) | b[off + 10];
  const key = `${target.toString(16).padStart(2, '0')}:${prop.toString(16).padStart(2, '0')}`;
  const prev = seen.get(key);
  const changed = prev !== value;
  seen.set(key, value);

  const rec = {
    t: Date.now() - t0,
    tt: target,
    pp: prop,
    value,
    changed,
    prev: prev ?? null,
  };
  lines.push(rec);

  if (changed) {
    changes.push({ key, value });
    console.log(
      `  +${String(rec.t).padStart(6)} ms  ${key}  ${prev ?? '—'} -> ${value}`,
    );
  }
});

dev.on('error', (err) => {
  console.error('ошибка HID:', err.message);
  stop();
});

console.log(`слушаю ${seconds} с — НИЧЕГО не отправляю.`);
console.log('крути ручки в M Control Center, я фиксирую.\n');
