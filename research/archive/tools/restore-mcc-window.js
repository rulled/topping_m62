/**
 * РАЗВЕРНУТЬ ОКНО MCC из трея.
 *
 * ═══ ЧТО СЛОМАЛОСЬ ═══
 *
 * После моего UIA WindowPattern.Close() окно MCC ушло в трей:
 *   ROOT_RECT: -32000,-32000,160,28   <- координата скрытого окна
 * Дети: 1 элемент, без полезных контролов. Дерево UI пустое.
 *
 * Поэтому все UI-операции (reverb, compressor/param, workspace/apply)
 * падают с NO_WINDOW / «кнопка не найдена».
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * WindowPattern.SetWindowVisualState(Normal) — штатный способ развернуть.
 * Если не выйдет — пробуем через трей.
 *
 * Запуск: node src/tools/restore-mcc-window.js
 */

import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const rect = () =>
  ui(`
try {
  $r = Get-MccRoot
  if ($r) { Write-Output ($r.Current.BoundingRectangle.ToString()) } else { Write-Output "NO_ROOT" }
} catch { Write-Output "EXC" }
`);

const main = async () => {
  console.log('до:', rect());

  console.log('\nWindowPattern.SetWindowVisualState(Normal)…');
  const out = ui(`
try {
  $r = Get-MccRoot
  if (-not $r) { Write-Output "NO_ROOT"; exit 0 }
  $p = $null
  if ($r.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) {
    $wp = [System.Windows.Automation.WindowPattern]$p
    Write-Output ("state before: " + $wp.Current.WindowVisualState)
    $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
    Start-Sleep -Milliseconds 800
    Write-Output ("state after: " + $wp.Current.WindowVisualState)
  } else {
    Write-Output "NO_WINDOW_PATTERN"
  }
} catch {
  Write-Output ("EXC: " + $_.Exception.Message)
}
`);
  console.log(out || '  (пусто)');

  await sleep(1500);
  console.log('\nпосле:', rect());

  // проверяем, появились ли контролы
  const n = ui(`
try {
  $r = Get-MccRoot
  if ($r) {
    $a = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output $a.Count
  } else { Write-Output 0 }
} catch { Write-Output 0 }
`);
  console.log(`элементов в дереве: ${n}`);
  if (Number(n) > 50) {
    console.log('UI восстановлен');
  } else {
    console.log('UI всё ещё пуст — нужно закрыть MCC через трей и запустить заново');
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
