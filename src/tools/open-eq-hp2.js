/**
 * EQ НАУШНИКОВ: открыть окно и снять структуру.
 *
 * ═══ ЧТО ИЗВЕСТНО ═══
 *
 * В Prof-режиме три кнопки PushButtonEQ:
 *     i=40   (696,618)   — у выхода, это EQ НАУШНИКОВ
 *     i=107  ( 94,297)   — EQ входа IN1 (в Prof его нет, кнопка есть?)
 *     i=116  (249,297)   — EQ входа IN2
 *
 * Клик по i=116 окно не открыл. Значит либо не та кнопка, либо
 * нужен другой способ (двойной клик не сработал).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Печатает иерархию кнопки i=40 — где она находится.
 * 2. Пробует открыть окно EQ тремя способами.
 * 3. Показывает структуру окна, если открылось.
 *
 * Запуск: node src/tools/open-eq-hp2.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Полный путь (AutomationId) элемента. */
function pathOf(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    'Write-Output $e.Current.AutomationId',
  ].join('\n');
  return ui(body);
}

/** Открыто ли окно EQ. */
function eqOpen() {
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

/** Двойной клик по координатам. */
function dblClick(x, y) {
  const body = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class EqO2 {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    '\'@ -ErrorAction SilentlyContinue',
    `[EqO2]::SetCursorPos(${x}, ${y})`,
    'Start-Sleep -Milliseconds 300',
    '[EqO2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 50',
    '[EqO2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 80',
    '[EqO2]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 50',
    '[EqO2]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)',
    'Write-Output "DBL"',
  ].join('\n');
  return ui(body);
}

/** Enter на элементе после фокуса. */
function enterOn(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    '$e.SetFocus()',
    'Start-Sleep -Milliseconds 200',
    'Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue',
    '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    'Write-Output "ENTER"',
  ].join('\n');
  return ui(body);
}

/** Invoke pattern. */
function invoke(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {',
    '  ([System.Windows.Automation.InvokePattern]$p).Invoke()',
    '  Write-Output "INVOKED"',
    '} else { Write-Output "NO_INVOKE" }',
  ].join('\n');
  return ui(body);
}

async function main() {
  console.log('=== иерархия трёх кнопок EQ ===');
  for (const i of [40, 107, 116]) {
    const p = pathOf(i);
    const tail = p.split('.').slice(-3).join('.');
    console.log(`  i=${i}: ...${tail}`);
  }

  console.log(`\nокно EQ открыто: ${eqOpen()}`);

  // ─── пробуем i=40 (у выхода) тремя способами ───
  const attempts = [
    { name: 'Invoke pattern на i=40', fn: () => invoke(40) },
    { name: 'Enter на i=40', fn: () => enterOn(40) },
    { name: 'двойной клик по (696+28, 618+10)', fn: () => dblClick(724, 628) },
  ];

  for (const a of attempts) {
    console.log(`\n=== ${a.name} ===`);
    console.log(`  ${a.fn()}`);
    await sleep(2500);
    const open = eqOpen();
    console.log(`  окно EQ: ${open ? 'ОТКРЫЛОСЬ' : 'закрыто'}`);
    if (open) break;
  }

  // ─── если открылось, снимаем структуру ───
  if (eqOpen()) {
    console.log('\n=== структура окна EQ ===');
    const body = [
      '$root = Get-MccRoot',
      '$c = New-Object System.Windows.Automation.PropertyCondition(',
      '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
      '$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
      '$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
      'Write-Output ("всего в окне: " + $all.Count)',
      '$groups = @{}',
      'for ($i = 0; $i -lt $all.Count; $i++) {',
      '  $e = $all.Item($i)',
      '  $cls = [string]$e.Current.ClassName',
      '  if (-not $groups.ContainsKey($cls)) { $groups[$cls] = 0 }',
      '  $groups[$cls] = $groups[$cls] + 1',
      '}',
      'foreach ($k in ($groups.Keys | Sort-Object)) { Write-Output ("  " + $k + ": " + $groups[$k]) }',
    ].join('\n');
    console.log(ui(body));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
