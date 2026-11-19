/**
 * АУДИОПАРАМЕТРЫ: sample rate и buffer size.
 *
 * ═══ ГЛАВНОЕ ИЗМЕНЕНИЕ (2026-11-13) ═══
 *
 * Раньше этот модуль работал ТОЛЬКО через UI Automation в окно MCC.
 * Из-за этого `GET /api/audio-params` падал с HTTP 400, если MCC
 * не запущен — единственный такой маршрут из 69.
 *
 * Sample rate лежит в реестре и читается БЕЗ MCC:
 *
 *   HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\
 *        {Render|Capture}\{GUID}\Properties
 *   {f19f064d-082c-4e27-bc73-6882a1bb8e4c},0
 *
 * 48 байт; первые 8 — префикс, дальше WAVEFORMATEX:
 *   +8   wFormatTag      0xFFFE = WAVE_FORMAT_EXTENSIBLE
 *   +10  nChannels
 *   +12  nSamplesPerSec  (44100 / 48000)
 *   +22  wBitsPerSample
 *
 * ⚠ Путь именно `Windows\CurrentVersion` (НЕ `Windows NT\
 * CurrentVersion` — такой ветки нет). В NOTES §138 он записан
 * правильно; ошибка была только в моей ручной проверке 2026-11-13,
 * когда я набрал путь по памяти и получил «ключ не найден».
 *
 * ═══ ЧТО МОЖНО, А ЧТО НЕЛЬЗЯ ═══
 *
 *   ЧТЕНИЕ                 работает без MCC и без админа
 *   ЗАПИСЬ                 НЕ РАБОТАЕТ даже с админом
 *
 * Причина записи: ACE для BUILTIN\Администраторы в этом ключе имеет
 * флаг CIID (ContainerInherit + InheritOnly) — он действует только
 * на дочерние ключи, а на сам `Properties` прав нет вообще.
 * Проверено: Set-ItemProperty, reg add, Registry.OpenSubKey($true) —
 * все дают «access denied» при admin=True и High integrity.
 * Подробности: research/NOTES.md §149.4.
 *
 * Поэтому setAudioParam() честно говорит, что не может, и
 * предлагает единственные рабочие пути (SYSTEM-задача или MCC).
 *
 * buffer size в реестре не найден — он живёт в драйвере
 * (ToppingProUsbAudioks.sys) и задаётся через его панель.
 */

import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REG_ROOT = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio';
const PKEY_DEVICEFORMAT = '{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0';
const PKEY_FRIENDLYNAME = '{b3f8fa53-0004-438e-9003-51a46e139bfc},6';
const PKEY_DEVICEDESC = '{a45c254e-df1c-4efd-8020-67d146a850e0},2';

/** Допустимые значения (проверено в UI, NOTES §63). */
export const AUDIO_OPTIONS = {
  sampleRate: [44100, 48000],
  bufferSize: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
};

/** Один прогон PowerShell читает все эндпоинты M62 сразу. */
const READ_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$root = 'HKLM:\\${REG_ROOT}'
$res = @()
foreach ($flow in @('Render','Capture')) {
  $base = Join-Path $root $flow
  if (-not (Test-Path $base)) { continue }
  Get-ChildItem $base | ForEach-Object {
    $props = Join-Path $_.PSPath 'Properties'
    if (-not (Test-Path $props)) { return }
    $p = Get-ItemProperty $props
    $name = $p.'${PKEY_FRIENDLYNAME}'
    if ("$name" -notmatch 'M62') { return }
    $fmt = $p.'${PKEY_DEVICEFORMAT}'
    if (-not $fmt -or $fmt.Length -lt 24) { return }
    $res += [pscustomobject]@{
      flow     = $flow
      guid     = $_.PSChildName
      label    = $p.'${PKEY_DEVICEDESC}'
      name     = $name
      rate     = [BitConverter]::ToUInt32($fmt, 12)
      channels = [BitConverter]::ToUInt16($fmt, 10)
      bits     = [BitConverter]::ToUInt16($fmt, 22)
    }
  }
}
$res | ConvertTo-Json -Compress -Depth 3
`;

/**
 * Все эндпоинты M62 из реестра. Не требует MCC.
 * @returns {Array<{flow:string,guid:string,label:string,name:string,rate:number,channels:number,bits:number}>}
 */
export function readEndpoints() {
  let raw;
  try {
    raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', READ_SCRIPT],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    ).trim();
  } catch (err) {
    throw new Error(`не удалось прочитать реестр: ${err.message}`);
  }
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [data];
  return list.filter((x) => x && typeof x.rate === 'number');
}

/**
 * Сводка: какие частоты реально выставлены.
 *
 * У M62 несколько эндпоинтов (Playback 1/2 … 9/10, Loopback, AUX,
 * BT, Mobile), и каждый имеет свою частоту. Поэтому «sample rate
 * устройства» — это набор, а не одно число.
 */
export function readAudioFormatSummary() {
  const endpoints = readEndpoints();
  if (!endpoints.length) {
    return {
      available: false,
      reason: 'эндпоинты M62 не найдены в реестре (устройство не подключено?)',
    };
  }
  const counts = {};
  for (const e of endpoints) counts[e.rate] = (counts[e.rate] ?? 0) + 1;
  const rates = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return {
    available: true,
    source: 'registry',
    mccRequired: false,
    endpoints: endpoints.length,
    rates,
    // если все эндпоинты на одной частоте — это «режим устройства»
    uniform: rates.length === 1,
    distribution: counts,
    bitDepths: [...new Set(endpoints.map((e) => e.bits))].sort((a, b) => a - b),
    channels: [...new Set(endpoints.map((e) => e.channels))].sort((a, b) => a - b),
    options: AUDIO_OPTIONS.sampleRate,
    list: endpoints,
  };
}

/**
 * Прочитать один параметр (совместимость со старым API).
 * @param {'sampleRate'|'bufferSize'} name
 */
export function readAudioParam(name) {
  if (name === 'bufferSize') {
    // буфера в реестре нет — он в драйвере
    return null;
  }
  const s = readAudioFormatSummary();
  if (!s.available) return null;
  return s.uniform ? s.rates[0] : s.rates;
}

/** Прочитать оба параметра (совместимость). */
export function readAllAudioParams() {
  const s = readAudioFormatSummary();
  return {
    available: s.available,
    sampleRate: s.available ? (s.uniform ? s.rates[0] : s.rates) : null,
    bufferSize: null,
    bufferNote: 'buffer size в реестре нет — он в драйвере ToppingProUsbAudioks.sys',
    endpoints: s.available ? s.endpoints : 0,
    distribution: s.available ? s.distribution : {},
    source: 'registry',
    mccRequired: false,
  };
}

/**
 * Попытка смены sample rate.
 *
 * ЧЕСТНО: на этой машине не работает даже с админом (NOTES §149.4).
 * Возвращаем не «ok», а внятную причину и рабочие альтернативы.
 *
 * @param {'sampleRate'|'bufferSize'} name
 * @param {number} targetValue
 */
export function setAudioParam(name, targetValue) {
  if (name === 'bufferSize') {
    return {
      ok: false,
      applied: false,
      error: 'buffer size не хранится в реестре — он в драйвере',
      howTo: 'меняется через панель драйвера TOPPING или MCC',
    };
  }
  if (name !== 'sampleRate') {
    throw new Error(`неизвестный параметр: ${name}`);
  }
  const target = Number(targetValue);
  if (!AUDIO_OPTIONS.sampleRate.includes(target)) {
    throw new Error(
      `недопустимое значение ${targetValue}; допустимо: ${AUDIO_OPTIONS.sampleRate.join(', ')}`,
    );
  }
  return {
    ok: false,
    applied: false,
    error: 'запись в реестр заблокирована системой (ACE с флагом inherit-only)',
    detail:
      'У BUILTIN\\Администраторы в ключе Properties есть только CIID-ACE: '
      + 'он действует на дочерние ключи, а на сам ключ прав нет. '
      + 'Проверено при admin=True, High integrity: Set-ItemProperty, '
      + 'reg add, Registry.OpenSubKey(writable) — все «access denied».',
    howTo: [
      'задача от NT AUTHORITY\\SYSTEM (schtasks /ru SYSTEM)',
      'через MCC — он меняет частоту своим драйвером',
      'вручную: Панель управления → Звук → Свойства M62 → Дополнительно',
    ],
    alternatives: ['system-task', 'mcc', 'windows-sound-panel'],
  };
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  const [name, value] = process.argv.slice(2);
  if (name && value) {
    console.log('до:', JSON.stringify(readAllAudioParams(), null, 2));
    const r = setAudioParam(name, Number(value));
    console.log(`попытка ${name} = ${value}:`, JSON.stringify(r, null, 2));
    await sleep(1500);
    console.log('после:', JSON.stringify(readAllAudioParams(), null, 2));
  } else {
    console.log(JSON.stringify(readAudioFormatSummary(), null, 2));
  }
}
