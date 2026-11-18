/**
 * Поиск страниц EQ/NC/COMP: снимок дерева UI до и после нажатия MORE,
 * сравнение — что появилось.
 */
import { execFileSync } from 'node:child_process';

const PS_EXE = 'powershell.exe';

const DUMP = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0 -or $r.Width -le 0) { continue }
  $out += [pscustomobject]@{
    i=$i; cls=$e.Current.ClassName; name=$e.Current.Name;
    x=[int]($r.X+$r.Width/2); y=[int]($r.Y+$r.Height/2);
    w=[int]$r.Width; h=[int]$r.Height
  }
}
$out | ConvertTo-Json -Compress -Depth 3
`;

const CLICK_MORE = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process -Name "M Control Center" -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hit = $null
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.Name -eq 'MORE') { $hit = $e; break }
}
if ($hit -eq $null) { Write-Output "NO-MORE"; exit 1 }
$pat = $null
if ($hit.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
  ([System.Windows.Automation.InvokePattern]$pat).Invoke()
  Write-Output "CLICKED"
} else { Write-Output "NO-INVOKE" }
`;

function ps(cmd) {
  return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function dump() {
  const raw = ps(DUMP);
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : [j];
}

const key = (e) => `${e.cls}|${e.name}|${e.x},${e.y}`;

const before = dump();
console.log(`элементов до: ${before.length}`);

const res = ps(CLICK_MORE);
console.log(`MORE: ${res}`);

await new Promise((r) => setTimeout(r, 1200));

const after = dump();
console.log(`элементов после: ${after.length}`);

const bset = new Set(before.map(key));
const aset = new Set(after.map(key));

const appeared = after.filter((e) => !bset.has(key(e)));
const vanished = before.filter((e) => !aset.has(key(e)));

console.log(`\n=== ПОЯВИЛОСЬ: ${appeared.length} ===`);
for (const e of appeared.slice(0, 60)) {
  console.log(`  (${e.x},${e.y}) ${e.cls.padEnd(22)} '${(e.name || '').replace(/\n/g, '/')}'`);
}

console.log(`\n=== ИСЧЕЗЛО: ${vanished.length} ===`);
for (const e of vanished.slice(0, 40)) {
  console.log(`  (${e.x},${e.y}) ${e.cls.padEnd(22)} '${(e.name || '').replace(/\n/g, '/')}'`);
}

// какие подписи видны сейчас
const labels = after.filter((e) => e.cls === 'QLabel' && e.name && e.name.trim());
console.log(`\n=== ПОДПИСИ СЕЙЧАС (${labels.length}) ===`);
for (const e of labels.sort((a, b) => a.y - b.y || a.x - b.x)) {
  console.log(`  (${e.x},${e.y}) '${e.name.replace(/\n/g, '/')}'`);
}
