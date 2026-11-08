/**
 * АУДИТ ПУСТЫХ CATCH — где скрываются реальные ошибки.
 *
 * Урок §103: catch без логирования скрыл отсутствующий импорт
 * на много раундов. Ищем все такие места в РАБОЧИХ модулях
 * (не в tools — там диагностика, допустимо).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MODULES = [
  'crc16.js', 'protocol.js', 'controls.js', 'controls-service.js',
  'settings.js', 'settings-service.js', 'tags.js', 'transport.js',
  'workspace.js', 'workspace-service.js', 'ui-control.js',
  'audio-params.js', 'modes.js', 'snapshots.js', 'eq-control.js',
  'server.js',
];

console.log(`проверяю ${MODULES.length} модулей\n`);

for (const m of MODULES) {
  const path = join('src', m);
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { console.log(`${m}: не найден`); continue; }

  const lines = src.split('\n');
  const empties = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // catch {} или catch { /* только комментарий */ }
    if (/catch\s*\{[^}]*\}/.test(line)) {
      const inner = line.match(/catch\s*\{([^}]*)\}/)?.[1] ?? '';
      const onlyComment = /^\s*(\/\*.*\*\/)?\s*$/.test(inner);
      if (onlyComment) empties.push({ line: i + 1, text: line.trim() });
    }
    // catch (e) { } на одной строке
    if (/catch\s*\(\s*\w+\s*\)\s*\{\s*\}/.test(line)) {
      empties.push({ line: i + 1, text: line.trim() });
    }
  }

  if (empties.length) {
    console.log(`═══ ${m}: ${empties.length} пустых catch ═══`);
    for (const e of empties) {
      console.log(`  строка ${e.line}: ${e.text.slice(0, 100)}`);
    }
    console.log('');
  }
}
