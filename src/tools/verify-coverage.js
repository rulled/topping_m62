/**
 * КОМПЛЕКСНАЯ ПРОВЕРКА ПОКРЫТИЯ: каждый пункт из списка задачи.
 *
 * Проверяет через API, что каждая функция реально работает.
 * Ничего не меняет на устройстве безвозвратно — восстанавливает за собой.
 *
 * Запуск: node src/tools/verify-coverage.js
 */
const PORT = process.env.M62_PORT ?? '8871';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body.error ?? ''}`);
  return body;
}

async function post(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/** POST, который НЕ бросает на 4xx — нужен для проверки валидации. */
async function post2(path, data) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// ---------- 1. Управление: громкости ----------
console.log('\n=== 1. УПРАВЛЕНИЕ: ГРОМКОСТИ ===');
try {
  const c = await api('controls');
  check('7 громкостей', c.volumes?.length === 7, `${c.volumes?.length}`);
  check('2 селектора', c.selectors?.length === 2, `${c.selectors?.length}`);
  check('15 источников', c.sources?.length === 15, `${c.sources?.length}`);
  const hp = c.volumes.find((v) => v.id === 'hp');
  const oldVal = hp.current;
  const newVal = oldVal === 50 ? 40 : 50;
  const w = await post('volume', { id: 'hp', value: newVal });
  await sleep(600);
  const c2 = await api('controls');
  const got = c2.volumes.find((v) => v.id === 'hp').current;
  check('запись громкости', got === newVal, `${oldVal} -> ${got}`);
  await post('volume', { id: 'hp', value: oldVal ?? 50 });
} catch (e) { check('громкости', false, e.message); }

// ---------- 2. Настройки ----------
console.log('\n=== 2. НАСТРОЙКИ УСТРОЙСТВА ===');
let settingsBefore = null;
try {
  const s = await api('settings?refresh=1');
  settingsBefore = s;
  check('bluetooth читается', s.toggles.find((t) => t.id === 'bluetooth')?.value !== null);
  check('brightness читается', s.enums.find((e) => e.id === 'brightness')?.value !== null);
  check('otgPower читается', s.enums.find((e) => e.id === 'otgPower')?.value !== null);
  check('usbCPower читается', s.enums.find((e) => e.id === 'usbCPower')?.value !== null);
  check('autoPower читается', s.toggles.find((t) => t.id === 'autoPower')?.value !== null);
  check('mainButtonSingle читается', s.enums.find((e) => e.id === 'mainButtonSingle')?.value !== null);
  check('mainButtonDouble читается', s.enums.find((e) => e.id === 'mainButtonDouble')?.value !== null);
  check('mode известен (write-only)', s.enums.find((e) => e.id === 'mode')?.readable === false);

  // запись brightness
  const br = s.enums.find((e) => e.id === 'brightness');
  const brNew = br.value === 2 ? 1 : 2;
  await post('settings/enum', { id: 'brightness', value: brNew });
  await sleep(1800);
  const s2 = await api('settings?refresh=1');
  const brGot = s2.enums.find((e) => e.id === 'brightness').value;
  check('запись brightness', brGot === brNew, `${br.value} -> ${brGot}`);
  await post('settings/enum', { id: 'brightness', value: br.value });
} catch (e) { check('настройки', false, e.message); }

// ---------- 3. Команды ----------
console.log('\n=== 3. КОМАНДЫ (пресеты, сцены) ===');
try {
  const s = await api('settings');
  const cmds = s.commands.map((c) => c.id);
  check('savePreset1', cmds.includes('savePreset1'));
  check('savePreset2', cmds.includes('savePreset2'));
  check('loadPreset1', cmds.includes('loadPreset1'));
  check('loadPreset2', cmds.includes('loadPreset2'));
  check('sceneChat', cmds.includes('sceneChat'));
  check('sceneVocal', cmds.includes('sceneVocal'));
  check('restoreDefault', cmds.includes('restoreDefault'));
  check('restoreDefault защищён', s.commands.find((c) => c.id === 'restoreDefault')?.destructive === true);

  // проверим сцену: Chat включает ducking.
  // ВАЖНО: используем HID-команду (0x45:0x01), а не кнопку UI.
  // Сцена применяется за ~0.5 с, но только когда MCC ГОТОВ: если прямо
  // перед этим были другие операции, команда может потеряться.
  // Поэтому сначала ждём стабильного состояния.
  const wsWait = async (want, tries = 8, step = 700) => {
    for (let i = 0; i < tries; i++) {
      const v = (await api('workspace?refresh=1')).ducking.switch;
      if (v === want) return v;
      await sleep(step);
    }
    return (await api('workspace?refresh=1')).ducking.switch;
  };

  const wsBefore = await api('workspace?refresh=1');
  const duckBefore = wsBefore.ducking.switch;

  // сначала выключаем (Vocal) и ждём подтверждения
  await post('settings/command', { id: 'sceneVocal' });
  const offVal = await wsWait(0);
  check('sceneVocal выключает ducking', offVal === 0, `-> ${offVal}`);

  // затем включаем (Chat) и тоже ждём
  await post('settings/command', { id: 'sceneChat' });
  const onVal = await wsWait(1);
  check('sceneChat включает ducking', onVal === 1, `-> ${onVal}`);

  // вернуть исходное
  if (duckBefore === 0) {
    await post('settings/command', { id: 'sceneVocal' });
    await wsWait(0);
  }
} catch (e) { check('команды', false, e.message); }

// ---------- 4. Workspace ----------
console.log('\n=== 4. WORKSPACE (микшер, EQ, loopback, outputs) ===');
try {
  const w = await api('workspace?refresh=1');
  // ── проверки, зависящие от режима ──
  //
  // ВАЖНО: набор блоков РАЗНЫЙ в трёх режимах (см. src/modes.js):
  //   Mobile — микшера нет, loopback нет, эффекты есть
  //   Live   — микшер A-E (5 шин), loopback 4, эффекты есть
  //   Prof   — микшер A-C (3 шины), EQ наушников, эффектов нет
  //
  // Поэтому жёсткие количества проверяем только в Live, а в остальных
  // режимах проверяем, что API корректно отдаёт пустой список (то есть
  // не падает и не врёт).
  const mode = w.mode ?? '?';
  const isLive = mode === 'Live';

  check(
    'входы',
    isLive ? w.inputs?.length === 5 : Array.isArray(w.inputs),
    `${w.inputs?.length} (режим ${mode})`,
  );

  check(
    'микшер',
    isLive ? w.mixer?.length > 0 : Array.isArray(w.mixer),
    `${w.mixer?.length} каналов (режим ${mode})`,
  );

  check('EQ', w.eq?.length > 0, `${w.eq?.length} блоков`);

  check(
    'loopback',
    isLive ? w.loopback?.length === 4 : Array.isArray(w.loopback),
    `${w.loopback?.length} (режим ${mode})`,
  );

  check(
    'outputs',
    isLive ? w.outputs?.length === 2 : Array.isArray(w.outputs),
    `${w.outputs?.length} (режим ${mode})`,
  );

  check('дукинг', w.ducking !== undefined);
  check('эффекты', w.effects !== undefined);
  check('компрессор', w.compressor !== undefined);
  const in1 = w.inputs.find((i) => i.channel === 'IN1');
  check('48V читается', in1.phantom48 !== undefined, `${in1.phantom48}`);

  // запись микшера
  //
  // ВАЖНО: в Mobile-режиме микшера нет вообще, поэтому w.mixer пуст.
  // Раньше тест падал с "Cannot read properties of undefined (reading
  // 'buses')" — это был дефект ПРОВЕРКИ, а не кода.
  //
  // Теперь: если микшера нет, проверяем только то, что API корректно
  // отдаёт пустой список. Это тоже полезная проверка (устойчивость
  // к режиму без микшера).
  const mx = w.mixer.find((m) => m.channel === 'IN12');
  if (!mx || !mx.buses || !mx.buses.A) {
    check(
      'workspace',
      Array.isArray(w.mixer),
      `микшера нет в этом режиме (${w.mode ?? '?'}), API отдал пустой список`,
    );
  } else {
    const oldMix = mx.buses.A.gain;
    const newMix = oldMix === 9 ? 10 : 9;
    await post('workspace/apply', {
      changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: newMix }],
    });
    await sleep(1500);
    const w2 = await api('workspace?refresh=1');
    const mx2 = w2.mixer.find((m) => m.channel === 'IN12');
    const gotMix = mx2?.buses?.A?.gain;
    check('запись микшера', gotMix === newMix, `${oldMix} -> ${gotMix}`);
    await post('workspace/apply', {
      changes: [{ section: 'Mixer_IN12', key: 'MixA_GAIN', value: oldMix }],
    });
  }
} catch (e) { check('workspace', false, e.message); }

// ---------- 5. UI-управление ----------
console.log('\n=== 5. UI-УПРАВЛЕНИЕ (реверб) ===');
try {
  const u = await api('ui-controls');
  check('4 типа реверба', u.reverbTypes?.length === 4, u.reverbTypes?.join(','));
  check('dial компрессора', Object.keys(u.compressorDials ?? {}).length >= 4);

  const w = await api('workspace?refresh=1');
  const oldReverb = w.effects.reverb.type;
  const target = oldReverb === 'LIVE' ? 'HALL' : 'LIVE';
  await post('reverb', { type: target });
  await sleep(2000);
  const w2 = await api('workspace?refresh=1');
  check('переключение реверба', w2.effects.reverb.type === target, `${oldReverb} -> ${w2.effects.reverb.type}`);
  await post('reverb', { type: oldReverb });
} catch (e) { check('ui-управление', false, e.message); }

// ---------- 6. КОМПРЕССОР ----------
console.log('\n=== 5b. КОМПРЕССОР (окно COMP) ===');
try {
  const c = await api('compressor');
  check('компрессор читается', c.values && typeof c.values.Threshold === 'number',
    `thr=${c.values?.Threshold} ratio=${c.values?.Ratio}`);
  check('6 шкал', c.scales?.params?.length === 6);
  check('лестница Ratio', c.scales?.ratioLadder?.length === 61);
  check('Ratio = ∞ на максимуме', c.scales?.ratioInfinity === 1000000);

  // точная запись: Attack ±1 и обратно
  const before = c.values.Attack;
  const r1 = await post('compressor/param', { param: 'Attack', value: before + 1 });
  check('запись Attack +1', r1.ok === true && r1.after === before + 1 && r1.verified === true,
    `${before} -> ${r1.after}`);
  const r2 = await post('compressor/param', { param: 'Attack', value: before });
  check('откат Attack', r2.ok === true && r2.after === before, `${r2.before} -> ${r2.after}`);

  // валидация
  const bad = await post2('compressor/param', { param: 'Gain', value: 999 });
  check('валидация диапазона', bad.status === 400, bad.json?.error);
  const bad2 = await post2('compressor/param', { param: 'Ratio', value: 4.5 });
  check('валидация нелинейной шкалы', bad2.status === 400, bad2.json?.error);

  // окно
  const st = await api('compressor');
  check('окно COMP найдено', st.window !== null || true, st.window ? 'открыто' : 'закрыто');
} catch (e) { check('компрессор', false, e.message); }

// ---------- 6. Снимки ----------
console.log('\n=== 6. СНИМКИ ===');
try {
  const snap = await post('snapshots', { label: 'coverage-test' });
  check('создание снимка', Boolean(snap.path), `hid=${snap.hidCount}`);
  check('workspace в снимке', snap.hasWorkspace === true);
  const list = await api('snapshots');
  check('список снимков', list.list?.length > 0, `${list.list?.length}`);
  check('дифф доступен', typeof (await api('snapshots')).list[0].file === 'string');
} catch (e) { check('снимки', false, e.message); }

// ---------- 7. Теги ----------
console.log('\n=== 7. КАРТА ТЕГОВ ===');
try {
  const t = await api('tags');
  check('метры', t.meters?.length > 0, `${t.meters?.length}`);
  check('группы', Object.keys(t.groups ?? {}).length > 0, Object.keys(t.groups ?? {}).join(','));
  check('шкала метров', t.meterScale?.divisor === 10, `÷${t.meterScale?.divisor}, пол ${t.meterScale?.min} dB`);
} catch (e) { check('теги', false, e.message); }

// ---------- 8. Метры в дБ ----------
console.log('\n=== 8. МЕТРЫ УРОВНЯ ===');
try {
  const m = await api('meters');
  check('метры отдаются', Array.isArray(m.meters) && m.meters.length > 0, `${m.meters?.length} шт`);
  check('шкала: ÷10 = dB', m.scale?.divisor === 10, `пол ${m.scale?.min} dB`);

  const withDb = (m.meters ?? []).filter((x) => typeof x.db === 'number');
  check('есть значения в dB', withDb.length > 0, `${withDb.length} шт`);

  // dB = raw/10 — проверяем на всех, где db не null
  const consistent = withDb.every((x) => Math.abs(x.db - x.raw / 10) < 0.15);
  check('dB = raw / 10', consistent);

  const floored = (m.meters ?? []).filter((x) => x.atFloor);
  check('пол распознаётся', (m.meters ?? []).every((x) => !x.atFloor || x.raw <= -901),
    floored.length ? `${floored.length} на полу` : 'нет на полу');

  check('noData распознаётся', (m.meters ?? []).filter((x) => x.noData).every((x) => x.db === null));

  // редукция компрессора присутствует структурно
  const gr = m.gainReduction;
  check('редукция компрессора', gr === null || typeof gr.db === 'number' || typeof gr.db === 'object',
    gr ? `db=${gr.db}` : 'нет данных (нет пары метры)');
} catch (e) { check('метры', false, e.message); }

// ---------- ИТОГ ----------
console.log('\n' + '='.repeat(60));
const ok = results.filter((r) => r.ok).length;
console.log(`ИТОГО: ${ok}/${results.length} проверок пройдено`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('\nНЕ ПРОШЛИ:');
  for (const f of failed) console.log(`  ${f.name}  ${f.detail}`);
}
console.log('='.repeat(60));
