"""Схема файла уровня и загрузка YAML.

Pydantic здесь, а не в симуляторе: симулятор живёт в Pyodide и не тянет
зависимостей, а проверка формата — дело сборки и CI. Когда файлы пишет
LLM, опечатка `attacks_evry` иначе молча даёт гоблина, который никогда не
бьёт, — поэтому `extra="forbid"` на каждой модели.

Что уезжает в браузер, решает `public_dict()`: `solution` и `hints` из
уровня вырезаются. Ту же вырезку делает плагин Vite (frontend/vite.config.ts,
поле STRIPPED) — список полей должен совпадать, это проверяет тест.

Запуск проверки всех уровней:

    backend/.venv/Scripts/python tools/level_schema.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
LEVELS_DIR = ROOT / "content" / "levels"

# Поля, которые не должны попасть в браузер. Синхронно с vite.config.ts
STRIPPED = ("solution", "hints")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LevelMap(Strict):
    legend: dict[str, str]
    grid: str

    @model_validator(mode="after")
    def _grid_matches_legend(self) -> LevelMap:
        rows = self.grid.rstrip("\n").split("\n")
        for y, row in enumerate(rows):
            for x, char in enumerate(row):
                if char not in self.legend:
                    raise ValueError(f"символ {char!r} в клетке [{x}, {y}] не описан в legend")
        if sum(row.count(c) for row in rows for c, k in self.legend.items() if k == "hero") != 1:
            raise ValueError("на карте должен быть ровно один герой")
        return self


class ObjectSpec(Strict):
    blocking: bool = False
    blocks_sight: bool = False
    # Ворота: непроходимы, пока герой не простоит рядом столько ходов подряд.
    # Потом открыты навсегда; `blocking` для них не смотрится
    waits_to_open: int | None = Field(default=None, ge=1)


class Goal(Strict):
    reach: tuple[int, int] | None = None
    stay_alive: bool | None = None

    @model_validator(mode="after")
    def _one_goal(self) -> Goal:
        if self.reach is None and self.stay_alive is None:
            raise ValueError("пустая цель")
        return self


class Medals(Strict):
    short: Literal["auto"] | int | None = None
    clean: Literal["no_repeat"] | None = None


class Hint(Strict):
    after_fails: int = Field(ge=1)
    text: str


class Level(Strict):
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    lesson: int = Field(ge=1)
    title: str
    brief: str
    map: LevelMap
    objects: dict[str, ObjectSpec] = {}
    api: list[str] = Field(min_length=1)
    starter: str
    solution: str
    goals: list[Goal] = Field(min_length=1)
    medals: Medals = Medals()
    hints: list[Hint] = []

    @model_validator(mode="after")
    def _api_is_hero(self) -> Level:
        for name in self.api:
            if not name.startswith("hero."):
                raise ValueError(f"в api ожидается hero.<команда>, получено {name!r}")
        return self

    def public_dict(self) -> dict[str, Any]:
        """Уровень без решения и подсказок — то, что видит браузер."""
        return self.model_dump(mode="json", exclude=set(STRIPPED))


def load_level(path: Path) -> Level:
    with path.open(encoding="utf-8") as f:
        return Level.model_validate(yaml.safe_load(f))


def level_paths() -> list[Path]:
    return sorted(LEVELS_DIR.glob("*.yaml"))


def main() -> int:
    bad = 0
    for path in level_paths():
        try:
            level = load_level(path)
        except Exception as exc:  # noqa: BLE001 — печатаем всё, что нашли
            bad += 1
            print(f"FAIL {path.relative_to(ROOT)}\n{exc}\n")
        else:
            print(f"ok   {path.relative_to(ROOT)}  {level.title}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
