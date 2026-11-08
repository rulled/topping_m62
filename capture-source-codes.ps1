# ЗАХВАТ: ВСЕ ОСТАВШИЕСЯ КОДЫ ИСТОЧНИКОВ ЗА ОДИН ЗАПУСК.
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ЧТО ДЕЛАЕТ ═══
#
#   1. Проверяет наушники и OTG (должны быть отключены).
#   2. Убивает MCC (чтобы его старт попал в запись).
#   3. Включает USBPcap.
#   4. Запускает MCC — он при старте шлёт ПОЛНЫЙ дамп на устройство.
#   5. Ждёт загрузки, выключает захват.
#   6. Разбирает: печатает найденные коды источников.
#
# ═══ ПЕРЕД ЗАПУСКОМ ═══
#
# Должен быть выполнен prepare — он расставил в Prof-INI шесть
# недостающих имён источников:
#
#     python src/tools/one-shot-source-codes.py prepare
#
# ═══ ПОСЛЕ ═══
#
# Обязательно вернуть оригинал:
#
#     python src/tools/one-shot-source-codes.py restore
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# prepare глушит все шесть слотов (MUTE=true, GAIN=-90) и переводит
# HP на другой источник. Скрипт откажется работать, если наушники или
# OTG физически подключены.

$ErrorActionPreference = 'Stop'

$ROOT_HUB = '\\.\USBPcap1'
$OUT_FILE = Join-Path $PSScriptRoot 'research\source-codes.pcap'
$PLAN     = Join-Path $PSScriptRoot 'research\source-code-plan.json'
$MCC_EXE  = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
$CAPTURE_SECONDS = 25

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== 1. проверки ===' -ForegroundColor Cyan

if (-not (Test-Admin)) {
    Write-Host '  Нужны права администратора. Запусти PowerShell от админа.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

if (-not (Test-Path $PLAN)) {
    Write-Host '  Нет плана. Сначала:' -ForegroundColor Red
    Write-Host '    python src/tools/one-shot-source-codes.py prepare'
    exit 1
}
Write-Host '  план найден'

# безопасность: наушники и OTG должны быть отключены
Write-Host ''
Write-Host '=== 2. безопасность ===' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'src\tools\safety-check.js')
if ($LASTEXITCODE -eq 2) {
    Write-Host ''
    Write-Host '  ОСТАНОВ: наушники или OTG подключены.' -ForegroundColor Red
    Write-Host '  Отключи их физически и запусти снова.'
    exit 1
}
Write-Host '  выходы заглушены — можно'

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
Write-Host '=== 3. убиваем MCC ===' -ForegroundColor Cyan
Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Write-Host '  закрыт (его старт попадёт в запись)'

Write-Host ''
Write-Host '=== 4. захват ===' -ForegroundColor Cyan
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
Write-Host '=== 5. запускаем MCC (полный дамп уйдёт в устройство) ===' -ForegroundColor Cyan
Start-Process $MCC_EXE
Start-Sleep -Seconds $CAPTURE_SECONDS
Write-Host "  MCC отработал $CAPTURE_SECONDS с"

Write-Host ''
Write-Host '  останавливаем захват…'
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

& python (Join-Path $PSScriptRoot 'src\tools\one-shot-source-codes.py') decode

Write-Host ''
Write-Host '=== 7. НАПОМИНАНИЕ ===' -ForegroundColor Yellow
Write-Host '  Верни оригинальный INI:'
Write-Host '    python src/tools/one-shot-source-codes.py restore' -ForegroundColor Yellow
Write-Host ''
Write-Host '  И закрой MCC, если он больше не нужен.' -ForegroundColor Yellow
