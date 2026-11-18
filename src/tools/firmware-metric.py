r"""ПРАВИЛЬНАЯ МЕТРИКА: проверка на СГЕНЕРИРОВАННОМ коде.

═══════════ ПОЧЕМУ ПРЕДЫДУЩИЕ ПОПЫТКИ ВРАЛИ ═══════════

Попытка 1: `md.disasm()` обрывается на первой ошибке -> мерила
«длину до первого мусора». Контроль это вскрыл.

Попытка 2: доля смещений, где декодируется хоть одна инструкция.
Тоже негодна: ARM Thumb — 2-байтовые инструкции, и почти любая
пара байт декодируется. На СЛУЧАЙНЫХ данных вышло 94.9%, на
настоящем коде 95.8%. Разницы нет, а скрипт отрапортовал «метрика
работает» — ложный положительный контроль.

═══════════ ПРАВИЛЬНАЯ МЕТРИКА ═══════════

Мерим НЕПРЕРЫВНЫЙ прогон: с начала окна декодируем подряд, пока
не встретим мусор. Считаем долю покрытых байт окна. Берём медиану
по многим окнам.

Настоящий код: длинные прогоны -> высокая медиана.
Шум: обрыв на 1-2 инструкции -> низкая медиана.

═══════════ КОНТРОЛИ ═══════════

 Положительный: сгенерированный код
   x86:   b8 xx xx xx xx c3   (mov eax,imm32; ret), повторённый
   Thumb: 00 b5 00 bd         (push {lr}; pop {pc}), повторённый
 Отрицательный: os.urandom

Инструмент считается рабочим, только если на СВОЁМ коде он даёт
>80%, а на шуме <10%.

Запуск: python src/tools/firmware-metric.py
"""

from __future__ import annotations

import os
import statistics
import sys
from pathlib import Path

import capstone

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

WINDOW = 256
MAX_WINDOWS = 400


def run_ratio(data: bytes, arch, mode) -> float:
    """Доля покрытых байт в первом непрерывном прогоне окна."""
    try:
        md = capstone.Cs(arch, mode)
        md.detail = False
        md.skipdata = False
    except Exception:  # noqa: BLE001
        return -1.0
    covered = 0
    for ins in md.disasm(data, 0x1000):
        covered += ins.size
        if covered > len(data):
            break
    return covered / max(1, len(data))


def median_ratio(data: bytes, arch, mode) -> float:
    """Медиана доли покрытия по окнам."""
    vals = []
    for i in range(0, len(data) - WINDOW, WINDOW):
        vals.append(run_ratio(data[i : i + WINDOW], arch, mode))
        if len(vals) >= MAX_WINDOWS:
            break
    return statistics.median(vals) if vals else 0.0


# ─── сгенерированный эталонный код ───
X86_CODE = (b"\xb8\x01\x00\x00\x00\xc3") * 4000      # mov eax,1; ret
THUMB_CODE = (b"\x00\xb5\x00\xbd") * 6000            # push {lr}; pop {pc}
XCORE_CODE = (b"\x00\x00\x00\x00") * 8000            # nop (см. ниже)


def main() -> int:
    print("=" * 78)
    print("МЕТРИКА НЕПРЕРЫВНОГО ПРОГОНА — КОНТРОЛИ")
    print("=" * 78)

    decoders = [
        ("XCORE LE", capstone.CS_ARCH_XCORE, capstone.CS_MODE_LITTLE_ENDIAN),
        ("ARM Thumb LE", capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB),
        ("ARM LE", capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM),
        ("x86-64", capstone.CS_ARCH_X86, capstone.CS_MODE_64),
    ]

    print("\n" + "-" * 78)
    print("1. ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: сгенерированный код")
    print("-" * 78)
    print(f"  {'данные':22}" + "".join(f"{n:14}" for n, _, _ in decoders))
    print("  " + "-" * 74)

    controls = [
        ("x86-код (mov;ret)", X86_CODE),
        ("Thumb-код (push;pop)", THUMB_CODE),
        ("случайные", os.urandom(0x8000)),
        ("нули", bytes(0x8000)),
    ]

    res = {}
    for cname, cdata in controls:
        row = f"  {cname:22}"
        for dname, arch, mode in decoders:
            v = median_ratio(cdata, arch, mode)
            res[(cname, dname)] = v
            row += f"{v * 100:12.1f}%  "
        print(row)

    # ─── проверка работоспособности метрики ───
    x86_own = res[("x86-код (mov;ret)", "x86-64")]
    thumb_own = res[("Thumb-код (push;pop)", "ARM Thumb LE")]
    on_rand = res[("случайные", "x86-64")]
    on_rand_thumb = res[("случайные", "ARM Thumb LE")]

    print(f"\n  x86-код на x86-64:        {x86_own * 100:.1f}%")
    print(f"  Thumb-код на ARM Thumb:   {thumb_own * 100:.1f}%")
    print(f"  шум на x86-64:            {on_rand * 100:.1f}%")
    print(f"  шум на ARM Thumb:         {on_rand_thumb * 100:.1f}%")

    metric_ok = (
        x86_own > 0.8 and thumb_own > 0.8
        and on_rand < 0.10 and on_rand_thumb < 0.10
    )

    if not metric_ok:
        print("""
  МЕТРИКА НЕ РАБОТАЕТ. Метрика должна давать >80% на своём коде
  и <10% на шуме. Выводы о прошивке делать нельзя.
""")
        return 2

    print("\n  МЕТРИКА РАБОТАЕТ: свой код >80%, шум <10%, разрыв в разы.")

    # ─── прошивка ───
    print("\n" + "-" * 78)
    print("2. ПРОШИВКА M62")
    print("-" * 78)

    if not FW.exists():
        print(f"  нет файла {FW}")
        return 1

    d = FW.read_bytes()
    # Берём участок без рядов нулей
    sample = d[0x2000 : 0x2000 + 0x10000]

    print(f"  образец 0x2000..0x{0x2000 + len(sample):x}\n")
    print(f"  {'':22}" + "".join(f"{n:14}" for n, _, _ in decoders))
    row = f"  {'прошивка':22}"
    fw = {}
    for dname, arch, mode in decoders:
        v = median_ratio(sample, arch, mode)
        fw[dname] = v
        row += f"{v * 100:12.1f}%  "
    print(row)

    # ─── вывод ───
    print("\n" + "=" * 78)
    print("ВЫВОД")
    print("=" * 78)

    best = max(fw, key=lambda k: fw[k])
    best_v = fw[best]
    noise = res[("случайные", best)]

    print(f"\n  лучшая: {best} — {best_v * 100:.1f}% "
          f"(шум на ней: {noise * 100:.1f}%)")

    if best_v > 0.8 and best_v > noise + 0.4:
        print(f"""
  УВЕРЕННО: прошивка написана под {best}.
  Дальше — Ghidra (для xCORE нужно расширение) или капстон напрямую.
""")
    elif best_v > noise + 0.2:
        print(f"""
  ВЕРОЯТНО {best}, но разрыв с шумом небольшой ({best_v * 100:.0f}% против
  {noise * 100:.0f}%). Нужен участок чище — возможно, начало образа это
  заголовок, а не код.
""")
    else:
        print(f"""
  Прошивка НЕ ОТЛИЧАЕТСЯ от шума ни на одной архитектуре.

  Факты, которые это подтверждают:
    • строк почти нет (0.49%);
    • энтропия 90% блоков в полосе 5-7.5 (не 7.9+, как у сжатого);
    • 4 подобраза с общей магией 0xc07aaf11;
    • ни x86, ни ARM, ни xCORE не дают чистого прогона.

  Значит: это КОНТЕЙНЕР. Код внутри либо сжат/зашифрован, либо
  упакован в блоки со своей структурой. Грузить в Ghidra напрямую
  бессмысленно — она покажет мусор.

  Следующий шаг: разобрать формат контейнера по магии 0xc07aaf11
  (8 вхождений, из них 4 — начала подобразов).
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
