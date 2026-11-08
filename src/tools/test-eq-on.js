/**
 * ПРОВЕРКА: приходят ли EQ-блоки 0x91..0x94, когда EQ ВКЛЮЧЁН?
 *
 * Включаем EQ через UI (кнопка EQ в панели эффектов), смотрим теги.
 */
import HID from 'node-hid';
import { buildFrame, withReportId, parseReport, isIdle } from '../protocol.js';
import { findActiveWorkspace, readWorkspace } from '../workspace.js';
import { dumpTree, invoke, ps, PRELUDE } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const found = HID.devices().filter((d) => d.vendorId === 0x152a && d.productId === 0x875c);
const vp = found.find((d) => d.interface === 4);
const dev = new HID.HID(vp.path);

const seen = new Map();
let cap = null;
dev.on('data', (buf) => {
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (isIdle(b)) return;
  const m = parseReport(b);
  if (!m) return;
  const k = (m.target << 8) | m.prop;
  seen.set(k, m.value);
  if (cap) cap.set(k, m.value);
});

async function snap(ms = 3000) {
  const s = new Map(seen);
  cap = s;
  dev.write([...withReportId(buildFrame(0x11, 0x26, 1, true))]);
  await sleep(ms);
  cap = null;
  return s;
}

const eqSwitch = () => {
  const ws = findActiveWorkspace();
  const ini = readWorkspace(ws.path);
  return ini.EQ_IN1?.Switch;
};

let s = await snap();
console.log(`ДО: файл EQ_IN1.Switch=${eqSwitch()}, HID параметров ${s.size}`);
console.log(`  блок 0x91: ${[...Array(10)].map((_, i) => s.get(0x9101 + i) ?? '—').join(' ')}`);

// найти страницу эффектов: нужна кнопка включения EQ
const { items } = dumpTree();
console.log('\nищу панель эффектов в UI...');

// Сначала открыть MORE
const more = items.find((x) => (x.name || '').trim() === 'MORE');
if (more) {
  await invoke(more.i);
  await sleep(2000);
  console.log('  открыл панель эффектов (MORE)');
}

// теперь ищем кнопки включения EQ в открывшейся панели
const search = PRELUDE + [
  '$root = Get-MccRoot',
  '$all = Get-MccAll $root',
  '$res = @()',
  'for ($i=0; $i -lt $all.Count; $i++) {',
  '  $e = $all.Item($i)',
  '  $r = $e.Current.BoundingRectangle',
  '  if ($r.Height -le 0) { continue }',
  '  $cx = [int]($r.X + $r.Width/2); $cy = [int]($r.Y + $r.Height/2)',
  '  $cls = $e.Current.ClassName',
  '  $nm = $e.Current.Name',
  '  if ($cls -match "QPushButton" -and $cy -gt 1400 -and $cy -lt 1750) {',
  '    $res += [pscustomobject]@{ i=$i; x=$cx; y=$cy; w=[int]$r.Width; n=$nm }',
  '  }',
  '}',
  '$res | ConvertTo-Json -Compress',
].join('\n');
const btns = JSON.parse(ps(search));
const bl = Array.isArray(btns) ? btns : [btns];
console.log(`\nкнопки в нижней панели (${bl.length}):`);
for (const b of bl.slice(0, 12)) console.log(`  [${b.i}] (${b.x},${b.y}) ${b.w}px "${b.n || ''}"`);

// нажать первую подходящую (EQ обычно крайняя левая в группе FX)
if (bl.length) {
  const target = bl[0];
  console.log(`\nнажимаю [${target.i}] (${target.x},${target.y})`);
  console.log('  ' + (await invoke(target.i)));
  await sleep(2500);

  s = await snap();
  console.log(`\nПОСЛЕ: файл EQ_IN1.Switch=${eqSwitch()}, HID параметров ${s.size}`);
  console.log(`  блок 0x91: ${[...Array(10)].map((_, i) => s.get(0x9101 + i) ?? '—').join(' ')}`);
  console.log(`  блок 0x92: ${[...Array(10)].map((_, i) => s.get(0x9201 + i) ?? '—').join(' ')}`);
}

dev.close();
process.exit(0);
