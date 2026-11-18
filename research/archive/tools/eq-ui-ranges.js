/**
 * РЕАЛЬНЫЕ ДИАПАЗОНЫ EQ — через UI.
 *
 * Файл принимает любые значения (валидации нет), поэтому настоящие
 * границы видит только интерфейс. Читаем их из RangeValue паттернов
 * и из комбобокса типов.
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cnt = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count').trim();
console.log(`MCC запущен: ${Number(cnt) > 0 ? 'да' : 'нет'}`);
if (Number(cnt) === 0) process.exit(0);

const { items } = dumpTree();
console.log(`элементов: ${items.length}`);

// 1) Все слайдеры EQ (x < 450, y ~1324)
console.log('\n=== СЛАЙДЕРЫ EQ (область x<450, y~1324) ===');
const eqSliders = items.filter((x) => x.cls === 'QSlider' && x.ly > 1280 && x.ly < 1380 && x.lx < 450)
  .sort((a, b) => a.lx - b.lx);

for (const s of eqSliders) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${s.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString() + "|" + $rv.Current.SmallChange.ToString())',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const r = ps(RAW).trim();
  if (r === 'NOPATTERN') { console.log(`  [${s.i}] (${s.lx},${s.ly}) — нет RangeValue`); continue; }
  const [v, mn, mx, sc] = r.split('|');
  console.log(`  [${String(s.i).padStart(3)}] (${String(s.lx).padStart(4)},${s.ly}) value=${String(v).padStart(5)}  диапазон ${mn}..${mx}  шаг ${sc}`);
}

// 2) Комбобоксы — ищем типы фильтров
console.log('\n=== КОМБОБОКСЫ (ищем тип фильтра) ===');
const combos = items.filter((x) => x.cls && /ComboBox/.test(x.cls));
for (const c of combos) {
  console.log(`  [${c.i}] (${c.lx},${c.ly}) ${c.cls}`);
  // раскрываем и читаем варианты
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$combo = $all.Item(${c.i})`,
    '$ep = $null',
    'if (-not $combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 0 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 700',
    '$all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$names = @()',
    'for ($i=0; $i -lt $all2.Count; $i++) {',
    '  $e = $all2.Item($i)',
    '  if ($e.Current.ClassName -eq "QComboBoxPopup" -or $e.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem") {',
    '    if ($e.Current.Name) { $names += $e.Current.Name }',
    '  }',
    '}',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Collapse()',
    'Start-Sleep -Milliseconds 300',
    'Write-Output ($names -join ", ")',
  ].join('\n');
  const opts = ps(RAW).trim();
  console.log(`      варианты: ${opts.slice(0, 200)}`);
}

// 3) Текущее состояние из файла
const i = readWorkspace(findActiveWorkspace().path);
console.log('\n=== ТЕКУЩИЕ ЗНАЧЕНИЯ EQ_IN1 ===');
for (const [k, v] of Object.entries(i.EQ_IN1 ?? {})) {
  if (/^Eq%40/.test(k)) console.log(`  ${k} = ${v}`);
}
console.log(`  Switch = ${i.EQ_IN1?.Switch}`);
console.log(`  GainInput = ${i.EQ_IN1?.GainInput}`);
