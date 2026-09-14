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


class FakeSpec(Strict):
    # Сколько экземпляров предмета — подделки. Какие именно, решает seed
    # прогона, поэтому ребёнок не может выучить их по карте
    count: int = Field(ge=1)
    # Сколько жизни отнимает поднятая подделка
    damage: int = Field(ge=1)


class Subtract(Strict):
    # Пароль — разность чисел (`gives`) двух предметов: первый минус второй
    subtract: tuple[str, str]


class Max(Strict):
    # Пароль — наибольшее из чисел на предметах этого вида
    max: str


class BlankSpec(Strict):
    # Сколько свитков пустые: `hero.take()` на них возвращает "". Какие — seed
    count: int = Field(ge=1)


class PresentSpec(Strict):
    # Сколько экземпляров на месте — ровно столько, остальные исчезают.
    # Какие — решает seed. Для развилок: «открыт ровно один выход»
    count: int = Field(ge=1)


class ObjectSpec(Strict):
    blocking: bool = False
    blocks_sight: bool = False
    # Ворота: непроходимы, пока герой не простоит рядом столько ходов подряд.
    # Потом открыты навсегда; `blocking` для них не смотрится
    waits_to_open: int | None = Field(default=None, ge=1)
    # Запертые ворота: открываются словом — `hero.say(password)` вплотную.
    # Список — одно из слов, выбор при запуске (seed)
    password: str | list[str] | Subtract | Max | None = None
    # Предмет: лежит на клетке, `hero.take()` поднимает его, стоя на ней
    pickable: bool = False
    # Свиток: `hero.take()` возвращает пароль от этих ворот
    reveals: str | None = None
    # Часть свитков пустые
    blank: BlankSpec | None = None
    # Предмет с числом: `hero.take()` вернёт одно из них (seed)
    gives: list[int] | None = Field(default=None, min_length=2)
    # Как рисовать: по умолчанию монетка, свиток с reveals — свиток
    icon: Literal["coin", "scroll", "sack"] | None = None
    # Тяжёлый: в руках умещается один такой, второй не поднять
    heavy: bool = False
    # Часть предметов — подделки; `hero.check_coin()` отличает их
    fake: FakeSpec | None = None
    # Преграды: непроходимы шагом, проходятся своей командой —
    # `hero.jump(dir)` через яму, `hero.crawl(dir)` под балкой
    jumpable: bool = False
    crawlable: bool = False
    # Преграда или завал есть не всегда: вероятность, что при запуске
    # экземпляр на месте (каждый сам по себе)…
    chance: float | None = Field(default=None, gt=0, lt=1)
    # …или ровно столько экземпляров на месте из всех на карте
    present: PresentSpec | None = None

    @model_validator(mode="after")
    def _flags_fit_together(self) -> ObjectSpec:
        if self.fake is not None and not self.pickable:
            raise ValueError("fake имеет смысл только у pickable-предмета")
        if self.jumpable and self.crawlable:
            raise ValueError("преграда либо jumpable, либо crawlable — не обе сразу")
        random = self.chance is not None or self.present is not None
        if random and not (self.jumpable or self.crawlable or self.blocking):
            raise ValueError("chance/present есть только у преград и завалов (blocking)")
        if self.chance is not None and self.present is not None:
            raise ValueError("либо chance, либо present — не оба")
        if self.password is not None and self.waits_to_open is not None:
            raise ValueError("ворота либо с паролем, либо на выдержку — не оба")
        if isinstance(self.password, list) and len(set(self.password)) < 2:
            raise ValueError("список паролей — минимум два разных слова, иначе зачем список")
        if self.password == "" or (isinstance(self.password, list) and "" in self.password):
            raise ValueError("пустой пароль — дверь без замка")
        if self.reveals is not None and not self.pickable:
            raise ValueError("reveals есть только у pickable-предмета (свитка)")
        if self.blank is not None and self.reveals is None:
            raise ValueError("blank есть только у свитка (reveals)")
        if self.gives is not None and (not self.pickable or self.reveals is not None):
            raise ValueError("gives есть только у pickable-предмета без reveals")
        if self.gives is not None and len(set(self.gives)) < 2:
            raise ValueError("gives — минимум два разных числа, иначе зачем список")
        return self


class Goal(Strict):
    reach: tuple[int, int] | None = None
    stay_alive: bool | None = None
    # Все предметы этого вида подобраны
    collect: str | None = None

    @model_validator(mode="after")
    def _one_goal(self) -> Goal:
        if self.reach is None and self.stay_alive is None and self.collect is None:
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

    @model_validator(mode="after")
    def _collect_is_pickable_on_map(self) -> Level:
        """Цель «собрать X» без единого X на карте выполнена всегда — уровень
        тихо становится тривиальным, поэтому это ошибка формата."""
        for goal in self.goals:
            if goal.collect is None:
                continue
            if not self.objects.get(goal.collect, ObjectSpec()).pickable:
                raise ValueError(f"цель collect: {goal.collect} — объект не описан как pickable")
            if goal.collect not in self.map.legend.values():
                raise ValueError(f"цель collect: {goal.collect} — на карте таких нет")
        return self

    @model_validator(mode="after")
    def _reveals_points_at_a_lock(self) -> Level:
        for kind, spec in self.objects.items():
            if spec.reveals is not None:
                target = self.objects.get(spec.reveals)
                if target is None or target.password is None:
                    raise ValueError(f"{kind}: reveals: {spec.reveals} — таких ворот с password нет")
            needs_gives = (
                list(spec.password.subtract) if isinstance(spec.password, Subtract)
                else [spec.password.max] if isinstance(spec.password, Max)
                else []
            )
            for name in needs_gives:
                if self.objects.get(name, ObjectSpec()).gives is None:
                    raise ValueError(f"{kind}: password: {name} — у этого предмета нет gives")
        return self

    @model_validator(mode="after")
    def _fakes_leave_something_real(self) -> Level:
        """Подделок меньше, чем экземпляров: иначе нечего собирать, а
        `collect` выполняется сам собой."""
        counts: dict[str, int] = {}
        for row in self.map.grid.rstrip("\n").split("\n"):
            for char in row:
                kind = self.map.legend[char]
                counts[kind] = counts.get(kind, 0) + 1
        for kind, spec in self.objects.items():
            if spec.fake is not None and spec.fake.count >= counts.get(kind, 0):
                raise ValueError(
                    f"{kind}: подделок {spec.fake.count}, а на карте всего {counts.get(kind, 0)}"
                )
            if spec.blank is not None and spec.blank.count >= counts.get(kind, 0):
                raise ValueError(
                    f"{kind}: пустых {spec.blank.count}, а свитков всего {counts.get(kind, 0)}"
                )
            if spec.present is not None and spec.present.count >= counts.get(kind, 0):
                raise ValueError(
                    f"{kind}: present {spec.present.count} — на карте всего {counts.get(kind, 0)}, "
                    "случайности не выйдет"
                )
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
