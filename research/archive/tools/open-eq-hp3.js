/**
 * ОТКРЫТЬ EQ НАУШНИКОВ (не входов).
 *
 * ═══ РАЗЛИЧИЕ ═══
 *
 * В Prof-режиме три кнопки PushButtonEQ:
 *     i=40   (696,618)  — у ВЫХОДА  -> EQ НАУШНИКОВ (10 полос)
 *     i=107  ( 94,297)  — у входа IN1 -> EQ входа (4 полосы)
 *     i=116  (249,297)  — у входа IN2 -> EQ входа (4 полосы)
 *
 * Мой open-eq-hp.js брал последнюю найденную кнопку — то есть вход.
 * Надо брать ту, что у выходов (x > 600).
 *
 * ═══ ПРОВЕРКА ═══
 *
 * После открытия считаем EqWidgetIem: должно быть 10 (наушники),
 * а не 4 (вход).
 *
 * Запуск: node src/tools/open-eq-hp3.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function closeEq() {
  const body = [
    '$root = Get-MccRoot',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
    '$e = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'if (-not $e) { Write-Output "NO_WINDOW"; exit 0 }',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.WindowPattern]$p).Close()',
    '  Write-Output "CLOSED"',
    '} else { Write-Output "NO_PATTERN" }',
  ].join('\n');
  return ui(body);
}

/** Сколько полос в открытом окне EQ. */
function bandCount() {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output 0; exit 0 }',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqWidgetIem")',
    '$items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'Write-Output $items.Count',
  ].join('\n');
  return Number(ui(body)) || 0;
}

/** Все кнопки EQ с координатами. */
function eqButtons() {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  $a = [string]$e.Current.AutomationId',
    '  if (-not $a.EndsWith("PushButtonEQ")) { continue }',
    '  $r = $e.Current.BoundingRectangle',
    '  if ($r.Width -le 0) { continue }',
    '  Write-Output ("B|" + $i + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + [int]$r.Width + "|" + [int]$r.Height)',
    '}',
  ].join('\n');
  const out = ui(body);
  if (!out) return [];
  return out
    .split('\n')
    .filter((l) => l.startsWith('B|'))
    .map((l) => {
      const [, i, x, y, w, h] = l.split('|');
      return { i: Number(i), x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    });
}

function dblClick(x, y) {
  const body = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class EqO3 {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    '\'@ -ErrorAction SilentlyContinue',
    `[EqO3]::SetCursorPos(${x}, ${y})`,
    'Start-Sleep -Milliseconds 300',
    '[EqO3]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 50',
    '[EqO3]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 80',
    '[EqO3]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 50',
    '[EqO3]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Write-Output "DBL"',
  ].join('\n');
  return ui(body);
}

async function main() {
  console.log(`полос сейчас: ${bandCount()}`);

  if (bandCount() > 0) {
    console.log(`  закрываю текущее окно: ${closeEq()}`);
    await sleep(2000);
  }

  const btns = eqButtons();
  console.log(`\nкнопки EQ (${btns.length}):`);
  for (const b of btns) {
    const side = b.x > 600 ? 'ВЫХОД (HP)' : 'вход';
    console.log(`  i=${String(b.i).padStart(3)} (${String(b.x).padStart(4)},${b.y}) ${b.w}x${b.h}  ${side}`);
  }

  // берём кнопку у выхода — это EQ наушников
  const hpBtn = btns.filter((b) => b.x > 600).sort((a, b) => b.x - a.x)[0];
  if (!hpBtn) {
    console.log('\n  кнопка у выхода не найдена');
    process.exit(1);
  }

  const cx = Math.round(hpBtn.x + hpBtn.w / 2);
  const cy = Math.round(hpBtn.y + hpBtn.h / 2);
  console.log(`\n=== двойной клик по (${cx},${cy}) — EQ у выхода ===`);
  console.log(`  ${dblClick(cx, cy)}`);

  await sleep(3000);
  const n = bandCount();
  console.log(`\nполос открылось: ${n}`);
  if (n === 10) {
    console.log('  ЭТО EQ НАУШНИКОВ (10 полос) — правильно');
  } else if (n === 4) {
    console.log('  это EQ входа (4 полосы) — не то');
  } else if (n === 0) {
    console.log('  окно не открылось');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
