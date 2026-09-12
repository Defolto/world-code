# мирКод

Русский аналог CodeCombat на настоящем Python: ребёнок пишет код в браузере,
персонаж выполняет команды по одной, с подсветкой текущей строки.
Продаётся независимым ИТ-школам как готовый учебный год под ключ.

## Документы

| Файл | О чём |
|---|---|
| [obshchaya-ideya.md](obshchaya-ideya.md) | Продукт, экономика, два контура, граница бесплатного |
| [tehnicheskaya-arhitektura.md](tehnicheskaya-arhitektura.md) | Исполнение кода, лог кадров, формат уровней, рендер |
| [generatsiya-grafiki.md](generatsiya-grafiki.md) | Персонажи и предметы: числа, стиль, конвейер картинок |
| [pravila-promptov.md](pravila-promptov.md) | Промпты для персонажей и предметов, отбор, уроки |

## Главный принцип

Код ученика не управляет анимацией. Он выполняется целиком за несколько
миллисекунд и оставляет **лог кадров**. Анимация, перемотка, медали и
проверка в CI работают с этим логом, а не с живым интерпретатором.

```
run(source, level, seed, loadout) -> FrameLog
```

Отсюда детерминизм, шаг назад и автосолвер в CI.

## Стек

| Слой | Выбор |
|---|---|
| Исполнение кода ученика | Pyodide 314 (CPython 3.14 в wasm) в web worker, раздаём сами |
| Симулятор мира | Python, один модуль для браузера и CI, только stdlib |
| Редактор | CodeMirror 6, монтируется вручную |
| Клиент | React 19 + Vite + TypeScript |
| Сцена | SVG + `requestAnimationFrame`, вне React |
| Графика | клетка 80px, PNG от ИИ по эталону, части персонажа и предметы на скелете |
| Бэкенд | Python 3.14, ASGI |
| БД | PostgreSQL 16, psycopg 3 |
| Контент | YAML в git, валидация Pydantic на сборке |
| CI | pytest: автосолвер, проверка сидов, `checksum`, гардеробная |
| Хостинг | NetAngels, виртуальный хостинг |

## Как запустить локально

Один раз — поставить зависимости:

```bash
cd frontend && npm install
cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt
```

Дальше из корня проекта:

```bash
npm run dev          # фронтенд + бэкенд, открывать http://127.0.0.1:5173
npm run dev:web      # только Vite
npm run dev:api      # только uvicorn на http://127.0.0.1:8010
```

`npm run dev` поднимает Vite с горячей перезагрузкой и uvicorn с
`--reload`, выводит оба лога в один терминал с пометками `[web]` и `[api]`,
Ctrl+C гасит оба. Vite проксирует `/health` и `/api/*` на бэкенд, поэтому
клиентский код ходит по относительным путям — так же, как на проде.

Проверить прод-раскладку (один ASGI-процесс раздаёт и статику, и API):

```bash
cd frontend && npm run build
cd backend && STATIC_DIR=../frontend/dist .venv/Scripts/python -m uvicorn asgi:app --port 8010
```

Тесты и линт:

```bash
# симулятор и автосолвер уровней (из корня)
backend/.venv/Scripts/python -m pytest
backend/.venv/Scripts/python -m ruff check simulator tools
# бэкенд
cd backend && .venv/Scripts/python -m pytest && .venv/Scripts/python -m ruff check .
```

Сверка двух интерпретаторов — тот же симулятор внутри Pyodide (Python 3.14,
как в браузере) против локального CPython, `checksum` логов обязан совпасть:

```bash
node tools/check_pyodide.mjs
```

Проверить формат всех уровней (то же делает pytest, но с понятным выводом):

```bash
backend/.venv/Scripts/python tools/level_schema.py
```

Атлас героя из картинок в `assets/src` — после смены картинок, результат
коммитится:

```bash
backend/.venv/Scripts/python tools/sprites.py characters  # персонажи из assets/src/characters/<id>/parts.png
backend/.venv/Scripts/python tools/sprites.py items       # предметы из assets/src/<слот>/
```

Плитки локаций — по карте-шаблону, см. промпт F в pravila-promptov.md:

```bash
backend/.venv/Scripts/python tools/tiles.py template                 # шаблон для модели → assets/src/tiles/template.png
backend/.venv/Scripts/python tools/tiles.py build dungeon            # лист assets/src/tiles/dungeon/sheet.png → атлас
backend/.venv/Scripts/python tools/tiles.py preview dungeon /tmp/tl  # уровни плитками, для отбора
```

## Раскладка

```
simulator/           правила мира на Python, только stdlib. Один и тот же код
                     идёт в Pyodide (браузер) и под pytest (CI)
  runner.py          run(source, level, seed, loadout) -> лог кадров
  world.py           карта, герой, движение
  errors.py          ошибки Python человеческим языком
  tests/             правила мира и автосолвер уровней из content/
content/levels/      уровни в YAML; solution и hints в браузер не уезжают
frontend/            React + Vite, сборка уезжает в frontend/dist
  play/              игра: /play/?level=start-01
  src/engine/        воркер с Pyodide и клиент к нему, типы лога
  src/scene/         плееры: позиция — чистая функция от времени
  src/components/    Play, Editor (CodeMirror), LevelScene, Tiles (автотайлинг), HeroSprite
  maketN/            макеты дизайна: /maket1/ … /maket5/, свои темы поверх
                     тех же токенов и той же демки; тексты общие в src/makets
backend/             ASGI-приложение
  asgi.py            точка входа: объект app
  server/main.py     маршруты
assets/src/          исходники картинок от ИИ (1024×1024, фон #FF00FF)
tools/sprites.py     вырезает фон, собирает атлас в frontend/src/assets/sprites
tools/tiles.py       шаблон для плиток локации, нарезка листа в атлас, превью уровней
tools/level_schema.py  Pydantic-схема уровня, проверка content/levels
tools/check_pyodide.mjs  симулятор в Pyodide против CPython, сверка checksum
dev.mjs              npm run dev — Vite и uvicorn в одном терминале
deploy.mjs           npm run deploy — сборка, заливка, рестарт
```

**Как уровень попадает в браузер.** Плагин `levels-from-yaml` в
`frontend/vite.config.ts` читает `content/levels/*.yaml`, вырезает
`solution` и `hints` и отдаёт модуль `virtual:levels`. Формат проверяет
Pydantic в pytest, а не бэкенд: раздача статическая, исполнение клиентское.

**Pyodide раздаётся сами.** Пакет `pyodide` из npm копируется в
`dist/pyodide/` как есть (в деве — middleware из `node_modules`), воркер
грузит его по `/pyodide/pyodide.mjs`. CDN у хостинга нет, и не нужен.

На сервере раскладку задаёт пресет Python ASGI, а не мы:

```
<корень сайта>/
  app/               ← сюда уезжает backend/, отсюда панель запускает asgi:app
  www/               ← сюда уезжает frontend/dist
  .env/              venv, создан панелью (именно .env, не .venv)
  .envrc             активирует .env и подхватывает etc/environment
  etc/environment/   переменные окружения: файл на переменную
```

Деплой заменяет `app/` и `www/` целиком и не трогает больше ничего —
venv, конфиг и логи переживают любое количество деплоев.

**Переменные окружения на сервере** задаются файлами в `etc/environment/`:
имя файла — имя переменной, содержимое — значение.

**Почему пакет называется `server`, а не `app`.** На сервере код лежит
в каталоге `app/`, и пакет с тем же именем дал бы `app/app/main.py`.
Работать бы работало, читаться — нет.

## Две границы, которые нельзя нарушать

**Симулятор существует в одном экземпляре.** Правила мира не дублируются в
JavaScript ни при каких обстоятельствах — на этом держатся детерминизм,
перемотка и автосолвер одновременно.

**Симулятор исполняется в двух интерпретаторах:** CPython 3.14 на сервере и
в CI, и CPython внутри Pyodide в браузере. Нижняя граница языка — версия
Pyodide. CI обязан гонять тесты на обеих и сверять, что `checksum` совпадает
побайтово.

## Не строим

Игровой движок, растровые ассеты, серверное исполнение кода, микросервисы,
мобильное приложение, второй язык кроме Python, дробные модификаторы,
императивные анимации. Полные списки — в конце обоих документов.
