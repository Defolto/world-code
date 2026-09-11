# Генерация графики

Как получаются картинки персонажей и предметов. Дополняет раздел 8–9
[технической архитектуры](tehnicheskaya-arhitektura.md): там — почему,
здесь — как.

Коротко: **один эталонный персонаж задаёт стиль и масштаб**, все остальные
картинки генерируются с ним как референсом, скрипт вырезает фон и
складывает в атлас. Человек только выбирает из вариантов.

## Модель

Основная — **Nano Banana Pro (Gemini 3 Pro Image)**: лучше всех держит
стиль и масштаб по референсу и слушается раскладки («сетка 4×2», «строго
сбоку»). Прозрачный фон не умеет — фон вырезает скрипт.

Запасная — **gpt-image-1.5**: единственная с честной альфой через API
(`background: transparent`), но стиль между генерациями плывёт сильнее.
Промпты те же.

Начинать без API: первые образцы отбираются руками в Gemini / AI Studio,
автоматизация — когда стиль устоялся.

## Числа

Клетка 80 CSS px, ассеты в 2× → **160 px на клетку в исходнике**.
Тело героя 120 px в исходнике (60 на экране, три четверти клетки),
четверть клетки — запас под рога и поднятый меч.

Эталонный персонаж принят: `assets/src/reference/hero_base.png`. Он задаёт
стиль, масштаб и пропорции; все числа ниже сверяются с ним, а не наоборот.

Пропорции рига — общие для всех персонажей, в исходных пикселях:

| Часть | Высота | Ширина |
|---|---|---|
| Голова с волосами | 46 | ~40 |
| Торс с туникой | 40 | ~30 |
| Ноги (видимая часть) | 34 | ~12 каждая |
| Руки | 40 от плеча | ~12 |

Голова — 35–40% роста, а не классические 30%: так вышло у эталона, и на
60 px это плюс, лицо читается. Все следующие персонажи — под него.

Холсты и точки крепления (где на картинке сустав):

| Что | Холст | Точка крепления |
|---|---|---|
| Голова | 64×64 | шея, низ-центр (32, 60) |
| Торс | 48×64 | бедро, низ-центр (24, 60) |
| Рука (передняя и задняя) | 32×64 | плечо, верх-центр (16, 8) |
| Нога | 32×64 | бедро, верх-центр (16, 6) |
| Шлем | 80×64 | макушка, (40, 56) |
| Доспех | 64×72 | бедро, (32, 66) |
| Оружие | 48×144 | кисть на рукояти, (24, 112) — рукоять внизу, лезвие вверх |
| Сапоги | 40×36 | верх голенища, (20, 6) |
| Плащ | 64×112 | плечи, (32, 8) |

Холсты — ориентир: точные размеры зафиксирует скрипт конвейера по
частям эталона из промпта C. Смена эталона — это перегенерация всего,
поэтому он не меняется.

## Стиль

Одна строка, вставляется в каждый промпт дословно:

```
flat vector cartoon, thick dark outline, three-tone cel shading,
no gradients, no textures, no glow, strict side view facing right
```

Почему такой: читается на 60 px, стабильно воспроизводится моделями,
чисто вырезается по контуру. Розового и пурпурного в палитре нет —
этот цвет занят под фон.

## Промпты

Английский — модели так стабильнее. `{…}` — подставляемые поля.

### A. Эталонный персонаж

Уже сделано — `hero_base.png`. Промпт оставлен на случай, если стиль
придётся перезапускать с нуля; в обычной работе он не нужен.

```
Single 2D game character for a kids' coding game, full body, strict side
view facing right, reference pose: standing, arms slightly away from the
body, legs slightly apart, no limb overlaps the body. Proportions: head
about 30% of total height, chibi but not baby-like. Character: {описание —
например: young knight, short brown hair, simple tunic, no armor, no
weapon}. Style: flat vector cartoon, thick dark outline, three-tone cel
shading, no gradients, no textures, no glow. Plain solid #FF00FF
background, no ground shadow, no text, no props, character centered and
filling about 80% of the image height. 1024x1024.
```

Без доспеха и оружия — это «голый» персонаж, поверх которого лягут
предметы.

### B. Другой персонаж в том же риге

Референс — картинка A. Меняется только внешность.

```
Using the attached character as an exact reference for proportions, pose,
scale and art style, draw a different character: {описание — например:
girl with red braid, freckles, green tunic}. Same height, same head size,
same limb lengths, same standing pose, same strict side view facing right.
Same flat vector cartoon style, thick dark outline, three-tone cel shading.
No armor, no weapon. Plain solid #FF00FF background, no shadow, no text,
same framing as the reference. 1024x1024.
```

### C. Разбивка на части

Референс — целый персонаж (A или B). Швы поправляются руками один раз
на персонажа, это нормально.

```
Using the attached character, redraw it as separate body parts laid out on
a 3x2 grid with generous spacing, exactly the same style, colors and scale:
top row — [head with hair and neck], [torso with tunic, no arms, no head],
[front arm with hand, straight, hanging down]; bottom row — [back arm with
hand, straight], [front leg with foot, straight], [back leg with foot,
straight]. Each part complete and not occluded, drawn as if seen from the
side facing right. Plain solid #FF00FF background, no labels, no grid
lines, no text.
```

### D. Предмет

Референс — эталонный персонаж A. Описание берётся из поля `silhouette`
в YAML предмета.

```
Single game item for the {helmet|armor|weapon|boots|cape} slot, drawn to
fit the attached reference character: same scale, same flat vector cartoon
style, thick dark outline, three-tone cel shading. Strict side view facing
right. Item: {name} — {silhouette}. {уточнение по слоту, см. ниже}. Plain
solid #FF00FF background, nothing else in the image, item centered.
1024x1024.
```

Уточнения по слоту:

| Слот | Добавить в промпт |
|---|---|
| helmet | `Drawn as worn on the reference character's head, head itself not included, only the helmet.` |
| armor | `Chest armor covering the torso and shoulders only, no arms, no head, no legs; shape follows the reference torso.` |
| weapon | `Vertical orientation, handle at the bottom, blade or head at the top, no hand holding it.` |
| boots | `One boot, seen from the side, toe pointing right, no leg above the boot.` |
| cape | `Cape hanging from the shoulders down the back, seen from the side, no body inside.` |

### E. Враг

Враги без слотов, поэтому цельной картинкой в той же схеме, что A, но
со своим описанием. Части для анимации (рука, голова) — через C, если
враг атакует; иначе достаточно целого.

## Отбор

Смотреть перед тем, как принять картинку:

- строго вид сбоку, лицом вправо — три четверти в брак;
- конечности не перекрывают тело (иначе не режется на части);
- нет тени на земле, текста, лишних предметов, «шахматки» вместо фона;
- в палитре нет пурпурного и розового;
- стиль совпадает с эталоном рядом, а не по памяти;
- **уменьшить до 60 px и посмотреть** — если силуэт не читается, картинка не подходит, сколько бы в ней ни было деталей.

## Конвейер

Скрипт (появится вместе с гардеробной, шаг 4 порядка работ), на вход —
PNG 1024×1024 с фоном `#FF00FF`:

1. **Вырезать фон**: допуск по цвету, снять пурпурную бахрому с края (despill).
2. **Обрезать** по прямоугольнику непрозрачных пикселей.
3. **Масштаб**: один коэффициент на всё. Считается по эталону — во сколько раз уменьшить эталон, чтобы тело стало 120 px. Предметы нарисованы «в масштабе референса», поэтому уменьшаются тем же коэффициентом, а не подгоняются под холст.
4. **Положить на холст слота** по правилу точки крепления; `offset` в YAML по умолчанию `{x: 0, y: 0}`, поправка — в гардеробной мышкой.
5. **Атлас**: все PNG в один `sprites-<hash>.png` плюс JSON с координатами. Хэш в имени — кэш навсегда, как у остальной статики.
6. **CI**: каждая комбинация персонаж × предметы рендерится и проверяется на габарит клетки.

Исходники 1024×1024 хранятся в репозитории в `assets/src/<slot>/<id>.png`:
это то, из чего всё пересобирается. Эталон и его части — в
`assets/src/reference/`. Забирать картинки нужно в PNG (AI Studio или
API): JPEG размывает край на пурпурном фоне, и вырезание становится
грязнее. Сам эталон — JPEG, ему можно: в атлас идут его части, не он.

## Порядок

1. ~~Эталонный персонаж (A)~~ — принят, `hero_base.png`.
2. Разбивка эталона на части (C), посадить на скелет, проверить позы.
3. Пять предметов по одному на слот (D), посадить, выставить `offset`.
4. Только теперь: остальные персонажи (B) и предметы потоком.
