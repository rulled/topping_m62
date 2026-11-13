/**
 * ПОВЫШЕНИЕ ПРАВ БЕЗ УЧАСТИЯ ЧЕЛОВЕКА.
 *
 * ═══ ЗАЧЕМ ═══
 *
 * На этой машине UAC настроен так:
 *
 *     ConsentPromptBehaviorAdmin = 0   («повышать без запроса»)
 *     PromptOnSecureDesktop      = 0
 *
 * Значит `Start-Process -Verb RunAs` даёт администратора МОЛЧА.
 * Проверено: admin=True, целостность High (S-1-16-12288).
 *
 * Раньше для каждой операции, требующей прав, приходилось просить
 * пользователя запустить скрипт вручную. Больше не нужно.
 *
 * ═══ ЧТО ТРЕБУЕТ ПОВЫШЕНИЯ ═══
 *
 *   остановка/перезапуск Audiosrv
 *   убийство USBPcapCMD, запущенного elevated
 *   завершение любого чужого elevated-процесса
 *
 * ═══ ЧТО НЕ ТРЕБУЕТ ═══
 *
 *   USBPcap захват (!), запись INI MCC, запуск MCC,
 *   чтение реестра MMDevices, HID-запись в устройство
 *
 * ═══ ЧТО НЕ РАБОТАЕТ ДАЖЕ С ПРАВАМИ ═══
 *
 *   запись sample rate в реестр: ACE для администраторов имеет
 *   флаг CIID (inherit-only) — действует только на дочерние ключи.
 *   См. research/NOTES.md §149.4.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Я админ прямо сейчас? */
export function isElevated() {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())'
          + '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      ],
      { encoding: 'utf8' },
    );
    return out.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Выполнить PowerShell-скрипт с повышением прав.
 *
 * Скрипт пишется во временный файл, запускается через
 * `Start-Process -Verb RunAs`, результат читается из файла —
 * потому что stdout повышенного процесса нам недоступен.
 *
 * @param {string} script тело скрипта (powershell)
 * @param {{timeoutMs?: number, name?: string}} [opts]
 * @returns {{ok: boolean, output: string, error?: string}}
 */
export function runElevated(script, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const name = opts.name ?? 'elevated';
  const dir = mkdtempSync(join(tmpdir(), 'm62-elev-'));
  const scriptPath = join(dir, 'run.ps1');
  const outPath = join(dir, 'result.txt');
  const errPath = join(dir, 'error.txt');

  // Обёртка: ловим ВСЁ, включая падения, и всегда пишем результат.
  const wrapped = `
$ErrorActionPreference = 'Stop'
$__out = @()
try {
${script}
  ($__out -join "\`n") | Out-File -FilePath '${outPath.replace(/\\/g, '\\\\')}' -Encoding UTF8
} catch {
  $msg = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
  $msg | Out-File -FilePath '${errPath.replace(/\\/g, '\\\\')}' -Encoding UTF8
  ($__out -join "\`n") | Out-File -FilePath '${outPath.replace(/\\/g, '\\\\')}' -Encoding UTF8
  exit 1
}
`;
  writeFileSync(scriptPath, wrapped, 'utf8');

  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(
          /'/g,
          "''",
        )}' -Verb RunAs -PassThru -ErrorAction Stop;`
          + ` $null = $p.WaitForExit(${timeoutMs});`
          + ' if (-not $p.HasExited) { $p.Kill(); Write-Output "TIMEOUT" }'
          + ' else { Write-Output ("EXIT=" + $p.ExitCode) }',
      ],
      { encoding: 'utf8', timeout: timeoutMs + 20000 },
    );

    const output = existsSync(outPath) ? readFileSync(outPath, 'utf8').trim() : '';
    const error = existsSync(errPath) ? readFileSync(errPath, 'utf8').trim() : '';

    if (error) return { ok: false, output, error: `${name}: ${error}` };
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: '', error: `${name}: ${err.message}` };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
}

/**
 * Убить все USBPcapCMD, которые не убиваются обычными правами.
 *
 * ВАЖНО: зависший elevated-процесс захвата держит USB-хаб, и тогда
 * следующий захват молча пишет 0 байт. Это главная причина
 * «захват не работает».
 *
 * @returns {{killed: number, remaining: number, neededElevation: boolean}}
 */
export function killCaptureProcesses() {
  const list = () => {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '@(Get-Process USBPcapCMD -ErrorAction SilentlyContinue).Count',
        ],
        { encoding: 'utf8' },
      );
      return Number(out.trim());
    } catch {
      return 0;
    }
  };

  const before = list();
  if (before === 0) return { killed: 0, remaining: 0, neededElevation: false };

  // сначала обычным способом
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-Process USBPcapCMD -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue'],
      { encoding: 'utf8' },
    );
  } catch {
    /* ok */
  }

  let remaining = list();
  let neededElevation = false;

  if (remaining > 0) {
    neededElevation = true;
    runElevated(
      `Get-Process USBPcapCMD -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop
Start-Sleep -Seconds 2
$__out += "remaining=" + @(Get-Process USBPcapCMD -ErrorAction SilentlyContinue).Count`,
      { name: 'kill-usbpcap', timeoutMs: 30000 },
    );
    remaining = list();
  }

  return { killed: before - remaining, remaining, neededElevation };
}

/** Перезапустить службу Windows Audio (нужно для смены sample rate). */
export function restartAudioService() {
  return runElevated(
    `Stop-Service Audiosrv -Force -ErrorAction Stop
Start-Sleep -Seconds 2
Start-Service Audiosrv -ErrorAction Stop
Start-Sleep -Seconds 2
$s = Get-Service Audiosrv
$__out += "status=" + $s.Status`,
    { name: 'restart-audiosrv', timeoutMs: 90000 },
  );
}

// CLI
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      .replace(/\\/g, '/').toLowerCase();
    return self === process.argv[1].replace(/\\/g, '/').toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  const cmd = process.argv[2] ?? 'status';
  if (cmd === 'status') {
    console.log('админ сейчас:', isElevated());
    console.log('в группе администраторов:', (() => {
      try {
        return execFileSync('whoami', ['/groups'], { encoding: 'utf8' }).includes('S-1-5-32-544');
      } catch { return false; }
    })());
  } else if (cmd === 'kill-capture') {
    console.log(JSON.stringify(killCaptureProcesses(), null, 2));
  } else if (cmd === 'restart-audio') {
    console.log(JSON.stringify(restartAudioService(), null, 2));
  } else if (cmd === 'probe') {
    const r = runElevated(
      `$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$adm = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$__out += "admin=" + $adm
$__out += "user=" + $id.Name`,
      { name: 'probe' },
    );
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log('команды: status | probe | kill-capture | restart-audio');
  }
}
