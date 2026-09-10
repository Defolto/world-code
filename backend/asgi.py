"""Точка входа для хостинга.

Панели разных хостеров ищут объект приложения под разными именами:
где-то это `app`, где-то `application`. Экспортируем оба, чтобы не гадать
и не ловить «ASGI application not found» после первого же деплоя.

Путь к модулю при этом один: asgi:app или asgi:application.
"""

from app.main import app

application = app

__all__ = ["app", "application"]
