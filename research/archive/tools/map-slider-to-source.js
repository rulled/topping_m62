/**
 * КАКОЙ СЛАЙДЕР = КАКОЙ ИСТОЧНИК МИКШЕРА.
 *
 * ═══ ЧТО ИЗВЕСТНО ИЗ ЗАХВАТА ═══
 *
 * Микшер: 10 групп × 20 свойств.
 *   0x31/0x32 = Mix A L/R    0x33/0x34 = Mix B L/R
 *   0x35/0x36 = Mix C L/R    0x37/0x38 = Mix D L/R
 *   0x3b/0x3c = Mix E L/R
 * Свойство 2k-1 = источник k L, свойство 2k = источник k R.
 *
 * Но неизвестно, какой ИСТОЧНИК какому номеру k соответствует.
 * В INI есть 10 секций Mixer_* — ровно 10 источников:
 *   IN12, AUX, BT, OTGIN, FX, PB12, PB34, PB56, PB78, PB910
 *
 * ═══ МЕТОД ═══
 *
 * MCC при закрытии перезаписывает workspace-INI из своей памяти.
 * Значит:
 *   1. закрыть MCC, прочитать INI
 *   2. открыть MCC, подвинуть ОДИН слайдер на +N дБ
 *   3. закрыть MCC, прочитать INI
 *   4. какая секция Mixer_* изменилась -> тот и есть источник
 *
 * Это даёт точное соответствие «слайдер -> источник» без USBPcap.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены — звук физически невозможен.
 * Двигаем ОДИН слайдер на +5 дБ и возвращаем обратно.
 *
 * Запуск: node src/tools/map-slider-to-source.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ps, PRELUDE, dumpTree } from './uia.js';

const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ui = (body) => ps(PRELUDE + body).trim();

/** Все секции Mixer_* из INI, как объект "секция -> {ключ: значение}". */
export function readMixerIni() {
  const txt = readFileSync(INI, 'utf8');
  const out = {};
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) {
      cur = t.slice(1, -1);
      if (/^Mixer_/.test(cur)) out[cur] = {};
      else cur = null;
      continue;
    }
    if (!cur || !t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[cur][t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function mccRunning() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 20000, encoding: 'utf8' });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

function closeMcc() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue; exit 0"],
      { timeout: 30000, encoding: 'utf8' });
  } catch {
    // MCC мог быть уже закрыт — это не ошибка
  }
}

async function openMcc(waitMs = 18000) {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`], {
    timeout: 60000,
    encoding: 'utf8',
  });
  await sleep(waitMs);
}

/** Слайдеры нижнего ряда (микшер). */
function sliders() {
  const { items } = dumpTree();
  return items
    .filter((x) => x.cls === 'QSlider' && x.ly > 700)
    .sort((a, b) => a.lx - b.lx)
    .map((s) => ({ i: s.i, x: s.lx, y: s.ly }));
}

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
  if (!r || r === 'NOPATTERN') return null;
  const [value, min, max] = r.split('|').map(Number);
  return { value, min, max };
}

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

/** Сравнивает два снимка INI, возвращает список изменений. */
function diffMixer(before, after) {
  const changes = [];
  for (const sec of Object.keys(after)) {
    const b = before[sec] || {};
    const a = after[sec];
    for (const key of Object.keys(a)) {
      if (key === 'Mixer_' + sec.replace('Mixer_', '')) continue; // флаг секции
      if (b[key] !== a[key]) {
        changes.push({ section: sec, key, from: b[key], to: a[key] });
      }
    }
  }
  return changes;
}

/** Какие секции изменились. */
async function testSlider(index, label) {
  if (mccRunning()) {
    closeMcc();
    await sleep(3000);
  }
  const before = readMixerIni();

  await openMcc();
  const r = readSlider(index);
  if (!r) {
    console.log(`  ${label}: слайдер ${index} не найден`);
    closeMcc();
    return null;
  }

  const up = Math.min(r.max, r.value + 5);
  setSlider(index, up);
  await sleep(2000);
  const now = readSlider(index);
  console.log(`  ${label}: i=${index}  ${r.value} -> ${up}  (сейчас ${now ? now.value : '?'})`);

  closeMcc();
  await sleep(4000);

  const after = readMixerIni();
  const changes = diffMixer(before, after);
  if (!changes.length) {
    console.log('    изменений в INI нет');
    return null;
  }
  for (const c of changes) {
    console.log(`    ${c.section}.${c.key}: ${c.from} -> ${c.to}`);
  }
  const sections = [...new Set(changes.map((c) => c.section))];
  return { index, sections, changes };
}

async function main() {
  console.log('=== соответствие «слайдер -> источник микшера» ===\n');
  console.log('текущие секции Mixer_*:');
  const ini0 = readMixerIni();
  for (const [sec, kv] of Object.entries(ini0)) {
    const gains = Object.entries(kv)
      .filter(([k]) => /_GAIN$/.test(k))
      .map(([k, v]) => `${k.replace('_GAIN', '')}=${v}`);
    console.log(`  ${sec.padEnd(14)} ${gains.join(' ')}`);
  }

  console.log('\n=== проверяем слайдеры микшера ===');
  const targets = [73, 86, 99, 112];
  const results = [];
  for (const idx of targets) {
    const res = await testSlider(idx, `слайдер ${idx}`);
    if (res) results.push(res);
    await sleep(1000);
  }

  console.log('\n=== ИТОГ ===');
  if (!results.length) {
    console.log('  не удалось связать ни один слайдер с источником');
  }
  for (const r of results) {
    console.log(`  i=${r.index} -> ${r.sections.join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
