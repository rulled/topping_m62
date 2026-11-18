/**
 * ДИАГНОСТИКА состояния MCC: жив ли UI, что с окном.
 *
 * Запуск: node src/tools/diag-mcc.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => {
  try {
    return ps(PRELUDE + body).trim();
  } catch (err) {
    return `THROW: ${err.message}`;
  }
};

const proc = ui(
  "$p = Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue; " +
    "if ($p) { Write-Output ('PID:' + $p.Id + '|HWND:' + $p.MainWindowHandle + '|RESP:' + $p.Responding) } else { Write-Output 'NOT_RUNNING' }",
);
console.log(`процесс: ${proc}`);

const root = ui(`
try {
  $r = Get-MccRoot
  if ($r) {
    Write-Output ("ROOT_NAME:" + $r.Current.Name)
    Write-Output ("ROOT_CLASS:" + $r.Current.ClassName)
    Write-Output ("ROOT_RECT:" + $r.Current.BoundingRectangle)
    Write-Output ("ROOT_ENABLED:" + $r.Current.IsEnabled)
  } else {
    Write-Output "NO_ROOT"
  }
} catch {
  Write-Output ("ROOT_EXC:" + $_.Exception.Message)
}
`);
console.log(`корень UIA:\n${root || '  (пусто)'}`);

const kids = ui(`
try {
  $r = Get-MccRoot
  if ($r) {
    $c = $r.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output ("CHILDREN:" + $c.Count)
    for ($i = 0; $i -lt [Math]::Min($c.Count, 9); $i++) {
      $e = $c[$i]
      Write-Output ("  [" + $i + "] " + $e.Current.ClassName + " / " + $e.Current.Name)
    }
  }
} catch {
  Write-Output ("CHILD_EXC:" + $_.Exception.Message)
}
`);
console.log(`дети:\n${kids || '  (пусто)'}`);
