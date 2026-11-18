# SAMPLE RATE M62 — НАЙДЕНО. ЧТЕНИЕ И СМЕНА БЕЗ MCC
#
# ═══ ОТКРЫТИЕ ═══
#
# PKEY_AudioEngine_DeviceFormat отдаёт 48 байт. Первые 8 — префикс
# (не часть WAVEFORMATEX), дальше на смещении 8 идёт структура:
#
#   смещение 8:  wFormatTag     fe ff = 0xFFFE (WAVE_FORMAT_EXTENSIBLE)
#   смещение 10: nChannels      02 00 = 2
#   смещение 12: nSamplesPerSec 44 ac 00 00 = 44100  или
#                               80 bb 00 00 = 48000
#   смещение 16: nAvgBytesPerSec
#   смещение 20: nBlockAlign
#   смещение 22: wBitsPerSample
#
# То есть sample rate МЕНЯЕТСЯ в реестре, а не командой HID.
# Это настройка Windows-устройства, не протокола M62.
#
# ═══ ЧТО ЭТО ЗНАЧИТ ═══
#
# 1. Через HID sample rate менять НЕЛЬЗЯ и не нужно — это не протокол.
# 2. В бекенде его можно менять, но через Windows Audio API +
#    перезапуск аудиопотока, а не через MCC-окно.
# 3. В браузере — недоступно в принципе (нет доступа к Audio API ОС).
#
# Запуск:
#   чтение:  powershell -File src/tools/samplerate-tool.ps1
#   запись:  powershell -File src/tools/samplerate-tool.ps1 -Rate 48000

param(
    [int]$Rate = 0,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Get-M62Devices {
    $mmdev = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio'
    $out = @()
    foreach ($flow in 'Render', 'Capture') {
        $root = Join-Path $mmdev $flow
        if (-not (Test-Path $root)) { continue }
        Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
            $props = Join-Path $_.PSPath 'Properties'
            if (-not (Test-Path $props)) { return }
            $p = Get-ItemProperty $props -ErrorAction SilentlyContinue
            $name = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
            if ($name -notmatch 'M62') { return }
            $label = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
            $fmt = $p.'{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
            $rate = $null; $ch = $null; $bits = $null
            if ($fmt -and $fmt.Length -ge 24) {
                # WAVEFORMATEX начинается со смещения 8
                $ch = [BitConverter]::ToUInt16($fmt, 10)
                $rate = [BitConverter]::ToUInt32($fmt, 12)
                $bits = [BitConverter]::ToUInt16($fmt, 22)
            }
            $out += [PSCustomObject]@{
                Flow = $flow
                Name = $name
                Label = $label
                Key = $_.PSChildName
                Path = $_.PSPath
                Rate = $rate
                Channels = $ch
                Bits = $bits
            }
        }
    }
    return $out
}

$devices = Get-M62Devices

Write-Host '=== SAMPLE RATE УСТРОЙСТВ M62 ===' -ForegroundColor Cyan
Write-Host ''

if (-not $devices) {
    Write-Host '  устройств M62 не найдено' -ForegroundColor Yellow
    exit 1
}

$devices | Format-Table -AutoSize `
    @{n='Поток';e={$_.Flow}},
    @{n='Назначение';e={$_.Label}},
    @{n='Гц';e={$_.Rate}},
    @{n='Каналов';e={$_.Channels}},
    @{n='Бит';e={$_.Bits}} | Out-String | Write-Host

# сводка
$rates = $devices | Where-Object { $_.Rate } | Select-Object -ExpandProperty Rate -Unique
Write-Host "  уникальные sample rate: $($rates -join ', ')"

if ($Rate -eq 0) {
    Write-Host ''
    Write-Host '  (только чтение. Чтобы сменить: -Rate 48000)' -ForegroundColor Gray
    exit 0
}

# --- смена ---
if ($Rate -notin @(44100, 48000)) {
    Write-Host "  $Rate не поддерживается. Допустимо: 44100, 48000" -ForegroundColor Red
    exit 1
}

if (-not $Force) {
    Write-Host ''
    Write-Host "  ВНИМАНИЕ: смена sample rate прервёт текущий аудиопоток." -ForegroundColor Yellow
    Write-Host "  Добавьте -Force, чтобы продолжить." -ForegroundColor Yellow
    exit 0
}

Write-Host ''
Write-Host "  меняю на $Rate Гц..." -ForegroundColor Cyan

$changed = 0
foreach ($d in $devices) {
    if (-not $d.Rate) { continue }
    if ($d.Rate -eq $Rate) { Write-Host "    $($d.Label): уже $Rate"; continue }

    $p = Get-ItemProperty $d.Path -ErrorAction SilentlyContinue
    $fmt = $p.'{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
    if (-not $fmt) { continue }

    # копируем и меняем sample rate на смещении 12
    $new = [byte[]]$fmt.Clone()
    $bytes = [BitConverter]::GetBytes([uint32]$Rate)
    $new[12] = $bytes[0]
    $new[13] = $bytes[1]
    $new[14] = $bytes[2]
    $new[15] = $bytes[3]

    # nAvgBytesPerSec = rate * channels * bits/8
    $ch = [BitConverter]::ToUInt16($new, 10)
    $bits = [BitConverter]::ToUInt16($new, 22)
    $avg = [uint32]($Rate * $ch * ($bits / 8))
    $avgBytes = [BitConverter]::GetBytes($avg)
    $new[16] = $avgBytes[0]
    $new[17] = $avgBytes[1]
    $new[18] = $avgBytes[2]
    $new[19] = $avgBytes[3]

    try {
        Set-ItemProperty -Path $d.Path -Name '{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0' -Value $new
        $changed++
        Write-Host "    $($d.Label): $($d.Rate) -> $Rate  (записано)" -ForegroundColor Green
    } catch {
        Write-Host "    $($d.Label): не удалось записать — $_" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host "  изменено устройств: $changed" -ForegroundColor Cyan
Write-Host @'
  ВАЖНО: изменение в реестре применится после перезапуска
  аудиослужбы Windows (или переподключения устройства).

  Перезапуск службы:
    Restart-Service Audiosrv -Force

  Или проще: переподключить M62 по USB.

  ЭТО НЕ ПРОТОКОЛ M62 — это настройка Windows. Поэтому:
    - в браузере недоступно принципиально;
    - в бекенде возможно, но требует прав администратора
      и перезапуска аудиослужбы.
'@
