# Захват трафика MCC ОТ МОМЕНТА ЗАПУСКА + движение микшера.
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ПОЧЕМУ ПЕРВЫЙ ЗАХВАТ НЕ ДАЛ МИКШЕР ═══
#
# MCC уже работал, когда включился захват. Полный дамп состояния он получил
# ещё при своём старте — до записи. В файл попали только метры (12 тегов
# вместо 101) и keepalive: за 16 с ровно 11 кадров наружу.
#
# Плюс двигался не тот слайдер: i=235 это громкость входа (-90..12),
# а микшер — i=73..112 (-90..0).
#
# ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
#
#   1. Убивает MCC (чтобы его старт попал в запись).
#   2. Включает захват.
#   3. Запускает MCC — в запить попадает handshake и ПОЛНЫЙ ДАМП.
#   4. Ждёт загрузки.
#   5. Двигает ТРИ слайдера микшера (i=73,86,99) на +5 дБ и обратно.
#   6. Останавливает захват, разбирает.
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# HP и OTG отключены -> звук физически невозможен.
# Слайдеры двигаются в пределах диапазона и возвращаются назад.

$ErrorActionPreference = 'Stop'

$ROOT_HUB  = '\\.\USBPcap1'
$OUT_FILE  = Join-Path $PSScriptRoot 'research\mixer-boot-capture.pcap'
$MCC_EXE   = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
$MIXER_IDS = @(73, 86, 99)

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== 1. проверки ===' -ForegroundColor Cyan

if (-not (Test-Admin)) {
    Write-Host '  Нужны права администратора.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "  зависший USBPcapCMD: убиваю PID $($stale.Id -join ', ')"
    foreach ($p in $stale) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

$m62 = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like 'USB\VID_152A&PID_875C\*' }
if (-not $m62) { Write-Host '  M62 не найден.' -ForegroundColor Red; exit 1 }
Write-Host '  M62: найден'

Write-Host ''
Write-Host '=== 2. убиваем MCC ===' -ForegroundColor Cyan
Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Write-Host '  закрыт (его старт попадёт в запись)'

Write-Host ''
Write-Host '=== 3. захват ===' -ForegroundColor Cyan
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
    Write-Host "  USBPcapCMD упал: $($proc.StandardError.ReadToEnd())" -ForegroundColor Red
    exit 1
}
Write-Host '  захват идёт'

Write-Host ''
Write-Host '=== 4. запускаем MCC (в запись попадут handshake и полный дамп) ===' -ForegroundColor Cyan
Start-Process $MCC_EXE
Start-Sleep -Seconds 20
Write-Host '  MCC загрузился'

Write-Host ''
Write-Host '=== 5. двигаем микшер ===' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'src\tools\mixer-sliders.js') --move --ids $($MIXER_IDS -join ',')

Write-Host ''
Write-Host '  ждём 5 с и останавливаем захват…'
Start-Sleep -Seconds 5

try { $proc.StandardInput.WriteLine(); $proc.StandardInput.Flush() } catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force } catch { } }
Start-Sleep -Seconds 1

Write-Host ''
Write-Host '=== 6. разбор ===' -ForegroundColor Cyan
if (-not (Test-Path $OUT_FILE)) {
    Write-Host '  файл не создан' -ForegroundColor Red
    exit 1
}
Write-Host ("  размер: {0:N0} байт" -f (Get-Item $OUT_FILE).Length)

& python (Join-Path $PSScriptRoot 'src\tools\analyze-m62.py') $OUT_FILE 6

Write-Host ''
Write-Host 'готово.' -ForegroundColor Green
