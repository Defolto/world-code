"""Тесты бэкенда.

Проверяем ровно то, что легко сломать молча: заголовки кэша. Ошибка здесь
не падает, а тихо заставляет каждого ребёнка качать сборку заново — и
узнаем мы об этом по счёту за трафик, а не по красной сборке.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Приложение поверх временной папки, похожей на реальную сборку Vite."""
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>мирКод</title>", encoding="utf-8")

    assets = static / "assets"
    assets.mkdir()
    (assets / "index-BMxiUNYd.js").write_text("console.log(1)", encoding="utf-8")
    (assets / "index-CWyHqmJp.css").write_text("body{}", encoding="utf-8")
    (static / "favicon.svg").write_text("<svg/>", encoding="utf-8")

    monkeypatch.setenv("STATIC_DIR", str(static))

    # Модуль читает переменную окружения на импорте, поэтому перезагружаем
    from server import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health_sees_frontend(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["static_ready"] is True


def test_index_is_served_at_root(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "мирКод" in response.text


def test_hashed_asset_is_cached_forever(client: TestClient) -> None:
    """Файл с хэшем в имени неизменен — браузер не должен его перепроверять."""
    response = client.get("/assets/index-BMxiUNYd.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]
    assert "max-age=31536000" in response.headers["cache-control"]


def test_index_is_always_revalidated(client: TestClient) -> None:
    """index.html обязан перепроверяться, иначе деплой не доедет до людей."""
    response = client.get("/")
    assert response.headers["cache-control"] == "no-cache"


def test_unhashed_file_is_not_cached_forever(client: TestClient) -> None:
    response = client.get("/favicon.svg")
    assert response.headers["cache-control"] == "no-cache"


def test_missing_file_is_404(client: TestClient) -> None:
    assert client.get("/nothing-here.js").status_code == 404
