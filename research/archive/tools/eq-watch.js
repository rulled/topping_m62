/**
 * ПЕРЕХВАТ ОКНА EQ — снимок состояния и дифф.
 *
 * Использование:
 *   node src/tools/eq-watch.js snap <метка>   — снять состояние
 *   node src/tools/eq-watch.js diff <a> <b>   — сравнить два снимка
 *   node src/tools/eq-watch.js show           — показать текущее
 *
 * Снимает:
 *   - все 4 полосы: тип, gain, freq, Q (из UI через UIA и из файла)
 *   - состояние Switch (TogglePattern)
 *   - значения полей выходов
 *   - файл workspace целиком (EQ-секции)
 */
import { ps, PRELUDE, dumpTree } from './uia.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SNAP_DIR = String.raw`research\eq-snaps`;

function psx(cmd) {
  try { return ps(cmd); } catch { return ''; }
}

/** Описание дочерних элементов комбобокса (тип фильтра). */
function comboValue(items, combo) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${combo.i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value } else { Write-Output "" }',
  ].join('\n');
  return psx(RAW);
}

/** Описание элемента: Value + RangeValue + Toggle. */
function describe(idx) {
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${idx})`,
    '$o = @()',
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $o += "V=" + ([System.Windows.Automation.ValuePattern]$p).Current.Value }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$p)) { $rv = [System.Windows.Automation.RangeValuePattern]$p; $o += "R=" + $rv.Current.Value + "[" + $rv.Current.Minimum + ".." + $rv.Current.Maximum + "]" }',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $o += "T=" + ([System.Windows.Automation.TogglePattern]$p).Current.ToggleState }',
    'if ($o.Count -eq 0) { Write-Output "" } else { Write-Output ($o -join " ") }',
  ].join('\n');
  return psx(RAW);
}

/** Собрать полный снимок EQ. */
export function captureEq() {
  const { items } = dumpTree();
  const out = {
    at: new Date().toISOString(),
    elements: items.length,
    eqWindowOpen: items.some((x) => /EqualizerPanel/.test(x.cls ?? '')),
    bands: [],
    switches: {},
    file: {},
  };

  // ── полосы: тип из UI, значения из файла ──
  // DialS1M5 не имеет ValuePattern, а числа MCC не рисует как QLabel,
  // поэтому единственный ИСТОЧНИК значений — workspace-файл.
  const typeCombos = items.filter((x) => /ComboBoxS1M3/.test(x.cls ?? '')).sort((a, b) => a.lx - b.lx);
  const panel = items.find((x) => /EqualizerPanel/.test(x.cls ?? ''));
  const eqDials = items.filter((x) => /Dial/.test(x.cls ?? ''));

  let fileEq = {};
  try {
    const w = findActiveWorkspace();
    const ini = readWorkspace(w.path);
    out.workspace = `${w.mode}/${w.name}`;
    fileEq = ini.EQ_IN1 ?? {};
    for (const sec of ['EQ_IN1', 'EQ_IN2', 'EQ_HP']) {
      if (!ini[sec]) continue;
      const kv = {};
      for (const [k, v] of Object.entries(ini[sec])) {
        if (/^Eq%40|^Switch$|^Gain(Input|Output)$/.test(k)) kv[k] = v;
      }
      out.file[sec] = kv;
    }
  } catch (e) {
    out.fileError = String(e.message);
  }

  /** Разобрать строку полосы — формат зависит от числа полей.
   *
   * ДВА ФОРМАТА (обнаружено):
   *   |тип|частота|Q|gain|   — 4 поля, начинается с '|'  (EQ_IN1/IN2 «старый»)
   *   тип|gain|частота|Q|флаг — 5 полей                     (EQ_HP и «новый» EQ_IN)
   */
  const parseBandStr = (s) => {
    const str = String(s ?? '');
    const p = str.split('|').filter((x) => x !== '');
    if (p.length >= 5) {
      // тип|gain|частота|Q|флаг
      return { fmt: 'hp', type: p[0], gain: p[1], freq: p[2], q: p[3], flag: p[4] };
    }
    // |тип|частота|Q|gain|
    return { fmt: 'in', type: p[0], freq: p[1], q: p[2], gain: p[3] };
  };

  for (let i = 0; i < 4; i++) {
    const combo = typeCombos[i];
    const x = combo ? combo.lx : null;
    const raw = fileEq[`Eq%40${i + 1}`] ?? null;
    const parsed = raw ? parseBandStr(raw) : {};

    const baseY = panel ? panel.ly : 0;
    const gainDial = x !== null ? eqDials.find((d) => Math.abs(d.lx - x) < 20 && Math.abs(d.ly - (baseY + 34)) < 25) : null;
    const freqDial = x !== null ? eqDials.find((d) => Math.abs(d.lx - x) < 20 && Math.abs(d.ly - (baseY + 112)) < 25) : null;
    const qDial = x !== null ? eqDials.find((d) => Math.abs(d.lx - x) < 20 && Math.abs(d.ly - (baseY + 190)) < 25) : null;

    out.bands.push({
      band: i + 1,
      raw,
      uiType: combo ? comboValue(items, combo) : null,
      fileType: parsed.type ?? null,
      fileFreq: parsed.freq ?? null,
      fileQ: parsed.q ?? null,
      fileGain: parsed.gain ?? null,
      dials: {
        gain: gainDial ? [gainDial.lx, gainDial.ly] : null,
        freq: freqDial ? [freqDial.lx, freqDial.ly] : null,
        q: qDial ? [qDial.lx, qDial.ly] : null,
      },
    });
  }

  // ── кнопки-переключатели (EQ Switch у входов) ──
  const toggles = items.filter((x) => /QPushButton/.test(x.cls ?? '') && x.ly > 100 && x.ly < 400 && x.lx < 700);
  for (const t of toggles) {
    const d = describe(t.i);
    if (d.includes('T=')) out.switches[`@(${t.lx},${t.ly})`] = d;
  }

  return out;
}

// ── CLI ──
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const cmd = process.argv[2] ?? 'show';

  if (cmd === 'snap') {
    const label = process.argv[3] ?? 'snap';
    if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
    const data = captureEq();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(SNAP_DIR, `${stamp}_${label}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    console.log(`снимок сохранён: ${path}`);
    printEq(data);
  } else if (cmd === 'diff') {
    const a = process.argv[3];
    const b = process.argv[4];
    if (!a || !b) { console.log('нужно: diff <файлA> <файлB>'); process.exit(1); }
    const pa = a.includes('\\') ? a : join(SNAP_DIR, a);
    const pb = b.includes('\\') ? b : join(SNAP_DIR, b);
    const da = JSON.parse(readFileSync(pa, 'utf8'));
    const db = JSON.parse(readFileSync(pb, 'utf8'));
    printDiff(da, db);
  } else {
    printEq(captureEq());
  }
}

function printEq(d) {
  console.log(`\nснимок: ${d.at}`);
  console.log(`workspace: ${d.workspace ?? '?'}   окно EQ: ${d.eqWindowOpen ? 'открыто' : 'закрыто'}   элементов: ${d.elements}`);
  console.log('\nполосы (значения из ФАЙЛА, тип из UI):');
  for (const b of d.bands) {
    console.log(`  ${b.band}: UI=${String(b.uiType).padEnd(10)} файл: тип=${b.fileType} gain=${b.fileGain} freq=${b.fileFreq} Q=${b.fileQ}`);
    console.log(`     raw = ${b.raw}`);
  }
  console.log('\nпереключатели (Toggle):');
  for (const [k, v] of Object.entries(d.switches ?? {})) console.log(`  ${k}: ${v}`);
  console.log('\nфайл:');
  for (const [sec, kv] of Object.entries(d.file ?? {})) {
    console.log(`  [${sec}]`);
    for (const [k, v] of Object.entries(kv)) console.log(`    ${k} = ${v}`);
  }
}

function printDiff(a, b) {
  console.log(`\nДИФФ: ${a.at} -> ${b.at}`);
  let n = 0;

  for (let i = 0; i < Math.max(a.bands.length, b.bands.length); i++) {
    const ba = a.bands[i];
    const bb = b.bands[i];
    if (!ba || !bb) continue;
    for (const [field, label] of [['uiType', 'UI-тип'], ['fileType', 'файл-тип'], ['fileGain', 'gain'], ['fileFreq', 'freq'], ['fileQ', 'Q']]) {
      if (String(ba[field]) !== String(bb[field])) {
        console.log(`  полоса ${ba.band}.${label}: "${ba[field]}" -> "${bb[field]}"`);
        n++;
      }
    }
  }

  const ka = Object.keys(a.switches ?? {});
  const kb = Object.keys(b.switches ?? {});
  for (const k of new Set([...ka, ...kb])) {
    if (String(a.switches?.[k]) !== String(b.switches?.[k])) {
      console.log(`  switch ${k}: "${a.switches?.[k]}" -> "${b.switches?.[k]}"`);
      n++;
    }
  }

  const secs = new Set([...Object.keys(a.file ?? {}), ...Object.keys(b.file ?? {})]);
  for (const s of secs) {
    const fa = a.file?.[s] ?? {};
    const fb = b.file?.[s] ?? {};
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (String(fa[k]) !== String(fb[k])) {
        console.log(`  файл ${s}.${k}: "${fa[k]}" -> "${fb[k]}"`);
        n++;
      }
    }
  }

  console.log(n === 0 ? '\n  изменений нет' : `\n  всего изменений: ${n}`);
}
