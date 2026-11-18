# SAMPLE RATE И BUFFER SIZE — МОЖНО ЛИ МЕНЯТЬ БЕЗ MCC
#
# ═══ ЗАЧЕМ ═══
#
# Sample rate и buffer size — единственная функция MCC, которая не
# найдена в HID. Но это НЕ настройка устройства: это настройка
# USB-аудиоинтерфейса в Windows (какой формат использовать).
#
# Значит её можно менять через Windows Audio API.
#
# ═══ ЧТО ПРОВЕРЯЕТСЯ ═══
#
# 1. Найти аудиоустройства M62 в системе.
# 2. Прочитать их текущий формат (sample rate, bit depth).
# 3. Показать, где это хранится, чтобы понять, можно ли менять
#    программно.
#
# Запуск: powershell -File src/tools/probe-samplerate-windows.ps1

$ErrorActionPreference = 'Continue'

Write-Host '=== 1. АУДИОУСТРОЙСТВА M62 ===' -ForegroundColor Cyan

$audio = Get-PnpDevice -Class 'MEDIA' -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -match 'M62|Topping' }

if (-not $audio) {
    Write-Host '  не найдено устройств M62 в классе MEDIA' -ForegroundColor Yellow
} else {
    foreach ($d in $audio) {
        Write-Host "  $($d.FriendlyName)"
        Write-Host "    InstanceId: $($d.InstanceId)"
        Write-Host "    Status:     $($d.Status)"
    }
}

Write-Host ''
Write-Host '=== 2. АУДИОУСТРОЙСТВА ЧЕРЕЗ WMI ===' -ForegroundColor Cyan

try {
    $wmi = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'M62|Topping' }
    foreach ($d in $wmi) {
        Write-Host "  $($d.Name)"
        Write-Host "    Manufacturer: $($d.Manufacturer)"
        Write-Host "    DeviceID:     $($d.DeviceID)"
        Write-Host "    Status:       $($d.StatusInfo)"
    }
} catch {
    Write-Host "  WMI недоступен: $_"
}

Write-Host ''
Write-Host '=== 3. ТЕКУЩИЙ ФОРМАТ (реестр) ===' -ForegroundColor Cyan
Write-Host @'
  Windows хранит формат по умолчанию в реестре:
    HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{...}\Properties
    ключ: {f19f064d-082c-4e27-bc73-6882a1bb8e4c},0  (PKEY_AudioEngine_DeviceFormat)

  Это бинарный WAVEFORMATEX: первые 4 байта формат тега,
  затем каналы, sample rate, byte rate...

  Прочитать можно, но менять через реестр — плохая идея
  (нужен перезапуск аудиослужбы).
'@

$mmdev = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
if (Test-Path $mmdev) {
    Write-Host ''
    Write-Host '  Поиск устройств M62 в MMDevices...' -ForegroundColor Cyan
    $found = 0
    Get-ChildItem $mmdev -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Join-Path $_.PSPath 'Properties'
        if (Test-Path $props) {
            $p = Get-ItemProperty $props -ErrorAction SilentlyContinue
            $name = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
            if ($name -match 'M62') {
                $found++
                Write-Host "    НАЙДЕНО: $name"
                Write-Host "      ключ: $($_.PSChildName)"
                $fmt = $p.'{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
                if ($fmt) {
                    # WAVEFORMATEX: wFormatTag(2) nChannels(2) nSamplesPerSec(4) ...
                    $rate = [BitConverter]::ToUInt32($fmt, 4)
                    $ch = [BitConverter]::ToUInt16($fmt, 2)
                    Write-Host "      sample rate: $rate Гц, каналов: $ch"
                } else {
                    Write-Host "      формат не найден в этом ключе"
                }
            }
        }
    }
    if ($found -eq 0) {
        Write-Host '    устройство M62 не найдено в MMDevices (может, только capture)'
    }
} else {
    Write-Host "  путь MMDevices не существует"
}

Write-Host ''
Write-Host '=== 4. ВЫВОД ===' -ForegroundColor Cyan
Write-Host @'
  Sample rate — это свойство Windows-устройства, а не команда M62.

  ЧТО ЭТО ЗНАЧИТ:
    1. Через HID его менять НЕЛЬЗЯ и не нужно — это не протокол
       устройства, а настройка ОС.
    2. Через Windows API его МОЖНО менять (AudioSessionManager /
       IAudioClient::Initialize с нужным форматом), но это требует
       нативного кода (C++/C#), не Node и не браузер.
    3. В браузере недоступно в принципе — Web Audio работает
       в рамках того формата, что даёт ОС.

  ПОЭТОМУ:
    - в бекенде sample rate остаётся, но требует MCC-окно
      (текущая реализация) ИЛИ нативного хелпера;
    - в браузере недоступно — это честное ограничение, а не
      недоделка реверса.

  ПРОВЕРИТЬ: если поменять формат в панели звука Windows
  (Параметры -> Звук -> M62 -> Дополнительно), меняется ли
  что-то в HID? Если нет — подтверждает, что это не протокол.
'@
