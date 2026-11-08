/** Быстрый снимок настроек из UI: режим, яркость, Bluetooth и прочее. */
import { dumpTree } from './uia.js';

const LABELS = {
  437: 'Bluetooth',
  537: 'Brightness',
  635: 'OTG port power',
  734: 'USB-C port power',
  834: 'Mode select',
  934: 'Auto Power On/Off',
  1032: 'Reset',
  1132: 'Main button single',
  1231: 'Main button double',
};

const { scale, items } = dumpTree();
console.log(`DPI scale ${scale}, элементов ${items.length}\n`);

for (const [yStr, label] of Object.entries(LABELS)) {
  const y = Number(yStr);
  const near = items.filter((x) => Math.abs(x.ly - y) < 22);
  const vals = near.filter((x) => x.cls.match(/ComboBox|QLineEdit|QPushButton/));
  const shown = [];
  for (const v of vals) {
    if (v.name && v.name.trim()) shown.push(`${v.cls}: "${v.name}"`);
  }
  console.log(`${label}:`);
  if (!shown.length) console.log('   (нет значения)');
  else shown.slice(0, 2).forEach((s) => console.log('   ' + s));
}

// сколько шин микшера
const mixed = items.filter((x) => /^Mix [A-H]$/.test(x.name || '') && x.cls === 'QLabel');
console.log(`\nшин микшера в UI: ${mixed.length} -> ${mixed.map((m) => m.name).join(', ')}`);
