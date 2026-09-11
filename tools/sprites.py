"""Конвейер спрайтов: из картинок от ИИ — в атлас для рендера.

Что делает (см. generatsiya-grafiki.md, раздел «Конвейер»):

1. вырезает пурпурный фон #FF00FF и снимает пурпурную бахрому с края;
2. находит части на листе разбивки как связные области и раскладывает
   их по именам в порядке чтения — как в промпте C;
3. масштабирует каждую часть под канон рига (поштучно: модель ошибается
   в длине конечностей, и это штатно);
4. считает точки крепления и позиции суставов;
5. пакует в один PNG и пишет JSON с координатами.

Запуск из корня репозитория:

    backend/.venv/Scripts/python tools/sprites.py hero
    backend/.venv/Scripts/python tools/sprites.py hero --preview out.png

Результат — frontend/src/assets/sprites/hero.png и hero.json. Атлас
коммитится: сборка фронтенда не должна зависеть от Python-инструментов.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "src"
OUT = ROOT / "frontend" / "src" / "assets" / "sprites"

# ─────────────────────────── Канон рига ───────────────────────────
#
# Единицы — пиксели атласа: 2× к экрану, 160 px на клетку, тело ~120 px.
# Высоты частей сняты с эталона hero_base.png (820 px → 120 px, k ≈ 0.146),
# руки приведены к длине с эталона, а не с листа разбивки — там они
# вышли на четверть длиннее.
CELL = 160

# Порядок — порядок чтения на листе разбивки (промпт C): верхний ряд слева
# направо, потом нижний.
SHEET_ORDER = ["head", "torso", "arm_front", "arm_back", "leg_front", "leg_back"]

# Целевая высота части и где у неё точка крепления: "top" — центр верхнего
# непрозрачного ряда (плечо, бедро), "bottom" — центр нижнего (шея, подол).
CANON = {
    "head": (49, "bottom"),
    "torso": (50, "bottom"),
    "arm_front": (40, "top"),
    "arm_back": (40, "top"),
    "leg_front": (51, "top"),
    "leg_back": (51, "top"),
}

# Позиции суставов в координатах героя: начало — бедро, y вниз.
# Подол торса на 19 px ниже бедра — столько ноги скрыто под туникой
# (на эталоне видно 32 px ноги из 51). Шея и плечи считаются от торса
# в build_rig(), потому что зависят от формы конкретной картинки.
HEM_BELOW_HIP = 19
LEG_SPREAD = 4
LEG_BACK_SHIFT = -3  # ноги чуть назад: центр туники не над центром бёдер
ARM_SPREAD = 5
# Дальнее плечо ближе к шее, чем ближнее: в передней фазе шага кисть
# задней руки должна выглядывать из-за груди, иначе рука видна только
# уходящей назад и кажется, что она качается не в ту сторону.
ARM_BACK_SPREAD = 2
SHOULDER_BELOW_TORSO_TOP = 6
NECK_OVERLAP = 3
HEAD_FORWARD = 7  # лицо выступает вперёд над грудью, а не сидит по центру шеи

# Порядок слоёв снизу вверх. Предмет попадает в свой слой и не спорит.
LAYERS = ["arm_back", "leg_back", "leg_front", "torso", "head", "arm_front"]

# Дальние конечности темнее ближних — иначе на виде сбоку они сливаются.
# Запекается в атлас: CSS-фильтр на анимируемой группе дрожит по пикселям.
DIM = {"arm_back": 0.8, "leg_back": 0.8}

PAD = 2


# ─────────────────────────── Вырезание фона ───────────────────────────


def key_magenta(rgb: np.ndarray) -> np.ndarray:
    """RGB uint8 → RGBA float, фон #FF00FF прозрачный, край без бахромы.

    «Пурпурность» пикселя — min(R, B) − G: на фоне ≈ 255, на любом цвете
    персонажа (кожа, коричневый, синий, чёрный контур) ≤ 20. Между ними —
    сглаженный край, и там альфа берётся линейно. JPEG-артефакты вокруг
    контура попадают в тот же диапазон, поэтому формат исходника не важен.
    """
    a = rgb.astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    excess = np.minimum(r, b) - g
    alpha = 1.0 - np.clip((excess - 20.0) / (180.0 - 20.0), 0.0, 1.0)

    # Despill: краевой пиксель — смесь цвета персонажа и фона. Вычитаем
    # долю фона и делим на альфу, иначе по контуру остаётся розовый ореол.
    key = np.array([255.0, 0.0, 255.0])
    al = alpha[..., None]
    color = np.where(al > 0.02, (a - (1 - al) * key) / np.maximum(al, 0.02), a)
    color = np.clip(color, 0, 255)
    return np.dstack([color, alpha * 255.0])


Box = tuple[int, int, int, int]


def components(alpha: np.ndarray, step: int = 4, min_cells: int = 30) -> list[Box]:
    """Прямоугольники связных областей по загрублённой маске. Части на
    листе лежат с запасом, так что шаг 4 ничего не склеивает."""
    m = alpha[::step, ::step] > 127
    h, w = m.shape
    seen = np.zeros_like(m)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not m[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            ys, xs = [], []
            while q:
                cy, cx = q.popleft()
                ys.append(cy)
                xs.append(cx)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(ys) >= min_cells:
                x0, y0 = max(0, min(xs) * step - step), max(0, min(ys) * step - step)
                x1, y1 = (max(xs) + 2) * step, (max(ys) + 2) * step
                boxes.append((x0, y0, x1, y1))
    return boxes


def reading_order(boxes: list[Box]) -> list[Box]:
    """Ряды — по центру по вертикали, внутри ряда — слева направо."""
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows: list[list[Box]] = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - (rows[-1][0][1] + rows[-1][0][3]) / 2) < (b[3] - b[1]) * 0.6:
            rows[-1].append(b)
        else:
            rows.append([b])
    return [b for row in rows for b in sorted(row, key=lambda b: b[0])]


# ─────────────────────────── Части ───────────────────────────


@dataclass
class Part:
    name: str
    image: Image.Image  # RGBA, уже в масштабе атласа
    pivot: tuple[float, float]  # точка крепления в пикселях части


def trim(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.where(rgba[..., 3] > 8)
    return rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def pivot_of(rgba: np.ndarray, where: str) -> tuple[float, float]:
    """Центр крайнего непрозрачного ряда: у ноги и руки — верх, у головы
    и торса — низ. Это и есть сустав: бедро, плечо, шея, подол."""
    alpha = rgba[..., 3] > 64
    row = 0 if where == "top" else alpha.shape[0] - 1
    xs = np.where(alpha[row])[0]
    if len(xs) == 0:
        return (rgba.shape[1] / 2, float(row))
    return ((xs.min() + xs.max()) / 2 + 0.5, float(row) + (0 if where == "top" else 1))


def cut_sheet(path: Path) -> list[Part]:
    rgba = key_magenta(np.asarray(Image.open(path).convert("RGB")))
    boxes = reading_order(components(rgba[..., 3]))
    if len(boxes) != len(SHEET_ORDER):
        sys.exit(f"{path.name}: найдено частей {len(boxes)}, ожидалось {len(SHEET_ORDER)}: {boxes}")

    parts = []
    for name, (x0, y0, x1, y1) in zip(SHEET_ORDER, boxes, strict=True):
        piece = trim(rgba[y0:y1, x0:x1])
        target_h, where = CANON[name]
        scale = target_h / piece.shape[0]
        if name in DIM:
            piece = piece.copy()
            piece[..., :3] *= DIM[name]
        img = Image.fromarray(piece.astype(np.uint8), "RGBA")
        img = img.resize(
            (max(1, round(piece.shape[1] * scale)), target_h), Image.Resampling.LANCZOS
        )
        parts.append(Part(name, img, pivot_of(np.asarray(img), where)))
    return parts


# ─────────────────────────── Риг ───────────────────────────


def build_rig(parts: dict[str, Part]) -> dict[str, list[float]]:
    """Куда ставить точку крепления каждой части, координаты героя.

    Бедро — начало координат. Торс висит подолом ниже бедра, шея и плечи
    считаются от его верхнего ряда: у картинки шея не по центру, а со
    стороны лица, и брать её из торса надёжнее, чем из константы.
    """
    torso = parts["torso"]
    torso_arr = np.asarray(torso.image)
    neck_x, _ = pivot_of(torso_arr, "top")
    hem_x, hem_y = torso.pivot
    torso_top_y = HEM_BELOW_HIP - hem_y  # верх картинки торса в координатах героя
    neck_dx = neck_x - hem_x

    return {
        "torso": [0.0, float(HEM_BELOW_HIP)],
        "head": [neck_dx + HEAD_FORWARD, torso_top_y + NECK_OVERLAP],
        "arm_front": [neck_dx + ARM_SPREAD, torso_top_y + SHOULDER_BELOW_TORSO_TOP],
        "arm_back": [neck_dx - ARM_BACK_SPREAD, torso_top_y + SHOULDER_BELOW_TORSO_TOP],
        "leg_front": [float(LEG_BACK_SHIFT + LEG_SPREAD), 0.0],
        "leg_back": [float(LEG_BACK_SHIFT - LEG_SPREAD), 0.0],
    }


# ─────────────────────────── Атлас ───────────────────────────


def pack(parts: list[Part]) -> tuple[Image.Image, dict[str, dict]]:
    """Одна полка: частей мало, хитрая упаковка не окупается."""
    width = sum(p.image.width + PAD for p in parts) + PAD
    height = max(p.image.height for p in parts) + 2 * PAD
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frames = {}
    x = PAD
    for p in parts:
        atlas.paste(p.image, (x, PAD))
        frames[p.name] = {
            "x": x,
            "y": PAD,
            "w": p.image.width,
            "h": p.image.height,
            "pivot": [round(p.pivot[0], 1), round(p.pivot[1], 1)],
        }
        x += p.image.width + PAD
    return atlas, frames


def feet_y(parts: dict[str, Part], rig: dict[str, list[float]]) -> float:
    """Нижняя точка ступней в координатах героя."""
    return max(
        rig[n][1] + parts[n].image.height - parts[n].pivot[1] for n in ("leg_front", "leg_back")
    )


def preview(parts: dict[str, Part], rig: dict[str, list[float]], path: Path, zoom: int = 4) -> None:
    """Собранный герой в клетке — проверить глазами, что суставы сошлись."""
    canvas = Image.new("RGBA", (CELL, CELL), (24, 34, 49, 255))
    # Ступни у нижнего края клетки с небольшим отступом
    feet = feet_y(parts, rig)
    ox, oy = CELL / 2, CELL - 6 - feet
    for name in LAYERS:
        p = parts[name]
        ax, ay = rig[name]
        pos = (round(ox + ax - p.pivot[0]), round(oy + ay - p.pivot[1]))
        canvas.alpha_composite(p.image, pos)
    canvas.resize((CELL * zoom, CELL * zoom), Image.Resampling.NEAREST).save(path)


def build_hero(preview_path: Path | None) -> None:
    sheet = SRC / "reference" / "hero_parts.png"
    parts = cut_sheet(sheet)
    by_name = {p.name: p for p in parts}
    rig = build_rig(by_name)
    atlas, frames = pack(parts)

    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "hero.png", optimize=True)
    feet = feet_y(by_name, rig)
    top = min(rig[n][1] - by_name[n].pivot[1] for n in by_name)
    (OUT / "hero.json").write_text(
        json.dumps(
            {
                "image": "hero.png",
                "cell": CELL,
                "size": [atlas.width, atlas.height],
                "body": {"top": round(top, 1), "feet": round(feet, 1)},
                "layers": LAYERS,
                "rig": {k: [round(v[0], 1), round(v[1], 1)] for k, v in rig.items()},
                "frames": frames,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"{sheet.relative_to(ROOT)} → {OUT.relative_to(ROOT)}/hero.png "
        f"{atlas.size}, тело {top:.0f}…{feet:.0f}"
    )
    if preview_path:
        preview(by_name, rig, preview_path)
        print(f"превью: {preview_path}")


def main() -> None:
    # Консоль Windows по умолчанию в cp1251 и падает на стрелках в выводе
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("what", choices=["hero"], help="что собирать")
    ap.add_argument("--preview", type=Path, help="сохранить собранного героя в PNG для проверки")
    args = ap.parse_args()
    build_hero(args.preview)


if __name__ == "__main__":
    main()
