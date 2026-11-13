/**
 * ПРОВЕРКА: ПОРТИРУЕМОЕ ЯДРО РАБОТАЕТ НА ЖИВОМ УСТРОЙСТВЕ.
 *
 * ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
 *
 * 1. `transport-core.js` + `adapter-nodehid.js` дают полный дамп,
 *    как старый `transport.js`. Если да — то же ядро можно смело
 *    ставить в браузер (там будет только другой адаптер).
 * 2. События 'change' приходят при изменении значений.
 * 3. Запись работает (компрессор — он всегда пишется).
 * 4. readViaDump() возвращает EQ-блоки.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Наушники глушатся с подтверждением. Компрессор откатывается.
 *
 * Запуск: node src/tools/test-transport-core.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

async function main() {
  console.log('='.repeat(66));
  console.log('ПОРТИРУЕМОЕ ЯДРО ТРАНСПОРТА — ПРОВЕРКА');
  console.log('='.repeat(66));

  const adapter = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter, logger: quiet });

  const changes = [];
  t.on('change', (c) => changes.push(c));

  await t.open();
  console.log('\nсессия открыта (handshake + subscribe + announce)');

  // ждём полный дамп
  await sleep(6000);

  const snap = t.snapshot();
  const total = Object.keys(snap).length;
  console.log(`\nадресов в кеше: ${total}`);
  console.log(`прочитано отчётов: ${t.stats.reads}`);
  console.log(`записано кадров:   ${t.stats.writes}`);
  console.log(`событий change:    ${changes.length}`);

  // семейства
  const fam = {};
  for (const k of Object.keys(snap)) {
    const tt = k.split(':')[0];
    fam[tt] = (fam[tt] || 0) + 1;
  }
  console.log('\nсемейства:');
  for (const tt of Object.keys(fam).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  0x${Number(tt).toString(16).padStart(2, '0')}: ${fam[tt]}`);
  }

  // ключевые проверки
  const checks = [
    ['jack наушников 0x64:06', t.get(0x64, 0x06)],
    ['mute наушников 0x64:04', t.get(0x64, 0x04)],
    ['компрессор threshold 0x46:02', t.get(0x46, 0x02)],
    ['reverb type 0x44:0b', t.get(0x44, 0x0b)],
    ['EQ gain полоса1 0x91:03', t.get(0x91, 0x03)],
  ];
  console.log('\nключевые значения:');
  for (const [name, v] of checks) {
    console.log(`  ${name.padEnd(32)} = ${v === null ? 'НЕТ' : v}`);
  }

  // readViaDump: должны прийти EQ-блоки
  console.log('\n--- readViaDump() ---');
  const dump = await t.readViaDump();
  const eqKeys = Object.keys(dump).filter((k) => /^(145|146|147|148):/.test(k));
  console.log(`  EQ-адресов в дампе: ${eqKeys.length}`);
  console.log(`  дамп завершён: ${dump.__dumpComplete}`);

  // ─── безопасность ───
  const jack = t.get(0x64, 0x06);
  const mute = t.get(0x64, 0x04);
  if (jack === 1 && mute !== 1) {
    console.log('\nнаушники подключены -> глушу');
    t.writeFrames([{ target: 0x64, prop: 0x04, value: 1 }]);
    await sleep(1200);
    if (t.get(0x64, 0x04) !== 1) {
      console.log('НЕ заглушилось — ОСТАНОВ');
      t.close();
      process.exit(1);
    }
    console.log('  заглушено');
  }

  // ─── запись: компрессор (всегда работает) ───
  const before = t.get(0x46, 0x03);
  const target = before === 60 ? 40 : 60;
  console.log(`\n--- запись компрессора: ratio ${before} -> ${target} ---`);
  t.writeFrames([{ target: 0x46, prop: 0x03, value: target }]);
  await sleep(1500);
  const after = t.get(0x46, 0x03);
  const writeOk = after === target;
  console.log(`  читается: ${after}  ${writeOk ? 'ПРИМЕНЕНО' : 'не применено'}`);
  // откат
  if (writeOk && before !== null) {
    t.writeFrames([{ target: 0x46, prop: 0x03, value: before }]);
    await sleep(1200);
  }

  // ─── запись EQ с коммитом ───
  const eqBefore = t.get(0x91, 0x03);
  const eqTarget = eqBefore === 0 ? 2 : 0;
  console.log(`\n--- запись EQ с коммитом: gain ${eqBefore} -> ${eqTarget} ---`);
  await t.writeEqWithCommit([{ target: 0x91, prop: 0x03, value: eqTarget }]);
  const eqDump = await t.readViaDump();
  const eqAfter = eqDump['145:3'];
  const eqOk = eqAfter === eqTarget;
  console.log(`  после дампа: ${eqAfter}  ${eqOk ? 'ПРИМЕНЕНО' : 'не применено'}`);
  if (eqOk && eqBefore !== null) {
    await t.writeEqWithCommit([{ target: 0x91, prop: 0x03, value: eqBefore }]);
    await sleep(800);
  }

  t.close();

  console.log('\n' + '='.repeat(66));
  console.log('ИТОГ');
  console.log('='.repeat(66));
  const results = [
    ['ядро собрало состояние', total > 50],
    ['EQ-блоки в дампе', eqKeys.length >= 20],
    ['события change работают', changes.length > 0],
    ['запись работает', writeOk],
    ['запись EQ с коммитом', eqOk],
  ];
  for (const [name, ok] of results) {
    console.log(`  ${name.padEnd(28)} ${ok ? 'OK' : 'ПРОВАЛ'}`);
  }
  const passed = results.filter(([, ok]) => ok).length;
  console.log(`\n  пройдено: ${passed} из ${results.length}`);

  const allOk = passed === results.length;
  if (allOk) {
    console.log('\n  ЯДРО ГОТОВО ДЛЯ БРАУЗЕРА.');
    console.log('  Осталось только подменить адаптер на WebHID —');
    console.log('  политика (handshake, keepalive, кеш, коммит EQ) уже здесь.');
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
