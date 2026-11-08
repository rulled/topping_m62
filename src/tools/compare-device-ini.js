/**
 * СВЕРКА УСТРОЙСТВА И INI.
 *
 * Читает полный дамп и сравнивает статические параметры с тем, что
 * записано в workspace-INI. Нужен, чтобы понять, где источник истины
 * сейчас и не осталось ли после опытов расхождений.
 *
 * Ничего не пишем.
 *
 * Запуск: node src/tools/compare-device-ini.js
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId, parseReport, isIdle, PP_HANDSHAKE } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const SNAPSHOT_MS = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readIniSection(name) {
  const txt = readFileSync(INI, 'utf8');
  const out = {};
  let inSec = false;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) {
      inSec = t === `[${name}]`;
      continue;
    }
    if (!inSec || !t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const dev = all.find((d) => d.interface === 4);
if (!dev) {
  console.error('M62 iface 4 не найден');
  process.exit(1);
}

async function main() {
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(350);
  send(0x11, 0x24, 1);
  await sleep(150);
  send(0x11, 0x26, 1);

  const st = new Map();
  const t0 = Date.now();
  let lastKeep = Date.now();
  while (Date.now() - t0 < SNAPSHOT_MS) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      st.set(`${f.target.toString(16).padStart(2, '0')}:${f.prop.toString(16).padStart(2, '0')}`, f.value);
    }
    if (Date.now() - lastKeep >= 2000) {
      send(0x11, 0x24, 1);
      lastKeep = Date.now();
    }
    await sleep(8);
  }
  try { h.close(); } catch { /* ok */ }

  const comp = readIniSection('Compressor');
  const eq1 = readIniSection('EQ_IN1');
  const in1 = readIniSection('Input_IN1');

  console.log('=== КОМПРЕССОР ===');
  const rows = [
    ['0x46:01', 'Switch', st.get('46:01')],
    ['0x46:02', 'Threshold', st.get('46:02')],
    ['0x46:03', 'Ratio x10', st.get('46:03')],
    ['0x46:04', 'Attack', st.get('46:04')],
    ['0x46:05', 'Release', st.get('46:05')],
    ['0x46:06', 'Gain', st.get('46:06')],
    ['0x46:07', 'Mix x?', st.get('46:07')],
    ['0x46:08', 'Mix', st.get('46:08')],
  ];
  console.log('  тег      параметр     устройство   INI');
  for (const [tag, name, val] of rows) {
    const iniVal = comp[name.split(' ')[0]] ?? '';
    console.log(`  ${tag}  ${name.padEnd(12)} ${String(val).padEnd(12)} ${iniVal}`);
  }

  console.log('\n=== EQ (0x91, полоса 1) ===');
  console.log(`  устройство: [${[1, 2, 3, 4, 5].map((p) => st.get(`91:0${p}`)).join(', ')}]`);
  console.log(`  INI Eq%401: ${eq1['Eq%401']}`);
  console.log(`  INI Eq%402: ${eq1['Eq%402']}`);

  console.log('\n=== ВХОД IN1 ===');
  console.log(`  устройство 0x21:04 = ${st.get('21:04')}`);
  console.log(`  INI GAIN = ${in1.GAIN}`);
  console.log(`  INI MUTE = ${in1.MUTE}`);

  console.log('\n=== ДЖЕКИ ===');
  console.log(`  HP 0x64:06 = ${st.get('64:06')}`);
  console.log(`  OTG 0x62:06 = ${st.get('62:06')}`);
  console.log(`  IN1 0x21:06 = ${st.get('21:06')}`);

  console.log('\n=== ПОЛНОТА ДАМПА ===');
  console.log(`  адресов: ${st.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
