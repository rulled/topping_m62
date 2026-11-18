/** Находит подписи настроек и их элементы управления (актуальные позиции). */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
const RE = /Bluetooth|Brightness|OTG|USB-C|Mode select|Power|Reset|Main button/i;

console.log('=== НАСТРОЙКИ: подпись -> элемент управления ===\n');
for (const lab of labels) {
  if (!RE.test(lab.name)) continue;
  console.log(`[${lab.i}] (${lab.lx},${lab.ly}) "${lab.name}"`);
  const near = items.filter(
    (y) =>
      y.i !== lab.i &&
      Math.abs(y.ly - lab.ly) < 28 &&
      /ComboBox|QLineEdit|QPushButton/.test(y.cls),
  );
  for (const n of near.slice(0, 4)) {
    const closed = n.cls === 'QLineEdit' ? ' (внутренний)' : '';
    console.log(`    -> [${n.i}] ${n.cls.padEnd(16)} "${(n.name || '').trim()}" [${n.pats}]${closed}`);
  }
  console.log();
}
