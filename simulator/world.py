"""Мир уровня: карта, герой и правила движения.

Система координат: [x, y], начало в левом верхнем углу, y растёт вниз.

Всё на карте — одна модель с флагами, а не отдельные классы (раздел 5
архитектуры). Новый тип объекта — строчка в `objects` уровня, а не ветка
здесь. Флагов пока два: `blocking` и `waits_to_open` (ворота, которые
открываются, если постоять рядом); остальные (`pickable`, `interactive`,
`damage`) появятся вместе со своими занятиями.

Каждое действие героя — тик, включая неудачный шаг в стену: мир живёт
дальше, враги подходят. А вот ворота от стука не открываются: им нужно,
чтобы герой стоял рядом неподвижно — `hero.wait()` подряд столько раз,
сколько записано в `waits_to_open`. Любой шаг, даже в стену, сбивает счёт.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from simulator.errors import HeroCommandError

Event = dict[str, Any]

# Направления — тоже данные. Ключ совпадает с хвостом команды героя:
# move_right -> "right". Так фасад строит команды из одной таблицы.
DIRS: dict[str, tuple[int, int]] = {
    "right": (1, 0),
    "left": (-1, 0),
    "up": (0, -1),
    "down": (0, 1),
}

# Объекты, которые уровень может не описывать: они одинаковы везде.
DEFAULT_OBJECTS: dict[str, dict[str, Any]] = {
    "floor": {"blocking": False},
    "wall": {"blocking": True},
    "flag": {"blocking": False},
}

# Название команды героя на русском — для ошибок и справочника
COMMAND_NAMES = {
    "move_right": "шаг вправо",
    "move_left": "шаг влево",
    "move_up": "шаг вверх",
    "move_down": "шаг вниз",
    "wait": "постоять один ход",
}


def derive(loadout: dict[str, Any]) -> dict[str, int]:
    """Единственный барьер между экипировкой и симуляцией.

    Симулятор знает только числа справа и никогда не спрашивает «какая у
    героя сила». Статы и предметы пока не влияют ни на что: занятие с ними
    ещё не написано, и правила пересчёта появятся в balance.yaml вместе с
    ним. Но барьер стоит с первого дня — иначе боевая логика прирастёт
    к loadout, и потом его не отодрать.
    """
    return {
        "damage": 3,
        "hp_max": 20,
        "energy_max": 10,
        "attack_ticks": 3,
        "move_ticks": 1,
    }


class World:
    """Состояние уровня. Меняется только через команды героя."""

    def __init__(
        self, level: dict[str, Any], loadout: dict[str, Any], emit: Callable[[Event], None]
    ):
        self._emit = emit
        self.stats = derive(loadout)
        self.tick = 0

        self.objects = dict(DEFAULT_OBJECTS)
        self.objects.update(level.get("objects") or {})
        # Ворота: сколько ходов рядом с ними надо простоять, чтобы открылись
        self.gates: dict[str, int] = {
            kind: spec["waits_to_open"]
            for kind, spec in self.objects.items()
            if spec.get("waits_to_open")
        }

        legend: dict[str, str] = level["map"]["legend"]
        rows = level["map"]["grid"].rstrip("\n").split("\n")
        self.width = max(len(row) for row in rows)
        self.height = len(rows)

        # kind_at хранит только непроходимое и заметное: пол не хранится,
        # клетка без записи — пол. Статичная карта живёт в файле уровня,
        # симулятору нужно знать лишь, куда нельзя ступить.
        self.kind_at: dict[tuple[int, int], str] = {}
        hero_at: tuple[int, int] | None = None
        for y, row in enumerate(rows):
            for x, char in enumerate(row):
                kind = legend.get(char)
                if kind is None:
                    raise ValueError(f"В карте символ {char!r}, которого нет в legend")
                if kind == "hero":
                    hero_at = (x, y)
                elif kind != "floor":
                    self.kind_at[(x, y)] = kind
        if hero_at is None:
            raise ValueError("На карте нет героя")

        self.hero_x, self.hero_y = hero_at
        self.hero_dir = "right"
        self.hp = self.stats["hp_max"]
        self.energy = self.stats["energy_max"]
        self.coins = 0

        # Состояние ворот: сколько ходов подряд герой уже простоял рядом.
        # Открытые ворота остаются открытыми — закрываться им незачем.
        self.gate_waited: dict[tuple[int, int], int] = {
            pos: 0 for pos, kind in self.kind_at.items() if kind in self.gates
        }
        self.open_gates: set[tuple[int, int]] = set()

    # --- запросы: бесплатны и мир не меняют ---

    def passable(self, x: int, y: int) -> bool:
        if not (0 <= x < self.width and 0 <= y < self.height):
            return False
        kind = self.kind_at.get((x, y))
        if kind is None:
            return True
        if kind in self.gates:
            return (x, y) in self.open_gates
        return not self.objects.get(kind, {}).get("blocking", False)

    def tiles(self) -> list[dict[str, Any]]:
        """Ворота: открыты ли и сколько ходов рядом ещё постоять. Число
        `left` ребёнок видит на воротах и по нему считает, сколько раз
        написать wait."""
        out = []
        for (x, y), waited in self.gate_waited.items():
            kind = self.kind_at[(x, y)]
            is_open = (x, y) in self.open_gates
            left = 0 if is_open else self.gates[kind] - waited
            state = "open" if is_open else "closed"
            out.append({"x": x, "y": y, "kind": kind, "state": state, "left": left})
        return out

    def snapshot(self) -> dict[str, Any]:
        """Снимок для кадра. Формат — раздел 3 архитектуры. В `tiles` —
        все ворота, а не только изменившиеся: их единицы, зато любой кадр
        рисуется без поиска предыдущего снимка."""
        return {
            "hero": {
                "x": self.hero_x,
                "y": self.hero_y,
                "dir": self.hero_dir,
                "hp": self.hp,
                "hp_max": self.stats["hp_max"],
                "energy": self.energy,
                "energy_max": self.stats["energy_max"],
                "coins": self.coins,
            },
            "units": [],
            "items": [],
            "tiles": self.tiles(),
        }

    # --- действия: стоят тиков ---

    def move(self, direction: str) -> bool:
        """Шаг героя. Упор в стену — событие `blocked`, а не ошибка Python,
        но ход он стоит: мир не замирает из-за того, что герой ошибся
        направлением, — враги подходят, время идёт."""
        dx, dy = DIRS[direction]
        # Повернуться герой успевает всегда, даже если шаг не удался
        self.hero_dir = direction
        # Шаг, даже неудачный, — не «постоять»: ворота начинают счёт заново
        for pos in self.gate_waited:
            self.gate_waited[pos] = 0
        x, y = self.hero_x, self.hero_y
        nx, ny = x + dx, y + dy
        if not self.passable(nx, ny):
            into = self.kind_at.get((nx, ny), "edge")
            self._emit({"type": "blocked", "who": "hero", "dir": direction, "into": into})
            self.tick += self.stats["move_ticks"]
            return False
        self.hero_x, self.hero_y = nx, ny
        # Событие раньше тика: кадр помечен тиком, на котором действие
        # началось, а сколько оно длилось — видно по тику следующего кадра
        self._emit({"type": "move", "who": "hero", "from": [x, y], "to": [nx, ny]})
        self.tick += self.stats["move_ticks"]
        return True

    def wait(self) -> None:
        """Постоять один ход. Закрытые ворота на соседней клетке считают
        такие ходы и открываются, когда наберут своё; ворота вдали
        сбрасывают счёт — рядом с ними никто не стоит."""
        for (gx, gy), waited in self.gate_waited.items():
            if (gx, gy) in self.open_gates:
                continue
            if abs(gx - self.hero_x) + abs(gy - self.hero_y) == 1:
                self.gate_waited[(gx, gy)] = waited + 1
                if waited + 1 >= self.gates[self.kind_at[(gx, gy)]]:
                    self.open_gates.add((gx, gy))
            else:
                self.gate_waited[(gx, gy)] = 0
        # Снимок в событии — уже с обновлёнными воротами: ребёнок видит,
        # что этот wait засчитан
        self._emit({"type": "wait", "who": "hero"})
        self.tick += 1

    def check_goals(self, goals: list[dict[str, Any]]) -> tuple[bool, str | None]:
        """Победа, если выполнены все цели. Иначе — первая невыполненная
        как причина: она станет текстом «почему не получилось»."""
        for goal in goals:
            if "reach" in goal:
                gx, gy = goal["reach"]
                if (self.hero_x, self.hero_y) != (gx, gy):
                    return False, "not_reached"
            if goal.get("stay_alive") and self.hp <= 0:
                return False, "died"
        return True, None


class Hero:
    """Фасад героя для кода ученика.

    Внутри — только ссылка на мир: состояние читается из него в момент
    обращения. Наружу торчат только команды из `api` уровня; про остальные
    фасад честно говорит «этой команды здесь нет», а не роняет AttributeError
    (раздел 4: api — список доступных методов и источник человеческих ошибок).
    """

    def __init__(self, world: World, api: list[str]):
        object.__setattr__(self, "_world", world)
        # api записан как "hero.move_right", нам нужен хвост
        object.__setattr__(self, "_api", [name.split(".", 1)[-1] for name in api])

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        api: list[str] = object.__getattribute__(self, "_api")
        if name not in api:
            available = ", ".join(f"hero.{n}()" for n in api)
            raise HeroCommandError(
                f"У героя на этом уровне нет команды hero.{name}(). Доступно: {available}."
            )
        world: World = object.__getattribute__(self, "_world")
        if name.startswith("move_") and name[5:] in DIRS:
            direction = name[5:]
            return lambda: world.move(direction)
        if name == "wait":
            return world.wait
        raise HeroCommandError(f"Команда hero.{name}() пока не реализована.")

    def __setattr__(self, name: str, value: Any) -> None:
        raise HeroCommandError("Свойства героя менять нельзя — только отдавать команды.")

    def __dir__(self) -> list[str]:
        return list(object.__getattribute__(self, "_api"))

    def __repr__(self) -> str:
        return "<герой>"
