"""Запись попыток пройти уровень и просмотр их под паролем.

Зачем. Уровни делает методист, а проходят дети, и единственный способ
узнать, что уровень слишком простой или, наоборот, ломает всех подряд, —
смотреть, как его проходили: сколько запусков, какие ошибки, сколько
времени, какой код в итоге. Попытка уезжает при победе — и при уходе
со страницы без победы (`passed: false`): брошенный уровень говорит о
проблеме громче пройденного. Аккаунтов и базы ещё нет, поэтому запись
приходит как есть и дописывается строкой в файл.

Формат хранения — JSON Lines: одна строка на одно прохождение. Файл
просто дописывается, его можно читать `tail -f`, а переезд в базу — это
один скрипт «прочитать построчно и вставить». Файл лежит в DATA_DIR,
которую деплой не трогает (он заменяет только app/ и www/).

Пароль — переменная STATS_PASSWORD; на сервере это файл
etc/environment/STATS_PASSWORD. Без неё страница статистики закрыта
совсем: лучше «недоступно», чем открытый список детских работ.
Схема — HTTP Basic: браузер спрашивает пароль на входе в /stats/ и сам
подставляет его в запросы страницы за данными, логин-формы и сессий не
нужно. Данные поэтому лежат под тем же путём — /stats/data: браузер
подставляет пароль наперёд только для адресов «под» тем, где его
спросили. Сам /stats/data на 401 браузеру пароль не предлагает
спрашивать (нет WWW-Authenticate): иначе в деве, где страницу отдаёт
Vite без пароля, fetch за данными открывал бы родное окно Chrome, а
при отмене падал бы «Failed to fetch». Вместо этого 401 ловит страница
и показывает своё поле.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import secrets
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

DEFAULT_DATA = Path(__file__).resolve().parents[2] / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", DEFAULT_DATA))
ATTEMPTS_FILE = DATA_DIR / "attempts.jsonl"

# Откуда страница статистики берёт записи и куда шлёт удаление
DATA_PATH = "/stats/data"

# Один прогон с кодом весит килобайты; десять прогонов — десятки. Лимит
# в четверть мегабайта — защита от случайного цикла на клиенте, а не от
# злоумышленника
MAX_BODY = 256 * 1024

# Что должно быть в записи, чтобы по ней вообще можно было что-то понять.
# Остальные поля клиент волен добавлять — сервер их не интерпретирует
REQUIRED = {"level": str, "student": str, "runs": list, "code": str, "passed": bool}


async def record_attempt(request: Request) -> Response:
    """POST /api/attempts — дописать одну попытку."""
    body = await request.body()
    if len(body) > MAX_BODY:
        return PlainTextResponse("Слишком большая запись", status_code=413)
    try:
        data = json.loads(body)
    except ValueError:
        return PlainTextResponse("Ожидался JSON", status_code=400)
    if not isinstance(data, dict) or any(
        not isinstance(data.get(key), kind) for key, kind in REQUIRED.items()
    ):
        return PlainTextResponse(f"Нужны поля: {', '.join(REQUIRED)}", status_code=400)

    # Время ставит сервер: часам на детских ноутбуках веры нет
    data["received_at"] = datetime.now(UTC).isoformat(timespec="seconds")

    ATTEMPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii=False — файл читают люди, и русский текст ошибок
    # в нём должен быть русским, а не \u-последовательностями
    line = json.dumps(data, ensure_ascii=False) + "\n"
    with ATTEMPTS_FILE.open("a", encoding="utf-8") as f:
        f.write(line)
    return Response(status_code=204)


def line_id(raw: str) -> str:
    """Идентификатор записи — хэш её строки в файле.

    Своего id у записи нет: он не нужен ни клиенту, ни файлу, а хэш
    строки есть у любой записи, включая уже накопленные. Страница
    удаляет по нему, и сервер вычёркивает строку с тем же хэшем.
    """
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def read_lines() -> list[str]:
    """Строки файла как есть, без пустых. Битая строка (оборванная
    запись при падении процесса) остаётся — её отсеет read_attempts."""
    if not ATTEMPTS_FILE.is_file():
        return []
    with ATTEMPTS_FILE.open(encoding="utf-8") as f:
        return [raw.strip() for raw in f if raw.strip()]


def read_attempts() -> list[dict]:
    """Все записи по порядку, каждая с полем id. Битая строка
    пропускается, а не роняет всю страницу."""
    result: list[dict] = []
    for raw in read_lines():
        try:
            item = json.loads(raw)
        except ValueError:
            continue
        if isinstance(item, dict):
            result.append({**item, "id": line_id(raw)})
    return result


async def list_attempts(request: Request) -> Response:
    """GET /stats/data — все попытки, для страницы статистики."""
    return JSONResponse(read_attempts())


async def delete_attempt(request: Request) -> Response:
    """DELETE /stats/data/{id} — вычеркнуть одну попытку.

    Файл переписывается целиком во временный рядом и подменяется
    os.replace — атомарно, читатель не увидит полуфайла. Запись, которая
    придёт ровно в момент подмены, может потеряться; для тренажёра на
    один процесс это не стоит блокировок.
    """
    wanted = request.path_params["id"]
    lines = read_lines()
    kept = [raw for raw in lines if line_id(raw) != wanted]
    if len(kept) == len(lines):
        return PlainTextResponse("Нет такой записи", status_code=404)

    fd, tmp = tempfile.mkstemp(dir=ATTEMPTS_FILE.parent, prefix=".attempts-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.writelines(raw + "\n" for raw in kept)
    os.replace(tmp, ATTEMPTS_FILE)
    return Response(status_code=204)


class PasswordGate:
    """Закрывает страницу статистики и её данные HTTP Basic-паролем.

    Чистое ASGI middleware, а не BaseHTTPMiddleware: тот оборачивает
    ответ в поток, и статика с ним отдаётся заметно медленнее.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def guarded(scope: Scope) -> bool:
        """Что закрываем: страницу статистики и данные для неё."""
        path: str = scope["path"]
        return path == "/stats" or path.startswith("/stats/")

    @staticmethod
    def allowed(scope: Scope, password: str) -> bool:
        for name, value in scope["headers"]:
            if name != b"authorization":
                continue
            scheme, _, credentials = value.partition(b" ")
            if scheme.lower() != b"basic":
                return False
            try:
                decoded = base64.b64decode(credentials, validate=True).decode()
            except (binascii.Error, UnicodeDecodeError):
                return False
            # Логин любой: пароль один на всех, кто смотрит статистику
            _, _, given = decoded.partition(":")
            return secrets.compare_digest(given.encode(), password.encode())
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.guarded(scope):
            await self.app(scope, receive, send)
            return
        # Читаем на каждый запрос, а не на импорте: так тесты и смена
        # пароля обходятся без перезапуска
        password = os.environ.get("STATS_PASSWORD", "")
        if password and self.allowed(scope, password):
            await self.app(scope, receive, send)
            return
        response: Response
        if not password:
            response = PlainTextResponse(
                "Статистика выключена: на сервере не задан STATS_PASSWORD", status_code=503
            )
        elif scope["path"].startswith(DATA_PATH):
            # Без WWW-Authenticate: пароль для данных спрашивает страница
            response = PlainTextResponse("Нужен пароль", status_code=401)
        else:
            response = PlainTextResponse(
                "Нужен пароль",
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="mirkod-stats", charset="UTF-8"'},
            )
        await response(scope, receive, send)
