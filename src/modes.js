/**
 * ОПРЕДЕЛЕНИЕ РЕЖИМА УСТРОЙСТВА.
 *
 * Тег 0x11:0x1d (FirmwareSelected) устройство НЕ возвращает — проверено.
 * Поэтому режим определяется КОСВЕННО по набору доступных блоков.
 *
 * Проверено (research/CROSSCHECK.md §7, NOTES §36):
 *   Mobile  — микшера нет, loopback нет, эффекты есть
 *   Live    — микшер A–E (5 шин), loopback 4, эффекты есть
 *   Pro     — микшер A–C (3 шины), EQ наушников, эффектов нет
 */

/** Что доступно в каждом режиме (по мануалу + проверено). */
export const MODE_CAPABILITIES = {
  Mobile: {
    mixerBuses: 0,
    loopback: false,
    effects: true,
    eqInputs: false,
    eqHeadphone: false,
    ducking: true,
    compressor: true,
    note: 'только мобильный режим: эффекты есть, микшера и loopback нет',
  },
  Live: {
    mixerBuses: 5,
    loopback: true,
    effects: true,
    eqInputs: true,
    eqHeadphone: false,
    ducking: true,
    compressor: true,
    note: 'Live streaming: микшер A–E, эффекты, loopback',
  },
  Prof: {
    mixerBuses: 3,
    loopback: true,
    effects: false,
    eqInputs: false,
    eqHeadphone: true,
    ducking: false,
    compressor: true,
    note: 'Pro audio: микшер A–C, EQ наушников, без эффектов',
  },
  Tyro: {
    mixerBuses: null,
    loopback: null,
    effects: null,
    eqInputs: null,
    eqHeadphone: null,
    ducking: null,
    compressor: null,
    note: 'режим не исследован',
  },
};

/**
 * Определить режим по данным workspace.
 *
 * @param {{mode?: string, mixer?: any[], loopback?: any[], eq?: any[], effects?: any}} ws
 * @returns {{mode: string, confidence: 'high'|'low', reasons: string[]}}
 */
export function detectMode(ws) {
  const reasons = [];

  // самый надёжный признак — имя папки workspace
  if (ws?.mode && MODE_CAPABILITIES[ws.mode]) {
    reasons.push(`папка workspace: ${ws.mode}`);
    return { mode: ws.mode, confidence: 'high', reasons };
  }
  const mixerChannels = ws?.mixer?.length ?? 0;
  const loopbackCount = ws?.loopback?.length ?? 0;
  const eqIds = (ws?.eq ?? []).map((e) => e.id);
  const hasEqHp = eqIds.includes('EQ_HP');
  const hasEqInputs = eqIds.includes('EQ_IN1') || eqIds.includes('EQ_IN2');
  const hasEffects = Boolean(ws?.effects);

  reasons.push(`каналов микшера: ${mixerChannels}`);
  reasons.push(`loopback: ${loopbackCount}`);
  reasons.push(`EQ: ${eqIds.join(',') || 'нет'}`);
  reasons.push(`эффекты: ${hasEffects ? 'есть' : 'нет'}`);

  // Pro: есть EQ_HP, нет эффектов
  if (hasEqHp && !hasEffects) {
    return { mode: 'Prof', confidence: 'high', reasons };
  }
  // Live: есть эффекты и микшер
  if (hasEffects && mixerChannels > 0 && hasEqInputs) {
    return { mode: 'Live', confidence: 'high', reasons };
  }
  // Mobile: эффекты есть, микшера нет
  if (hasEffects && mixerChannels === 0) {
    return { mode: 'Mobile', confidence: 'high', reasons };
  }
  // Pro без EQ_HP (файл Prof без панели EQ)
  if (!hasEffects && mixerChannels > 0) {
    return { mode: 'Prof', confidence: 'low', reasons };
  }
  if (hasEffects) {
    return { mode: 'Live', confidence: 'low', reasons };
  }

  return { mode: 'unknown', confidence: 'low', reasons };
}

/**
 * Определить режим ПО HID-СЕМЕЙСТВАМ — самый надёжный способ.
 *
 * Проверено (NOTES §84): при рассинхронизации workspace и реестр могут
 * врать, а набор HID-тегов отражает реальное состояние устройства.
 *
 * | семейства                       | режим  |
 * |---------------------------------|--------|
 * | только 11,12,21-25,62,64        | Mobile |
 * | + 0x44 (эффекты)                | Live   |
 * | + 0x46 (компрессор), без 0x44   | Pro    |
 *
 * @param {{target: number}|Map<number, number>} tags карта тегов ("TT:PP" -> value)
 *        или любой объект, по которому можно получить список семейств
 * @returns {{mode: string, confidence: 'high'|'low', families: number[], reasons: string[]}}
 */
export function detectModeFromHid(tags) {
  const reasons = [];
  let families = [];
  let fxMeterProps = new Set();

  if (tags instanceof Map) {
    families = [...new Set([...tags.keys()].map((k) => (k >> 8) & 0xff))];
  } else if (tags && typeof tags === 'object') {
    // Объект вида { "145:1": 2, ... }.
    //
    // ВАЖНО: transport.js формирует ключи как `${msg.target}:${msg.prop}`,
    // то есть в ДЕСЯТИЧНОЙ системе. parseInt(...,16) здесь дал бы
    // 0x145 вместо 0x91 — и все проверки семейств ломались.
    //
    // Поддерживаем оба формата:
    //   "a1:03"   hex (так пишут наши скрипты и дампы)
    //   "161:3"   decimal (так пишет transport)
    //
    // Различаем по наличию букв a-f: если они есть — точно hex,
    // иначе пробуем оба и берём то, что попадает в известный диапазон.
    // ═══ ФОРМАТ КЛЮЧЕЙ: НЕОДНОЗНАЧНОСТЬ, КОТОРАЯ ЛОМАЛА ВСЁ ═══
    //
    // Ключи приходят в ДВУХ форматах:
    //   "44:0d"  — hex (так пишут дампы и наши скрипты)
    //   "68:13"  — decimal (так пишет transport: `${target}:${prop}`)
    //
    // Проблема: "44" — это И hex 0x44, И decimal 44 (0x2C). Отличить
    // по строке НЕЛЬЗЯ. Прежняя эвристика «есть буквы a-f -> hex,
    // иначе decimal» читала "44" как 44 -> 0x2C, и семейство эффектов
    // не находилось вовсе. Из-за этого Live определялся как Mobile.
    //
    // Решение: разбираем ключи ОБОИМИ способами и выбираем то
    // прочтение, при котором больше семейств попадает в известные.
    const KNOWN = (t) =>
      t === 0x11 || t === 0x12 || t === 0x45 || t === 0x43 || t === 0x44
      || t === 0x46 || t === 0x9b
      || (t >= 0x21 && t <= 0x27)
      || (t >= 0x31 && t <= 0x3c)
      || (t >= 0x51 && t <= 0x58)
      || (t >= 0x61 && t <= 0x64)
      || (t >= 0x91 && t <= 0x94)
      || (t >= 0xa1 && t <= 0xab);

    const raw = Object.keys(tags);
    const hasLetters = raw.some((k) => /[a-f]/i.test(String(k).split(':')[0]));

    const readWith = (radix) => {
      const set = new Set();
      const props = new Set();
      let known = 0;
      for (const key of raw) {
        const [a, b] = String(key).split(':');
        const tt = parseInt(a, radix);
        if (!Number.isFinite(tt)) continue;
        set.add(tt);
        if (KNOWN(tt)) known += 1;
        if (tt === 0x44 && b !== undefined) {
          const pp = parseInt(b, 16);
          if (Number.isFinite(pp)) props.add(pp);
        }
      }
      return { set, props, known };
    };

    // Если буквы есть — формат точно hex, спорить не о чем.
    // Иначе считаем оба и берём более «осмысленный».
    const hex = readWith(16);
    const dec = readWith(10);
    const best = hasLetters || hex.known >= dec.known ? hex : dec;

    families = [...best.set];
    fxMeterProps = best.props;
  }

  families.sort((a, b) => a - b);
  reasons.push(`HID-семейства: ${families.map((f) => '0x' + f.toString(16)).join(',') || 'нет'}`);

  if (families.length === 0) {
    return { mode: 'unknown', confidence: 'low', families, reasons: [...reasons, 'тегов нет — устройство молчит'] };
  }

  const hasEffects = families.includes(0x44);
  const hasCompressor = families.includes(0x46);
  const hasEqIn = families.includes(0x91) || families.includes(0x92);

  // EQ НАУШНИКОВ (0xa1..0xaa) — есть ТОЛЬКО в Prof-режиме.
  //
  // Это самый надёжный признак Prof: в Live и Mobile этих блоков нет
  // вообще (проверено дампами всех трёх режимов, docs/EQ-HP.md).
  // Проверять надо ДО остальных условий: в Prof тоже есть 0x46
  // (компрессор), а 0x44 (эффекты) — нет.
  const hasEqHp = families.some((f) => f >= 0xa1 && f <= 0xaa);

  if (hasEqHp) {
    return {
      mode: 'Prof',
      confidence: 'high',
      families,
      reasons: [...reasons, 'есть 0xa1..0xaa (EQ наушников) — только Prof'],
    };
  }

  if (hasEffects && (hasEqIn || families.length > 12)) {
    // ═══ ИСПРАВЛЕНО 2026-11-08 ═══
    //
    // Раньше здесь Live и Mobile различались по loopback 0x51..0x58:
    // «в Live есть, в Mobile нет». ЭТО НЕВЕРНО.
    //
    // Loopback НИКОГДА не приходит в поток IN ни в одном режиме.
    // Проверено по всем 6 захватам (check-exact-direction.py):
    //
    //     0x51:0x02  OUT=4   IN=0   ТОЛЬКО ПИШЕТСЯ
    //
    // То есть прежнее условие всегда давало «нет loopback» -> Mobile,
    // и Live определялся как Mobile. Именно это и случилось при
    // проверке 2026-11-08, когда устройство стояло в Live streaming.
    //
    // Настоящее различие — состав эффектов 0x44:
    //
    //   Mobile: 6 тегов   (44:06 44:07 44:08 44:09 44:0a 44:0f)
    //   Live:  15 тегов   (+ 44:01..05 уровни FX-входов, 44:0b тип
    //                      реверба, 44:0c mute, 44:0d/0e метры FX)
    //
    // Самый чистый признак — метры FX 0x44:0x0d/0x0e: они есть только
    // в Live и отсутствуют в Mobile и Prof.
    // Метры FX — 0x44:0x0d и 0x44:0x0e. Только они есть в Live
    // и отсутствуют в Mobile (проверено дампами: Mobile отдаёт 6
    // свойств 0x44 без 0x0d/0x0e, Live — 15 свойств с ними).
    const hasFxMeters = families.includes(0x44)
      && (fxMeterProps.has(0x0d) || fxMeterProps.has(0x0e));

    if (hasFxMeters) {
      return {
        mode: 'Live',
        confidence: 'high',
        families,
        reasons: [...reasons, 'есть 0x44 (эффекты) и метры FX 0x44:0x0d/0x0e — Live'],
      };
    }

    // Эффекты есть, метров FX нет -> Mobile.
    //
    // Второй признак — число свойств 0x44: Mobile 6, Live 15. Но он
    // зависит от того, сколько успело прийти в дамп, поэтому решающим
    // делаем наличие метров (они статичны и приходят всегда в Live).
    const fxCount = fxMeterProps.size;
    return {
      mode: 'Mobile',
      confidence: fxCount > 0 && fxCount <= 8 ? 'high' : 'medium',
      families,
      reasons: [
        ...reasons,
        `есть 0x44 (эффекты): ${fxCount} свойств, метров FX 0x0d/0x0e нет — Mobile`,
      ],
    };
  }
  if (hasEffects) {
    return { mode: 'Live', confidence: 'high', families, reasons: [...reasons, 'есть 0x44 (эффекты)'] };
  }
  if (hasCompressor) {
    return { mode: 'Prof', confidence: 'high', families, reasons: [...reasons, 'есть 0x46 (компрессор), нет 0x44'] };
  }
  // только базовые — Mobile
  return { mode: 'Mobile', confidence: 'high', families, reasons: [...reasons, 'только базовые семейства — Mobile'] };
}

/**
 * Сравнить режим из файла и из HID: обнаружить рассинхронизацию.
 *
 * @param {{mode?: string}} ws
 * @param {Map<number, number>|object} tags
 */
export function checkModeConsistency(ws, tags) {
  const fromFile = detectMode(ws);
  const fromHid = detectModeFromHid(tags);
  const consistent = fromFile.mode === fromHid.mode
    || (fromFile.mode === 'Prof' && fromHid.mode === 'Live'); // Pro может показывать эффекты

  return {
    consistent,
    fromWorkspace: fromFile,
    fromHid: fromHid,
    warning: consistent
      ? null
      : `РАССИНХРОНИЗАЦИЯ: workspace говорит ${fromFile.mode}, HID — ${fromHid.mode}. `
        + 'Перезапустите M Control Center для синхронизации.',
  };
}
export function describeMode(ws) {
  const det = detectMode(ws);
  const caps = MODE_CAPABILITIES[det.mode] ?? MODE_CAPABILITIES.Tyro;
  return {
    ...det,
    capabilities: caps,
    // что реально пришло в данных — важнее, чем таблица
    actual: {
      mixerChannels: ws?.mixer?.length ?? 0,
      loopbackCount: ws?.loopback?.length ?? 0,
      eqBlocks: (ws?.eq ?? []).map((e) => e.id),
      hasEffects: Boolean(ws?.effects),
      hasCompressor: Boolean(ws?.compressor),
      hasDucking: Boolean(ws?.ducking),
    },
    caveats: [
      'тег 0x11:0x1d (mode) устройство не возвращает',
      'режим определяется по имени папки workspace или по составу блоков',
      'смена режима перезагружает устройство и меняет активный workspace',
    ],
  };
}
