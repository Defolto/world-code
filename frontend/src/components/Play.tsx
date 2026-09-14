import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import levels from "virtual:levels";
import { getStatus, onStatus, runProgram, warmUp, type EngineStatus } from "../engine/runner";
import { HERO_AT_START, type Frame, type FrameLog, type HeroState, type Level } from "../engine/types";
import { COMMANDS } from "../engine/commands";
import { Camera } from "../scene/camera";
import { DISPLAY_CELL, PAD } from "../scene/grid";
import { LevelPlayer, SPEEDS, type SceneRefs, type Speed } from "../scene/levelPlayer";
import { Editor, type EditorHandle } from "./Editor";
import { CHARACTERS, CharacterFace, type CharacterId } from "./HeroSprite";
import { LevelScene, parseMap, sceneSize } from "./LevelScene";
import styles from "./Play.module.css";

const OUTCOME_TEXT = {
  win: "Уровень пройден!",
  lose: "Герой не дошёл до флага",
  timeout: "Код работал слишком долго",
  error: "В коде ошибка",
} as const;

// Почему проигрыш: причина из check_goals симулятора
const LOSE_TEXT: Record<string, string> = {
  not_reached: "Герой не дошёл до флага",
  not_collected: "Герой не подобрал всё, что нужно",
  died: "Герой погиб",
};

// Порядок уровней — по занятию, внутри занятия по id. Роутера и списка
// уроков пока нет, это и есть весь «курс»
const ORDER: Level[] = Object.values(levels).sort(
  (a, b) => a.lesson - b.lesson || a.id.localeCompare(b.id),
);

// Темы занятий — по номеру; уровни знают только номер. Занятие без темы
// покажется одним номером
const LESSON_NAMES: Record<number, string> = {
  1: "Первые шаги",
  2: "Условия",
  3: "Переменные",
};

// Уровни занятия, по порядку — для навигации в шапке
const lessonLevels = (lesson: number) => ORDER.filter((l) => l.lesson === lesson);
const LESSONS = [...new Set(ORDER.map((l) => l.lesson))];

const levelUrl = (id: string) => `/play/?level=${encodeURIComponent(id)}`;

/** Задание — простой текст, но **слово** в нём выделяется: так методист
 *  подсвечивает пароль или число, которое ребёнку надо перенести в код */
function renderBrief(text: string) {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className={styles.keyword}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function Meter({
  label,
  icon,
  value,
  max,
  kind,
}: {
  label: string;
  icon: string;
  value: number;
  max: number;
  kind: "hp" | "energy";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={styles.meter} title={label}>
      <span className={styles.hudIcon} aria-hidden="true">
        {icon}
      </span>
      <span
        className={`${styles.meterTrack} ${styles[`meter_${kind}`]}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.meterValue}>
        {value}/{max}
      </span>
    </span>
  );
}

// Выбранная скорость переживает переход на следующий уровень (это перезагрузка
// страницы), поэтому лежит в localStorage. Хранилище может быть недоступно —
// тогда молча остаёмся на 1×.
const SPEED_KEY = "mirkod.speed";

function loadSpeed(): Speed {
  try {
    const raw = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(raw) ? (raw as Speed) : 1;
  } catch {
    return 1;
  }
}

function saveSpeed(speed: Speed) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* приватный режим или запрет хранилища — не страшно */
  }
}

interface PlayProps {
  levelId: string;
}

export function Play({ levelId }: PlayProps) {
  const level: Level | undefined = levels[levelId];
  if (!level) return <p className="shell">Уровень «{levelId}» не найден.</p>;
  // key — чтобы смена уровня пересоздала редактор и плеер, а не патчила их
  return <PlayLevel key={level.id} level={level} />;
}

function PlayLevel({ level }: { level: Level }) {
  const index = ORDER.findIndex((l) => l.id === level.id);
  const next = ORDER[index + 1];
  // Соседние занятия — для стрелок в шапке; первый уровень каждого
  const lessonIdx = LESSONS.indexOf(level.lesson);
  const prevLesson = LESSONS[lessonIdx - 1];
  const nextLesson = LESSONS[lessonIdx + 1];
  const siblings = lessonLevels(level.lesson);
  const map = useMemo(() => parseMap(level), [level]);

  const scene = useRef<SVGSVGElement>(null);
  const hero = useRef<SVGGElement>(null);
  const body = useRef<SVGGElement>(null);
  const armFront = useRef<SVGGElement>(null);
  const armBack = useRef<SVGGElement>(null);
  const legFront = useRef<SVGGElement>(null);
  const legBack = useRef<SVGGElement>(null);
  const editor = useRef<EditorHandle>(null);
  const player = useRef<LevelPlayer | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera | null>(null);

  const [engine, setEngine] = useState<EngineStatus>(getStatus);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<FrameLog | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  // Состояние героя для HUD: до запуска — стартовое, потом из снимков
  const [hud, setHud] = useState<Omit<HeroState, "x" | "y" | "dir">>(HERO_AT_START);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(loadSpeed);
  const [failure, setFailure] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterId>(CHARACTERS[0]);
  const [zoom, setZoom] = useState(1);

  const refs = useCallback((): SceneRefs | null => {
    if (!scene.current || !hero.current || !body.current || !armFront.current || !armBack.current || !legFront.current || !legBack.current) {
      return null;
    }
    const gates = new Map<string, SVGGElement>();
    for (const el of scene.current.querySelectorAll<SVGGElement>("[data-gate]")) {
      gates.set(el.dataset.gate ?? "", el);
    }
    const items = new Map<string, SVGGElement>();
    for (const el of scene.current.querySelectorAll<SVGGElement>("[data-item]")) {
      items.set(el.dataset.item ?? "", el);
    }
    const route = scene.current.querySelector<SVGGElement>("[data-route]");
    const bubble = scene.current.querySelector<SVGGElement>("[data-bubble]");
    if (!route || !bubble) return null;
    return {
      route,
      bubble,
      items,
      hero: hero.current,
      body: body.current,
      armFront: armFront.current,
      armBack: armBack.current,
      legFront: legFront.current,
      legBack: legBack.current,
      gates,
    };
  }, []);

  // Pyodide начинает грузиться, пока ребёнок читает условие
  useEffect(() => {
    warmUp();
    return onStatus(setEngine);
  }, []);

  // До первого запуска герой стоит на старте
  useEffect(() => {
    const r = refs();
    if (r && !player.current) LevelPlayer.drawIdle(r, map.start, map.gates, map.items);
  }, [refs, map]);

  // Камера над полем: масштаб и перетаскивание — вне React, как и плеер
  useEffect(() => {
    if (!viewport.current || !stage.current) return;
    const size = sceneSize(map);
    const c = new Camera(
      viewport.current,
      stage.current,
      size.cols * DISPLAY_CELL,
      size.rows * DISPLAY_CELL,
      // Карта без кольца скалы: её камера показывает по умолчанию
      {
        x: PAD * DISPLAY_CELL,
        y: PAD * DISPLAY_CELL,
        width: map.cols * DISPLAY_CELL,
        height: map.rows * DISPLAY_CELL,
      },
      setZoom,
    );
    camera.current = c;
    return () => {
      c.destroy();
      camera.current = null;
    };
  }, [map]);

  // Новый лог — новый плеер. Индекс кадра в стейте не живёт: плеер зовёт
  // onFrame только при смене кадра, это редкие события.
  useEffect(() => {
    const r = refs();
    if (!log || !r) return;
    const p = new LevelPlayer(log, map.start, map.gates, map.items, r, {
      onFrame: (f, h) => {
        setFrame(f);
        setHud(h);
        editor.current?.setActiveLine(f.line || null);
      },
      onPlaying: setPlaying,
      onEnd: () => {
        editor.current?.setActiveLine(null);
        if (log.error?.line) editor.current?.setErrorLine(log.error.line);
      },
    });
    p.setSpeed(speed);
    player.current = p;
    p.play();
    return () => {
      p.destroy();
      player.current = null;
    };
    // speed применяется отдельным эффектом ниже — пересоздавать плеер из-за неё нельзя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, map, refs]);

  useEffect(() => {
    player.current?.setSpeed(speed);
    saveSpeed(speed);
  }, [speed]);

  const run = async () => {
    const source = editor.current?.getValue() ?? "";
    setRunning(true);
    setFailure(null);
    setFrame(null);
    setHud(HERO_AT_START);
    editor.current?.setErrorLine(null);
    editor.current?.setActiveLine(null);
    try {
      // Каждый запуск — новый seed: подделки на уровнях с ними ложатся
      // по-новому, и выучить их наизусть нельзя. Прогон по seed
      // воспроизводим — он записан в логе
      setLog(await runProgram(source, level, Math.floor(Math.random() * 2 ** 31)));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const atEnd = frame?.events.some((e) => e.type === "level_end") ?? false;
  const outcome = log && atEnd ? log.outcome.status : null;
  const vars = frame?.vars ? Object.entries(frame.vars) : [];

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a href="/" className={styles.back}>
          ← мирКод
        </a>
        <div className={styles.titleWrap}>
          <h1 className={styles.title}>{level.title}</h1>
        </div>
        {/* Справа — текущее занятие и только его уровни; стрелки ведут на
            первый уровень соседнего занятия. Все девятнадцать кружков подряд
            в шапку не помещались и ничего не говорили о структуре курса */}
        <nav className={styles.levels} aria-label="Уровни занятия">
          {prevLesson !== undefined && (
            <a
              href={levelUrl(lessonLevels(prevLesson)[0].id)}
              className={styles.lessonArrow}
              title={`Занятие ${prevLesson}${LESSON_NAMES[prevLesson] ? ` · ${LESSON_NAMES[prevLesson]}` : ""}`}
            >
              ‹
            </a>
          )}
          <span className={styles.lesson}>
            Занятие {level.lesson}
            {LESSON_NAMES[level.lesson] && (
              <span className={styles.lessonName}>{` · ${LESSON_NAMES[level.lesson]}`}</span>
            )}
          </span>
          {siblings.map((l, i) => (
            <a
              key={l.id}
              href={levelUrl(l.id)}
              className={l.id === level.id ? `${styles.levelChip} ${styles.levelActive}` : styles.levelChip}
              aria-current={l.id === level.id ? "page" : undefined}
              title={l.title}
            >
              {i + 1}
            </a>
          ))}
          {nextLesson !== undefined && (
            <a
              href={levelUrl(lessonLevels(nextLesson)[0].id)}
              className={styles.lessonArrow}
              title={`Занятие ${nextLesson}${LESSON_NAMES[nextLesson] ? ` · ${LESSON_NAMES[nextLesson]}` : ""}`}
            >
              ›
            </a>
          )}
        </nav>
      </header>

      <div className={styles.layout}>
        {/* ─── Слева: мир ─── */}
        <main className={styles.world}>
          <div ref={viewport} className={styles.viewport}>
            <div ref={stage} className={styles.stage}>
              <LevelScene
                ref={scene}
                level={level}
                map={map}
                character={character}
                hero={hero}
                body={body}
                armFront={armFront}
                armBack={armBack}
                legFront={legFront}
                legBack={legBack}
              />
            </div>
            <div className={styles.zoom} role="group" aria-label="Масштаб">
              <button type="button" onClick={() => camera.current?.zoomOut()} title="Дальше">
                −
              </button>
              <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => camera.current?.zoomIn()} title="Ближе">
                +
              </button>
              <button type="button" onClick={() => camera.current?.fit()} title="Показать всё поле">
                ⛶
              </button>
            </div>
          </div>

          {/* Герой в цифрах: жизнь, энергия, урон, монеты. Шаг и действие
              стоят энергию, wait возвращает; на нуле герой замирает */}
          <div className={styles.hud} aria-label="Состояние героя">
            <Meter label="Жизнь" icon="♥" value={hud.hp} max={hud.hp_max} kind="hp" />
            <Meter label="Энергия" icon="⚡" value={hud.energy} max={hud.energy_max} kind="energy" />
            <span className={styles.hudStat} title="Урон за один удар">
              <span className={styles.hudIcon}>⚔</span>
              {hud.damage}
            </span>
            <span className={styles.hudStat} title="Монеты">
              <span className={`${styles.hudIcon} ${styles.hudCoin}`} />
              {hud.coins}
            </span>
          </div>

          <div className={styles.controls}>
            <div className={styles.transport}>
              <button type="button" onClick={() => player.current?.seekStart()} disabled={!log} title="В начало">
                ⏮
              </button>
              <button type="button" onClick={() => player.current?.stepBack()} disabled={!log} title="Кадр назад">
                ◀
              </button>
              <button
                type="button"
                className={styles.playBtn}
                onClick={() => player.current?.toggle()}
                disabled={!log}
                title={playing ? "Пауза" : "Играть"}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button type="button" onClick={() => player.current?.stepForward()} disabled={!log} title="Кадр вперёд">
                ▶
              </button>
            </div>
            <div className={styles.speeds} role="radiogroup" aria-label="Скорость">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={s === speed}
                  className={s === speed ? styles.speedActive : undefined}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
            <span className={styles.frameInfo}>
              {frame ? `кадр ${frame.i + 1} из ${log?.frames.length ?? 0} · тик ${frame.tick}` : ""}
            </span>
            {CHARACTERS.length > 1 && (
              <span className={styles.faces} role="radiogroup" aria-label="Персонаж">
                {CHARACTERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === character}
                    className={id === character ? `${styles.face} ${styles.faceActive}` : styles.face}
                    onClick={() => setCharacter(id)}
                  >
                    <CharacterFace character={id} />
                  </button>
                ))}
              </span>
            )}
          </div>

          {/* Исход показываем, когда плёнка дошла до конца — не раньше */}
          {(outcome || failure) && (
            <div className={`${styles.result} ${styles[`result_${outcome ?? "error"}`]}`} role="status">
              <strong>
                {failure
                  ? "Движок споткнулся"
                  : (outcome === "lose" && LOSE_TEXT[log?.outcome.reason ?? ""]) || OUTCOME_TEXT[outcome!]}
              </strong>
              {failure && <p>{failure}</p>}
              {log?.error && (
                <>
                  <p>{log.error.human}</p>
                  <code className={styles.errorRaw}>
                    {log.error.type}
                    {log.error.line ? `, строка ${log.error.line}` : ""}: {log.error.message}
                  </code>
                </>
              )}
              {outcome === "win" && log && (
                <p>
                  Тиков: {log.metrics.ticks} · строк выполнено: {log.metrics.lines}
                </p>
              )}
              {outcome === "win" && next && (
                <a href={levelUrl(next.id)} className={styles.nextBtn}>
                  Следующий уровень: {next.title} →
                </a>
              )}
              {outcome === "win" && !next && <p>Это был последний уровень. Остальные ещё строятся.</p>}
            </div>
          )}
        </main>

        {/* ─── Справа: код, под ним задание и справочник ─── */}
        <aside className={styles.side}>
          <div className={styles.editorBox}>
            <div className={styles.bar}>
              <span className={styles.tab}>{level.id.replace(/-/g, "_")}.py</span>
              {/* Состояние движка живёт в самой кнопке: пока Python грузится —
                  жёлтая с крутилкой, готов — зелёная, не загрузился — красная */}
              <button
                type="button"
                className={styles.runBtn}
                data-engine={engine}
                onClick={run}
                disabled={running || engine !== "ready"}
                title={
                  engine === "failed"
                    ? "Python не загрузился — обнови страницу"
                    : engine === "ready"
                      ? undefined
                      : "Загружаем Python…"
                }
              >
                {engine === "ready" || engine === "failed" ? (
                  <span className={styles.runIcon} aria-hidden="true">
                    ▶
                  </span>
                ) : (
                  <span className={styles.spinner} role="status" aria-label="Загружаем Python" />
                )}
                {engine === "failed"
                  ? "Python не загрузился"
                  : engine !== "ready"
                    ? "Загружаем Python…"
                    : running
                      ? "Выполняем…"
                      : "Запуск"}
              </button>
            </div>
            <Editor initial={level.starter} api={level.api} ref={editor} />
          </div>

          <div className={styles.info}>
            <section className={styles.card}>
              <h2 className={styles.h2}>Задание</h2>
              <p className={styles.brief}>{renderBrief(level.brief)}</p>
            </section>

            <section className={styles.card}>
              <h2 className={styles.h2}>Команды героя</h2>
              <ul className={styles.api}>
                {level.api.map((name) => (
                  <li key={name}>
                    <code>{name}()</code>
                    <span>{COMMANDS[name] ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>

            {vars.length > 0 && (
              <section className={styles.card}>
                <h2 className={styles.h2}>Переменные</h2>
                <ul className={styles.vars}>
                  {vars.map(([k, v]) => (
                    <li key={k}>
                      <code>{k}</code> = <code>{JSON.stringify(v)}</code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
