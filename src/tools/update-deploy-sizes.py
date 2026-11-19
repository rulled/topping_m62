r"""Обновить таблицу производительности в docs/DEPLOY.md по факту.

═══════════ ЗАЧЕМ ═══════════

В DEPLOY.md была таблица размеров: «/web/app.js 48 625, brotli 11
515, вся страница 132 513 -> 36 556». После переноса страницы в
корень и нескольких правок числа разъехались с реальностью.

Документация с неверными числами хуже отсутствующей: по ней
планируют бюджет загрузки.

═══════════ КАК СЧИТАЕТСЯ ═══

Поднимается настоящий static-server на свободном порту, файлы
запрашиваются с Accept-Encoding: br, размеры берутся из ответа.
Никаких оценок «на глаз».

Запуск: python src/tools/update-deploy-sizes.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEPLOY = ROOT / "docs" / "DEPLOY.md"

PORT = 8231
PATHS = ["/", "/app.js", "/src/transport-core.js"]


def fetch(path: str, brotli: bool) -> tuple[int, int]:
    """Вернуть (сырой размер, сжатый размер) для пути."""
    headers = {"Accept-Encoding": "br"} if brotli else {}

    def get(hdrs: dict[str, str]) -> int:
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", headers=hdrs)
        with urllib.request.urlopen(req, timeout=10) as r:
            return int(r.headers.get("content-length") or len(r.read()))

    return get({}), get(headers)


def main() -> int:
    # Поднять сервер.
    env = {**__import__("os").environ, "PORT": str(PORT)}
    proc = subprocess.Popen(
        ["node", "src/static-server.js"],
        cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2)

    try:
        rows = []
        total_raw = 0
        total_br = 0
        for path in PATHS:
            raw, br = fetch(path, True)
            rows.append((path, raw, br))
            total_raw += raw
            total_br += br
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    def fmt(n: int) -> str:
        return f"{n:,}".replace(",", " ")

    table = [
        "| файл | без сжатия | brotli |",
        "|---|---|---|",
    ]
    for path, raw, br in rows:
        name = "`/` (HTML)" if path == "/" else f"`{path}`"
        table.append(f"| {name} | {fmt(raw)} | {fmt(br)} |")
    table.append(f"| **вся страница** | **{fmt(total_raw)}** | **{fmt(total_br)}** |")

    text = DEPLOY.read_text(encoding="utf-8")

    # Заменить старую таблицу целиком (она начинается с заголовка).
    pattern = re.compile(
        r"\| файл \| без сжатия \| brotli \|\n\|---\|---\|---\|\n(?:\|.*\n)+"
    )
    if not pattern.search(text):
        print("ОШИБКА: не найдена таблица размеров в DEPLOY.md")
        return 1

    savings = round((1 - total_br / total_raw) * 100) if total_raw else 0
    new_block = "\n".join(table) + "\n"
    text = pattern.sub(new_block, text, count=1)

    # Поправить фразу про экономию.
    text = re.sub(
        r"Экономия \d+%\.",
        f"Экономия {savings}%.",
        text,
        count=1,
    )

    DEPLOY.write_text(text, encoding="utf-8")

    print("таблица обновлена:")
    for path, raw, br in rows:
        print(f"  {path:<26} {fmt(raw):>8} -> {fmt(br):>7}")
    print(f"  ИТОГО{'':<21} {fmt(total_raw):>8} -> {fmt(total_br):>7}  ({savings}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
