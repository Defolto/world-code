"""Раздача собранного фронтенда с правильными заголовками кэша.

Зачем отдельный модуль ради двух заголовков: у хостинга нет CDN, а рядом
со сборкой скоро ляжет Pyodide — семь мегабайт wasm, которые ребёнок не
должен качать на каждом входе в урок. Единственный способ этого избежать —
чтобы браузер и Service Worker знали, что файл с хэшем в имени неизменен.

Правило простое:

* имя содержит хэш сборки (assets/index-BMxiUNYd.js) — файл неизменен,
  кэшируем на год и не перепроверяем;
* всё остальное, и в первую очередь index.html, — перепроверяем всегда,
  иначе после деплоя пользователь останется на старой версии и будет
  тянуть из кэша ссылки на файлы, которых уже нет.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from starlette.responses import Response
from starlette.staticfiles import StaticFiles

# Vite кладёт в имя восьмизначный хэш содержимого: index-BMxiUNYd.js
HASHED_NAME = re.compile(r"-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$")

YEAR = 60 * 60 * 24 * 365


class BuiltAssets(StaticFiles):
    """StaticFiles, который сам решает, что кэшировать навсегда."""

    def file_response(
        self,
        full_path: Any,
        stat_result: Any,
        scope: Any,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)

        name = Path(str(full_path)).name
        if HASHED_NAME.search(name):
            response.headers["Cache-Control"] = f"public, max-age={YEAR}, immutable"
        else:
            # no-cache — это не «не кэшировать», а «кэшировать, но каждый раз
            # спрашивать, не изменилось ли». Отдаётся 304, трафика почти нет.
            response.headers["Cache-Control"] = "no-cache"

        return response
