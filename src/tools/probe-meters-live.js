/**
 * ТОЛЬКО ЧТЕНИЕ: приходят ли метры, когда есть звук?
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Предыдущий замер (`probe-meters.js`) показал: семейств 0x33..0x36
 * и 0x39 в дампе НЕТ вовсе, хотя в захватах MCC они были. Метры
 * меняются каждую секунду — значит они приходят только тогда, когда
 * карта реально обрабатывает звук.
 *
 * Это надо подтвердить прежде, чем решать, годится ли метр как
 * подтверждение записи микшера: если метр приходит ТОЛЬКО при
 * звуке, то полагаться на него в UI нельзя (тишина — обычное
 * состояние).
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Слушает 20 секунд и печатает, какие семейства пришли и какие
 * менялись. НИЧЕГО НЕ ЗАПИСЫВАЕТ.
 *
 * Запуск (при включённом воспроизведении на M62):
 *
 *     node src/tools/probe-meters-live.js
 *
 * Направьте вывод Windows на M62 и включите музыку, иначе метры
 * не появятся — и это будет правильный, а не ложный результат.
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

async function main() {
  console.log('='.repeat(70));
  console.log('МЕТРЫ ПРИ НАЛИЧИИ ЗВУКА (только чтение)');
  console.log('='.repeat(70));
  console.log('\nУбедитесь, что звук идёт НА M62 (не в наушники ПК).');

  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });

  /** Наблюдаемые значения по каждому адресу. */
  const seen = new Map();
  t.on('change', (ev) => {
    const k = `${ev.target}:${ev.prop}`;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(ev.value);
  });

  await t.open();
  console.log('сессия открыта, слушаю 20 секунд…\n');
  await sleep(20000);

  const snap = t.snapshot();
  t.close();

  // ─── семейства ───
  const fams = new Map();
  for (const k of Object.keys(snap)) {
    const tt = Number(String(k).split(':')[0]);
    if (!Number.isFinite(tt)) continue;
    fams.set(tt, (fams.get(tt) ?? 0) + 1);
  }

  console.log('-'.repeat(70));
  console.log(`ВСЕГО АДРЕСОВ: ${Object.keys(snap).length}`);
  console.log('-'.repeat(70));
  console.log('  ' + [...fams].sort((a2, b2) => a2[0] - b2[0])
    .map(([tt, n]) => `0x${tt.toString(16).padStart(2, '0')}:${n}`)
    .join('  '));

  // ─── метры ───
  const meterLike = [...seen.keys()].filter((k) => {
    const [a2, b2] = k.split(':');
    const tt = Number(a2);
    const pp = Number(b2);
    // метры: 0x21:0x01, 0x33..0x36:0x15, 0x39:0x01/02, 0x44:0x0d/0e,
    // 0x46:0x0c/0d, 0x9b:0x0b — всё, что меняется часто
    return (tt === 0x21 && pp === 0x01)
      || (tt >= 0x33 && tt <= 0x36 && pp === 0x15)
      || (tt === 0x39 && (pp === 0x01 || pp === 0x02))
      || (tt === 0x44 && (pp === 0x0d || pp === 0x0e))
      || (tt === 0x46 && (pp === 0x0c || pp === 0x0d))
      || (tt === 0x9b && pp === 0x0b);
  });

  console.log('\n' + '-'.repeat(70));
  console.log('МЕТРЫ: МЕНЯЛИСЬ ЛИ');
  console.log('-'.repeat(70));

  if (meterLike.length === 0) {
    console.log('  ни одного метра не пришло.');
  } else {
    for (const k of meterLike.sort()) {
      const vals = [...seen.get(k)];
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      console.log(`  ${k.padEnd(10)} уникальных ${String(vals.length).padStart(3)}  `
        + `${(lo / 10).toFixed(1)}..${(hi / 10).toFixed(1)} dB  `
        + `${vals.length > 1 ? 'МЕНЯЕТСЯ' : 'стоит'}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('ИТОГ');
  console.log('='.repeat(70));

  const liveMeters = meterLike.filter((k) => (seen.get(k)?.size ?? 0) > 1);

  if (liveMeters.length > 0) {
    console.log(`  живых метров: ${liveMeters.length}`);
    console.log('\n  Метры приходят и меняются — но ТОЛЬКО при звуке.');
    console.log('  Как единственное подтверждение записи микшера они');
    console.log('  ненадёжны: в тишине их нет вовсе.');
  } else if (meterLike.length > 0) {
    console.log('  метры пришли, но не менялись — сигнала на шинах нет.');
  } else {
    console.log('  метров нет.');
    console.log('  Скорее всего, звук не идёт на M62, либо карта не');
    console.log('  получает аудиопоток. Это ожидаемо в тишине.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
