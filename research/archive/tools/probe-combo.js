/**
 * ПРОВЕРКА ВАРИАНТОВ НАСТРОЕК: меняем выбранный пункт в ComboBox MCC
 * и смотрим, что изменилось на устройстве.
 *
 * Запуск:
 *   node src/tools/probe-combo.js --idx 50 --label "MainButtonSingle"
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const idx = Number(arg('idx', '-1'));
const label = arg('label', 'combo');
if (idx < 0) { console.error('укажи --idx'); process.exit(1); }

// --- HID ---
const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const latest = new Map();
let capture = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  latest.set(k, m.value);
  if (capture) capture.set(k, m.value);
});

async function snap(ms = 2200) {
  const s = new Map(latest);
  capture = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  capture = null;
  return s;
}

console.log(`ПРОВЕРКА КОМБОБОКСА: ${label} (idx=${idx})\n`);

// текущее значение
const before0 = await snap();
const { items } = dumpTree();
const me = items.find((x) => x.i === idx);
console.log(`элемент: ${me ? me.cls + ' ' + me.name : '?'}`);

// раскрыть и выбрать следующий пункт
const STEP = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$e = $all.Item(${idx})
$pat = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) {
  Write-Output "NOEXPAND"; exit 1
}
$ec = [System.Windows.Automation.ExpandCollapsePattern]$pat
$ec.Expand()
Start-Sleep -Milliseconds 600
$names = @()
$all2 = Get-MccAll $root
for ($j=0; $j -lt $all2.Count; $j++) {
  $q = $all2.Item($j)
  if ($q.Current.ClassName -ne 'QListWidget') { continue }
  $kids = $q.FindAll([System.Windows.Automation.TreeScope]::Children,
                      [System.Windows.Automation.Condition]::TrueCondition)
  if ($kids.Count -gt 0) {
    for ($k=0; $k -lt $kids.Count; $k++) {
      $nm = $kids.Item($k).Current.Name
      if ($nm) { $names += $nm.Trim() }
    }
    # выбрать ВТОРОЙ пункт
    if ($kids.Count -ge 2) {
      $si = $null
      if ($kids.Item(1).TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$si)) {
        ([System.Windows.Automation.SelectionItemPattern]$si).Select()
        Write-Output ("SELECTED=" + $kids.Item(1).Current.Name)
      } else {
        Write-Output "NOSEL"
      }
    }
    break
  }
}
Write-Output ("ITEMS=" + ($names -join ' | '))
$ec.Collapse()
`);

console.log('шаг: ' + STEP.replace(/\r?\n/g, ' ; '));

await sleep(1800);
const after0 = await snap();

const hexTag = (k) => '0x' + k.toString(16).padStart(4, '0');
console.log('\n=== ИЗМЕНЕНИЯ ===');
let n = 0;
for (const k of new Set([...before0.keys(), ...after0.keys()])) {
  const a = before0.get(k), b = after0.get(k);
  if (a === b) continue;
  const isMeter = typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100;
  if (isMeter) continue;
  console.log(`  ${hexTag(k)}  ${a} -> ${b}   <<<`);
  n++;
}
if (!n) console.log('  (нет изменений кроме метров)');

dev.close();
process.exit(0);
