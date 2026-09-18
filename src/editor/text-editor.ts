import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

export interface TextEditorHandlers {
  onChange: () => void;
  onSelectionChange: () => void;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#fff", fontSize: "13px" },
  "&:focus-within": { backgroundColor: "#fefeff" },
  ".cm-scroller": {
    fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
    lineHeight: "1.85",
    padding: "28px 34px",
    tabSize: "2",
  },
  ".cm-content": { caretColor: "#222b3a", color: "#222b3a" },
  ".cm-focused": { outline: "none" },
  ".cm-scroller::-webkit-scrollbar": { width: "8px" },
  ".cm-scroller::-webkit-scrollbar-thumb": { borderRadius: "8px", background: "#c6cddd" },
});

export interface TextRange {
  start: number;
  end: number;
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export class TextEditor {
  readonly view: EditorView;
  private lastText = "";
  private cached = "";
  private readonly extraExtensions: Extension[];
  private readonly handlers: TextEditorHandlers;

  constructor(host: HTMLElement, extraExtensions: Extension[], handlers: TextEditorHandlers) {
    this.extraExtensions = extraExtensions;
    this.handlers = handlers;
    this.view = new EditorView({
      parent: host,
      state: this.buildState(""),
    });
  }

  private buildState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        history(),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.cached = "";
            this.handlers.onChange();
          }
          if (update.selectionSet) this.handlers.onSelectionChange();
        }),
        ...this.extraExtensions,
      ],
    });
  }

  loadText(text: string): void {
    this.view.setState(this.buildState(text));
    this.cached = text;
    this.lastText = text;
  }

  getText(): string {
    if (this.cached) return this.cached;
    this.cached = this.view.state.doc.toString();
    return this.cached;
  }

  get lastSavedText(): string {
    return this.lastText;
  }

  setLastSavedText(text: string): void {
    this.lastText = text;
  }

  selectionRange(): TextRange {
    const range = this.view.state.selection.main;
    return { start: range.from, end: range.to };
  }

  selectionAnchor(): number {
    return this.view.state.selection.main.from;
  }

  selectRange(range: TextRange, options?: { scroll?: boolean; focus?: boolean }): void {
    this.view.dispatch({
      selection: { anchor: range.start, head: range.end },
      scrollIntoView: options?.scroll !== false,
    });
    if (options?.focus !== false) this.view.focus();
  }

  replaceRange(edit: TextEdit): void {
    this.view.dispatch({ changes: edit, scrollIntoView: false });
  }

  replaceRanges(edits: TextEdit[]): void {
    if (edits.length === 0) return;
    this.view.dispatch({ changes: edits, scrollIntoView: false });
  }

  lineOf(position: number): number {
    return this.view.state.doc.lineAt(Math.max(0, Math.min(position, this.view.state.doc.length))).number;
  }

  lineCount(): number {
    return this.view.state.doc.lines;
  }

  coordsAt(position: number): ReturnType<EditorView["coordsAtPos"]> | null {
    if (position < 0 || position > this.view.state.doc.length) return null;
    return this.view.coordsAtPos(position);
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
