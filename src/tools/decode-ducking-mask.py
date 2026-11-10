r"""МАСКА DUCKING: расшифровка битов через INI.

══════════ ЧТО ИЗВЕСТНО ══════════

Из захватов:
  0x43:0x05  значения [224, 255]   224 = 0xE0, 255 = 0xFF
  0x43:0x06  значения [255]        0xFF

В INI секция [Ducking] содержит флаги вида:
  IN1AUX=true       IN2AUX=true
  IN1BT=true        IN2BT=true
  IN1OTGIN=true     IN2OTGIN=true
  IN1Playback1_2=true  IN2Playback1_2=true
  ... до Playback9_10

══════════ ГИПОТЕЗА ══════════

Маска — это набор битов, по одному на источник. Два байта могут
означать:
  A. 0x05 = источники для IN1, 0x06 = для IN2
  B. 0x05 = младшие 8 источников, 0x06 = старшие 8
  C. 0x05 и 0x06 вместе = 16-битная маска

Проверяем сопоставлением: читаем INI, считаем какие источники
включены, сравниваем с битами.

Запуск: python src/tools/decode-ducking-mask.py
"""

from __future__ import annotations

from pathlib import Path

INI = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main.ini"
)

# Порядок источников в маске — гипотеза. Соответствует порядку
# в MIXER_SOURCES / SOURCE_CODES.
SOURCES = [
    "PB12", "PB34", "PB56", "PB78",
    "IN1", "IN2",
    "AUX", "BT", "OTGIN",
    "PB910", "FX",
]

# как они называются в INI
INI_NAMES = {
    "PB12": "Playback1_2",
    "PB34": "Playback3_4",
    "PB56": "Playback5_6",
    "PB78": "Playback7_8",
    "IN1": None,   # IN1 не глушит сам себя
    "IN2": None,
    "AUX": "AUX",
    "BT": "BT",
    "OTGIN": "OTGIN",
    "PB910": "Playback9_10",
    "FX": None,
}


def read_ducking() -> dict[str, str]:
    out = {}
    cur = None
    if not INI.exists():
        return out
    for line in INI.read_text(encoding="utf-8-sig").splitlines():
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            cur = t[1:-1]
            continue
        if cur != "Ducking" or "=" not in t:
            continue
        k, _, v = t.partition("=")
        out[k.strip()] = v.strip()
    return out


def bits_of(v: int) -> str:
    return ", ".join(str(i) for i in range(8) if v & (1 << i)) or "—"


def main() -> None:
    d = read_ducking()
    if not d:
        raise SystemExit(f"не прочитать {INI}")

    print("=" * 68)
    print("СЕКЦИЯ [Ducking] В INI")
    print("=" * 68)

    on1, on2 = [], []
    for key, val in sorted(d.items()):
        if not key.startswith("IN"):
            continue
        yes = val.lower() == "true"
        side = "IN1" if key.startswith("IN1") else "IN2"
        src = key[3:]
        mark = "+" if yes else "-"
        print(f"  {mark} {key:<24} {val}")
        if yes:
            (on1 if side == "IN1" else on2).append(src)

    print(f"\n  включено для IN1: {len(on1)} — {', '.join(on1) or 'нет'}")
    print(f"  включено для IN2: {len(on2)} — {', '.join(on2) or 'нет'}")

    print("\n" + "=" * 68)
    print("НАБЛЮДЁННЫЕ ЗНАЧЕНИЯ МАСКИ")
    print("=" * 68)
    print("  0x43:0x05 = 224 (0xE0) или 255 (0xFF)")
    print("  0x43:0x06 = 255 (0xFF)")
    print(f"\n  биты 224: {bits_of(224)}")
    print(f"  биты 255: {bits_of(255)}")

    print("\n" + "=" * 68)
    print("ГИПОТЕЗЫ")
    print("=" * 68)
    print("""
  Если 0x43:06 = 255 всегда — это, вероятно, маска для IN2,
  и в текущем конфиге для IN2 включены все источники.

  Если 0x43:05 меняется между 224 и 255 — это маска для IN1,
  и разница в битах показывает, какие источники выключались.

  224 = 1110 0000 = биты 5,6,7
  255 = 1111 1111 = биты 0..7

  Разница: биты 0..4 гасились при 224 и горят при 255.

  Проверить: выключить в INI один флаг (например IN1AUX=false),
  запустить MCC под захватом, посмотреть какой бит сбросился.
  Требует админа для захвата.
""")

    # --- сопоставление по порядку ---
    print("=" * 68)
    print("СОПОСТАВЛЕНИЕ ПО ПОРЯДКУ (гипотеза)")
    print("=" * 68)
    print(f"  {'бит':<5} {'источник':<10} {'имя в INI':<16} {'включён (IN1)':<14} {'(IN2)'}")
    print(f"  {'-' * 5} {'-' * 10} {'-' * 16} {'-' * 14} {'-' * 10}")
    for i, src in enumerate(SOURCES[:8]):
        ini_name = INI_NAMES.get(src)
        if ini_name is None:
            a = b = "—"
        else:
            a = "+" if f"IN1{ini_name}" in on1 else "-"
            b = "+" if f"IN2{ini_name}" in on2 else "-"
        print(f"  {i:<5} {src:<10} {str(ini_name or '—'):<16} {a:<14} {b}")

    print("""
  Если значения в столбцах совпадают с битами маски — гипотеза верна.
  Для точного доказательства нужен захват при изменении одного флага.
""")


if __name__ == "__main__":
    main()
