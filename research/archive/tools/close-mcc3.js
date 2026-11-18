/**
 * Закрытие MCC через UIA WindowPattern — работает при любом уровне прав.
 *
 * ═══ ПОЧЕМУ ПРЕДЫДУЩИЕ СПОСОБЫ НЕ СРАБОТАЛИ ═══
 *
 *   Stop-Process / taskkill -> Access denied: MCC запущен от администратора
 *     скриптом захвата, наш процесс ниже по целостности.
 *   WM_CLOSE через Win32 -> MainWindowHandle = 0 (окно свёрнуто/скрыто),
 *     а EnumWindows не находит окон чужого уровня целостности.
 *
 *   Но UIA видит окно: "M Control Center", класс Qt690QWindowIcon.
 *   Значит через WindowPattern у него есть штатное Close().
 *
 * Запуск: node src/tools/close-mcc3.js
 */

import { ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

const count = () =>
  Number(
    ui("Write-Output ((Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count)"),
  );

async function main() {
  console.log('процессов MCC:', count());
  if (count() === 0) {
    console.log('уже закрыт');
    return;
  }

  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "NO_ROOT"; exit 0 }',
    '$p = $null',
    'if ($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) {',
    '  $wp = [System.Windows.Automation.WindowPattern]$p',
    '  $wp.Close()',
    '  Write-Output "CLOSE_SENT"',
    '} else { Write-Output "NO_WINDOW_PATTERN" }',
  ].join('\n');

  console.log('UIA WindowPattern.Close…');
  console.log(`  ${ui(body) || '(пусто)'}`);

  for (let i = 0; i < 20; i += 1) {
    await sleep(1000);
    if (count() === 0) {
      console.log(`  закрылся через ${i + 1} с`);
      return;
    }
  }
  console.log('  не закрылся');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
