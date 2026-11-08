# ═══════════════════════════════════════════════════════════════════════
#  ПРОВЕРКА НАШЕЙ ЗАПИСИ МИКШЕРА — ОДИН ЗАПУСК
# ═══════════════════════════════════════════════════════════════════════
#
# ЗАПУСК ОТ АДМИНИСТРАТОРА.
#
# ═══ ПОЧЕМУ ПРОВЕРКА ЧЕРЕЗ INI НЕ РАБОТАЕТ ═══
#
# MCC при старте НЕ читает микшер из устройства — он берёт его из своего
# workspace-INI. Значит сколько бы мы ни записали в устройство, MCC
# перезапишет своей матрицей, и по INI этого не увидеть.
#
# ═══ ПРАВИЛЬНАЯ ПРОВЕРКА ═══
#
# Захватить НАШУ запись и сравнить с эталоном MCC кадр в кадр:
#   - те же адреса?
#   - тот же порядок?
#   - те же значения на тех же местах?
#
# Если структура совпадает — устройство примет нашу запись так же, как MCC.
#
# ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
#
#   1. Закрывает MCC.
#   2. Включает захват.
#   3. Шлёт нашу матрицу (buildMixerPacket из src/mixer-tags.js).
#   4. Останавливает захват.
#   5. Сравнивает с эталоном research/m62-full.pcap.
#
# Ничего в INI не правит — трогать файл не нужно.

$ErrorActionPreference = 'Stop'

$ROOT_HUB = '\\.\USBPcap1'
$OUT_FILE = Join-Path $PSScriptRoot 'research\our-write.pcap'
$REF_FILE = Join-Path $PSScriptRoot 'research\m62-full.pcap'

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Stop-Mcc {
    Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
        ForEach-Object { $_.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 2
    Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ' Проверка: наша запись микшера vs эталон MCC' -ForegroundColor Cyan
Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Cyan

if (-not (Test-Admin)) {
    Write-Host 'Нужны права администратора.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    foreach ($p in $stale) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

if (-not (Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like 'USB\VID_152A&PID_875C\*' })) {
    Write-Host 'M62 не найден.' -ForegroundColor Red
    exit 1
}
Write-Host '  M62: найден'

# ── закрыть MCC ───────────────────────────────────────────────────────
Write-Host "`n[1/5] закрываю MCC" -ForegroundColor Yellow
Stop-Mcc
if ((Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    Write-Host '  MCC не закрылся. Закрой через трей и повтори.' -ForegroundColor Red
    exit 1
}
Write-Host '  закрыт'

# ── захват ────────────────────────────────────────────────────────────
Write-Host "`n[2/5] захват" -ForegroundColor Yellow
if (Test-Path $OUT_FILE) { Remove-Item $OUT_FILE -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$psi.Arguments = "-d $ROOT_HUB -o `"$OUT_FILE`" --inject-descriptors -A"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 3
if ($proc.HasExited) {
    Write-Host "  ошибка: $($proc.StandardError.ReadToEnd())" -ForegroundColor Red
    exit 1
}
Write-Host '  захват идёт'

# ── наша запись ───────────────────────────────────────────────────────
Write-Host "`n[3/5] пишем микшер нашим кодом" -ForegroundColor Yellow
& node (Join-Path $PSScriptRoot 'src\tools\write-mixer-only.js')
if ($LASTEXITCODE -ne 0) {
    Write-Host '  ошибка записи' -ForegroundColor Red
}

Start-Sleep -Seconds 2
try { $proc.StandardInput.WriteLine(); $proc.StandardInput.Flush() } catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force } catch { } }
Start-Sleep -Seconds 1

# ── разбор ────────────────────────────────────────────────────────────
Write-Host "`n[4/5] файлы" -ForegroundColor Yellow
if (-not (Test-Path $OUT_FILE)) {
    Write-Host '  наша запись не сохранилась' -ForegroundColor Red
    exit 1
}
Write-Host ("  наша запись: {0:N0} байт" -f (Get-Item $OUT_FILE).Length)
if (Test-Path $REF_FILE) {
    Write-Host ("  эталон MCC:  {0:N0} байт" -f (Get-Item $REF_FILE).Length)
} else {
    Write-Host '  эталон не найден, сравнение невозможно' -ForegroundColor Red
}

Write-Host "`n[5/5] сравнение" -ForegroundColor Yellow
& python (Join-Path $PSScriptRoot 'src\tools\verify-our-write.py') $OUT_FILE $REF_FILE 6

Write-Host "`nготово." -ForegroundColor Green
