/**
 * Что появилось после нажатия MORE?
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

// ищем Dry и вокруг него
const dry = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
console.log(`Dry: ${dry ? `[${dry.i}] (${dry.lx},${dry.ly})` : 'НЕ НАЙДЕН'}`);

if (dry) {
  // все кнопки в округе
  const near = items.filter((x) => Math.abs(x.lx - dry.lx) < 250 && Math.abs(x.ly - dry.ly) < 350)
    .sort((a, b) => a.ly - b.ly || a.lx - b.lx);
  console.log(`\nэлементов возле Dry (${near.length}):`);
  for (const e of near) {
    console.log(`  [${String(e.i).padStart(3)}] ${e.cls.padEnd(18)} (${String(e.lx).padStart(4)},${String(e.ly).padStart(4)}) "${(e.name || '').slice(0, 22)}"`);
  }
}

// все QPushButton — где они
console.log(`\nвсе QPushButton:`);
const btns = items.filter((x) => /QPushButton/.test(x.cls ?? '')).sort((a, b) => a.ly - b.ly);
for (const b of btns) console.log(`  [${String(b.i).padStart(3)}] (${String(b.lx).padStart(4)},${String(b.ly).padStart(4)})`);

// подписи реверба
console.log(`\nподписи Dry/Wet/Room/Decay/Width:`);
for (const l of items.filter((x) => x.cls === 'QLabel' && x.name && /^(Dry|Wet|Room|Decay|Width|Noise|NC1|NC2|Bypass)$/i.test(x.name.trim()))) {
  console.log(`  (${l.lx},${l.ly}) "${l.name}"`);
}

// диалы в области реверба
console.log(`\nдиалы x>500:`);
for (const d of items.filter((x) => /Dial/.test(x.cls ?? '') && x.lx > 450).sort((a, b) => a.ly - b.ly)) {
  console.log(`  [${String(d.i).padStart(3)}] ${d.cls.padEnd(12)} (${String(d.lx).padStart(4)},${String(d.ly).padStart(4)})`);
}
