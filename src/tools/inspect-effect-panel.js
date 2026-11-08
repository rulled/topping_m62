/**
 * РАЗВЕДКА ПАНЕЛИ ЭФФЕКТОВ (NC / COMP / EXP).
 *
 * ═══ ЧТО ИЩЕМ ═══
 *
 * В MCC есть вкладки эффектов: EQ, NC, COMP, EXP (найдено в строках exe):
 *
 *     Expander_IN1 / Expander_IN2
 *     Denoise_IN1 / Denoise_IN2
 *     Compressor_IN1 / Compressor_IN2
 *
 * В workspace-INI из них есть только Compressor и (в Mobile) Effect_NC.
 * Значит Expander и Denoise живут ТОЛЬКО в устройстве, и их теги
 * мы ещё не видели. Гипотеза: это блок 0xa1..0xaa.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Находит панель эффектов в UI MCC.
 * 2. Показывает вкладки и их названия.
 * 3. Читает значения дилов — чтобы потом связать их с тегами.
 *
 * Запуск: node src/tools/inspect-effect-panel.js
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const ui = (body) => ps(PRELUDE + body).trim();

/** Все элементы, похожие на панель эффектов. */
function effectElements() {
  const { items } = dumpTree();
  return items.filter(
    (x) =>
      (x.cls || '').includes('Effect') ||
      (x.cls || '') === 'Chart' ||
      (x.cls || '').startsWith('DialS1M1'),
  );
}

/** Подробности элемента по индексу. */
function details(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    'if (-not $e) { Write-Output "NO_ELEMENT"; exit 0 }',
    'Write-Output ("cls=" + $e.Current.ClassName)',
    'Write-Output ("name=" + $e.Current.Name)',
    'Write-Output ("auto=" + $e.Current.AutomationId)',
    'Write-Output ("rect=" + $e.Current.BoundingRectangle)',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ("range=" + $rv.Current.Value + " [" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]" + ($(if ($rv.Current.IsReadOnly) { " read-only" } else { "" })))',
    '}',
    '$t = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$t)) {',
    '  $tp = [System.Windows.Automation.TogglePattern]$t',
    '  Write-Output ("toggle=" + $tp.Current.ToggleState)',
    '}',
  ].join('\n');
  return ui(body);
}

async function main() {
  console.log('=== элементы панели эффектов ===\n');
  const els = effectElements();
  for (const e of els) {
    console.log(`  cls=${String(e.cls).padEnd(20)} i=${String(e.i).padStart(3)} (${e.lx},${e.ly})`);
  }

  console.log('\n=== подробности ключевых ===');
  // берём только Effect*/Chart/DialS1M1 с y в области панели (>=600)
  const keys = els.filter((e) => e.ly >= 600 || (e.cls || '').startsWith('Effect'));
  for (const e of keys) {
    console.log(`\n--- i=${e.i} cls=${e.cls}`);
    const d = details(e.i);
    for (const line of d.split('\n')) {
      if (line.trim()) console.log(`    ${line.trim()}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
