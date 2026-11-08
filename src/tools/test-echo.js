/**
 * ЭХО УСТРОЙСТВА: присылает ли устройство тег обратно после записи?
 *
 * Если нет — фронту нужен polling, и это надо задокументировать.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);

// Собираем ВСЁ что приходит, с временными метками
const log = [];
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  log.push({ t: Date.now(), tt: m.target, pp: m.prop, v: m.value });
});

console.log('слушаю 2 с (фон)...');
await sleep(2000);
const bg = log.length;
const bgTags = new Set(log.map((x) => `${x.tt.toString(16)}:${x.pp.toString(16)}`));
console.log(`  событий: ${bg}, тегов: ${bgTags.size}`);
console.log(`  фоновые теги: ${[...bgTags].slice(0, 12).join(', ')}`);

// Теперь пишем громкость HP и смотрим, придёт ли 0x64:0x03
const TESTS = [
  { tt: 0x64, pp: 0x03, v: 40, name: 'HP volume (0x64:0x03)' },
  { tt: 0x21, pp: 0x04, v: 25, name: 'Mic1 volume (0x21:0x04)' },
  { tt: 0x11, pp: 0x04, v: 1, name: 'Brightness (0x11:0x04)' },
];

for (const t of TESTS) {
  log.length = 0;
  const writeAt = Date.now();
  dev.write([...withReportId(buildFrame(t.tt, t.pp, t.v, true))]);
  await sleep(2000);

  const echo = log.find((x) => x.tt === t.tt && x.pp === t.pp);
  const total = log.length;
  console.log(`\n${t.name}:`);
  console.log(`  записано ${t.v}, событий за 2 с: ${total}`);
  if (echo) {
    console.log(`  ЭХО ПРИШЛО: ${echo.v} через ${echo.t - writeAt} мс  ${echo.v === t.v ? '(совпадает)' : '(другое значение)'}`);
  } else {
    console.log('  ЭХА НЕТ — устройство не присылает свой же тег обратно');
  }
}

dev.close();
process.exit(0);
