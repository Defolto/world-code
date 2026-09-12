import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import styles from "./Editor.module.css";

/**
 * Редактор кода. CodeMirror монтируется руками в ref, без React-обёрток:
 * обёртки пересоздают EditorView и теряют курсор с историей. Редактор
 * uncontrolled — React не знает текста, пока не спросит через getValue().
 *
 * Подсветка текущей строки при проигрывании — StateField с декорацией,
 * которую двигает плеер через setActiveLine(). Это не выделение и не
 * курсор: ребёнок может править код, пока плёнка крутится.
 */
export interface EditorHandle {
  getValue(): string;
  /** Строка, которую сейчас исполняет плеер (1-based), или null */
  setActiveLine(line: number | null): void;
  /** Строка с ошибкой — красная, до следующего запуска */
  setErrorLine(line: number | null): void;
  setReadOnly(readOnly: boolean): void;
}

const setActive = StateEffect.define<number | null>();
const setError = StateEffect.define<number | null>();

const activeMark = Decoration.line({ class: styles.activeLine });
const errorMark = Decoration.line({ class: styles.errorLine });

function lineField(effect: typeof setActive, mark: Decoration) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(effect)) {
          if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) {
            deco = Decoration.none;
          } else {
            const line = tr.state.doc.line(e.value);
            deco = Decoration.set([mark.range(line.from)]);
          }
        }
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const activeField = lineField(setActive, activeMark);
const errorField = lineField(setError, errorMark);

// Цвета — токены из tokens.css, чтобы тема редактора менялась вместе с сайтом
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-keyword)" },
  { tag: [tags.function(tags.propertyName), tags.function(tags.variableName)], color: "var(--code-call)" },
  { tag: tags.comment, color: "var(--ink-faint)", fontStyle: "italic" },
  { tag: [tags.string, tags.number], color: "var(--gold)" },
  { tag: tags.variableName, color: "var(--ink)" },
  { tag: tags.propertyName, color: "var(--code-call)" },
  { tag: tags.operator, color: "var(--ink-dim)" },
]);

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--ink)", fontSize: "14px", height: "100%" },
    ".cm-content": { fontFamily: "var(--mono)", padding: "12px 0", caretColor: "var(--emerald)" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.8" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--ink-faint)",
      border: "none",
      paddingLeft: "6px",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-cursor": { borderLeftColor: "var(--emerald)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--emerald) 22%, transparent)",
    },
  },
  { dark: true },
);

interface EditorProps {
  initial: string;
  ref: Ref<EditorHandle>;
}

export function Editor({ initial, ref }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnly = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        history(),
        // Tab — четыре пробела, как в учебнике, а не прыжок фокуса
        indentUnit.of("    "),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        python(),
        syntaxHighlighting(highlight),
        theme,
        activeField,
        errorField,
        readOnly.current.of(EditorState.readOnly.of(false)),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Начальный текст читается один раз при монтировании: редактор uncontrolled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => view.current?.state.doc.toString() ?? "",
      setActiveLine: (line) => view.current?.dispatch({ effects: setActive.of(line) }),
      setErrorLine: (line) => view.current?.dispatch({ effects: setError.of(line) }),
      setReadOnly: (ro) =>
        view.current?.dispatch({ effects: readOnly.current.reconfigure(EditorState.readOnly.of(ro)) }),
    }),
    [],
  );

  return <div ref={host} className={styles.editor} />;
}
