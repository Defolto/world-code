import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { COMMANDS } from "../engine/commands";
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

// Сниппеты синтаксиса — как в настоящей IDE: `for` разворачивается в
// заготовку цикла, Tab прыгает по местам для заполнения (`${1:i}` —
// первое поле с текстом-заготовкой, `${}` — где остаётся курсор). Список общий для
// всех уровней: он не открывает ничего, что нельзя было бы набрать руками
// (api — не запрет синтаксиса), а появляется только когда ребёнок начал
// печатать это слово. Подписи на русском — они и есть объяснение.
const SNIPPETS: Completion[] = [
  snippetCompletion("for ${1:i} in range(${2:3}):\n    ${}", {
    label: "for",
    detail: "повторить несколько раз",
    type: "keyword",
  }),
  snippetCompletion("while ${1:условие}:\n    ${}", {
    label: "while",
    detail: "повторять, пока верно",
    type: "keyword",
  }),
  snippetCompletion("if ${1:условие}:\n    ${}", {
    label: "if",
    detail: "сделать, если верно",
    type: "keyword",
  }),
  snippetCompletion("else:\n    ${}", { label: "else", detail: "иначе", type: "keyword" }),
  snippetCompletion("def ${1:название}():\n    ${}", {
    label: "def",
    detail: "своя команда",
    type: "keyword",
  }),
];

/** Дополнение команд героя, открытых уровнем, плюс сниппеты синтаксиса.
 *  Срабатывает и на `he…`, и на `hero.mo…`: подставляется вся команда
 *  со скобками, курсор — после них. */
function completions(api: string[]): CompletionSource {
  // Порядок — как в api уровня и в справочнике, а не по алфавиту
  const commands: Completion[] = api.map((name, i) => ({
    label: `${name}()`,
    detail: COMMANDS[name] ?? "",
    type: "method",
    boost: api.length - i,
  }));
  const options = [...commands, ...SNIPPETS];
  return (ctx) => {
    const word = ctx.matchBefore(/hero\.\w*|\w+/);
    if (!word && !ctx.explicit) return null;
    return { from: word?.from ?? ctx.pos, options, validFor: /^(hero\.)?\w*$/ };
  };
}

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
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "var(--bg-elev)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow)",
      fontFamily: "var(--mono)",
      fontSize: "13px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 10px", lineHeight: "1.5" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in srgb, var(--emerald) 20%, transparent)",
      color: "var(--ink)",
    },
    ".cm-completionLabel": { color: "var(--code-call)" },
    ".cm-completionMatchedText": { textDecoration: "none", color: "var(--emerald)", fontWeight: "700" },
    ".cm-completionDetail": { color: "var(--ink-dim)", fontFamily: "var(--sans)", fontStyle: "normal", marginLeft: "12px" },
    ".cm-snippetField": { backgroundColor: "color-mix(in srgb, var(--gold) 22%, transparent)" },
  },
  { dark: true },
);

interface EditorProps {
  initial: string;
  /** Команды героя, открытые уровнем, — из них собирается автодополнение */
  api: string[];
  ref: Ref<EditorHandle>;
}

export function Editor({ initial, api, ref }: EditorProps) {
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
        autocompletion({ override: [completions(api)], icons: false }),
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
    // Начальный текст и api читаются один раз при монтировании: редактор
    // uncontrolled, а уровень на странице один
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
