/**
 * УПРАВЛЕНИЕ АУДИОПАРАМЕТРАМИ: sample rate и buffer size.
 *
 * ВАЖНО (research/NOTES.md §79): меняются ТОЛЬКО клавиатурой.
 *   - ValuePattern.SetValue возвращает SET_OK, но значение не меняется
 *   - ExpandCollapse + SelectionItem -> NOSEL (нет SelectionPattern)
 *   - клавиатура (стрелки/HOME + ENTER) — РАБОТАЕТ
 */
import { ps, PRELUDE, dumpTree } from './tools/uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Индексы комбобоксов в шапке MCC. */
const COMBO = { workspace: 0, sampleRate: 1, bufferSize: 2 };

/** Допустимые значения (проверено в UI, NOTES §63). */
export const AUDIO_OPTIONS = {
  sampleRate: [44100, 48000],
  bufferSize: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
};

/** Найти комбобоксы динамически (индексы UIA могут сдвигаться). */
function findCombos() {
  const { items } = dumpTree();
  return items
    .filter((x) => x.cls && /ComboBox/.test(x.cls) && x.ly < 100)
    .sort((a, b) => a.lx - b.lx);
}

/** Прочитать текущее значение комбобокса. */
export function readAudioParam(name) {
  const combos = findCombos();
  const idx = COMBO[name];
  if (!combos[idx]) throw new Error(`комбобокс "${name}" не найден`);
  const RAW = PRELUDE + [
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${combos[idx].i})`,
    '$p = $null',
    'if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {',
    '  Write-Output ([System.Windows.Automation.ValuePattern]$p).Current.Value',
    '} else { Write-Output "NOPATTERN" }',
  ].join('\n');
  return ps(RAW).trim();
}

/**
 * Выбрать значение в комбобоксе через клавиатуру.
 *
 * Раскрываем список, нажимаем HOME (первый пункт) или нужное число
 * стрелок вниз, затем ENTER.
 *
 * @param {'sampleRate'|'bufferSize'} name
 * @param {number} targetValue целевое значение (44100 / 48000 / 8..2048)
 */
export function setAudioParam(name, targetValue) {
  const combos = findCombos();
  const idx = COMBO[name];
  if (!combos[idx]) throw new Error(`комбобокс "${name}" не найден`);

  // читаем варианты
  const OPTIONS = {
    sampleRate: [44100, 48000],
    bufferSize: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
  };
  const list = OPTIONS[name];
  if (!list) throw new Error(`неизвестный параметр: ${name}`);
  const targetPos = list.indexOf(Number(targetValue));
  if (targetPos < 0) {
    throw new Error(`недопустимое значение ${targetValue} для ${name}; допустимо: ${list.join(', ')}`);
  }

  const RAW = PRELUDE + [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$root = Get-MccRoot',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    `$e = $all.Item(${combos[idx].i})`,
    '$ep = $null',
    'if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { Write-Output "NOEXPAND"; exit 1 }',
    '([System.Windows.Automation.ExpandCollapsePattern]$ep).Expand()',
    'Start-Sleep -Milliseconds 800',
    // к первому пункту
    '[System.Windows.Forms.SendKeys]::SendWait("{HOME}")',
    'Start-Sleep -Milliseconds 250',
    `for ($k = 0; $k -lt ${targetPos}; $k++) {`,
    '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
    '  Start-Sleep -Milliseconds 180',
    '}',
    'Start-Sleep -Milliseconds 250',
    '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
    'Start-Sleep -Milliseconds 500',
    'Write-Output "SET"',
  ].join('\n');

  const out = ps(RAW).trim();
  if (out.includes('NOEXPAND')) throw new Error('комбобокс не раскрывается');

  return { name, target: Number(targetValue), position: targetPos, result: out };
}

/** Прочитать оба параметра. */
export function readAllAudioParams() {
  return {
    sampleRate: readAudioParam('sampleRate'),
    bufferSize: readAudioParam('bufferSize'),
  };
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch { return false; }
})();

if (isMain) {
  const [name, value] = process.argv.slice(2);
  if (name && value) {
    console.log('до:', JSON.stringify(readAllAudioParams()));
    const r = setAudioParam(name, Number(value));
    console.log(`выставил ${name} = ${value}:`, JSON.stringify(r));
    await sleep(2500);
    console.log('после:', JSON.stringify(readAllAudioParams()));
  } else {
    console.log('текущие:', JSON.stringify(readAllAudioParams()));
    console.log('использование: node set-audio-params.js <sampleRate|bufferSize> <значение>');
  }
}
