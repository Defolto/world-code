"""Мир уровня: карта, герой и правила движения.

Система координат: [x, y], начало в левом верхнем углу, y растёт вниз.

Всё на карте — одна модель с флагами, а не отдельные классы (раздел 5
архитектуры). Новый тип объекта — строчка в `objects` уровня, а не ветка
здесь. Флагов пока три: `blocking`, `waits_to_open` (ворота, которые
открываются, если постоять рядом) и `pickable` (предмет, который
`hero.take()` поднимает с клетки, где стоит герой), `fake` у предмета
(часть экземпляров — подделки, см. ниже), `jumpable` и `crawlable` у
преград (см. ниже); остальные (`interactive`, `damage`) появятся вместе
со своими занятиями.

Каждое действие героя — тик, включая неудачный шаг в стену: мир живёт
дальше, враги подходят. `hero.move_right(3)` — три таких шага подряд, по
тику и единице энергии каждый; первый неудачный останавливает серию.
А вот ворота от стука не открываются: им нужно, чтобы герой стоял рядом
неподвижно — `hero.wait()` подряд столько раз, сколько записано в
`waits_to_open` (или `hero.wait(N)` — те же N ходов одной строкой).
Любой шаг, даже в стену, сбивает счёт.

Энергия: шаг (и попытка шага в стену) и взаимодействие стоят единицу,
`wait` возвращает `energy_regen`, не выше `energy_max`. На нуле действие
не происходит — событие `no_energy`, ход всё равно потрачен. Ученик
чинит это тем же `wait`, которым открывает ворота.

Подделки: `fake: {count: N, damage: D}` у предмета помечает N его
экземпляров фальшивыми — какие именно, решает `seed` прогона, поэтому
заранее не узнать, и без проверки уровень не проходится. С виду они
одинаковы; `hero.check_coin()` — бесплатный запрос (ни тика, ни энергии),
который отвечает, настоящий ли предмет под ногами. Поднятая подделка
бьёт на D жизни; на нуле герой погибает, и программа останавливается —
это первый источник урона в мире, до врагов.

Преграды: `jumpable` (яма — перепрыгнуть) и `crawlable` (паутина — проползти)
непроходимы шагом; `hero.jump("right")` и `hero.crawl("right")` переносят
героя через клетку преграды на следующую за ней — один ход, одна
энергия. Не та преграда, пустая клетка или занятое место приземления —
событие `cannot_jump` / `cannot_crawl`, ход потрачен. `chance: 0.5` у
преграды — при запуске её может не оказаться (решает seed): тогда нужен
`hero.can_move("right")` — бесплатный запрос «можно ли шагнуть туда».
Направление у всех трёх — строкой-аргументом, одинаково.

Случайным может быть и обычный `blocking`-объект (завал): `chance` —
каждый экземпляр сам по себе, `present: {count: N}` — на месте ровно N
из тех, что на карте. Второе нужно развилкам: «открыт ровно один выход».

Запертые ворота: `password: "сезам"` — открываются, когда герой, стоя
вплотную, скажет это слово: `hero.say(password)`. `say` принимает что
угодно и произносит как текст — так ребёнок видит на сцене, что лежит в
переменной. Один тик, энергии не стоит: это первая команда занятия про
переменные, и штрафовать за разговоры незачем.

Пароль может быть списком слов — при запуске выбирается одно (seed), и
наизусть его не напишешь. Тогда слово лежит на свитке: предмет с
`reveals: <вид ворот>`; `hero.take()` на нём возвращает слово, и его
надо сохранить: `password = hero.take()`. Так переменная становится
необходимой, а не украшением. `blank: {count: N}` у свитка — N из них
пустые (какие — seed): `take` вернёт "" — пустое слово, и решать, что
говорить двери, придётся сравнением.

Числа: `gives: [7, 8, 9]` у предмета — `hero.take()` вернёт одно из них
(seed). Пароль двери может быть вычислен: `password: {subtract: [bag,
scroll]}` — разность чисел двух предметов, строкой. Так появляется
арифметика с переменными: `pay = coins - need; hero.say(pay)`. Число —
своё у каждого экземпляра (в пределах вида — разные), `{max: bag}` —
наибольшее из них. `hero.look()` — бесплатный запрос: то же, что вернул
бы `take()`, но предмет остаётся лежать. `heavy: true` — в руках
умещается один такой предмет: второй `take` — событие `hands_full`.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from typing import Any

from simulator.errors import HeroCommandError, HeroDied

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
    "wait": "постоять ход или несколько",
    "take": "взять предмет под ногами",
    "check_coin": "настоящая ли монета под ногами",
    "can_move": "можно ли шагнуть в эту сторону",
    "say": "сказать слово",
    "look": "посмотреть, что под ногами",
    "jump": "перепрыгнуть яму",
    "crawl": "проползти под паутиной",
}

# Флаг преграды → глагол, которым её проходят. Для ошибок и событий
OBSTACLE_VERBS = {"jumpable": "jump", "crawlable": "crawl"}


def derive(loadout: dict[str, Any]) -> dict[str, int]:
    """Единственный барьер между экипировкой и симуляцией.

    Симулятор знает только числа справа и никогда не спрашивает «какая у
    героя сила». Статы и предметы пока не влияют ни на что: занятие с ними
    ещё не написано, и правила пересчёта появятся в balance.yaml вместе с
    ним. Но барьер стоит с первого дня — иначе боевая логика прирастёт
    к loadout, и потом его не отодрать.

    `energy_max` 20 при цене действия 1: самый длинный эталон первых
    уровней — дюжина шагов, запас нужен на ошибки и лишние шаги в стену.
    """
    return {
        "damage": 3,
        "hp_max": 20,
        "energy_max": 20,
        "energy_regen": 2,
        "attack_ticks": 3,
        "move_ticks": 1,
    }


class World:
    """Состояние уровня. Меняется только через команды героя."""

    def __init__(
        self,
        level: dict[str, Any],
        loadout: dict[str, Any],
        emit: Callable[[Event], None],
        seed: int = 0,
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
        # rng на всё случайное; порядок обращений к нему фиксирован: пароли,
        # преграды, подделки и пустые свитки, числа на предметах
        rng = random.Random(seed)
        # Запертые ворота: каким словом открываются. Список — выбор от seed,
        # словарь — вычисление из чисел на предметах (ниже, когда они есть)
        self.locks: dict[str, str] = {}
        computed: dict[str, dict[str, Any]] = {}
        for kind, spec in self.objects.items():
            password = spec.get("password")
            if not password:
                continue
            if isinstance(password, dict):
                # Считается ниже, когда известны числа на предметах; место
                # в locks занять надо сейчас — по нему собираются locked
                computed[kind] = password
                self.locks[kind] = ""
            elif isinstance(password, list):
                self.locks[kind] = rng.choice(password)
            else:
                self.locks[kind] = password

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

        # Преграды и завалы: где какие. Те, что с `chance` или `present`,
        # при запуске могут не появиться — решает seed. Отсутствующие
        # убираются с карты, а в снимке остаются со state: absent, чтобы
        # рендер их спрятал. Один rng на всё случайное; порядок обращения
        # к нему — порядок здесь, менять его — менять раскладку всех уровней
        self.obstacles: dict[tuple[int, int], str] = {
            pos: kind for pos, kind in self.kind_at.items() if self._is_obstacle(kind)
        }
        self.absent: set[tuple[int, int]] = set()
        for pos, kind in self.obstacles.items():
            chance = self.objects[kind].get("chance")
            if chance is not None and rng.random() >= chance:
                self.absent.add(pos)
        for kind, spec in self.objects.items():
            present = spec.get("present")
            if not present:
                continue
            positions = [pos for pos, k in self.obstacles.items() if k == kind]
            keep = set(rng.sample(positions, min(present["count"], len(positions))))
            self.absent.update(pos for pos in positions if pos not in keep)
        for pos in self.absent:
            del self.kind_at[pos]

        self.hero_x, self.hero_y = hero_at
        self.hero_dir = "right"
        self.hp = self.stats["hp_max"]
        self.energy = self.stats["energy_max"]

        # Состояние ворот: сколько ходов подряд герой уже простоял рядом.
        # Открытые ворота остаются открытыми — закрываться им незачем.
        self.gate_waited: dict[tuple[int, int], int] = {
            pos: 0 for pos, kind in self.kind_at.items() if kind in self.gates
        }
        self.locked: list[tuple[int, int]] = [
            pos for pos, kind in self.kind_at.items() if kind in self.locks
        ]
        self.open_gates: set[tuple[int, int]] = set()

        # Предметы: лежат на клетках, пока герой их не поднял. Порядок — как
        # на карте (построчно), id по нему — для лога и рендера
        self.items: list[dict[str, Any]] = []
        for y in range(self.height):
            for x in range(self.width):
                kind = self.kind_at.get((x, y))
                if kind and self.objects.get(kind, {}).get("pickable"):
                    item_id = f"{kind}-{len(self.items) + 1}"
                    self.items.append(
                        {"id": item_id, "kind": kind, "x": x, "y": y, "taken": False, "checked": None}
                    )
        # Подделки: `fake` у объекта помечает столько его экземпляров, сколько
        # сказано. Выбор — от seed, чтобы прогон был воспроизводим, а между
        # запусками менялся. Сама пометка в снимок не уезжает — иначе её
        # покажет рендер и проверка станет не нужна
        self._fake: set[str] = set()
        # Пустые свитки — по тому же принципу
        self._blank: set[str] = set()
        for kind, spec in self.objects.items():
            ids = [item["id"] for item in self.items if item["kind"] == kind]
            fake = spec.get("fake")
            if fake:
                self._fake.update(rng.sample(ids, min(fake["count"], len(ids))))
            blank = spec.get("blank")
            if blank:
                self._blank.update(rng.sample(ids, min(blank["count"], len(ids))))
        # Числа на предметах: у каждого экземпляра своё, в пределах вида —
        # разные (пока хватает списка). Порядок — как на карте
        self._value: dict[str, int] = {}
        for kind, spec in self.objects.items():
            gives = spec.get("gives")
            if not gives:
                continue
            ids = [item["id"] for item in self.items if item["kind"] == kind]
            values = rng.sample(gives, len(ids)) if len(ids) <= len(gives) else [rng.choice(gives) for _ in ids]
            self._value.update(zip(ids, values))
        for kind, password in computed.items():
            if "subtract" in password:
                a, b = password["subtract"]
                self.locks[kind] = str(sum(self._kind_values(a)) - sum(self._kind_values(b)))
            else:
                self.locks[kind] = str(max(self._kind_values(password["max"])))
        # Что герой несёт: виды подобранных предметов
        self.bag: list[str] = []

    def _kind_values(self, kind: str) -> list[int]:
        return [self._value[item["id"]] for item in self.items if item["kind"] == kind]

    def _item_value(self, item: dict[str, Any]) -> bool | str | int:
        """Что даёт предмет: слово свитка (или "" у пустого), число, иначе True."""
        reveals = self.objects[item["kind"]].get("reveals")
        if reveals:
            return "" if item["id"] in self._blank else self.locks[reveals]
        if item["id"] in self._value:
            return self._value[item["id"]]
        return True

    def look(self) -> bool | str | int:
        """Посмотреть, что под ногами, не поднимая: то же, что вернул бы
        `take()`. Запрос — ни тика, ни энергии; событие — для пузыря-мысли."""
        item = self.item_here()
        value = False if item is None else self._item_value(item)
        self._emit({"type": "look", "who": "hero", "item": item["id"] if item else None, "value": value})
        return value

    def _is_obstacle(self, kind: str) -> bool:
        """Что рендер рисует поверх пола и что может отсутствовать: яма,
        паутина и всё случайное (`chance` / `present`)."""
        spec = self.objects.get(kind, {})
        if any(spec.get(flag) for flag in OBSTACLE_VERBS):
            return True
        return spec.get("chance") is not None or bool(spec.get("present"))

    # --- запросы: бесплатны и мир не меняют ---

    def passable(self, x: int, y: int) -> bool:
        if not (0 <= x < self.width and 0 <= y < self.height):
            return False
        kind = self.kind_at.get((x, y))
        if kind is None:
            return True
        if kind in self.gates or kind in self.locks:
            return (x, y) in self.open_gates
        spec = self.objects.get(kind, {})
        # Преграда непроходима шагом, что бы ни было в blocking
        if any(spec.get(flag) for flag in OBSTACLE_VERBS):
            return False
        return not spec.get("blocking", False)

    def tiles(self) -> list[dict[str, Any]]:
        """Ворота: открыты ли и сколько ходов рядом ещё постоять (число
        `left` ребёнок видит на воротах и по нему считает, сколько раз
        написать wait). Преграды: на месте ли."""
        out = []
        for (x, y), waited in self.gate_waited.items():
            kind = self.kind_at[(x, y)]
            is_open = (x, y) in self.open_gates
            left = 0 if is_open else self.gates[kind] - waited
            state = "open" if is_open else "closed"
            out.append({"x": x, "y": y, "kind": kind, "state": state, "left": left})
        for (x, y) in self.locked:
            state = "open" if (x, y) in self.open_gates else "closed"
            out.append({"x": x, "y": y, "kind": self.kind_at[(x, y)], "state": state})
        for (x, y), kind in self.obstacles.items():
            state = "absent" if (x, y) in self.absent else "present"
            out.append({"x": x, "y": y, "kind": kind, "state": state})
        return out

    @staticmethod
    def _check_dir(command: str, direction: Any) -> None:
        if not isinstance(direction, str) or direction not in DIRS:
            raise HeroCommandError(
                f"hero.{command}({direction!r}): в скобках — направление в кавычках: "
                '"right", "left", "up" или "down".'
            )

    def can_move(self, direction: str) -> bool:
        """Можно ли шагнуть туда. Запрос: ни тика, ни энергии; событие —
        чтобы рендер показал, куда герой посмотрел и что увидел."""
        self._check_dir("can_move", direction)
        dx, dy = DIRS[direction]
        at = (self.hero_x + dx, self.hero_y + dy)
        result = self.passable(*at)
        self._emit({"type": "check_move", "who": "hero", "dir": direction, "at": list(at), "result": result})
        return result

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
                # Урон за удар — в снимке, а не в шапке лога: HUD читает всё
                # о герое из одного места, а баффы на ход потом лягут сюда же
                "damage": self.stats["damage"],
                "coins": self.bag.count("coin"),
            },
            "units": [],
            "items": [dict(item) for item in self.items],
            "tiles": self.tiles(),
        }

    def item_here(self) -> dict[str, Any] | None:
        for item in self.items:
            if not item["taken"] and (item["x"], item["y"]) == (self.hero_x, self.hero_y):
                return item
        return None

    def check_coin(self) -> bool:
        """Настоящий ли предмет под ногами. Запрос: ни тика, ни энергии.
        Событие всё же есть — рендер по нему показывает результат
        проверки, иначе `if` на экране невидим. Пустая клетка — False."""
        item = self.item_here()
        if item is None:
            self._emit({"type": "check", "who": "hero", "item": None, "result": "none"})
            return False
        result = "fake" if item["id"] in self._fake else "real"
        item["checked"] = result
        self._emit({"type": "check", "who": "hero", "item": item["id"], "result": result})
        return result == "real"

    # --- действия: стоят тиков и энергии ---

    def _hurt(self, amount: int, by: str) -> None:
        """Отнять жизнь. На нуле — `died`, и прогон обрывается: мёртвый герой
        не ходит, а лог после смерти только путал бы."""
        self.hp = max(0, self.hp - amount)
        self._emit({"type": "hit", "who": "hero", "by": by, "amount": amount, "hp": self.hp})
        if self.hp <= 0:
            self._emit({"type": "died", "who": "hero"})
            raise HeroDied()

    def _spend(self) -> bool:
        """Списать энергию за действие. На нуле действие не происходит:
        событие `no_energy`, ход потрачен — герой замер, но время идёт."""
        if self.energy <= 0:
            self._emit({"type": "no_energy", "who": "hero"})
            self.tick += 1
            return False
        self.energy -= 1
        return True

    def move(self, direction: str, steps: int = 1) -> bool:
        """Несколько шагов подряд — те же одиночные шаги, каждый со своим
        событием и кадром: анимации и маршруту всё равно, одной строкой
        они написаны или тремя. Серия обрывается на первом неудачном
        (стена, нет сил); True — если дошли все."""
        if isinstance(steps, bool) or not isinstance(steps, int) or steps < 1:
            raise HeroCommandError(
                f"hero.move_{direction}({steps!r}): в скобках — сколько шагов, "
                "целое число от 1. Без скобок внутри — один шаг."
            )
        for _ in range(steps):
            if not self._step(direction):
                return False
        return True

    def _step(self, direction: str) -> bool:
        """Один шаг. Упор в стену — событие `blocked`, а не ошибка Python,
        но ход он стоит: мир не замирает из-за того, что герой ошибся
        направлением, — враги подходят, время идёт."""
        if not self._spend():
            return False
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

    def wait(self, turns: int = 1) -> None:
        """Постоять `turns` ходов — как `move(steps)`: те же одиночные
        ожидания, каждое со своим событием и кадром. Обрываться серии не на
        чем: постоять можно всегда."""
        if isinstance(turns, bool) or not isinstance(turns, int) or turns < 1:
            raise HeroCommandError(
                f"hero.wait({turns!r}): в скобках — сколько ходов постоять, "
                "целое число от 1. Без скобок внутри — один ход."
            )
        for _ in range(turns):
            self._wait_once()

    def _wait_once(self) -> None:
        """Один ход на месте: восстановить энергию и, если рядом закрытые
        ворота, посчитаться им. Ворота вдали сбрасывают счёт — рядом с
        ними никто не стоит."""
        self.energy = min(self.stats["energy_max"], self.energy + self.stats["energy_regen"])
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

    def jump(self, direction: str) -> bool:
        return self._leap("jumpable", direction)

    def crawl(self, direction: str) -> bool:
        return self._leap("crawlable", direction)

    def _leap(self, flag: str, direction: str) -> bool:
        """Через преграду на клетку за ней. Один ход и одна энергия, как шаг:
        трудность преграды — в том, что нужна своя команда, а не в цене.
        Нет подходящей преграды или некуда приземлиться — `cannot_<verb>`
        с тем, что помешало; ход потрачен, как при упоре в стену."""
        verb = OBSTACLE_VERBS[flag]
        self._check_dir(verb, direction)
        if not self._spend():
            return False
        dx, dy = DIRS[direction]
        self.hero_dir = direction
        for pos in self.gate_waited:
            self.gate_waited[pos] = 0
        x, y = self.hero_x, self.hero_y
        over = (x + dx, y + dy)
        land = (x + 2 * dx, y + 2 * dy)
        over_kind = self.kind_at.get(over)
        if over_kind is None or not self.objects.get(over_kind, {}).get(flag):
            into = over_kind or ("floor" if self.passable(*over) else "edge")
        elif not self.passable(*land):
            into = self.kind_at.get(land, "edge")
        else:
            self.hero_x, self.hero_y = land
            self._emit(
                {"type": verb, "who": "hero", "from": [x, y], "to": list(land), "over": over_kind}
            )
            self.tick += self.stats["move_ticks"]
            return True
        self._emit({"type": f"cannot_{verb}", "who": "hero", "dir": direction, "into": into})
        self.tick += self.stats["move_ticks"]
        return False

    def say(self, value: Any = "") -> None:
        """Произнести значение. Запертые ворота рядом с таким паролем
        открываются — в событии видно, какие. Тик есть, энергии нет."""
        text = str(value)
        opened = []
        for pos in self.locked:
            if pos in self.open_gates:
                continue
            if abs(pos[0] - self.hero_x) + abs(pos[1] - self.hero_y) != 1:
                continue
            if self.locks[self.kind_at[pos]] == text:
                self.open_gates.add(pos)
                opened.append(list(pos))
        self._emit({"type": "say", "who": "hero", "text": text, "opened": opened})
        self.tick += 1

    def take(self) -> bool | str:
        """Поднять предмет с клетки, где стоит герой. Радиус — своя клетка:
        «рука достаёт на шаг» начнётся с соседних объектов (open, pull).
        Пустая клетка — событие `nothing_to_take`, а не ошибка Python: как
        и упор в стену, это игровой промах, и ход он стоит. Свиток
        (`reveals`) возвращает написанное на нём слово, остальное — True."""
        if not self._spend():
            return False
        item = self.item_here()
        if item is not None:
            # Тяжёлое — одно в руках: второй мешок не поднять
            if self.objects[item["kind"]].get("heavy") and any(
                self.objects[k].get("heavy") for k in self.bag
            ):
                self._emit({"type": "hands_full", "who": "hero", "item": item["id"]})
                self.tick += 1
                return False
            item["taken"] = True
            fake = item["id"] in self._fake
            # Подделка в сумку не идёт: `coins` считает только настоящие
            if not fake:
                self.bag.append(item["kind"])
            self._emit(
                {"type": "pickup", "who": "hero", "item": item["id"], "kind": item["kind"], "fake": fake}
            )
            self.tick += 1
            if fake:
                self._hurt(self.objects[item["kind"]]["fake"]["damage"], item["id"])
            return self._item_value(item)
        self._emit({"type": "nothing_to_take", "who": "hero"})
        self.tick += 1
        return False

    def check_goals(self, goals: list[dict[str, Any]]) -> tuple[bool, str | None]:
        """Победа, если выполнены все цели. Иначе — первая невыполненная
        как причина: она станет текстом «почему не получилось»."""
        # Из YAML цели приходят со всеми полями, незаданные — None
        for goal in goals:
            if goal.get("reach") is not None:
                gx, gy = goal["reach"]
                if (self.hero_x, self.hero_y) != (gx, gy):
                    return False, "not_reached"
            if goal.get("stay_alive") and self.hp <= 0:
                return False, "died"
            if goal.get("collect") is not None:
                # Подделки собирать не надо — их и не должно быть в сумке
                left = [
                    i
                    for i in self.items
                    if i["kind"] == goal["collect"] and not i["taken"] and i["id"] not in self._fake
                ]
                if left:
                    return False, "not_collected"
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
            return lambda steps=1: world.move(direction, steps)
        if name == "wait":
            return lambda turns=1: world.wait(turns)
        if name == "take":
            return world.take
        if name == "check_coin":
            return world.check_coin
        if name in ("can_move", "jump", "crawl", "say", "look"):
            return getattr(world, name)
        raise HeroCommandError(f"Команда hero.{name}() пока не реализована.")

    def __setattr__(self, name: str, value: Any) -> None:
        raise HeroCommandError("Свойства героя менять нельзя — только отдавать команды.")

    def __dir__(self) -> list[str]:
        return list(object.__getattribute__(self, "_api"))

    def __repr__(self) -> str:
        return "<герой>"
