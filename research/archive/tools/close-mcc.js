/**
 * ШТАТНОЕ ЗАКРЫТИЕ MCC (чтобы он записал INI).
 *
 * ═══ ЗАЧЕМ ═══
 *
 * MCC при закрытии перезаписывает workspace-INI из своей памяти.
 * Значит, если наша запись в микшер применилась, MCC при закрытии
 * сохранит НОВОЕ значение в файл — и мы сможем это проверить,
 * даже не читая микшер из устройства (он не отдаётся).
 *
 * ═══ ПОЧЕМУ НЕ Stop-Process ═══
 *
 * MCC запущен от администратора (тем скриптом захвата), поэтому
 * Stop-Process и taskkill возвращают Access denied. Но закрыть окно
 * можно штатно — через WM_CLOSE, это разрешено и не требует прав.
 *
 * Запуск: node src/tools/close-mcc.js
 */

import { execFileSync } from 'node:child_process';

const PS = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class WinClose {
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

$procs = Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output 'NOT_RUNNING'; exit 0 }

$sent = 0
foreach ($p in $procs) {
  $h = $p.MainWindowHandle
  if ($h -eq 0) {
    $h = [WinClose]::FindWindow($null, 'M Control Center')
  }
  if ($h -ne 0) {
    # WM_CLOSE = 0x0010
    if ([WinClose]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { $sent++ }
  }
}
Write-Output "SENT:$sent"
`;

const run = () => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', PS], {
      timeout: 30000,
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    return `ERR: ${err.message}`;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log('закрываем MCC штатно (WM_CLOSE)…');
  console.log(`  ${run()}`);

  for (let i = 0; i < 20; i += 1) {
    await sleep(1000);
    const n = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 20000, encoding: 'utf8' }).trim();
    if (Number(n) === 0) {
      console.log(`  закрылся через ${i + 1} с`);
      return;
    }
    if ((i + 1) % 5 === 0) console.log(`  всё ещё работает (${i + 1} с)…`);
  }
  console.log('  не закрылся за 20 с');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
