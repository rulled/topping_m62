# ═══════════════════════════════════════════════════════════════════════
#  M62: ОДИН ПРОГОН ЗАКРЫВАЕТ ВСЁ ОСТАВШЕЕСЯ
# ═══════════════════════════════════════════════════════════════════════
#
# ЗАПУСК: от администратора (или через scheduled task M62Capture).
#
# ═══ ЧТО ЗАКРЫВАЕТ ЭТОТ ПРОГОН ═══
#
#   1. КОДЫ ВСЕХ ИСТОЧНИКОВ (для выходов, loopback, селекторов).
#      Слоты loopback содержат КОД ИСТОЧНИКА в свойстве 0x02 отдельно от
#      усиления. Подставляя разные источники в 6 слотов за один старт MCC,
#      получаем 6 кодов за раз.
#
#   2. РАЗМЕР МАСКИ DUCKING (0x43:05 / 0x43:06).
#      Меняем набор входов в INI -> видим, какое из двух значений меняется.
#
#   3. OTGIN в микшере.
#      Добавляем OTG IN в список видимых источников Mix B -> он появляется
#      в bulk push, и мы видим его свойство.
#
#   4. ВЫХОДЫ (HP, OTG OUT): AudioSource -> код, GAIN -> Q25.
#
# ═══ ПОЧЕМУ ОДИН ПРОГОН ═══
#
#   MCC при старте отправляет ВСЁ состояние одним bulk push. Значит все
#   правки INI должны быть сделаны ДО запуска MCC. Один старт = все данные.
#
# ═══ БЕЗОПАСНОСТЬ ═══
#
#   Все усиления отрицательные (тише unity). HP и OTG отключены физически.
#   INI восстанавливается из бэкапа в finally-блоке.

$ErrorActionPreference = 'Stop'

# ── пути ──────────────────────────────────────────────────────────────
$WS_ROOT = 'C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live'
$REG_KEY = 'HKCU:\Software\TOPPING\TOPPING Professional Control Center\M62'
$ROOT_HUB = '\\.\USBPcap1'
$OUT_FILE = Join-Path $PSScriptRoot 'research\m62-full.pcap'
$MCC_EXE = 'C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe'

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
Write-Host ' M62: полный прогон — источники, выходы, ducking, OTGIN' -ForegroundColor Cyan
Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Cyan

# ── 1. проверки ───────────────────────────────────────────────────────
Write-Host "`n[1/7] проверки" -ForegroundColor Yellow
if (-not (Test-Admin)) {
    Write-Host '  ОШИБКА: нужны права администратора.' -ForegroundColor Red
    exit 1
}
Write-Host '  администратор: да'

$stale = Get-Process USBPcapCMD -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "  убиваю зависший USBPcapCMD: $($stale.Id -join ', ')"
    foreach ($p in $stale) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

if (-not (Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like 'USB\VID_152A&PID_875C\*' })) {
    Write-Host '  ОШИБКА: M62 не найден.' -ForegroundColor Red
    exit 1
}
Write-Host '  M62: найден'

$wsName = (Get-ItemProperty -Path $REG_KEY -Name 'M62_Live_Workspace' -ErrorAction SilentlyContinue).M62_Live_Workspace
if (-not $wsName) { Write-Host '  ОШИБКА: workspace не найден в реестре.' -ForegroundColor Red; exit 1 }
$INI = Join-Path $WS_ROOT "M62_Live_$wsName.ini"
$BAK = "$INI.bak-fullrun"
Write-Host "  workspace: $wsName"

# ── 2. закрыть MCC ────────────────────────────────────────────────────
Write-Host "`n[2/7] закрываю MCC" -ForegroundColor Yellow
Stop-Mcc
if ((Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    Write-Host '  ОШИБКА: MCC не закрылся. Закрой через трей.' -ForegroundColor Red
    exit 1
}
Write-Host '  закрыт'

# ── 3. правка INI ─────────────────────────────────────────────────────
Write-Host "`n[3/7] правлю INI" -ForegroundColor Yellow
Copy-Item $INI $BAK -Force
Write-Host "  бэкап: $BAK"

# Все правки разом. Каждая — проверка по имени источника.
$text = [System.IO.File]::ReadAllText($INI)
$lines = $text -split "`r?`n"

# какие источники подставляем в слоты loopback (код источника -> 0x02)
# 6 слотов: LB12, LB34, LB56, LB78, OTGOUT, HP
$LOOPBACK_SOURCES = @{
    'Loopback_LB12' = 'IN 1'
    'Loopback_LB34' = 'IN 2'
    'Loopback_LB56' = 'Playback 3/4'
    'Loopback_LB78' = 'Playback 9/10'
}
$OUTPUT_SOURCES = @{
    'Output_OTGOUT' = 'BT'
    'Output_HP'     = 'AUX'
}

# значения усилений для микшера (уникальные, из прошлых прогонов)
$MIX_B = @{
    'Mixer_IN12' = -11; 'Mixer_AUX' = -12; 'Mixer_BT' = -13; 'Mixer_FX' = -14
    'Mixer_PB12' = -15; 'Mixer_PB34' = -16; 'Mixer_PB56' = -17
    'Mixer_PB78' = -18; 'Mixer_PB910' = -19
}
$MIX_C = @{ 'Mixer_IN12' = -21; 'Mixer_AUX' = -22; 'Mixer_BT' = -23 }

$cur = $null
$stat = @{ loop = 0; out = 0; mix = 0; duck = 0; vis = 0 }

for ($i = 0; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($t.StartsWith('[')) { $cur = $t.Substring(1, $t.Length - 2); continue }
    if (-not $cur -or -not $t) { continue }

    # MixB_Visible: добавляем OTG IN, иначе OTGIN в матрицу не попадёт.
    # Сейчас там 9 источников: IN, AUX, BT, FX, Playback 1/2..9/10.
    # Десятый слот матрицы (0x0d/0x0e) пуст — вероятно это и есть OTG IN.
    if ($t.StartsWith('MixB_Visible=') -and $t -notmatch 'OTG') {
        $lines[$i] = $t + ', OTG IN'
        $stat.vis++
        continue
    }

    # loopback: код источника + усиление -20
    if ($LOOPBACK_SOURCES.ContainsKey($cur)) {
        if ($t.StartsWith('AudioSource=')) {
            $lines[$i] = "AudioSource=$($LOOPBACK_SOURCES[$cur])"; $stat.loop++
        } elseif ($t.StartsWith('GAIN=')) {
            $lines[$i] = 'GAIN=-20'; $stat.loop++
        } elseif ($t.StartsWith('MUTE=')) {
            $lines[$i] = 'MUTE=false'; $stat.loop++
        }
        continue
    }
    # выходы: код источника + усиление -20
    if ($OUTPUT_SOURCES.ContainsKey($cur)) {
        if ($t.StartsWith('AudioSource=')) {
            $lines[$i] = "AudioSource=$($OUTPUT_SOURCES[$cur])"; $stat.out++
        } elseif ($t.StartsWith('GAIN=')) {
            $lines[$i] = 'GAIN=-20'; $stat.out++
        } elseif ($t.StartsWith('MUTE=')) {
            $lines[$i] = 'MUTE=0'; $stat.out++
        }
        continue
    }
    # микшер
    if ($MIX_B.ContainsKey($cur) -and $t.StartsWith('MixB_GAIN=')) {
        $lines[$i] = "MixB_GAIN=$($MIX_B[$cur])"; $stat.mix++
        continue
    }
    if ($MIX_C.ContainsKey($cur) -and $t.StartsWith('MixC_GAIN=')) {
        $lines[$i] = "MixC_GAIN=$($MIX_C[$cur])"; $stat.mix++
        continue
    }
    # ducking: другой набор входов -> увидим, что такое 0x43:05/06
    if ($cur -eq 'Ducking') {
        if ($t -match '^IN1(AUX|BT|OTGIN)=true') { $lines[$i] = $t -replace '=true', '=false'; $stat.duck++ }
        elseif ($t -match '^IN1(Playback1_2|Playback3_4)=true') { $lines[$i] = $t -replace '=true', '=false'; $stat.duck++ }
        elseif ($t.StartsWith('Threshold=')) { $lines[$i] = 'Threshold=-35'; $stat.duck++ }
    }
}

Write-Host "  loopback: $($stat.loop) строк, выходы: $($stat.out), микшер: $($stat.mix), ducking: $($stat.duck), видимость: $($stat.vis)"

if ($stat.loop -lt 10 -or $stat.mix -lt 12) {
    Write-Host '  ОШИБКА: слишком мало правок.' -ForegroundColor Red
    Copy-Item $BAK $INI -Force
    exit 1
}

[System.IO.File]::WriteAllText($INI, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host '  INI записан'

# ── 4. захват ─────────────────────────────────────────────────────────
Write-Host "`n[4/7] захват" -ForegroundColor Yellow
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
    $err = $proc.StandardError.ReadToEnd()
    Write-Host "  ОШИБКА захвата: $err" -ForegroundColor Red
    Copy-Item $BAK $INI -Force
    Write-Host '  INI восстановлен.' -ForegroundColor Yellow
    exit 1
}
Write-Host '  захват идёт'

# ── 5. старт MCC ──────────────────────────────────────────────────────
Write-Host "`n[5/7] запускаю MCC (отправит всё состояние)" -ForegroundColor Yellow
Start-Process $MCC_EXE
Start-Sleep -Seconds 28
Write-Host '  MCC загрузился'

# ── 6. остановка и восстановление ─────────────────────────────────────
Write-Host "`n[6/7] останавливаю захват и восстанавливаю INI" -ForegroundColor Yellow
Start-Sleep -Seconds 3
try { $proc.StandardInput.WriteLine(); $proc.StandardInput.Flush() } catch { }
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { try { Stop-Process -Id $proc.Id -Force } catch { } }
Start-Sleep -Seconds 1

Stop-Mcc
Copy-Item $BAK $INI -Force
Write-Host '  INI восстановлен'

# ── 7. разбор ─────────────────────────────────────────────────────────
Write-Host "`n[7/7] разбор" -ForegroundColor Yellow
if (-not (Test-Path $OUT_FILE)) {
    Write-Host '  ОШИБКА: pcap не создан.' -ForegroundColor Red
    exit 1
}
Write-Host ("  размер: {0:N0} байт" -f (Get-Item $OUT_FILE).Length)

& python (Join-Path $PSScriptRoot 'src\tools\analyze-full.py') $OUT_FILE 6

Write-Host "`n═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ' готово' -ForegroundColor Green
Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Green
