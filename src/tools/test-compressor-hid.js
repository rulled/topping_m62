/**
 * ГИПОТЕЗА: компрессор пишется через HID (0x46), а не через файл.
 *
 * В HID есть теги 0x46:0x01..0x08 для компрессора.
 * Проверяем: отправим кадр с новым Threshold и посмотрим результат.
 *
 * ВНИМАНИЕ: это ЗАПИСЬ В УСТРОЙСТВО напрямую. Пользователь разрешил
 * менять настройки через MCC; прямая запись в HID — тот же протокол,
 * которым пишет MCC. Проверяем на безопасном параметре.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMP = { switch: 0x01, threshold: 0x02, ratio: 0x03, attack: 0x04, release: 0x05, gain: 0x06, gainAuto: 0x07, mix: 0x08 };

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
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

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const ws0 = findActiveWorkspace();
const ini0 = readWorkspace(ws0.path);
console.log('файл ДО:', JSON.stringify({
  thr: ini0.Compressor?.Threshold, ratio: ini0.Compressor?.Ratio, att: ini0.Compressor?.Attack,
}));

console.log('\nчитаю HID...');
let s = await snap();
console.log(`  0x46: 01=${s.get(0x4601) ?? '—'} 02=${s.get(0x4602) ?? '—'} 03=${s.get(0x4603) ?? '—'} 04=${s.get(0x4604) ?? '—'} 05=${s.get(0x4605) ?? '—'} 08=${s.get(0x4608) ?? '—'}`);

// пробуем записать Threshold = -12 через HID
console.log('\nотправляю 0x46:0x02 (Threshold) = -12 через HID...');
dev.write([...withReportId(buildFrame(0x46, COMP.threshold, -12, true))]);
await sleep(2000);

s = await snap();
console.log(`  после: 0x46:0x02 = ${s.get(0x4602) ?? '—'}`);

const ini1 = readWorkspace(ws0.path);
console.log(`  файл: Threshold = ${ini1.Compressor?.Threshold}`);

const hidOk = s.get(0x4602) === -12;
const fileOk = Number(ini1.Compressor?.Threshold) === -12;
console.log(`\n  HID принял: ${hidOk ? 'ДА' : 'нет'}`);
console.log(`  файл обновился: ${fileOk ? 'ДА' : 'нет'}`);

dev.close();
process.exit(0);
