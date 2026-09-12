// Камера над игровым полем: масштаб колёсиком и щипком, перетаскивание
// мышью или пальцем, кнопки «ближе / дальше / вписать».
//
// Живёт вне React, как и плеер: каждое движение мыши — новый transform на
// обёртке сцены, и гонять это через стейт незачем. Наружу уходит только
// редкое событие «масштаб изменился» — для подписи в процентах.
//
// Сцена внутри обёртки рисуется в своём естественном размере (DISPLAY_CELL
// на клетку), а камера двигает и масштабирует обёртку целиком. Плеер про
// камеру не знает: координаты героя — в единицах сцены.

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const WHEEL_STEP = 1.1;
const BUTTON_STEP = 1.25;
// Поля вокруг поля при «вписать», в пикселях экрана
const FIT_PAD = 24;

export class Camera {
  private x = 0;
  private y = 0;
  private k = 1;
  /** Пока пользователь камеру не трогал, при изменении размера окна поле вписывается заново */
  private touched = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private readonly resize: ResizeObserver;
  private readonly ac = new AbortController();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly content: HTMLElement,
    private readonly width: number,
    private readonly height: number,
    private readonly onScale: (k: number) => void,
  ) {
    content.style.transformOrigin = "0 0";
    const { signal } = this.ac;
    viewport.addEventListener("wheel", this.onWheel, { passive: false, signal });
    viewport.addEventListener("pointerdown", this.onPointerDown, { signal });
    viewport.addEventListener("pointermove", this.onPointerMove, { signal });
    viewport.addEventListener("pointerup", this.onPointerUp, { signal });
    viewport.addEventListener("pointercancel", this.onPointerUp, { signal });
    this.resize = new ResizeObserver(() => {
      if (!this.touched) this.reset();
    });
    this.resize.observe(viewport);
    this.reset();
  }

  destroy() {
    this.ac.abort();
    this.resize.disconnect();
  }

  get scale() {
    return this.k;
  }

  /** По умолчанию: естественный размер (100%), поле по центру. Если сцена
   *  с кольцом скалы не влезает — не страшно, кольцо и есть запас */
  reset() {
    this.setCentered(1);
    this.touched = false;
  }

  /** Поле целиком по центру, не крупнее естественного размера */
  fit() {
    const r = this.viewport.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const k = Math.min(1, (r.width - FIT_PAD * 2) / this.width, (r.height - FIT_PAD * 2) / this.height);
    this.setCentered(k);
    this.touched = true;
  }

  private setCentered(k: number) {
    const r = this.viewport.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.k = clamp(k);
    this.x = (r.width - this.width * this.k) / 2;
    this.y = (r.height - this.height * this.k) / 2;
    this.apply();
  }

  zoomIn() {
    this.zoomAt(BUTTON_STEP);
  }

  zoomOut() {
    this.zoomAt(1 / BUTTON_STEP);
  }

  /** Масштаб вокруг точки экрана: то, что под курсором, остаётся под курсором */
  private zoomAt(factor: number, cx?: number, cy?: number) {
    const r = this.viewport.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    const k = clamp(this.k * factor);
    const ratio = k / this.k;
    this.x = px - (px - this.x) * ratio;
    this.y = py - (py - this.y) * ratio;
    this.k = k;
    this.touched = true;
    this.apply();
  }

  private apply() {
    this.content.style.transform = `translate(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px) scale(${this.k.toFixed(4)})`;
    this.onScale(this.k);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Кнопки внутри окна (масштаб) — не начало перетаскивания. Иначе захват
    // указателя утащит click на само окно, и кнопка его не получит
    if ((e.target as Element).closest("button, a, input")) return;
    this.viewport.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.pinchDist = this.distance();
    this.viewport.dataset.dragging = "";
  };

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 1) {
      this.x += cur.x - prev.x;
      this.y += cur.y - prev.y;
      this.touched = true;
      this.apply();
    } else if (this.pointers.size === 2) {
      // Щипок: масштаб по изменению расстояния, вокруг середины между пальцами
      const dist = this.distance();
      const [a, b] = [...this.pointers.values()];
      if (this.pinchDist > 0) this.zoomAt(dist / this.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinchDist = dist;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
    if (this.pointers.size === 0) delete this.viewport.dataset.dragging;
  };

  private distance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

const clamp = (k: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
