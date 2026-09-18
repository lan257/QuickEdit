import type { AnnotationEntry, ResolvedAnnotation } from "../types";

export interface PanelCallbacks {
  onActivate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onToggleTagFilter: (tag: string) => void;
}

export interface PanelParams {
  listElement: HTMLElement;
  annotations: ResolvedAnnotation[];
  hasDocument: boolean;
  loading: boolean;
  staleSummary: { relocated: number; ambiguous: number; orphaned: number } | null;
  activeId: string | null;
  activeTagFilter: string | null;
  filterActive: boolean;
  positionLabel: (entry: AnnotationEntry, range?: { start: number; end: number }) => string;
  callbacks: PanelCallbacks;
}

function relativeTime(iso: string): string {
  if (!iso) return "刚刚";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(time));
}

const resolutionNotice: Record<string, string> = {
  ambiguous: "⚠ 原文中有多处相似内容，定位不确定",
  orphaned: "⚠ 原位置已无法定位",
};

export function renderAnnotationPanel(params: PanelParams): void {
  const { listElement, annotations, hasDocument, staleSummary, activeId, activeTagFilter, callbacks } = params;
  listElement.innerHTML = "";
  if (staleSummary) {
    const warning = document.createElement("div");
    warning.className = "note-stale-warning";
    const parts = [`原文件已变化：✓ ${staleSummary.relocated} 条已重新定位`];
    if (staleSummary.ambiguous > 0) parts.push(`⚠ ${staleSummary.ambiguous} 条定位不确定`);
    if (staleSummary.orphaned > 0) parts.push(`⚠ ${staleSummary.orphaned} 条无法定位`);
    warning.textContent = parts.join(" · ");
    listElement.append(warning);
  }
  if (!hasDocument) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = params.loading ? "正在加载批注…" : "暂无批注";
    listElement.append(empty);
    return;
  }
  if (annotations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = params.filterActive ? "当前过滤条件下没有批注。" : "暂无批注，选中正文或使用上方“+ 文件批注”添加。";
    listElement.append(empty);
    return;
  }
  for (const item of annotations) {
    const { entry, resolution, range } = item;
    const card = document.createElement("article");
    card.className = "note-card note-card-interactive";
    card.dataset.annotationId = entry.id;
    if (entry.id === activeId) card.classList.add("note-card-active");
    if (entry.status === "resolved") card.classList.add("note-card-resolved");
    if (resolution !== "resolved") card.classList.add(`note-card-${resolution}`);
    card.addEventListener("click", () => callbacks.onActivate(entry.id));

    const head = document.createElement("div");
    head.className = "note-card-head";
    const position = document.createElement("span");
    position.className = "note-position";
    position.textContent = params.positionLabel(entry, range);
    head.append(position);
    if (entry.status === "resolved") {
      const status = document.createElement("span");
      status.className = "note-status";
      status.textContent = "已解决";
      head.append(status);
    }
    card.append(head);

    if (entry.anchor?.quote) {
      const quote = document.createElement("div");
      quote.className = "note-quote";
      quote.textContent = `“${entry.anchor.quote.slice(0, 80)}”`;
      card.append(quote);
    }

    const text = document.createElement("div");
    text.className = "note-text";
    text.textContent = entry.text;
    card.append(text);

    if (entry.tags && entry.tags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.className = "note-tags";
      for (const tag of entry.tags) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "note-tag-chip";
        if (tag === activeTagFilter) chip.classList.add("active");
        chip.textContent = tag;
        chip.title = activeTagFilter === tag ? "取消按标签过滤" : `只看“${tag}”标签的批注`;
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          callbacks.onToggleTagFilter(tag);
        });
        tagsRow.append(chip);
      }
      card.append(tagsRow);
    }

    if (resolution !== "resolved") {
      const notice = document.createElement("div");
      notice.className = "note-resolution-warning";
      notice.textContent = resolutionNotice[resolution] || "⚠ 定位异常";
      card.append(notice);
    }

    const foot = document.createElement("div");
    foot.className = "note-foot";
    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = relativeTime(entry.updatedAt || entry.createdAt);
    const actions = document.createElement("div");
    actions.className = "note-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "note-toggle-status";
    toggle.textContent = entry.status === "resolved" ? "↺ 重新打开" : "✓ 解决";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onToggleStatus(entry.id);
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "note-edit";
    edit.textContent = "编辑";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onEdit(entry.id);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "note-remove";
    remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onDelete(entry.id);
    });
    actions.append(toggle, edit, remove);
    foot.append(time, actions);
    card.append(foot);
    listElement.append(card);
  }
}
