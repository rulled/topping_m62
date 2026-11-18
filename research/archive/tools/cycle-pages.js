/**
 * Перелистывание страниц эффектов ТОЛЬКО через UIA (без мыши),
 * чтобы не сдвигать окно. Печатает заголовок и содержимое каждой страницы.
 */
import { execFileSync } from 'node:child_process';

const PS_EXE = 'powershell.exe';

function ps(cmd) {
  return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

// Состояние: заголовок + индексы стрелок + подписи панели
const STATE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

$title=''; $ti=-1
for ($i=0; $i -lt $all.Count; $i++) {
  $e=$all.Item($i)
  if ($e.Current.ClassName -ne 'QLabel') { continue }
  $n=$e.Current.Name
  if ($n -match '^(COMP|EQ|NC|DUCK|EXP)') { $title=$n; $ti=$i; break }
}
Write-Output ("TITLE=" + $title + ";TI=" + $ti)
if ($ti -lt 0) { exit 0 }

$tr = $all.Item($ti).Current.BoundingRectangle
$ty = $tr.Y + $tr.Height/2
$ln=-1; $rn=-1; $lx=0; $rx=0
for ($i=0; $i -lt $all.Count; $i++) {
  $e=$all.Item($i)
  if ($e.Current.ClassName -ne 'QPushButton') { continue }
  $r=$e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  if ([Math]::Abs(($r.Y+$r.Height/2) - $ty) -gt 14) { continue }
  $cx=$r.X+$r.Width/2
  if ($cx -lt $tr.X) { if ($ln -lt 0 -or $cx -gt $lx) { $ln=$i; $lx=$cx } }
  if ($cx -gt ($tr.X+$tr.Width)) { if ($rn -lt 0 -or $cx -lt $rx) { $rn=$i; $rx=$cx } }
}
Write-Output ("L=" + $ln + ";R=" + $rn)

$labs=@()
for ($i=0; $i -lt $all.Count; $i++) {
  $e=$all.Item($i)
  if ($e.Current.ClassName -ne 'QLabel') { continue }
  $n=$e.Current.Name
  if (-not $n -or -not $n.Trim()) { continue }
  $r=$e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cx=$r.X+$r.Width/2
  if ($cx -gt 250 -and $cx -lt 1450 -and $n.Length -lt 40) { $labs += $n }
}
Write-Output ("LABELS=" + ($labs -join ", "))
`;

const CLICK = (idx) => String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$e=$all.Item(${idx})
$pat=$null
if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pat)) {
  ([System.Windows.Automation.InvokePattern]$pat).Invoke()
  Write-Output "OK"
} else { Write-Output "NOINVOKE" }
`;

function parse(s) {
  const out = {};
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^([A-Z]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  const kv = {};
  for (const part of (out.TITLE ?? '').split(';')) {
    const [k, v] = part.split('=');
    if (k) kv[k] = v;
  }
  for (const k of ['L', 'R']) {
    const m = (s.match(new RegExp(`(?:^|\\n)${k}=(-?\\d+)`)) ?? [])[1];
    kv[k] = m !== undefined ? Number(m) : -1;
  }
  kv.LABELS = out.LABELS ?? '';
  return kv;
}

const seen = [];
let st = parse(ps(STATE));
console.log(`старт: страница "${st.TITLE}" (L=${st.L} R=${st.R})`);
console.log(`  ${st.LABELS}\n`);
seen.push(st.TITLE);

for (let step = 1; step <= 6; step++) {
  if (st.R < 0) { console.log('правая стрелка не найдена'); break; }
  ps(CLICK(st.R));
  await new Promise((r) => setTimeout(r, 800));
  st = parse(ps(STATE));
  const isNew = !seen.includes(st.TITLE);
  console.log(`шаг ${step}: страница "${st.TITLE}"${isNew ? '  [НОВАЯ]' : ''}`);
  console.log(`  ${st.LABELS}`);
  if (!isNew && step > 1) { console.log('  (цикл замкнулся)'); break; }
  seen.push(st.TITLE);
  console.log();
}

console.log(`\nвсего страниц пройдено: ${seen.length} — ${seen.join(' -> ')}`);

