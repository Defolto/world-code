import type { RefObject } from "react";
import atlasUrl from "../assets/sprites/hero.png";
import rig from "../assets/sprites/hero.json";
import { CELL } from "../scene/demoPlayer";
import styles from "./DemoScene.module.css";

type PartName = keyof typeof rig.frames;

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

// Кисть — на нижнем конце руки, там висит оружие
const HAND_Y = rig.frames.arm_front.h;

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
          {/* Меч — заглушка до первого предмета из конвейера: рисуем
              кодом, но уже в масштабе атласа и в кисти, как ляжет картинка */}
          <rect x="-9" y={HAND_Y - 4} width="18" height="4" rx="2" className={styles.guard} />
          <rect x="-3" y={HAND_Y} width="6" height="36" rx="3" className={styles.blade} />
        </Joint>
      </g>
    </g>
  );
}
