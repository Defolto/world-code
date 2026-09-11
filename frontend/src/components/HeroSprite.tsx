import type { RefObject } from "react";
import atlasUrl from "../assets/sprites/hero.png";
import rig from "../assets/sprites/hero.json";
import itemsUrl from "../assets/sprites/items.png";
import items from "../assets/sprites/items.json";
import { CELL } from "../scene/demoPlayer";

type PartName = keyof typeof rig.frames;
type ItemName = keyof typeof items.frames;

/**
 * Герой из картинок на скелете. Части — вырезки из атласа, каждая лежит
 * в группе своего сустава, поэтому позы и предметы получают анимацию
 * бесплатно: крутится плечо — крутится рука и всё, что в ней.
 *
 * Атлас и координаты собирает tools/sprites.py, здесь только раскладка.
 * Координаты рига — в пикселях атласа (160 на клетку), в сцену они
 * переводятся одним scale на внешней группе.
 */

/** Вырезка из атласа: вложенный svg с viewBox на нужный прямоугольник. */
function Part({ name }: { name: PartName }) {
  const f = rig.frames[name];
  return (
    <svg x={-f.pivot[0]} y={-f.pivot[1]} width={f.w} height={f.h} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}>
      <image href={atlasUrl} width={rig.size[0]} height={rig.size[1]} />
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
      <svg x={-f.pivot[0]} y={-f.pivot[1]} width={f.w} height={f.h} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}>
        <image href={itemsUrl} width={items.size[0]} height={items.size[1]} />
      </svg>
    </g>
  );
}

/** Группа сустава: стоит в точке крепления, вращается через ref. */
function Joint({
  name,
  jointRef,
  children,
}: {
  name: PartName;
  jointRef?: RefObject<SVGGElement | null>;
  children?: React.ReactNode;
}) {
  const [ax, ay] = rig.rig[name];
  return (
    <g transform={`translate(${ax} ${ay})`}>
      <g ref={jointRef}>
        <Part name={name} />
        {children}
      </g>
    </g>
  );
}

interface HeroSpriteProps {
  body: RefObject<SVGGElement | null>;
  armFront: RefObject<SVGGElement | null>;
  armBack: RefObject<SVGGElement | null>;
  legFront: RefObject<SVGGElement | null>;
  legBack: RefObject<SVGGElement | null>;
}

// Кисть — у нижнего конца руки, чуть выше края картинки: там ладонь
const HAND_Y = rig.frames.arm_front.h - 4;

export function HeroSprite({ body, armFront, armBack, legFront, legBack }: HeroSpriteProps) {
  const scale = CELL / rig.cell;
  // Начало координат героя — бедро; ступни ставим к нижнему краю клетки
  const dy = CELL / 2 - 2 - rig.body.feet * scale;

  return (
    <g transform={`translate(0 ${dy.toFixed(2)}) scale(${scale})`}>
      {/* Ноги — вне наклона корпуса. Задняя рука по канону слоёв лежит
          под ногами, но её кисть под подолом всё равно не видна, а один
          наклон на две группы не повесить — упрощаем. */}
      <Joint name="leg_back" jointRef={legBack} />
      <Joint name="leg_front" jointRef={legFront} />
      <g ref={body}>
        <Joint name="arm_back" jointRef={armBack} />
        <Joint name="torso" />
        <Joint name="head" />
        <Joint name="arm_front" jointRef={armFront}>
          <g transform={`translate(0 ${HAND_Y})`}>
            <Item name="steel_sword" />
          </g>
        </Joint>
      </g>
    </g>
  );
}
