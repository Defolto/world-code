import type { RefObject } from "react";
import atlasUrl from "../assets/sprites/characters.png";
import atlas from "../assets/sprites/characters.json";
import itemsUrl from "../assets/sprites/items.png";
import items from "../assets/sprites/items.json";
import { CELL } from "../scene/grid";

export type CharacterId = keyof typeof atlas.characters;
export const CHARACTERS = Object.keys(atlas.characters) as CharacterId[];

type Character = (typeof atlas.characters)[CharacterId];
type PartName = keyof Character["frames"];
type ItemName = keyof typeof items.frames;

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  pivot: number[];
}

/**
 * Герой из картинок на скелете. Части — вырезки из атласа, каждая лежит
 * в группе своего сустава, поэтому позы и предметы получают анимацию
 * бесплатно: крутится плечо — крутится рука и всё, что в ней.
 *
 * Персонажи различаются только картинками: риг у всех один, поэтому
 * смена персонажа — это смена вырезок на тех же узлах. Группы суставов,
 * за которые держится плеер, при этом не пересоздаются.
 *
 * Атлас и координаты собирает tools/sprites.py, здесь только раскладка.
 * Координаты рига — в пикселях атласа (160 на клетку), в сцену они
 * переводятся одним scale на внешней группе.
 */

/** Вырезка из атласа: вложенный svg с viewBox на нужный прямоугольник. */
function Crop({ frame, href, size }: { frame: Frame; href: string; size: number[] }) {
  return (
    <svg
      x={-frame.pivot[0]}
      y={-frame.pivot[1]}
      width={frame.w}
      height={frame.h}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
    >
      <image href={href} width={size[0]} height={size[1]} />
    </svg>
  );
}

/**
 * Предмет из атласа предметов, точка крепления — в начале координат.
 * Оружие в атласе стоит клинком вверх (так его рисует модель); в кисти
 * оно смотрит вперёд, горизонтально, — поэтому rotate(90). При замахе
 * плечо уводит его вверх и обрушивает вниз, как рубящий удар.
 */
function Item({ name }: { name: ItemName }) {
  const f = items.frames[name];
  return (
    <g transform={f.slot === "weapon" ? "rotate(90)" : undefined}>
      <Crop frame={f} href={itemsUrl} size={items.size} />
    </g>
  );
}

/** Группа сустава: стоит в точке крепления, вращается через ref. */
function Joint({
  character,
  name,
  jointRef,
  children,
}: {
  character: Character;
  name: PartName;
  jointRef?: RefObject<SVGGElement | null>;
  children?: React.ReactNode;
}) {
  const [ax, ay] = character.rig[name];
  return (
    <g transform={`translate(${ax} ${ay})`}>
      <g ref={jointRef}>
        <Crop frame={character.frames[name]} href={atlasUrl} size={atlas.size} />
        {children}
      </g>
    </g>
  );
}

interface HeroSpriteProps {
  character: CharacterId;
  body: RefObject<SVGGElement | null>;
  armFront: RefObject<SVGGElement | null>;
  armBack: RefObject<SVGGElement | null>;
  legFront: RefObject<SVGGElement | null>;
  legBack: RefObject<SVGGElement | null>;
}

export function HeroSprite({ character, body, armFront, armBack, legFront, legBack }: HeroSpriteProps) {
  const c = atlas.characters[character];
  const scale = CELL / atlas.cell;
  // Начало координат героя — бедро; ступни ставим к нижнему краю клетки
  const dy = CELL / 2 - 2 - c.body.feet * scale;
  // Кисть — у нижнего конца руки, чуть выше края картинки: там ладонь
  const handY = c.frames.arm_front.h - 4;

  return (
    <g transform={`translate(0 ${dy.toFixed(2)}) scale(${scale})`}>
      {/* Ноги — вне наклона корпуса. Задняя рука по канону слоёв лежит
          под ногами, но её кисть под подолом всё равно не видна, а один
          наклон на две группы не повесить — упрощаем. */}
      <Joint character={c} name="leg_back" jointRef={legBack} />
      <Joint character={c} name="leg_front" jointRef={legFront} />
      <g ref={body}>
        <Joint character={c} name="arm_back" jointRef={armBack} />
        <Joint character={c} name="torso" />
        <Joint character={c} name="head" />
        <Joint character={c} name="arm_front" jointRef={armFront}>
          <g transform={`translate(0 ${handY})`}>
            <Item name="steel_sword" />
          </g>
        </Joint>
      </g>
    </g>
  );
}

/** Лицо персонажа для переключателя — та же вырезка головы из атласа. */
export function CharacterFace({ character, size = 28 }: { character: CharacterId; size?: number }) {
  const f = atlas.characters[character].frames.head;
  return (
    <svg width={size} height={size} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} aria-hidden="true">
      <image href={atlasUrl} width={atlas.size[0]} height={atlas.size[1]} />
    </svg>
  );
}
