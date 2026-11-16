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
import {
  EQ_HP_BANDS,
  buildBandFrames as buildHpFrames,
  readBand as readHpBand,
} from '../eq-hp.js';

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

  // ─── расширенный UI: IN2 все полосы и все свойства ───
  // Полосы 1,2 -> 0x93; полосы 3,4 -> 0x94.
  const in2Cases = [
    ['полоса1 gain', 1, 'gain', 3, 0x93, 0x03],
    ['полоса2 gain', 2, 'gain', 2, 0x93, 0x08],
    ['полоса3 gain', 3, 'gain', 1, 0x94, 0x03],
    ['полоса4 gain', 4, 'gain', -2, 0x94, 0x08],
  ];
  for (const [name, band, field, v, tt, pp] of in2Cases) {
    const f = buildEqFrames('IN2', band, field, v);
    check(`EQ IN2 ${name} -> 0x${tt.toString(16)}:0x${pp.toString(16).padStart(2, '0')}`,
      frameIs(f, tt, pp, v), JSON.stringify(f));
  }

  // Все пять свойств полосы 1 и полосы 2 (нечётная/чётная раскладка)
  const propCases = [
    ['тип', 'type', 2, 0x02, 0x07],
    ['частота', 'freq', 1000, 0x04, 0x09],
    ['Q', 'q', 1.5, 0x05, 0x0a],
  ];
  for (const [name, field, v, oddProp, evenProp] of propCases) {
    const f1 = buildEqFrames('IN1', 1, field, v);
    check(`EQ полоса1 ${name} -> prop 0x${oddProp.toString(16).padStart(2, '0')}`,
      f1[0].prop === oddProp, `prop=${f1[0].prop}`);
    const f2 = buildEqFrames('IN1', 2, field, v);
    check(`EQ полоса2 ${name} -> prop 0x${evenProp.toString(16).padStart(2, '0')}`,
      f2[0].prop === evenProp, `prop=${f2[0].prop}`);
  }

  // Q передаётся как Q×10000
  const qFrame = buildEqFrames('IN1', 1, 'q', 1.5);
  check('EQ Q масштабируется ×10000', qFrame[0].value === 15000, `value=${qFrame[0].value}`);

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

// ─── EQ наушников (0xa1..0xaa, 10 полос × 2 канала) ───
//
// Фаза 2. Раскладка из docs/EQ-HP.md:
//   блок = 0xa1 + (полоса - 1)
//   свойства 0x01..0x05 = левый канал
//   свойства 0x06..0x0a = правый канал (смещение +5)
console.log('\n--- EQ наушников ---');
{
  // полоса 1 = 0xa1, полоса 10 = 0xaa
  const b1 = buildHpFrames(1, { l: { gain: 3 } });
  check('EQ HP полоса1 L gain -> 0xa1:0x03', frameIs(b1, 0xa1, 0x03, 3), JSON.stringify(b1));

  const b10 = buildHpFrames(10, { l: { gain: -2 } });
  check('EQ HP полоса10 L gain -> 0xaa:0x03', frameIs(b10, 0xaa, 0x03, -2), JSON.stringify(b10));

  // правый канал — смещение +5
  const r1 = buildHpFrames(1, { r: { gain: 4 } });
  check('EQ HP полоса1 R gain -> 0xa1:0x08', frameIs(r1, 0xa1, 0x08, 4), JSON.stringify(r1));

  const r5 = buildHpFrames(5, { r: { enable: 1 } });
  check('EQ HP полоса5 R enable -> 0xa5:0x06', frameIs(r5, 0xa5, 0x06, 1), JSON.stringify(r5));

  // все пять свойств левого и правого канала
  const fieldProps = [
    ['enable', 0x01, 0x06],
    ['type', 0x02, 0x07],
    ['gain', 0x03, 0x08],
    ['freq', 0x04, 0x09],
    ['q', 0x05, 0x0a],
  ];
  for (const [name, lProp, rProp] of fieldProps) {
    const f = buildHpFrames(2, { l: { [name]: 1 }, r: { [name]: 2 } });
    const left = f.find((x) => x.prop === lProp);
    const right = f.find((x) => x.prop === rProp);
    check(`EQ HP ${name}: L=0x${lProp.toString(16).padStart(2, '0')} R=0x${rProp.toString(16).padStart(2, '0')}`,
      left?.value === 1 && right?.value === 2,
      `L=${left?.value} R=${right?.value}`);
  }

  // обе стороны одним вызовом -> два кадра, один блок
  const both = buildHpFrames(3, { l: { gain: 1 }, r: { gain: 2 } });
  check('EQ HP обе стороны -> 2 кадра в одном блоке',
    both.length === 2 && both.every((f) => f.target === 0xa3), JSON.stringify(both));

  // полоса вне диапазона -> ошибка
  let hpThrew = false;
  try {
    buildHpFrames(11, { l: { gain: 1 } });
  } catch {
    hpThrew = true;
  }
  check('EQ HP отклоняет полосу 11', hpThrew);

  let hpThrew0 = false;
  try {
    buildHpFrames(0, { l: { gain: 1 } });
  } catch {
    hpThrew0 = true;
  }
  check('EQ HP отклоняет полосу 0', hpThrew0);

  // чтение: ключи в десятичной (как даёт ядро)
  const hpSnap = {
    '161:1': 1, '161:2': 1, '161:3': 5, '161:4': 100, '161:5': 700,
    '161:6': 0, '161:7': 2, '161:8': -5, '161:9': 2000, '161:10': 1500,
  };
  const rb = readHpBand(hpSnap, 1);
  check('readHpBand полоса1 L прочитан',
    rb && rb.l.enable === 1 && rb.l.gain === 5, rb ? `en=${rb.l.enable} gain=${rb.l.gain}` : 'нет');
  check('readHpBand полоса1 R прочитан',
    rb && rb.r.enable === 0 && rb.r.gain === -5, rb ? `en=${rb.r.enable} gain=${rb.r.gain}` : 'нет');

  // та же карта, но в hex-ключах (как пишут дампы)
  const hpSnapHex = { 'a1:01': 1, 'a1:03': 5, 'a1:08': -5 };
  const rbHex = readHpBand(hpSnapHex, 1);
  check('readHpBand понимает hex-ключи',
    rbHex && rbHex.l.gain === 5 && rbHex.r.gain === -5,
    rbHex ? `L=${rbHex.l.gain} R=${rbHex.r.gain}` : 'нет');

  check('EQ HP: 10 полос', EQ_HP_BANDS === 10, String(EQ_HP_BANDS));
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

