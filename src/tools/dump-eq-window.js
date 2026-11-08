/**
 * ВСЕ КОНТРОЛЫ ОКНА EQ — с AutomationId.
 *
 * ═══ ПРОБЛЕМА ═══
 *
 * В Prof-режиме dumpTree показывает DialS1M5: 32 штуки — ровно 10 полос
 * по 3 дила. Но map-eq-hp-bands.js нашёл только 2, и оба с AutomationId
 * "frame.widgetDial" (это дилы входа, не EQ-полос).
 *
 * Значит фильтр по классу DialS1M5 не тот, либо окно EQ вложено иначе.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Печатает ВСЕ элементы окна EqualizerBase по порядку, с их AutomationId,
 * классом и позицией. Так видно точную структуру.
 *
 * Запуск: node src/tools/dump-eq-window.js
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

// ─── 1. через dumpTree: какие классы и где ───
console.log('=== элементы окна EQ (по dumpTree) ===');
const { items } = dumpTree();

const eqish = items.filter(
  (x) =>
    (x.cls || '').includes('Equalizer') ||
    (x.cls || '').includes('EqWidget') ||
    (x.cls || '').includes('ComboBoxS1M3') ||
    (x.cls || '') === 'DialS1M5' ||
    (x.cls || '') === 'QCheckBox' ||
    (x.cls || '') === 'Chart',
);

console.log(`  найдено: ${eqish.length}`);
for (const x of eqish) {
  console.log(`  i=${String(x.i).padStart(3)} ${String(x.cls).padEnd(22)} x=${String(x.lx).padStart(4)} y=${String(x.ly).padStart(3)}`);
}

// ─── 2. через прямой запрос: AutomationId всех, у кого он про Equalizer ───
console.log('\n=== элементы с Equalizer в AutomationId ===');
const body = [
  '$root = Get-MccRoot',
  'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
  '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
  'for ($i = 0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $a = [string]$e.Current.AutomationId',
  '  if ($a -notmatch "Equalizer") { continue }',
  '  $r = $e.Current.BoundingRectangle',
  '  $tail = $a.Split(".")[-1]',
  '  Write-Output ("E|" + $i + "|" + $e.Current.ClassName + "|" + $tail + "|" + [int]$r.X + "|" + [int]$r.Y)',
  '}',
].join('\n');

const out = ui(body);
if (!out || out === 'NO_WINDOW') {
  console.log('  окно не найдено');
} else {
  const rows = out
    .split('\n')
    .filter((l) => l.startsWith('E|'))
    .map((l) => {
      const [, i, cls, tail, x, y] = l.split('|');
      return { i: Number(i), cls, tail, x: Number(x), y: Number(y) };
    });

  console.log(`  всего: ${rows.length}\n`);

  // группируем по классу
  const byCls = {};
  for (const r of rows) (byCls[r.cls] = byCls[r.cls] || []).push(r);

  for (const [cls, list] of Object.entries(byCls)) {
    console.log(`--- ${cls} (${list.length})`);
    for (const r of list.slice(0, 14)) {
      console.log(`    i=${String(r.i).padStart(3)} x=${String(r.x).padStart(4)} y=${String(r.y).padStart(3)}  ${r.tail}`);
    }
    if (list.length > 14) console.log(`    ... ещё ${list.length - 14}`);
  }
}
