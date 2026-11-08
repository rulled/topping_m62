/**
 * СВЕРКА ШКАЛ КОМПРЕССОРА: HID против файла.
 *
 * Обнаружено: 0x4603 = 40, а файл Ratio = 4. Проверяем все поля.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

// Load preset чтобы получить теги
console.log('Load preset1...');
dev.write([...withReportId(buildFrame(0x11, 0x0e, 1, true))]);
await sleep(5000);

cap = seen;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3000);
cap = null;
dev.close();

const ws = findActiveWorkspace();
const f = readWorkspace(ws.path).Compressor;

const ROWS = [
  ['Switch', f.Switch, seen.get(0x4601)],
  ['Threshold', f.Threshold, seen.get(0x4602)],
  ['Ratio', f.Ratio, seen.get(0x4603)],
  ['Attack', f.Attack, seen.get(0x4604)],
  ['Release', f.Release, seen.get(0x4605)],
  ['Gain', f.Gain, seen.get(0x4606)],
  ['GainAuto', f.GainAuto, seen.get(0x4607)],
  ['Mix', f.Mix, seen.get(0x4608)],
];

console.log('\n=== КОМПРЕССОР: файл против HID ===\n');
console.log('параметр      файл        HID         отношение');
console.log('-'.repeat(55));
for (const [name, fv, hv] of ROWS) {
  const fn = Number(fv);
  let rel = '';
  if (!isNaN(fn) && typeof hv === 'number' && fn !== 0) {
    const r = hv / fn;
    if (r !== 1) rel = `HID = файл × ${r}`;
    else rel = 'равны';
  } else if (String(fv) === String(hv)) {
    rel = 'равны';
  }
  console.log(`${name.padEnd(12)} ${String(fv).padStart(8)} ${String(hv ?? '—').padStart(10)}   ${rel}`);
}

console.log('\n=== ВЫВОД ===');
console.log('Если HID = файл × 10 для Ratio — это другая шкала (проценты vs единицы).');
process.exit(0);
