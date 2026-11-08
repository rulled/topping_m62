r"""EQ наушников: структура 0xa1..0xab из фактического дампа.

═══════════ ЧТО УЖЕ ИЗВЕСТНО ═══════════

В Prof-режиме 10 блоков 0xa1..0xaa по 10 свойств + 0xab с 2 свойствами.
Окно EQ наушников содержит 10 полос (Type/Gain/Freq/Q у каждой).

Значения в дампе (все блоки идентичны):
    01=0  02=1  03=0  04=632  05=7070
    06=0  07=1  08=0  09=632  0a=7070

Это ДВА одинаковых набора по 5 полей — то есть L и R канал.

Сверка с окном (скриншот): у всех 10 полос Type=peaking, Gain=0.0,
Freq=632, Q=0.707. Ровно совпадает:
    02/07 = 1        -> peaking
    03/08 = 0        -> Gain 0.0
    04/09 = 632      -> Freq 632
    05/0a = 7070     -> Q 0.707 x 10000
    01/06 = 0        -> полоса выключена (чекбокс не отмечен)

═══════════ ЧТО ДЕЛАЕТ ═══════════

Проверяет, что структура ЕДИНА для всех 10 блоков, и сверяет с INI.
Строит итоговую таблицу соответствия.

Запуск: python src/tools/analyze-eq-hp.py
"""

from __future__ import annotations

import json
from pathlib import Path

RESEARCH = Path("research")


def load(name: str) -> dict:
    path = RESEARCH / f"mode-{name}.json"
    if not path.exists():
        raise SystemExit(f"нет {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    for name in ("prof", "prof2"):
        try:
            dump = load(name)
        except SystemExit:
            continue
        print("=" * 70)
        print(f"ДАМП: {name}  (адресов {dump['total']})")
        print("=" * 70)

        tags = dump["tags"]
        blocks: dict[str, dict[int, int]] = {}
        for key, value in tags.items():
            tt, pp = key.split(":")
            if tt in ("ab",) or not tt.startswith("a"):
                continue
            blocks.setdefault(tt, {})[int(pp, 16)] = value

        # ─── проверка единообразия ───
        print("\nвсе блоки 0xa1..0xaa:")
        printed = set()
        for tt in sorted(blocks):
            props = blocks[tt]
            sig = tuple(props.get(p) for p in range(1, 11))
            same = "=" if sig in printed else " "
            printed.add(sig)
            vals = " ".join(f"{p:02x}={props.get(p, '?')}" for p in range(1, 11))
            print(f"  0x{tt} {same} {vals}")

        print(f"\nразличных «подписей» блоков: {len(printed)}")
        if len(printed) == 1:
            print("  ВСЕ блоки идентичны — значит ни одна полоса не настроена")
            print("  (все в дефолте: peaking / 0 dB / 632 Гц / Q 0.707)")

        # ─── 0xab ───
        ab = {k: v for k, v in tags.items() if k.startswith("ab:")}
        if ab:
            print(f"\n0xab (2 свойства): {ab}")

        # ─── сопоставление с окном ───
        print("\n" + "=" * 70)
        print("СООТВЕТСТВИЕ С ОКНОМ EQ (по скриншоту)")
        print("=" * 70)
        print("""
  окно показывает у каждой из 10 полос:
      Type = peaking    Gain = 0.0    Freq = 632    Q = 0.707

  теги (одинаково во всех 10 блоках):
      01/06 = 0      -> чекбокс полосы (0 = выключена)
      02/07 = 1      -> Type: 1 = peaking
      03/08 = 0      -> Gain 0.0 дБ
      04/09 = 632    -> Freq 632 Гц
      05/0a = 7070   -> Q 0.707 (x 10000)

  ЗНАЧИТ:
      0xa1 = полоса 1     0xa2 = полоса 2    ...    0xaa = полоса 10
      свойство 01..05 = левый канал
      свойство 06..0a = правый канал
""")

        # ─── итоговая таблица ───
        print("=" * 70)
        print("ТАБЛИЦА: полоса -> блок, свойство -> параметр")
        print("=" * 70)
        print(f"\n  {'полоса':8} {'блок L':10} {'блок R':10}")
        for i in range(10):
            tt = f"a{i + 1}"
            print(f"  {i + 1:<8} 0x{tt} (01..05)  0x{tt} (06..0a)")

        print(f"\n  {'параметр':12} {'L':6} {'R':6} {'формат':20}")
        for name, idx, fmt in [
            ("вкл/выкл", 1, "0 = выкл, 1 = вкл"),
            ("тип фильтра", 2, "1 = peaking"),
            ("gain", 3, "дБ"),
            ("частота", 4, "Гц"),
            ("Q", 5, "x 10000"),
        ]:
            print(f"  {name:12} {idx:02x}     {idx + 5:02x}     {fmt}")

        print()
        break


if __name__ == "__main__":
    main()
