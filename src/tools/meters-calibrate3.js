/**
 * ТОЧНАЯ КАЛИБРОВКА МЕТРОВ — через цифровое усиление микшера.
 *
 * Идея: Mixer_IN12.MixA_GAIN меняется в дБ и применяется ЦИФРОВО, значит
 * метр за ним обязан сдвинуться РОВНО на ту же величину в дБ.
 * Это даёт точный коэффициент "сырых единиц на дБ".
 *
 * Смотрим метр FX (0x440d = fxIn), он стоит после микшера.
 * Если он не реагирует — пробуем все метры и берём тот, что сдвинулся.
 *
 * Безопасность: HP замьючен, звук наружу не идёт.
 * Значения не восстанавливаем (разрешено пользователем), но печатаем их.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = {
  0x2101: 'IN1', 0x2501: 'BT', 0x3115: 'out1', 0x3215: 'out2',
  0x3315: 'ch1', 0x3415: 'ch2', 0x3515: 'ch3', 0x3615: 'ch4',
  0x440d: 'fxIn', 0x440e: 'fxOut', 0x460c: 'comp12', 0x460d: 'comp13',
  0x9b0b: 'eqMeter', 0x6101: 'otgOutL', 0x6201: 'otgOutR', 0x6301: 'hpL', 0x6401: 'hpR',
};

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
if (!vp) { console.log('устройство не найдено'); process.exit(1); }

const dev = new HID.HID(vp.path);
let acc = new Map();

dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const tag = (m.target << 8) | m.prop;
  if (!(tag in CANDIDATES)) return;
  const cur = acc.get(tag) ?? { sum: 0, n: 0 };
  cur.sum += m.value;
  cur.n++;
  acc.set(tag, cur);
});

const send = (t, p, v) => dev.write([...withReportId(buildFrame(t, p, v, true))]);

async function measure(ms) {
  acc = new Map();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(1000);
    send(0x11, 0x26, 1);
  }
  const out = {};
  for (const [tag, r] of acc) {
    if (r.n > 3) out[tag] = Math.round(r.sum / r.n);
  }
  return out;
}

console.log('подписка...');
send(0x11, 0x24, 1);
await sleep(3500);

const ws = findActiveWorkspace();
const ini = readWorkspace(ws.path);
const mixerNow = Number(ini.Mixer_IN12?.MixA_GAIN ?? 0);
console.log(`\nтекущий Mixer_IN12.MixA_GAIN = ${mixerNow}`);

console.log('\n=== базовый замер ===');
const base = await measure(7000);
for (const [tag, v] of Object.entries(base)) {
  console.log(`  0x${(tag|0).toString(16).padStart(4,'0')} ${(CANDIDATES[tag]??'?').padEnd(9)} ${String(v).padStart(7)}`);
}

// Меняем цифровое усиление на +15 дБ (если позволяет диапазон)
const delta = (mixerNow + 15 <= 12) ? 15 : -15;
const target = mixerNow + delta;
console.log(`\n=== меняю MixA_GAIN ${mixerNow} -> ${target} (${delta > 0 ? '+' : ''}${delta} дБ, цифровое) ===`);

const r = await fetch('http://127.0.0.1:8787/api/workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: target }] }),
});
const rj = await r.json();
console.log('  apply:', JSON.stringify(rj).slice(0, 200));
await sleep(3000);

console.log('\n=== замер после ===');
const after = await measure(7000);
for (const [tag, v] of Object.entries(after)) {
  const b = base[tag];
  const d = b !== undefined ? v - b : null;
  const perDb = d !== null ? (d / delta) : null;
  console.log(`  0x${(tag|0).toString(16).padStart(4,'0')} ${(CANDIDATES[tag]??'?').padEnd(9)} ${String(v).padStart(7)}  сдвиг ${String(d).padStart(7)}  ${perDb !== null ? `(${perDb.toFixed(2)}/дБ)` : ''}`);
}

dev.close();

// Возврат не делаем — печатаем, что осталось
const ini2 = readWorkspace(findActiveWorkspace().path);
console.log(`\nMixA_GAIN осталось = ${ini2.Mixer_IN12?.MixA_GAIN} (было ${mixerNow})`);
