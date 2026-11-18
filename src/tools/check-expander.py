r"""ПРОВЕРКА: есть ли у M62 Expander в MCC?

═══════════ ЗАЧЕМ ═══════════

В `docs/EFFECTS.md` записано, что реверс строк MCC нашёл:

    Compressor_IN1 / Compressor_IN2
    Expander_IN1 / Expander_IN2      <- нет в INI вообще
    Denoise_IN1 / Denoise_IN2
    Ducking

Но при разборе виджетов я нашёл, что `widgetDelay` принадлежит
KB22, а не M62, и на этом основании записал в FEASIBILITY.md, что
Expander у M62 отсутствует.

**Это могло быть ошибкой**: строки Expander могли относиться к M62,
а виджет — к KB22, и это разные вещи.

Надо проверить точно:
  1. есть ли строки Expander в MCC;
  2. относятся ли они к M62 или к KB22;
  3. есть ли им соответствующие теги.

Запуск: python src/tools/check-expander.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MCC = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")

TERMS = [
    b"Expander_IN1",
    b"Expander_IN2",
    b"Expander_IN",
    b"Compressor_IN1",
    b"Compressor_IN2",
    b"Denoise_IN1",
    b"Denoise_IN2",
    b"Ducking",
    b"Expander",
    b"Compressor",
]


def ctx(data: bytes, off: int, before: int = 260, after: int = 260) -> str:
    lo = max(0, off - before)
    hi = min(len(data), off + after)
    chunk = data[lo:hi]
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def main() -> int:
    if not MCC.exists():
        print(f"нет файла: {MCC}")
        return 1

    d = MCC.read_bytes()

    print("=" * 74)
    print("ПРОВЕРКА: ЕСТЬ ЛИ EXPANDER У M62")
    print("=" * 74)
    print(f"\nMCC: {len(d)} байт\n")

    print("-" * 74)
    print("1. ПОИСК СТРОК")
    print("-" * 74)
    for t in TERMS:
        cnt = d.count(t)
        idx = d.find(t)
        pos = f"0x{idx:06x}" if idx >= 0 else "—"
        print(f"  {t.decode():18} вхождений {cnt:3}   первое {pos}")

    # ─── контекст Expander ───
    print("\n" + "-" * 74)
    print("2. КОНТЕКСТ ВОКРУГ Expander")
    print("-" * 74)
    seen = set()
    for m in re.finditer(rb"Expander[A-Za-z0-9_]*", d):
        off = m.start()
        if off in seen:
            continue
        seen.add(off)
        print(f"\n  0x{off:06x}  ({m.group().decode(errors='replace')})")
        print(f"    ...{ctx(d, off)}...")
        if len(seen) >= 6:
            break

    # ─── есть ли рядом M62 или KB22 ───
    print("\n" + "-" * 74)
    print("3. К ЧЕЙ МОДЕЛИ ОТНОСИТСЯ (ищем M62/KB22 рядом)")
    print("-" * 74)

    for m in re.finditer(rb"Expander[A-Za-z0-9_]*", d):
        off = m.start()
        window = d[max(0, off - 4000) : off + 4000]
        m62 = window.count(b"M62")
        kb22 = window.count(b"KB22")
        if m62 or kb22:
            print(f"  0x{off:06x}: в окне ±4 КБ M62={m62}, KB22={kb22}"
                  f"  -> {'M62' if m62 > kb22 else 'KB22' if kb22 > m62 else 'неясно'}")
        else:
            print(f"  0x{off:06x}: ни M62, ни KB22 рядом")

    # ─── что говорят наши данные ───
    print("\n" + "-" * 74)
    print("4. НАШИ ДАННЫЕ ПО ТЕГАМ")
    print("-" * 74)

    # Смотрим, какие теги эффектов реально приходят в Mobile/Live
    import json
    for f in ("research/mode-live-full.json", "research/mode-prof-full.json"):
        p = Path(f)
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        snap = data.get("snap", {})
        # 0x44 = 68, 0x46 = 70
        fx44 = [k for k in snap if k.startswith("68:")]
        fx46 = [k for k in snap if k.startswith("70:")]
        print(f"\n  {p.name} (режим {data.get('mode')}):")
        print(f"    0x44 (эффекты): {len(fx44)} адресов")
        if fx44:
            print(f"      {', '.join(sorted(fx44))}")
        print(f"    0x46 (компрессор): {len(fx46)} адресов")

    # ─── вывод ───
    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)

    has_expander_str = d.count(b"Expander") > 0
    has_expander_tag = d.count(b"Expander_IN1") > 0

    if has_expander_tag:
        print("""
  В MCC ЕСТЬ строки Expander_IN1/IN2. Это значит, что класс
  экспандера в приложении существует. Вопрос — для какого устройства.

  Мой предыдущий вывод «у M62 expander отсутствует» был основан
  ТОЛЬКО на отсутствии виджета у M62_PrivateWidget. Это слабый
  аргумент: виджет KB22 может переиспользоваться, а строки — общие.
""")
    else:
        print("\n  Строк Expander_IN1/IN2 в MCC нет.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
