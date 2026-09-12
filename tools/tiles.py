"""Плитки локации: шаблон для модели, нарезка её ответа в атлас, превью.

Вид сверху. Стена — масса скалы, коридор в ней облицован тёсаным камнем:
полоса одной ширины вдоль каждой стороны стены, обращённой к полу, и
угловой блок там, где полоса поворачивает (внешний угол стены) или где
пол только по диагонали (внутренний угол коридора). Рендер
(frontend/src/components/Tiles.tsx) собирает это из кусков атласа: скала,
три полосы, угловой блок, пол. Тени на полу, валуны и уход в темноту
рендер рисует сам, модели они не нужны.

Модель не умеет рисовать стыкующиеся куски по отдельности, поэтому ей
отдаётся карта-шаблон: серая раскладка 8×8 — скала, пол, облицовка с
угловыми блоками — которую она раскрашивает целиком. Скрипт вырезает
куски из известных клеток: полосу — из верхнего края стены, у которой
открыт только верх; угол — из клетки с двумя открытыми сторонами; скалу —
из клетки, окружённой стенами; пол — из нижних рядов.

Запуск из корня репозитория:

    backend/.venv/Scripts/python tools/tiles.py template
    backend/.venv/Scripts/python tools/tiles.py build dungeon
    backend/.venv/Scripts/python tools/tiles.py preview dungeon <каталог>

`template` пишет assets/src/tiles/template.png, `build` режет лист набора
assets/src/tiles/<набор>/sheet.png в атлас frontend/src/assets/tiles/<набор>.png
+ .json, `preview` рисует уровни из content/ плитками набора.

Лист от модели — квадрат любого размера, кратного 8 (1024 → 128 px на
клетку, 2048 → 256). В атласе клетка 160 px — 2× к экрану, как у спрайтов.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "src" / "tiles"
OUT = ROOT / "frontend" / "src" / "assets" / "tiles"

N, E, S, W = 1, 2, 4, 8
CELL = 160  # пиксели атласа, 2× к экрану
GRID = 8
# Зазор между кадрами атласа, заполненный продлёнными крайними пикселями
GUTTER = 8

# Раскладка шаблона: '#' — стена, '.' — пол. Блок 3×3 даёт прямые полосы,
# внешние углы и скалу в центре; отрезки — тупики; столб — блок с четырьмя
# полосами. Пол вокруг — образцы пола.
LAYOUT = [
    "........",
    ".###..#.",
    ".###....",
    ".###.#..",
    ".....#..",
    ".###.#..",
    "........",
    "........",
]

# Ширина облицовки — доля клетки, как BAND в frontend/src/components/Tiles.tsx
BAND = 0.375

# Откуда резать куски: клетки раскладки
BAND_CELL = (2, 1)  # верхний край блока: открыт только верх — полоса во всю клетку
CORNER_CELL = (1, 1)  # левый верхний угол блока: угловой блок и полоса при одном угле
PILLAR_CELL = (6, 1)  # столб: полоса между двумя углами
ROCK_CELL = (2, 2)  # центр блока: стены со всех сторон
FLOOR_VARIANTS = 8


def is_wall(x: int, y: int) -> bool:
    return 0 <= x < GRID and 0 <= y < GRID and LAYOUT[y][x] == "#"


def wall_mask(x: int, y: int) -> int:
    return (
        (N if is_wall(x, y - 1) else 0)
        | (E if is_wall(x + 1, y) else 0)
        | (S if is_wall(x, y + 1) else 0)
        | (W if is_wall(x - 1, y) else 0)
    )


def check_layout() -> None:
    assert wall_mask(*BAND_CELL) == E | S | W, "BAND_CELL: открыт должен быть только верх"
    assert wall_mask(*CORNER_CELL) == E | S, "CORNER_CELL: открыты верх и лево"
    assert wall_mask(*PILLAR_CELL) == 0, "PILLAR_CELL: открыто всё"
    assert wall_mask(*ROCK_CELL) == 15, "ROCK_CELL: стены со всех сторон"


def floor_cells() -> list[tuple[int, int]]:
    # Снизу вверх: нижние ряды — чистый пол, без соседства со стенами
    out = []
    for y in reversed(range(GRID)):
        for x in range(GRID):
            if LAYOUT[y][x] == ".":
                out.append((x, y))
    return out


# ─────────────────────────── Шаблон ───────────────────────────


def lining_pieces(x: int, y: int) -> list[tuple[float, float, float, float, str]]:
    """Куски облицовки клетки стены в долях клетки: (x, y, w, h, вид).
    Та же логика, что в Lining() рендера: полосы между угловыми блоками."""
    m = wall_mask(x, y)
    o_n, o_e, o_s, o_w = not m & N, not m & E, not m & S, not m & W
    nw = (o_n and o_w) or (not o_n and not o_w and not is_wall(x - 1, y - 1))
    ne = (o_n and o_e) or (not o_n and not o_e and not is_wall(x + 1, y - 1))
    sw = (o_s and o_w) or (not o_s and not o_w and not is_wall(x - 1, y + 1))
    se = (o_s and o_e) or (not o_s and not o_e and not is_wall(x + 1, y + 1))
    b = BAND
    out: list[tuple[float, float, float, float, str]] = []
    if o_n:
        x0, x1 = (b if nw else 0), (1 - b if ne else 1)
        out.append((x0, 0, x1 - x0, b, "h"))
    if o_s:
        x0, x1 = (b if sw else 0), (1 - b if se else 1)
        out.append((x0, 1 - b, x1 - x0, b, "h"))
    if o_w:
        y0, y1 = (b if nw else 0), (1 - b if sw else 1)
        out.append((0, y0, b, y1 - y0, "v"))
    if o_e:
        y0, y1 = (b if ne else 0), (1 - b if se else 1)
        out.append((1 - b, y0, b, y1 - y0, "v"))
    for flag, px, py in ((nw, 0, 0), (ne, 1 - b, 0), (sw, 0, 1 - b), (se, 1 - b, 1 - b)):
        if flag:
            out.append((px, py, b, b, "corner"))
    return out


def make_template(cell: int = 128) -> Image.Image:
    """Серая карта: скала тёмная, пол светлый с тонкой сеткой, облицовка —
    средний тон с тёмными швами между блоками. Модель раскрашивает то,
    что видит, поэтому показано всё, что она должна повторить (полосы
    одной ширины, угловые блоки, швы через полклетки), и ничего лишнего:
    ни сетки через стены, ни теней. Без текста: его она копирует."""
    size = GRID * cell
    rock, floor, lining, seam, grid = (
        (42, 42, 42),
        (170, 170, 170),
        (108, 108, 108),
        (24, 24, 24),
        (196, 196, 196),
    )
    img = Image.new("RGB", (size, size), floor)
    d = ImageDraw.Draw(img)
    for i in range(GRID + 1):
        p = min(i * cell, size - 1)
        d.line([(p, 0), (p, size)], fill=grid, width=1)
        d.line([(0, p), (size, p)], fill=grid, width=1)
    for y, row in enumerate(LAYOUT):
        for x, ch in enumerate(row):
            if ch != "#":
                continue
            x0, y0 = x * cell, y * cell
            d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=rock)
    seam_w = max(2, cell // 48)
    for y, row in enumerate(LAYOUT):
        for x, ch in enumerate(row):
            if ch != "#":
                continue
            x0, y0 = x * cell, y * cell
            for px, py, pw, ph, kind in lining_pieces(x, y):
                r = [
                    x0 + px * cell,
                    y0 + py * cell,
                    x0 + (px + pw) * cell - 1,
                    y0 + (py + ph) * cell - 1,
                ]
                d.rectangle(r, fill=lining, outline=seam, width=seam_w)
                # Шов посередине — только у полосы во всю клетку: блоки кладки
                # выровнены по сетке, а укороченная угловым блоком полоса — один блок
                mid = cell / 2
                if kind == "h" and pw == 1:
                    d.line([(x0 + mid, r[1]), (x0 + mid, r[3])], fill=seam, width=seam_w)
                if kind == "v" and ph == 1:
                    d.line([(r[0], y0 + mid), (r[2], y0 + mid)], fill=seam, width=seam_w)
    return img


# ─────────────────────────── Нарезка ───────────────────────────


class Pieces:
    """Куски набора. Полосы три: во всю клетку, при одном угловом блоке
    (короче на ширину полосы, угол слева) и между двумя. Рендер выбирает
    по тому, есть ли угловые блоки на концах, и отражает при нужде."""

    def __init__(
        self,
        rock: Image.Image,
        band: Image.Image,
        band_end: Image.Image,
        band_mid: Image.Image,
        corner: Image.Image,
        floors: list[Image.Image],
    ):
        self.rock, self.band, self.band_end, self.band_mid = rock, band, band_end, band_mid
        self.corner, self.floors = corner, floors


def cut(sheet_path: Path) -> Pieces:
    sheet = Image.open(sheet_path).convert("RGB")
    if sheet.width != sheet.height or sheet.width % GRID:
        sys.exit(f"лист должен быть квадратом со стороной, кратной {GRID}: {sheet.size}")
    # Приводим к клетке атласа: 1024 → чуть вверх, 2048 → вниз. Плоский
    # стиль без текстур это переносит без потерь, заметных на 80 px
    if sheet.width != GRID * CELL:
        sheet = sheet.resize((GRID * CELL, GRID * CELL), Image.LANCZOS)

    def cell(x: int, y: int) -> Image.Image:
        return sheet.crop((x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL))

    b = round(CELL * BAND)
    rock = seamless(cell(*ROCK_CELL))
    band = cell(*BAND_CELL).crop((0, 0, CELL, b))
    band_end = cell(*CORNER_CELL).crop((b, 0, CELL, b))
    band_mid = cell(*PILLAR_CELL).crop((b, 0, CELL - b, b))
    corner = cell(*CORNER_CELL).crop((0, 0, b, b))
    floors = [cell(x, y) for x, y in floor_cells()[:FLOOR_VARIANTS]]
    return Pieces(rock, band, band_end, band_mid, corner, floors)


def seamless(tile: Image.Image) -> Image.Image:
    """Кадр без швов при замощении: сдвинутая на полклетки копия (её стык
    оказывается в центре, а края непрерывны) подмешивается к оригиналу
    тем сильнее, чем ближе к краю. Скала почти ровная, поэтому потери
    деталей не видно, а сетка клеток на массиве скалы исчезает."""
    a = np.asarray(tile).astype(np.float32)
    h, w = a.shape[:2]
    shifted = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    # 0 в центре, 1 на краях
    d = np.maximum(np.abs(yy - (h - 1) / 2) / (h / 2), np.abs(xx - (w - 1) / 2) / (w / 2))
    m = np.clip((d - 0.5) / 0.5, 0, 1)[..., None]
    out = a * (1 - m) + shifted * m
    return Image.fromarray(out.round().astype(np.uint8))


def build(name: str) -> None:
    sheet_path = SRC / name / "sheet.png"
    if not sheet_path.exists():
        sys.exit(f"нет листа: {sheet_path}")
    p = cut(sheet_path)
    b = round(CELL * BAND)

    # Атлас: ряд 0 — скала, три полосы, угол; дальше — варианты пола по 8 в
    # ряд. Между кадрами зазор с продлёнными крайними пикселями: при
    # масштабировании кадр по краю подхватывает соседние пиксели атласа, и
    # без зазора на стыках скалы проступала светлая полоса соседнего кадра
    cols = 8
    pitch = CELL + 2 * GUTTER
    rows = 1 + -(-len(p.floors) // cols)
    atlas = Image.new("RGBA", (cols * pitch, rows * pitch), (0, 0, 0, 0))

    def place(img: Image.Image, col: int, row: int) -> list[int]:
        x, y = col * pitch + GUTTER, row * pitch + GUTTER
        a = np.asarray(img.convert("RGBA"))
        padded = np.pad(a, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="edge")
        atlas.paste(Image.fromarray(padded), (x - GUTTER, y - GUTTER))
        return [x, y, img.width, img.height]

    rock = place(p.rock, 0, 0)
    band = place(p.band, 1, 0)
    band_end = place(p.band_end, 2, 0)
    band_mid = place(p.band_mid, 3, 0)
    corner = place(p.corner, 4, 0)
    floor_frames = [place(img, i % cols, 1 + i // cols)[:2] for i, img in enumerate(p.floors)]

    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / f"{name}.png", optimize=True)
    (OUT / f"{name}.json").write_text(
        json.dumps(
            {
                "image": f"{name}.png",
                "cell": CELL,
                "band_width": b,
                "size": [atlas.width, atlas.height],
                "rock": rock[:2],
                "band": band,
                "band_end": band_end,
                "band_mid": band_mid,
                "corner": corner,
                "floors": floor_frames,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    out = f"{OUT.relative_to(ROOT)}/{name}.png {atlas.size}"
    print(f"{name}: скала, 3 полосы, угол, {len(p.floors)} вариантов пола → {out}")


# ─────────────────────────── Превью ───────────────────────────


def preview(name: str, out_dir: Path) -> None:
    """Каждый уровень из content/levels плитками набора — в PNG на экранном
    масштабе (80 px на клетку), той же сборкой, что в рендере: скала,
    полосы по открытым сторонам, угловые блоки, пол. Без теней и валунов —
    их рисует рендер. Смотреть швы и стыки нужно здесь, а не на листе."""
    sys.path.insert(0, str(ROOT))
    from tools.level_schema import level_paths, load_level  # noqa: PLC0415

    p = cut(SRC / name / "sheet.png")
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in level_paths():
        level = load_level(path)
        rows = level.map.grid.rstrip("\n").split("\n")
        img = render_map(rows, level.map.legend, p)
        img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
        img.save(out_dir / f"{path.stem}.png")
    print(f"превью: {out_dir}")


def render_map(rows: list[str], legend: dict[str, str], p: Pieces) -> Image.Image:
    pad = 1
    h, w = len(rows), max(len(r) for r in rows)

    def wall_at(x: int, y: int) -> bool:
        # За краем карты — стена, как в frontend/src/scene/tiles.ts
        if not (0 <= y < h and 0 <= x < len(rows[y])):
            return True
        return legend.get(rows[y][x]) == "wall"

    def mask(x: int, y: int) -> int:
        return (
            (N if wall_at(x, y - 1) else 0)
            | (E if wall_at(x + 1, y) else 0)
            | (S if wall_at(x, y + 1) else 0)
            | (W if wall_at(x - 1, y) else 0)
        )

    b = p.band.height
    img = Image.new("RGB", ((w + 2 * pad) * CELL, (h + 2 * pad) * CELL))

    def band_for(start: bool, end: bool) -> tuple[Image.Image, int]:
        """Полоса по угловым блокам на концах (в направлении слева направо)
        и её смещение от начала клетки."""
        if start and end:
            return p.band_mid, b
        if start:
            return p.band_end, b
        if end:
            return p.band_end.transpose(Image.FLIP_LEFT_RIGHT), 0
        return p.band, 0

    def paste_band(ox: int, oy: int, side: str, start: bool, end: bool) -> None:
        """Полоса вдоль стороны клетки, кромкой к полу. Начало — левый или
        верхний конец; для юга и востока полоса отражается к полу."""
        img_b, off = band_for(start, end)
        if side == "n":
            img.paste(img_b, (ox + off, oy))
        elif side == "s":
            img.paste(img_b.transpose(Image.FLIP_TOP_BOTTOM), (ox + off, oy + CELL - b))
        elif side == "w":
            img.paste(img_b.rotate(90, expand=True), (ox, oy + CELL - off - img_b.width))
        else:
            v = img_b.rotate(90, expand=True).transpose(Image.FLIP_LEFT_RIGHT)
            img.paste(v, (ox + CELL - b, oy + CELL - off - img_b.width))

    for y in range(-pad, h + pad):
        for x in range(-pad, w + pad):
            ox, oy = (x + pad) * CELL, (y + pad) * CELL
            if not wall_at(x, y):
                img.paste(p.floors[(x * 7 + y * 13) % len(p.floors)], (ox, oy))
                continue
            img.paste(p.rock, (ox, oy))
            m = mask(x, y)
            o_n, o_e, o_s, o_w = not m & N, not m & E, not m & S, not m & W
            nw = (o_n and o_w) or (not o_n and not o_w and not wall_at(x - 1, y - 1))
            ne = (o_n and o_e) or (not o_n and not o_e and not wall_at(x + 1, y - 1))
            sw = (o_s and o_w) or (not o_s and not o_w and not wall_at(x - 1, y + 1))
            se = (o_s and o_e) or (not o_s and not o_e and not wall_at(x + 1, y + 1))
            # Вертикальная полоса после поворота на 90° идёт снизу вверх:
            # её «начало» — нижний конец, поэтому углы передаются наоборот
            if o_n:
                paste_band(ox, oy, "n", nw, ne)
            if o_s:
                paste_band(ox, oy, "s", sw, se)
            if o_w:
                paste_band(ox, oy, "w", sw, nw)
            if o_e:
                paste_band(ox, oy, "e", se, ne)
            for flag, px, py in (
                (nw, 0, 0),
                (ne, CELL - b, 0),
                (sw, 0, CELL - b),
                (se, CELL - b, CELL - b),
            ):
                if flag:
                    img.paste(p.corner, (ox + px, oy + py))
    return img


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("template", help="нарисовать шаблон для модели")
    b = sub.add_parser("build", help="нарезать лист в атлас")
    b.add_argument("name", help="набор: assets/src/tiles/<name>/sheet.png")
    p = sub.add_parser("preview", help="уровни плитками набора")
    p.add_argument("name")
    p.add_argument("out", type=Path)
    args = ap.parse_args()

    check_layout()
    if args.cmd == "template":
        SRC.mkdir(parents=True, exist_ok=True)
        make_template().save(SRC / "template.png")
        print(f"шаблон: {SRC.relative_to(ROOT)}/template.png")
    elif args.cmd == "build":
        build(args.name)
    else:
        preview(args.name, args.out)


if __name__ == "__main__":
    main()
