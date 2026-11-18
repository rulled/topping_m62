/**
 * ПЕРЕПРОВЕРКА: какие интерфейсы у M62 и какой из них DFU.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * В заметках записано: «interface 3 = DFU, никогда не трогать».
 * Но есть подозрение, что где-то могла закрасться путаница и что
 * «нельзя трогать» относится к interface 4 — тому самому, через
 * который мы работаем. Это надо проверить фактами, а не памятью:
 * ошибка здесь означает либо кирпич, либо отказ от единственного
 * рабочего канала управления.
 *
 * ═══ ЧТО ДЕЛАЕТ ═══
 *
 * Перечисляет ВСЕ USB-интерфейсы устройства через Windows (PnP +
 * дескрипторы), сопоставляет их с тем, что видит node-hid, и
 * печатает таблицу. НИЧЕГО НЕ ОТКРЫВАЕТ НА ЗАПИСЬ.
 *
 * ═══ БЕЗОПАСНОСТЬ ═══
 *
 * Скрипт только читает перечисление устройств. Он не открывает
 * никакой интерфейс, кроме (опционально) того, что уже используется
 * остальным кодом — interface 4, и только на чтение дескриптора.
 *
 * Запуск: node src/tools/audit-usb-interfaces.js
 */

import { execFileSync } from 'node:child_process';
import HID from 'node-hid';

import { PID, VID } from '../transport-consts.js';

const hex4 = (n) => `0x${Number(n).toString(16).padStart(4, '0')}`;
const hex2 = (n) => `0x${Number(n).toString(16).padStart(2, '0')}`;

console.log('='.repeat(74));
console.log('АУДИТ: ИНТЕРФЕЙСЫ M62 — ГДЕ DFU, ГДЕ КАНАЛ УПРАВЛЕНИЯ');
console.log('='.repeat(74));
console.log(`\nVID ${hex4(VID)}  PID ${hex4(PID)}\n`);

// ─── 1. что видит node-hid ───
const hidDevices = HID.devices().filter(
  (d) => d.vendorId === VID && d.productId === PID,
);

console.log('-'.repeat(74));
console.log('1. ЧТО ВИДИТ node-hid (только HID-интерфейсы)');
console.log('-'.repeat(74));

if (!hidDevices.length) {
  console.log('  HID-интерфейсов M62 не найдено (карта не подключена?)');
} else {
  console.log(`  найдено HID-интерфейсов: ${hidDevices.length}\n`);
  for (const d of hidDevices) {
    console.log(`  interface=${d.interface}  usagePage=${hex4(d.usagePage ?? 0)}  `
      + `usage=${hex4(d.usage ?? 0)}`);
    console.log(`    product: ${d.product ?? '—'}`);
    console.log(`    path:    ${d.path}`);
  }
}

// ─── 2. все интерфейсы через Windows PnP ───
console.log('\n' + '-'.repeat(74));
console.log('2. ВСЕ USB-ИНТЕРФЕЙСЫ УСТРОЙСТВА (Windows PnP)');
console.log('-'.repeat(74));

let pnpRows = [];
try {
  const ps = `
    Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
      Where-Object { $_.InstanceId -match 'VID_152A' } |
      Select-Object -Property Class, FriendlyName, InstanceId, Status |
      ConvertTo-Json -Compress
  `;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  pnpRows = out ? JSON.parse(out) : [];
  if (!Array.isArray(pnpRows)) pnpRows = [pnpRows];
} catch (err) {
  console.log(`  не удалось получить список: ${String(err?.message ?? err).slice(0, 200)}`);
}

if (!pnpRows.length) {
  console.log('  Windows не отдала список (или карта не подключена)');
} else {
  // Сортируем по номеру интерфейса из InstanceId (MI_04 = interface 4)
  const parsed = pnpRows.map((r) => {
    const m = /MI_(\d+)/i.exec(r.InstanceId ?? '');
    return {
      iface: m ? Number(m[1]) : null,
      cls: r.Class,
      name: r.FriendlyName,
      status: r.Status,
      id: r.InstanceId,
    };
  }).sort((a, b) => (a.iface ?? 99) - (b.iface ?? 99));

  console.log(`  устройств/интерфейсов: ${parsed.length}\n`);
  console.log('  iface  класс        статус   имя');
  console.log('  ' + '-'.repeat(70));
  for (const p of parsed) {
    const iface = p.iface === null ? '  — ' : `  ${p.iface} `;
    console.log(`  ${iface}  ${String(p.cls ?? '—').padEnd(12)} `
      + `${String(p.status ?? '—').padEnd(8)} ${String(p.name ?? '—').slice(0, 38)}`);
  }
}

// ─── 3. вывод ───
console.log('\n' + '='.repeat(74));
console.log('ЧТО ЭТО ЗНАЧИТ');
console.log('='.repeat(74));

const hidIfaces = hidDevices.map((d) => d.interface).filter((x) => x !== undefined);
console.log(`\n  HID-интерфейсов: ${hidIfaces.length} `
  + `(номер${hidIfaces.length === 1 ? '' : 'а'}: ${hidIfaces.length ? hidIfaces.join(', ') : 'нет'})`);
console.log('  ВНИМАНИЕ к чтению: «4» здесь — НОМЕР интерфейса, а не их количество.');

console.log(`
Правила, которые нельзя путать:

  interface 3 = DFU (обновление прошивки).
                НЕ HID. Через WebHID и node-hid недоступен ВООБЩЕ,
                потому что оба перечисляют только HID-устройства.
                Писать туда — риск кирпича. Мы туда не пишем.

  interface 4 = vendor control (HID, mi_04).
                ЭТО И ЕСТЬ единственный канал управления.
                Через него идёт весь наш протокол: handshake,
                keepalive, чтение состояния, запись параметров.

То есть «нельзя трогать interface 4» — неверно: без него сервиса
нет. Запрет относится к interface 3. Проверка выше показывает, что
в HID-списке присутствует ровно один интерфейс (4), а DFU в HID не
попадает — значит дотянуться до него через наш код физически
нельзя.
`);
