/**
 * Перечисление вариантов в ComboBox настроек MCC.
 *
 * Раскрывает комбобокс и читает список пунктов. Ничего не выбирает.
 *
 * Запуск:
 *   node src/tools/enum-combos.js
 */
import { ps, PRELUDE } from './uia.js';

const LIST = ps(PRELUDE + String.raw`
$root = Get-MccRoot
$all = Get-MccAll $root
$res = @()
# найдём комбобоксы в области настроек
$targets = @()
for ($i=0; $i -lt $all.Count; $i++) {
  $e = $all.Item($i)
  if ($e.Current.ClassName -notmatch 'ComboBox') { continue }
  $r = $e.Current.BoundingRectangle
  if ($r.Height -le 0) { continue }
  $cy = $r.Y + $r.Height/2
  if ($cy -lt 380 -or $cy -gt 1300) { continue }
  $targets += [pscustomobject]@{ i=$i; y=[int]$cy }
}
Write-Output ("COUNT=" + $targets.Count)
foreach ($t in $targets) {
  $e = $all.Item($t.i)
  $pat = $null
  $expanded = $false
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) {
    $ec = [System.Windows.Automation.ExpandCollapsePattern]$pat
    $ec.Expand()
    Start-Sleep -Milliseconds 500
    $expanded = $true
  }
  $items = @()
  if ($expanded) {
    # найти QListWidget, появившийся после раскрытия
    $all2 = Get-MccAll $root
    for ($j=0; $j -lt $all2.Count; $j++) {
      $q = $all2.Item($j)
      if ($q.Current.ClassName -ne 'QListWidget') { continue }
      $kids = $q.FindAll([System.Windows.Automation.TreeScope]::Children,
                          [System.Windows.Automation.Condition]::TrueCondition)
      for ($k=0; $k -lt $kids.Count; $k++) {
        $nm = $kids.Item($k).Current.Name
        if ($nm) { $items += $nm.Trim() }
      }
      if ($items.Count -gt 0) { break }
    }
    $ec.Collapse()
    Start-Sleep -Milliseconds 300
  }
  $res += [pscustomobject]@{ i=$t.i; y=$t.y; items=($items -join ' | ') }
}
$res | ConvertTo-Json -Compress -Depth 3
`);

const lines = LIST.split(/\r?\n/);
const count = (lines.find((l) => l.startsWith('COUNT=')) ?? 'COUNT=0').split('=')[1];
const json = lines.filter((l) => !l.startsWith('COUNT=')).join('\n');

const LABELS = {
  437: 'Bluetooth',
  537: 'Brightness',
  635: 'OTG port power setting',
  734: 'USB-C port power setting',
  834: 'Mode select',
  934: 'Auto Power On/Off',
  1132: 'Main button single-click',
  1231: 'Main button double-click',
};

let rows;
try {
  rows = JSON.parse(json);
} catch {
  console.error('не удалось разобрать ответ:'); console.error(json.slice(0, 800)); process.exit(1);
}
const list = Array.isArray(rows) ? rows : [rows];
console.log(`комбобоксов найдено: ${count}\n`);

for (const r of list) {
  // ближайшая подпись
  let best = null, bestD = 1e9;
  for (const [ys, lb] of Object.entries(LABELS)) {
    const d = Math.abs(Number(ys) - r.y);
    if (d < bestD) { bestD = d; best = lb; }
  }
  console.log(`${best ?? '?'} (y=${r.y}):`);
  const items = r.items ? r.items.split(' | ').filter(Boolean) : [];
  if (!items.length) {
    console.log('   (пункты не прочитались — Qt не отдаёт их через UIA)');
  } else {
    items.forEach((it, k) => console.log(`   ${k}: ${it}`));
  }
  console.log();
}
