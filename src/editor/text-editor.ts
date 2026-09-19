import { EditorState, Annotation, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

export interface TextEditorHandlers {
  onChange: () => void;
  onSelectionChange: () => void;
}

// 大文件分批追加的标记：内容变了但不算用户编辑，不能触发脏标记。
const chunkAppend = Annotation.define<boolean>();

// 颜色一律走 CSS 变量：CodeMirror 生成的 .cm-* 规则优先级高于页面样式，
// 写死浅色值会让暗色主题下正文/光标仍然按浅色渲染。
const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", fontSize: "13px" },
  "&:focus-within": { backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
    lineHeight: "1.85",
    padding: "28px 34px",
    tabSize: "2",
  },
  ".cm-content": { caretColor: "var(--text)", color: "var(--text)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--cm-selection)" },
  ".cm-focused": { outline: "none" },
  ".cm-scroller::-webkit-scrollbar": { width: "8px" },
  ".cm-scroller::-webkit-scrollbar-thumb": { borderRadius: "8px", background: "var(--scroll-thumb)" },
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
  private readonly = false;
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
        EditorState.readOnly.of(this.readonly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.cached = "";
            const appendedOnly = update.transactions.every((transaction) => transaction.annotation(chunkAppend) === true);
            if (!appendedOnly) this.handlers.onChange();
          }
          if (update.selectionSet) this.handlers.onSelectionChange();
        }),
        ...this.extraExtensions,
      ],
    });
  }

  setReadonly(readonly: boolean): void {
    if (this.readonly === readonly) return;
    this.readonly = readonly;
    this.view.setState(this.buildState(this.view.state.doc.toString()));
  }

  get isReadonly(): boolean {
    return this.readonly;
  }

  // 追加一段已解码正文：不走 onChange，因此不会被当成用户编辑。
  appendChunk(text: string): void {
    if (!text) return;
    const { length } = this.view.state.doc;
    this.cached = "";
    this.view.dispatch({
      changes: { from: length, insert: text },
      annotations: chunkAppend.of(true),
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
