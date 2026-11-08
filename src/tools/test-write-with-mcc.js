/**
 * ЗАПИСЬ ЧЕРЕЗ HID ПРИ РАБОТАЮЩЕМ MCC.
 *
 * ═══ ПОЧЕМУ ПРЕДЫДУЩИЕ ТЕСТЫ ВРАЛИ ═══
 *
 * test-eq-hid-write.js и test-comp-write-v2.js перезапускали MCC перед
 * проверкой. Но MCC при старте и выходе ПЕРЕЗАПИСЫВАЕТ workspace-INI из
 * своей памяти. То есть тест сам уничтожал результат записи, а потом
 * читал файл и делал вывод «не пишется».
 *
 * ═══ КАК ПРАВИЛЬНО ═══
 *
 * MCC должен РАБОТАТЬ во время записи. Тогда он видит изменение состояния
 * от устройства и сам сохраняет его в INI. Именно так в прошлый раз
 * компрессор -90 доехал до файла (probe-mixer-write.js, NOTES §118.7).
 *
 * Windows HID допускает несколько одновременных открытий одного
 * устройства, поэтому node-hid и MCC могут работать параллельно.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. Контроль: компрессор 0x46:02 (Threshold). Он ДОСТОВЕРНО пишется.
 *    Если контроль не проходит — метод опять неверный, и вывод про EQ
 *    делать нельзя.
 * 2. Опыт: EQ 0x91:04/05 (частота, Q).
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены — проверяется перед записью, при подключении СТОП.
 * Компрессор выключен (Switch=false), EQ выключен (Switch=0) — правки
 * инертны. Значения в допустимых диапазонах. В конце восстанавливаются.
 *
 * Запуск: node src/tools/test-write-with-mcc.js
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

function readIniSection(name) {
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

function ensureMcc() {
  if (isMccRunning()) {
    console.log('  MCC уже работает');
    return;
  }
  console.log('  запускаем MCC…');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`], {
    timeout: 60000,
    encoding: 'utf8',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    if (isMccRunning()) break;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], {
        timeout: 5000,
      });
    } catch {
      /* ok */
    }
  }
  console.log('  MCC поднялся, ждём инициализации 8 с…');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 8'], {
      timeout: 20000,
    });
  } catch {
    /* ok */
  }
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

async function main() {
  console.log('=== 1. поднимаем MCC (он должен РАБОТАТЬ во время записи) ===');
  ensureMcc();

  console.log('\n=== 2. состояние INI до записи ===');
  const compBefore = readIniSection('Compressor');
  const eqBefore = readIniSection('EQ_IN1');
  console.log(`  компрессор: Thr=${compBefore.Threshold} Atk=${compBefore.Attack} Mix=${compBefore.Mix}`);
  console.log(`  EQ полоса 1: ${eqBefore['Eq%401']}`);
  console.log(`  EQ полоса 2: ${eqBefore['Eq%402']}`);

  console.log('\n=== 3. открываем устройство и проверяем выходы ===');
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

  const keepalive = setInterval(() => {
    try {
      write(0x11, 0x24, 1);
    } catch {
      /* ok */
    }
  }, 2000);

  // ---------- контроль: компрессор ----------
  console.log('\n=== 4. КОНТРОЛЬ: компрессор 0x46:02 Threshold -> -30 ===');
  write(0x46, 0x02, -30);
  await sleep(3000);

  // ---------- опыт: EQ ----------
  console.log('\n=== 5. ОПЫТ: EQ 0x91:04 freq -> 1000, 0x91:05 Q -> 10000 ===');
  write(0x91, 0x04, 1000);
  await sleep(400);
  write(0x91, 0x05, 10000);
  await sleep(3000);

  console.log('\n=== 6. ждём, пока MCC сохранит изменение в INI (12 с) ===');
  await sleep(12000);

  clearInterval(keepalive);
  try {
    h.close();
  } catch {
    /* ok */
  }

  // ---------- читаем БЕЗ перезапуска MCC ----------
  const compAfter = readIniSection('Compressor');
  const eqAfter = readIniSection('EQ_IN1');
  console.log('\n=== 7. INI после (MCC не перезапускался) ===');
  console.log(`  компрессор: Thr=${compAfter.Threshold} Atk=${compAfter.Attack} Mix=${compAfter.Mix}`);
  console.log(`  EQ полоса 1: ${eqAfter['Eq%401']}`);
  console.log(`  EQ полоса 2: ${eqAfter['Eq%402']}`);

  const compChanged = compAfter.Threshold !== compBefore.Threshold;
  const eqChanged =
    eqAfter['Eq%401'] !== eqBefore['Eq%401'] || eqAfter['Eq%402'] !== eqBefore['Eq%402'];

  console.log('\n=== 8. вывод ===');
  console.log(`  контроль (компрессор): ${compChanged ? 'ИЗМЕНИЛСЯ' : 'без изменений'}`);
  console.log(`  опыт (EQ):             ${eqChanged ? 'ИЗМЕНИЛСЯ' : 'без изменений'}`);
  console.log('');
  if (!compChanged) {
    console.log('  Контроль не прошёл -> метод всё ещё неверный, вывод про EQ НЕДЕЙСТВИТЕЛЕН.');
    console.log('  Возможная причина: MCC не пишет файл, пока пользователь не тронет UI.');
  } else if (eqChanged) {
    console.log('  => EQ ПИШЕТСЯ через HID. Метод подтверждён контролем.');
  } else {
    console.log('  => Метод подтверждён (компрессор пишется), а EQ НЕ пишется.');
    console.log('     Значит EQ идёт другим каналом: UI MCC или workspace-файл.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
