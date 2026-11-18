/**
 * ПОЛНАЯ ПРОВЕРКА applySnapshot — последняя непроверенная функция.
 *
 * 1) снять снимок A
 * 2) изменить несколько параметров (HID + файл)
 * 3) снять снимок B, убедиться что изменения есть
 * 4) применить снимок A
 * 5) проверить, что состояние вернулось к A
 */
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { captureSnapshot, applySnapshot, readSnapshot, diffSnapshots } from '../snapshots.js';
import { M62Transport } from '../transport.js';
import { WorkspaceService } from '../workspace-service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = { info: () => {}, warn: console.warn, error: console.error };
const t = new M62Transport({ logger: log });
const ws = new WorkspaceService({ logger: log });

await t.open();
console.log('транспорт открыт, жду поток...');
await sleep(4000);

function state() {
  const w = findActiveWorkspace();
  const i = readWorkspace(w.path);
  return {
    bright: t.get(0x11, 0x04),
    mixA: i.Mixer_IN12?.MixA_GAIN,
    hpGain: i.Output_HP?.GAIN,
    thr: i.Compressor?.Threshold,
    eq1: i.EQ_IN1?.['Eq%401'],
  };
}

console.log('\n=== 1. состояние ДО снимка ===');
console.log('  ', JSON.stringify(state()));

console.log('\n=== 2. снимаю снимок A ===');
const snapA = await captureSnapshot(t, ws, { label: 'apply-test-A' });
console.log(`   ${snapA.path} (hid=${snapA.hidCount})`);

console.log('\n=== 3. ЛОМАЮ состояние ===');
// HID: brightness
const oldBright = t.get(0x11, 0x04);
t.send(0x11, 0x04, oldBright === 2 ? 0 : 2);
console.log(`   brightness ${oldBright} -> ${oldBright === 2 ? 0 : 2}`);
await sleep(1200);

// файл: микшер + output + eq
const broken = await ws.applyChanges([
  { section: 'Mixer_IN12', key: 'MixA_GAIN', value: 2 },
  { section: 'Output_HP', key: 'GAIN', value: -45 },
  { section: 'EQ_IN1', key: 'Eq%401', value: '|0|632|0.7|9' },
]);
console.log(`   workspace: изменено ${broken.applied} параметров`);

await sleep(2000);
console.log('\n  состояние ПОСЛЕ поломки:', JSON.stringify(state()));

console.log('\n=== 4. снимок B (для проверки разницы) ===');
const snapB = await captureSnapshot(t, ws, { label: 'apply-test-B' });
const diffAB = diffSnapshots(readSnapshot(snapA.path), readSnapshot(snapB.path));
console.log(`   изменений HID: ${diffAB.hid.length}`);
console.log(`   секций workspace: ${diffAB.workspace.join(', ') || 'нет'}`);

console.log('\n=== 5. ПРИМЕНЯЮ снимок A ===');
const snapData = readSnapshot(snapA.path);
const result = await applySnapshot(t, ws, snapData);
console.log(`   HID применено: ${result.hidApplied}`);
console.log(`   workspace применено: ${result.workspaceApplied}`);
console.log(`   пропущено: ${result.skipped}`);

await sleep(3000);

console.log('\n=== 6. состояние ПОСЛЕ применения ===');
const after = state();
console.log('  ', JSON.stringify(after));

console.log('\n=== 7. ПРОВЕРКА ===');
const snapAData = readSnapshot(snapA.path);
const expectBright = Number(snapAData.hid['11:04']);
const expectMixA = snapAData.workspace?.mixer?.find((m) => m.channel === 'IN12')?.buses?.A?.gain;
const expectHp = snapAData.workspace?.outputs?.find((o) => o.id === 'Output_HP')?.gain;
const expectEq = snapAData.workspace?.eq?.find((e) => e.id === 'EQ_IN1')?.bands?.[0]?.raw;

const checks = [
  ['brightness', after.bright, expectBright],
  ['MixA_GAIN', Number(after.mixA), expectMixA],
  ['Output_HP.GAIN', Number(after.hpGain), expectHp],
  ['EQ_IN1.Eq%401', after.eq1, expectEq],
];

let ok = 0;
for (const [name, got, want] of checks) {
  const pass = String(got) === String(want);
  console.log(`  ${name.padEnd(18)} ожидали ${want}, получили ${got}  ${pass ? 'OK' : 'FAIL'}`);
  if (pass) ok++;
}

console.log(`\n  ИТОГО: ${ok}/${checks.length}`);
t.close();
process.exit(ok === checks.length ? 0 : 1);
