/**
 * СНИМКИ СОСТОЯНИЯ: своя реализация полного снапшота.
 *
 * ВЫВОД ИЗ РЕВЕРСА (research/PIPELINE.md §3.4):
 * полного снимка «всё сразу» в MCC НЕТ:
 *   - HID-пресеты хранят только аудио-состояние (FX, эффекты);
 *   - микшер, EQ, loopback живут в workspace-файле;
 *   - настройки устройства (brightness, power, кнопки) не хранит никто.
 *
 * Поэтому бекенд собирает снимок сам: HID + workspace -> один JSON.
 * И умеет восстанавливать его обратно.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findActiveWorkspace, readWorkspace } from './workspace.js';

const SNAP_DIR = String.raw`research\snapshots`;

/** Создать папку снимков. */
function ensureDir() {
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
}

/**
 * Собрать полный снимок.
 *
 * @param {import('./transport.js').M62Transport} transport
 * @param {import('./workspace-service.js').WorkspaceService} workspace
 * @param {{label?: string}} [opts]
 */
export async function captureSnapshot(transport, workspace, opts = {}) {
  const { label = '' } = opts;

  // 1) HID: всё, что транспорт накопил в кеше.
  // Ключи приводим к ШЕСТНАДЦАТЕРИЧНОМУ виду "TT:PP" — так они совпадают
  // с документацией и картой тегов (например "11:04" = brightness).
  const hid = {};
  if (transport?.snapshot) {
    for (const [k, v] of Object.entries(transport.snapshot())) {
      const [ttStr, ppStr] = String(k).split(':');
      const tt = Number(ttStr);
      const pp = Number(ppStr);
      const key = `${tt.toString(16).padStart(2, '0')}:${pp.toString(16).padStart(2, '0')}`;
      hid[key] = v;
    }
  }

  // 2) workspace: микшер, EQ, входы, loopback, outputs, ducking, эффекты
  let ws = null;
  try {
    const d = workspace.describe();
    if (d.available) {
      ws = {
        mode: d.mode,
        name: d.name,
        inputs: d.inputs,
        mixer: d.mixer,
        eq: d.eq,
        loopback: d.loopback,
        outputs: d.outputs,
        ducking: d.ducking,
        effects: d.effects,
        compressor: d.compressor,
      };
    }
  } catch {
    /* workspace может быть недоступен */
  }

  const snap = {
    version: 1,
    label,
    at: new Date().toISOString(),
    // HID-часть: громкости, селекторы, настройки, FX-уровни, метры
    hid,
    // файловая часть: микшер, EQ, loopback и т.д.
    workspace: ws,
  };

  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label ? '_' + label.replace(/[^\w\-]+/g, '_') : '';
  const path = join(SNAP_DIR, `snap_${stamp}${safeLabel}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2), 'utf8');

  return { path, hidCount: Object.keys(hid).length, hasWorkspace: Boolean(ws) };
}

/** Список снимков, свежие первыми. */
export function listSnapshots() {
  ensureDir();
  return readdirSync(SNAP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const p = join(SNAP_DIR, f);
      const j = JSON.parse(readFileSync(p, 'utf8'));
      return {
        file: f,
        path: p,
        label: j.label ?? '',
        at: j.at,
        hidCount: Object.keys(j.hid ?? {}).length,
        hasWorkspace: Boolean(j.workspace),
      };
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Прочитать снимок. */
export function readSnapshot(file) {
  const p = file.includes('\\') || file.includes('/') ? file : join(SNAP_DIR, file);
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Удалить снимок. */
export function deleteSnapshot(file) {
  const p = file.includes('\\') || file.includes('/') ? file : join(SNAP_DIR, file);
  unlinkSync(p);
  return { deleted: p };
}

/**
 * Сравнить два снимка: что изменилось.
 */
export function diffSnapshots(a, b) {
  const out = { hid: [], workspace: [] };

  // HID
  const ah = a.hid ?? {};
  const bh = b.hid ?? {};
  for (const k of new Set([...Object.keys(ah), ...Object.keys(bh)])) {
    if (ah[k] !== bh[k]) out.hid.push({ key: k, from: ah[k], to: bh[k] });
  }

  // workspace: сравниваем по секциям
  const aw = a.workspace ?? {};
  const bw = b.workspace ?? {};
  for (const section of ['inputs', 'mixer', 'eq', 'loopback', 'outputs', 'compressor']) {
    const sa = JSON.stringify(aw[section] ?? null);
    const sb = JSON.stringify(bw[section] ?? null);
    if (sa !== sb) out.workspace.push(section);
  }
  if (JSON.stringify(aw.ducking ?? null) !== JSON.stringify(bw.ducking ?? null)) {
    out.workspace.push('ducking');
  }
  if (JSON.stringify(aw.effects ?? null) !== JSON.stringify(bw.effects ?? null)) {
    out.workspace.push('effects');
  }

  return out;
}

/**
 * Применить снимок к устройству.
 *
 * ПРИМЕЧАНИЕ: применяется только то, что пишется известными путями:
 *   - HID: громкости, селекторы, настройки (0x11), FX-уровни;
 *   - файл: микшер, EQ, входы, loopback, outputs, ducking.
 * Компрессор и реверб снимком НЕ восстанавливаются (см. WRITE-METHOD §10).
 *
 * @returns {Promise<{hidApplied: number, workspaceApplied: number, skipped: string[]}>}
 */
export async function applySnapshot(transport, workspace, snap, opts = {}) {
  const { applyWorkspace = true } = opts;
  const hidApplied = [];
  const skipped = [];

  // --- HID-часть ---
  const WRITABLE_FAMILIES = new Set([0x11, 0x21, 0x22, 0x23, 0x25, 0x27, 0x44, 0x61, 0x62, 0x63, 0x64]);
  // то, что точно не состояние: команды и служебное
  const SKIP_PROPS = new Set([
    '11:08', '11:0b', '11:0e', '11:12', '11:1d', '11:1f', '11:20', '11:21',
    '11:18', '11:19', '45:01', '45:02',
  ]);

  for (const [k, v] of Object.entries(snap.hid ?? {})) {
    const [ttStr, ppStr] = k.split(':');
    // ключи хранятся в ШЕСТНАДЦАТЕРИЧНОМ виде: "11:04"
    const tt = parseInt(ttStr, 16);
    const pp = parseInt(ppStr, 16);
    if (!WRITABLE_FAMILIES.has(tt)) { skipped.push(k); continue; }
    if (SKIP_PROPS.has(k)) { skipped.push(k); continue; }
    // метры не восстанавливаем
    if (typeof v === 'number' && v < -100 && tt !== 0x44 && tt !== 0x61 && tt !== 0x62
        && tt !== 0x63 && tt !== 0x64) { skipped.push(k); continue; }
    try {
      transport.send(tt, pp, v);
      hidApplied.push(k);
    } catch {
      skipped.push(k);
    }
  }

  // --- файловая часть ---
  let workspaceChanges = [];
  if (applyWorkspace && snap.workspace) {
    const ws = workspace.describe();
    const cur = ws.available ? ws : null;
    if (cur) {
      // Индексы существующих секций и ключей — чтобы не писать несуществующее
      const existing = new Map();
      try {
        const systemWs = findActiveWorkspace();
        if (systemWs) {
          const ini = readWorkspace(systemWs.path);
          for (const [sec, kv] of Object.entries(ini)) {
            existing.set(sec, new Set(Object.keys(kv)));
          }
        }
      } catch {
        /* без проверки будем писать как есть */
      }
      const canWrite = (section, key) =>
        existing.size === 0 || existing.get(section)?.has(key) === true;

      const push = (section, key, value) => {
        if (value === null || value === undefined) return;
        if (!canWrite(section, key)) return;
        workspaceChanges.push({ section, key, value });
      };

      // входы: 48V только у IN1/IN2, GAIN/MUTE у всех
      for (const inp of snap.workspace.inputs ?? []) {
        if (inp.phantom48 !== undefined && inp.phantom48 !== null) {
          push(inp.id, '48V', inp.phantom48 ? 1 : 0);
        }
        if (inp.gain !== null && inp.gain !== undefined) {
          push(inp.id, 'GAIN', inp.gain);
        }
        if (inp.mute !== undefined && inp.mute !== null) {
          push(inp.id, 'MUTE', inp.mute ? 1 : 0);
        }
      }
      // ducking
      const dk = snap.workspace.ducking;
      if (dk) {
        push('Ducking', 'DuckingSwitch', dk.switch);
        push('Ducking', 'Threshold', dk.threshold);
        push('Ducking', 'Attack', dk.attack);
        push('Ducking', 'Reduction', dk.reduction);
        push('Ducking', 'Release', dk.release);
      }
      // loopback и outputs
      for (const l of snap.workspace.loopback ?? []) {
        push(l.id, 'GAIN', l.gain);
      }
      for (const o of snap.workspace.outputs ?? []) {
        push(o.id, 'GAIN', o.gain);
      }
      // микшер
      for (const ch of snap.workspace.mixer ?? []) {
        for (const [bus, params] of Object.entries(ch.buses ?? {})) {
          if (params.gain !== undefined) {
            push(`Mixer_${ch.channel}`, `Mix${bus}_GAIN`, params.gain);
          }
          if (params.mute !== undefined) {
            push(`Mixer_${ch.channel}`, `Mix${bus}_MUTE`, params.mute);
          }
        }
      }
      // EQ-полосы
      for (const eq of snap.workspace.eq ?? []) {
        if (eq.switch !== undefined) {
          push(eq.id, 'Switch', eq.switch ? 1 : 0);
        }
        for (const b of eq.bands ?? []) {
          if (b.raw) push(eq.id, `Eq%40${b.band}`, b.raw);
        }
      }
    }
  }

  // применяем всё одним перезапуском
  if (workspaceChanges.length) {
    await workspace.applyChanges(workspaceChanges);
  }

  return {
    hidApplied: hidApplied.length,
    workspaceApplied: workspaceChanges.length,
    skipped: skipped.length,
  };
}
