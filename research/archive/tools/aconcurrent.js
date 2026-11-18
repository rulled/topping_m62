/**
 * Проверка: можно ли открыть HID interface 4 ВТОРЫМ процессом,
 * пока M Control Center держит его открытым.
 *
 * Ничего не пишет. Только открывает на чтение и слушает.
 */
import { M62Transport } from '../../src/transport.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function main() {
  const found = M62Transport.find();
  if (!found) {
    console.log('устройство не найдено');
    process.exit(1);
  }
  console.log('найдено:', found.path);

  let t;
  try {
    // open: false — не отправляем подписку, чтобы не мешать MCC.
    t = new M62Transport({ logger: console, subscribe: false });
  } catch (err) {
    console.log('ОШИБКА конструктора:', err.message);
    process.exit(2);
  }

  t.open({ subscribe: false })
    .then(async () => {
      console.log('ОТКРЫЛОСЬ вторым читателем — MCC не блокирует');
      let n = 0;
      t.on('event', (ev) => {
        n += 1;
        if (n <= 40) {
          console.log(
            `  событие #${n}: TT=0x${ev.target.toString(16).padStart(2, '0')}` +
            ` PP=0x${ev.prop.toString(16).padStart(2, '0')} value=${ev.value}`,
          );
        }
      });
      await sleep(15000);
      console.log(`\nвсего событий: ${n}`);
      console.log('статистика:', JSON.stringify(t.stats));
      t.close();
      process.exit(0);
    })
    .catch((err) => {
      console.log('НЕ ОТКРЫЛОСЬ:', err.message);
      process.exit(3);
    });
}

main();
