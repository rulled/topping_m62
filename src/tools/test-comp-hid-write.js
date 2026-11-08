/**
 * Проверка: пишется ли компрессор (0x46) через HID.
 *
 * ПРЕДЫСТОРИЯ: перебор `probe-mixer-write.js` слал SAFE_VALUE=-90
 * в теги 0x41..0x48. В INI оказалось Attack=-90, Threshold=-90 —
 * значит запись в 0x46 ПРОШЛА, хотя `probe-hid-write-matrix.js`
 * показывал «не принято» (он проверял через fullState, а состояние
 * применяется отложенно).
 *
 * Здесь: пишем валидные значения, ждём, читаем ИЗ ФАЙЛА (это
 * единственный надёжный источник для компрессора).
 *
 * БЕЗОПАСНОСТЬ: компрессор ВЫКЛЮЧЕН (Switch=false), выходы не
 * подключены. Пишем только безопасные значения в допустимых диапазонах.
 *
 * Запуск: node src/tools/test-comp-hid-write.js
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;

const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Читает секцию [Compressor] из INI. */
function readCompressorFromIni() {
  try {
    const txt = readFileSync(INI, 'utf8');
    const out = {};
    let inSection = false;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) {
        inSection = t === '[Compressor]';
        continue;
      }
      if (!inSection || !t || t.startsWith(';')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  } catch (err) {
    return { error: err.message };
  }
}

const show = (label, c) => {
  console.log(
    `  ${label.padEnd(14)} Thr=${c.Threshold} Ratio=${c.Ratio} Atk=${c.Attack} Rel=${c.Release} Gain=${c.Gain} Mix=${c.Mix} Sw=${c.Compressor}`,
  );
};

const main = async () => {
  const before = readCompressorFromIni();
  show('INI до:', before);

  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 iface 4 не найден');
    process.exit(1);
  }

  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) =>
    h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  const keepalive = setInterval(() => {
    try { write(0x11, 0x24, 1); } catch { /* ok */ }
  }, 2000);

  write(0x11, 0x24, 1);
  await sleep(300);

  // Валидные значения (исходные, которые были до моих тестов).
  const targets = [
    { prop: 0x02, label: 'Threshold', value: -28 },
    { prop: 0x03, label: 'Ratio', value: 40 },     // HID = ratio*10
    { prop: 0x04, label: 'Attack', value: 5 },
    { prop: 0x05, label: 'Release', value: 200 },
    { prop: 0x06, label: 'Gain', value: 10 },
    { prop: 0x08, label: 'Mix', value: 100 },
  ];

  console.log('\n=== пишем валидные значения через HID 0x46 ===');
  for (const t of targets) {
    write(0x46, t.prop, t.value);
    console.log(`  ${t.label} -> ${t.value}`);
    await sleep(250);
  }

  // Команда «зафиксировать» — Load preset заставит MCC переписать файл.
  console.log('\n  ждём применения (файл пишет MCC)...');
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const now = readCompressorFromIni();
    if (now.Attack === '5' || now.Threshold === '-28') {
      show(`через ${(i + 1) * 1.5}с:`, now);
      break;
    }
    if (i === 9) show('через 15с:', now);
  }

  clearInterval(keepalive);
  const after = readCompressorFromIni();
  show('INI после:', after);

  const ok =
    after.Attack === '5' &&
    after.Threshold === '-28' &&
    after.Mix === '100';
  console.log(`\n  ИТОГ: HID-запись компрессора ${ok ? 'РАБОТАЕТ' : 'не подтверждена'}`);
  h.close();
};

main().catch((err) => {
  console.error('ошибка:', err.message);
  process.exit(1);
});
