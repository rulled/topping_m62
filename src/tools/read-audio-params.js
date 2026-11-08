/**
 * ЧТЕНИЕ АУДИОПАРАМЕТРОВ ИЗ MCC: sample rate, buffer size, workspace.
 *
 * Найдено в §63: комбобоксы [8] workspace, [9] sample rate, [10] buffer size.
 * Это параметры аудиодрайвера — их нет в HID и нельзя получить из файла.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';

/** Прочитать текущее значение комбобокса. */
function comboValue(index) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else {',
    '  $sel = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$sel)) {',
    '    $cur = ([System.Windows.Automation.SelectionPattern]$sel).Current.GetSelection()',
    '    if ($cur.Length -gt 0) { Write-Output $cur[0].Current.Name } else { Write-Output "" }',
    '  } else { Write-Output "NOPATTERN" }',
    '}',
  ].join('\n');
  return ps(RAW).trim();
}

/** Прочитать все варианты комбобокса (раскрыть/закрыть). */
function comboOptions(index) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${index})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output ""; exit 0 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 700',
    '$all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$names = @()',
    'for ($i=0; $i -lt $all2.Count; $i++) {',
    '  $e = $all2.Item($i)',
    '  if ($e.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem" -and $e.Current.Name) { $names += $e.Current.Name }',
    '}',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
    'Start-Sleep -Milliseconds 300',
    'Write-Output ($names -join "|")',
  ].join('\n');
  const r = ps(RAW).trim();
  return r ? r.split('|').filter(Boolean) : [];
}

/** Собрать аудиопараметры. */
export function audioParams() {
  const { items } = dumpTree();
  const combos = items.filter((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 100)
    .sort((a, b) => a.lx - b.lx);

  const out = {};
  const NAMES = ['workspace', 'sampleRate', 'bufferSize'];
  combos.forEach((c, idx) => {
    const name = NAMES[idx] ?? `combo${idx}`;
    out[name] = { index: c.i, value: comboValue(c.i), options: comboOptions(c.i) };
  });
  return out;
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const p = audioParams();
  for (const [k, v] of Object.entries(p)) {
    console.log(`${k}:`);
    console.log(`  текущее: ${v.value}`);
    console.log(`  варианты: ${v.options.join(', ') || '—'}`);
  }
}
