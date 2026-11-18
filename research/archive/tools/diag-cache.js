/**
 * Отладка: смотрим, что реально оказывается в кеше транспорта
 * после серии ANNOUNCE.
 */
import { M62Transport } from '../transport.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = { info: () => {}, warn: console.warn, error: console.error };
const t = new M62Transport({ logger: log });

const seenTags = new Map();
t.on('event', (ev) => {
  const k = (ev.target << 8) | ev.prop;
  seenTags.set(k, (seenTags.get(k) ?? 0) + 1);
});

await t.open();
console.log('открыт, жду 3 с для начального потока');
await sleep(3000);

const TARGETS = {
  0x1104: 'Brightness', 0x111a: 'Bluetooth', 0x111b: 'OtgPower',
  0x111c: 'UsbCPower', 0x111d: 'Mode', 0x111e: 'AutoPower',
  0x1118: 'counter', 0x1122: 'BtnSingle', 0x1123: 'BtnDouble',
};

for (let round = 1; round <= 8; round++) {
  t.send(0x11, 0x26, 1);
  await sleep(1000);
  const have = Object.keys(TARGETS).filter((k) => seenTags.has(Number(k))).length;
  console.log(`после запроса ${round}: тегов настроек ${have}/${Object.keys(TARGETS).length}, кеш ${t.cache.size}`);
}

console.log('\n=== ИТОГ ===');
for (const [k, name] of Object.entries(TARGETS)) {
  const key = Number(k);
  const c = seenTags.get(key) ?? 0;
  const v = t.cache.get(`${key >> 8}:${key & 0xff}`);
  console.log(`  0x${key.toString(16).padStart(4, '0')}  ${name.padEnd(12)} пришёл ${String(c).padStart(2)}×  значение=${v === undefined ? '-' : v}`);
}

console.log(`\nвсего в кеше: ${t.cache.size} параметров`);
t.close();
process.exit(0);
