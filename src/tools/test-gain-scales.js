/**
 * ПРОВЕРКА ШКАЛ ГЕЙНОВ — против данных драйвера.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Шкалы взяты из опубликованного драйвера ядра
 * (`sound/usb/mixer_topping.c`). Если переписать их с ошибкой,
 * пользователь увидит неверные дБ — а на этом можно и слух
 * испортить, и оборудование.
 *
 * Поэтому каждая ключевая точка, которую драйвер называет прямо
 * («первый шаг при bind = 0 дБ»), проверяется здесь.
 *
 * Запуск: node src/tools/test-gain-scales.js
 */

import {
  GAIN_CONTROLS,
  curveCheckpoints,
  formatGain,
  gainDb,
  gainStep,
} from '../gain-scales.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  OK    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
};

console.log('='.repeat(66));
console.log('ШКАЛЫ ГЕЙНОВ M62 — СВЕРКА С ДРАЙВЕРОМ ЯДРА');
console.log('='.repeat(66));

// ─── ключевые точки из драйвера ───
console.log('\n--- ключевые точки ---');
for (const cp of curveCheckpoints()) {
  const got = gainDb(cp.step, cp.curve);
  check(
    `${cp.curve} шаг ${cp.step} -> ${cp.db === null ? 'MUTE' : `${cp.db} dB`}`,
    got === cp.db,
    `получили ${got}`,
  );
}

// ─── первый шаг при bind (драйвер пишет это значение) ───
console.log('\n--- значения первого bind из драйвера ---');
check('AUX по умолчанию = 0 дБ (шаг 81)', formatGain(81, 'out9') === '0 dB',
  formatGain(81, 'out9'));
check('BT по умолчанию = 0 дБ (шаг 99)', formatGain(99, 'out0') === '0 dB',
  formatGain(99, 'out0'));
check('OTG IN по умолчанию = 0 дБ (шаг 99)', formatGain(99, 'out0') === '0 dB');
check('HP по умолчанию = тишина (шаг 0)', formatGain(0, 'out9') === 'MUTE');
check('IN 1 по умолчанию = 0 дБ (шаг 0)', formatGain(0, 'mic') === '0 dB');

// ─── границы шкал ───
console.log('\n--- границы диапазонов out9 ---');
check('out9 шаг 19 = −52 дБ', gainDb(19, 'out9') === -52, String(gainDb(19, 'out9')));
check('out9 шаг 20 = −51 дБ', gainDb(20, 'out9') === -51, String(gainDb(20, 'out9')));
check('out9 шаг 61 = −10 дБ', gainDb(61, 'out9') === -10, String(gainDb(61, 'out9')));
check('out9 шаг 62 = −9.5 дБ', gainDb(62, 'out9') === -9.5, String(gainDb(62, 'out9')));
check('out9 шаг 99 = +9 дБ', gainDb(99, 'out9') === 9, String(gainDb(99, 'out9')));

console.log('\n--- границы диапазонов out0 ---');
check('out0 шаг 79 = −10 дБ', gainDb(79, 'out0') === -10, String(gainDb(79, 'out0')));
check('out0 шаг 80 = −9.5 дБ', gainDb(80, 'out0') === -9.5, String(gainDb(80, 'out0')));
check('out0 шаг 99 = 0 дБ', gainDb(99, 'out0') === 0, String(gainDb(99, 'out0')));

// ─── обратное преобразование ───
console.log('\n--- дБ -> шаг ---');
check('0 дБ на out9 -> шаг 81', gainStep(0, 'out9') === 81, String(gainStep(0, 'out9')));
check('0 дБ на out0 -> шаг 99', gainStep(0, 'out0') === 99, String(gainStep(0, 'out0')));
check('−6 дБ на out9 -> шаг 69', gainStep(-6, 'out9') === 69, String(gainStep(-6, 'out9')));
check('mute (null) -> шаг 0', gainStep(null, 'out9') === 0);
check('26 дБ mic -> шаг 26', gainStep(26, 'mic') === 26);

// round-trip: каждый шаг -> дБ -> шаг
console.log('\n--- round-trip по всем шагам ---');
let rtFail = 0;
for (const [curve, max] of [['out9', 99], ['out0', 99], ['mic', 88]]) {
  for (let s = 1; s <= max; s += 1) {
    const db = gainDb(s, curve);
    const back = gainStep(db, curve);
    if (back !== s) {
      rtFail += 1;
      if (rtFail <= 5) console.log(`    расхождение ${curve} шаг ${s} -> ${db} -> ${back}`);
    }
  }
}
check('round-trip не теряет шаги', rtFail === 0, `${rtFail} расхождений`);

// ─── таблица контролов ───
console.log('\n--- таблица контролов ---');
check('описано 7 контролов', Object.keys(GAIN_CONTROLS).length === 7,
  String(Object.keys(GAIN_CONTROLS).length));
check('IN 1 и IN 2 — микрофонная шкала',
  GAIN_CONTROLS['0x21:0x04'].curve === 'mic'
  && GAIN_CONTROLS['0x22:0x04'].curve === 'mic');
check('AUX — шкала out9', GAIN_CONTROLS['0x23:0x04'].curve === 'out9');
check('BT и OTG IN — шкала out0',
  GAIN_CONTROLS['0x25:0x04'].curve === 'out0'
  && GAIN_CONTROLS['0x27:0x04'].curve === 'out0');
check('HP — шкала out9', GAIN_CONTROLS['0x64:0x03'].curve === 'out9');
check('OTG OUT — шкала out0', GAIN_CONTROLS['0x62:0x03'].curve === 'out0');

// ─── защита от мусора ───
console.log('\n--- устойчивость ---');
check('неизвестная кривая не падает', formatGain(50, 'nope') === '50');
check('undefined -> MUTE', formatGain(undefined, 'out9') === 'MUTE');
check('отрицательный шаг -> MUTE', formatGain(-1, 'out9') === 'MUTE');

console.log(`\n${'='.repeat(66)}`);
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
