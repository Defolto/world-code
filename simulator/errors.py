"""Ошибки Python — человеческим языком.

Ребёнок восьми лет не прочитает `NameError: name 'hreo' is not defined`.
Таблица ниже переводит тип исключения в подсказку, а детали (какое имя,
какая команда) подставляются из самого исключения. Это часть контента,
а не логики: править фразы можно, не трогая симулятор.
"""

from __future__ import annotations

import re


class BudgetExceeded(BaseException):
    """Код работал слишком долго. BaseException, а не Exception: иначе
    `try: ... except Exception:` в коде ученика проглотит остановку."""


class HeroCommandError(AttributeError):
    """Обращение к команде, которой у героя нет (или ещё нет)."""


HUMAN = {
    "SyntaxError": "Python не понял эту строку. Проверь скобки, двоеточия и кавычки.",
    "IndentationError": "Отступы не сходятся. Строки внутри одного блока начинаются одинаково.",
    "NameError": "Ты используешь имя, которое ещё не создал: {name}. Проверь, нет ли опечатки.",
    "TypeError": "Команда получила не то, что ожидала. Посмотри, что стоит в скобках.",
    "ZeroDivisionError": "Делить на ноль нельзя — даже герою.",
    "IndexError": "В списке нет элемента с таким номером.",
    "KeyError": "В словаре нет такого ключа: {name}.",
    "ValueError": "Значение не подходит для этой операции.",
    "RecursionError": "Функция вызывает сама себя без конца.",
    "BudgetExceeded": ("Твой код работал слишком долго — скорее всего, цикл не заканчивается."),
}

DEFAULT = "Что-то пошло не так. Прочитай сообщение ниже — там есть подсказка."

_NAME = re.compile(r"'([^']+)'")


def humanize(exc: BaseException) -> str:
    """Подсказка для ребёнка по исключению."""
    if isinstance(exc, HeroCommandError):
        # Сообщение уже человеческое — его составил фасад героя
        return str(exc)
    kind = type(exc).__name__
    text = HUMAN.get(kind, DEFAULT)
    if "{name}" in text:
        match = _NAME.search(str(exc))
        text = text.format(name=match.group(1) if match else "…")
    return text
