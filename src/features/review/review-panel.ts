import { basename, failureMessage, formatBytes, formatModifiedTime, hasTauriRuntime } from "../../core/format";
import {
  approveChangeSet, diffTally, fetchChangeSetHistory, fetchPendingChangesets, fetchReviewDiff,
  lineDiff, rejectChangeSet, type ChangeSet, type FileChange,
} from "./review-service";
import {
  reviewBadgeElement, reviewBodyElement, reviewButton, reviewCloseButton, reviewOverlayElement,
} from "../../ui/elements";
import { showToast } from "../../ui/toast";

const STATUS_LABEL: Record<string, string> = {
  recording: "记录中",
  pending: "待审批",
  approved: "已确认",
  rejected: "已回滚",
  conflict: "有冲突",
};
const KIND_LABEL: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除", unchanged: "未变" };

export interface ReviewPanel {
  bind(): void;
  refresh(): Promise<void>;
}

export function createReviewPanel(): ReviewPanel {
  let pending: ChangeSet[] = [];
  let history: ChangeSet[] = [];
  let open = false;
  let expandedKey = "";
  let diffRows: { path: string; rows: ReturnType<typeof lineDiff> } | null = null;
  let busy = false;

  const close = (): void => {
    open = false;
    reviewOverlayElement.classList.add("hidden");
    render();
  };

  const el = (tag: string, className?: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fileRow = (set: ChangeSet, change: FileChange): HTMLElement => {
    const row = el("div", "review-file");
    const chip = el("span", `review-kind kind-${change.kind}`, KIND_LABEL[change.kind] || change.kind);
    const name = el("span", "review-file-name", basename(change.path));
    name.title = change.path;
    const size = el("span", "review-file-size", `${formatBytes(change.beforeSize)} → ${formatBytes(change.afterSize)}`);
    const tally = el("span", "review-file-tally", `+${change.addedLines} -${change.removedLines}`);
    row.append(chip, name, tally, size);
    if (change.textDiffable) {
      const button = el("button", "image-btn", expandedKey === `${set.id}:${change.path}` ? "收起 Diff" : "查看 Diff") as HTMLButtonElement;
      button.type = "button";
      button.addEventListener("click", () => void toggleDiff(set, change));
      row.append(button);
    }
    return row;
  };

  const toggleDiff = async (set: ChangeSet, change: FileChange): Promise<void> => {
    const key = `${set.id}:${change.path}`;
    if (expandedKey === key) {
      expandedKey = "";
      diffRows = null;
      render();
      return;
    }
    expandedKey = key;
    diffRows = null;
    render();
    try {
      const result = await fetchReviewDiff(set.id, change.path);
      if (expandedKey !== key) return;
      diffRows = { path: change.path, rows: lineDiff(result.before || "", result.after || "") };
    } catch (error) {
      if (expandedKey !== key) return;
      diffRows = { path: change.path, rows: [{ kind: "removed", text: `读取差异失败：${failureMessage(error)}` }] };
    }
    render();
  };

  const setCard = (set: ChangeSet): HTMLElement => {
    const card = el("div", `review-set status-${set.status}`);
    const head = el("div", "review-set-head");
    head.append(
      el("span", `review-status status-${set.status}`, STATUS_LABEL[set.status] || set.status),
      el("strong", "review-set-source", set.source),
      el("span", "review-set-time", formatModifiedTime(set.createdAt)),
    );
    if (set.summary) head.append(el("span", "review-set-summary", set.summary));
    card.append(head);
    const changed = set.files.filter((change) => change.kind !== "unchanged");
    if (changed.length === 0) card.append(el("div", "review-empty", "本轮没有检测到文件变化。"));
    for (const change of changed) {
      card.append(fileRow(set, change));
      if (expandedKey === `${set.id}:${change.path}`) {
        const box = el("div", "review-diff");
        if (!diffRows || diffRows.path !== change.path) box.append(el("div", "review-diff-line", "正在计算差异…"));
        else {
          const total = diffTally(diffRows.rows);
          box.append(el("div", "review-diff-meta", `+${total.added} / -${total.removed} 行`));
          for (const row of diffRows.rows.slice(0, 2000)) {
            box.append(el("div", `review-diff-line diff-${row.kind}`, `${row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "} ${row.text}`));
          }
          if (diffRows.rows.length > 2000) box.append(el("div", "review-diff-line", `（差异过长，仅显示前 2000 行）`));
        }
        card.append(box);
      }
    }
    if (set.status === "pending") {
      const actions = el("div", "review-actions");
      const reason = el("input", "review-reason") as HTMLInputElement;
      reason.type = "text";
      reason.placeholder = "回滚原因（可选，会写入审阅记录供 Agent 读取）";
      const rollback = el("button", "btn", "↩ 回滚本轮修改") as HTMLButtonElement;
      rollback.type = "button";
      rollback.addEventListener("click", () => void decide(() => rejectChangeSet(set.id, reason.value)));
      const approve = el("button", "btn primary", "✓ 确认本轮修改") as HTMLButtonElement;
      approve.type = "button";
      approve.addEventListener("click", () => void decide(() => approveChangeSet(set.id)));
      actions.append(reason, rollback, approve);
      card.append(actions);
    }
    if (set.decision?.reason) card.append(el("div", "review-decision", `原因：${set.decision.reason}`));
    return card;
  };

  const decide = async (action: () => Promise<ChangeSet>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const result = await action();
      showToast(result.status === "approved" ? "已确认本轮修改。" : "已回滚本轮修改。");
      expandedKey = "";
      diffRows = null;
      await refresh();
      if (open) render();
    } catch (error) {
      showToast(failureMessage(error), true);
    } finally {
      busy = false;
    }
  };

  const render = (): void => {
    if (!open) {
      reviewBodyElement.replaceChildren();
      return;
    }
    reviewBodyElement.replaceChildren();
    const groups = pending.filter((set) => set.status === "pending");
    const recording = pending.filter((set) => set.status === "recording");
    if (groups.length === 0 && recording.length === 0) {
      reviewBodyElement.append(el("div", "review-empty", "当前没有待审批的 Agent 修改。"));
    }
    for (const set of groups) reviewBodyElement.append(setCard(set));
    for (const set of recording) {
      const card = el("div", "review-set status-recording");
      const head = el("div", "review-set-head");
      head.append(
        el("span", "review-status status-recording", "记录中"),
        el("strong", "review-set-source", set.source),
        el("span", "review-set-summary", `已跟踪 ${set.files.length} 个文件，等待 Agent 提交 capture`),
      );
      card.append(head);
      for (const change of set.files) card.append(fileRow(set, change));
      reviewBodyElement.append(card);
    }
    const past = history.filter((set) => set.status !== "pending" && set.status !== "recording");
    if (past.length > 0) {
      reviewBodyElement.append(el("div", "review-history-title", `最近审阅记录（${past.length}）`));
      for (const set of past.slice(0, 12)) {
        const row = el("div", "review-history-row");
        const changed = set.files.filter((change) => change.kind !== "unchanged").length;
        row.append(
          el("span", `review-status status-${set.status}`, STATUS_LABEL[set.status] || set.status),
          el("span", "review-set-source", set.source),
          el("span", "review-file-tally", `${changed} 个文件`),
          el("span", "review-set-time", formatModifiedTime(set.completedAt || set.createdAt)),
        );
        if (set.decision?.reason) row.append(el("span", "review-history-reason", set.decision.reason));
        reviewBodyElement.append(row);
      }
    }
  };

  async function refresh(): Promise<void> {
    if (!hasTauriRuntime()) return;
    try {
      [pending, history] = await Promise.all([fetchPendingChangesets(), fetchChangeSetHistory(20)]);
    } catch {
      return;
    }
    const count = pending.filter((set) => set.status === "pending").length;
    reviewBadgeElement.textContent = String(count);
    reviewButton.classList.toggle("hidden", count === 0 && !open);
    render();
  }

  function bind(): void {
    reviewButton.addEventListener("click", () => {
      open = true;
      reviewOverlayElement.classList.remove("hidden");
      void refresh();
    });
    reviewCloseButton.addEventListener("click", close);
    reviewOverlayElement.addEventListener("click", (event) => {
      if (event.target === reviewOverlayElement) close();
    });
  }

  return { bind, refresh };
}
