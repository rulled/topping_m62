/** Проверка парсера на всех workspace, включая Prof с EQ_HP. */
import { listWorkspaces, readWorkspace, parseAll } from '../workspace.js';

for (const w of listWorkspaces()) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${w.mode}/${w.name}  (${w.size} байт)`);
  console.log('='.repeat(60));

  let ini, parsed;
  try {
    ini = readWorkspace(w.path);
    parsed = parseAll(ini);
  } catch (e) {
    console.log(`  ошибка: ${e.message}`);
    continue;
  }

  console.log(`входы: ${parsed.inputs.length}`);
  for (const i of parsed.inputs) {
    console.log(`  ${i.name.padEnd(8)} 48V=${i.phantom48 ? 'ON ' : 'off'} gain=${String(i.gain).padStart(4)} anti=${i.anti}`);
  }

  console.log(`\nмикшер: ${parsed.mixer.length} каналов`);
  for (const ch of parsed.mixer) {
    const active = Object.entries(ch.buses)
      .filter(([, b]) => (b.gain ?? 0) !== 0 || b.mute || b.solo)
      .map(([bus, b]) => `${bus}:${b.gain}${b.mute ? 'M' : ''}${b.solo ? 'S' : ''}`);
    if (active.length) console.log(`  ${ch.channel.padEnd(8)} ${active.join(' ')}`);
  }

  console.log(`\nEQ: ${parsed.eq.length} блоков`);
  for (const e of parsed.eq) {
    console.log(`  ${e.id.padEnd(8)} формат=${e.format.padEnd(3)} полос=${String(e.bands.length).padStart(2)} switch=${e.switch} gainIn=${e.gainInput} gainOut=${e.gainOutput}`);
    if (e.bands.length && e.bands[0].freq !== null) {
      const b = e.bands[0];
      console.log(`     полоса1: тип=${b.type} gain=${b.gain} freq=${b.freq} Q=${b.q}${b.flag !== undefined ? ' flag=' + b.flag : ''}`);
    }
  }

  console.log(`\nloopback: ${parsed.loopback.length}, outputs: ${parsed.outputs.length}`);
  for (const l of parsed.loopback) console.log(`  ${l.name.padEnd(16)} src=${l.source} gain=${l.gain} L=${l.gainLeft} R=${l.gainRight} link=${l.link}`);
  for (const o of parsed.outputs) console.log(`  ${o.name.padEnd(16)} src=${o.source} gain=${o.gain} mute=${o.mute}`);

  console.log(`\nэффекты: NC type=${parsed.effects.noiseReduction.type} reverb type=${parsed.effects.reverb.type}`);
  console.log(`компрессор: thr=${parsed.compressor.threshold} ratio=${parsed.compressor.ratio}`);
}
