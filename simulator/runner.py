"""Прогон кода ученика: `run(source, level, seed, loadout) -> лог кадров`.

Чистая функция. Код исполняется целиком за миллисекунды и оставляет после
себя лог — анимация, перемотка, медали и CI работают с логом, а не с живым
интерпретатором. Формат лога — раздел 3 архитектуры.

Два таймлайна: строка кода и тик мира. `sys.settrace` даёт кадр на каждую
выполненную строку; команда героя дописывает в текущий кадр событие и
снимок мира. Строка без действий — кадр без `world`.

Трассировка через settrace, а не sys.monitoring: локальная разработка идёт
на 3.11, где monitoring ещё нет. Для тысяч строк разницы не видно; когда
дорастём до пошагового режима на тяжёлых уровнях — заменить, интерфейс
кадров от этого не изменится.
"""

from __future__ import annotations

import ast
import hashlib
import json
import sys
import traceback
from typing import Any

from simulator.errors import BudgetExceeded, humanize
from simulator.world import Hero, World

VERSION = 1
STUDENT_FILE = "<урок>"

# Бюджет вместо зависания (раздел 10). Ребёнок никогда не видит замершую вкладку.
LINE_BUDGET = 50_000
TICK_BUDGET = 10_000

EMPTY_LOADOUT: dict[str, Any] = {"strength": 0, "agility": 0, "stamina": 0, "items": []}

# В `vars` пишем только то, что можно показать в одну строку
_SCALAR = (int, float, str, bool, type(None))
_LIST_LIMIT = 8


class Recorder:
    """Собирает кадры. Один на прогон."""

    def __init__(self) -> None:
        self.frames: list[dict[str, Any]] = []
        self.lines = 0
        self.world: World | None = None
        self._cur: dict[str, Any] | None = None

    def open_frame(self, line: int, local_vars: dict[str, Any] | None) -> None:
        assert self.world is not None
        frame: dict[str, Any] = {
            "i": len(self.frames),
            "tick": self.world.tick,
            "line": line,
            "events": [],
        }
        if local_vars is not None:
            frame["vars"] = local_vars
        self.frames.append(frame)
        self._cur = frame

    def on_event(self, event: dict[str, Any]) -> None:
        """Событие от мира. Если в текущем кадре уже есть действие —
        открывается новый кадр той же строки: два вызова move_right через
        точку с запятой должны стать двумя шагами, а не одним кадром."""
        assert self.world is not None
        if self._cur is None:
            self.open_frame(0, None)
        elif self._cur["events"]:
            self.open_frame(self._cur["line"], self._cur.get("vars"))
        cur = self._cur
        assert cur is not None
        cur["events"].append(event)
        cur["world"] = self.world.snapshot()
        if self.world.tick > TICK_BUDGET:
            raise BudgetExceeded("tick budget")

    def on_line(self, line: int, local_vars: dict[str, Any]) -> None:
        self.lines += 1
        if self.lines > LINE_BUDGET:
            raise BudgetExceeded("line budget")
        self.open_frame(line, local_vars)

    def current_line(self) -> int:
        return self._cur["line"] if self._cur else 0


def _pick_vars(namespace: dict[str, Any]) -> dict[str, Any]:
    """Переменные ученика, пригодные для показа: числа, строки, булевы,
    короткие списки из них. Служебное и фасады — мимо."""
    out: dict[str, Any] = {}
    for name, value in namespace.items():
        if name.startswith("_") or name == "hero":
            continue
        if isinstance(value, _SCALAR):
            out[name] = value
        elif (
            isinstance(value, list)
            and len(value) <= _LIST_LIMIT
            and all(isinstance(v, _SCALAR) for v in value)
        ):
            out[name] = list(value)
    return out


def _make_tracer(recorder: Recorder):
    def local_trace(frame, event, arg):
        if event == "line":
            recorder.on_line(frame.f_lineno, _pick_vars(frame.f_locals))
        return local_trace

    def global_trace(frame, event, arg):
        # Трассируем только код ученика: функции, которые он определил,
        # тоже живут в STUDENT_FILE, а библиотечные вызовы — нет.
        if frame.f_code.co_filename == STUDENT_FILE:
            return local_trace
        return None

    return global_trace


def _student_line(exc: BaseException) -> int | None:
    """Строка ученика, где упало. Последняя запись трейсбека с его файлом."""
    if isinstance(exc, SyntaxError) and exc.filename == STUDENT_FILE:
        return exc.lineno
    line = None
    for entry in traceback.extract_tb(exc.__traceback__):
        if entry.filename == STUDENT_FILE:
            line = entry.lineno
    return line


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _metrics(tree: ast.Module | None, recorder: Recorder) -> dict[str, int]:
    """Медали считаются, а не оцениваются (раздел 10)."""
    ticks = recorder.world.tick if recorder.world else 0
    if tree is None:
        return {"ticks": ticks, "lines": recorder.lines, "ast_nodes": 0, "repeats": 0}
    return {
        "ticks": ticks,
        "lines": recorder.lines,
        "ast_nodes": sum(1 for _ in ast.walk(tree)),
        "repeats": count_repeats(tree),
    }


def count_repeats(tree: ast.AST) -> int:
    """Повторы: одинаковые инструкции или их пары, стоящие подряд.

    Инструкции нормализуются через ast.dump без позиций, поэтому лишние
    пробелы не делают две одинаковые строки разными. Считаем по каждому
    телу отдельно: в модуле, в цикле, в ветке if.
    """
    total = 0
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list) or not body or not isinstance(body[0], ast.stmt):
            continue
        for stmts in (body, getattr(node, "orelse", None) or []):
            keys = [ast.dump(s) for s in stmts]
            for size in range(1, len(keys) // 2 + 1):
                for i in range(len(keys) - 2 * size + 1):
                    if keys[i : i + size] == keys[i + size : i + 2 * size]:
                        total += 1
    return total


def run(
    source: str,
    level: dict[str, Any],
    seed: int = 0,
    loadout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Прогнать код ученика на уровне и вернуть лог кадров."""
    loadout = loadout if loadout is not None else EMPTY_LOADOUT
    recorder = Recorder()
    world = World(level, loadout, recorder.on_event)
    recorder.world = world
    hero = Hero(world, level.get("api", []))

    error: dict[str, Any] | None = None
    status = "win"
    reason: str | None = None
    tree: ast.Module | None = None

    try:
        tree = ast.parse(source, STUDENT_FILE)
        code = compile(tree, STUDENT_FILE, "exec")
    except SyntaxError as exc:
        error = _describe(exc)
        status, reason = "error", "syntax"
    else:
        # Отдельное пространство имён: мир виден только через фасад.
        # Идеальной изоляции здесь нет и не требуется (раздел 10).
        namespace: dict[str, Any] = {"__name__": "__main__", "hero": hero}
        sys.settrace(_make_tracer(recorder))
        try:
            exec(code, namespace)
        except BudgetExceeded as exc:
            error = _describe(exc)
            error["line"] = recorder.current_line()
            status, reason = "timeout", "budget"
        except Exception as exc:
            # Любая ошибка ученика — не падение симулятора, а исход прогона
            error = _describe(exc)
            status, reason = "error", "exception"
        finally:
            sys.settrace(None)

    if status == "win":
        won, reason = world.check_goals(level.get("goals", []))
        status = "win" if won else "lose"

    recorder.on_event({"type": "level_end", "status": status, "reason": reason})

    frames = recorder.frames
    return {
        "version": VERSION,
        "level": level["id"],
        "seed": seed,
        "loadout": loadout,
        "outcome": {"status": status, "reason": reason},
        "metrics": _metrics(tree, recorder),
        "checksum": hashlib.sha256(_canonical(frames).encode("utf-8")).hexdigest(),
        "frames": frames,
        "error": error,
    }


def _describe(exc: BaseException) -> dict[str, Any]:
    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "line": _student_line(exc),
        "human": humanize(exc),
    }


def run_json(source: str, level_json: str, seed: int = 0, loadout_json: str | None = None) -> str:
    """Та же `run`, но на строках JSON — так её удобно звать из воркера:
    ни одного объекта не пересекает границу Pyodide и JS, только текст."""
    level = json.loads(level_json)
    loadout = json.loads(loadout_json) if loadout_json else None
    return json.dumps(run(source, level, seed, loadout), ensure_ascii=False)
