"""Минимальный ASGI-бэкенд «мирКода».

Пока он умеет ровно две вещи: раздавать собранный фронтенд и отвечать на
проверку живости. Ни базы, ни моделей, ни авторизации здесь ещё нет —
они появятся, когда появится, что хранить.

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
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

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
]

# Монтируем последним: Mount на "/" перехватывает всё, что не разобрали выше.
# html=True отдаёт index.html для каталога, поэтому "/" работает само.
if STATIC_DIR.is_dir():
    routes.append(Mount("/", app=BuiltAssets(directory=STATIC_DIR, html=True), name="static"))

app = Starlette(routes=routes)
