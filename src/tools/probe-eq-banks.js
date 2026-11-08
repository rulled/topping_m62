/**
 * Проверка: блоки 0x91..0x94 = 4 полосы EQ (по 2 параметра на полосу)?
 *
 * INI даёт 4 полосы на EQ_IN1: Eq%401..Eq%404.
 * HID даёт блок 0x91 с 10 параметрами.
 *
 * 4 полосы × ? = 10. Проверяем структуру.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// попросить MCC загрузить preset -> устройство вернёт полное состояние
const { items } = dumpTree();
const load = items.find((x) => (x.name || '').trim() === 'Load preset1');
if (load) {
  console.log('нажимаю Load preset1 (заставит устройство вернуть полное состояние)');
  await ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${load.i})
$p = $null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
  ([System.Windows.Automation.InvokePattern]$p).Invoke()
}
`);
  await sleep(2500);
}

const found = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = found.find((d) => d.interface === IFACE);
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
await sleep(4000);
cap = null;
dev.close();

console.log('\n=== БЛОКИ EQ В HID ===');
for (const tt of [0x91, 0x92, 0x93, 0x94]) {
  const vals = [];
  for (let pp = 1; pp <= 10; pp++) {
    const k = (tt << 8) | pp;
    vals.push(s.has(k) ? String(s.get(k)) : '—');
  }
  const any = vals.some((v) => v !== '—');
  console.log(`  0x${tt.toString(16)}: ${vals.join(' | ')}${any ? '' : '   (нет)'}`);
}

console.log('\n=== EQ-переключатели ===');
for (const [k, nm] of [[0x9b0f, 'EQ_IN1 switch'], [0x9b10, 'EQ_IN2 switch'], [0x9b0d, 'EQ_IN1 gain'], [0x9b0e, 'EQ_IN2 gain'], [0x9b12, 'EQ_IN1 x'], [0x9b13, 'EQ_IN2 x']]) {
  console.log(`  0x${k.toString(16)}  ${nm.padEnd(16)} = ${s.has(k) ? s.get(k) : '—'}`);
}

console.log('\nвсего параметров:', s.size);
process.exit(0);
