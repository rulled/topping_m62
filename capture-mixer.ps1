# Захват трафика MCC при движении микшера.
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# Права нужны только на открытие \\.\USBPcapN — сами устройства уже есть,
# драйвер работает. Без админа CreateFileW возвращает error 5
# (ERROR_ACCESS_DENIED), а не «файл не найден».
#
# ЧТО ДЕЛАЕТ
#   1. Проверяет, что M62 на месте и HP/OTG отключены.
#   2. Запускает USBPcapCMD на корневом хабе с M62 (Root Hub 4&280E3A9A).
#   3. Через 3 с запускает движение слайдеров микшера.
#   4. Останавливает захват, разбирает pcap.
#
# БЕЗОПАСНОСТЬ
#   HP и OTG отключены -> звук физически невозможен.
#   Слайдеры двигаются на +5 дБ и возвращаются назад.

$ErrorActionPreference = 'Stop'

$ROOT_HUB = '\\.\USBPcap1'   # Root Hub 4&280E3A9A&0&0, на нём висит M62
$OUT_FILE = Join-Path $PSScriptRoot 'research\mixer-capture.pcap'
$CAPTURE_SEC = 30

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== 1. проверки ===' -ForegroundColor Cyan

if (-not (Test-Admin)) {
    Write-Host 'Нужны права администратора. Перезапусти этот скрипт от админа.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$svc = (sc.exe query USBPcap | Select-String 'STATE').ToString()
Write-Host "  служба USBPcap: $($svc.Trim())"

$m62 = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like 'USB\VID_152A&PID_875C\*' }
if (-not $m62) {
    Write-Host '  M62 не найден. Подключи устройство.' -ForegroundColor Red
    exit 1
}
Write-Host "  M62: найден ($($m62.InstanceId))"

$mcc = Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue
if (-not $mcc) {
    Write-Host '  MCC не запущен — запускаю…'
    Start-Process 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
    Start-Sleep -Seconds 15
}
Write-Host '  MCC: работает'

Write-Host ''
Write-Host '=== 2. захват ===' -ForegroundColor Cyan

# Убить зависшие экземпляры: они держат \\.\USBPcapN эксклюзивно, и любой
# новый запуск получает ошибку 5 «Couldn't open device» даже от админа.
$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "  найден зависший USBPcapCMD (PID $($stale.Id -join ', ')) — убиваю"
    foreach ($p in $stale) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch {
            Write-Host "  не удалось убить PID $($p.Id): $($_.Exception.Message)" -ForegroundColor Red
            Write-Host '  Убей вручную и запусти скрипт снова.' -ForegroundColor Red
            exit 1
        }
    }
    Start-Sleep -Seconds 2
    Write-Host '  убит'
} else {
    Write-Host '  зависших нет'
}

if (Test-Path $OUT_FILE) { Remove-Item $OUT_FILE -Force }

$ps = New-Object System.Diagnostics.ProcessStartInfo
$ps.FileName = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$ps.Arguments = "-d $ROOT_HUB -o `"$OUT_FILE`" --inject-descriptors -A"
$ps.UseShellExecute = $false
$ps.RedirectStandardInput = $true
$ps.RedirectStandardOutput = $true
$ps.RedirectStandardError = $true

Write-Host "  устройство: $ROOT_HUB"
Write-Host "  файл:       $OUT_FILE"

try {
    $proc = [System.Diagnostics.Process]::Start($ps)
} catch {
    Write-Host "  не удалось запустить USBPcapCMD: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 3
if ($proc.HasExited) {
    $err = $proc.StandardError.ReadToEnd()
    $out = $proc.StandardOutput.ReadToEnd()
    Write-Host "  USBPcapCMD сразу завершился (код $($proc.ExitCode))" -ForegroundColor Red
    if ($out) { Write-Host "  stdout: $out" }
    if ($err) { Write-Host "  stderr: $err" }
    if ($err -match 'open device - 5') {
        Write-Host ''
        Write-Host '  Ошибка 5 = устройство занято другим процессом.' -ForegroundColor Yellow
        Write-Host '  Проверь: не запущен ли USBPcapCMD в другом окне (в т.ч. от админа).'
    }
    exit 1
}
Write-Host '  захват идёт'

Write-Host ''
Write-Host '=== 3. двигаем микшер ===' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot 'src\tools\mixer-sliders.js') --move

Write-Host ''
Write-Host "  ждём ещё 3 с и останавливаем захват…"
Start-Sleep -Seconds 3

try {
    $proc.StandardInput.WriteLine()
    $proc.StandardInput.Flush()
} catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) {
    try { Stop-Process -Id $proc.Id -Force } catch { }
}
Start-Sleep -Seconds 1

Write-Host ''
Write-Host '=== 4. разбор ===' -ForegroundColor Cyan

if (-not (Test-Path $OUT_FILE)) {
    Write-Host '  файл не создан' -ForegroundColor Red
    exit 1
}
$size = (Get-Item $OUT_FILE).Length
Write-Host ("  размер: {0:N0} байт" -f $size)

& python (Join-Path $PSScriptRoot 'src\tools\analyze-usbpcap.py') $OUT_FILE

Write-Host ''
Write-Host 'готово.' -ForegroundColor Green
