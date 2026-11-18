/**
 * КАРТА РЕВЕРБА: какие теги 0x44 соответствуют параметрам реверба.
 *
 * ═══ МЕТОД ═══
 *
 * В workspace-INI есть секция `[Effect_Integration]` со ВСЕМИ
 * параметрами реверба, с человеческими именами:
 *
 *     ReverbType=Bypass          тип (Studio/Live/Hall/Bypass)
 *     DryWetBypass=30            dry/wet для текущего типа
 *     DecayBypass=11             decay
 *     WidthBypass=0.7            width
 *     ReverbBypass=4             room
 *     MuteFX=false               заглушка FX
 *
 * А в HID приходят теги 0x44, часть из которых не расшифрована.
 * Сопоставляем по ЗНАЧЕНИЮ: тег, значение которого совпадает
 * с параметром из файла, — кандидат на этот параметр.
 *
 * Это тот же приём, которым расшифрован NC (docs/EFFECTS.md).
 *
 * ═══ ВАЖНО ═══
 *
 * Совпадение по значению — это ГИПОТЕЗА, а не доказательство.
 * Доказательство даёт только движение контрола в UI с последующим
 * снимком: значение нужного тега изменится вместе с ним.
 * Поэтому скрипт печатает кандидатов, а проверка — отдельный шаг.
 *
 * Запуск: node src/tools/map-reverb-tags.js
 */

import HID from 'node-hid';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  buildFrame,
  withReportId,
  parseReport,
  isIdle,
  PP_HANDSHAKE,
  PP_SUBSCRIBE,
  PP_ANNOUNCE,
} from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function findDev() {
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  return all.find((d) => d.interface === 4);
}

async function freshSnapshot(ms = 18000) {
  const dev = findDev();
  if (!dev) throw new Error('M62 не найден');
  const h = new HID.HID(dev.path);
  const send = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  send(0x11, PP_HANDSHAKE, 1);
  await sleep(400);
  send(0x11, PP_SUBSCRIBE, 1);
  await sleep(300);
  send(0x11, PP_ANNOUNCE, 1);

  const out = new Map();
  const t0 = Date.now();
  let lk = Date.now();
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 128; i++) {
      let buf;
      try {
        buf = h.readTimeout(1);
      } catch {
        break;
      }
      if (!buf || !buf.length) break;
      if (isIdle(buf)) continue;
      const f = parseReport(buf);
      if (!f) continue;
      out.set(`${hex2(f.target)}:${hex2(f.prop)}`, f.value);
    }
    if (Date.now() - lk >= 2000) {
      send(0x11, PP_SUBSCRIBE, 1);
      lk = Date.now();
    }
    await sleep(8);
  }
  try {
    h.close();
  } catch { /* ok */ }
  return out;
}

/** Активный workspace из реестра (имя) и путь к INI. */
function activeIni() {
  const key = String.raw`HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62`;
  let name = 'main';
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).M62_Live_Workspace`],
    { encoding: 'utf8', timeout: 15000 }).trim();
    if (out) name = out;
  } catch { /* остаётся main */ }
  return {
    name,
    path: String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_${name}.ini`,
  };
}

function readEffectSection(path) {
  const out = {};
  let cur = null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    const m = t.match(/^\[(.+)\]$/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur !== 'Effect_Integration' || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const ini = activeIni();
  console.log(`workspace: ${ini.name}`);
  const fx = readEffectSection(ini.path);
  console.log(`\n[Effect_Integration] — ${Object.keys(fx).length} ключей`);

  const type = fx.ReverbType ?? '?';
  console.log(`  ReverbType = ${type}`);

  // Для текущего типа берём соответствующий набор параметров.
  const perType = {};
  for (const k of ['DryWet', 'Decay', 'Width', 'Reverb']) {
    perType[k] = fx[`${k}${type}`];
    if (perType[k] !== undefined) {
      console.log(`  ${k}${type} = ${perType[k]}`);
    }
  }
  console.log(`  MuteFX = ${fx.MuteFX}`);
  console.log(`  NoiseReductionNC1 = ${fx.NoiseReductionNC1}  NC2 = ${fx.NoiseReductionNC2}`);
  console.log(`  NoiseReductionType = ${fx.NoiseReductionType}`);

  console.log('\nснимок HID…');
  const snap = await freshSnapshot();

  const fxTags = [...snap.entries()]
    .filter(([k]) => k.startsWith('44:'))
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(`\nтеги 0x44 (${fxTags.length}):`);
  for (const [k, v] of fxTags) {
    console.log(`  0x${k} = ${v}`);
  }

  // --- сопоставление по значению ---
  console.log('\n' + '='.repeat(64));
  console.log('КАНДИДАТЫ (совпадение по значению с параметром из файла)');
  console.log('='.repeat(64));

  const pairs = [];
  for (const [k, v] of fxTags) {
    for (const [name, raw] of Object.entries(perType)) {
      if (raw === undefined) continue;
      const num = Number(raw);
      // width в файле дробный, в теге может быть x100 или x1000
      const variants = [
        num,
        Math.round(num * 10),
        Math.round(num * 100),
        Math.round(num * 1000),
      ].filter(Number.isFinite);

      if (variants.includes(v)) {
        pairs.push({ tag: `0x${k}`, value: v, param: `${name}${type}`, fileValue: raw });
      }
    }
  }

  if (!pairs.length) {
    console.log('  совпадений нет — параметры реверба, вероятно, не отдаются в HID');
  }
  for (const p of pairs) {
    console.log(`  0x${p.tag.slice(2)} = ${p.value}  ->  ${p.param} = ${p.fileValue}`);
  }

  // --- поиск тега типа ---
  console.log('\n' + '='.repeat(64));
  console.log('ЧТО ИЗВЕСТНО ПРО ОСТАЛЬНЫЕ ТЕГИ');
  console.log('='.repeat(64));
  const known = {
    '01': 'FX IN1 level',
    '02': 'FX IN2 level',
    '03': 'FX AUX level',
    '04': 'FX BT level',
    '05': 'FX OTG level',
    '06': 'NC уровень',
    '07': 'NC тип / bypass',
    '09': 'NC код',
    '0d': 'метр FX in',
    '0e': 'метр FX out',
  };
  for (const [k, v] of fxTags) {
    const pp = k.slice(3);
    console.log(`  0x${pp} = ${String(v).padStart(6)}  ${known[pp] ? 'известно: ' + known[pp] : 'НЕ РАСШИФРОВАНО'}`);
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
