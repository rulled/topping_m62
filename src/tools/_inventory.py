r"""ИНВЕНТАРИЗАЦИЯ src/tools — строгая версия.

═══════════ ПОЧЕМУ ПЕРЕПИСАНО ═══════════

Первая версия считала ACTIVE всё, что упомянуто в документации.
Результат: 412 «активных» из 543 — то есть фильтр не работал.
Причина: NOTES.md (568 КБ) упоминает почти каждый скрипт, который
когда-либо запускался. Упоминание в истории ≠ нужность сейчас.

═══════════ НОВЫЙ ПРИНЦИП ═══════════

ACTIVE — только то, что входит в ОДИН из списков:

  1. РЕГРЕССИЯ — тесты и проверки, которые прогоняются сейчас
     (перечислены в docs/WEB-CLIENT.md §10 и в аудитах).
  2. ОБСЛУЖИВАНИЕ — скрипты, нужные для работы сервиса
     (selftest, probe, e2e, autonomy).
  3. ДОКАЗАТЕЛЬСТВА НА КАРТЕ — prove-*, которые прогоняются заново
     при изменении протокола.
  4. ИНСТРУМЕНТЫ РЕВЕРСА — аудиты и анализаторы, которые ещё нужны
     (прошивка, USB, захваты).

Всё остальное — HISTORY: результат уже зафиксирован в документации,
скрипт одноразовый.

Запуск: python src/tools/_inventory.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TOOLS = ROOT / "src" / "tools"

# ═══ 1. РЕГРЕССИЯ: прогоняется в docs/WEB-CLIENT.md §10 ═══
REGRESSION = {
    "test-transport-core.js",
    "test-ui-frames.js",
    "test-browser-modules.js",
    "test-robustness.js",
    "test-scenes.js",
    "test-gain-scales.js",
    "test-mutes-loopback.js",
    "check-page-script.js",
    "check-page-render.js",
    "audit-docs.js",
    "e2e-write-test.js",
    "autonomy-behaviour.js",
}

# ═══ 2. ОБСЛУЖИВАНИЕ / базовые инструменты ═══
SERVICE = {
    "selftest.js",
    "listen.js",
    "session.js",
    "feature-matrix.js",
    "verify-coverage.js",
    "autonomy-audit.js",
    # зависимости сервера — не инструменты, но обязаны быть здесь
    "uia.js",
    "uia-helpers.js",
}

# ═══ 3. ДОКАЗАТЕЛЬСТВА НА КАРТЕ (перепроверяются) ═══
PROOFS = {
    "prove-eq-in2-live.js",
    "prove-eq-hp-live.js",
    "prove-mutes-loopback-live.js",
    "prove-announce-eq-rule.js",
    "prove-readviaDump-truth.js",
    "prove-handshake-timing.js",
    "probe-meters-live.js",
    "probe-meters-exact.js",
    "probe-mode-dump.js",
    "probe-mode-code.js",
    "probe-prof-dump.js",
    "prove-eq-prof-mode.js",
}

# ═══ 4. ИНСТРУМЕНТЫ РЕВЕРСА (нужны сейчас) ═══
REVERSE = {
    # прошивка
    "firmware-entropy.py",
    "firmware-copies.py",
    "firmware-subimages.py",
    "firmware-strings.py",
    "firmware-arch.py",
    "firmware-transforms.py",
    "firmware-positive-control.py",
    "firmware-metric.py",
    "firmware-validity.py",
    "firmware-disasm.py",
    "compare-xmos-format.py",
    "analyze-xmos-structure.py",
    "magic-context.py",
    "compare-mnemonic-profiles.py",
    # USB / протокол
    "audit-usb-descriptor.py",
    "audit-usb-interfaces.js",
    "audit-mixer-in-captures.py",
    "audit-eq-in-captures.js",
}

ACTIVE = REGRESSION | SERVICE | PROOFS | REVERSE


def main() -> int:
    if not TOOLS.exists():
        print(f"нет каталога: {TOOLS}")
        return 1

    files = sorted(p.name for p in TOOLS.iterdir() if p.is_file())
    active = [n for n in files if n in ACTIVE]
    history = [n for n in files if n not in ACTIVE and not n.startswith("_")]

    # Проверяем, что все заявленные ACTIVE реально существуют
    missing = sorted(a for a in ACTIVE if a not in files)

    print("=" * 74)
    print("ИНВЕНТАРИЗАЦИЯ src/tools (строгая)")
    print("=" * 74)
    print(f"\n  всего файлов:      {len(files)}")
    print(f"  ACTIVE:            {len(active)}")
    print(f"  HISTORY:           {len(history)}")
    if missing:
        print(f"\n  ⚠ заявлены, но НЕ НАЙДЕНЫ ({len(missing)}):")
        for m in missing:
            print(f"      {m}")

    print("\n" + "-" * 74)
    print("ACTIVE — оставить в src/tools")
    print("-" * 74)

    def show(title, group):
        items = sorted(n for n in group if n in files)
        if not items:
            return
        print(f"\n  {title} ({len(items)})")
        for n in items:
            print(f"    {n}")

    show("Регрессия", REGRESSION)
    show("Обслуживание", SERVICE)
    show("Доказательства на карте", PROOFS)
    show("Инструменты реверса", REVERSE)

    print("\n" + "-" * 74)
    print(f"HISTORY — в архив ({len(history)})")
    print("-" * 74)
    for n in history[:30]:
        print(f"    {n}")
    if len(history) > 30:
        print(f"    ... ещё {len(history) - 30}")

    # Сохраняем списки для перемещения
    out = ROOT / "research" / "tools-inventory.txt"
    with out.open("w", encoding="utf-8") as fh:
        fh.write("# ACTIVE\n")
        for n in sorted(active):
            fh.write(f"{n}\n")
        fh.write("\n# HISTORY\n")
        for n in sorted(history):
            fh.write(f"{n}\n")
    print(f"\n  списки записаны: {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

