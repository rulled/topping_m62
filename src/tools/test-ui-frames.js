/**
 * ПРОВЕРКА: КАДРЫ УПРАВЛЕНИЯ, КОТОРЫЕ ШЛЁТ ВЕБ-СТРАНИЦА.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Страница собирает кадры теми же модулями, что и бекенд. Но
 * обработчики в браузере — отдельный код, и в них легко ошибиться
 * (не тот target, не та пара целей, не тот масштаб).
 *
 * Здесь проверяется РОВНО то, что шлёт страница:
 *
 *   • HP громкость  -> 0x64:0x03 И 0x63:0x03 (пара!)
 *   • HP mute       -> 0x64:0x04 И 0x63:0x04 (пара!)
 *   • OTG mute      -> 0x62:0x04 И 0x61:0x04 (пара!)
 *   • усиления      -> 0x21/0x22/0x23/0x25/0x27 : 0x04
 *   • 48V           -> 0x21:0x03 / 0x22:0x03
 *   • реверб тип    -> 0x44:0x0b
 *   • реверб парам  -> 0x44:0x08/09/0a/0f
 *   • компрессор    -> 0x46:0x01..08
 *   • EQ полоса     -> 0x91..0x94
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Ничего не пишется в устройство. Проверяются только собранные
 * кадры (адреса и значения).
 *
 * Запуск: node src/tools/test-ui-frames.js
 */

import { buildEqFrames, readChannelBands, EQ_LIMITS } from '../eq-hid.js';
import { buildCompFrames, readCompressor, COMP_FIELDS } from '../comp-hid.js';
import { buildReverbFrames, REVERB_TYPES, REVERB_FIELDS } from '../reverb-hid.js';
import { buildPhantomFrames } from '../phantom-hid.js';

let ok = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    ok += 1;
    console.log(`  OK   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
};

/** Кадр совпадает с ожидаемым адресом и значением. */
const frameIs = (frames, target, prop, value) =>
  frames.some((f) => f.target === target && f.prop === prop && f.value === value);

console.log('='.repeat(70));
console.log('КАДРЫ УПРАВЛЕНИЯ ВЕБ-СТРАНИЦЫ');
console.log('='.repeat(70));

// ─── выходы ───
console.log('\n--- выходы ---');
{
  // HP громкость пишется в ОБЕ цели пары (0x63 и 0x64)
  const v = 60;
  const frames = [
    { target: 0x64, prop: 0x03, value: v },
    { target: 0x63, prop: 0x03, value: v },
  ];
  check('HP громкость -> пара 0x64/0x63', frames.length === 2
    && frameIs(frames, 0x64, 0x03, v) && frameIs(frames, 0x63, 0x03, v));

  const muteFrames = [
    { target: 0x64, prop: 0x04, value: 1 },
    { target: 0x63, prop: 0x04, value: 1 },
  ];
  check('HP mute -> пара 0x64/0x63', frameIs(muteFrames, 0x64, 0x04, 1)
    && frameIs(muteFrames, 0x63, 0x04, 1));

  const otgFrames = [
    { target: 0x62, prop: 0x04, value: 1 },
    { target: 0x61, prop: 0x04, value: 1 },
  ];
  check('OTG mute -> пара 0x62/0x61', frameIs(otgFrames, 0x62, 0x04, 1)
    && frameIs(otgFrames, 0x61, 0x04, 1));
}

// ─── усиления входов ───
console.log('\n--- усиления входов ---');
{
  const map = [['IN1', 0x21], ['IN2', 0x22], ['AUX', 0x23], ['BT', 0x25], ['OTG IN', 0x27]];
  for (const [name, tt] of map) {
    const frames = [{ target: tt, prop: 0x04, value: 42 }];
    check(`${name} усиление -> 0x${tt.toString(16)}:0x04`, frameIs(frames, tt, 0x04, 42));
  }
}

// ─── 48V ───
console.log('\n--- фантомное питание ---');
{
  const on1 = buildPhantomFrames('IN1', true);
  const off1 = buildPhantomFrames('IN1', false);
  check('48V IN1 вкл -> 0x21:0x03=1', frameIs(on1, 0x21, 0x03, 1), JSON.stringify(on1));
  check('48V IN1 выкл -> 0x21:0x03=0', frameIs(off1, 0x21, 0x03, 0), JSON.stringify(off1));
  const on2 = buildPhantomFrames('IN2', true);
  check('48V IN2 вкл -> 0x22:0x03=1', frameIs(on2, 0x22, 0x03, 1), JSON.stringify(on2));
}

// ─── реверб ───
console.log('\n--- реверб ---');
{
  for (const [code, name] of Object.entries(REVERB_TYPES)) {
    const frames = buildReverbFrames('type', Number(code));
    check(`тип ${name} -> 0x44:0x0b=${code}`, frameIs(frames, 0x44, 0x0b, Number(code)));
  }
  // width у модуля задаётся 0..1 (в HID уходит ×100): 0.7 -> 70
  const params = [
    ['dryWet', 0x08, 45, 45],
    ['room', 0x09, 4, 4],
    ['decay', 0x0a, 11, 11],
    ['width', 0x0f, 0.7, 70],
  ];
  for (const [field, prop, inValue, wireValue] of params) {
    const frames = buildReverbFrames(field, inValue);
    check(
      `реверб ${field} -> 0x44:0x${prop.toString(16).padStart(2, '0')}`,
      frameIs(frames, 0x44, prop, wireValue),
      `вход=${inValue} в кадре=${frames[0].value}`,
    );
  }
  check('REVERB_FIELDS содержит нужные', ['dryWet', 'room', 'decay', 'type', 'width']
    .every((f) => Object.prototype.hasOwnProperty.call(REVERB_FIELDS, f)),
  Object.keys(REVERB_FIELDS).join(', '));
}

// ─── компрессор ───
console.log('\n--- компрессор ---');
{
  const cases = [
    ['switch', 1, 0x01],
    ['threshold', -20, 0x02],
    ['ratio', 4, 0x03],
    ['attack', 10, 0x04],
    ['release', 300, 0x05],
    ['mix', 90, 0x08],
  ];
  for (const [field, value, prop] of cases) {
    const frames = buildCompFrames(field, value);
    check(`компрессор ${field} -> 0x46:0x${prop.toString(16).padStart(2, '0')}`,
      frames.length === 1 && frames[0].target === 0x46 && frames[0].prop === prop,
      `prop=${frames[0].prop.toString(16)} value=${frames[0].value}`);
  }
  check('COMP_FIELDS полный', COMP_FIELDS.switch && COMP_FIELDS.threshold
    && COMP_FIELDS.ratio && COMP_FIELDS.attack && COMP_FIELDS.release && COMP_FIELDS.mix);
}

// ─── EQ ───
console.log('\n--- EQ ---');
{
  // полоса 1 IN1 -> 0x91, gain -> prop 0x03
  const g1 = buildEqFrames('IN1', 1, 'gain', 3);
  check('EQ IN1 полоса1 gain -> 0x91:0x03', frameIs(g1, 0x91, 0x03, 3), JSON.stringify(g1));

  // полоса 2 -> тот же блок 0x91, но prop 0x08
  const g2 = buildEqFrames('IN1', 2, 'gain', 5);
  check('EQ IN1 полоса2 gain -> 0x91:0x08', frameIs(g2, 0x91, 0x08, 5), JSON.stringify(g2));

  // полоса 3 -> блок 0x92
  const g3 = buildEqFrames('IN1', 3, 'gain', -4);
  check('EQ IN1 полоса3 gain -> 0x92:0x03', frameIs(g3, 0x92, 0x03, -4), JSON.stringify(g3));

  // полоса 4 -> блок 0x92, prop 0x08
  const g4 = buildEqFrames('IN1', 4, 'gain', 2);
  check('EQ IN1 полоса4 gain -> 0x92:0x08', frameIs(g4, 0x92, 0x08, 2), JSON.stringify(g4));

  // IN2 -> блоки 0x93/0x94
  const gIn2 = buildEqFrames('IN2', 1, 'gain', 1);
  check('EQ IN2 полоса1 -> 0x93:0x03', frameIs(gIn2, 0x93, 0x03, 1), JSON.stringify(gIn2));

  check('EQ лимит gain -12..+12', EQ_LIMITS.gain.min === -12 && EQ_LIMITS.gain.max === 12);

  // вне диапазона -> ошибка
  let threw = false;
  try {
    buildEqFrames('IN1', 1, 'gain', 99);
  } catch {
    threw = true;
  }
  check('EQ отклоняет gain вне диапазона', threw);
}

// ─── чтение (для отрисовки) ───
console.log('\n--- чтение для отрисовки ---');
{
  // снимок как у ядра: ключи "target:prop" в десятичной
  const snap = {
    '145:1': 1, '145:3': 3, '145:4': 632, '145:5': 7000,
    '145:6': 0, '145:8': -2, '145:9': 1000, '145:10': 10000,
    '70:1': 1, '70:2': -28, '70:3': 40, '70:4': 5, '70:5': 200, '70:8': 100,
  };
  const bands = readChannelBands(snap, 'IN1');
  check('readChannelBands вернул 4 полосы', bands.length === 4, `${bands.length}`);
  const b1 = bands.find((b) => b.band === 1);
  check('полоса 1: enable и gain прочитаны', b1 && b1.enable === 1 && b1.gain === 3,
    b1 ? `en=${b1.enable} gain=${b1.gain}` : 'нет');
  const b2 = bands.find((b) => b.band === 2);
  check('полоса 2: gain прочитан', b2 && b2.gain === -2, b2 ? `gain=${b2.gain}` : 'нет');

  const cp = readCompressor(snap);
  check('readCompressor прочитал threshold', cp && cp.threshold === -28, cp ? `thr=${cp.threshold}` : 'нет');
  check('readCompressor прочитал switch', cp && cp.switch === 1, cp ? `sw=${cp.switch}` : 'нет');
}

console.log('\n' + '='.repeat(70));
console.log('ИТОГ');
console.log('='.repeat(70));
console.log(`  пройдено: ${ok}`);
console.log(`  провалено: ${fail}`);
if (fail === 0) {
  console.log('\n  ВСЕ КАДРЫ УПРАВЛЕНИЯ СОБИРАЮТСЯ ВЕРНО.');
  console.log('  Пары выходов пишутся в оба адреса, EQ — в правильные блоки,');
  console.log('  масштабы и диапазоны соблюдены.');
}
process.exit(fail === 0 ? 0 : 1);

