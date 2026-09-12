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
