/**
 * Открыть настройки MCC и снять актуальные позиции всех контролов.
 * Один прогон: нажать шестерёнку -> подождать -> дамп.
 */
import { dumpTree, invoke } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// найти шестерёнку (маленькая QPushButton без имени в правом верхнем углу)
let { items } = dumpTree();
const gear = items.find(
  (x) => x.cls === 'QPushButton' && !x.name && x.w >= 30 && x.w <= 50 && x.h >= 30 && x.h <= 50,
);

if (!gear) {
  console.error('шестерёнка не найдена');
  process.exit(1);
}
console.log(`нажимаю шестерёнку [${gear.i}]`);
console.log('  ' + invoke(gear.i));
await sleep(1800);

({ items } = dumpTree());
console.log(`элементов: ${items.length}\n`);

const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
const RE = /Bluetooth|Brightness|OTG|USB-C|Mode select|Power|Reset|Main button/i;

let found = 0;
for (const lab of labels) {
  if (!RE.test(lab.name)) continue;
  found++;
  console.log(`[${lab.i}] ("${lab.name.trim()}")`);
  const near = items.filter(
    (y) =>
      y.i !== lab.i &&
      Math.abs(y.ly - lab.ly) < 28 &&
      /ComboBoxS1M3|QPushButton/.test(y.cls),
  );
  for (const n of near.slice(0, 3)) {
    const kind = n.cls === 'QPushButton' ? 'toggle' : 'combo';
    console.log(`    ${kind}=${String(n.i).padEnd(4)} [${n.pats}] "${(n.name || '').trim()}"`);
  }
  console.log();
}

if (!found) {
  console.log('подписи настроек не найдены — панель не открылась?');
  const all = labels.filter((l) => l.ly > 350 && l.ly < 1400);
  console.log('подписи в средней области:');
  for (const l of all.slice(0, 30)) console.log(`   (${l.lx},${l.ly}) "${l.name.trim()}"`);
}
