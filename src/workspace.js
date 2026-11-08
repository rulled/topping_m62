/**
 * ПАРСЕР И ПИСАТЕЛЬ WORKSPACE-ФАЙЛОВ MCC (.ini).
 *
 * ГЛАВНОЕ ОТКРЫТИЕ (раунд 2):
 * микшер, EQ, 48V, MIC, loopback и часть эффектов НЕ идут через HID.
 * Они живут в INI-файле workspace:
 *
 *   C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\<Mode>\M62_<Mode>_<name>.ini
 *
 * Файл обновляется В РЕАЛЬНОМ ВРЕМЕНИ при изменении в UI.
 *
 * Проверено: поставил слайдер Mix A -> 12, в файле появилось MixA_GAIN=12.
 *
 * Этот модуль читает и пишет такие файлы. Запись в файл — это НЕ запись
 * в устройство: файл применит сам MCC (или пользователь при загрузке).
 */

import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

/** Базовый путь workspace MCC. */
export const WORKSPACE_ROOT =
  String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62`;

/** Режимы и их папки. */
export const MODE_DIRS = {
  Live: 'Live',
  Prof: 'Prof',
  Mble: 'Mble',
  Tyro: 'Tyro',
};

/**
 * Разобрать INI в { section: { key: value } }.
 * @param {string} text
 */
export function parseIni(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) {
      section = m[1];
      out[section] = out[section] ?? {};
      continue;
    }
    if (!section) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[section][line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** Собрать INI обратно в текст. */
export function buildIni(obj) {
  const lines = [];
  for (const [section, kv] of Object.entries(obj)) {
    lines.push(`[${section}]`);
    for (const [k, v] of Object.entries(kv)) lines.push(`${k}=${v}`);
    lines.push('');
  }
  return lines.join('\r\n');
}

/**
 * Найти все workspace-файлы.
 * @returns {Array<{mode:string,name:string,path:string,mtime:Date,size:number}>}
 */
export function listWorkspaces() {
  const res = [];
  for (const [mode, dir] of Object.entries(MODE_DIRS)) {
    const full = join(WORKSPACE_ROOT, dir);
    let files;
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.ini')) continue;
      const p = join(full, f);
      const st = statSync(p);
      const name = f.replace(/^M62_[A-Za-z]+_/, '').replace(/\.ini$/i, '');
      res.push({ mode, name, path: p, mtime: st.mtime, size: st.size });
    }
  }
  return res.sort((a, b) => b.mtime - a.mtime);
}

/** Самый свежий workspace — обычно активный. */
export function findActiveWorkspace() {
  const all = listWorkspaces();
  return all.length ? all[0] : null;
}

/**
 * Активный workspace по РЕЕСТРУ — надёжнее, чем по mtime.
 *   HKCU\Software\TOPPING\TOPPING Professional Control Center\M62
 *     M62_Live_Workspace = <имя>
 *     M62_Prof_Workspace = <имя>
 *     M62_Mble_Workspace = <имя>
 *
 * Проверено 2026-11-07 (research/NOTES.md §26).
 *
 * @param {string} [mode] 'Live' | 'Prof' — если не задан, берётся самый свежий
 */
export function findActiveWorkspaceFromRegistry(mode) {
  const KEY = String.raw`HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62`;
  const names = {
    Live: 'M62_Live_Workspace',
    Prof: 'M62_Prof_Workspace',
    Mble: 'M62_Mble_Workspace',
    Tyro: 'M62_Tyro_Workspace',
  };

  let wantMode = mode;
  let wsName = null;

  try {
    const query = (valueName) => execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        `(Get-ItemProperty -Path '${KEY}' -Name '${valueName}' -ErrorAction SilentlyContinue).'${valueName}'`],
      { encoding: 'utf8' },
    ).trim();

    if (wantMode) {
      wsName = query(names[wantMode]);
    } else {
      // какой режим активен — по самому свежему файлу
      const freshest = listWorkspaces()[0];
      wantMode = freshest?.mode ?? 'Live';
      wsName = query(names[wantMode]);
    }
  } catch {
    return null;
  }

  if (!wsName) return null;
  const dir = MODE_DIRS[wantMode];
  if (!dir) return null;
  const p = join(WORKSPACE_ROOT, dir, `M62_${dir}_${wsName}.ini`);
  try {
    const st = statSync(p);
    return { mode: wantMode, name: wsName, path: p, mtime: st.mtime, size: st.size };
  } catch {
    return null;
  }
}

/** Прочитать workspace. */
export function readWorkspace(path) {
  return parseIni(readFileSync(path, 'utf8'));
}

/** Записать workspace (сохраняя формат). */
export function writeWorkspace(path, obj) {
  writeFileSync(path, buildIni(obj), 'utf8');
}

// ---------- высокоуровневые разборы ----------

/**
 * Состояние микшера: канал -> шина -> все параметры.
 *
 * В файле (полный набор, 59 ключей на канал):
 *   [Mixer_<CH>] Mix<BUS>_GAIN / _GAINLeft / _GAINRight / _Link
 *                Mix<BUS>_MUTE / _MUTELeft / _MUTERight
 *                Mix<BUS>_SOLO / _SOLOLeft / _SOLORight
 *                Mix<BUS>_ANTI / _ANTILeft / _ANTIRight
 *                Mix<BUS>_BalanceLinkedLeft/Right, _BalanceUnlinkLeft/Right
 *
 * Каналы: IN12, AUX, BT, OTGIN, FX, PB12, PB34, PB56, PB78, PB910
 * Шины: A..E (в Pro — только A..C; у D/E нет стерео-развязки)
 */
export function parseMixer(ini) {
  const NUM_FIELDS = ['gain', 'gainLeft', 'gainRight'];
  const BOOL_FIELDS = ['mute', 'muteLeft', 'muteRight', 'solo', 'soloLeft', 'soloRight',
    'anti', 'antiLeft', 'antiRight', 'link'];
  const BALANCE_FIELDS = ['balanceLinkedLeft', 'balanceLinkedRight',
    'balanceUnlinkLeft', 'balanceUnlinkRight'];

  const channels = [];
  for (const [section, kv] of Object.entries(ini)) {
    const m = section.match(/^Mixer_(.+)$/);
    if (!m) continue;
    const ch = m[1];
    const buses = {};
    for (const [k, v] of Object.entries(kv)) {
      const bm = k.match(/^Mix([A-H])_(.+)$/);
      if (!bm) continue;
      const bus = bm[1];
      const rawField = bm[2];
      buses[bus] = buses[bus] ?? {};

      // GAIN / GAINLeft / GAINRight
      const gf = rawField.match(/^GAIN(Left|Right)?$/);
      if (gf) {
        const key = gf[1] ? `gain${gf[1]}` : 'gain';
        buses[bus][key] = Number(v);
        continue;
      }
      // MUTE / MUTELeft / MUTERight, SOLO…, ANTI…
      const bf = rawField.match(/^(MUTE|SOLO|ANTI)(Left|Right)?$/);
      if (bf) {
        const base = bf[1].toLowerCase();
        const key = bf[2] ? `${base}${bf[2]}` : base;
        buses[bus][key] = v === 'true';
        continue;
      }
      if (rawField === 'Link') { buses[bus].link = v === 'true'; continue; }
      const bal = rawField.match(/^Balance(Linked|Unlink)(Left|Right)$/);
      if (bal) {
        const key = `balance${bal[1]}${bal[2]}`;
        buses[bus][key] = Number(v);
      }
    }
    channels.push({ channel: ch, name: kv.ChannelName ?? ch, buses });
  }
  return channels;
}

/**
 * EQ: [EQ_IN1], [EQ_IN2] — 4 полосы; [EQ_HP] — 10 полос.
 *
 * ВАЖНО: ДВА РАЗНЫХ ФОРМАТА полос!
 *
 *   EQ_IN1 / EQ_IN2:  `|тип|частота|Q|gain|`   (с ведущим `|`)
 *      пример: |0|632|0.7|0
 *
 *   EQ_HP:            `тип|gain|частота|Q|?`   (без ведущего `|`, порядок другой!)
 *      пример: 0|9|35|0.5395|1
 *
 * Это обнаружено инвентаризацией 4 workspace-файлов
 * (research/WORKSPACE-FULL.md §4).
 */
export function parseEq(ini) {
  const out = [];
  for (const [section, kv] of Object.entries(ini)) {
    if (!/^EQ_/.test(section)) continue;

    // ВАЖНО (исправлено 2026-11-07): формат определяется ДЛЯ КАЖДОЙ ПОЛОСЫ
    // отдельно, по числу полей, а НЕ один раз на секцию.
    //
    // Причина: MCC переписывает полосу в 5-польный формат ТОЛЬКО когда её
    // редактируют. Поэтому в одном файле ЛЕГКО встретить смесь:
    //   Eq%401 = 0|-5.9|1262|0.1|0     (5 полей, правили)
    //   Eq%402 = |0|632|0.7|0          (4 поля, не правили)
    // Старый код решал формат по первой полосе -> все остальные парсились
    // неверно (gain=632, freq=0.7, q=0 — полный бред).
    //
    // Форматы:
    //   5 полей: тип|gain|частота|Q|флаг
    //   4 поля:  тип|частота|Q|gain     (обычно с ведущим '|')
    const bands = [];
    for (let i = 1; i <= 10; i++) {
      const v = kv[`Eq%40${i}`];
      if (v === undefined) continue;

      // Убираем ведущий/замыкающий разделитель, но помним его наличие.
      const leading = String(v).startsWith('|');
      const parts = String(v).split('|').filter((x) => x !== '');
      const isFiveField = parts.length >= 5 && !leading;

      let band;
      if (isFiveField) {
        // тип|gain|частота|Q|флаг
        band = {
          band: i,
          raw: v,
          format: '5',
          type: parts[0] !== undefined ? Number(parts[0]) : null,
          gain: parts[1] !== undefined ? Number(parts[1]) : null,
          freq: parts[2] !== undefined ? Number(parts[2]) : null,
          q: parts[3] !== undefined ? Number(parts[3]) : null,
          flag: parts[4] !== undefined ? Number(parts[4]) : null,
        };
      } else {
        // тип|частота|Q|gain
        band = {
          band: i,
          raw: v,
          format: '4',
          type: parts[0] !== undefined ? Number(parts[0]) : null,
          freq: parts[1] !== undefined ? Number(parts[1]) : null,
          q: parts[2] !== undefined ? Number(parts[2]) : null,
          gain: parts[3] !== undefined ? Number(parts[3]) : null,
          flag: null,
        };
      }
      bands.push(band);
    }

    // Формат секции = формат ПЕРВОЙ полосы (для обратной совместимости API),
    // но у каждой полосы есть собственное поле `format`.
    const firstBand = bands[0];
    out.push({
      id: section,
      switch: kv.Switch === '1' || kv.Switch === 'true',
      gainInput: kv.GainInput !== undefined ? Number(kv.GainInput) : null,
      gainOutput: kv.GainOutput !== undefined ? Number(kv.GainOutput) : null,
      format: firstBand ? (firstBand.format === '5' ? 'hp' : 'in') : 'in',
      mixedFormat: new Set(bands.map((b) => b.format)).size > 1,
      bands,
    });
  }
  return out;
}

/** Входы: MIC, 48V, SOLO, MUTE, GAIN, ANTI, Balance. */
export function parseInputs(ini) {
  const out = [];
  for (const [section, kv] of Object.entries(ini)) {
    const m = section.match(/^Input_(.+)$/);
    if (!m) continue;
    out.push({
      id: section,
      channel: m[1],
      name: kv.ChannelName ?? m[1],
      mic: kv.MIC ?? null,
      phantom48: kv['48V'] === '1' || kv['48V'] === 'true',
      solo: kv.SOLO === 'true',
      mute: kv.MUTE === '1' || kv.MUTE === 'true',
      gain: kv.GAIN !== undefined ? Number(kv.GAIN) : null,
      anti: kv.ANTI !== undefined ? Number(kv.ANTI) : null,
      balance: kv.Balance !== undefined ? Number(kv.Balance) : null,
    });
  }
  return out;
}

/** Loopback: источник, уровень, стерео-развязка. */
export function parseLoopback(ini) {
  const out = [];
  for (const [section, kv] of Object.entries(ini)) {
    const m = section.match(/^Loopback_(.+)$/);
    if (!m) continue;
    const num = (k) => (kv[k] !== undefined ? Number(kv[k]) : null);
    const bool = (k) => kv[k] === 'true' || kv[k] === '1';
    out.push({
      id: section,
      channel: m[1],
      name: kv.ChannelName ?? m[1],
      source: kv.AudioSource ?? null,
      gain: num('GAIN'),
      gainLeft: num('GAINLeft'),
      gainRight: num('GAINRight'),
      mute: bool('MUTE'),
      muteLeft: bool('MUTELeft'),
      muteRight: bool('MUTERight'),
      link: bool('Link'),
    });
  }
  return out;
}

/**
 * Выходы: источник, уровень, mute.
 *
 * ВАЖНО: в Mobile-режиме есть [Output_LB12] с ChannelName = "Recording" —
 * это фактически loopback, но лежит в секции Output.
 */
export function parseOutputs(ini) {
  const out = [];
  for (const [section, kv] of Object.entries(ini)) {
    const m = section.match(/^Output_(.+)$/);
    if (!m) continue;
    const isRecording = (kv.ChannelName ?? '').toLowerCase() === 'recording';
    out.push({
      id: section,
      channel: m[1],
      name: kv.ChannelName ?? m[1],
      source: kv.AudioSource ?? null,
      gain: kv.GAIN !== undefined ? Number(kv.GAIN) : null,
      mute: kv.MUTE === '1' || kv.MUTE === 'true',
      // в Mobile loopback представлен как output с именем Recording
      isLoopback: isRecording || /^LB/.test(m[1]),
    });
  }
  return out;
}

/** Ducking целиком. */
export function parseDucking(ini) {
  const kv = ini.Ducking ?? {};
  const map = {};
  for (const [k, v] of Object.entries(kv)) {
    if (/^(IN1|IN2)/.test(k)) map[k] = v === 'true';
  }
  return {
    enabled: kv.Ducking === 'true',
    channelName: kv.ChannelName ?? null,
    switch: Number(kv.DuckingSwitch ?? 0),
    threshold: Number(kv.Threshold ?? 0),
    attack: Number(kv.Attack ?? 0),
    reduction: Number(kv.Reduction ?? 0),
    release: Number(kv.Release ?? 0),
    map,
  };
}

/**
 * Эффекты: эффекты входов, NC и Reverb по режимам.
 *
 * ВАЖНО: ДВЕ РАЗНЫЕ СТРУКТУРЫ в зависимости от режима (проверено 2026-11-07):
 *
 *   Live / Prof:  [Effect_Integration]
 *     NoiseReductionNC1, NoiseReductionNC2, NoiseReductionBypass, NoiseReductionType
 *     ReverbStudio/Live/Hall/Bypass, DryWet*, Decay*, Width*, ReverbType, MuteFX
 *
 *   Mobile:       [Effect_NC] + [Effect_Reverb] (раздельно!)
 *     и [Output_LB12] вместо [Loopback_*]
 */
export function parseEffects(ini) {
  const num = (o, k) => (o?.[k] !== undefined ? Number(o[k]) : null);

  // --- Live / Prof ---
  const kv = ini.Effect_Integration;
  if (kv) {
    return {
      layout: 'integration',
      inputLevels: {
        input1: num(kv, 'Input1Level'),
        input2: num(kv, 'Input2Level'),
        aux: num(kv, 'AuxLevel'),
        bluetooth: num(kv, 'BluetoothLevel'),
        otg: num(kv, 'OtgLevel'),
      },
      muteFx: kv.MuteFX === 'true' || kv.MuteFX === '1',
      noiseReduction: {
        nc1: num(kv, 'NoiseReductionNC1'),
        nc2: num(kv, 'NoiseReductionNC2'),
        bypass: num(kv, 'NoiseReductionBypass'),
        type: kv.NoiseReductionType ?? null,
      },
      reverb: {
        type: kv.ReverbType ?? null,
        studio: { level: num(kv, 'ReverbStudio'), dryWet: num(kv, 'DryWetStudio'), decay: num(kv, 'DecayStudio'), width: kv.WidthStudio ?? null },
        live: { level: num(kv, 'ReverbLive'), dryWet: num(kv, 'DryWetLive'), decay: num(kv, 'DecayLive'), width: kv.WidthLive ?? null },
        hall: { level: num(kv, 'ReverbHall'), dryWet: num(kv, 'DryWetHall'), decay: num(kv, 'DecayHall'), width: kv.WidthHall ?? null },
        bypass: { level: num(kv, 'ReverbBypass'), dryWet: num(kv, 'DryWetBypass'), decay: num(kv, 'DecayBypass'), width: kv.WidthBypass ?? null },
      },
    };
  }

  // --- Mobile: раздельные секции ---
  const nc = ini.Effect_NC;
  const rv = ini.Effect_Reverb;
  if (nc || rv) {
    return {
      layout: 'split',
      inputLevels: {
        input1: null, input2: null, aux: null, bluetooth: null, otg: null,
      },
      muteFx: rv ? (rv.MuteFX === 'true' || rv.MuteFX === '1') : null,
      noiseReduction: nc
        ? {
          nc1: num(nc, 'NoiseReductionNC1'),
          nc2: num(nc, 'NoiseReductionNC2'),
          bypass: num(nc, 'NoiseReductionBypass'),
          type: nc.NoiseReductionType ?? null,
          switch: nc.Switch,
        }
        : null,
      reverb: rv
        ? {
          type: rv.ReverbType ?? null,
          studio: { level: num(rv, 'ReverbStudio'), dryWet: num(rv, 'DryWetStudio'), decay: num(rv, 'DecayStudio'), width: rv.WidthStudio ?? null },
          live: { level: num(rv, 'ReverbLive'), dryWet: num(rv, 'DryWetLive'), decay: num(rv, 'DecayLive'), width: rv.WidthLive ?? null },
          hall: { level: num(rv, 'ReverbHall'), dryWet: num(rv, 'DryWetHall'), decay: num(rv, 'DecayHall'), width: rv.WidthHall ?? null },
          bypass: { level: num(rv, 'ReverbBypass'), dryWet: num(rv, 'DryWetBypass'), decay: num(rv, 'DecayBypass'), width: rv.WidthBypass ?? null },
        }
        : null,
    };
  }

  return { layout: 'none', inputLevels: null, muteFx: null, noiseReduction: null, reverb: null };
}

/** Компрессор. */
export function parseCompressor(ini) {
  const kv = ini.Compressor ?? {};
  return {
    switch: kv.Switch === 'true',
    threshold: Number(kv.Threshold ?? 0),
    ratio: Number(kv.Ratio ?? 0),
    attack: Number(kv.Attack ?? 0),
    release: Number(kv.Release ?? 0),
    gain: Number(kv.Gain ?? 0),
    mix: Number(kv.Mix ?? 0),
  };
}

/** Всё состояние workspace одним объектом. */
export function parseAll(ini) {
  return {
    header: ini.ConfigFileHeader ?? {},
    inputs: parseInputs(ini),
    mixer: parseMixer(ini),
    eq: parseEq(ini),
    loopback: parseLoopback(ini),
    outputs: parseOutputs(ini),
    ducking: parseDucking(ini),
    effects: parseEffects(ini),
    compressor: parseCompressor(ini),
  };
}

// ─────────────────────────────────────────────────────────────
// УПРАВЛЕНИЕ WORKSPACE (создание, копирование, удаление, переключение)
//
// Проверено 2026-11-07 (research/NOTES.md §67): workspace — это INI-файл
// в папке режима. Создать = скопировать/сгенерировать файл.
// MCC видит новые файлы при следующем запуске.
// ─────────────────────────────────────────────────────────────

/** Имя файла workspace. */
export function workspaceFileName(mode, name) {
  return `M62_${mode}_${name}.ini`;
}

/**
 * Создать новый workspace копированием существующего.
 *
 * @param {{mode: string, name: string}} opts
 * @param {{from?: string, sourceMode?: string}} [base]
 * @returns {{path: string, name: string, mode: string}}
 */
export function createWorkspace({ mode, name }, base = {}) {
  if (!MODE_DIRS[mode]) throw new Error(`неизвестный режим: ${mode}; допустимо: ${Object.keys(MODE_DIRS).join(', ')}`);
  if (!name || /[\\/:*?"<>|]/.test(name)) {
    throw new Error('недопустимое имя workspace (запрещены \\ / : * ? " < > |)');
  }

  const modeDir = join(WORKSPACE_ROOT, MODE_DIRS[mode]);
  const targetPath = join(modeDir, workspaceFileName(MODE_DIRS[mode], name));

  if (existsSync(targetPath)) {
    throw new Error(`workspace уже существует: ${mode}/${name}`);
  }

  // источник: указанный или любой файл того же режима
  let srcPath = null;
  if (base.from) {
    const srcMode = base.sourceMode ?? mode;
    const p = join(WORKSPACE_ROOT, MODE_DIRS[srcMode] ?? MODE_DIRS[mode],
      workspaceFileName(MODE_DIRS[srcMode] ?? MODE_DIRS[mode], base.from));
    if (existsSync(p)) srcPath = p;
  }
  if (!srcPath) {
    const same = listWorkspaces().filter((w) => w.mode === mode);
    if (same.length) srcPath = same[0].path;
  }

  if (srcPath) {
    copyFileSync(srcPath, targetPath);
  } else {
    throw new Error(`нет образца для копирования в режиме ${mode}`);
  }

  // обновляем заголовок
  try {
    const ini = readWorkspace(targetPath);
    ini.ConfigFileHeader = ini.ConfigFileHeader ?? {};
    ini.ConfigFileHeader.CreateDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    writeWorkspace(targetPath, ini);
  } catch {
    /* заголовок не критичен */
  }

  return { path: targetPath, name, mode };
}

/**
 * Удалить workspace.
 *
 * Имя ищем в списке существующих файлов (а не конструируем путь) —
 * это надёжно для кириллических имён вроде `ввв`, которые могут
 * искажаться при передаче через командную строку.
 *
 * @param {{mode: string, name: string}} opts
 */
export function deleteWorkspace({ mode, name }) {
  if (!MODE_DIRS[mode]) throw new Error(`неизвестный режим: ${mode}`);
  const target = listWorkspaces().find((w) => w.mode === mode && w.name === name);
  if (!target) throw new Error(`workspace не найден: ${mode}/${name}`);
  // не даём удалить активный
  const active = findActiveWorkspaceFromRegistry(mode);
  if (active && active.name === name) {
    throw new Error(`нельзя удалить активный workspace ${mode}/${name} — сначала переключитесь на другой`);
  }
  unlinkSync(target.path);
  return { deleted: `${mode}/${name}` };
}

/**
 * Переключить активный workspace — записью в реестр.
 *
 * ⚠️ ПРИМЕЧАНИЕ: MCC берёт имя из реестра при СТАРТЕ. Чтобы применилось,
 * MCC нужно перезапустить. UIAutomation-переключение через комбобокс
 * ЛОМАЕТ UI (проверено, NOTES §61) — не использовать.
 *
 * Кириллица: значение передаётся через временный .ps1-файл в UTF-8,
 * иначе PowerShell искажает имя (проверено: `ввв` -> `???`).
 *
 * @param {{mode: string, name: string}} opts
 */
export function switchWorkspace({ mode, name }) {
  if (!MODE_DIRS[mode]) throw new Error(`неизвестный режим: ${mode}`);
  const target = listWorkspaces().find((w) => w.mode === mode && w.name === name);
  if (!target) throw new Error(`workspace не найден: ${mode}/${name}`);

  const KEY = String.raw`HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62`;
  const valueName = `M62_${mode}_Workspace`;

  // Временный скрипт в UTF-8 с BOM — PowerShell 5.1 читает его корректно,
  // и кириллица в имени не искажается.
  const tmp = join(tmpdir(), `m62-switch-${Date.now()}.ps1`);
  const script = [
    `Set-ItemProperty -Path '${KEY}' -Name '${valueName}' -Value '${name.replace(/'/g, "''")}'`,
    `Write-Output ((Get-ItemProperty -Path '${KEY}' -Name '${valueName}').'${valueName}')`,
  ].join('\r\n');
  writeFileSync(tmp, '\ufeff' + script, 'utf8');
  let actual = '';
  try {
    actual = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { encoding: 'utf8' }).trim();
  } finally {
    try { unlinkSync(tmp); } catch { /* уже */ }
  }

  if (actual && actual !== name) {
    throw new Error(`реестр записал "${actual}" вместо "${name}" — искажение кодировки`);
  }

  return {
    mode,
    name,
    note: 'записано в реестр; чтобы применилось, перезапустите M Control Center',
  };
}
