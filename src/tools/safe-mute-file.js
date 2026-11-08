/**
 * ЗАГЛУШИТЬ ВЫХОДЫ через файл + перезапуск MCC.
 *
 * Проверено ранее: Output_HP.MUTE=true в файле + рестарт MCC
 * даёт HP mute = 1 в HID. Через прямой HID-тег 0x64:0x06 не пишется.
 */
import { execFileSync } from 'node:child_process';
import { findActiveWorkspace, readWorkspace, writeWorkspace } from '../workspace.js';
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

async function checkMute() {
  const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
  if (!found.length) return { hp: null, otg: null };
  const vp = found.find((d) => d.interface === 4);
  const dev = new HID.HID(vp.path);
  const seen = new Map();
  dev.on('data', (buf) => {
    const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (isIdle(b)) return;
    const m = parseReport(b);
    if (!m) return;
    seen.set((m.target << 8) | m.prop, m.value);
  });
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(4000);
  const r = { hp: seen.get(0x6406), otg: seen.get(0x6206) };
  try { dev.close(); } catch { /* */ }
  return r;
}

console.log('=== 1. останавливаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);

console.log('=== 2. ставлю MUTE в файле ===');
const w = findActiveWorkspace();
const ini = readWorkspace(w.path);
ini.Output_HP.MUTE = 'true';
ini.Output_OTGOUT.MUTE = 'true';
// одновременно ВЫКЛЮЧАЮ EQ, чтобы точно не было обработки
ini.EQ_IN1.Switch = '0';
ini.EQ_IN2.Switch = '0';
writeWorkspace(w.path, ini);
console.log('  HP.MUTE=true, OTG.MUTE=true, EQ switch=0');

console.log('=== 3. запускаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(18000);

console.log('=== 4. проверяю HID ===');
const m = await checkMute();
console.log(`  HP mute  = ${m.hp}  ${m.hp === 1 ? '✓ ЗАГЛУШЕН' : '⚠'}`);
console.log(`  OTG mute = ${m.otg}  ${m.otg === 1 ? '✓ ЗАГЛУШЕН' : '⚠'}`);

const chk = readWorkspace(findActiveWorkspace().path);
console.log(`\n  файл: EQ_IN1.Switch=${chk.EQ_IN1?.Switch}, EQ_IN2.Switch=${chk.EQ_IN2?.Switch}`);
console.log(`  HP.MUTE=${chk.Output_HP?.MUTE}, OTG.MUTE=${chk.Output_OTGOUT?.MUTE}`);

process.exit(m.hp === 1 ? 0 : 1);
