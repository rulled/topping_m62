/**
 * УПРАВЛЕНИЕ WORKSPACE: как MCC создаёт/удаляет/переключает.
 *
 * Проверяем:
 *   1) что происходит при "New Workspace" в UI
 *   2) как меняется реестр (M62_Live_Workspace)
 *   3) можно ли создать workspace из бекенда (копированием файла)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { listWorkspaces, readWorkspace, writeWorkspace } from '../workspace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PS = 'powershell.exe';
const ps = (cmd) => execFileSync(PS, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

const REG = String.raw`HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62`;

const regWorkspace = (mode) => {
  const key = { Live: 'M62_Live_Workspace', Prof: 'M62_Prof_Workspace', Mble: 'M62_Mble_Workspace' }[mode];
  if (!key) return null;
  try {
    return ps(`(Get-ItemProperty -Path '${REG}' -Name '${key}' -ErrorAction SilentlyContinue).'${key}'`).trim() || null;
  } catch { return null; }
};

console.log('=== 1. ЧТО В РЕЕСТРЕ ===');
for (const m of ['Live', 'Prof', 'Mble']) {
  console.log(`  ${m}: ${regWorkspace(m) ?? '—'}`);
}

console.log('\n=== 2. ВСЕ WORKSPACE ===');
const all = listWorkspaces();
for (const w of all) console.log(`  ${w.mode}/${w.name}  (${w.size}b)`);

console.log('\n=== 3. СТРУКТУРА ФАЙЛА (что нужно для нового workspace) ===');
const sample = all.find((w) => w.mode === 'Live');
const ini = readWorkspace(sample.path);
console.log(`  образец: ${sample.name}`);
console.log(`  секций: ${Object.keys(ini).length}`);
console.log(`  заголовок: ${JSON.stringify(ini.ConfigFileHeader)}`);

console.log('\n=== 4. ПРОБА: создать workspace копированием файла ===');
const WS_ROOT = String.raw`C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live`;
const NEW_NAME = 'backend-test';
const NEW_PATH = join(WS_ROOT, `M62_Live_${NEW_NAME}.ini`);

if (existsSync(NEW_PATH)) {
  console.log(`  файл уже существует, удаляю: ${NEW_PATH}`);
  unlinkSync(NEW_PATH);
}

try {
  copyFileSync(sample.path, NEW_PATH);
  console.log(`  скопировал ${sample.name} -> ${NEW_NAME}`);
  console.log(`  существует: ${existsSync(NEW_PATH)}`);

  // проверяем, видит ли его наш парсер
  const after = listWorkspaces();
  const found = after.find((w) => w.name === NEW_NAME);
  console.log(`  парсер видит: ${found ? 'ДА' : 'НЕТ'}`);

  // удаляем
  unlinkSync(NEW_PATH);
  console.log('  удалил тестовый файл');
} catch (e) {
  console.log(`  ошибка: ${e.message}`);
  console.log('  (Program Files может требовать прав администратора)');
}

console.log('\n=== 5. ВЫВОД ===');
console.log('  Workspace = INI-файл в папке режима.');
console.log('  Создать = скопировать/сгенерировать файл.');
console.log('  Удалить = удалить файл.');
console.log('  Переключить = записать имя в реестр + перезапустить MCC');
console.log('    (но UIAutomation-переключение ломает UI — см. NOTES §61)');
