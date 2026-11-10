/**
 * ПОЛНАЯ СВЕРКА: ЧТО УМЕЕТ MCC ПРОТИВ ТОГО, ЧТО УМЕЕМ МЫ.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * Вопрос «мы всё отреверсили?» нельзя закрыть по памяти. Нужен список
 * возможностей вендорского приложения и явная отметка по каждой:
 * знаем адрес, умеем читать, умеем писать, проверено ли на железе.
 *
 * ═══ ОТКУДА СПИСОК ═══
 *
 * 1. `docs/FOR-DESIGNER.md` — что видит пользователь в MCC.
 * 2. `docs/STATUS.md` — карта покрытия проекта.
 * 3. Строки из `M Control Center.exe` (finance-модули: Effect_*,
 *    Mixer_*, Input_*, Output_*, Loopback_*).
 * 4. `research/NOTES.md` — что проверялось вручную.
 *
 * ═══ КАК СЧИТАЕТСЯ ═══
 *
 * Каждая возможность получает статус:
 *
 *   FULL    — читаем и пишем через HID, проверено на устройстве
 *   READ    — читаем, но не пишем
 *   WRITE   — пишем, но не читаем обратно (устройство не отдаёт)
 *   PARTIAL — часть полей расшифрована
 *   NONE    — адреса не знаем или только через MCC
 *
 * Запуск: node src/tools/feature-matrix.js
 */

import { existsSync } from 'node:fs';

/**
 * Полный список возможностей M62.
 *
 * evidence — чем подтверждено. Если пусто, значит не проверено.
 */
const FEATURES = [
  // ─── ГРОМКОСТИ ───
  {
    group: 'Громкости',
    name: 'Mic-1 / Mic-2 (0..88)',
    hid: '0x21:0x04 / 0x22:0x04',
    status: 'FULL',
    evidence: 'HID, запись проверена',
  },
  {
    group: 'Громкости',
    name: 'AUX / BT / OTG IN (0..99)',
    hid: '0x23:0x04 / 0x25:0x04 / 0x27:0x04',
    status: 'FULL',
    evidence: 'HID, запись проверена',
  },
  {
    group: 'Громкости',
    name: 'Наушники / OTG OUT',
    hid: '0x63/0x64:0x03 / 0x61/0x62:0x03',
    status: 'FULL',
    evidence: 'HID, пишется в пару',
  },

  // ─── СЕЛЕКТОРЫ ───
  {
    group: 'Селекторы',
    name: 'Источник наушников',
    hid: '0x64:0x02',
    status: 'WRITE',
    evidence: 'только запись; устройство селектор не сообщает',
  },
  {
    group: 'Селекторы',
    name: 'Источник OTG OUT',
    hid: '0x62:0x02',
    status: 'WRITE',
    evidence: 'только запись',
  },

  // ─── НАСТРОЙКИ УСТРОЙСТВА ───
  {
    group: 'Настройки',
    name: 'Яркость, BT, питание, autoPower',
    hid: '0x11:*',
    status: 'FULL',
    evidence: 'HID',
  },
  {
    group: 'Настройки',
    name: 'Режим Mobile/Live/Prof (смена)',
    hid: '0x11:0x1d',
    status: 'FULL',
    evidence: 'проверено 2026-11-10: устройство перезагружается само, MCC не нужен',
  },
  {
    group: 'Настройки',
    name: 'Sample rate / buffer size',
    hid: 'не HID — WAVEFORMATEX в реестре Windows',
    status: 'PARTIAL',
    evidence: 'читается без MCC (samplerate-tool.ps1); запись через реестр + '
      + 'перезапуск аудиослужбы. Это настройка ОС, а не протокол M62',
  },
  {
    group: 'Настройки',
    name: '48V (фантом) — чтение',
    hid: '0x11:0x19',
    status: 'READ',
    evidence: 'доказано нажатием кнопки в MCC: 0 -> 1',
  },
  {
    group: 'Настройки',
    name: '48V (фантом) — запись',
    hid: 'не найдена',
    status: 'NONE',
    evidence: 'MCC НИКОГДА не отправляет 0x11:19 (проверено по 5 захватам); '
      + 'ни кадр, ни брекет, ни INI не работают. Нужен захват с админом',
  },

  // ─── СЦЕНЫ ───
  {
    group: 'Сцены',
    name: 'Chat (включает ducking)',
    hid: '0x45:0x01',
    status: 'FULL',
    evidence: 'проверено, воспроизводится стабильно',
  },
  {
    group: 'Сцены',
    name: 'Vocal (выключает ducking)',
    hid: '0x45:0x02',
    status: 'FULL',
    evidence: 'проверено',
  },
  {
    group: 'Сцены',
    name: 'Пресеты 1-2 (save/load)',
    hid: '0x11:0x08 / 0x11:0x0e',
    status: 'FULL',
    evidence: 'команды работают. Хранят: громкости, реверб, NC, FX-уровни. '
    + 'НЕ хранят: компрессор, EQ. Микшер/loopback/ducking — проверить нельзя',
  },

  // ─── МЕТРЫ И ДЖЕКИ ───
  {
    group: 'Метры',
    name: '22 метра (входы, выходы, FX, компрессор)',
    hid: 'поток',
    status: 'READ',
    evidence: 'шкала dB = raw/10, пол -90.2',
  },
  {
    group: 'Джеки',
    name: 'Наличие джеков, батарея, зарядка',
    hid: '0x2x:0x06, 0x6x:0x06',
    status: 'READ',
    evidence: 'HID',
  },

  // ─── EQ ───
  {
    group: 'EQ входов',
    name: 'EQ IN1/IN2, 4 полосы x 5 полей',
    hid: '0x91..0x94',
    status: 'FULL',
    evidence: '7 из 7 полей проверено записью 2026-11-10',
  },
  {
    group: 'EQ наушников',
    name: 'EQ HP, 10 полос x 2 канала x 5 полей',
    hid: '0xa1..0xaa',
    status: 'FULL',
    evidence: 'проверено; только в Prof-режиме',
  },
  {
    group: 'EQ',
    name: 'Общий включатель EQ',
    hid: '0x9b:0x0f / 0x9b:0x10',
    status: 'FULL',
    evidence: 'проверено 2026-11-10',
  },
  {
    group: 'EQ',
    name: 'Типы фильтров (5 штук)',
    hid: '0x91..0x94 поле 0x02/0x07',
    status: 'FULL',
    evidence: 'коды 1..5, проверено',
  },

  // ─── КОМПРЕССОР ───
  {
    group: 'Компрессор',
    name: 'Threshold, Ratio, Attack, Release, Gain, Mix',
    hid: '0x46:0x02..0x08',
    status: 'FULL',
    evidence: '5 из 5 проверено записью 2026-11-10',
  },
  {
    group: 'Компрессор',
    name: 'Switch / GainAuto',
    hid: '0x46:0x01 / 0x46:0x07',
    status: 'FULL',
    evidence: 'пишется',
  },
  {
    group: 'Компрессор',
    name: 'Редукция (метр)',
    hid: '0x46:0x0c / 0x46:0x0d',
    status: 'READ',
    evidence: 'GR = (comp13 - comp12)/10',
  },

  // ─── РЕВЕРБ ───
  {
    group: 'Реверб',
    name: 'Тип (Bypass/STUDIO/LIVE/HALL)',
    hid: '0x44:0x0b',
    status: 'FULL',
    evidence: 'коды 1..4, проверено',
  },
  {
    group: 'Реверб',
    name: 'DryWet / Room / Decay / Width',
    hid: '0x44:0x08 / 0x09 / 0x0a / 0x0f',
    status: 'FULL',
    evidence: '4 из 4 проверено 2026-11-10 (при типе не Bypass)',
  },
  {
    group: 'Реверб',
    name: 'MuteFX',
    hid: '0x44:0x0c',
    status: 'FULL',
    evidence: 'пишется',
  },

  // ─── ШУМОПОДАВЛЕНИЕ ───
  {
    group: 'Шумоподавление',
    name: 'Уровень NC',
    hid: '0x44:0x06',
    status: 'FULL',
    evidence: 'проверено 35->40->35',
  },
  {
    group: 'Шумоподавление',
    name: 'Тип NC (NC1/NC2/NC3/bypass)',
    hid: '0x44:0x07 / 0x44:0x09',
    status: 'FULL',
    evidence: 'NC1=15, NC2=30, bypass=0; код NC1=1',
  },
  {
    group: 'Шумоподавление',
    name: 'NC3',
    hid: '0x44:0x07 = 45',
    status: 'NONE',
    evidence: 'ПРОВЕРЕНО: устройство ОТВЕРГАЕТ код 45, остаётся 30. '
    + 'У M62 только NC1 и NC2 — NC3 есть в коде MCC, но не в этой модели',
  },

  // ─── ЭФФЕКТЫ: FX-УРОВНИ ───
  {
    group: 'Эффекты',
    name: 'FX уровни: IN1, IN2, AUX, BT, OTG',
    hid: '0x44:0x01..0x05',
    status: 'FULL',
    evidence: 'проверено движением слайдеров',
  },

  // ─── МИКШЕР ───
  {
    group: 'Микшер',
    name: '5 шин (A-E) x 11 источников',
    hid: '0x31..0x3c, брекет',
    status: 'WRITE',
    evidence: '200/200 совпало с MCC; не читается обратно',
  },
  {
    group: 'Микшер',
    name: 'Коды всех 16 источников',
    hid: 'селекторы',
    status: 'FULL',
    evidence: 'все подтверждены захватом 2026-11-10',
  },

  // ─── LOOPBACK ───
  {
    group: 'Loopback',
    name: '4 пары: источник + gain',
    hid: '0x51..0x58',
    status: 'WRITE',
    evidence: 'запись проверена 2026-11-10; не читается',
  },

  // ─── DUCKING ───
  {
    group: 'Ducking',
    name: 'Threshold, Attack, Reduction, Release, Switch',
    hid: '0x43:0x01..0x04, 0x07',
    status: 'WRITE',
    evidence: 'запись проверена; не читается',
  },
  {
    group: 'Ducking',
    name: 'Маска входов (по битам)',
    hid: '0x43:0x05 / 0x43:0x06',
    status: 'PARTIAL',
    evidence: 'адреса известны, соответствие битов входам не проверено',
  },

  // ─── ЭФФЕКТЫ: НЕРАСШИФРОВАННОЕ ───
  {
    group: 'Неизвестное',
    name: 'Expander (Expander_IN1/IN2)',
    hid: '—',
    status: 'NONE',
    evidence: 'НЕ ФУНКЦИЯ M62: строки в MCC — это виджет графика '
    + '(updateChart, QList<QPointF>, CurveGreen). Остаток общей кодовой '
    + 'базы для KB22/KB35. В M62 блок не создаётся',
  },
  {
    group: 'Неизвестное',
    name: '0x9b:0x12 / 0x9b:0x13',
    hid: '0x9b:0x12/0x13',
    status: 'PARTIAL',
    evidence: 'ПРОВЕРЕНО: это ENUM 0..2 (всё больше 2 схлопывается в 2). '
    + 'Точный смысл не установлен; вероятно режим EQ для входа',
  },
];

const GROUP_ORDER = [
  'Громкости', 'Селекторы', 'Настройки', 'Сцены', 'Метры', 'Джеки',
  'EQ', 'EQ входов', 'EQ наушников', 'Компрессор', 'Реверб',
  'Шумоподавление', 'Эффекты', 'Микшер', 'Loopback', 'Ducking', 'Неизвестное',
];

const STATUS_LABEL = {
  FULL: 'ПОЛНОСТЬЮ',
  READ: 'только чтение',
  WRITE: 'только запись',
  PARTIAL: 'частично',
  NONE: 'нет',
};

function main() {
  const byGroup = new Map();
  for (const f of FEATURES) {
    if (!byGroup.has(f.group)) byGroup.set(f.group, []);
    byGroup.get(f.group).push(f);
  }

  console.log('='.repeat(78));
  console.log('ПОЛНАЯ СВЕРКА ВОЗМОЖНОСТЕЙ M62');
  console.log('='.repeat(78));
  console.log('');

  const order = [
    ...GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];

  for (const g of order) {
    console.log(`── ${g} ${'─'.repeat(Math.max(0, 70 - g.length))}`);
    for (const f of byGroup.get(g)) {
      const mark = f.status === 'FULL' ? '  ' : f.status === 'NONE' ? '!!' : ' ~';
      console.log(`${mark} ${f.name}`);
      console.log(`     статус: ${STATUS_LABEL[f.status].padEnd(15)} HID: ${f.hid}`);
      if (f.evidence) console.log(`     ${f.evidence}`);
    }
    console.log('');
  }

  // --- итоги ---
  const counts = { FULL: 0, READ: 0, WRITE: 0, PARTIAL: 0, NONE: 0 };
  for (const f of FEATURES) counts[f.status] += 1;

  const total = FEATURES.length;
  const pct = (n) => ((n / total) * 100).toFixed(0);

  console.log('='.repeat(78));
  console.log('ИТОГ');
  console.log('='.repeat(78));
  console.log(`  всего возможностей: ${total}`);
  console.log('');
  console.log(`  ПОЛНОСТЬЮ (читаем + пишем):  ${String(counts.FULL).padStart(2)}  (${pct(counts.FULL)}%)`);
  console.log(`  только чтение:               ${String(counts.READ).padStart(2)}  (${pct(counts.READ)}%)`);
  console.log(`  только запись:               ${String(counts.WRITE).padStart(2)}  (${pct(counts.WRITE)}%)`);
  console.log(`  частично:                    ${String(counts.PARTIAL).padStart(2)}  (${pct(counts.PARTIAL)}%)`);
  console.log(`  НЕ УМЕЕМ:                    ${String(counts.NONE).padStart(2)}  (${pct(counts.NONE)}%)`);
  console.log('');

  const usable = counts.FULL + counts.READ + counts.WRITE;
  console.log(`  управляемо через HID: ${usable} из ${total} = ${pct(usable)}%`);
  console.log(`  НЕ управляемо:        ${counts.PARTIAL + counts.NONE} из ${total} = ${pct(counts.PARTIAL + counts.NONE)}%`);
  console.log('');

  // --- что осталось ---
  const remaining = FEATURES.filter((f) => f.status === 'PARTIAL' || f.status === 'NONE');
  if (remaining.length) {
    console.log('='.repeat(78));
    console.log('ЧТО ОСТАЛОСЬ');
    console.log('='.repeat(78));
    for (const f of remaining) {
      console.log(`  [${STATUS_LABEL[f.status]}] ${f.group} / ${f.name}`);
      console.log(`      ${f.evidence}`);
    }
  }
}

main();
