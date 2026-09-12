import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import levels from "virtual:levels";
import { getStatus, onStatus, runProgram, warmUp, type EngineStatus } from "../engine/runner";
import type { Frame, FrameLog, Level } from "../engine/types";
import { Camera } from "../scene/camera";
import { DISPLAY_CELL } from "../scene/grid";
import { LevelPlayer, SPEEDS, type SceneRefs, type Speed } from "../scene/levelPlayer";
import { Editor, type EditorHandle } from "./Editor";
import { CHARACTERS, CharacterFace, type CharacterId } from "./HeroSprite";
import { LevelScene, parseMap, sceneSize } from "./LevelScene";
import styles from "./Play.module.css";

// Человеческие имена команд для справочника. Правила — в симуляторе,
// здесь только подписи.
const COMMANDS: Record<string, string> = {
  "hero.move_right": "шаг вправо",
  "hero.move_left": "шаг влево",
  "hero.move_up": "шаг вверх",
  "hero.move_down": "шаг вниз",
  "hero.wait": "постоять один ход",
};

const ENGINE_TEXT: Record<EngineStatus, string> = {
  idle: "",
  loading: "Загружаем Python…",
  ready: "Python готов",
  failed: "Python не загрузился — обнови страницу",
};

const OUTCOME_TEXT = {
  win: "Уровень пройден!",
  lose: "Герой не дошёл до флага",
  timeout: "Код работал слишком долго",
  error: "В коде ошибка",
} as const;

// Порядок уровней — по занятию, внутри занятия по id. Роутера и списка
// уроков пока нет, это и есть весь «курс»
const ORDER: Level[] = Object.values(levels).sort(
  (a, b) => a.lesson - b.lesson || a.id.localeCompare(b.id),
);

const levelUrl = (id: string) => `/play/?level=${encodeURIComponent(id)}`;

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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
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
    return {
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
    if (r && !player.current) LevelPlayer.drawIdle(r, map.start, map.gates);
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
    const p = new LevelPlayer(log, map.start, map.gates, r, {
      onFrame: (f) => {
        setFrame(f);
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
  }, [speed]);

  const run = async () => {
    const source = editor.current?.getValue() ?? "";
    setRunning(true);
    setFailure(null);
    setFrame(null);
    editor.current?.setErrorLine(null);
    editor.current?.setActiveLine(null);
    try {
      setLog(await runProgram(source, level));
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
          <span className={styles.lesson}>Занятие {level.lesson}</span>
          <h1 className={styles.title}>{level.title}</h1>
        </div>
        <nav className={styles.levels} aria-label="Уровни">
          {ORDER.map((l, i) => (
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
        </nav>
        <span className={`${styles.engine} ${styles[engine]}`} role="status">
          {ENGINE_TEXT[engine]}
        </span>
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
              <strong>{failure ? "Движок споткнулся" : OUTCOME_TEXT[outcome!]}</strong>
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
              <button
                type="button"
                className={styles.runBtn}
                onClick={run}
                disabled={running || engine === "failed"}
              >
                {running ? "Выполняем…" : "▶ Запуск"}
              </button>
            </div>
            <Editor initial={level.starter} ref={editor} />
          </div>

          <div className={styles.info}>
            <section className={styles.card}>
              <h2 className={styles.h2}>Задание</h2>
              <p className={styles.brief}>{level.brief}</p>
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
