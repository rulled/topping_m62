/**
 * ТОЛЬКО ЧТЕНИЕ: точные адреса живых метров при звуке.
 *
 * ═══ ЧТО ВЫЯСНИЛОСЬ ═══
 *
 * Со звуком в дампе появились семейства 0x31..0x34 и 0x39, которых
 * в тишине нет вовсе. Метры живые — но живые оказались адреса
 * `0x51:0x21` и `0x57:0x01/02`, а НЕ ожидаемые `0x33..0x36:0x15`.
 *
 * Ошибка в моём коде: ключи снимка десятичные ("51:33"), а я
 * разбирал их как hex. То есть "51" — это 0x51 как ЧИСЛО 51, но
 * я читал его как 0x51 = 81. Отсюда путаница.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Печатает ВСЕ адреса, которые менялись, с ключом в двух форматах:
 * как лежит в снимке (десятичный) и в hex. Так исключается любая
 * неоднозначность.
 *
 * НИЧЕГО НЕ ЗАПИСЫВАЕТ.
 *
 * Запуск (при звуке на M62): node src/tools/probe-meters-exact.js
 */

import { createNodeHidAdapter } from '../adapter-nodehid.js';
import { M62TransportCore } from '../transport-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error: console.error };

async function main() {
  console.log('='.repeat(70));
  console.log('ТОЧНЫЕ АДРЕСА ЖИВЫХ МЕТРОВ (только чтение)');
  console.log('='.repeat(70));

  const a = createNodeHidAdapter({ logger: quiet });
  const t = new M62TransportCore({ adapter: a, logger: quiet });

  /** k = "tt:pp" в ДЕСЯТИЧНОМ (как в снимке) -> Set значений. */
  const seen = new Map();
  t.on('change', (ev) => {
    const k = `${ev.target}:${ev.prop}`;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(ev.value);
  });

  await t.open();
  console.log('слушаю 18 секунд…\n');
  await sleep(18000);
  t.close();

  // ─── все меняющиеся адреса ───
  const changing = [...seen]
    .filter(([, vals]) => vals.size > 1)
    .map(([k, vals]) => {
      const [ttD, ppD] = k.split(':').map(Number);
      return {
        key: k,
        hex: `${ttD.toString(16).padStart(2, '0')}:${ppD.toString(16).padStart(2, '0')}`,
        ttD,
        ppD,
        n: vals.size,
        lo: Math.min(...vals),
        hi: Math.max(...vals),
      };
    })
    .sort((x, y) => y.n - x.n);

  console.log('-'.repeat(70));
  console.log(`МЕНЯЮЩИЕСЯ АДРЕСА: ${changing.length}`);
  console.log('-'.repeat(70));
  console.log('  ключ снимка      hex        уник.   диапазон dB');

  for (const r of changing) {
    console.log(`  ${r.key.padEnd(16)} 0x${r.hex.padEnd(8)} ${String(r.n).padStart(4)}   `
      + `${(r.lo / 10).toFixed(1)}..${(r.hi / 10).toFixed(1)}`);
  }

  // ─── группировка по семействам ───
  const fams = new Map();
  for (const r of changing) {
    if (!fams.has(r.ttD)) fams.set(r.ttD, []);
    fams.get(r.ttD).push(r);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('ПО СЕМЕЙСТВАМ (десятичное значение ключа)');
  console.log('-'.repeat(70));
  for (const [tt, list] of [...fams].sort((x, y) => x[0] - y[0])) {
    console.log(`  TT=${tt} (0x${tt.toString(16)}): `
      + list.map((r) => `pp=${r.ppD}(0x${r.ppD.toString(16)})`).join(', '));
  }

  // ─── стабильные значения: где метры могли «застыть» ───
  console.log('\n' + '='.repeat(70));
  console.log('ЧТО ЭТО ЗНАЧИТ');
  console.log('='.repeat(70));

  if (changing.length === 0) {
    console.log('  Ни один адрес не менялся — сигнала нет.');
    console.log('  Включите воспроизведение НА M62 и повторите.');
  } else {
    console.log(`  живых адресов: ${changing.length}`);
    console.log('\n  Метры приходят ТОЛЬКО при наличии звука. Это делает их');
    console.log('  непригодными как единственное подтверждение записи');
    console.log('  микшера: в тишине проверять нечего.');
  }
}

main().catch((e) => {
  console.error('ошибка:', e.message);
  process.exit(1);
});
