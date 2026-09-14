"""Правила мира на минимальном уровне, без YAML.

Уровень собирается прямо здесь: тесты правил не должны зависеть от
контента, иначе правка карты в content/ ломает тесты симулятора.
"""

from __future__ import annotations

import json

import pytest

from simulator import run
from simulator.runner import LINE_BUDGET

LEVEL = {
    "id": "test-corridor",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "F": "flag"},
        "grid": "#######\n#@..F.#\n#######\n",
    },
    "api": ["hero.move_right", "hero.move_left", "hero.move_up", "hero.move_down"],
    "goals": [{"reach": [4, 1]}],
}


def frames_with_events(log):
    return [f for f in log["frames"] if f["events"]]


def events(log):
    return [e for f in log["frames"] for e in f["events"]]


def test_three_steps_win():
    log = run("hero.move_right()\n" * 3, LEVEL)
    assert log["outcome"] == {"status": "win", "reason": None}
    moves = [e for e in events(log) if e["type"] == "move"]
    assert [e["to"] for e in moves] == [[2, 1], [3, 1], [4, 1]]
    assert log["frames"][-1]["events"][-1]["type"] == "level_end"
    assert log["metrics"]["ticks"] == 3


def test_too_few_steps_lose():
    log = run("hero.move_right()\n", LEVEL)
    assert log["outcome"] == {"status": "lose", "reason": "not_reached"}


def test_overshoot_lose():
    log = run("hero.move_right()\n" * 4, LEVEL)
    assert log["outcome"]["status"] == "lose"


def test_wall_is_event_not_error_but_costs_a_tick():
    log = run("hero.move_up()\nhero.move_right()\n", LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "blocked", "who": "hero", "dir": "up", "into": "wall"}
    assert evs[1]["type"] == "move"
    # Упор — тоже ход: мир не замирает из-за ошибки направления
    assert frames_with_events(log)[1]["tick"] == 1
    assert log["metrics"]["ticks"] == 2
    # И повернуться герой успел
    assert frames_with_events(log)[0]["world"]["hero"]["dir"] == "up"


def test_edge_of_map_blocks():
    level = dict(LEVEL, map={"legend": {".": "floor", "@": "hero"}, "grid": "@.\n"})
    log = run("hero.move_left()\n", level)
    assert events(log)[0]["into"] == "edge"


def test_line_without_action_has_no_world():
    log = run("x = 5\nhero.move_right()\n", LEVEL)
    first, second = log["frames"][0], log["frames"][1]
    assert first["line"] == 1 and "world" not in first and first["events"] == []
    assert second["line"] == 2 and second["world"]["hero"]["x"] == 2
    assert second["vars"] == {"x": 5}


def test_two_actions_on_one_line_are_two_frames():
    log = run("hero.move_right(); hero.move_right()\n", LEVEL)
    moving = frames_with_events(log)[:2]
    assert [f["line"] for f in moving] == [1, 1]
    assert [f["tick"] for f in moving] == [0, 1]


def test_loop_vars_visible():
    log = run("for i in range(3):\n    hero.move_right()\n", LEVEL)
    seen = [
        f["vars"].get("i")
        for f in log["frames"]
        if f["events"] and f["events"][0]["type"] == "move"
    ]
    assert seen == [0, 1, 2]
    assert log["outcome"]["status"] == "win"


def test_unknown_command_is_human_error():
    level = dict(LEVEL, api=["hero.move_right"])
    log = run("hero.move_right()\nhero.fly()\n", level)
    assert log["outcome"]["status"] == "error"
    assert log["error"]["line"] == 2
    assert "hero.fly()" in log["error"]["human"]
    assert "hero.move_right()" in log["error"]["human"]
    # Первый шаг всё равно в логе: ошибка — исход, а не потеря плёнки
    assert events(log)[0]["type"] == "move"


def test_syntax_error():
    log = run("hero.move_right(\n", LEVEL)
    assert log["outcome"] == {"status": "error", "reason": "syntax"}
    assert log["error"]["type"] == "SyntaxError"
    assert log["error"]["line"] == 1


def test_name_error_humanized():
    log = run("hreo.move_right()\n", LEVEL)
    assert log["error"]["type"] == "NameError"
    assert "hreo" in log["error"]["human"]


def test_infinite_loop_hits_budget():
    log = run("while True:\n    pass\n", LEVEL)
    assert log["outcome"] == {"status": "timeout", "reason": "budget"}
    assert log["metrics"]["lines"] == LINE_BUDGET + 1
    assert log["error"]["type"] == "BudgetExceeded"


def test_student_cannot_swallow_budget():
    log = run("try:\n    while True:\n        pass\nexcept Exception:\n    pass\n", LEVEL)
    assert log["outcome"]["status"] == "timeout"


def test_hero_is_read_only():
    log = run("hero.x = 5\n", LEVEL)
    assert log["outcome"]["status"] == "error"
    assert "нельзя" in log["error"]["human"]


def test_deterministic_checksum():
    a = run("hero.move_right()\n" * 3, LEVEL, seed=7)
    b = run("hero.move_right()\n" * 3, LEVEL, seed=7)
    assert a["checksum"] == b["checksum"]
    assert a["frames"] == b["frames"]


def test_log_is_json_serializable():
    log = run("hero.move_right()\n", LEVEL)
    json.dumps(log, ensure_ascii=False)


@pytest.mark.parametrize(
    ("source", "repeats"),
    [
        ("hero.move_right()\n" * 3, 2),
        ("for i in range(3):\n    hero.move_right()\n", 0),
        ("hero.move_right()\nhero.move_left()\nhero.move_right()\nhero.move_left()\n", 1),
    ],
)
def test_repeats_metric(source, repeats):
    assert run(source, LEVEL)["metrics"]["repeats"] == repeats


# --- ожидание и ворота ---

GATE_LEVEL = {
    "id": "test-gate",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "|": "gate", "F": "flag"},
        "grid": "#######\n#@.|.F#\n#######\n",
    },
    "objects": {"gate": {"waits_to_open": 2}},
    "api": ["hero.move_right", "hero.move_left", "hero.wait"],
    "goals": [{"reach": [5, 1]}],
}


def gate(log, i):
    """Состояние ворот в i-м кадре с действием: (state, left)."""
    tile = frames_with_events(log)[i]["world"]["tiles"][0]
    return tile["state"], tile["left"]


def test_wait_costs_a_tick_and_moves_nothing():
    log = run("hero.wait()\nhero.wait()\n", GATE_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "wait", "who": "hero"}
    assert [f["tick"] for f in frames_with_events(log)][:2] == [0, 1]
    assert log["metrics"]["ticks"] == 2
    assert frames_with_events(log)[1]["world"]["hero"]["x"] == 1


def test_closed_gate_blocks_and_bumping_does_not_open_it():
    log = run("hero.move_right()\n" + "hero.move_right()\n" * 3, GATE_LEVEL)
    evs = events(log)
    assert evs[0]["type"] == "move"
    assert [e["type"] for e in evs[1:4]] == ["blocked"] * 3
    assert evs[1]["into"] == "gate"
    # Ходы потрачены, а ворота как были закрыты, так и остались
    assert log["metrics"]["ticks"] == 4
    assert gate(log, 3) == ("closed", 2)
    assert log["outcome"] == {"status": "lose", "reason": "not_reached"}


def test_standing_next_to_gate_opens_it_and_it_stays_open():
    code = "hero.move_right()\nhero.wait()\nhero.wait()\n" + "hero.move_right()\n" * 3
    log = run(code, GATE_LEVEL)
    assert log["outcome"]["status"] == "win"
    # Счётчик уменьшается с каждым ходом рядом, на последнем — открыто
    assert gate(log, 1) == ("closed", 1)
    assert gate(log, 2) == ("open", 0)
    assert gate(log, 5) == ("open", 0)


def test_waiting_far_from_gate_does_not_count():
    log = run("hero.wait()\nhero.wait()\nhero.move_right()\nhero.move_right()\n", GATE_LEVEL)
    assert gate(log, 1) == ("closed", 2)
    assert events(log)[3]["type"] == "blocked"


def test_any_step_resets_the_count():
    # Один ход рядом, потом стук в ворота — счёт заново
    code = "hero.move_right()\nhero.wait()\nhero.move_right()\nhero.wait()\nhero.move_right()\n"
    log = run(code, GATE_LEVEL)
    assert gate(log, 1) == ("closed", 1)
    assert gate(log, 2) == ("closed", 2)
    assert gate(log, 3) == ("closed", 1)
    assert events(log)[4]["type"] == "blocked"


def test_tiles_are_in_every_snapshot():
    log = run("hero.move_right()\n", GATE_LEVEL)
    assert frames_with_events(log)[0]["world"]["tiles"] == [
        {"x": 3, "y": 1, "kind": "gate", "state": "closed", "left": 2}
    ]


def test_wait_is_unavailable_unless_in_api():
    log = run("hero.wait()\n", LEVEL)
    assert log["outcome"]["status"] == "error"
    assert "hero.wait()" in log["error"]["human"]


COIN_LEVEL = {
    "id": "test-coin",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "o": "coin", "F": "flag"},
        "grid": "######\n#@o.F#\n######\n",
    },
    "objects": {"coin": {"pickable": True}},
    "api": ["hero.move_right", "hero.take"],
    "goals": [{"reach": [4, 1]}, {"collect": "coin"}],
}


def test_take_picks_coin_and_counts():
    log = run("hero.move_right()\nhero.take()\nhero.move_right()\nhero.move_right()\n", COIN_LEVEL)
    assert log["outcome"] == {"status": "win", "reason": None}
    pickup = next(e for e in events(log) if e["type"] == "pickup")
    assert pickup == {"type": "pickup", "who": "hero", "item": "coin-1", "kind": "coin", "fake": False}
    last = [f for f in log["frames"] if f.get("world")][-1]["world"]
    assert last["hero"]["coins"] == 1
    assert last["items"] == [
        {"id": "coin-1", "kind": "coin", "x": 2, "y": 1, "taken": True, "checked": None}
    ]
    # Поднять — тоже ход
    assert log["metrics"]["ticks"] == 4


def test_flag_without_coin_is_not_a_win():
    log = run("hero.move_right()\n" * 3, COIN_LEVEL)
    assert log["outcome"] == {"status": "lose", "reason": "not_collected"}


def test_take_on_empty_cell_is_event_and_costs_a_tick():
    log = run("hero.take()\nhero.take()\n", COIN_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "nothing_to_take", "who": "hero"}
    assert frames_with_events(log)[1]["tick"] == 1
    assert [i["taken"] for i in log["frames"][-1]["world"]["items"]] == [False]


# --- энергия ---


def energy(log, i):
    """Энергия героя после i-го кадра с действием."""
    return frames_with_events(log)[i]["world"]["hero"]["energy"]


def test_actions_spend_energy_and_wait_restores_it():
    log = run("hero.move_right()\n" * 3 + "hero.wait()\n" * 2, GATE_LEVEL)
    assert [energy(log, i) for i in range(5)] == [19, 18, 17, 19, 20]


def test_take_spends_energy_even_when_nothing_to_take():
    log = run("hero.take()\nhero.move_right()\nhero.take()\n", COIN_LEVEL)
    assert [e["type"] for e in events(log)[:3]] == ["nothing_to_take", "move", "pickup"]
    assert [energy(log, i) for i in range(3)] == [19, 18, 17]


def test_bump_spends_energy():
    log = run("hero.move_up()\nhero.move_right()\n", LEVEL)
    assert [energy(log, i) for i in range(2)] == [19, 18]


def test_wait_does_not_overflow_energy_max():
    log = run("hero.wait()\n", GATE_LEVEL)
    assert energy(log, 0) == 20


def test_no_energy_is_event_and_costs_a_tick():
    # 3 шага до флага, дальше упоры в стену — всё это стоит энергии
    log = run("hero.move_right()\n" * 3 + "hero.move_up()\n" * 19, LEVEL)
    evs = events(log)
    assert [e["type"] for e in evs[20:22]] == ["no_energy", "no_energy"]
    assert evs[20] == {"type": "no_energy", "who": "hero"}
    assert log["metrics"]["ticks"] == 22
    assert energy(log, 21) == 0
    # Герой остался у флага, уровень пройден: замереть — не проиграть
    assert log["outcome"]["status"] == "win"


def test_wait_unfreezes_exhausted_hero():
    # Шаг и девятнадцать упоров в ворота — энергия на нуле
    log = run("hero.move_right()\n" * 20 + "hero.wait()\nhero.move_left()\n", GATE_LEVEL)
    evs = events(log)
    assert [e["type"] for e in evs[-3:-1]] == ["wait", "move"]
    assert evs[-2]["to"] == [1, 1]
    assert energy(log, 21) == 1


def test_coin_cannot_be_taken_twice():
    log = run("hero.move_right()\nhero.take()\nhero.take()\n", COIN_LEVEL)
    kinds = [e["type"] for e in events(log)]
    assert kinds[:3] == ["move", "pickup", "nothing_to_take"]
    assert log["frames"][-1]["world"]["hero"]["coins"] == 1


# --- несколько шагов одной командой ---


def test_steps_argument_is_a_series_of_single_steps():
    log = run("hero.move_right(3)\n", LEVEL)
    assert log["outcome"] == {"status": "win", "reason": None}
    moves = [e for e in events(log) if e["type"] == "move"]
    assert [e["to"] for e in moves] == [[2, 1], [3, 1], [4, 1]]
    # Каждый шаг — свой кадр той же строки, свой тик и своя единица энергии
    acted = frames_with_events(log)
    assert [f["line"] for f in acted[:3]] == [1, 1, 1]
    assert [f["tick"] for f in acted[:3]] == [0, 1, 2]
    assert [energy(log, i) for i in range(3)] == [19, 18, 17]


def test_steps_stop_at_the_wall_and_return_false():
    # Переменные снимаются в начале строки, поэтому ok виден со следующей
    log = run("ok = hero.move_right(9)\nhero.move_left(1)\n", LEVEL)
    kinds = [e["type"] for e in events(log)]
    # Четыре шага до стены, один упор — и серия окончена, дальше следующая строка
    assert kinds[:6] == ["move"] * 4 + ["blocked", "move"]
    assert log["frames"][-1]["vars"]["ok"] is False


def test_steps_default_is_one_and_returns_true():
    log = run("ok = hero.move_right()\nok\n", LEVEL)
    assert [e["type"] for e in events(log)][:1] == ["move"]
    assert log["frames"][-1]["vars"]["ok"] is True


@pytest.mark.parametrize("bad", ["0", "-2", "1.5", "'3'", "True"])
def test_steps_must_be_a_positive_int(bad):
    log = run(f"hero.move_right({bad})\n", LEVEL)
    assert log["outcome"]["status"] == "error"
    assert "сколько шагов" in log["error"]["human"]
    assert events(log) == [{"type": "level_end", "status": "error", "reason": "exception"}]


def test_steps_stop_when_energy_runs_out():
    # 20 энергии — ровно пять пробежек по четыре клетки; шестая серия
    # обрывается на первом же шаге: одно no_energy, а не тысяча
    back_and_forth = "hero.move_right(4)\nhero.move_left(4)\n" * 2 + "hero.move_right(4)\n"
    log = run(back_and_forth + "hero.move_left(1000)\n", LEVEL)
    kinds = [e["type"] for e in events(log)]
    assert kinds.count("move") == 20
    assert kinds[-2:] == ["no_energy", "level_end"]


# --- несколько ходов ожидания одной командой ---


def test_wait_turns_argument_is_a_series_of_single_waits():
    log = run("hero.move_right()\nhero.wait(2)\n" + "hero.move_right()\n" * 3, GATE_LEVEL)
    assert log["outcome"]["status"] == "win"
    kinds = [e["type"] for e in events(log)]
    assert kinds[:3] == ["move", "wait", "wait"]
    # Каждое ожидание — свой кадр той же строки и свой тик; ворота считают их по одному
    acted = frames_with_events(log)
    assert [f["line"] for f in acted[1:3]] == [2, 2]
    assert [f["tick"] for f in acted[1:3]] == [1, 2]
    assert gate(log, 1) == ("closed", 1)
    assert gate(log, 2) == ("open", 0)


def test_wait_default_is_one_turn():
    log = run("hero.wait()\n", GATE_LEVEL)
    assert [e["type"] for e in events(log)][:-1] == ["wait"]
    assert log["metrics"]["ticks"] == 1


@pytest.mark.parametrize("bad", ["0", "-2", "1.5", "'3'", "True"])
def test_wait_turns_must_be_a_positive_int(bad):
    log = run(f"hero.wait({bad})\n", GATE_LEVEL)
    assert log["outcome"]["status"] == "error"
    assert "сколько ходов" in log["error"]["human"]
    assert events(log) == [{"type": "level_end", "status": "error", "reason": "exception"}]


# --- подделки ---

FAKE_LEVEL = {
    "id": "test-fake",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "o": "coin", "F": "flag"},
        "grid": "########\n#@oooo.F#\n########\n",
    },
    "objects": {"coin": {"pickable": True, "fake": {"count": 2, "damage": 10}}},
    "api": ["hero.move_right", "hero.take", "hero.check_coin"],
    "goals": [{"reach": [7, 1]}, {"collect": "coin"}],
}

CHECK_AND_TAKE = "hero.move_right()\nif hero.check_coin():\n    hero.take()\n"


def fakes(log):
    return {e["item"] for e in events(log) if e["type"] == "check" and e["result"] == "fake"}


def test_check_then_take_wins_on_any_seed():
    for seed in range(20):
        log = run(CHECK_AND_TAKE * 4 + "hero.move_right()\n" * 2, FAKE_LEVEL, seed=seed)
        assert log["outcome"] == {"status": "win", "reason": None}, seed
        assert len(fakes(log)) == 2
        assert log["frames"][-1]["world"]["hero"]["coins"] == 2


def test_fakes_depend_on_seed():
    found = {frozenset(fakes(run(CHECK_AND_TAKE * 4, FAKE_LEVEL, seed=s))) for s in range(20)}
    assert len(found) > 1
    a = run(CHECK_AND_TAKE * 4, FAKE_LEVEL, seed=3)
    b = run(CHECK_AND_TAKE * 4, FAKE_LEVEL, seed=3)
    assert a["checksum"] == b["checksum"]


def test_check_is_free_and_marks_the_item():
    log = run("hero.check_coin()\nhero.move_right()\nhero.check_coin()\n", FAKE_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "check", "who": "hero", "item": None, "result": "none"}
    assert evs[2]["type"] == "check" and evs[2]["item"] == "coin-1"
    assert evs[2]["result"] in ("real", "fake")
    # Запрос: ни тика, ни энергии
    assert log["metrics"]["ticks"] == 1
    assert energy(log, 2) == 19
    items = log["frames"][-1]["world"]["items"]
    assert items[0]["checked"] == evs[2]["result"]
    assert [i["checked"] for i in items[1:]] == [None, None, None]


def test_snapshot_does_not_reveal_fakes():
    log = run("hero.move_right()\n", FAKE_LEVEL)
    for item in log["frames"][-1]["world"]["items"]:
        assert "fake" not in item


def test_fake_coin_hurts_and_is_not_counted():
    log = run("hero.move_right()\nhero.take()\n" * 4, FAKE_LEVEL, seed=0)
    pickups = [e for e in events(log) if e["type"] == "pickup"]
    hits = [e for e in events(log) if e["type"] == "hit"]
    # Первая подделка: минус половина жизни, герой жив и идёт дальше
    first_fake = next(i for i, e in enumerate(pickups) if e["fake"])
    assert hits[0] == {"type": "hit", "who": "hero", "by": pickups[first_fake]["item"], "amount": 10, "hp": 10}
    # Вторая — смерть: программа обрывается, до флага герой не доходит
    assert log["outcome"] == {"status": "lose", "reason": "died"}
    assert events(log)[-2]["type"] == "died"
    assert log["frames"][-1]["world"]["hero"]["hp"] == 0
    assert log["frames"][-1]["world"]["hero"]["coins"] == len(pickups) - 2


def test_death_stops_the_program():
    log = run("hero.move_right()\nhero.take()\n" * 4 + "hero.move_right()\n" * 10, FAKE_LEVEL, seed=0)
    assert log["outcome"]["reason"] == "died"
    assert not any(e["type"] == "move" and e["to"][0] > 5 for e in events(log))


def test_student_cannot_survive_death():
    src = "try:\n" + "".join(f"    {l}\n" for l in ("hero.move_right()\nhero.take()\n" * 4).splitlines())
    src += "except Exception:\n    pass\n"
    log = run(src, FAKE_LEVEL, seed=0)
    assert log["outcome"]["reason"] == "died"


def test_collect_ignores_fakes():
    src = CHECK_AND_TAKE * 4 + "hero.move_right()\n" * 2
    log = run(src, FAKE_LEVEL, seed=5)
    assert log["outcome"]["status"] == "win"
    assert [i["taken"] for i in log["frames"][-1]["world"]["items"]].count(False) == 2


def test_check_coin_needs_api():
    level = dict(FAKE_LEVEL, api=["hero.move_right", "hero.take"])
    log = run("hero.check_coin()\n", level)
    assert log["outcome"]["status"] == "error"
    assert "hero.check_coin()" in log["error"]["message"]


# --- преграды: яма (jump), балка (crawl), can_move ---

OBSTACLE_LEVEL = {
    "id": "test-obstacles",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "P": "pit", "B": "beam", "F": "flag"},
        "grid": "##########\n#@P.B..F.#\n#........#\n##########\n",
    },
    "objects": {"pit": {"jumpable": True}, "beam": {"crawlable": True}},
    "api": ["hero.move_right", "hero.move_down", "hero.jump", "hero.crawl", "hero.can_move"],
    "goals": [{"reach": [7, 1]}],
}


def test_obstacles_block_a_step():
    log = run("hero.move_right()\n", OBSTACLE_LEVEL)
    assert events(log)[0] == {"type": "blocked", "who": "hero", "dir": "right", "into": "pit"}


def test_jump_and_crawl_cross_the_obstacle_in_one_move():
    log = run('hero.jump("right")\nhero.crawl("right")\nhero.move_right(2)\n', OBSTACLE_LEVEL)
    assert log["outcome"] == {"status": "win", "reason": None}
    evs = events(log)
    assert evs[0] == {"type": "jump", "who": "hero", "from": [1, 1], "to": [3, 1], "over": "pit"}
    assert evs[1] == {"type": "crawl", "who": "hero", "from": [3, 1], "to": [5, 1], "over": "beam"}
    # Прыжок — один ход и одна энергия, как шаг
    assert log["metrics"]["ticks"] == 4
    assert energy(log, 0) == 19


def test_wrong_verb_for_the_obstacle_is_an_event_and_costs_a_move():
    log = run('hero.crawl("right")\nhero.jump("right")\n', OBSTACLE_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "cannot_crawl", "who": "hero", "dir": "right", "into": "pit"}
    assert evs[1]["type"] == "jump"
    assert frames_with_events(log)[1]["tick"] == 1
    assert energy(log, 0) == 19


def test_jump_over_nothing_and_into_edge():
    log = run('hero.jump("down")\nhero.move_down()\nhero.jump("down")\n', OBSTACLE_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "cannot_jump", "who": "hero", "dir": "down", "into": "floor"}
    assert evs[2] == {"type": "cannot_jump", "who": "hero", "dir": "down", "into": "wall"}


def test_jump_needs_room_to_land():
    level = dict(OBSTACLE_LEVEL, map={
        "legend": OBSTACLE_LEVEL["map"]["legend"],
        "grid": "######\n#@P#F#\n######\n",
    })
    log = run('ok = hero.jump("right")\nok\n', level)
    assert events(log)[0] == {"type": "cannot_jump", "who": "hero", "dir": "right", "into": "wall"}
    assert log["frames"][-1]["vars"]["ok"] is False


def test_can_move_is_free_and_tells_the_truth():
    log = run('a = hero.can_move("right")\nb = hero.can_move("down")\nc = hero.can_move("up")\nc\n', OBSTACLE_LEVEL)
    evs = events(log)
    assert evs[0] == {"type": "check_move", "who": "hero", "dir": "right", "at": [2, 1], "result": False}
    assert evs[1]["result"] is True and evs[2]["result"] is False
    assert log["metrics"]["ticks"] == 0
    assert energy(log, 2) == 20
    assert log["frames"][-1]["vars"] == {"a": False, "b": True, "c": False}


@pytest.mark.parametrize("bad", ['"вправо"', "right", "3", '["right"]'])
def test_direction_must_be_a_known_string(bad):
    log = run(f"hero.can_move({bad})\n", OBSTACLE_LEVEL)
    assert log["outcome"]["status"] == "error"
    if bad != "right":  # голое right — обычный NameError, его объясняет humanize
        assert "направление" in log["error"]["human"]


def test_obstacles_are_in_snapshot_and_initial():
    log = run("hero.move_down()\n", OBSTACLE_LEVEL)
    tiles = [
        {"x": 2, "y": 1, "kind": "pit", "state": "present"},
        {"x": 4, "y": 1, "kind": "beam", "state": "present"},
    ]
    assert log["initial"]["tiles"] == tiles
    assert log["frames"][-1]["world"]["tiles"] == tiles
    assert log["initial"]["hero"]["x"] == 1


CHANCE_LEVEL = dict(OBSTACLE_LEVEL, objects={
    "pit": {"jumpable": True, "chance": 0.5},
    "beam": {"crawlable": True, "chance": 0.5},
})

SMART = (
    'if hero.can_move("right"):\n    hero.move_right(2)\nelse:\n    hero.jump("right")\n'
    'if hero.can_move("right"):\n    hero.move_right(2)\nelse:\n    hero.crawl("right")\n'
    "hero.move_right(2)\n"
)


def test_chance_removes_obstacles_by_seed():
    seen = set()
    for seed in range(30):
        log = run(SMART, CHANCE_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        seen.add(tuple(t["state"] for t in log["initial"]["tiles"]))
    # Все четыре расклада встречаются
    assert len(seen) == 4
    a = run(SMART, CHANCE_LEVEL, seed=4)
    b = run(SMART, CHANCE_LEVEL, seed=4)
    assert a["checksum"] == b["checksum"]


def test_absent_obstacle_is_walkable_and_not_jumpable():
    absent = next(s for s in range(30) if run("", CHANCE_LEVEL, seed=s)["initial"]["tiles"][0]["state"] == "absent")
    log = run('hero.jump("right")\nhero.move_right()\n', CHANCE_LEVEL, seed=absent)
    evs = events(log)
    assert evs[0]["type"] == "cannot_jump" and evs[0]["into"] == "floor"
    assert evs[1]["type"] == "move"


# --- завалы: обычный blocking, но случайный ---

FORK_LEVEL = {
    "id": "test-fork",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "R": "rubble", "F": "flag"},
        # К флагу вход только слева: иначе проверка «вниз» уже у флага была бы истинной
        "grid": "#######\n#.R..##\n#@.R.F#\n#.R..##\n#######\n",
    },
    "objects": {"rubble": {"blocking": True, "present": {"count": 2}}},
    "api": ["hero.move_right", "hero.move_up", "hero.move_down", "hero.can_move"],
    "goals": [{"reach": [5, 2]}],
}


def test_present_keeps_exactly_count_and_varies_by_seed():
    seen = set()
    for seed in range(30):
        log = run("", FORK_LEVEL, seed=seed)
        tiles = log["initial"]["tiles"]
        assert [t["kind"] for t in tiles] == ["rubble"] * 3
        states = tuple(t["state"] for t in tiles)
        assert states.count("present") == 2
        seen.add(states)
    assert len(seen) == 3


def test_present_rubble_blocks_and_absent_is_floor():
    log = run("hero.move_right()\nhero.move_right()\n", FORK_LEVEL, seed=0)
    middle = next(t for t in log["initial"]["tiles"] if t["y"] == 2)
    kinds = [e["type"] for e in events(log)][:2]
    assert kinds == (["move", "blocked"] if middle["state"] == "present" else ["move", "move"])


def test_three_ifs_take_the_open_exit():
    src = (
        "hero.move_right()\n"
        'if hero.can_move("up"):\n    hero.move_up()\n    hero.move_right(2)\n    hero.move_down()\n    hero.move_right()\n'
        'if hero.can_move("right"):\n    hero.move_right(3)\n'
        'if hero.can_move("down"):\n    hero.move_down()\n    hero.move_right(2)\n    hero.move_up()\n    hero.move_right()\n'
    )
    for seed in range(20):
        log = run(src, FORK_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        assert not any(e["type"] == "blocked" for e in events(log)), seed


# --- запертые ворота и say ---

LOCK_LEVEL = {
    "id": "test-lock",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "D": "door", "F": "flag"},
        "grid": "########\n#@.D.DF#\n########\n",
    },
    "objects": {"door": {"password": "сезам"}},
    "api": ["hero.move_right", "hero.say"],
    "goals": [{"reach": [6, 1]}],
}


def test_locked_door_blocks_until_the_word_is_said_next_to_it():
    log = run("hero.move_right(2)\n", LOCK_LEVEL)
    assert events(log)[-2] == {"type": "blocked", "who": "hero", "dir": "right", "into": "door"}
    src = 'word = "сезам"\nhero.move_right()\nhero.say(word)\nhero.move_right(2)\nhero.say(word)\nhero.move_right(2)\n'
    log = run(src, LOCK_LEVEL)
    assert log["outcome"] == {"status": "win", "reason": None}
    says = [e for e in events(log) if e["type"] == "say"]
    assert says[0] == {"type": "say", "who": "hero", "text": "сезам", "opened": [[3, 1]]}
    assert says[1]["opened"] == [[5, 1]]
    tiles = log["frames"][-1]["world"]["tiles"]
    assert [t["state"] for t in tiles] == ["open", "open"]
    assert "left" not in tiles[0]


def test_wrong_word_or_far_away_opens_nothing():
    log = run('hero.say("сезам")\nhero.move_right()\nhero.say("Сезам")\nhero.say(42)\n', LOCK_LEVEL)
    says = [e for e in events(log) if e["type"] == "say"]
    assert [s["opened"] for s in says] == [[], [], []]
    assert says[2]["text"] == "42"
    assert log["frames"][-1]["world"]["tiles"][0]["state"] == "closed"


def test_say_costs_a_tick_but_no_energy():
    log = run('hero.say("привет")\n', LOCK_LEVEL)
    assert log["metrics"]["ticks"] == 1
    assert energy(log, 0) == 20


def test_variable_is_visible_in_frames():
    log = run('word = "сезам"\nhero.say(word)\n', LOCK_LEVEL)
    assert log["frames"][1]["vars"] == {"word": "сезам"}


# --- свиток: take возвращает пароль ---

SCROLL_LEVEL = {
    "id": "test-scroll",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "S": "scroll", "D": "door", "F": "flag"},
        "grid": "########\n#@S.DF.#\n########\n",
    },
    "objects": {
        "door": {"password": ["сезам", "фонарь", "ключ"]},
        "scroll": {"pickable": True, "reveals": "door"},
    },
    "api": ["hero.move_right", "hero.take", "hero.say"],
    "goals": [{"reach": [5, 1]}],
}

SCROLL_SRC = "hero.move_right()\nword = hero.take()\nhero.move_right()\nhero.say(word)\nhero.move_right(2)\n"


def test_take_returns_the_scroll_word_and_it_opens_the_door():
    words = set()
    for seed in range(30):
        log = run(SCROLL_SRC, SCROLL_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        word = log["frames"][-1]["vars"]["word"]
        assert word in ("сезам", "фонарь", "ключ")
        words.add(word)
        say = next(e for e in events(log) if e["type"] == "say")
        assert say["text"] == word and say["opened"] == [[4, 1]]
    assert words == {"сезам", "фонарь", "ключ"}


def test_hardcoded_word_does_not_always_work():
    outcomes = {run('hero.move_right(2)\nhero.say("сезам")\nhero.move_right(2)\n', SCROLL_LEVEL, seed=s)["outcome"]["status"] for s in range(30)}
    assert outcomes == {"win", "lose"}


def test_plain_items_still_return_true():
    log = run("hero.move_right()\nok = hero.take()\nok\n", COIN_LEVEL)
    assert log["frames"][-1]["vars"]["ok"] is True


# --- пустой свиток ---

BLANK_LEVEL = {
    "id": "test-blank",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "S": "scroll", "D": "door", "F": "flag"},
        "grid": "#########\n#@S.S.DF#\n#########\n",
    },
    "objects": {
        "door": {"password": ["сезам", "фонарь"]},
        "scroll": {"pickable": True, "reveals": "door", "blank": {"count": 1}},
    },
    "api": ["hero.move_right", "hero.take", "hero.say"],
    "goals": [{"reach": [7, 1]}],
}

PICK_THE_WRITTEN = (
    "hero.move_right()\nfirst = hero.take()\nhero.move_right(2)\nsecond = hero.take()\nhero.move_right()\n"
    'if first == "":\n    hero.say(second)\nelse:\n    hero.say(first)\nhero.move_right(2)\n'
)


def test_one_scroll_is_blank_and_which_one_varies():
    blanks = set()
    for seed in range(30):
        log = run(PICK_THE_WRITTEN, BLANK_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        v = log["frames"][-1]["vars"]
        assert "" in (v["first"], v["second"]) and (v["first"] or v["second"]) in ("сезам", "фонарь")
        blanks.add("first" if v["first"] == "" else "second")
    assert blanks == {"first", "second"}


def test_always_saying_the_first_scroll_fails_sometimes():
    src = "hero.move_right()\nfirst = hero.take()\nhero.move_right(3)\nhero.say(first)\nhero.move_right(2)\n"
    assert {run(src, BLANK_LEVEL, seed=s)["outcome"]["status"] for s in range(30)} == {"win", "lose"}


# --- числа на предметах и вычисляемый пароль ---

TOLL_LEVEL = {
    "id": "test-toll",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "B": "bag", "S": "note", "D": "guard", "F": "flag"},
        "grid": "#########\n#@B.S.DF#\n#########\n",
    },
    "objects": {
        "bag": {"pickable": True, "gives": [7, 8, 9], "icon": "sack"},
        "note": {"pickable": True, "gives": [2, 3, 4], "icon": "scroll"},
        "guard": {"password": {"subtract": ["bag", "note"]}},
    },
    "api": ["hero.move_right", "hero.take", "hero.say"],
    "goals": [{"reach": [7, 1]}],
}

PAY = (
    "hero.move_right()\ncoins = hero.take()\nhero.move_right(2)\nneed = hero.take()\n"
    "hero.move_right()\npay = coins - need\nhero.say(pay)\nhero.move_right(2)\n"
)


def test_take_returns_numbers_and_the_difference_opens_the_guard():
    seen = set()
    for seed in range(30):
        log = run(PAY, TOLL_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        v = log["frames"][-1]["vars"]
        assert v["coins"] in (7, 8, 9) and v["need"] in (2, 3, 4) and v["pay"] == v["coins"] - v["need"]
        say = next(e for e in events(log) if e["type"] == "say")
        assert say["text"] == str(v["pay"]) and say["opened"] == [[6, 1]]
        seen.add((v["coins"], v["need"]))
    assert len(seen) > 4


def test_guessing_the_number_fails_sometimes():
    src = "hero.move_right(5)\nhero.say(5)\nhero.move_right(2)\n"
    assert {run(src, TOLL_LEVEL, seed=s)["outcome"]["status"] for s in range(30)} == {"win", "lose"}


# --- look, два мешка и heavy ---

BAGS_LEVEL = {
    "id": "test-bags",
    "map": {
        "legend": {"#": "wall", ".": "floor", "@": "hero", "B": "bag", "D": "guard", "F": "flag"},
        "grid": "##########\n#@.B.B.DF#\n##########\n",
    },
    "objects": {
        "bag": {"pickable": True, "gives": [5, 6, 7, 8], "icon": "sack", "heavy": True},
        "guard": {"password": {"max": "bag"}},
    },
    "api": ["hero.move_right", "hero.move_left", "hero.take", "hero.look", "hero.say"],
    "goals": [{"reach": [8, 1]}],
}

PICK_BIGGER = (
    "hero.move_right(2)\nfirst = hero.look()\nhero.move_right(2)\nsecond = hero.look()\n"
    "if first > second:\n    hero.move_left(2)\n    coins = hero.take()\n    hero.move_right(3)\n"
    "else:\n    coins = hero.take()\n    hero.move_right()\n"
    "hero.say(coins)\nhero.move_right(2)\n"
)


def test_look_reads_without_taking_and_costs_nothing():
    log = run("hero.move_right(2)\nn = hero.look()\nn\n", BAGS_LEVEL)
    look = next(e for e in events(log) if e["type"] == "look")
    assert look["item"] == "bag-1" and look["value"] in (5, 6, 7, 8)
    assert log["frames"][-1]["vars"]["n"] == look["value"]
    assert log["frames"][-1]["world"]["items"][0]["taken"] is False
    assert log["metrics"]["ticks"] == 2
    log = run("x = hero.look()\nx\n", BAGS_LEVEL)
    assert log["frames"][-1]["vars"]["x"] is False


def test_bags_differ_and_the_bigger_one_opens_the_guard():
    orders = set()
    for seed in range(30):
        log = run(PICK_BIGGER, BAGS_LEVEL, seed=seed)
        assert log["outcome"]["status"] == "win", seed
        v = log["frames"][-1]["vars"]
        assert v["first"] != v["second"] and v["coins"] == max(v["first"], v["second"])
        orders.add(v["first"] > v["second"])
    assert orders == {True, False}


def test_smaller_bag_does_not_pass():
    src = "hero.move_right(2)\ncoins = hero.take()\nhero.move_right(4)\nhero.say(coins)\nhero.move_right(2)\n"
    assert {run(src, BAGS_LEVEL, seed=s)["outcome"]["status"] for s in range(30)} == {"win", "lose"}


def test_second_heavy_item_does_not_fit_in_hands():
    log = run("hero.move_right(2)\nhero.take()\nhero.move_right(2)\nok = hero.take()\nok\n", BAGS_LEVEL)
    evs = [e["type"] for e in events(log)]
    assert evs.count("pickup") == 1 and "hands_full" in evs
    assert log["frames"][-1]["vars"]["ok"] is False
    assert [i["taken"] for i in log["frames"][-1]["world"]["items"]] == [True, False]
