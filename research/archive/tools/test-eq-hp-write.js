/**
 * ФИНАЛЬНАЯ ПРОВЕРКА EQ на Pro audio mode.
 *
 * В Pro EQ_HP доступен (Switch=1 в файле). Проверяем:
 *   1) переключить на Pro
 *   2) записать EQ_HP полосу
 *   3) убедиться, что Switch остался 1 и полоса применилась
 *   4) вернуть Live
 */
import { execFileSync } from 'node:child_process';

const PS_EXE = 'powershell.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.M62_PORT ?? '8835';

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

function ps(cmd) {
  return execFileSync(PS_EXE, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
}

// 1) состояние
let ws = await api('workspace');
console.log(`\n=== ДО (${ws.mode}/${ws.name}) ===`);
let hp = ws.eq.find((e) => e.id === 'EQ_HP');
if (!hp) {
  console.log('EQ_HP нет — устройство не в Pro режиме');
  console.log('нужно переключить режим вручную и запустить снова');
  process.exit(0);
}
console.log(`  EQ_HP: switch=${hp.switch} gainOutput=${hp.gainOutput}`);
for (const b of hp.bands) console.log(`    полоса ${b.band}: ${b.raw}  (gain=${b.gain} freq=${b.freq} Q=${b.q})`);
