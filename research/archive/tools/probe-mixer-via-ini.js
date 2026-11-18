/**
 * ПРОВЕРКА: применилась ли запись микшера через bulk push.
 *
 * ═══ ПРОБЛЕМА ПРОВЕРКИ ═══
 *
 * Микшер не читается обратно: в IN-потоке его нет вообще (только метры
 * 0x3x:0x15). Значит единственный способ узнать, применилась ли запись —
 * заставить MCC прочитать состояние из устройства и сохранить в INI.
 *
 * Но MCC при СТАРТЕ не читает микшер из устройства — он берёт его из
 * своего файла. А при ЗАКРЫТИИ перезаписывает файл своей памятью.
 *
 * Значит проверка такая:
 *   1. Правим INI напрямую: ставим MixB_GAIN для источника в -20.
 *   2. Запускаем MCC — он читает -20 из файла и шлёт bulk push в устройство.
 *   3. Захватываем этот push через USBPcap.
 *   4. Смотрим, какой тег стал -20 -> вот тебе точное соответствие
 *      «источник -> свойство».
 *
 * Это НЕ тест нашей записи, а тест РАЗМЕТКИ. Он даёт то, чего не хватает:
 * какой номер свойства соответствует какому входу.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * HP/OTG отключены. Значение -20 дБ (тише unity). INI восстанавливается.
 *
 * Запуск: node src/tools/probe-mixer-via-ini.js
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const INI = path.join(
  'C:\\Program Files\\TOPPING Pro\\M Control Center\\Workspace\\M62\\Live',
  'M62_Live_main.ini',
);
const BAK = INI + '.bak-mixer-probe';
const MCC_EXE = 'C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Читает секцию INI как объект. */
function readSection(name) {
  const txt = readFileSync(INI, 'utf8');
  const out = {};
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) {
      cur = t.slice(1, -1) === name ? name : null;
      continue;
    }
    if (!cur || !t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Правит одно значение в INI, сохраняя UTF-8 BOM.
 *
 * ВАЖНО: Set-Content -Encoding utf8 в PowerShell пишет другой BOM и ломает
 * файл. Правильный путь — ReadAllText/WriteAllText с явным UTF8Encoding(true).
 */
function patchIni(section, key, value) {
  const txt = readFileSync(INI, 'utf8');
  const lines = txt.split(/\r?\n/);
  let cur = null;
  let done = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t.startsWith('[')) {
      cur = t.slice(1, -1);
      continue;
    }
    if (cur !== section) continue;
    if (t.startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      done = true;
      break;
    }
  }
  if (!done) throw new Error(`не нашёл ${section}.${key}`);
  writeFileSync(INI, lines.join('\r\n'), { encoding: 'utf8' });
}

function mccPid() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "(Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)"],
      { timeout: 20000, encoding: 'utf8' }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== 1. проверяем состояние ===');
  const pid = mccPid();
  console.log(`  MCC PID: ${pid ?? 'не запущен'}`);
  if (pid) {
    console.log('  MCC запущен. Он перезапишет INI при закрытии, поэтому');
    console.log('  править файл сейчас нельзя — сначала надо его закрыть.');
    console.log('');
    console.log('  Закрой MCC через трей (правый клик -> Выход) и запусти снова.');
    return;
  }

  console.log('\n=== 2. бэкап INI ===');
  copyFileSync(INI, BAK);
  console.log(`  ${BAK}`);

  const before = readSection('Mixer_PB12');
  console.log('\n=== 3. Mixer_PB12 до ===');
  console.log(`  MixB_GAIN = ${before.MixB_GAIN}`);

  // Ставим -20 для Mix B, источник PB12.
  // При старте MCC прочитает это и пошлёт в устройство bulk push.
  patchIni('Mixer_PB12', 'MixB_GAIN', '-20');
  const after = readSection('Mixer_PB12');
  console.log(`\n=== 4. записали MixB_GAIN = ${after.MixB_GAIN} ===`);
  console.log('  теперь запускаем MCC — он прочитает это и отправит в устройство');

  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${MCC_EXE}'`], {
    timeout: 60000,
  });
  await sleep(22000);
  console.log('  MCC загрузился');

  console.log('\n=== 5. что теперь в INI ===');
  const now = readSection('Mixer_PB12');
  console.log(`  MixB_GAIN = ${now.MixB_GAIN}`);
  if (now.MixB_GAIN === '-20') {
    console.log('  MCC сохранил -20 -> значит прочитал из файла и не откатил');
  } else {
    console.log(`  MCC изменил на ${now.MixB_GAIN} -> он читает микшер из устройства!`);
  }

  console.log('\n=== 6. следующий шаг ===');
  console.log('  запусти capture-mixer-boot.ps1 от админа — он снимет bulk push');
  console.log('  при старте MCC. В нём MixB для источника PB12 будет -20 дБ,');
  console.log('  и мы увидим, КАКОЙ тег это значение получил.');
  console.log('');
  console.log('  после проверки вернуть INI:');
  console.log(`    copy "${BAK}" "${INI}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
