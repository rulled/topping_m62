/**
 * Пошаговая отладка findReverbButtons — повторяем её логику вручную.
 */
import { dumpTree } from './uia.js';

const { items } = dumpTree();

const dry = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Dry');
console.log(`шаг 1: dry = ${dry ? `(${dry.lx},${dry.ly})` : 'НЕТ'}`);
if (!dry) { console.log('  -> возвращаем null'); process.exit(0); }

const allButtons = items.filter((x) => /QPushButton/.test(x.cls ?? ''));
console.log(`шаг 2: всего QPushButton = ${allButtons.length}`);

const decay = items.find((x) => x.cls === 'QLabel' && (x.name || '').trim() === 'Decay');
console.log(`шаг 3: decay = ${decay ? `(${decay.lx},${decay.ly})` : 'НЕТ'}`);

if (decay) {
  const col = allButtons.filter((x) => Math.abs(x.lx - (decay.lx + 37)) < 25
    && x.ly > decay.ly + 40 && x.ly < decay.ly + 250)
    .sort((a, b) => a.ly - b.ly);
  console.log(`шаг 4: col.length = ${col.length}`);
  for (const c of col) console.log(`  [${c.i}] (${c.lx},${c.ly})`);

  if (col.length >= 4) {
    console.log('\nдолжно вернуть объект:');
    console.log(JSON.stringify({
      STUDIO: { x: col[0].lx, y: col[0].ly },
      LIVE: { x: col[1].lx, y: col[1].ly },
      HALL: { x: col[2].lx, y: col[2].ly },
      Bypass: { x: col[3].lx, y: col[3].ly },
      layout: 'vertical-under-decay',
    }));
  } else {
    console.log('  -> col < 4, идём в вариант 2');
  }
}

// проверяем, что реально импортируется
console.log('\n=== проверка модуля ===');
const mod = await import('../ui-control.js');
const src = mod.findReverbButtons;
console.log('функция:', typeof src);
console.log('результат:', JSON.stringify(src()));

// посмотрим на исходник функции
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('../ui-control.js', import.meta.url), 'utf8');
const idx = text.indexOf('export function findReverbButtons');
console.log('\n=== исходник функции (первые 400 символов) ===');
console.log(text.slice(idx, idx + 400));
