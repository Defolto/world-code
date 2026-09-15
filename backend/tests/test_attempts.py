"""Прохождения уровней: запись в файл и пароль на просмотр.

Главное, что тут проверяется, — что данные не утекут: без пароля ни
страница, ни JSON не отдаются, а без настроенного пароля — тем более.
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

ATTEMPT = {
    "level": "start-01",
    "student": "abc123",
    "passed": True,
    "code": "step()\nstep()\n",
    "runs": [{"status": "error", "error": {"type": "SyntaxError"}}, {"status": "win"}],
    "seconds": 42,
}


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    static = tmp_path / "static"
    (static / "stats").mkdir(parents=True)
    (static / "index.html").write_text("<title>мирКод</title>", encoding="utf-8")
    (static / "stats" / "index.html").write_text("<title>Статистика</title>", encoding="utf-8")
    monkeypatch.setenv("STATIC_DIR", str(static))
    data = tmp_path / "data"
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("STATS_PASSWORD", "secret")
    return data


@pytest.fixture
def client(data_dir: Path) -> TestClient:
    from server import attempts, main

    importlib.reload(attempts)
    importlib.reload(main)
    return TestClient(main.app)


def test_attempt_is_appended_as_json_line(client: TestClient, data_dir: Path) -> None:
    assert client.post("/api/attempts", json=ATTEMPT).status_code == 204
    assert client.post("/api/attempts", json=ATTEMPT).status_code == 204

    lines = (data_dir / "attempts.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    saved = json.loads(lines[0])
    assert saved["level"] == "start-01"
    assert saved["runs"][0]["error"]["type"] == "SyntaxError"
    # Время ставит сервер
    assert "received_at" in saved


def test_recording_needs_no_password(client: TestClient) -> None:
    """Ребёнок пароля не знает — запись открыта, закрыт только просмотр."""
    assert client.post("/api/attempts", json=ATTEMPT).status_code == 204


def test_garbage_is_rejected(client: TestClient, data_dir: Path) -> None:
    assert client.post("/api/attempts", content=b"not json").status_code == 400
    assert client.post("/api/attempts", json={"level": "x"}).status_code == 400
    assert client.post("/api/attempts", json=[1, 2]).status_code == 400
    assert not (data_dir / "attempts.jsonl").exists()


def test_beacon_without_json_content_type(client: TestClient, data_dir: Path) -> None:
    """При уходе со страницы запись шлёт sendBeacon — заголовок у него
    свой, тело мы всё равно разбираем как JSON."""
    body = json.dumps({**ATTEMPT, "passed": False}).encode()
    response = client.post("/api/attempts", content=body, headers={"Content-Type": "text/plain"})
    assert response.status_code == 204
    saved = json.loads((data_dir / "attempts.jsonl").read_text(encoding="utf-8"))
    assert saved["passed"] is False


def test_view_requires_password(client: TestClient) -> None:
    for path in ("/stats/", "/stats/index.html"):
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.headers["www-authenticate"].startswith("Basic")

    assert client.get("/stats/data", auth=("any", "wrong")).status_code == 401
    # Читать записи через адрес для записи нельзя
    assert client.get("/api/attempts").status_code == 404


def test_data_does_not_trigger_browser_prompt(client: TestClient) -> None:
    """401 на данные — без WWW-Authenticate: поле пароля рисует страница,
    а не браузер (в деве страница открыта, и окно Chrome только мешает)."""
    response = client.get("/stats/data")
    assert response.status_code == 401
    assert "www-authenticate" not in response.headers


def test_view_with_password(client: TestClient) -> None:
    client.post("/api/attempts", json=ATTEMPT)

    response = client.get("/stats/data", auth=("admin", "secret"))
    assert response.status_code == 200
    assert response.json()[0]["student"] == "abc123"

    page = client.get("/stats/", auth=("admin", "secret"))
    assert page.status_code == 200
    assert "Статистика" in page.text


def test_view_is_closed_without_configured_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("STATS_PASSWORD")
    # Даже с «правильным» пустым паролем — нет
    assert client.get("/stats/data", auth=("admin", "")).status_code == 503
    assert client.get("/stats/").status_code == 503


def test_delete_removes_only_that_line(client: TestClient, data_dir: Path) -> None:
    client.post("/api/attempts", json=ATTEMPT)
    client.post("/api/attempts", json={**ATTEMPT, "student": "other"})
    auth = ("a", "secret")

    first, second = client.get("/stats/data", auth=auth).json()
    assert first["id"] != second["id"]

    assert client.delete(f"/stats/data/{first['id']}", auth=auth).status_code == 204
    left = client.get("/stats/data", auth=auth).json()
    assert [a["student"] for a in left] == ["other"]
    assert left[0]["id"] == second["id"], "id устойчив: хэш строки, а не её номер"

    lines = (data_dir / "attempts.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert not list(data_dir.glob(".attempts-*")), "временный файл подменил основной"

    assert client.delete(f"/stats/data/{first['id']}", auth=auth).status_code == 404


def test_delete_requires_password(client: TestClient) -> None:
    client.post("/api/attempts", json=ATTEMPT)
    (record,) = client.get("/stats/data", auth=("a", "secret")).json()

    response = client.delete(f"/stats/data/{record['id']}")
    assert response.status_code == 401
    assert "www-authenticate" not in response.headers
    assert len(client.get("/stats/data", auth=("a", "secret")).json()) == 1


def test_broken_line_is_skipped(client: TestClient, data_dir: Path) -> None:
    client.post("/api/attempts", json=ATTEMPT)
    with (data_dir / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write('{"level": "cut off')  # процесс упал посреди записи
    assert len(client.get("/stats/data", auth=("a", "secret")).json()) == 1


def test_rest_of_site_is_open(client: TestClient) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/health").status_code == 200
