# РАСШИФРОВКА ВСЕХ 8 БИТОВ МАСКИ DUCKING — ОДИН ЗАПУСК
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ЧТО ИЗВЕСТНО ═══
#
#   0x43:0x05 = маска источников для IN1 (8 бит)
#   0x43:0x06 = маска источников для IN2 (8 бит)
#
#   Доказано: AUX = бит 0. Остальные 7 битов неизвестны.
#
# В UI MCC чекбоксов для источников ducking НЕТ — маска задаётся
# только через INI при старте MCC. Значит для каждого бита нужен
# свой перезапуск MCC.
#
# ═══ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══
#
# Для каждого из 8 флагов IN1:
#   1. Выставить ВСЕ флаги IN1 = true, кроме одного = false.
#   2. Убить MCC, запустить под захватом.
#   3. MCC отправит маску с одним сброшенным битом.
#   4. Остановить захват, запомнить.
#
# Итого: 8 перезапусков MCC, 8 файлов захвата, ~6 минут.
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# Ducking сам по себе звук не меняет, пока Switch=0 (а он 0).
# Джек проверяется. INI восстанавливается в конце.
#
# Запуск:
#   .\capture-duck-bits-all.ps1

$ErrorActionPreference = 'Stop'

$ROOT_HUB = '\\.\USBPcap1'
$MCC_EXE  = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
$INI      = 'C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini'
$INI_BAK  = Join-Path $PSScriptRoot 'research\live-ini-before-bits.ini'
$OUT_DIR  = Join-Path $PSScriptRoot 'research\duck-bits'
$RESULTS  = Join-Path $PSScriptRoot 'research\duck-bits-result.json'

# Флаги IN1 — каждый соответствует одному биту
$FLAGS = @(
    'IN1AUX',
    'IN1BT',
    'IN1OTGIN',
    'IN1Playback1_2',
    'IN1Playback3_4',
    'IN1Playback5_6',
    'IN1Playback7_8',
    'IN1Playback9_10'
)

function Test-Admin {
    (New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host '=== ПРОВЕРКИ ===' -ForegroundColor Cyan
if (-not (Test-Admin)) {
    Write-Host '  НУЖНЫ ПРАВА АДМИНИСТРАТОРА.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    foreach ($p in $stale) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

Write-Host '  безопасность:'
& node (Join-Path $PSScriptRoot 'src\tools\safety-check.js')
if ($LASTEXITCODE -eq 2) {
    Write-Host '  ОСТАНОВ: джек подключён.' -ForegroundColor Red
    exit 1
}

# --- бэкап ---
if (-not (Test-Path $INI_BAK)) {
    Copy-Item $INI $INI_BAK
    Write-Host "  бэкап INI: $INI_BAK"
}
if (-not (Test-Path $OUT_DIR)) { New-Item -ItemType Directory -Path $OUT_DIR | Out-Null }

function Set-Flags {
    param([string]$OffFlag)
    $lines = Get-Content $INI
    $cur = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*\[(.+?)\]') { $cur = $Matches[1]; continue }
        if ($cur -ne 'Ducking') { continue }
        foreach ($f in $FLAGS) {
            if ($lines[$i] -match "^\s*$f\s*=") {
                $val = if ($f -eq $OffFlag) { 'false' } else { 'true' }
                $lines[$i] = "$f=$val"
            }
        }
    }
    Set-Content -Path $INI -Value $lines -Encoding UTF8
}

function Start-Capture {
    param([string]$OutFile)
    if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
    $psi.Arguments = "-d $ROOT_HUB -o `"$OutFile`" --inject-descriptors -A"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Seconds 3
    if ($proc.HasExited) { throw "USBPcapCMD упал" }
    return $proc
}

function Stop-Capture {
    param($Proc)
    if (-not $Proc) { return }
    try { $Proc.StandardInput.WriteLine(); $Proc.StandardInput.Flush() } catch { }
    Start-Sleep -Seconds 2
    if (-not $Proc.HasExited) { try { Stop-Process -Id $Proc.Id -Force } catch { } }
    Start-Sleep -Seconds 1
}

$results = @()
$total = $FLAGS.Count
$idx = 0

foreach ($flag in $FLAGS) {
    $idx++
    Write-Host ''
    Write-Host "=== [$idx/$total] ВЫКЛЮЧАЮ $flag ===" -ForegroundColor Cyan

    # 1. Выставить флаги
    Set-Flags -OffFlag $flag
    Write-Host "  $flag = false, остальные = true"

    # 2. Убить MCC
    Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    # 3. Захват
    $outFile = Join-Path $OUT_DIR "bit-$flag.pcap"
    $proc = Start-Capture -OutFile $outFile
    Write-Host '  захват идёт'

    # 4. Запустить MCC
    Start-Process $MCC_EXE
    Start-Sleep -Seconds 22
    Write-Host '  MCC отправил маску'

    # 5. Остановить
    Stop-Capture -Proc $proc
    Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    if (Test-Path $outFile) {
        $size = (Get-Item $outFile).Length
        Write-Host ("  захвачено: {0:N0} байт" -f $size)
        $results += [PSCustomObject]@{ flag = $flag; file = $outFile; size = $size }
    } else {
        Write-Host '  ОШИБКА: файл не создан' -ForegroundColor Red
    }
}

# --- восстановить INI ---
Write-Host ''
Write-Host '=== ВОССТАНАВЛИВАЮ INI ===' -ForegroundColor Cyan
Copy-Item $INI_BAK $INI -Force
Write-Host '  восстановлен'

# --- сохранить результаты ---
$results | ConvertTo-Json | Set-Content -Path $RESULTS -Encoding UTF8
Write-Host "  результаты: $RESULTS"

# --- разбор ---
Write-Host ''
Write-Host '=== РАЗБОР ===' -ForegroundColor Cyan
if (Test-Path $RESULTS) {
    & python (Join-Path $PSScriptRoot 'src\tools\decode-duck-bits.py') $RESULTS $OUT_DIR
}

Write-Host ''
Write-Host '=== ГОТОВО ===' -ForegroundColor Green
Write-Host @'
  Пришли вывод выше — там будет таблица «флаг -> бит».

  INI уже восстановлен, устройство в исходном состоянии.
  Захваты сохранены в research/duck-bits/ (на случай, если
  понадобится перепроверить).
'@
