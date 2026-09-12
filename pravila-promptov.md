# Промпты для персонажей и предметов

Рабочий справочник: что вставлять в модель, что менять, что проверять
на выходе. Технические числа, стиль и конвейер — в
[generatsiya-grafiki.md](generatsiya-grafiki.md).

Модель — Nano Banana Pro (Gemini). Промпты на английском: так модель
стабильнее. Референс прикладывается к каждому промпту, кроме A.

## Пять правил, которые не меняются

1. **Референс — всегда.** Стиль держится картинкой рядом, а не словами.
   Для персонажей — лист разбивки эталона `assets/src/characters/hero/parts.png`,
   для предметов — целый эталон `assets/src/reference/hero_base.png`.
2. **Фон `#FF00FF`, ровный.** Не «прозрачный», не белый: прозрачность
   модель подделывает шахматкой, белый сливается с бликами. Пурпур режется
   скриптом.
3. **Строго вид сбоку, лицом вправо.** Три четверти — брак, сколько бы
   ни было красиво. Второй глаз виден — брак.
4. **Одна сущность на картинку.** Персонаж без предметов, предмет без
   персонажа. Модель любит «дорисовать приключенца» — всё, что лишнее,
   в брак.
5. **Размер и позу не описывать.** Они заданы референсом и шаблоном.
   Слова «large», «tall», «small» в описании только сбивают.

## Что писать в `{ОПИСАНИЕ}`

Персонаж — возраст, волосы, лицо, одежда, обувь. По-английски, через
запятую, 6–10 признаков:

```
girl around 12 years old, red hair in a single braid, freckles,
green tunic with a belt, brown trousers, simple shoes
```

Чего **не** писать:

- шляпы, капюшоны, плащи, рюкзаки, оружие, щиты — это слоты предметов,
  они лягут поверх;
- «в доспехах», «рыцарь», «маг» — модель нарисует доспех и посох;
- цвета кожи и волос — можно; розовый и пурпурный в одежде — нельзя,
  это цвет фона. Фиолетовый — можно (скрипт различает его от края);
- возраст модель меняет вместе с одеждой: строгий камзол — и лицо
  повзрослело. Если нужна однородность, добавить
  `friendly face, same age as the template`.

Предмет — форма и материал, 3–8 слов, одна главная деталь:

```
simple steel short sword — straight blade, small cross guard,
leather-wrapped grip
```

Не «могучий», «древний», «легендарный» — это про цену, а не про форму.
На 60 px читается одна деталь, не три.

## Промпты

### A. Эталонный персонаж — сделано

`hero_base.png` принят. Промпт хранится на случай перезапуска стиля с
нуля; в обычной работе не нужен.

```
Single 2D game character for a kids' coding game, full body, strict side
view facing right, reference pose: standing, arms slightly away from the
body, legs slightly apart, no limb overlaps the body. Proportions: head
about 35–40% of total height, chibi, readable silhouette. Character:
{ОПИСАНИЕ}, no armor, no helmet, no weapon, no cape. Style: flat vector
cartoon, thick dark outline, three-tone cel shading, no gradients, no
textures, no glow, no pink or magenta colors on the character. Plain
solid #FF00FF background, no ground shadow, no text, no props, character
centered and filling about 80% of the image height. 1024x1024.
```

### C′. Новый персонаж — основной путь

Референс: `assets/src/characters/hero/parts.png`. Меняется только
строка `Character:`. Проверено на `girl` и `boy2` — оба с первой
попытки.

```
Using the attached parts sheet as an exact template, draw the same six
body parts for a different character, in the same positions on the same
3x2 grid, at exactly the same scale, same pose of each part, same flat
vector cartoon style with thick dark outline and three-tone cel shading.
Character: {ОПИСАНИЕ}.
Parts: top row — [head with hair and neck], [torso with clothing, no
arms, no head], [front arm with hand, straight, hanging down]; bottom
row — [back arm with hand, straight], [front leg with trouser and shoe,
straight], [back leg with trouser and shoe, straight]. Same total height,
same head size, same limb lengths as the template. No armor, no helmet,
no weapon, no cape, no accessories. Side view facing right. Plain solid
#FF00FF background, no labels, no grid lines, no text.
```

Результат → `assets/src/characters/<id>/parts.png`, `id` латиницей.

### B + C. Новый персонаж в два шага — запасной путь

Если C′ поплыл по раскладке или масштабу.

**B — целый персонаж.** Референс `hero_base.png`:

```
Using the attached character as an exact reference for proportions, pose,
scale and art style, draw a different character: {ОПИСАНИЕ}. Same total
height, same head size, same limb lengths, same standing pose, same
strict side view facing right. Same flat vector cartoon style, thick dark
outline, three-tone cel shading, no pink or magenta colors on the
character. No armor, no helmet, no weapon, no cape. Plain solid #FF00FF
background, no shadow, no text, same framing as the reference. 1024x1024.
```

**C — разбивка.** Референс — результат B:

```
Using the attached character, redraw it as separate body parts laid out on
a 3x2 grid with generous spacing, exactly the same style, colors and scale:
top row — [head with hair and neck], [torso with clothing, no arms, no
head], [front arm with hand, straight, hanging down]; bottom row — [back
arm with hand, straight], [front leg with trouser and shoe, straight],
[back leg with trouser and shoe, straight]. Each part complete and not
occluded, drawn as if seen from the side facing right. Plain solid
#FF00FF background, no labels, no grid lines, no text.
```

Если одна часть кривая — дозаказать только её:
`Redraw only the front leg from the attached sheet, same style and scale,
straight, side view, solid #FF00FF background` — и подменить на листе.

### D. Предмет

Референс: `assets/src/reference/hero_base.png`. Слот и описание —
из YAML предмета.

```
Single game item for the {helmet|armor|weapon|boots|cape} slot, drawn to
fit the attached reference character: same flat vector cartoon style,
thick dark outline, three-tone cel shading. Strict side view facing
right. Item: {name} — {ОПИСАНИЕ}. {УТОЧНЕНИЕ ПО СЛОТУ}. Plain solid
#FF00FF background, nothing else in the image, item centered, filling
about 80% of the image. 1024x1024.
```

Уточнения по слоту — вставлять дословно:

| Слот | `{УТОЧНЕНИЕ ПО СЛОТУ}` |
|---|---|
| weapon | `Vertical orientation, handle at the bottom, blade or head at the top, no hand holding it.` |
| helmet | `Drawn as worn on the reference character's head, seen from the side, head itself not included, only the helmet. Open face or visor, the face must stay visible.` |
| armor | `Chest armor covering the torso and shoulders only, no arms, no head, no legs; outer shape follows the reference torso so it can be layered over it.` |
| boots | `One boot, seen from the side, toe pointing right, no leg above the boot.` |
| cape | `Cape hanging from the shoulders down the back, seen from the side, no body inside, top edge straight.` |

Результат → `assets/src/<слот>/<id>.png`. Масштаб задаёт слот, а не
картинка, поэтому «same scale as reference» в промпте не нужен — модель
его всё равно не держит.

### E. Враг

Как A, со своим описанием. Референс `hero_base.png` — для стиля и
масштаба. Цельной картинкой; на части (промпт C) — только если враг
атакует и нужна анимация руки.

```
Single 2D game enemy for a kids' coding game, drawn in the same style
and at the same scale as the attached reference character: flat vector
cartoon, thick dark outline, three-tone cel shading. Enemy: {ОПИСАНИЕ —
например: small green goblin, big ears, torn brown vest, wooden club,
mischievous grin}. Strict side view facing LEFT (towards the hero).
Plain solid #FF00FF background, no shadow, no text, centered, filling
about 60% of the image height. 1024x1024.
```

Враг смотрит **влево**, навстречу герою — единственный случай, где не
«facing right».

### F. Плитки локации

Не персонаж и не предмет, поэтому правила 2–4 здесь не действуют: фон
не пурпурный, вид сверху, на картинке много всего сразу. Модель не
умеет рисовать стыкующиеся куски по отдельности, поэтому ей отдаётся
**карта-шаблон** `assets/src/tiles/template.png` (делает
`tools/tiles.py template`): сетка 8×8, тёмное — скала, светлое — пол,
средний тон — облицовка коридора с угловыми блоками и швами. Модель
раскрашивает то, что видит, поэтому в шаблоне показано всё, что она
должна повторить, и ничего из того, что не должна: ни сетки через
скалу, ни теней — тени, валуны и уход в темноту рисует рендер.
Референс — сам шаблон; для второй и следующих локаций приложить ещё и
готовый лист первой, чтобы держался стиль.

```
Using the attached grayscale layout as an exact map, paint a {dungeon}
tileset for a kids' coding game, seen straight from above (top-down, no
perspective). The image is an 8x8 grid of equal square cells: keep every
edge exactly where it is.
Three materials, each exactly where the layout shows it:
1. The dark areas are solid rock — the mass the dungeon is cut into.
Paint it as plain dark stone, nearly flat, with only faint small
texture and no bright details: it is repeated over large areas.
2. The mid-gray bands are the dressed-stone lining of the corridor
walls: one row of cut stone blocks, exactly as wide as the band, with a
mortar seam at every dark line in the layout and nowhere else. The band
looks the same on all four sides of a corridor. Each small square at a
corner is a single corner stone. The edge of the band that touches the
floor may have a slightly lighter highlight.
3. The light areas are the floor: flat flagstones, identical
everywhere, laid on a regular pattern aligned to the grid so that any
floor cell can be swapped with any other; the thin grid lines are only
a guide, do not paint them.
No shadows, no lighting gradients, no shading between areas — the game
draws shadows itself.
Style: flat vector cartoon, a thick dark outline only along the border
between the lining and the floor, three-tone cel shading, no gradients,
no textures, no glow. Palette: {cool dark blue-gray rock, cool mid
blue-gray lining, warm light sand-gray floor}; the floor is clearly
lighter and warmer than the stone. No characters, no props, no torches,
no doors, no text, no labels. Fill the whole image edge to edge. Square
output, 2048x2048.
```

В фигурных скобках — локация и палитра; всё остальное менять не надо.
Ориентир палитры — переменные в `frontend/src/components/Tiles.module.css`.
Просить 2K: в атлас идёт 160 px на клетку, из 1024 их приходится
растягивать. Результат → `assets/src/tiles/<локация>/sheet.png`, дальше
`tools/tiles.py build <локация>` и `preview`.

Что режется из листа (клетки раскладки заданы в `tools/tiles.py`):
скала — центр блока 3×3; полоса — верхний край блока; полоса при угле и
угловой блок — левый верхний угол блока; полоса между двумя углами —
столб; пол — нижние ряды. Всё остальное на листе — контекст для модели.

Отбор — свой, глазами по превью уровней, а не по листу:

- **сетка удержана**: положить лист поверх шаблона с прозрачностью —
  границы скалы и полос совпадают с шаблоном, ничего не выползает;
- полосы одной ширины со всех четырёх сторон, швы только там, где в
  шаблоне; угловые блоки — цельные камни;
- скала ровная: в превью она замощается одной клеткой, любой яркий
  камень превратится в узор;
- пол однородный: в превью клетки пола переставлены случайно — швы не
  должны быть видны;
- пол заметно светлее и теплее камня: на тёмной теме одной яркости мало;
- нет теней и градиентов у границ — их добавит рендер, вторые будут лишними;
- уменьшить до 80 px на клетку (превью так и рисует) — коридор читается,
  угол — как угол.

## Отбор

Одна минута на картинку, до того как класть в репозиторий:

- профиль вправо (враг — влево): один глаз, нос в профиль;
- части того же размера и на тех же местах, что на эталонном листе —
  положить рядом, не сравнивать по памяти;
- шея видна под головой (нужна для стыка), волосы и косы её не закрывают;
- конечности не перекрывают тело и друг друга;
- нет тени на земле, текста, подписей, рамок, «шахматки»;
- в палитре нет пурпурного и розового;
- **уменьшить до 60 px** (или отойти от экрана) — силуэт читается: где
  голова, куда смотрит, что в руке.

Формат: PNG предпочтительнее, JPEG допустим — скрипт снимает ореол.
Файл можно бросить в корень проекта с любым именем, разложит тот, кто
собирает атлас.

## Чему научились

Записано, чтобы не открывать заново:

- **Масштаб предмета модель не держит.** Одиночный предмет рисуется во
  весь кадр — меч вышел ростом с героя. Поэтому размер задаёт слот.
- **C′ работает с первого раза**, если референс — лист разбивки, а не
  целый персонаж: раскладка и масштаб копируются вместе со стилем.
- **Руки на листе разбивки длиннее на четверть**, чем на эталоне. Штатно:
  конвейер нормирует под канон.
- **Косы и хвосты** ниже шеи — нормально, конвейер крепит голову за шею.
- **Фиолетовый** в одежде не путается с фоном после двухпроходного
  вырезания. Розовый и пурпурный — по-прежнему нельзя.
- **Возраст плывёт вместе с одеждой**: строгий камзол — взрослое лицо.
  Если это не задумано, прописывать возраст и `friendly face` явно.
- **Эталон не меняется.** Смена стиля — перегенерация всех персонажей
  и предметов, а не одного.
- **Плитки: модель раскрашивает то, что видит, а не то, что написано.**
  Первый шаблон с сеткой через стены дал «каждая клетка — отдельный
  блок с контуром», а клетку в центре блока 3×3 модель нарисовала ямой —
  фраза «walls merge into one masonry» не помогла. Помогло убрать линии
  внутри стен и нарисовать в шаблоне всё, что должно быть на листе.
- **Вид три четверти для плиток отвергнут.** Лицевая грань стены видна
  только с юга, и коридор получался обрамлённым по-разному с разных
  сторон, а углы ломались. Вид сверху с облицовкой по всем сторонам
  даёт набор из пяти кусков вместо шестнадцати плиток.
