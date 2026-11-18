r"""КТО ИМЕЕТ КНОПКУ EXP: M62 ИЛИ KB22?

═══════════ ЧТО НАЙДЕНО ═══════════

В MCC есть обработчик `on_PushButtonEXP_clicked` — то есть кнопка
«EXP» (expander) реально существует в интерфейсе. Рядом:

    on_PushButton48V_clicked, on_PushButtonNC_clicked,
    on_PushButtonEQ_clicked, on_PushButtonCOMP_clicked,
    on_PushButtonEXP_clicked, on_PushButtonDUCKING_clicked

Это меню эффектов входа: 48V, шумоподавление, EQ, компрессор,
EXPANDER, ducking.

═══════════ ЗАЧЕМ ПРОВЕРЯТЬ ═══════════

В `research/FEASIBILITY.md` я записал, что Expander у M62 нет.
Аргумент был слабый: у `M62_PrivateWidget` нет виджета Delay.

Но кнопка EXP может принадлежать как M62, так и KB22. Надо
определить точно: от этого зависит, есть ли у карты функция, которую
мы не используем.

═══════════ МЕТОД ═══════════

Находим все вхождения `on_PushButtonEXP_clicked` и смотрим, в каком
«кластере» они лежат: ищем ближайшие имена виджетов M62_PrivateWidget*
и KB22_PrivateWidget* в пределах разумного окна.

Запуск: python src/tools/check-exp-button.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MCC = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")

WINDOW = 20000  # окно поиска соседних виджетов


def main() -> int:
    if not MCC.exists():
        print(f"нет файла: {MCC}")
        return 1

    d = MCC.read_bytes()
    print("=" * 74)
    print("ЧЕЙ ЭТО EXPANDER: M62 ИЛИ KB22")
    print("=" * 74)

    # ─── все вхождения кнопки EXP ───
    needle = b"on_PushButtonEXP_clicked"
    positions = []
    s = 0
    while True:
        i = d.find(needle, s)
        if i < 0:
            break
        positions.append(i)
        s = i + 1

    print(f"\nвхождений on_PushButtonEXP_clicked: {len(positions)}")

    for off in positions:
        print(f"\n{'=' * 70}")
        print(f"0x{off:06x}")
        print("=" * 70)

        lo = max(0, off - WINDOW)
        hi = min(len(d), off + WINDOW)
        window = d[lo:hi]

        m62 = len(re.findall(rb"M62_PrivateWidget\d", window))
        kb22 = len(re.findall(rb"KB22_PrivateWidget\d", window))

        # какие именно виджеты рядом
        m62_names = sorted(set(
            m.decode() for m in re.findall(rb"M62_PrivateWidget\d(?:_\d)?", window)
        ))
        kb22_names = sorted(set(
            m.decode() for m in re.findall(rb"KB22_PrivateWidget\d(?:_\d)?", window)
        ))

        print(f"  в окне ±{WINDOW} байт:")
        print(f"    M62_PrivateWidget:  {m62} вхождений  {m62_names}")
        print(f"    KB22_PrivateWidget: {kb22} вхождений  {kb22_names}")

        # Показываем ближайший контекст
        ctx = d[max(0, off - 300) : off + 300]
        txt = "".join(chr(b) if 32 <= b < 127 else "." for b in ctx)
        print(f"\n  контекст: ...{txt}...")

    # ─── сравнение: кнопки NC, COMP, EQ ───
    print("\n" + "=" * 74)
    print("СРАВНЕНИЕ: ГДЕ ЖИВУТ ДРУГИЕ КНОПКИ ЭФФЕКТОВ")
    print("=" * 74)

    for name in (b"on_PushButtonNC_clicked", b"on_PushButtonCOMP_clicked",
                 b"on_PushButtonEQ_clicked", b"on_PushButtonDUCKING_clicked",
                 b"on_PushButtonEXP_clicked"):
        i = d.find(name)
        if i < 0:
            print(f"  {name.decode():32} НЕ НАЙДЕНО")
            continue
        lo = max(0, i - WINDOW)
        hi = min(len(d), i + WINDOW)
        w = d[lo:hi]
        m62 = len(re.findall(rb"M62_PrivateWidget\d", w))
        kb22 = len(re.findall(rb"KB22_PrivateWidget\d", w))
        verdict = "M62" if m62 > kb22 * 2 else "KB22" if kb22 > m62 * 2 else "общий код"
        print(f"  {name.decode():32} 0x{i:06x}  M62={m62:3} KB22={kb22:3}  -> {verdict}")

    # ─── вывод ───
    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)
    print("""
Кнопка EXP существует в MCC. Где именно она находится — определяет,
есть ли экспандер у M62.

Если кнопки NC/COMP/EQ/EXP/DUCKING лежат в ОДНОМ кластере —
это общее меню эффектов, и M62 может использовать те же классы,
даже если у него свой виджет. Тогда мой вывод «у M62 нет EXP»
нужно перепроверить на живом устройстве: попробовать записать
теги 0x44:0x06/07 и посмотреть, что изменится.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
