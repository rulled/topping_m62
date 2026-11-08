/**
 * ПОДТВЕРЖДЕНИЕ: правка файла применилась к УСТРОЙСТВУ, а не только к UI.
 *
 * Проверяем GAIN=11: в UI (dial), в HID (0x21:0x04), в файле.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
console.log(`файл: GAIN=${ini.Input_IN1?.['GAIN']}, MixA_GAIN=${ini.Mixer_IN12?.MixA_GAIN}`);

// UI: текст рядом с dial GAIN
const RAW = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  if ($e.Current.ClassName -ne "QLabel") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  if ($cx -lt 130 -or $cx -gt 220) { continue }',
  '  if ($cy -lt 640 -or $cy -gt 780) { continue }',
  '  $n = $e.Current.Name',
  '  $res += [pscustomobject]@{ x=$cx; y=$cy; n=$n }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
try {
  const labs = JSON.parse(ps(RAW));
  const ll = Array.isArray(labs) ? labs : [labs];
  console.log('\nподписи/dial значения около GAIN IN1:');
  for (const l of ll.sort((a, b) => a.y - b.y)) console.log(`  (${l.x},${l.y}) "${(l.n || '').replace(/\n/g, '/')}"`);
} catch { console.log('не удалось прочитать подписи'); }

// HID
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
const s = new Map(seen);
cap = s;
dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
await sleep(3000);
cap = null;
dev.close();

console.log(`\nHID 0x21:0x04 = ${s.get(0x2104) ?? '—'}  (ожидаем 11)`);
console.log(`HID параметров: ${s.size}`);
process.exit(0);
