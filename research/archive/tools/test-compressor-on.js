/**
 * Компрессор: включаем Switch, затем пишем Threshold/Ratio.
 * Гипотеза: параметры применяются только при включённом компрессоре.
 */
const PORT = process.env.M62_PORT ?? '8839';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

let ws = await api('workspace');
let cp = ws.compressor;
console.log(`ДО: switch=${cp.switch} threshold=${cp.threshold} ratio=${cp.ratio}`);

// 1) включаем компрессор через файл
console.log('\n1) включаю Switch = true');
await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ changes: [{ section: 'Compressor', key: 'Switch', value: 'true' }] }),
});
await sleep(1500);

ws = await api('workspace?refresh=1');
cp = ws.compressor;
console.log(`   после: switch=${cp.switch}`);

if (!cp.switch) {
  console.log('   Switch не включился — пишем через кнопку UI');
  process.exit(0);
}

// 2) теперь пишем параметры
console.log('\n2) пишу Threshold=-12, Ratio=6 при включённом компрессоре');
await api('workspace/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    changes: [
      { section: 'Compressor', key: 'Threshold', value: -12 },
      { section: 'Compressor', key: 'Ratio', value: 6 },
    ],
  }),
});
await sleep(2000);

ws = await api('workspace?refresh=1');
cp = ws.compressor;
console.log(`   после: switch=${cp.switch} threshold=${cp.threshold} ratio=${cp.ratio}`);
console.log(`   результат: threshold=${cp.threshold === -12 ? 'OK' : 'FAIL'} ratio=${cp.ratio === 6 ? 'OK' : 'FAIL'}`);
