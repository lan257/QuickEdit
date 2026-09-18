import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
import type { TextRange } from "../types";

interface MarkerSpec {
  id: string;
  from: number;
  to: number;
}

const setMarkersEffect = StateEffect.define<MarkerSpec[]>();
const setActiveMarkerEffect = StateEffect.define<string | null>();

export interface MarkerTooltip {
  title: string;
  meta: string;
}

export interface TextAnnotationHooks {
  onMarkerClick: (id: string) => void;
  tooltipFor: (id: string) => MarkerTooltip | null;
}

const marksField = StateField.define<{ marks: readonly MarkerSpec[]; activeId: string | null }>({
  create: () => ({ marks: [], activeId: null }),
  update(value, transaction) {
    let marks = value.marks;
    let activeId = value.activeId;
    for (const effect of transaction.effects) {
      if (effect.is(setMarkersEffect)) marks = [...effect.value].sort((left, right) => left.from - right.from || left.to - right.to);
      if (effect.is(setActiveMarkerEffect)) activeId = effect.value;
    }
    if (transaction.docChanged) {
      marks = marks.map((mark) => ({
        id: mark.id,
        from: transaction.changes.mapPos(mark.from, -1),
        to: transaction.changes.mapPos(mark.to, 1),
      }));
    }
    return { marks, activeId };
  },
});

function findMarksAt(marks: readonly MarkerSpec[], position: number): MarkerSpec[] {
  return marks.filter((mark) => position >= mark.from && position <= mark.to);
}

function findMarkAt(marks: readonly MarkerSpec[], position: number): MarkerSpec | null {
  const hits = findMarksAt(marks, position);
  if (hits.length === 0) return null;
  return hits.reduce((best, mark) => (mark.to - mark.from < best.to - best.from ? mark : best));
}

export function annotationExtensions(hooks: TextAnnotationHooks): Extension[] {
  return [
    marksField,
    EditorView.decorations.compute([marksField], (state) => {
      const { marks, activeId } = state.field(marksField);
      const ranges = marks
        .filter((mark) => mark.to > mark.from)
        .map((mark) =>
          Decoration.mark({
            class: `cm-annotation-mark${mark.id === activeId ? " cm-annotation-active" : ""}`,
            attributes: { "data-annotation-id": mark.id },
          }).range(mark.from, mark.to)
        ) as Range<Decoration>[];
      return Decoration.set(ranges, true);
    }),
    hoverTooltip((view, position) => {
      const marks = findMarksAt(view.state.field(marksField).marks, position);
      if (marks.length === 0) return null;
      const infos = marks
        .map((mark) => {
          const info = hooks.tooltipFor(mark.id);
          return info ? { id: mark.id, info } : null;
        })
        .filter((item): item is { id: string; info: MarkerTooltip } => item !== null);
      if (infos.length === 0) return null;
      return {
        pos: marks[0].from,
        end: marks[marks.length - 1].to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "annotation-tooltip";
          if (infos.length > 1) {
            const header = document.createElement("div");
            header.className = "annotation-tooltip-count";
            header.textContent = `${infos.length} 条批注`;
            dom.append(header);
          }
          for (const { id, info } of infos) {
            const row = document.createElement("div");
            row.className = "annotation-tooltip-item";
            const title = document.createElement("div");
            title.className = "annotation-tooltip-text";
            title.textContent = info.title;
            const meta = document.createElement("div");
            meta.className = "annotation-tooltip-meta";
            meta.textContent = info.meta;
            row.append(title, meta);
            row.addEventListener("click", () => hooks.onMarkerClick(id));
            dom.append(row);
          }
          return { dom };
        },
      };
    }),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        const mark = findMarkAt(view.state.field(marksField).marks, position);
        if (mark) hooks.onMarkerClick(mark.id);
        return false;
      },
    }),
  ];
}

export interface AnnotationMarkerItem {
  id: string;
  range: TextRange;
}

export function dispatchMarkers(view: EditorView, items: AnnotationMarkerItem[]): void {
  view.dispatch({
    effects: setMarkersEffect.of(items.map((item) => ({ id: item.id, from: item.range.start, to: item.range.end }))),
  });
}

export function dispatchActiveMarker(view: EditorView, id: string | null): void {
  view.dispatch({ effects: setActiveMarkerEffect.of(id) });
}

export function currentMarkerRanges(view: EditorView): Map<string, TextRange> {
  const ranges = new Map<string, TextRange>();
  for (const mark of view.state.field(marksField).marks) {
    ranges.set(mark.id, { start: mark.from, end: mark.to });
  }
  return ranges;
}
