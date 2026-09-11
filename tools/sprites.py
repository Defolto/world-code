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

    backend/.venv/Scripts/python tools/sprites.py characters
    backend/.venv/Scripts/python tools/sprites.py characters --preview <каталог>
    backend/.venv/Scripts/python tools/sprites.py items

Персонажи — по листу разбивки на каждого: assets/src/characters/<id>/parts.png.
Все в один атлас: у всех один риг, отличаются только картинки.

Результат — frontend/src/assets/sprites/characters.png + characters.json и
items.png + items.json. Атласы коммитятся: сборка фронтенда не должна
зависеть от Python-инструментов.
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
# непрозрачного ряда (плечо, бедро), "bottom" — центр нижнего (подол),
# "neck" — самая нижняя точка в средней полосе по ширине: у головы низ
# картинки может быть косой или хвостом, а шея всегда под лицом.
CANON = {
    "head": (49, "neck"),
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
# Сколько ноги оставить под подолом. Полная нога от бедра (19 px скрыто)
# при махе на 26° выезжала верхом из-под туники сбоку, на уровне пояса —
# казалось, что нога приделана к боку. Ось ставим ближе к подолу, лишний
# верх обрезаем: на виде сбоку он всё равно невидим.
LEG_HIDDEN = 8
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

# ─────────────────────────── Предметы ───────────────────────────
#
# Предмет лежит в assets/src/<слот>/<id>.png, один на картинку. Размер
# задаёт холст слота, а не картинка: модель рисует предмет во весь кадр,
# и «в масштабе референса» не держит — меч выходил ростом с героя.
# Высота — в пикселях атласа, точка крепления — правило по слоту:
#   "bottom"  — центр нижнего ряда (шлем на макушку, доспех на бедро);
#   "top"     — центр верхнего ряда (сапог, плащ за плечи);
#   ("grip", k) — кисть на рукояти: центр по ширине, k высоты от низа.
SLOTS = {
    "weapon": (64, ("grip", 0.22)),
    "helmet": (30, "bottom"),
    "armor": (44, "bottom"),
    "boots": (14, "top"),
    "cape": (60, "top"),
}


# ─────────────────────────── Вырезание фона ───────────────────────────


def erode(mask: np.ndarray, r: int) -> np.ndarray:
    """Сжать маску на r пикселей (минимум по квадратному окну)."""
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out &= np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
    return out


def key_magenta(rgb: np.ndarray) -> np.ndarray:
    """RGB uint8 → RGBA float, фон #FF00FF прозрачный, край без бахромы.

    «Пурпурность» пикселя — min(R, B) − G: на фоне ≈ 255, у кожи, дерева,
    синего и чёрного контура ≈ 0. Но у краевого пикселя (фон, смешанный с
    тёмным контуром) она 60–130 — ровно как у тёмно-фиолетовой ткани.
    По цвету их не различить, только по месту: край — это полоса у границы
    с фоном, ткань — внутри. Поэтому два прохода:

    1. жёсткая маска: фон — всё, что почти чистый пурпур;
    2. в кольце шириной в пару пикселей вдоль границы — мягкая альфа по
       пурпурности и despill (вычитаем долю фона из цвета). Внутренние
       пиксели не трогаем, какого бы цвета они ни были.

    JPEG-артефакты вокруг контура попадают в кольцо, поэтому формат
    исходника не важен.
    """
    a = rgb.astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    excess = np.minimum(r, b) - g

    solid = excess < 150
    interior = erode(solid, 2)
    ring = solid & ~interior

    soft = 1.0 - np.clip((excess - 20.0) / (200.0 - 20.0), 0.0, 1.0)
    alpha = np.where(interior, 1.0, np.where(ring, soft, 0.0))

    key = np.array([255.0, 0.0, 255.0])
    al = alpha[..., None]
    despilled = np.clip((a - (1 - al) * key) / np.maximum(al, 0.02), 0, 255)
    color = np.where(ring[..., None], despilled, a)
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


def pivot_of(rgba: np.ndarray, where: str | tuple[str, float]) -> tuple[float, float]:
    """Центр крайнего непрозрачного ряда: у ноги и руки — верх, у головы
    и торса — низ. Это и есть сустав: бедро, плечо, шея, подол.
    ("grip", k) — точка на оси предмета на k высоты от нижнего края."""
    alpha = rgba[..., 3] > 64
    if isinstance(where, tuple):
        _, k = where
        return (rgba.shape[1] / 2, rgba.shape[0] * (1 - k))
    if where == "neck":
        w = alpha.shape[1]
        band = alpha[:, int(w * 0.35) : int(w * 0.75)]
        row = int(np.where(band.any(axis=1))[0].max())
        xs = np.where(band[row])[0] + int(w * 0.35)
        return ((xs.min() + xs.max()) / 2 + 0.5, float(row) + 1)
    row = 0 if where == "top" else alpha.shape[0] - 1
    xs = np.where(alpha[row])[0]
    if len(xs) == 0:
        return (rgba.shape[1] / 2, float(row))
    return ((xs.min() + xs.max()) / 2 + 0.5, float(row) + (0 if where == "top" else 1))


def fit(rgba: np.ndarray, target_h: int, where: str | tuple[str, float] = "bottom") -> Image.Image:
    """Обрезать по альфе и привести к высоте, сохранив пропорции.

    Для головы высота меряется до шеи, а не до низа картинки: коса или
    хвост ниже шеи не должны уменьшать лицо."""
    piece = trim(rgba)
    measured = pivot_of(piece, where)[1] if where == "neck" else piece.shape[0]
    scale = target_h / measured
    img = Image.fromarray(piece.astype(np.uint8), "RGBA")
    size = (max(1, round(piece.shape[1] * scale)), max(1, round(piece.shape[0] * scale)))
    return img.resize(size, Image.Resampling.LANCZOS)


def cut_sheet(path: Path) -> list[Part]:
    rgba = key_magenta(np.asarray(Image.open(path).convert("RGB")))
    boxes = reading_order(components(rgba[..., 3]))
    if len(boxes) != len(SHEET_ORDER):
        sys.exit(f"{path.name}: найдено частей {len(boxes)}, ожидалось {len(SHEET_ORDER)}: {boxes}")

    parts = []
    for name, (x0, y0, x1, y1) in zip(SHEET_ORDER, boxes, strict=True):
        piece = rgba[y0:y1, x0:x1]
        target_h, where = CANON[name]
        if name in DIM:
            piece = piece.copy()
            piece[..., :3] *= DIM[name]
        img = fit(piece, target_h, where)
        if name.startswith("leg_"):
            img = img.crop((0, HEM_BELOW_HIP - LEG_HIDDEN, img.width, img.height))
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
        "leg_front": [float(LEG_BACK_SHIFT + LEG_SPREAD), float(HEM_BELOW_HIP - LEG_HIDDEN)],
        "leg_back": [float(LEG_BACK_SHIFT - LEG_SPREAD), float(HEM_BELOW_HIP - LEG_HIDDEN)],
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


def build_characters(preview_dir: Path | None) -> None:
    # Эталон — первым: он же персонаж по умолчанию в демке
    sheets = sorted(
        (SRC / "characters").glob("*/parts.png"), key=lambda p: (p.parent.name != "hero", p)
    )
    if not sheets:
        sys.exit(f"нет персонажей: положите лист разбивки в {SRC}/characters/<id>/parts.png")

    all_parts: list[Part] = []
    characters: dict[str, dict] = {}
    for sheet in sheets:
        cid = sheet.parent.name
        parts = cut_sheet(sheet)
        by_name = {p.name: p for p in parts}
        rig = build_rig(by_name)
        feet = feet_y(by_name, rig)
        top = min(rig[n][1] - by_name[n].pivot[1] for n in by_name)
        characters[cid] = {
            "body": {"top": round(top, 1), "feet": round(feet, 1)},
            "rig": {k: [round(v[0], 1), round(v[1], 1)] for k, v in rig.items()},
            "parts": [p.name for p in parts],
        }
        # В общем атласе части разных персонажей различаются префиксом
        all_parts.extend(Part(f"{cid}/{p.name}", p.image, p.pivot) for p in parts)
        print(f"{sheet.relative_to(ROOT)}: тело {top:.0f}…{feet:.0f}")
        if preview_dir:
            preview_dir.mkdir(parents=True, exist_ok=True)
            preview(by_name, rig, preview_dir / f"{cid}.png")

    atlas, frames = pack(all_parts)
    for cid, char in characters.items():
        char["frames"] = {name: frames[f"{cid}/{name}"] for name in char.pop("parts")}

    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "characters.png", optimize=True)
    (OUT / "characters.json").write_text(
        json.dumps(
            {
                "image": "characters.png",
                "cell": CELL,
                "size": [atlas.width, atlas.height],
                "layers": LAYERS,
                "characters": characters,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(characters)} перс. → {OUT.relative_to(ROOT)}/characters.png {atlas.size}")
    if preview_dir:
        print(f"превью: {preview_dir}")


def build_items() -> None:
    parts: list[Part] = []
    slots: dict[str, str] = {}
    for slot, (target_h, where) in SLOTS.items():
        for path in sorted((SRC / slot).glob("*.png")):
            rgba = key_magenta(np.asarray(Image.open(path).convert("RGB")))
            img = fit(rgba, target_h)
            parts.append(Part(path.stem, img, pivot_of(np.asarray(img), where)))
            slots[path.stem] = slot
    if not parts:
        sys.exit(f"нет предметов: положите PNG в {SRC}/<слот>/")

    atlas, frames = pack(parts)
    for name, frame in frames.items():
        frame["slot"] = slots[name]
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "items.png", optimize=True)
    (OUT / "items.json").write_text(
        json.dumps(
            {
                "image": "items.png",
                "cell": CELL,
                "size": [atlas.width, atlas.height],
                "frames": frames,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"{len(parts)} предм. → {OUT.relative_to(ROOT)}/items.png {atlas.size}: {', '.join(frames)}"
    )


def main() -> None:
    # Консоль Windows по умолчанию в cp1251 и падает на стрелках в выводе
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("what", choices=["characters", "items"], help="что собирать")
    ap.add_argument(
        "--preview", type=Path, help="каталог: сохранить каждого собранного персонажа в PNG"
    )
    args = ap.parse_args()
    if args.what == "characters":
        build_characters(args.preview)
    else:
        build_items()


if __name__ == "__main__":
    main()
