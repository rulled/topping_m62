/**
 * АКТИВНЫЙ СЕАНС: двигаем слайдеры в M Control Center и слушаем HID.
 *
 * Пишет в устройство M Control Center — не мы. Мы:
 *   1) двигаем слайдер через UI Automation (это действие пользователя, не протокол);
 *   2) слушаем HID параллельно и фиксируем, какие TT/PP изменились.
 *
 * Так мы узнаём ТОЧНУЮ привязку: слайдер X -> тег Y, и заодно диапазоны.
 *
 * Запуск:
 *   node src/tools/probe-slider.js --slider 232 --values "-90,-60,-30,0,12"
 *   node src/tools/probe-slider.js --list
 */
import HID from 'node-hid';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VID = 0x152a, PID = 0x875c, VENDOR_INTERFACE = 4;

// В PATH этой машины только Windows PowerShell 5.1 — pwsh нет.
const PS_EXE = 'powershell.exe';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const PS = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i); $pat=$null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pat)) {
    if ($e.Current.ClassName -ne 'QSlider') { continue }
    $rv = [System.Windows.Automation.RangeValuePattern]$pat
    $r = $e.Current.BoundingRectangle
    $out += [pscustomobject]@{idx=$i; val=$rv.Current.Value; min=$rv.Current.Minimum; max=$rv.Current.Maximum; x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2)}
  }
}
$out | ConvertTo-Json -Compress
`;

function listSliders() {
  const raw = execFileSync(PS_EXE, ['-NoProfile', '-Command', PS], { encoding: 'utf8' });
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : [j];
}

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
Write-Output ("SET " + $rv.Current.Value)
`;

if (args.includes('--list')) {
  const s = listSliders();
  console.log('слайдеры:');
  for (const x of s) {
    console.log(`  idx=${x.idx}  val=${x.val}  range=${x.min}..${x.max}  at (${x.x},${x.y})`);
  }
  process.exit(0);
}

const sliderIdx = Number(arg('slider', '232'));
const values = arg('values', '-90,-60,-30,0,12').split(',').map(Number);
const settle = Number(arg('settle', 1200));

// --- HID слушатель ---
const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
const vp = all.find((d) => d.interface === VENDOR_INTERFACE);
if (!vp) { console.error('M62 не найден'); process.exit(1); }
const dev = new HID.HID(vp.path);

const seen = new Map();
let phase = 'init';
const perPhase = [];   // {phase, key, value, t}
const t0 = Date.now();

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  let off = -1;
  for (let i = 0; i + 15 <= b.length; i++) {
    if (b[i] === 0x22 && b[i + 1] === 0x33 && b[i + 13] === 0x66 && b[i + 14] === 0x77) { off = i; break; }
  }
  if (off < 0) return;
  const tt = b[off + 5], pp = b[off + 6];
  const value = (b[off + 7] << 24) | (b[off + 8] << 16) | (b[off + 9] << 8) | b[off + 10];
  const key = `${tt.toString(16).padStart(2, '0')}:${pp.toString(16).padStart(2, '0')}`;
  const prev = seen.get(key);
  if (prev === value) return;
  seen.set(key, value);
  perPhase.push({ phase, key, value, prev: prev ?? null, t: Date.now() - t0 });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  console.log(`слайдер idx=${sliderIdx}, значения: ${values.join(', ')}`);
  const before = listSliders().find((s) => s.idx === sliderIdx);
  console.log(`было: ${before?.val}  диапазон ${before?.min}..${before?.max}\n`);

  // базовая линия
  phase = 'baseline';
  await sleep(settle);

  for (const v of values) {
    phase = `set=${v}`;
    console.log(`--> ставлю ${v}`);
    try {
      const out = execFileSync(PS_EXE, ['-NoProfile', '-Command', SET_PS(sliderIdx, v)], { encoding: 'utf8' });
      console.log('    ' + out.trim());
    } catch (err) {
      console.log('    ошибка: ' + (err.message ?? err));
    }
    await sleep(settle);
  }

  phase = 'end';
  await sleep(settle);

  // --- отчёт ---
  console.log('\n' + '='.repeat(60));
  console.log('ИТОГ: что изменилось на каждом шаге');
  console.log('='.repeat(60));
  const steps = ['baseline', ...values.map((v) => `set=${v}`), 'end'];
  for (const s of steps) {
    const items = perPhase.filter((x) => x.phase === s);
    const keys = [...new Set(items.map((x) => x.key))].sort();
    console.log(`\n[${s}]  изменений ${items.length}`);
    for (const k of keys) {
      const vals = items.filter((x) => x.key === k).map((x) => x.value);
      const u = [...new Set(vals)];
      // метры шумят — помечаем
      const mtr = u.length > 3 && u.every((x) => x < -100) ? '  (похоже на метр)' : '';
      console.log(`   ${k.padEnd(8)} x${String(vals.length).padStart(3)}  ${u.slice(0, 8).join(', ')}${u.length > 8 ? '…' : ''}${mtr}`);
    }
  }

  mkdirSync('research/sessions', { recursive: true });
  const f = `research/sessions/slider-${sliderIdx}.jsonl`;
  writeFileSync(f, perPhase.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nлог: ${f}`);
  try { dev.close(); } catch { /* уже */ }
  process.exit(0);
};

run();

