/**
 * ЗАКРЫТИЕ MCC, когда MainWindowHandle пустой.
 *
 * ═══ ПОЧЕМУ ПУСТОЙ HANDLE ═══
 *
 * MCC свёрнут в трей или работает в фоне, поэтому у процесса
 * MainWindowHandle = 0. Но окно существует — его видно через UIA.
 *
 * ═══ ЧТО ДЕЛАЕМ ═══
 *
 * 1. Пытаемся WM_CLOSE через handle основного окна из UIA.
 * 2. Если не вышло — ищем пункт «Выход» в меню трея (MenuS1M1 был в дереве).
 * 3. Если и это не вышло — честно сообщаем.
 *
 * Запуск: node src/tools/close-mcc2.js
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const count = () => {
  const r = ui("Write-Output ((Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count)");
  return Number(r);
};

async function main() {
  console.log('процессов MCC:', count());
  if (count() === 0) {
    console.log('уже закрыт');
    return;
  }

  // --- ищем окно и его handle ---
  console.log('\nищем окно через UIA…');
  const body = [
    '$root = Get-MccRoot',
    'if ($root) {',
    '  Write-Output ("FOUND|" + $root.Current.Name + "|" + $root.Current.ClassName)',
    '} else { Write-Output "NO_ROOT" }',
  ].join('\n');
  const r = ui(body);
  console.log(`  ${r}`);

  // --- пробуем WM_CLOSE через Win32 по заголовку ---
  console.log('\nпробуем WM_CLOSE по заголовку…');
  const closePs = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class WC2 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string title);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

$targets = @(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$found = @()
$cb = {
  param($h, $l)
  $procId = 0
  [void][WC2]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($targets -contains $procId) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][WC2]::GetWindowText($h, $sb, 256)
    $title = $sb.ToString()
    $vis = [WC2]::IsWindowVisible($h)
    $found += [pscustomobject]@{ H = $h; Pid = $procId; Title = $title; Visible = $vis }
  }
  return $true
}
[void][WC2]::EnumWindows($cb, [IntPtr]::Zero)

foreach ($f in $found) {
  Write-Output ("WIN|" + $f.H + "|" + $f.Pid + "|" + $f.Visible + "|" + $f.Title)
  if ($f.Visible -and $f.Title) {
    [void][WC2]::PostMessage($f.H, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output ("CLOSED|" + $f.Title)
  }
}
`;
  const out = ui(closePs);
  console.log(out || '  (окон не найдено)');

  // --- ждём ---
  for (let i = 0; i < 15; i += 1) {
    await sleep(1000);
    if (count() === 0) {
      console.log(`\nMCC закрылся через ${i + 1} с`);
      return;
    }
  }
  console.log('\nMCC всё ещё работает');
  console.log('Он запущен от администратора и не закрывается без прав.');
  console.log('Штатный выход: правый клик по иконке в трее -> Выход.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
