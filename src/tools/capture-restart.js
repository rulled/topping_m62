/**
 * Захват стартовых кадров M Control Center.
 *
 * Гипотеза: при запуске MCC отправляет свой workspace целиком, включая
 * EQ-теги. Значит если перезапустить MCC при работающем слушателе,
 * мы поймаем ВСЁ, что он шлёт, — включая то, чего не видно в UI.
 *
 * Запуск: node src/tools/capture-restart.js
 * Скрипт просит перезапустить MCC и слушает 25 секунд.
 */
import HID from 'node-hid';
import { isIdle, parseReport } from '../protocol.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) {
  console.error('M62 не найден — устройство должно быть подключено');
  process.exit(1);
}
const dev = new HID.HID(vp.path);

const seconds = Number(process.argv[2] ?? 30);
console.log(`слушаю ${seconds} с. Ничего не отправляю.\n`);
console.log('>>> СЕЙЧАС перезапусти M Control Center (закрой и открой заново).');
console.log('>>> Я поймаю всё, что он пришлёт при старте.\n');

const seen = new Map();
const events = [];
const t0 = Date.now();

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const key = `${m.target.toString(16).padStart(2, '0')}:${m.prop.toString(16).padStart(2, '0')}`;
  const prev = seen.get(key);
  seen.set(key, m.value);
  const t = Date.now() - t0;
  if (prev !== m.value) {
    events.push({ t, key, value: m.value, prev: prev ?? null });
    const mark = prev === undefined ? '  <<< ВПЕРВЫЕ' : '';
    console.log(`  +${String(t).padStart(6)} ms  ${key}  ${prev ?? '—'} -> ${m.value}${mark}`);
  }
});

setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log(`ИТОГ: ${events.length} изменений, ${seen.size} уникальных параметров`);
  console.log('='.repeat(60));

  const byKey = new Map();
  for (const e of events) {
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e.value);
  }
  for (const [k, v] of [...byKey.entries()].sort()) {
    const u = [...new Set(v)];
    const meter = u.length > 5 && u.every((x) => x < -100) ? '  (метр)' : '';
    console.log(`  ${k.padEnd(8)} x${String(v.length).padStart(3)}  ${u.slice(0, 10).join(', ')}${u.length > 10 ? '…' : ''}${meter}`);
  }

  const eqTags = ['9b:0f', '9b:0d', '9b:10', '9b:0e', '9b:12', '9b:13', 'ab:0f', 'ab:14'];
  const foundEq = eqTags.filter((t) => seen.has(t));
  console.log(`\nEQ-теги пойманы: ${foundEq.length ? foundEq.join(', ') : 'НЕТ'}`);

  mkdirSync('research/sessions', { recursive: true });
  const f = 'research/sessions/restart-capture.jsonl';
  writeFileSync(f, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`лог: ${f}`);

  try { dev.close(); } catch { /* уже */ }
  process.exit(0);
}, seconds * 1000);
