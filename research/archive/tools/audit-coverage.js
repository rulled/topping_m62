/**
 * АУДИТ ПОКРЫТИЯ: какие ключи workspace доступны через API, а какие нет.
 *
 * Берём все ключи из всех workspace-файлов и сверяем с тем,
 * что отдаёт /api/workspace и принимает /api/workspace/apply.
 */
import { listWorkspaces, readWorkspace, parseAll } from '../workspace.js';

const all = listWorkspaces();
console.log(`workspace-файлов: ${all.length}\n`);

// 1) собираем ВСЕ ключи
const allKeys = new Map(); // "Section.key" -> счётчик
for (const w of all) {
  let ini;
  try { ini = readWorkspace(w.path); } catch { continue; }
  for (const [sec, kv] of Object.entries(ini)) {
    for (const k of Object.keys(kv)) {
      const id = `${sec}.${k}`;
      allKeys.set(id, (allKeys.get(id) ?? 0) + 1);
    }
  }
}
console.log(`всего уникальных ключей: ${allKeys.size}\n`);

// 2) какие ключи парсер ВЫСТАВЛЯЕТ в describe()
const parsed = parseAll(readWorkspace(all[0].path));

// что парсер отдаёт по секциям
const COVERED = {
  inputs: new Set(['48V', 'GAIN', 'MUTE', 'SOLO', 'MIC', 'ANTI', 'Balance', 'ChannelName']),
  mixer: new Set(), // строится динамически
  eq: new Set(['Switch', 'GainInput', 'GainOutput']),
  loopback: new Set(['AudioSource', 'GAIN', 'GAINLeft', 'GAINRight', 'MUTE', 'MUTELeft', 'MUTERight', 'Link', 'ChannelName']),
  outputs: new Set(['AudioSource', 'GAIN', 'MUTE', 'ChannelName']),
  ducking: new Set(['Ducking', 'DuckingSwitch', 'Threshold', 'Attack', 'Reduction', 'Release', 'ChannelName']),
  effects: new Set(['Input1Level', 'Input2Level', 'AuxLevel', 'BluetoothLevel', 'OtgLevel',
    'NoiseReductionNC1', 'NoiseReductionNC2', 'NoiseReductionBypass', 'NoiseReductionType',
    'ReverbStudio', 'ReverbLive', 'ReverbHall', 'ReverbBypass',
    'DryWetStudio', 'DryWetLive', 'DryWetHall', 'DryWetBypass',
    'DecayStudio', 'DecayLive', 'DecayHall', 'DecayBypass',
    'WidthStudio', 'WidthLive', 'WidthHall', 'WidthBypass',
    'ReverbType', 'MuteFX', 'Effect_Integration', 'ChannelName']),
  compressor: new Set(['Switch', 'Threshold', 'Ratio', 'Attack', 'Release', 'Gain', 'GainAuto', 'Mix', 'Compressor']),
};

// mixer: динамические ключи Mix<X>_*
for (let bus = 0; bus < 8; bus++) {
  const b = String.fromCharCode(65 + bus); // A..H
  for (const f of ['GAIN', 'MUTE', 'SOLO', 'GAINLeft', 'GAINRight', 'MUTELeft', 'MUTERight',
    'SOLOLeft', 'SOLORight', 'ANTI', 'ANTILeft', 'ANTIRight', 'Link',
    'BalanceLinkedLeft', 'BalanceLinkedRight', 'BalanceUnlinkLeft', 'BalanceUnlinkRight']) {
    COVERED.mixer.add(`Mix${b}_${f}`);
  }
}

// eq bands
const EQ_BAND_RE = /^Eq%40\d+$/;

// 3) сверяем
console.log('=== АУДИТ ПО СЕКЦИЯМ ===\n');

const FAMILY = {
  ConfigFileHeader: null,  // метаданные, не нужны
  FieldInput: null,
  FieldMixer: null,
  FieldEffect: null,
  FieldLoopback: null,
  FieldOutput: null,
};

const gaps = [];

for (const [id, _cnt] of [...allKeys].sort()) {
  const [sec, key] = id.split('.');

  // метаданные и Field* — не параметры
  if (FAMILY[sec] === null) continue;

  let covered = false;
  let group = null;

  if (/^Input_/.test(sec)) { group = 'inputs'; covered = COVERED.inputs.has(key); }
  else if (/^Mixer_/.test(sec)) { group = 'mixer'; covered = COVERED.mixer.has(key) || key === 'ChannelName' || /^Mixer_/.test(key); }
  else if (/^EQ_/.test(sec)) { group = 'eq'; covered = COVERED.eq.has(key) || EQ_BAND_RE.test(key) || /^EQState|^EQFiltered|^Expanded|^EQ_IN/.test(key); }
  else if (/^Loopback_/.test(sec)) { group = 'loopback'; covered = COVERED.loopback.has(key) || /^Loopback_/.test(key); }
  else if (/^Output_/.test(sec)) { group = 'outputs'; covered = COVERED.outputs.has(key) || /^Output_/.test(key); }
  else if (sec === 'Ducking') { group = 'ducking'; covered = COVERED.ducking.has(key) || /^IN[12]/.test(key); }
  else if (sec === 'Effect_Integration') { group = 'effects'; covered = COVERED.effects.has(key); }
  else if (sec === 'Compressor') { group = 'compressor'; covered = COVERED.compressor.has(key); }
  else { group = 'other'; covered = true; }

  if (!covered) gaps.push({ id, section: sec, key, group });
}

console.log(`НЕ ПОКРЫТО ключей: ${gaps.length}\n`);
if (gaps.length) {
  const byGroup = new Map();
  for (const g of gaps) {
    if (!byGroup.has(g.group)) byGroup.set(g.group, []);
    byGroup.get(g.group).push(g);
  }
  for (const [grp, items] of byGroup) {
    console.log(`[${grp}] ${items.length} ключей:`);
    for (const i of items) console.log(`   ${i.id}`);
    console.log();
  }
} else {
  console.log('все ключи покрыты парсером');
}

// 4) что реально отдаёт API
console.log('=== ЧТО API ОТДАЁТ СЕЙЧАС ===');
console.log(`  inputs: ${parsed.inputs.length}`);
console.log(`  mixer: ${parsed.mixer.length}`);
console.log(`  eq: ${parsed.eq.length}`);
console.log(`  loopback: ${parsed.loopback.length}`);
console.log(`  outputs: ${parsed.outputs.length}`);
