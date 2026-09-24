import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface FindHighlight {
  start: number;
  end: number;
  active: boolean;
}

export const setFindHighlights = StateEffect.define<FindHighlight[]>();

const matchDecoration = Decoration.mark({ class: "cm-find-match" });
const activeDecoration = Decoration.mark({ class: "cm-find-match cm-find-match-active" });

export const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setFindHighlights)) continue;
      const builder = new RangeSetBuilder<Decoration>();
      // 匹配区间按扫描顺序天然递增且不重叠，直接喂给 RangeSetBuilder。
      for (const match of effect.value) {
        if (match.end <= match.start) continue;
        builder.add(match.start, match.end, match.active ? activeDecoration : matchDecoration);
      }
      return builder.finish();
    }
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
