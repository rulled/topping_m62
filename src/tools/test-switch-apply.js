/**
 * ПРОВЕРКА: применяется ли правка файла при ПЕРЕКЛЮЧЕНИИ workspace.
 *
 * Гипотеза: MCC применяет настройки из файла только когда workspace
 * ЗАГРУЖАЕТСЯ (при старте или при переключении в списке).
 *
 * Проверяем: пишем в main.ini заведомо другое значение микшера,
 * переключаемся на "main" в UI, смотрим что стало на устройстве.
 */
import { findActiveWorkspace, listWorkspaces, readWorkspace, writeWorkspace } from '../workspace.js';
import { ps, PRELUDE, dumpTree } from './uia.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = listWorkspaces();
const main = all.find((w) => w.name === 'main');
if (!main) { console.error('main.ini не найден'); process.exit(1); }

console.log(`правлю: ${main.path}\n`);

const ini = readWorkspace(main.path);
console.log('ДО в main.ini:');
console.log(`  Mixer_IN12.MixA_GAIN = ${ini.Mixer_IN12?.MixA_GAIN}`);
console.log(`  Input_IN1.GAIN = ${ini.Input_IN1?.GAIN}`);

// ставим заведомо заметное значение
ini.Mixer_IN12 = ini.Mixer_IN12 ?? {};
ini.Mixer_IN12.MixA_GAIN = '7';
ini.Input_IN1 = ini.Input_IN1 ?? {};
ini.Input_IN1.GAIN = '22';
writeWorkspace(main.path, ini);
console.log('\nзаписал: MixA_GAIN=7, GAIN=22');
