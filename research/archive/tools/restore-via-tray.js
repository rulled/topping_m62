/**
 * РАЗВЕРНУТЬ MCC через иконку в системном трее.
 *
 * ═══ ПОЧЕМУ ТАК ═══
 *
 * MCC запущен с правами администратора (его поднял скрипт захвата от админа).
 * Наш процесс — обычного уровня, поэтому UIPI блокирует:
 *   WindowPattern.SetWindowVisualState -> Access is denied
 *   ShowWindow / PostMessage            -> Access is denied
 *
 * Но панель задач (explorer.exe) работает на ОБЫЧНОМ уровне, и её дерево
 * UIA нам доступно. Иконка MCC в трее — обычная кнопка. Двойной клик по
 * ней разворачивает окно приложения силами самого explorer, без обхода
 * ограничений.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * 1. Находим в трее кнопку с именем, содержащим "Control Center" или "M62".
 * 2. Пробуем Invoke (одинарный клик открывает меню).
 * 3. Пробуем двойной клик через координаты.
 *
 * Запуск: node src/tools/restore-via-tray.js
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

const elements = () =>
  Number(
    ui(`
try {
  $r = Get-MccRoot
  if ($r) {
    $a = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output $a.Count
  } else { Write-Output 0 }
} catch { Write-Output 0 }
`),
  );

async function main() {
  console.log('до:', rect(), '| элементов:', elements());

  // --- ищем иконку в трее ---
  console.log('\nищем MCC в трее…');
  const found = ui(`
Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
$tray = $null

# панель задач -> NotifyIconOverflowWindow / TrayNotifyWnd
foreach ($cls in @('Shell_TrayWnd', 'NotifyIconOverflowWindow')) {
  $h = [System.Diagnostics.Process]::GetCurrentProcess().MainWindowHandle
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, $cls)
  $w = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($w) {
    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $all.Count; $i++) {
      $e = $all[$i]
      $nm = $e.Current.Name
      $cl = $e.Current.ClassName
      if ($nm -match 'Control Center|M62' -or ($cl -match 'Button' -and $nm -match 'M ')) {
        $r = $e.Current.BoundingRectangle
        Write-Output ("TRAY|" + $i + "|" + $cl + "|" + $nm + "|" + $r.X + "|" + $r.Y + "|" + $r.Width + "|" + $r.Height)
      }
    }
  }
}
`);
  console.log(found || '  (иконка не найдена через UIA)');

  // --- пробуем клик по найденной иконке ---
  const m = /TRAY\|(\d+)\|([^|]*)\|([^|]*)\|(-?[\d.]+)\|(-?[\d.]+)\|([\d.]+)\|([\d.]+)/.exec(found);
  if (m) {
    const x = Number(m[4]) + Number(m[6]) / 2;
    const y = Number(m[5]) + Number(m[7]) / 2;
    console.log(`\nкликаем по иконке в (${x}, ${y})…`);

    const click = ui(`
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Cur {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@ -ErrorAction SilentlyContinue
[void][Cur]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
Start-Sleep -Milliseconds 300
# left down + up
[Cur]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Cur]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Write-Output "CLICKED"
`);
    console.log(`  ${click}`);

    await sleep(1500);
    // второй клик (двойной)
    ui(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Cur2 {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
'@ -ErrorAction SilentlyContinue
[Cur2]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Cur2]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Write-Output "CLICKED2"
`);
    await sleep(2500);
  }

  console.log('\nпосле:', rect(), '| элементов:', elements());
  const n = elements();
  if (n > 50) {
    console.log('UI восстановлен');
  } else {
    console.log('UI всё ещё пуст.');
    console.log('Нужно вручную: правый клик по иконке MCC в трее -> Выход,');
    console.log('затем запустить MCC обычным способом (не от админа).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
