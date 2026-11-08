/**
 * ТЕСТ УСТОЙЧИВОСТИ: что работает без M Control Center.
 *
 * Пользователь может не иметь MCC вообще — бекенд должен это переживать.
 */
import { execFileSync } from 'node:child_process';

const PORT = process.env.M62_PORT ?? '8890';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

async function post(path, data) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

// закрываем MCC
console.log('закрываю M Control Center...');
ps('Stop-Process -Name "M Control Center" -Force -ErrorAction SilentlyContinue');
await sleep(5000);
const cnt = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count');
console.log(`MCC процессов: ${cnt}\n`);

console.log('=== БЕЗ M CONTROL CENTER ===\n');

const EPS = [
  'health', 'controls', 'device', 'eq-mixer', 'settings', 'tags',
  'workspace', 'workspaces', 'ui-controls', 'snapshots', 'mode',
];

let works = 0;
for (const ep of EPS) {
  try {
    const r = await api(ep);
    const mark = r.ok ? 'OK  ' : `HTTP ${r.status}`;
    console.log(`  ${mark}  /api/${ep}`);
    if (r.ok) works++;
    else if (r.body.error) console.log(`         error: ${r.body.error}`);
  } catch (e) {
    console.log(`  ERR   /api/${ep}  ${e.message}`);
  }
}
console.log(`\n  работает: ${works}/${EPS.length}`);

// запись настроек — должна работать (HID)
console.log('\n=== ЗАПИСЬ БЕЗ MCC ===');
try {
  const s = await api('settings?refresh=1');
  const br = s.body.enums?.find((e) => e.id === 'brightness');
  if (br) {
    const want = br.value === 2 ? 1 : 2;
    const w = await post('settings/enum', { id: 'brightness', value: want });
    await sleep(1800);
    const s2 = await api('settings?refresh=1');
    const got = s2.body.enums?.find((e) => e.id === 'brightness')?.value;
    console.log(`  brightness: ${br.value} -> ${got}  ${got === want ? 'OK (HID работает)' : 'FAIL'}`);
    await post('settings/enum', { id: 'brightness', value: br.value });
  } else {
    console.log('  brightness не прочитался');
  }
} catch (e) {
  console.log(`  ERR: ${e.message}`);
}

// реверб — требует MCC, должен дать внятную ошибку
console.log('\n=== РЕВЕРБ БЕЗ MCC (должен быть отказ) ===');
try {
  const r = await post('reverb', { type: 'LIVE' });
  console.log(`  HTTP ${r.status}: ${r.body.error ?? JSON.stringify(r.body).slice(0, 100)}`);
} catch (e) {
  console.log(`  исключение: ${e.message.slice(0, 100)}`);
}

// workspace-запись — требует MCC для применения
console.log('\n=== ЗАПИСЬ WORKSPACE БЕЗ MCC ===');
try {
  const r = await post('workspace/apply', {
    changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: 4 }],
    restart: false,
  });
  console.log(`  HTTP ${r.status}: ${r.body.error ?? 'OK'}`);
} catch (e) {
  console.log(`  исключение: ${e.message.slice(0, 120)}`);
}

console.log('\n=== возвращаю MCC ===');
ps('Start-Process "C:\\Program Files\\TOPPING Pro\\M Control Center\\M Control Center.exe"');
await sleep(12000);
const cnt2 = ps('(Get-Process -Name "M Control Center" -ErrorAction SilentlyContinue | Measure-Object).Count');
console.log(`MCC процессов: ${cnt2}`);
