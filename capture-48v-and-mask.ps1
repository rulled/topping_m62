# ЗАХВАТ: 48V И МАСКА DUCKING — ОДИН ЗАПУСК, ДВА ОТВЕТА
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ЧТО ЗАКРЫВАЕТ ЭТОТ ЗАХВАТ ═══
#
# 1. КОМАНДА 48V.
#    Известно: 0x11:0x19 — это СОСТОЯНИЕ фантома (меняется 0->1 при
#    нажатии кнопки). Но MCC НИКОГДА не отправляет этот адрес
#    (проверено по 5 захватам). Значит команда — другой кадр.
#    В захвате увидим, что именно уходит в момент нажатия.
#
# 2. БИТЫ МАСКИ DUCKING.
#    Известно: 0x43:05 = маска для IN1, 0x43:06 = для IN2 (две маски
#    по 8 бит). Неизвестно: какой бит какому источнику.
#    Выключим ОДИН флаг в INI, запустим MCC под захватом — увидим,
#    какой бит сбросился.
#
# ═══ ПЛАН (один прогон) ═══
#
#   1. Проверить джек (не подключён).
#   2. Бэкап INI.
#   3. Выключить IN1AUX в INI (остальные оставить).
#   4. Убить MCC.
#   5. Включить USBPcap.
#   6. Запустить MCC — он отправит маску с выключенным AUX.
#   7. Открыть панель эффектов, нажать кнопку 48V (IN1).
#   8. Ещё раз нажать 48V (вернуть).
#   9. Остановить захват.
#  10. Разобрать: найти кадры 0x43:05/06 и все кадры вокруг 48V.
#  11. Вернуть INI из бэкапа.
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# 48V — фантомное питание. Наушники и OTG отключены, к микрофонному
# входу ничего не подключено (проверяется). Включаем и выключаем
# обратно. Ducking сам по себе звук не меняет (Switch=0).
#
# Запуск:
#   .\capture-48v-and-mask.ps1

$ErrorActionPreference = 'Stop'

$ROOT_HUB  = '\\.\USBPcap1'
$OUT_48V   = Join-Path $PSScriptRoot 'research\capture-48v.pcap'
$OUT_MASK  = Join-Path $PSScriptRoot 'research\capture-duck-mask.pcap'
$MCC_EXE   = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
$INI       = 'C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini'
$INI_BAK   = Join-Path $PSScriptRoot 'research\live-ini-before-mask.ini'

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== 1. ПРОВЕРКИ ===' -ForegroundColor Cyan

if (-not (Test-Admin)) {
    Write-Host '  НУЖНЫ ПРАВА АДМИНИСТРАТОРА.' -ForegroundColor Red
    Write-Host '  Запусти PowerShell от имени администратора и повтори.'
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
Write-Host '=== 2. БЕЗОПАСНОСТЬ ===' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'src\tools\safety-check.js')
if ($LASTEXITCODE -eq 2) {
    Write-Host '  ОСТАНОВ: джек подключён. Отключи наушники/OTG.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '=== 3. ГОТОВЛЮ INI ДЛЯ МАСКИ ===' -ForegroundColor Cyan
if (-not (Test-Path $INI_BAK)) {
    Copy-Item $INI $INI_BAK
    Write-Host "  бэкап: $INI_BAK"
} else {
    Write-Host "  бэкап уже есть: $INI_BAK"
}

# Выключаем ОДИН флаг: IN1AUX. Так увидим, какой бит сбросится.
$txt = Get-Content $INI -Raw
$new = $txt -replace 'IN1AUX=true', 'IN1AUX=false'
if ($new -eq $txt) {
    Write-Host '  ВНИМАНИЕ: IN1AUX=true не найден — возможно, уже false' -ForegroundColor Yellow
} else {
    Set-Content -Path $INI -Value $new -NoNewline -Encoding UTF8
    Write-Host '  IN1AUX -> false (для расшифровки бита)'
}

Write-Host ''
Write-Host '=== 4. ЗАКРЫВАЮ MCC ===' -ForegroundColor Cyan
Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Write-Host '  закрыт'

Write-Host ''
Write-Host '=== 5. ЗАХВАТ ===' -ForegroundColor Cyan
foreach ($f in $OUT_48V, $OUT_MASK) { if (Test-Path $f) { Remove-Item $f -Force } }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$psi.Arguments = "-d $ROOT_HUB -o `"$OUT_48V`" --inject-descriptors -A"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 3
if ($proc.HasExited) {
    Write-Host "  USBPcapCMD упал: $($proc.StandardError.ReadToEnd())" -ForegroundColor Red
    Copy-Item $INI_BAK $INI -Force
    exit 1
}
Write-Host '  захват идёт'

Write-Host ''
Write-Host '=== 6. ЗАПУСКАЮ MCC (отправит маску с выключенным AUX) ===' -ForegroundColor Cyan
Start-Process $MCC_EXE
Start-Sleep -Seconds 24
Write-Host '  MCC загрузился'

Write-Host ''
Write-Host '=== 7. НАЖИМАЮ 48V ===' -ForegroundColor Cyan
$press = & node (Join-Path $PSScriptRoot 'src\tools\press-48v.js')
Write-Host "  $press"

Write-Host ''
Write-Host '=== 8. ЖДУ И ОСТАНАВЛИВАЮ ===' -ForegroundColor Cyan
Start-Sleep -Seconds 6

try { $proc.StandardInput.WriteLine(); $proc.StandardInput.Flush() } catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force } catch { } }
Start-Sleep -Seconds 1

Write-Host ''
Write-Host '=== 9. ВОЗВРАЩАЮ INI ===' -ForegroundColor Cyan
Copy-Item $INI_BAK $INI -Force
Write-Host '  INI восстановлен из бэкапа'

Write-Host ''
Write-Host '=== 10. РАЗБОР ===' -ForegroundColor Cyan
if (-not (Test-Path $OUT_48V)) {
    Write-Host '  файл захвата не создан' -ForegroundColor Red
    exit 1
}
Write-Host ("  размер: {0:N0} байт" -f (Get-Item $OUT_48V).Length)

Write-Host ''
Write-Host '--- что ушло в момент нажатия 48V ---' -ForegroundColor Yellow
& python (Join-Path $PSScriptRoot 'src\tools\analyze-48v-capture.py') $OUT_48V

Write-Host ''
Write-Host '--- маска ducking ---' -ForegroundColor Yellow
& python (Join-Path $PSScriptRoot 'src\tools\analyze-duck-mask-capture.py') $OUT_48V

Write-Host ''
Write-Host '=== ГОТОВО ===' -ForegroundColor Green
Write-Host @'
  Что делать дальше:
    1. Пришли вывод выше — по нему расшифрую команду 48V и биты маски.
    2. INI уже восстановлен, устройство в исходном состоянии.
    3. Закрой MCC, если он больше не нужен.
'@
