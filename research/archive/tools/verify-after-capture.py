r"""ПРОВЕРКА ПОСЛЕ ТЕСТА: INI против эталона, устройство против INI.

══════════ ЗАЧЕМ ══════════

После capture-source-codes.ps1 в Prof-INI были тестовые значения.
Файл восстановлен, но остаются два риска:

  1. MCC (запущенный захватом от админа) держит ТЕСТОВЫЕ значения
     в памяти. Если он запишет файл при выходе — затрёт восстановление.
  2. Устройство получило тестовые значения при старте MCC и живёт
     с ними, пока MCC не перезапустится и не отправит файл заново.

Скрипт отвечает на оба вопроса. Ничего не пишет.

Запуск: python src/tools/verify-after-capture.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

PROF_INI = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Prof"
    r"\M62_Prof_2026-1009-2347-04.ini"
)
BACKUP = Path("research/prof-ini-backup.ini")

# слот -> (источник, который ДОЛЖЕН быть)
EXPECTED = {
    "Loopback_LB12": "IN 1",
    "Loopback_LB34": "Mix A",
    "Loopback_LB56": "Mix A",
    "Loopback_LB78": "Mix A",
    "Output_HP": "Playback 1/2",
    "Output_OTGOUT": "Mix A",
}

# тестовые значения — их быть НЕ должно
TEST_VALUES = {
    "Loopback_LB12": "Mix B",
    "Loopback_LB34": "Mix C",
    "Loopback_LB56": "IN 1+2",
    "Loopback_LB78": "OTG IN",
    "Output_HP": "Playback 5/6",
    "Output_OTGOUT": "Playback 7/8",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def read_sections(path: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    cur = None
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            cur = t[1:-1]
            out[cur] = {}
        elif cur and t and "=" in t:
            k, _, v = t.partition("=")
            out[cur][k.strip()] = v.strip()
    return out


def mcc_running() -> bool:
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process -Name 'M Control Center' -ErrorAction SilentlyContinue | "
             "Select-Object -First 1 -ExpandProperty Id"],
            capture_output=True, text=True, timeout=20,
        )
        return bool(r.stdout.strip())
    except Exception:
        return False


def main() -> int:
    print("=" * 70)
    print("1. ФАЙЛ INI")
    print("=" * 70)

    if not PROF_INI.exists():
        print(f"  НЕТ ФАЙЛА: {PROF_INI}")
        return 1
    if not BACKUP.exists():
        print(f"  НЕТ ЭТАЛОНА: {BACKUP}")
        return 1

    same = sha(PROF_INI) == sha(BACKUP)
    print(f"  текущий:     {sha(PROF_INI)}")
    print(f"  эталон:      {sha(BACKUP)}")
    print(f"  совпадает:   {'ДА' if same else 'НЕТ'}")

    secs = read_sections(PROF_INI)
    bad = []
    print("\n  источники в файле:")
    for sec, want in EXPECTED.items():
        got = secs.get(sec, {}).get("AudioSource", "?")
        mark = "OK" if got == want else "ТЕСТОВОЕ!"
        if got != want:
            bad.append(f"{sec}: {got} (ожидали {want})")
        print(f"    {sec:<18} {got:<16} {mark}")

    print("\n  mute в файле:")
    for sec in EXPECTED:
        m = secs.get(sec, {}).get("MUTE", "?")
        flag = "  <- заглушено (тестовое)" if m.lower() in ("true", "1") else ""
        print(f"    {sec:<18} MUTE={m}{flag}")

    print()
    print("=" * 70)
    print("2. MCC")
    print("=" * 70)
    running = mcc_running()
    if running:
        print("  MCC РАБОТАЕТ.")
        print("  Он запущен захватом от администратора и держит ТЕСТОВЫЕ")
        print("  значения в памяти. Наш процесс его убить не может (UIPI).")
        print()
        print("  Что сделать: закрыть через трей (правый клик -> Выход),")
        print("  затем проверить файл ещё раз этим же скриптом.")
        print("  Если файл окажется испорчен — restore.")
    else:
        print("  MCC не запущен — файл никто не перезапишет.")

    print()
    print("=" * 70)
    print("3. УСТРОЙСТВО")
    print("=" * 70)
    try:
        r = subprocess.run(
            ["node", "src/tools/device-outputs.js"],
            capture_output=True, text=True, timeout=90,
        )
        for line in r.stdout.splitlines():
            if line.strip():
                print("  " + line)
    except Exception as e:
        print(f"  не удалось прочитать: {e}")

    print()
    print("=" * 70)
    print("ВЕРДИКТ")
    print("=" * 70)
    if bad:
        print("  ФАЙЛ ИСПОРЧЕН — тестовые значения вернулись:")
        for b in bad:
            print(f"    {b}")
        print("\n  Верни эталон:")
        print("    python src/tools/one-shot-source-codes.py restore")
        return 1

    if same:
        print("  Файл в порядке — совпадает с эталоном.")
    else:
        print("  Файл отличается от эталона, но источники правильные.")
        print("  Возможно, MCC обновил только служебные поля (NeedSync и т.п.).")

    if running:
        print("  Но MCC ещё работает — закрой его и проверь снова.")
        return 2

    print("  MCC закрыт, файл правильный.")
    print("\n  Чтобы устройство тоже вернулось к этим значениям —")
    print("  запусти MCC обычным способом: он при старте отправит файл в устройство.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
