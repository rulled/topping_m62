/**
 * ЧТЕНИЕ СЛАЙДЕРОВ МИКШЕРА — актуальные координаты.
 *
 * ═══ ЧТО ИСПРАВЛЕНО ═══
 *
 * read-mixer-ui.js искал слайдеры по жёстким координатам
 * (ly > 450 && ly < 620 && lx > 1100) и находил НОЛЬ. Координаты
 * устарели после смены разрешения/раскладки.
 *
 * Проверено 2026-11-08 при 1920x1080: слайдеры микшера сидят на y=776,
 * x от 834 до 1417. Контейнер FieldMixerS1M1 — x=1214, y=290.
 *
 * Поэтому ищем по КЛАССУ в области ниже y=700, а не по магии чисел.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Нужно уметь двигать слайдер микшера программно, чтобы снять
 * USBPcap-трафик при известном действии. Тогда diff даст настоящие
 * адреса кросспоинтов.
 *
 * Запуск: node src/tools/mixer-sliders.js           — только показать
 *         node src/tools/mixer-sliders.js --move    — подвигать
 */

import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

/** Слайдеры микшера: нижний ряд, правее центра. */
export function mixerSliders() {
  const { items } = dumpTree();
  return items
    .filter((x) => x.cls === 'QSlider' && x.ly > 700)
    .sort((a, b) => a.lx - b.lx)
    .map((s) => ({ i: s.i, x: s.lx, y: s.ly }));
}

/** Получить значение, минимум и максимум слайдера. */
export function readSlider(index) {
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
  if (!r || r === 'NOPATTERN') return null;
  const [value, min, max] = r.split('|').map(Number);
  return { value, min, max };
}

/** Установить значение слайдера. */
export function setSlider(index, value) {
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

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/')
      .toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  const move = process.argv.includes('--move');

  // --ids 73,86,99 — двигать конкретные слайдеры (по умолчанию только первый)
  const idsArg = process.argv.indexOf('--ids');
  const wantIds =
    idsArg >= 0 && process.argv[idsArg + 1]
      ? process.argv[idsArg + 1].split(',').map((s) => Number(s.trim()))
      : null;

  const sl = mixerSliders();
  console.log(`слайдеров найдено: ${sl.length}\n`);

  const info = [];
  for (const s of sl) {
    const r = readSlider(s.i);
    info.push({ ...s, r });
    const mark = wantIds && wantIds.includes(s.i) ? '  <-- цель' : '';
    console.log(
      `  i=${String(s.i).padStart(3)}  (${String(s.x).padStart(4)},${s.y})  ` +
        (r ? `значение ${r.value}  диапазон ${r.min}..${r.max}` : 'нет RangeValuePattern') +
        mark,
    );
  }

  if (!move) {
    console.log('\nдобавь --move, чтобы подвигать.');
    process.exit(0);
  }

  // какие двигать
  const targets = wantIds
    ? info.filter((x) => wantIds.includes(x.i) && x.r)
    : info.filter((x) => x.r).slice(0, 1);

  if (!targets.length) {
    console.error('нечего двигать');
    process.exit(1);
  }

  console.log(`\n=== двигаем ${targets.length} слайдер(ов) ===`);
  for (const t of targets) {
    const { r, i } = t;
    const step = Math.max(1, Math.round((r.max - r.min) * 0.05));
    const up = Math.min(r.max, r.value + step);

    console.log(`\ni=${i}: ${r.value} -> ${up}`);
    setSlider(i, up);
    await sleep(1800);
    console.log(`  сейчас: ${JSON.stringify(readSlider(i))}`);

    console.log(`i=${i}: возврат -> ${r.value}`);
    setSlider(i, r.value);
    await sleep(1800);
    console.log(`  сейчас: ${JSON.stringify(readSlider(i))}`);
  }
}
