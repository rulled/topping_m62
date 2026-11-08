/**
 * СЦЕНАРИЙ ДЛЯ USBPcap: подвигать микшер, пока идёт запись трафика.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Микшер (0x31..0x36) — единственное крупное белое пятно. Устройство не
 * отдаёт кросспоинты ни в дампе, ни эхом после записи. Значит единственный
 * способ узнать настоящие адреса — подсмотреть, что шлёт сам MCC, когда
 * пользователь двигает слайдер.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * 1. Открывает MCC и окно микшера.
 * 2. Находит слайдер Mix A для первого входа.
 * 3. Двигает его на +3 дБ, ждёт, возвращает назад.
 * 4. Повторяет для 2-3 слайдеров с паузами (USBPcap пишет всё это время).
 *
 * Всё это время пользователь НЕ трогает мышь — скрипт управляет сам.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены — звук физически невозможен.
 * Значения меняются на ±3 дБ от текущего и возвращаются обратно.
 *
 * Запуск: node src/tools/drive-mixer-for-capture.js
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

/** Находит все слайдеры микшера. */
function mixerSliders() {
  const { items } = dumpTree();
  const sliders = items
    .filter((x) => x.cls === 'QSlider' && x.ly > 450 && x.ly < 620 && x.lx > 1100)
    .sort((a, b) => a.lx - b.lx);
  return sliders.map((s) => ({ i: s.i, x: s.lx, y: s.ly }));
}

/** Читает значение слайдера через RangeValuePattern. */
function readSlider(index) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    '  Write-Output ($rv.Current.Value.ToString() + "|" + $rv.Current.Minimum.ToString() + "|" + $rv.Current.Maximum.ToString())',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  const r = ui(body);
  if (r === 'NOPATTERN' || !r) return null;
  const [v, mn, mx] = r.split('|').map(Number);
  return { value: v, min: mn, max: mx };
}

/** Ставит значение слайдера через RangeValuePattern. */
function setSlider(index, value) {
  const body = [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${index})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) {',
    '  $rv = [System.Windows.Automation.RangeValuePattern]$p',
    `  $rv.SetValue([double]${value})`,
    '  Write-Output "OK"',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ui(body);
}

async function main() {
  console.log('=== микшер: подготовка ===');
  const sliders = mixerSliders();
  console.log(`  найдено слайдеров: ${sliders.length}`);
  if (!sliders.length) {
    console.error('  Слайдеры не найдены. Открой окно микшера в MCC вручную и повтори.');
    process.exit(1);
  }

  // первые 3 слайдера — левая часть матрицы
  const targets = sliders.slice(0, 3);
  const originals = [];
  for (const t of targets) {
    const r = readSlider(t.i);
    originals.push(r);
    console.log(`  слайдер #${t.i} (${t.x},${t.y}): значение ${r ? r.value : '?'} диапазон ${r ? `${r.min}..${r.max}` : '?'}`);
  }

  console.log('\n=== движения (USBPcap должен уже писать) ===');
  await sleep(2000);

  for (let k = 0; k < targets.length; k += 1) {
    const t = targets[k];
    const orig = originals[k];
    if (!orig) continue;

    // +3 дБ или +10% от диапазона, не выходя за предел
    const step = Math.max(1, (orig.max - orig.min) * 0.05);
    const up = Math.min(orig.max, orig.value + step);

    console.log(`\n  слайдер #${t.i}: ${orig.value} -> ${up.toFixed(1)}`);
    setSlider(t.i, up);
    await sleep(1800);

    console.log(`  слайдер #${t.i}: возврат -> ${orig.value}`);
    setSlider(t.i, orig.value);
    await sleep(1800);
  }

  console.log('\n=== пауза 2 с (хвост трафика) ===');
  await sleep(2000);

  console.log('\nготово. Останови захват USBPcap (Ctrl+C в его окне).');
  console.log('дальше:');
  console.log('  node src/tools/analyze-usbpcap.js <файл.pcap>');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
