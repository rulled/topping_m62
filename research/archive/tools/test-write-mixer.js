/**
 * ПРОВЕРКА ЗАПИСИ для микшера и 48V через API.
 *
 * Пишем несколько параметров сразу и проверяем результат.
 */
import { execFileSync } from 'node:child_process';

const PORT = process.env.M62_PORT ?? '8831';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function apply(changes) {
  return api('workspace/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
}

console.log('=== ДО ===');
let s = await api('workspace');
const in1 = s.inputs.find((i) => i.channel === 'IN1');
const mx = s.mixer.find((m) => m.channel === 'IN12');
console.log(`  Input_IN1: 48V=${in1.phantom48} GAIN=${in1.gain}`);
console.log(`  Mixer_IN12.MixA_GAIN=${mx.buses.A?.gain} MixA_MUTE=${mx.buses.A?.mute}`);

// готовим изменения, противоположные текущим
const new48 = in1.phantom48 ? 0 : 1;
const newGain = in1.gain === 20 ? 21 : 20;
const newMix = mx.buses.A?.gain === 7 ? 8 : 7;
const newMute = !(mx.buses.A?.mute ?? false);

console.log(`\nзаписываю: 48V=${new48}, GAIN=${newGain}, MixA_GAIN=${newMix}, MixA_MUTE=${newMute}`);
const res = await apply([
  { section: 'Input_IN1', key: '48V', value: new48 },
  { section: 'Input_IN1', key: 'GAIN', value: newGain },
  { section: 'Mixer_IN12', key: 'MixA_GAIN', value: newMix },
  { section: 'Mixer_IN12', key: 'MixA_MUTE', value: newMute },
]);
console.log(`  applied=${res.applied}, restarted=${res.restarted}`);

await sleep(1500);
console.log('\n=== ПОСЛЕ ===');
s = await api('workspace?refresh=1');
const in1b = s.inputs.find((i) => i.channel === 'IN1');
const mxb = s.mixer.find((m) => m.channel === 'IN12');
console.log(`  Input_IN1: 48V=${in1b.phantom48} GAIN=${in1b.gain}`);
console.log(`  Mixer_IN12.MixA_GAIN=${mxb.buses.A?.gain} MixA_MUTE=${mxb.buses.A?.mute}`);

const ok48 = in1b.phantom48 === (new48 === 1);
const okGain = in1b.gain === newGain;
const okMix = mxb.buses.A?.gain === newMix;
const okMute = mxb.buses.A?.mute === newMute;
console.log(`\nрезультат: 48V=${ok48 ? 'OK' : 'FAIL'} GAIN=${okGain ? 'OK' : 'FAIL'} MixA_GAIN=${okMix ? 'OK' : 'FAIL'} MixA_MUTE=${okMute ? 'OK' : 'FAIL'}`);
