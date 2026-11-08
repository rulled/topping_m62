/**
 * ДИЛЫ ОКНА EQ — почему не находятся.
 *
 * ═══ СИМПТОМ ═══
 *
 * dumpTree показывает EqWidgetIem: 10, ComboBoxS1M3: 10 — окно открыто.
 * Но listDials() в map-eq-hp.js находит НОЛЬ дилов, хотя фильтрует по
 * AutomationId -match "Equalizer".
 *
 * Возможные причины:
 *   1. AutomationId дилов НЕ содержит "Equalizer" (окно без этого префикса).
 *   2. Дилы имеют другой класс (не Dial*).
 *   3. Окно EQ — отдельный процесс/окно, и Get-MccRoot его не захватывает.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Печатает ВСЕ дилы (класс Dial*) в дереве MCC с их AutomationId,
 * без фильтра по "Equalizer". Так видно точные имена.
 *
 * Запуск: node src/tools/find-eq-dials.js
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

// ─── 1. из dumpTree: какие классы Dial есть ───
console.log('=== классы Dial в дереве ===');
const { items } = dumpTree();
const dials = items.filter((x) => (x.cls || '').startsWith('Dial'));
const byCls = {};
for (const d of dials) {
  (byCls[d.cls] = byCls[d.cls] || []).push(d);
}
for (const [cls, list] of Object.entries(byCls)) {
  console.log(`  ${cls}: ${list.length}`);
}

// ─── 2. прямой запрос ВСЕХ Dial* с AutomationId ───
console.log('\n=== все Dial* с AutomationId (без фильтра) ===');
const body = [
  '$root = Get-MccRoot',
  'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'Write-Output ("всего в дереве: " + $all.Count)',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = [string]$e.Current.ClassName',
  '  if ($cls -notmatch "^Dial") { continue }',
  '  $a = [string]$e.Current.AutomationId',
  '  $r = $e.Current.BoundingRectangle',
  '  Write-Output ("D|" + $i + "|" + $cls + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + $a)',
  '}',
].join('\n');

const out = ui(body);
if (!out || out === 'NO_WINDOW') {
  console.log('  окно MCC не найдено');
  process.exit(0);
}

const lines = out.split('\n').filter((l) => l.startsWith('D|') || l.startsWith('всего'));
for (const l of lines.slice(0, 3)) console.log(`  ${l}`);

const rows = out
  .split('\n')
  .filter((l) => l.startsWith('D|'))
  .map((l) => {
    const [, i, cls, x, y, auto] = l.split('|');
    return { i: Number(i), cls, x: Number(x), y: Number(y), auto };
  });

console.log(`\n  всего Dial*: ${rows.length}`);
for (const r of rows) {
  const tail = r.auto.split('.').slice(-2).join('.');
  console.log(`    i=${String(r.i).padStart(3)} ${r.cls.padEnd(12)} (${String(r.x).padStart(4)},${String(r.y).padStart(3)})  ${tail}`);
}

// ─── 3. есть ли EqualizerBase и что внутри ───
console.log('\n=== содержимое EqualizerBase ===');
const body2 = [
  '$root = Get-MccRoot',
  '$c = New-Object System.Windows.Automation.PropertyCondition(',
  '  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "EqualizerBase")',
  '$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)',
  'if (-not $win) { Write-Output "НЕТ ОКНА EQ"; exit 0 }',
  '$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'Write-Output ("в окне EQ элементов: " + $all.Count)',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $cls = [string]$e.Current.ClassName',
  '  if ($cls -notmatch "^Dial") { continue }',
  '  $a = [string]$e.Current.AutomationId',
  '  $r = $e.Current.BoundingRectangle',
  '  Write-Output ("Q|" + $i + "|" + $cls + "|" + [int]$r.X + "|" + [int]$r.Y + "|" + $a.Split(".")[-1])',
  '}',
].join('\n');
console.log(ui(body2));
