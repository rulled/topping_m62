r"""Сравнение дампов режимов: что появляется и исчезает.

═══════════ ЗАЧЕМ ═══════════

Три режима M62 включают разные блоки. Дампы сохраняются dump-mode.js
в research/mode-<имя>.json. Этот скрипт показывает разницу:

    - какие семейства тегов есть только в одном режиме;
    - какие адреса появились/исчезли;
    - какие значения отличаются (для общих адресов).

═══════════ ЧТО УЖЕ ИЗВЕСТНО ═══════════

    Live       100 адресов  микшер + ducking + loopback + эффекты
    Mobile      95 адресов  БЕЗ микшера, БЕЗ ducking, БЕЗ loopback
    Prof        ?           EQ наушников на 6 полос (из workspace-INI)

Блоки 0xa1..0xaa не найдены ни в Live, ни в Mobile. Гипотеза: они в Prof,
потому что там есть EQ_HP (6 полос), которого нет в других режимах.

Запуск: python src/tools/compare-modes.py mobile live
        python src/tools/compare-modes.py live prof
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RESEARCH = Path("research")

# осмысленные имена семейств (по расшифрованным блокам)
FAMILY_NAMES = {
    "11": "настройки устройства",
    "12": "информация (версии)",
    "21": "вход IN1",
    "22": "вход IN2",
    "23": "вход AUX",
    "25": "вход BT",
    "27": "вход OTG",
    "31": "Mix A L",
    "32": "Mix A R",
    "33": "Mix B L",
    "34": "Mix B R",
    "35": "Mix C L",
    "36": "Mix C R",
    "37": "Mix D L",
    "38": "Mix D R",
    "39": "метры микшера",
    "3b": "Mix E L",
    "3c": "Mix E R",
    "43": "ducking",
    "44": "эффекты/FX",
    "45": "сцены",
    "46": "компрессор",
    "51": "loopback 1/2",
    "52": "loopback 1/2",
    "53": "loopback 3/4",
    "54": "loopback 3/4",
    "55": "loopback 5/6",
    "56": "loopback 5/6",
    "57": "loopback 7/8",
    "58": "loopback 7/8",
    "61": "OTG OUT L",
    "62": "OTG OUT R",
    "63": "HP L",
    "64": "HP R",
    "91": "EQ кан.1 полосы 1-2",
    "92": "EQ кан.1 полосы 3-4",
    "93": "EQ кан.2 полосы 1-2",
    "94": "EQ кан.2 полосы 3-4",
    "9b": "EQ метры/переключатели",
    "a1": "? блок a1",
    "a2": "? блок a2",
    "a3": "? блок a3",
}


def load(name: str) -> dict:
    path = RESEARCH / f"mode-{name}.json"
    if not path.exists():
        raise SystemExit(f"нет файла {path}. Сначала: node src/tools/dump-mode.js {name}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("использование: compare-modes.py <режим1> <режим2>")

    a_name, b_name = sys.argv[1], sys.argv[2]
    a = load(a_name)
    b = load(b_name)

    print("=" * 68)
    print(f"СРАВНЕНИЕ: {a_name.upper()} vs {b_name.upper()}")
    print("=" * 68)
    print(f"  {a_name}: {a['total']} адресов")
    print(f"  {b_name}: {b['total']} адресов")

    fa, fb = a["families"], b["families"]
    only_a = sorted(set(fa) - set(fb))
    only_b = sorted(set(fb) - set(fa))
    both = sorted(set(fa) & set(fb))

    print("\n" + "=" * 68)
    print(f"СЕМЕЙСТВА ТОЛЬКО В {a_name.upper()}")
    print("=" * 68)
    if not only_a:
        print("  нет")
    for tt in only_a:
        nm = FAMILY_NAMES.get(tt, "?")
        print(f"  0x{tt}: {fa[tt]} тегов   {nm}")

    print("\n" + "=" * 68)
    print(f"СЕМЕЙСТВА ТОЛЬКО В {b_name.upper()}")
    print("=" * 68)
    if not only_b:
        print("  нет")
    for tt in only_b:
        nm = FAMILY_NAMES.get(tt, "?")
        print(f"  0x{tt}: {fb[tt]} тегов   {nm}")

    print("\n" + "=" * 68)
    print("ОБЩИЕ СЕМЕЙСТВА — где меняется количество тегов")
    print("=" * 68)
    diffs = [(tt, fa[tt], fb[tt]) for tt in both if fa[tt] != fb[tt]]
    if not diffs:
        print("  все совпадают по количеству")
    for tt, na, nb in diffs:
        nm = FAMILY_NAMES.get(tt, "?")
        print(f"  0x{tt}: {a_name} {na} -> {b_name} {nb}   {nm}")

    # ─── конкретные адреса ───
    ta = a["tags"]
    tb = b["tags"]
    addr_only_a = sorted(set(ta) - set(tb))
    addr_only_b = sorted(set(tb) - set(ta))

    print("\n" + "=" * 68)
    print(f"АДРЕСА ТОЛЬКО В {a_name.upper()} (первые 25)")
    print("=" * 68)
    if not addr_only_a:
        print("  нет")
    for k in addr_only_a[:25]:
        print(f"  {k} = {ta[k]}")
    if len(addr_only_a) > 25:
        print(f"  ... ещё {len(addr_only_a) - 25}")

    print("\n" + "=" * 68)
    print(f"АДРЕСА ТОЛЬКО В {b_name.upper()} (первые 25)")
    print("=" * 68)
    if not addr_only_b:
        print("  нет")
    for k in addr_only_b[:25]:
        print(f"  {k} = {tb[k]}")
    if len(addr_only_b) > 25:
        print(f"  ... ещё {len(addr_only_b) - 25}")

    # ─── что ищем ───
    print("\n" + "=" * 68)
    print("ПОИСК БЛОКА 0xa1..0xaa")
    print("=" * 68)
    for nm, data in ((a_name, ta), (b_name, tb)):
        hits = [k for k in data if k.startswith("a")]
        print(f"  {nm}: {len(hits)} адресов" + (f" ({', '.join(hits[:8])})" if hits else ""))


if __name__ == "__main__":
    main()
