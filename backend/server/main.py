"""Минимальный ASGI-бэкенд «мирКода».

Умеет три вещи: раздавать собранный фронтенд, отвечать на проверку
живости и принимать прохождения уровней (см. server/attempts.py). Базы
и аккаунтов ещё нет — прохождения лежат в файле, а статистика по ним
закрыта одним общим паролем.

Почему Starlette. Выбор между FastAPI и Django мы отложили до момента,
когда станет понятна тяжесть кабинета школы. Starlette — это фундамент,
на котором построен сам FastAPI, поэтому переход на него позже сводится
к замене класса приложения, а не к переписыванию. Django в любом случае
был бы отдельной историей.
"""

from __future__ import annotations

import os
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from server.attempts import PasswordGate, delete_attempt, list_attempts, record_attempt
from server.static_files import BuiltAssets

# Раскладку задаёт пресет Python ASGI на хостинге: код лежит в app/,
# статика в www/, и оба каталога — в корне сайта. От server/main.py это
# два уровня вверх.
#
# Локально сборка живёт в frontend/dist, поэтому там путь передаётся
# переменной STATIC_DIR. На сервере переменные задаются файлами в
# etc/environment/ — файл на переменную, имя файла и есть имя переменной.
DEFAULT_STATIC = Path(__file__).resolve().parents[2] / "www"
STATIC_DIR = Path(os.environ.get("STATIC_DIR", DEFAULT_STATIC))


async def health(request: Request) -> JSONResponse:
    """Проверка после деплоя: приложение поднялось и видит фронтенд."""
    return JSONResponse(
        {
            "status": "ok",
            "static_dir": str(STATIC_DIR),
            "static_ready": (STATIC_DIR / "index.html").is_file(),
        }
    )


routes = [
    Route("/health", health),
    Route("/api/attempts", record_attempt, methods=["POST"]),
    # Под /stats/ — чтобы браузер слал пароль, спрошенный на странице
    Route("/stats/data", list_attempts),
    Route("/stats/data/{id}", delete_attempt, methods=["DELETE"]),
]

# Монтируем последним: Mount на "/" перехватывает всё, что не разобрали выше.
# html=True отдаёт index.html для каталога, поэтому "/" работает само.
if STATIC_DIR.is_dir():
    routes.append(Mount("/", app=BuiltAssets(directory=STATIC_DIR, html=True), name="static"))

app = Starlette(routes=routes, middleware=[Middleware(PasswordGate)])
