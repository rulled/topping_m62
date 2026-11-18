/**
 * ЧТО УМЕЕТ ДИЛ УРОВНЯ NC.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * Диал находится по EndsWith("dialNoiseReduction") — проверено вручную
 * (FOUND 151). Но readDial в map-nc-tags.js возвращает null.
 *
 * Гипотеза: у DialS1M5 в панели NC нет RangeValuePattern — значит
 * значение не читается стандартным путём, как у других дилов.
 *
 * Этот скрипт проверяет ВСЕ паттерны у элемента 151 и печатает,
 * что доступно: RangeValue, Toggle, Value, Selection, Invoke.
 *
 * Запуск: node src/tools/probe-nc-dial-patterns.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

const body = [
  '$root = Get-MccRoot',
  'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',

  'Write-Output "=== поиск dialNoiseReduction ==="',
  '$idx = -1',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $a = [string]$all.Item($i).Current.AutomationId',
  '  if ($a.EndsWith("dialNoiseReduction")) { $idx = $i; break }',
  '}',
  'if ($idx -lt 0) { Write-Output "НЕ НАЙДЕН"; exit 0 }',
  'Write-Output ("индекс: " + $idx)',

  '$e = $all.Item($idx)',
  'Write-Output ("класс: " + $e.Current.ClassName)',
  'Write-Output ("имя: [" + $e.Current.Name + "]")',
  'Write-Output ("включён: " + $e.Current.IsEnabled)',
  'Write-Output ("виден: " + (-not $e.Current.IsOffscreen))',
  'Write-Output ("прямоугольник: " + $e.Current.BoundingRectangle)',

  'Write-Output ""',
  'Write-Output "=== доступные паттерны ==="',
  '$patterns = @{',
  '  "RangeValue" = [System.Windows.Automation.RangeValuePattern]::Pattern',
  '  "Value" = [System.Windows.Automation.ValuePattern]::Pattern',
  '  "Toggle" = [System.Windows.Automation.TogglePattern]::Pattern',
  '  "Selection" = [System.Windows.Automation.SelectionPattern]::Pattern',
  '  "Invoke" = [System.Windows.Automation.InvokePattern]::Pattern',
  '  "Scroll" = [System.Windows.Automation.ScrollPattern]::Pattern',
  '}',
  'foreach ($k in $patterns.Keys) {',
  '  $p = $null',
  '  $ok = $e.TryGetCurrentPattern($patterns[$k], [ref]$p)',
  '  Write-Output ("  " + $k.PadRight(12) + " " + $ok)',
  '  if ($ok -and $k -eq "RangeValue") {',
  '    $rv = [System.Windows.Automation.RangeValuePattern]$p',
  '    Write-Output ("        значение=" + $rv.Current.Value + " [" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "] readOnly=" + $rv.Current.IsReadOnly)',
  '  }',
  '  if ($ok -and $k -eq "Value") {',
  '    $vp = [System.Windows.Automation.ValuePattern]$p',
  '    Write-Output ("        текст=[" + $vp.Current.Value + "] readOnly=" + $vp.Current.IsReadOnly)',
  '  }',
  '}',

  'Write-Output ""',
  'Write-Output "=== соседние элементы Effect_NC ==="',
  'for ($i = 145; $i -le 155; $i++) {',
  '  if ($i -ge $all.Count) { break }',
  '  $x = $all.Item($i)',
  '  $tail = ([string]$x.Current.AutomationId).Split(".")[-1]',
  '  Write-Output ("  i=" + $i + " " + $x.Current.ClassName.PadRight(16) + " " + $tail)',
  '}',
].join('\n');

console.log(ui(body));
