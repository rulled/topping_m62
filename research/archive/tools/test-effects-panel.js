/**
 * ГИПОТЕЗА: компрессор (0x46) и ducking (0x43) приходят только
 * когда MCC их запрашивает — например, при открытии панели эффектов.
 *
 * Проверяем: открываем панель эффектов в MCC и смотрим, появятся ли теги.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

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

async function snap(ms = 2500) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const before = await snap();
console.log(`ДО: ${before.size} параметров`);
const f = (s, tt) => [...s.keys()].filter((k) => k >> 8 === tt).length;
console.log(`  0x43 ducking: ${f(before, 0x43)}, 0x46 компрессор: ${f(before, 0x46)}`);

// открыть панель эффектов (MORE)
const { items } = dumpTree();
const more = items.find((x) => (x.name || '').trim() === 'MORE');
if (more) {
  console.log(`\nнажимаю MORE [${more.i}] (панель эффектов)`);
  console.log('  ' + (await invoke(more.i)));
  await sleep(2500);
} else {
  console.log('\nMORE не найдена');
}

const after = await snap();
console.log(`\nПОСЛЕ: ${after.size} параметров`);
console.log(`  0x43 ducking: ${f(after, 0x43)}, 0x46 компрессор: ${f(after, 0x46)}`);

const newKeys = [...after.keys()].filter((k) => !before.has(k));
if (newKeys.length) {
  console.log('\nновые теги:');
  for (const k of newKeys.sort((a, b) => a - b)) {
    console.log(`  0x${k.toString(16).padStart(4, '0')} = ${after.get(k)}`);
  }
}

dev.close();
process.exit(0);
