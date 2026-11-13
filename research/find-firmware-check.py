r"""ГДЕ ПРОВЕРКА ЦЕЛОСТНОСТИ ПРОШИВКИ? ИЩЕМ В MCC.

══════════ ЧТО УЖЕ ИСКЛЮЧЕНО ══════════

• Драйвер `ToppingProUsbAudioks.sys` (55 032 байт) — чистый USB Audio
  класс-драйвер. Строк про прошивку/DFU/обновление: 0. Секции
  крошечные (.text 0x72C4), никакой логики обновления там нет.

Значит обновление прошивки делает ПРИЛОЖЕНИЕ M Control Center.

══════════ ЧТО ИЩЕМ ══════════

В MCC (20 МБ, Qt6) ищем:
  1. Строки про прошивку/DFU/обновление.
  2. Упоминания проверки: MD5/SHA/CRC/checksum/verify.
  3. Как называется файл прошивки и где он ожидается.
  4. Есть ли сравнение версий (V87.05…).

══════════ ВАЖНО ══════════

Наличие строки «MD5» не доказывает проверку целостности: она может
относиться к чему угодно. Поэтому печатаем КОНТЕКСТ каждой находки
(соседние строки), чтобы видеть, к чему она относится.

Запуск: python research/find-firmware-check.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MCC = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")

# слова, связанные с обновлением и проверкой
PATTERNS = {
    "firmware": re.compile(rb"[Ff]irmware|FIRMWARE"),
    "dfu": re.compile(rb"DFU|Dfu|dfu"),
    "update": re.compile(rb"[Uu]pdate|UPGRADE|[Uu]pgrade"),
    "hash": re.compile(rb"MD5|md5|SHA1|SHA256|sha256|[Cc]hecksum|CHECKSUM"),
    "verify": re.compile(rb"[Vv]erify|VERIFY|[Vv]erification"),
    "version": re.compile(rb"V87|V\d\d\.\d\d"),
    "binfile": re.compile(rb"\.bin|\.fw|\.hex|\.img"),
}

# для контекста берём кусок вокруг находки
CTX = 160


def main() -> None:
    if not MCC.exists():
        sys.exit(f"нет файла: {MCC}")
    data = MCC.read_bytes()
    print("=" * 74)
    print("ПОИСК ПРОВЕРКИ ЦЕЛОСТНОСТИ ПРОШИВКИ В MCC")
    print("=" * 74)
    print(f"файл: {MCC.name}  ({len(data)} байт)")

    def ctx_strings(pos: int) -> list[str]:
        """Печатные строки в окне вокруг позиции."""
        s = max(0, pos - CTX)
        e = min(len(data), pos + CTX)
        chunk = data[s:e]
        out = []
        for m in re.finditer(rb"[\x20-\x7e]{4,}", chunk):
            out.append(m.group().decode("latin1"))
        return out

    for name, pat in PATTERNS.items():
        print("\n" + "-" * 74)
        print(f"«{name}»")
        print("-" * 74)
        hits = []
        for m in pat.finditer(data):
            hits.append(m.start())
            if len(hits) > 4000:
                break
        print(f"  вхождений: {len(hits)}")
        if not hits:
            continue

        # уникальные контексты
        seen = set()
        shown = 0
        for pos in hits:
            strs = ctx_strings(pos)
            key = " | ".join(strs[:6])
            if key in seen:
                continue
            seen.add(key)
            # показываем только те, где есть слово про прошивку/проверку
            joined = " | ".join(strs)
            if name in ("firmware", "dfu", "hash", "verify"):
                print(f"  @0x{pos:06X}:")
                for s in strs[:8]:
                    print(f"      {s[:90]}")
                shown += 1
                if shown >= 8:
                    print("      … (обрезано)")
                    break
        if name in ("update", "version", "binfile") and shown == 0:
            # для частых слов — только первые 6 контекстов
            seen2 = set()
            cnt = 0
            for pos in hits:
                strs = ctx_strings(pos)
                key = " | ".join(strs[:4])
                if key in seen2:
                    continue
                seen2.add(key)
                print(f"  @0x{pos:06X}: {' | '.join(s[:60] for s in strs[:5])}")
                cnt += 1
                if cnt >= 6:
                    break

    # ─── отдельно: имена файлов прошивки ───
    print("\n" + "=" * 74)
    print("ИМЕНА ФАЙЛОВ ПРОШИВКИ")
    print("=" * 74)
    names = set()
    for m in re.finditer(rb"[\x20-\x7e]{3,60}\.(bin|fw|hex|img)", data):
        names.add(m.group().decode("latin1"))
    if names:
        for nm in sorted(names)[:30]:
            print(f"    {nm}")
    else:
        print("    не найдено")

    # ─── вывод ───
    print("\n" + "=" * 74)
    print("ВЫВОД")
    print("=" * 74)
    print("""
  Если в MCC есть строки про DFU и хеши — проверка целостности
  выполняется ПРИЛОЖЕНИЕМ, а не картой. Тогда карта может принимать
  любой образ, и модификация теоретически возможна (но рискованна:
  приложение не проверит, а карта может проверять сама).

  Если строк про проверку нет — вопрос остаётся открытым, и
  единственный безопасный путь: сравнить поведение при обновлении
  заведомо битым файлом (ОПАСНО, не делаем).
""")


if __name__ == "__main__":
    main()

