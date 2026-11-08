/**
 * ЧТО ПРОИСХОДИТ С 0x1118 / 0x1119 ПРИ ПЕРЕЗАПУСКЕ MCC?
 *
 * Из лога §105: в 12:41:24 x1119 стал 1, а 0x1118 упал с 99 до 93
 * без действий пользователя. Возможно — перезапуск MCC от тестов.
 *
 * Записываем значения ДО и ПОСЛЕ перезапуска MCC.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

async function readTags() {
  const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
  if (!found.length) return null;
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
  await sleep(4500);
  const r = {
    x1118: seen.get(0x1118),
    x1119: seen.get(0x1119),
    x1104: seen.get(0x1104),
    x111c: seen.get(0x111c),
    x111b: seen.get(0x111b),
    x111a: seen.get(0x111a),
    x111e: seen.get(0x111e),
    x1122: seen.get(0x1122),
    x1123: seen.get(0x1123),
    x1125: seen.get(0x1125),
    x1101: seen.get(0x1101),
  };
  try { dev.close(); } catch { /* */ }
  return r;
}

console.log('=== 1. ДО перезапуска MCC ===');
const before = await readTags();
console.log(' ', JSON.stringify(before));

console.log('\n=== 2. перезапускаю MCC ===');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(6000);
ps('Start-Process "C:\\Program Files\\TOPPING PRO\\M Control Center\\M Control Center.exe"');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(18000);

console.log('\n=== 3. ПОСЛЕ перезапуска ===');
const after = await readTags();
console.log(' ', JSON.stringify(after));

console.log('\n=== 4. ЧТО ИЗМЕНИЛОСЬ ===');
for (const k of Object.keys(before ?? {})) {
  if (String(before[k]) !== String(after?.[k])) {
    console.log(`  ${k}: ${before[k]} -> ${after?.[k]}`);
  }
}
console.log('\n  (если 0x1118 упал — это счётчик, не зависящий от настроек)');
