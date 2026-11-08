/**
 * ВСЕ КОНТРОЛЫ ПАНЕЛИ NC — с AutomationId.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * dumpTree() не сохраняет AutomationId, поэтому по нему не найти.
 * А именно он даёт осмысленные имена: dialThreshold, dialGain,
 * widgetCompress, Effect_NC и т.д.
 *
 * В Mobile-режиме панель эффектов содержит ТРИ секции:
 *     Effect_NC          шумоподавление
 *     Effect_Compressor  компрессор
 *     Effect_Reverb      реверб
 *
 * Нам нужен NC — потому что в workspace-INI он есть (Effect_NC),
 * а тегов в потоке мы его не знали. Гипотеза: это 0x44:06..0x0f.
 *
 * Запуск: node src/tools/list-nc-controls.js
 */

import { ps, PRELUDE } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

const main = () => {
  const body = [
    '$root = Get-MccRoot',
    'if (-not $root) { Write-Output "NO_WINDOW"; exit 0 }',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    'for ($i = 0; $i -lt $all.Count; $i++) {',
    '  $e = $all.Item($i)',
    '  $a = $e.Current.AutomationId',
    '  if (-not $a) { continue }',
    '  if ($a -notmatch "Effect_") { continue }',
    '  $tail = ($a -split "\\.")[-1]',
    '  $parent = ""',
    '  $parts = $a -split "\\."',
    '  if ($parts.Count -ge 2) { $parent = $parts[$parts.Count - 2] }',
    '  $val = ""',
    '  $p = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '    $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '    $val = "range=" + $rv.Current.Value + " [" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]"',
    '  }',
    '  $t = $null',
    '  if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '    $tp = [System.Windows.Automation.TogglePattern]$t',
    '    $val = $val + " toggle=" + $tp.Current.ToggleState',
    '  }',
    '  Write-Output ("ROW|" + $i + "|" + $e.Current.ClassName + "|" + $parent + "|" + $tail + "|" + $val)',
    '}',
  ].join('\n');

  const out = ui(body);
  if (!out || out === 'NO_WINDOW') {
    console.log('окно MCC не найдено');
    return;
  }

  const rows = out
    .split('\n')
    .filter((l) => l.startsWith('ROW|'))
    .map((l) => {
      const [, i, cls, parent, tail, val] = l.split('|');
      return { i: Number(i), cls, parent, tail, val };
    });

  // группируем по родителю
  const groups = {};
  for (const r of rows) {
    const key = r.parent || '(корень)';
    (groups[key] = groups[key] || []).push(r);
  }

  console.log(`всего контролов эффектов: ${rows.length}\n`);
  for (const [parent, items] of Object.entries(groups)) {
    console.log(`=== ${parent} (${items.length}) ===`);
    for (const it of items) {
      const v = it.val ? `  ${it.val}` : '';
      console.log(`  i=${String(it.i).padStart(3)}  ${it.cls.padEnd(18)} ${it.tail.padEnd(20)}${v}`);
    }
    console.log('');
  }
};

main();
