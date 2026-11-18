/**
 * РЕШАЮЩИЙ ТЕСТ: меняем слайдер и сравниваем состояние ДО/ПОСЛЕ через ANNOUNCE.
 *
 * Микшер и селекторы не имеют физической ручки, поэтому устройство может
 * не присылать о них события. Но если оно вообще знает значение, то
 * ANNOUNCE (TT=0x11, PP=0x26) его отдаст.
 *
 * Логика:
 *   1) ANNOUNCE -> собрать состояние S1
 *   2) подвинуть слайдер через UI Automation
 *   3) ANNOUNCE -> собрать состояние S2
 *   4) diff(S1, S2) = тег, который отвечает за этот слайдер
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const VID = 0x152a, PID = 0x875c, IFACE = 4;
const PS_EXE = 'powershell.exe';

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; }

const sliderIdx = Number(arg('slider', '146'));
const target = Number(arg('value', '6'));
const settle = Number(arg('settle', '1500'));

const SET_PS = (idx, val) => String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e = $all.Item(${idx})
$pat = $null
if (-not $e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) { Write-Output "NOPATTERN"; exit 1 }
$rv = [System.Windows.Automation.RangeValuePattern]$pat
$rv.SetValue(${val})
Write-Output ("SET->" + $rv.Current.Value)
`;

const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === IFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let capture = null;
const latest = new Map();

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const msg = parseReport(b);
  if (!msg) return;
  const key = `${msg.target.toString(16).padStart(2, '0')}:${msg.prop.toString(16).padStart(2, '0')}`;
  latest.set(key, msg.value);
  if (capture) capture.set(key, msg.value);
});

async function announce(label) {
  const snap = new Map(latest);     // начинаем с уже известного
  capture = snap;
  const frame = withReportId(buildFrame(0x11, 0x26, 1, true));
  dev.write([...frame]);
  await sleep(2500);
  capture = null;
  console.log(`  ${label}: собрано ${snap.size} параметров`);
  return snap;
}

const run = async () => {
  console.log(`слайдер idx=${sliderIdx} -> значение ${target}\n`);

  console.log('1) состояние ДО');
  const s1 = await announce('ДО');

  console.log(`2) двигаю слайдер ${sliderIdx} -> ${target}`);
  try {
    const out = execFileSync(PS_EXE, ['-NoProfile', '-Command', SET_PS(sliderIdx, target)], { encoding: 'utf8' });
    console.log('   ' + out.trim());
  } catch (e) {
    console.log('   ошибка: ' + (e.message ?? e));
  }
  await sleep(settle);

  console.log('3) состояние ПОСЛЕ');
  const s2 = await announce('ПОСЛЕ');

  console.log('\n' + '='.repeat(60));
  console.log('DIFF: что изменилось');
  console.log('='.repeat(60));
  const keys = new Set([...s1.keys(), ...s2.keys()]);
  let found = 0;
  for (const k of [...keys].sort()) {
    const a = s1.get(k), b = s2.get(k);
    if (a === b) continue;
    // метры шумят — пропускаем
    const meterish = typeof a === 'number' && typeof b === 'number' && a < -100 && b < -100;
    const mark = meterish ? '  (шум метра)' : '   <<< РЕАКЦИЯ';
    console.log(`  ${k.padEnd(8)} ${String(a).padStart(6)} -> ${String(b).padStart(6)}${mark}`);
    if (!meterish) found++;
  }
  if (!found) {
    console.log('  НЕТ РЕАКЦИИ: устройство не сообщает этот параметр ни событиями, ни в ANNOUNCE');
  }

  mkdirSync('research/sessions', { recursive: true });
  const f = `research/sessions/announce-diff-${sliderIdx}.json`;
  writeFileSync(f, JSON.stringify({
    slider: sliderIdx, target,
    before: Object.fromEntries(s1), after: Object.fromEntries(s2),
  }, null, 2));
  console.log(`\nснимки: ${f}`);
  try { dev.close(); } catch { /* уже */ }
  process.exit(0);
};

run();
