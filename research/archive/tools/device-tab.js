/** Открыть настройки -> вкладка Device -> снять контролы. */
import { dumpTree, invoke } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoDeviceTab() {
  const { items } = dumpTree();
  const tab = items.find((x) => (x.name || '').trim() === 'Device');
  if (!tab) return null;
  await invoke(tab.i);
  await sleep(1200);
  return tab.i;
}

const tabIdx = await gotoDeviceTab();
console.log(`вкладка Device: ${tabIdx === null ? 'не найдена' : 'idx=' + tabIdx}\n`);

const { items } = dumpTree();
console.log(`элементов: ${items.length}\n`);

const labels = items.filter((x) => x.cls === 'QLabel' && x.name && x.name.trim());
labels.sort((a, b) => a.ly - b.ly || a.lx - b.lx);

const RE = /Bluetooth|Brightness|OTG|USB-C|Mode|Power|Reset|Main button|System|Device|ASIO|About/i;
console.log('=== подписи ===');
for (const l of labels) {
  if (!RE.test(l.name)) continue;
  console.log(`  [${String(l.i).padStart(3)}] (${String(l.lx).padStart(4)},${String(l.ly).padStart(4)}) "${l.name.replace(/\n/g, '/')}"`);
}

console.log('\n=== контролы рядом с настройками ===');
for (const l of labels) {
  if (!/Bluetooth|Brightness|OTG|USB-C|Mode select|Power|Reset|Main button/i.test(l.name)) continue;
  const near = items.filter(
    (y) => y.i !== l.i && Math.abs(y.ly - l.ly) < 28 && /ComboBoxS1M3|QPushButton/.test(y.cls),
  );
  console.log(`"${l.name.trim()}"`);
  for (const n of near.slice(0, 3)) {
    console.log(`   [${String(n.i).padStart(3)}] ${n.cls === 'QPushButton' ? 'toggle' : 'combo '} [${n.pats}] "${(n.name || '').trim()}"`);
  }
}
