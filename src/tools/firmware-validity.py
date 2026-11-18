r"""ВАЛИДНОСТЬ АРХИТЕКТУРЫ — ПРАВИЛЬНАЯ МЕТРИКА.

═══════════ ОШИБКА, КОТОРУЮ ЭТОТ СКРИПТ ИСПРАВЛЯЕТ ═══════════

Первая версия считала «покрытие» так:

    for ins in md.disasm(data, addr):
        covered += ins.size

`disasm()` ОСТАНАВЛИВАЕТСЯ на первой невалидной инструкции. Поэтому
метрика показывала не «долю кода», а «сколько байт до первого
мусора». Положительный контроль это вскрыл: на python.exe (заведомый
x86-код) вышло 1.7%, а на случайных данных — 0.02%. То есть
разница между кодом и шумом почти нулевая, и вывод «прошивка не
декодируется» был бы ЛОЖНЫМ.

Скрипт `firmware-positive-control.py` поймал это. Без него я бы
записал в заметки неверный вывод.

═══════════ ПРАВИЛЬНАЯ МЕТРИКА ═══════════

Декодируем с КАЖДОГО смещения отдельно, по одной инструкции, и
считаем долю смещений, где декодирование удалось. Для настоящего
кода результат определяется архитектурой и почти не зависит от
выравнивания; для шума даёт низкий процент.

Дополнительно: для ARM Thumb и xCORE учитываем требование
выравнивания (2 байта), для x86 — любое.

Запуск: python src/tools/firmware-validity.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import capstone

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

# Сколько смещений проверять
PROBES = 20000


def validity(data: bytes, arch, mode, step: int = 1, max_insn_len: int = 16) -> float:
    """Доля смещений, с которых декодируется ХОТЯ БЫ одна инструкция.

    Это устойчивая метрика: она не обрывается на первом мусоре.

    @param step шаг между проверяемыми смещениями
    """
    try:
        md = capstone.Cs(arch, mode)
        md.detail = False
    except Exception:  # noqa: BLE001
        return -1.0

    n = len(data)
    ok = 0
    total = 0
    for off in range(0, n - max_insn_len, step):
        total += 1
        if total > PROBES:
            break
        # Пробуем декодировать одну инструкцию с этого смещения
        for ins in md.disasm(data[off : off + max_insn_len], 0x1000):
            ok += 1
            break
    return ok / max(1, total)


def mean_insn_len(data: bytes, arch, mode) -> float:
    """Средняя длина инструкции — для оценки правдоподобия."""
    try:
        md = capstone.Cs(arch, mode)
        md.detail = False
    except Exception:  # noqa: BLE001
        return 0.0
    total = 0
    cnt = 0
    for ins in md.disasm(data, 0x1000):
        total += ins.size
        cnt += 1
        if cnt > 20000:
            break
    return total / max(1, cnt)


def main() -> int:
    print("=" * 78)
    print("ВАЛИДНОСТЬ АРХИТЕКТУР — УСТОЙЧИВАЯ МЕТРИКА")
    print("=" * 78)

    decoders = [
        ("XCORE LE", capstone.CS_ARCH_XCORE, capstone.CS_MODE_LITTLE_ENDIAN, 2),
        ("XCORE BE", capstone.CS_ARCH_XCORE, capstone.CS_MODE_BIG_ENDIAN, 2),
        ("ARM Thumb LE", capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB, 2),
        ("ARM LE", capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM, 4),
        ("x86-64", capstone.CS_ARCH_X86, capstone.CS_MODE_64, 1),
        ("MIPS32 LE", capstone.CS_ARCH_MIPS,
         capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN, 4),
        ("RISC-V 32", capstone.CS_ARCH_RISCV, capstone.CS_MODE_RISCV32, 2),
    ]

    # ─── эталоны ───
    controls = []

    exe = Path(sys.executable)
    if exe.exists():
        d = exe.read_bytes()
        controls.append(("x86-код (python.exe)", d[0x1000 : 0x1000 + 0x8000]))
    controls.append(("случайные данные", os.urandom(0x8000)))
    controls.append(("нули", bytes(0x8000)))

    print("\n" + "-" * 78)
    print("ЭТАЛОНЫ (положительный и отрицательные контроли)")
    print("-" * 78)
    print(f"  {'данные':26}" + "".join(f"{n:14}" for n, _, _, _ in decoders))
    print("  " + "-" * 74)

    control_results = {}
    for cname, cdata in controls:
        row = f"  {cname:26}"
        for dname, arch, mode, step in decoders:
            v = validity(cdata, arch, mode, step)
            control_results[(cname, dname)] = v
            row += f"{v * 100:12.1f}%  "
        print(row)

    # ─── прошивка ───
    print("\n" + "-" * 78)
    print("ПРОШИВКА M62")
    print("-" * 78)

    if not FW.exists():
        print(f"  нет файла {FW}")
        return 1

    d = FW.read_bytes()
    # Участок без рядов нулей
    sample = d[0x2000 : 0x2000 + 0x8000]

    print(f"  образец: 0x2000..0x{0x2000 + len(sample):x} ({len(sample)} байт)")
    print(f"\n  {'':26}" + "".join(f"{n:14}" for n, _, _, _ in decoders))
    row = f"  {'прошивка':26}"
    fw_results = {}
    for dname, arch, mode, step in decoders:
        v = validity(sample, arch, mode, step)
        fw_results[dname] = v
        row += f"{v * 100:12.1f}%  "
    print(row)

    # средняя длина инструкции
    print("\n  средняя длина инструкции (правдоподобие):")
    for dname, arch, mode, step in decoders:
        ml = mean_insn_len(sample, arch, mode)
        print(f"    {dname:14} {ml:5.2f} байт")

    # ─── вывод ───
    print("\n" + "=" * 78)
    print("ВЫВОД")
    print("=" * 78)

    # Проверяем, что метрика различает код и шум
    x86_on_code = control_results.get(("x86-код (python.exe)", "x86-64"), 0)
    x86_on_rand = control_results.get(("случайные данные", "x86-64"), 0)

    print(f"\n  контроль метрики: x86 на коде {x86_on_code * 100:.1f}%, "
          f"на шуме {x86_on_rand * 100:.1f}%")

    if x86_on_code < 0.5:
        print("""
  МЕТРИКА ВСЁ ЕЩЁ НЕ РАБОТАЕТ: декодер не отличает код от шума.
  Выводы о прошивке делать нельзя.
""")
        return 2

    print("  метрика работает: код отличается от шума в разы.\n")

    best_name = max(fw_results, key=lambda k: fw_results[k])
    best_val = fw_results[best_name]
    rand_val = control_results.get(("случайные данные", best_name), 0)

    print(f"  лучшая архитектура для прошивки: {best_name} — "
          f"{best_val * 100:.1f}%")
    print(f"  (случайные данные на ней же: {rand_val * 100:.1f}%)")

    if best_val > 0.85:
        print(f"""
  УВЕРЕННО: прошивка написана под {best_name}.
  Можно грузить в Ghidra / разбирать капстоном.
""")
    elif best_val > 0.6:
        print(f"""
  ВЕРОЯТНО: {best_name}. Покрытие ниже 85%, но заметно выше шума.
  Возможно, в образце есть таблицы данных. Стоит взять участок
  из середины образа.
""")
    else:
        print(f"""
  НИ ОДНА архитектура не выделяется на фоне шума.

  Значит образ НЕ является открытым кодом под проверенные
  архитектуры. Нужен разбор контейнера (магия 0xc07aaf11) или
  распаковщик.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
