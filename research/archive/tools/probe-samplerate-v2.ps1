# SAMPLE RATE M62: ПРАВИЛЬНЫЙ РАЗБОР WAVEFORMATEX
#
# ═══ ЧТО БЫЛО НЕ ТАК ═══
#
# Прошлый скрипт читал sample rate со смещения 4, но получал 1 Гц
# и 0 каналов. Значит смещение не то: значение PKEY_AudioEngine_DeviceFormat
# приходит как массив байт, но PowerShell может отдать его уже
# обёрнутым (с префиксом длины или как строку).
#
# ═══ ПРАВИЛЬНАЯ СТРУКТУРА ═══
#
# WAVEFORMATEX:
#   0x00  wFormatTag        UInt16   (1 = PCM, 3 = IEEE_FLOAT, 0xFFFE = EXTENSIBLE)
#   0x02  nChannels         UInt16
#   0x04  nSamplesPerSec    UInt32   <-- sample rate
#   0x08  nAvgBytesPerSec   UInt32
#   0x0C  nBlockAlign       UInt16
#   0x0E  wBitsPerSample    UInt16
#   0x10  cbSize            UInt16
#
# Если реестр отдаёт байты правильно, rate будет на смещении 4.
# Если там префикс — нужно сдвинуть.
#
# Запуск: powershell -File src/tools/probe-samplerate-v2.ps1

$ErrorActionPreference = 'Continue'

function Parse-WaveFormat([byte[]]$b) {
    if (-not $b -or $b.Length -lt 16) { return $null }
    # пробуем несколько смещений: 0, 4, 8
    $attempts = @()
    foreach ($off in 0, 4, 8, 12) {
        if ($b.Length -lt ($off + 16)) { continue }
        $tag = [BitConverter]::ToUInt16($b, $off)
        $ch = [BitConverter]::ToUInt16($b, $off + 2)
        $rate = [BitConverter]::ToUInt32($b, $off + 4)
        $bits = [BitConverter]::ToUInt16($b, $off + 14)
        # правдоподобные значения
        if ($rate -ge 8000 -and $rate -le 384000 -and $ch -ge 1 -and $ch -le 8) {
            $attempts += [PSCustomObject]@{
                Offset = $off; Tag = $tag; Channels = $ch
                Rate = $rate; Bits = $bits
            }
        }
    }
    return $attempts
}

Write-Host '=== ФОРМАТ УСТРОЙСТВ M62 ===' -ForegroundColor Cyan

$mmdev = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio'
$found = 0

foreach ($flow in 'Render', 'Capture') {
    $root = Join-Path $mmdev $flow
    if (-not (Test-Path $root)) { continue }

    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Join-Path $_.PSPath 'Properties'
        if (-not (Test-Path $props)) { return }
        $p = Get-ItemProperty $props -ErrorAction SilentlyContinue
        $name = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
        if ($name -notmatch 'M62') { return }

        $found++
        Write-Host ''
        Write-Host "  $flow : $name" -ForegroundColor Green
        Write-Host "    ключ: $($_.PSChildName)"

        # состояние устройства
        $state = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
        if ($state) { Write-Host "    состояние: $state" }

        $fmt = $p.'{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
        if (-not $fmt) {
            Write-Host '    PKEY_AudioEngine_DeviceFormat отсутствует'
            return
        }

        Write-Host "    тип значения: $($fmt.GetType().Name), длина: $($fmt.Length)"

        $parsed = Parse-WaveFormat $fmt
        if ($parsed -and $parsed.Count -gt 0) {
            foreach ($a in $parsed) {
                $tagName = switch ($a.Tag) {
                    1 { 'PCM' }
                    3 { 'IEEE_FLOAT' }
                    0xFFFE { 'EXTENSIBLE' }
                    default { "tag=$($a.Tag)" }
                }
                Write-Host ("    -> смещение {0}: {1} Гц, {2} канала, {3} бит, {4}" -f `
                    $a.Offset, $a.Rate, $a.Channels, $a.Bits, $tagName)
            }
        } else {
            Write-Host '    не удалось разобрать как WAVEFORMATEX'
            Write-Host ("    первые байты: " + (($fmt[0..15] | ForEach-Object { $_.ToString('x2') }) -join ' '))
        }
    }
}

if ($found -eq 0) {
    Write-Host '  устройства M62 не найдены ни в Render, ни в Capture' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== ЧТО ЭТО ЗНАЧИТ ===' -ForegroundColor Cyan
Write-Host @'
  Sample rate — это формат Windows-устройства, а не команда M62.

  Если удалось прочитать РАЗНЫЕ значения (например, 44100 и 48000
  для разных устройств M62) — значит:
    - это действительно настройка ОС;
    - менять её надо через Windows Audio API, а не через HID.

  ЧТОБЫ ИЗМЕНИТЬ программно, нужен нативный вызов:
    IAudioClient::Initialize с нужным WAVEFORMATEX
  или утилита вроде SoundVolumeView / nircmd.

  В Node это делается через node-ffi / нативный аддон,
  в браузере — НЕВОЗМОЖНО в принципе.
'@
