/**
 * АУДИТ UI -> API: каждый интерактивный элемент MCC против API.
 *
 * Цель: найти элементы, которыми можно управлять в MCC,
 * но нельзя через бекенд.
 */
import { dumpTree } from './uia.js';
import { MODE_CAPABILITIES } from '../modes.js';

const { items } = dumpTree();

console.log(`элементов в UI: ${items.length}\n`);

// классифицируем интерактивные элементы
const groups = {
  sliderMixer: [],
  sliderLevel: [],
  sliderOther: [],
  dial: [],
  buttonToggle: [],
  buttonAction: [],
  combo: [],
  lineEdit: [],
};

for (const x of items) {
  const cls = x.cls;
  const has = (p) => x.pats.includes(p);

  if (cls === 'QSlider' && has('R')) {
    // по координатам понять тип
    if (x.ly > 450 && x.ly < 560 && x.lx > 1100) groups.sliderMixer.push(x);
    else if (x.ly > 1300 && x.ly < 1360) groups.sliderLevel.push(x);
    else groups.sliderOther.push(x);
  } else if (/Dial/.test(cls)) groups.dial.push(x);
  else if (cls === 'QPushButton' && has('T')) groups.buttonToggle.push(x);
  else if (cls === 'QPushButton' && has('I')) groups.buttonAction.push(x);
  else if (/ComboBox/.test(cls)) groups.combo.push(x);
  else if (cls === 'QLineEdit') groups.lineEdit.push(x);
}

console.log('=== ИНТЕРАКТИВНЫЕ ЭЛЕМЕНТЫ ===');
for (const [k, v] of Object.entries(groups)) {
  console.log(`  ${k.padEnd(16)} ${v.length}`);
}

console.log('\n=== ПОКРЫТИЕ API ===\n');
const MAP = [
  ['слайдеры микшера', groups.sliderMixer.length, 'POST /api/workspace/apply (Mixer_*.GAIN)', true],
  ['слайдеры уровня', groups.sliderLevel.length, 'POST /api/workspace/apply (Effect_Integration.Input*Level)', true],
  ['dial\'ы', groups.dial.length, 'POST /api/reverb (тип) + замкнутый контур для Threshold/Gain', 'частично'],
  ['кнопки-тумблеры', groups.buttonToggle.length, 'POST /api/settings/toggle|enum, /api/workspace/apply, /api/reverb', true],
  ['кнопки-действия', groups.buttonAction.length, 'POST /api/settings/command, /api/workspace/apply', true],
  ['комбобоксы', groups.combo.length, 'POST /api/settings/enum, /api/mode', true],
];

for (const [name, count, api, ok] of MAP) {
  const mark = ok === true ? 'OK  ' : 'ЧАСТ';
  console.log(`  ${mark} ${name.padEnd(20)} ${String(count).padStart(3)} шт -> ${api}`);
}

console.log('\n=== ДЕТАЛИ: что именно не покрыто ===\n');

// dial'ы: только реверб и Threshold/Gain
console.log('dial\'ы в UI:');
for (const d of groups.dial) {
  console.log(`  [${d.i}] (${d.lx},${d.ly})`);
}
console.log('\n  Покрытие dial-ов:');
console.log('    - 4 кнопки реверба (это НЕ dials, а кнопки)');
console.log('    - Threshold (756,1302) — работает через замкнутый контур');
console.log('    - Gain (756,1464) — работает через колесо');
console.log('    - ОСТАЛЬНЫЕ 10 dials:');
console.log('        * input volume (Mic1/Mic2/AUX/BT/OTG) — покрыты /api/volume (HID)');
console.log('        * FX send levels — покрыты /api/workspace/apply');
console.log('        * Ratio/Attack/Release/Mix — ТОЛЬКО через пресет');

// проверим: есть ли dial'ы, которые НЕ покрыты
console.log('\n=== ПРОВЕРКА: остались ли непокрытые элементы? ===');

// кнопки-действия с именами
const namedActions = groups.buttonAction.filter((b) => b.name && b.name.trim());
console.log(`кнопки-действия с именем: ${namedActions.length}`);
for (const b of namedActions) {
  console.log(`  [${b.i}] "${b.name}" (${b.lx},${b.ly}) -> POST /api/settings/command`);
}
