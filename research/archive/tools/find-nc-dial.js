/**
 * ПОИСК ДИЛА УРОВНЯ NC — точный AutomationId.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * В списке контролов виден класс DialS1M5 с окончанием dialNoiseReduction.
 * Но поиск по "*.dialNoiseReduction" возвращает NOT_FOUND, хотя список
 * показывает такой элемент.
 *
 * Значит либо окончание другое, либо сравнение -notlike ведёт себя
 * не так, как ожидается (регистр? спецсимволы?).
 *
 * Этот скрипт печатает ВСЕ элементы с "dial" в AutomationId и пробует
 * три разных способа сравнения.
 *
 * Запуск: node src/tools/find-nc-dial.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

const listBody = [
  '$root = Get-MccRoot',
  'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $a = [string]$e.Current.AutomationId',
  '  if ($a -like "*dial*") {',
  '    $cls = [string]$e.Current.ClassName',
  '    Write-Output ("D|" + $i + "|" + $cls + "|" + $a)',
  '  }',
  '}',
].join('\n');

const out = ui(listBody);
if (!out || out === 'NO_WINDOW') {
  console.log('окно MCC не найдено');
  process.exit(0);
}

const rows = out
  .split('\n')
  .filter((l) => l.startsWith('D|'))
  .map((l) => {
    const [, i, cls, auto] = l.split('|');
    return { i: Number(i), cls, auto };
  });

console.log(`элементов с "dial": ${rows.length}\n`);
for (const r of rows) {
  const tail = r.auto.split('.').slice(-2).join('.');
  console.log(`  i=${String(r.i).padStart(3)}  ${r.cls.padEnd(12)}  ${tail}`);
}

// ─── пробуем три способа найти нужный ───
console.log('\n=== три способа поиска dialNoiseReduction ===');

const approaches = {
  'endsWith через Like': [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $a = [string]$all.Item($i).Current.AutomationId',
    '  if ($a.EndsWith("dialNoiseReduction")) { Write-Output ("FOUND " + $i); exit 0 }',
    '}',
    'Write-Output "NOT_FOUND"',
  ].join('\n'),

  'PropertyCondition': [
    '$root = Get-MccRoot',
    '$c = New-Object System.Windows.Automation.PropertyCondition(',
    '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "DialS1M5")',
    '$items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)',
    'Write-Output ("DialS1M5: " + $items.Count)',
    'for ($i = 0; $i -lt $items.Count; $i++) {',
    '  $e = $items.Item($i)',
    '  Write-Output ("  " + $i + " " + $e.Current.AutomationId)',
    '}',
  ].join('\n'),

  'точное полное имя': [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  if ($e.Current.ClassName -ne "DialS1M5") { continue }',
    '  $a = [string]$e.Current.AutomationId',
    '  Write-Output ("  DialS1M5[" + $i + "] " + $a.Split(".")[-1])',
    '}',
  ].join('\n'),
};

for (const [name, body] of Object.entries(approaches)) {
  console.log(`\n--- ${name}`);
  const r = ui(body);
  console.log(r || '  (пусто)');
}
