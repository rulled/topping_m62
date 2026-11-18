/**
 * ПОЧЕМУ AutomationId НЕ НАХОДИТСЯ.
 *
 * ═══ СИМПТОМ ═══
 *
 * list-nc-controls.js показал dialNoiseReduction и pushButtonNC2 с их
 * AutomationId. Но map-nc-tags.js по тем же строкам их НЕ находит —
 * возвращает NOT_FOUND.
 *
 * Возможные причины:
 *   1. UIA-дерево пересобралось между вызовами (индексы съехали).
 *   2. Сравнение строк: в PowerShell -ne чувствительно к регистру?
 *   3. AutomationId приходит с пустыми символами/пробелами.
 *   4. Элемент скрыт (панель не активна).
 *
 * Этот скрипт печатает ВСЕ AutomationId с кавычками и длиной, чтобы
 * увидеть точное содержимое.
 *
 * Запуск: node src/tools/diag-autoid.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

const body = [
  '$root = Get-MccRoot',
  'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'Write-Output ("TOTAL|" + $all.Count)',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $a = $e.Current.AutomationId',
  '  if (-not $a) { continue }',
  '  if ($a -notmatch "Effect_|Noise|NC|compress|Compress") { continue }',
  '  Write-Output ("R|" + $i + "|" + $a.Length + "|[" + $a + "]|" + $e.Current.ClassName + "|" + $e.Current.IsOffscreen)',
  '}',
].join('\n');

const out = ui(body);
console.log(out || '(пусто)');

console.log('\n=== прямой поиск по AutomationId ===');
for (const id of ['dialNoiseReduction', 'pushButtonNC2', 'Effect_NC']) {
  const q = [
    '$root = Get-MccRoot',
    '$cond = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::AutomationIdProperty, "' + id + '")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)',
    'if ($e) { Write-Output ("FOUND|" + $e.Current.ClassName + "|" + $e.Current.IsOffscreen) }',
    'else { Write-Output "NOT_FOUND" }',
  ].join('\n');
  console.log(`  ${id}: ${ui(q)}`);
}
