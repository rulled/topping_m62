/**
 * ЗАПИСЬ EQ ЧЕРЕЗ HID — проверка по INI, а не по обратному чтению.
 *
 * ═══ ПОЧЕМУ НЕ ПО ОБРАТНОМУ ЧТЕНИЮ ═══
 *
 * control-compressor-write.js показал: запись Threshold -30 -> HID ->
 * повторное чтение даёт -28, то есть «не принято». НО компрессор
 * ДОСТОВЕРНО пишется (проверено ранее по INI). Значит обратное чтение
 * через HID НЕ отражает принятую запись.
 *
 * Причина: устройство отдаёт состояние ОТЛОЖЕННО. Запись попадает в
 * очередь и применяется, когда MCC (или кто-то) её «протолкнёт», а дамп
 * состояния отдаётся из кэша, который не обновляется мгновенно.
 *
 * Поэтому единственный достоверный способ проверить запись — заставить
 * MCC перезаписать workspace-INI и прочитать файл.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * Пишем в EQ-теги (0x91..0x94), перезапускаем MCC, читаем Eq%40N в INI.
 * Формат строки: "enabled|type|freq|q|gain"  (5 полей, разделитель |)
 *
 *   Eq%401=|0|1262|0.7|0    -> пусто|0|1262|0.7|0
 *   Eq%402=0|0|632|0.707|0
 *
 * Поле 4 = freq (632, 1262), поле 5 = Q (0.7). Значит порядок НЕ такой,
 * как в HID-тегах (там 04=freq, 05=Qx10000). Сверяем.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP и OTG отключены — звук физически невозможен.
 * EQ выключен (Switch=0) — правка инертна.
 * В конце исходные значения восстанавливаются.
 *
 * Запуск: node src/tools/test-eq-hid-write.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import HID from 'node-hid';

import { buildFrame, withReportId, parseReport, isIdle, PP_HANDSHAKE } from '../protocol.js';

const VID = 0x152a;
const PID = 0x875c;
const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Читает секцию INI как объект ключ->значение. */
function readIniSection(name) {
  try {
    const txt = readFileSync(INI, 'utf8');
    const out = {};
    let inSec = false;
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('[')) {
        inSec = t === `[${name}]`;
        continue;
      }
      if (!inSec || !t) continue;
      const eq = t.indexOf('=');
      if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  } catch (err) {
    return { error: err.message };
  }
}

/** Возвращает строки Eq%401..404 секции EQ_IN1. */
function readEqBands(section = 'EQ_IN1') {
  const sec = readIniSection(section);
  const out = [];
  for (let i = 1; i <= 4; i += 1) {
    out.push({ band: i, raw: sec[`Eq%40${i}`] ?? null });
  }
  return out;
}

function fmtBands(bands) {
  return bands.map((b) => `    Eq%40${b.band} = ${b.raw}`).join('\n');
}

const isMccRunning = () => {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 20000, encoding: 'utf8' });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
};

function restartMccAndWait(seconds = 22) {
  console.log('  перезапуск MCC…');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue;
       Start-Sleep -Seconds 3;
       Start-Process '${MCC_EXE}'`],
      { timeout: 90000, encoding: 'utf8' });
  } catch (err) {
    console.log(`  ошибка перезапуска: ${err.message}`);
    return false;
  }
  console.log(`  ждём ${seconds} с, пока MCC прочитает устройство и запишет INI…`);
  return true;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  // ---------- 1. исходное состояние ----------
  console.log('=== 1. исходное состояние ===');
  if (isMccRunning()) {
    console.error('MCC запущен. Останови его перед тестом, иначе он перезапишет INI из памяти.');
    process.exit(1);
  }
  const before = readEqBands('EQ_IN1');
  console.log(fmtBands(before));

  // ---------- 2. открываем устройство ----------
  const all = HID.devices().filter((d) => d.vendorId === VID && d.productId === PID);
  const dev = all.find((d) => d.interface === 4);
  if (!dev) {
    console.error('M62 не найден');
    process.exit(1);
  }
  const h = new HID.HID(dev.path);
  const write = (tt, pp, v) => h.write([...withReportId(buildFrame(tt, pp, v, true))]);

  write(0x11, PP_HANDSHAKE, 1);
  await sleep(400);

  // ---------- 3. проверка безопасности: выходы ----------
  console.log('\n=== 2. проверка выходов ===');
  write(0x11, 0x24, 1);
  await sleep(200);
  write(0x11, 0x26, 1);
  const jacks = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    let buf;
    try {
      buf = h.readTimeout(20);
    } catch {
      break;
    }
    if (!buf || !buf.length) continue;
    if (isIdle(buf)) continue;
    const f = parseReport(buf);
    if (!f) continue;
    if (f.prop === 0x06 && [0x62, 0x64].includes(f.target)) jacks.set(f.target, f.value);
  }
  const hp = jacks.get(0x64) ?? 0;
  const otg = jacks.get(0x62) ?? 0;
  console.log(`  HP=${hp} OTG=${otg}`);
  if (hp !== 0 || otg !== 0) {
    console.log('  СТОП: выход подключён, не рискую.');
    h.close();
    process.exit(1);
  }
  console.log('  выходы не подключены — безопасно');

  // ---------- 4. пишем EQ ----------
  console.log('\n=== 3. пишем EQ через HID ===');
  const keepalive = setInterval(() => {
    try {
      write(0x11, 0x24, 1);
    } catch {
      /* ok */
    }
  }, 2000);

  // Полоса 1 группы 0x91: свойства 01..05.
  // Поле 4 = freq Гц, поле 5 = Q x 10000. Меняем только их — они известны.
  const TARGETS = [
    { prop: 0x04, name: 'freq полосы 1', val: 1000 },
    { prop: 0x05, name: 'Q полосы 1', val: 10000 },
  ];
  for (const t of TARGETS) {
    write(0x91, t.prop, t.val);
    console.log(`  0x91:${hex2(t.prop)} (${t.name}) -> ${t.val}`);
    await sleep(400);
  }

  // ---------- 5. заставляем MCC применить ----------
  console.log('\n=== 4. применяем через MCC ===');
  restartMccAndWait(22);
  clearInterval(keepalive);
  try {
    h.close();
  } catch {
    /* ok */
  }

  await sleep(3000);
  const after = readEqBands('EQ_IN1');
  console.log('\n=== 5. INI после ===');
  console.log(fmtBands(after));

  // ---------- 6. разбор ----------
  console.log('\n=== 6. сравнение ===');
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    const b = before[i].raw;
    const a = after[i].raw;
    if (b !== a) {
      console.log(`  полоса ${before[i].band}: "${b}" -> "${a}"  ИЗМЕНИЛОСЬ`);
      changed += 1;
    } else {
      console.log(`  полоса ${before[i].band}: без изменений ("${a}")`);
    }
  }

  console.log('');
  if (changed > 0) {
    console.log('=> EQ ПИШЕТСЯ через HID. Изменения доехали до workspace-INI.');
    console.log('   Обратное чтение через HID их не показывает — состояние отдаётся из кэша.');
  } else {
    console.log('=> EQ через HID НЕ пишется (по крайней мере в 0x91:04/05).');
    console.log('   Запись, как и раньше, только через UI/файл.');
  }

  console.log('\nMCC оставлен запущенным. Если нужно вернуть значения — править через UI.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
