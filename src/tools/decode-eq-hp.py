r"""Загадочные блоки 0xa1..0xab из Prof-режима — расшифровка.

═══════════ ЧТО НАШЛОСЬ ═══════════

В Prof-режиме устройство отдаёт 174 адреса вместо 100 в Live. Разница:

    0xa1 .. 0xaa    10 блоков по 10 свойств = 100 тегов
    0xab            2 тега

Это НЕ приходило ни в Live, ни в Mobile. Именно то, что мы искали
два месяца.

═══════════ ГЛАВНАЯ ГИПОТЕЗА ═══════════

В Prof-режиме есть EQ НАУШНИКОВ на 6 полос (секция [EQ_HP] в INI).
В workspace-INI там:
    Eq%401=0|9|35|0.5395|1
    Eq%402=0|-4.5|258|0.707|1
    ...
    Eq%406=0|5|14159|1.1642|1

Значит 6 полос. Если 0xa1..0xaa это EQ наушников, то:
    либо 10 блоков = 10 полос (а в INI видно 6 — остальные 4 пустые)
    либо 10 блоков = что-то другое

Проверяем: значения полей 4 и 5 в INI это freq и Q. Ищем их среди
значений тегов.

═══════════ ЧТО ДЕЛАЕТ ═══════════

1. Читает [EQ_HP] из активного Prof-workspace.
2. Считает ожидаемые Q25-значения из частот и Q.
3. Ищет совпадения среди тегов 0xa1..0xab.
4. Печатает структуру блоков.

Запуск: python src/tools/decode-eq-hp.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

RESEARCH = Path("research")
WS_ROOT = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Prof"
)

# поля EQ-полосы в INI: enabled|gain|freq|q|something
INI_EQ_FIELDS = ["enabled", "gain", "freq", "q", "flag"]


def find_ini() -> Path | None:
    cands = sorted(WS_ROOT.glob("M62_Prof_*.ini"))
    return cands[-1] if cands else None


def read_section(path: Path, name: str) -> dict[str, str]:
    txt = path.read_text(encoding="utf-8-sig")
    out: dict[str, str] = {}
    cur = None
    for line in txt.splitlines():
        t = line.strip()
        if t.startswith("["):
            cur = t[1:-1]
            continue
        if cur != name or not t:
            continue
        eq = t.find("=")
        if eq > 0:
            out[t[:eq].strip()] = t[eq + 1 :].strip()
    return out


def main() -> None:
    dump_path = RESEARCH / "mode-prof.json"
    if not dump_path.exists():
        raise SystemExit(f"нет файла {dump_path}. Сначала: node src/tools/dump-mode.js prof")
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    tags = dump["tags"]

    print("=" * 70)
    print("ТЕГИ 0xa1..0xab ИЗ PROF-РЕЖИМА")
    print("=" * 70)

    # группируем по блоку
    blocks: dict[str, dict[int, int]] = {}
    for key, value in tags.items():
        tt, pp = key.split(":")
        if not tt.startswith("a"):
            continue
        blocks.setdefault(tt, {})[int(pp, 16)] = value

    for tt in sorted(blocks):
        props = blocks[tt]
        vals = " ".join(f"{p:02x}={props[p]}" for p in sorted(props))
        print(f"  0x{tt}: {vals}")

    # ─── сверка с EQ_HP из INI ───
    ini = find_ini()
    if not ini:
        print("\nINI Prof не найден")
        return

    print(f"\nINI: {ini.name}")
    hp = read_section(ini, "EQ_HP")

    print("\n" + "=" * 70)
    print("EQ_HP ИЗ INI")
    print("=" * 70)
    bands = []
    for i in range(1, 11):
        raw = hp.get(f"Eq%40{i}")
        if not raw:
            continue
        parts = raw.split("|")
        rec = {"band": i, "raw": raw}
        if len(parts) >= 5:
            rec["enabled"] = parts[0]
            rec["gain"] = parts[1]
            rec["freq"] = parts[2]
            rec["q"] = parts[3]
            rec["flag"] = parts[4]
        bands.append(rec)
        print(f"  полоса {i}: {raw}")

    print(f"\n  полос в INI: {len(bands)}")
    for k in ("Switch", "GainOutput", "EQStateSource", "EQStateTarget",
              "EQStateEachFilter", "EQStateCombined", "EQStateFiltered",
              "EQFilteredType"):
        if k in hp:
            print(f"  {k} = {hp[k]}")

    # ─── поиск частот и Q ───
    print("\n" + "=" * 70)
    print("ПОИСК ЗНАЧЕНИЙ ИЗ INI СРЕДИ ТЕГОВ")
    print("=" * 70)

    all_values: dict[int, list[str]] = {}
    for tt, props in blocks.items():
        for p, v in props.items():
            all_values.setdefault(v, []).append(f"0x{tt}:{p:02x}")

    for b in bands:
        freq = b.get("freq")
        q = b.get("q")
        print(f"\n  полоса {b['band']}: freq={freq} q={q}")
        if freq:
            try:
                fv = int(float(freq))
            except ValueError:
                fv = None
            if fv is not None:
                hits = all_values.get(fv, [])
                print(f"    freq {fv} как есть: {hits if hits else 'нет'}")
        if q:
            try:
                qv = int(round(float(q) * 10000))
            except ValueError:
                qv = None
            if qv is not None:
                hits = all_values.get(qv, [])
                print(f"    q x10000 = {qv}: {hits if hits else 'нет'}")

    # ─── распределение значений по блокам ───
    print("\n" + "=" * 70)
    print("КАКИЕ СВОЙСТВА В КАКОМ БЛОКЕ (сводка)")
    print("=" * 70)
    for tt in sorted(blocks):
        props = blocks[tt]
        nz = [p for p in sorted(props) if props[p]]
        print(f"  0x{tt}: {len(props)} свойств, ненулевых {len(nz)} -> {[f'{p:02x}' for p in nz]}")


if __name__ == "__main__":
    main()
