# РАСШИФРОВКА БИТОВ МАСКИ DUCKING — 3 ЗАПУСКА ВМЕСТО 8
#
# ЗАПУСКАТЬ ОТ АДМИНИСТРАТОРА.
#
# ═══ ИДЕЯ ═══
#
# Вместо «выключить один флаг — посмотреть один бит» (8 перезапусков)
# задаём ШАБЛОН из нескольких флагов сразу. У шаблона уникальная
# двоичная подпись, поэтому одного захвата хватает, чтобы проверить
# весь порядок битов.
#
# Порядок битов берём из порядка флагов в секции [Ducking] INI
# (MCC пишет их по источникам, IN1 затем IN2):
#
#     бит 0  AUX
#     бит 1  BT
#     бит 2  OTG IN
#     бит 3  Playback 1/2
#     бит 4  Playback 3/4
#     бит 5  Playback 5/6
#     бит 6  Playback 7/8
#     бит 7  Playback 9/10
#
# Что уже ДОКАЗАНО раньше: AUX = бит 0 (255 -> 254 при IN1AUX=false).
# Значит первый элемент списка = младший бит, и порядок, скорее всего,
# именно такой. Этот скрипт это подтверждает или опровергает.
#
# ═══ ШАБЛОНЫ ═══
#
#   A: включены BT(1), PB12(3), PB56(5), PB910(7)   -> 0b10101010 = 170
#   B: включены OTG(2), PB34(4), PB78(6)            -> 0b01010100 =  84
#
#   A и B дополняют друг друга: A|B = 254 (всё, кроме AUX).
#
# Захват 1: IN1 = A (170), IN2 = B (84)   -> заодно доказывает,
#                                            что 0x43:05 это IN1,
#                                            а 0x43:06 это IN2
# Захват 2: IN1 = B (84),  IN2 = A (170)  -> перекрёстная проверка
# Захват 0: все true      -> 255 / 255    -> проверка, что маска вообще
#                                            отправляется
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
# Ducking не меняет звук, пока DuckingSwitch=0 (он 0).
# 48V не трогаем. Джек проверяется. INI восстанавливается в конце.
#
# Запуск:
#   .\capture-duck-bits-fast.ps1

$ErrorActionPreference = 'Stop'

$ROOT_HUB = '\\.\USBPcap1'
$MCC_EXE  = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'
$INI      = 'C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini'
$INI_BAK  = Join-Path $PSScriptRoot 'research\live-ini-before-fastbits.ini'
$OUT_DIR  = Join-Path $PSScriptRoot 'research\duck-bits-fast'
$RESULTS_PATH  = Join-Path $PSScriptRoot 'research\duck-bits-fast.json'
$DECODER  = Join-Path $PSScriptRoot 'src\tools\decode-duck-bits-fast.py'

# бит -> флаг IN1/IN2 (порядок из секции [Ducking])
$ORDER = @(
    'AUX',          # бит 0
    'BT',           # бит 1
    'OTGIN',        # бит 2
    'Playback1_2',  # бит 3
    'Playback3_4',  # бит 4
    'Playback5_6',  # бит 5
    'Playback7_8',  # бит 6
    'Playback9_10'  # бит 7
)

$PAT_A = @('BT', 'Playback1_2', 'Playback5_6', 'Playback9_10')   # 170
$PAT_B = @('OTGIN', 'Playback3_4', 'Playback7_8')                # 84

# шаги: метка, набор IN1, набор IN2, ожидаемая маска IN1, IN2
$STEPS = @(
    @{ label = 'all'; in1 = $ORDER; in2 = $ORDER;           e1 = 255; e2 = 255 },
    @{ label = 'a1b2'; in1 = $PAT_A; in2 = $PAT_B;          e1 = 170; e2 = 84  },
    @{ label = 'b1a2'; in1 = $PAT_B; in2 = $PAT_A;          e1 = 84;  e2 = 170 }
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

if (-not (Test-Path $INI_BAK)) {
    Copy-Item $INI $INI_BAK
    Write-Host "  бэкап INI: $INI_BAK"
}
if (-not (Test-Path $OUT_DIR)) { New-Item -ItemType Directory -Path $OUT_DIR | Out-Null }

function Set-Mask {
    param([string[]]$In1On, [string[]]$In2On)
    $lines = Get-Content $INI
    $cur = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*\[(.+?)\]') { $cur = $Matches[1]; continue }
        if ($cur -ne 'Ducking') { continue }
        for ($b = 0; $b -lt $ORDER.Count; $b++) {
            $src = $ORDER[$b]
            foreach ($side in @('IN1', 'IN2')) {
                $flag = "$side$src"
                if ($lines[$i] -match "^\s*$flag\s*=") {
                    $onList = if ($side -eq 'IN1') { $In1On } else { $In2On }
                    $val = if ($onList -contains $src) { 'true' } else { 'false' }
                    $lines[$i] = "$flag=$val"
                }
            }
        }
    }
    Set-Content -Path $INI -Value $lines -Encoding UTF8
}

function Get-MaskValue {
    param([string]$Side)
    $lines = Get-Content $INI
    $cur = $null
    $mask = 0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*\[(.+?)\]') { $cur = $Matches[1]; continue }
        if ($cur -ne 'Ducking') { continue }
        for ($b = 0; $b -lt $ORDER.Count; $b++) {
            $flag = "$Side$($ORDER[$b])"
            if ($lines[$i] -match "^\s*$flag\s*=\s*true") { $mask = $mask -bor (1 -shl $b) }
        }
    }
    return $mask
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

# ВАЖНО: имена переменных в PowerShell регистронезависимы!
# $rows и $ROWS_PATH — разные, а $results и $RESULTS — ОДНА переменная.
$rows = @()
$total = $STEPS.Count
$idx = 0

foreach ($step in $STEPS) {
    $idx++
    Write-Host ''
    Write-Host "=== [$idx/$total] ШАБЛОН $($step.label) ===" -ForegroundColor Cyan
    Write-Host ("  IN1 = [{0}]  ожидаем {1}" -f ($step.in1 -join ','), $step.e1)
    Write-Host ("  IN2 = [{0}]  ожидаем {1}" -f ($step.in2 -join ','), $step.e2)

    # ВАЖНО: сначала убить MCC, потом править INI.
    # Иначе MCC при выходе сохранит свой workspace и затрёт флаги.
    Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    Set-Mask -In1On $step.in1 -In2On $step.in2
    $mask1 = Get-MaskValue -Side 'IN1'
    $mask2 = Get-MaskValue -Side 'IN2'
    Write-Host ("  в INI записано: IN1={0} IN2={1}" -f $mask1, $mask2)
    if ($mask1 -ne $step.e1 -or $mask2 -ne $step.e2) {
        Write-Host '  ОШИБКА: INI не совпал с шаблоном, шаг пропускаю' -ForegroundColor Red
        continue
    }

    $outFile = Join-Path $OUT_DIR "step-$($step.label).pcap"
    $proc = Start-Capture -OutFile $outFile
    Write-Host '  захват идёт'

    Start-Process $MCC_EXE
    Start-Sleep -Seconds 22
    Write-Host '  MCC отправил маску'

    Stop-Capture -Proc $proc
    Stop-Process -Name 'M Control Center' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    if (Test-Path $outFile) {
        $size = (Get-Item $outFile).Length
        Write-Host ("  захвачено: {0:N0} байт" -f $size)
        $rows += [PSCustomObject]@{
            label = $step.label
            file  = $outFile
            size  = $size
            expectedIn1 = $step.e1
            expectedIn2 = $step.e2
            flagsIn1 = ($step.in1 -join ',')
            flagsIn2 = ($step.in2 -join ',')
        }
    } else {
        Write-Host '  ОШИБКА: файл не создан' -ForegroundColor Red
    }
}

Write-Host ''
Write-Host '=== ВОССТАНАВЛИВАЮ INI ===' -ForegroundColor Cyan
Copy-Item $INI_BAK $INI -Force
Write-Host '  восстановлен'

$rows | ConvertTo-Json -Depth 4 | Set-Content -Path $RESULTS_PATH -Encoding UTF8
Write-Host "  результаты: $RESULTS_PATH"

Write-Host ''
Write-Host '=== РАЗБОР ===' -ForegroundColor Cyan
if (Test-Path $RESULTS_PATH) {
    & python $DECODER $RESULTS_PATH $OUT_DIR
}

Write-Host ''
Write-Host '=== ГОТОВО ===' -ForegroundColor Green
Write-Host @'
  Пришли вывод выше — там будет вердикт по порядку битов.

  INI уже восстановлен, устройство в исходном состоянии.
  Захваты в research/duck-bits-fast/ (на случай перепроверки).
'@
