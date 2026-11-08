/**
 * НАЙТИ КНОПКУ EQ НАУШНИКОВ в Prof-режиме и открыть окно.
 *
 * ═══ ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ ═══
 *
 * openEqWindow(which) в eq-control.js умеет 'IN1' и 'IN2' — это EQ входов.
 * В Prof-режиме EQ входов НЕТ, зато есть EQ НАУШНИКОВ (EQ_HP), и его
 * кнопка расположена у выхода HP, а не у входа.
 *
 * Значит findEqButton('IN1') не найдёт её, и openEqWindow упадёт.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Печатает все кнопки, похожие на EQ (по AutomationId).
 * 2. Показывает, где они (координаты).
 * 3. Открывает EQ наушников двойным кликом по найденной кнопке.
 *
 * Запуск: node src/tools/open-eq-hp.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Все кнопки с "eq" или "equalizer" в AutomationId. */
function findEqButtons() {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  $a = [string]$e.Current.AutomationId',
    '  $n = [string]$e.Current.Name',
    '  if ($a -notmatch "(?i)eq|equalizer" -and $n -notmatch "(?i)^EQ$|equalizer") { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Width -le 0) { continue }',
    '  Write-Output ("B|" + $i + "|" + $e.Current.ClassName + "|" + $n + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + [int]$r.Width + "|" + [int]$r.Height + "|" + $a.Split(".")[-1])',
    '}',
  ].join('\n');

  const out = ui(body);
  if (!out || out === 'NO_WINDOW') return [];
  return out
    .split('\n')
    .filter((l) => l.startsWith('B|'))
    .map((l) => {
      const [, i, cls, name, x, y, w, h, tail] = l.split('|');
      return {
        i: Number(i),
        cls,
        name,
        x: Number(x),
        y: Number(y),
        w: Number(w),
        h: Number(h),
        tail,
      };
    });
}

/** Двойной клик по координатам. */
function doubleClick(x, y) {
  const body = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class EqOpen {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    '\'@ -ErrorAction SilentlyContinue',
    `[EqOpen]::SetCursorPos(${x}, ${y})`,
    'Start-Sleep -Milliseconds 250',
    '[EqOpen]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 40',
    '[EqOpen]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 60',
    '[EqOpen]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 40',
    '[EqOpen]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Write-Output "CLICKED"',
  ].join('\n');
  return ui(body);
}

/** Открыто ли окно EQ (по классу EqualizerBase). */
function eqWindowOpen() {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'if ($e) { Write-Output "OPEN" } else { Write-Output "CLOSED" }',
  ].join('\n');
  return ui(body) === 'OPEN';
}

async function main() {
  console.log('=== кнопки с EQ в AutomationId ===');
  const btns = findEqButtons();
  if (!btns.length) {
    console.log('  не найдено');
  }
  for (const b of btns) {
    console.log(
      `  i=${String(b.i).padStart(3)} ${b.cls.padEnd(18)} (${String(b.x).padStart(4)},${String(b.y).padStart(3)}) ${b.w}x${b.h}  ${b.tail}  name=[${b.name}]`,
    );
  }

  console.log(`\nокно EQ открыто: ${eqWindowOpen()}`);

  // ищем кнопку у выхода (правая часть окна, y около HP)
  const hpBtn = btns.find((b) => (b.tail || '').toLowerCase().includes('hp'))
    ?? btns.find((b) => b.x > 1200)
    ?? btns[btns.length - 1];

  if (!hpBtn) {
    console.log('\nнет кнопки для клика');
    return;
  }

  console.log(`\n=== кликаем двойным по i=${hpBtn.i} (${hpBtn.x + hpBtn.w / 2}, ${hpBtn.y + hpBtn.h / 2}) ===`);
  const cx = Math.round(hpBtn.x + hpBtn.w / 2);
  const cy = Math.round(hpBtn.y + hpBtn.h / 2);
  console.log(`  ${doubleClick(cx, cy)}`);

  await sleep(2500);
  console.log(`  окно EQ открыто: ${eqWindowOpen()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
