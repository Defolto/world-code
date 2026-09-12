"""Автосолвер: каждый уровень из content/ проходит собственным решением.

Это гейт качества контента, а не тест симулятора. Уровень, который не
проходится своим `solution`, не попадает в сборку — иначе о нерешаемой
карте мы узнаём от ребёнка.
"""

from __future__ import annotations

import pytest

from simulator import run
from tools.level_schema import STRIPPED, level_paths, load_level

LEVELS = level_paths()


@pytest.mark.parametrize("path", LEVELS, ids=[p.stem for p in LEVELS])
def test_solution_wins(path):
    level = load_level(path)
    log = run(level.solution, level.model_dump(mode="json"))
    assert log["outcome"]["status"] == "win", log["error"]


@pytest.mark.parametrize("path", LEVELS, ids=[p.stem for p in LEVELS])
def test_starter_does_not_win(path):
    """Заготовка — приглашение писать, а не готовый ответ."""
    level = load_level(path)
    log = run(level.starter, level.model_dump(mode="json"))
    assert log["outcome"]["status"] != "win"


@pytest.mark.parametrize("path", LEVELS, ids=[p.stem for p in LEVELS])
def test_public_dict_has_no_solution(path):
    public = load_level(path).public_dict()
    for field in STRIPPED:
        assert field not in public


@pytest.mark.parametrize("path", LEVELS, ids=[p.stem for p in LEVELS])
def test_public_level_still_runs(path):
    """Симулятору решение не нужно: в браузер уезжает урезанный уровень."""
    level = load_level(path)
    log = run(level.solution, level.public_dict())
    assert log["outcome"]["status"] == "win"


def test_vite_strips_the_same_fields():
    """Список вырезаемых полей живёт в двух местах — здесь и в плагине Vite."""
    config = (level_paths()[0].parents[2] / "frontend" / "vite.config.ts").read_text("utf-8")
    for field in STRIPPED:
        assert f'"{field}"' in config
