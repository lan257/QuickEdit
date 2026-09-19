import { invoke } from "@tauri-apps/api/core";

export type ChangeSetStatus = "recording" | "pending" | "approved" | "rejected" | "conflict";
export type FileChangeKind = "added" | "modified" | "deleted" | "unchanged";

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  beforeSize: number;
  afterSize: number;
  addedLines: number;
  removedLines: number;
  textDiffable: boolean;
}

export interface ChangeSet {
  id: string;
  source: string;
  createdAt: number;
  completedAt?: number;
  status: ChangeSetStatus;
  summary?: string;
  files: FileChange[];
  decision?: { decidedAt: number; reason?: string };
}

export interface ReviewDiff {
  path: string;
  before: string | null;
  after: string | null;
}

export type DiffRow = { kind: "same" | "added" | "removed"; text: string };

// 行级 diff：公共前后缀原样保留，中间段按“行内容多重集”匹配。
// 口径与 Rust 的 added/removed 计数一致，因此列表上的 +N -M 与展开的行必然对得上。
export function lineDiff(before: string, after: string): DiffRow[] {
  const left = before.length > 0 ? before.split("\n") : [];
  const right = after.length > 0 ? after.split("\n") : [];
  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1;
  let tail = 0;
  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) {
    tail += 1;
  }
  const midLeft = left.slice(head, left.length - tail);
  const midRight = right.slice(head, right.length - tail);

  const remaining = new Map<string, number>();
  for (const line of midLeft) remaining.set(line, (remaining.get(line) || 0) + 1);
  const matched = midRight.map((line) => {
    const count = remaining.get(line) || 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      return true;
    }
    return false;
  });
  const removed: string[] = [];
  for (const line of midLeft) {
    const count = remaining.get(line) || 0;
    if (count > 0) {
      removed.push(line);
      remaining.set(line, count - 1);
    }
  }

  const rows: DiffRow[] = left.slice(0, head).map((text) => ({ kind: "same" as const, text }));
  midRight.forEach((text, index) => rows.push({ kind: matched[index] ? "same" : "added", text }));
  for (const text of removed) rows.push({ kind: "removed", text });
  for (const text of right.slice(right.length - tail)) rows.push({ kind: "same", text });
  return rows;
}

export function diffTally(rows: DiffRow[]): { added: number; removed: number } {
  return rows.reduce(
    (total, row) => {
      if (row.kind === "added") total.added += 1;
      if (row.kind === "removed") total.removed += 1;
      return total;
    },
    { added: 0, removed: 0 },
  );
}

export async function fetchPendingChangesets(): Promise<ChangeSet[]> {
  return invoke<ChangeSet[]>("review_pending");
}

export async function fetchChangeSetHistory(limit = 30): Promise<ChangeSet[]> {
  return invoke<ChangeSet[]>("review_history", { limit });
}

export async function fetchReviewDiff(id: string, path: string): Promise<ReviewDiff> {
  return invoke<ReviewDiff>("review_diff", { id, path });
}

export async function approveChangeSet(id: string): Promise<ChangeSet> {
  return invoke<ChangeSet>("review_approve", { id });
}

export async function rejectChangeSet(id: string, reason?: string): Promise<ChangeSet> {
  return invoke<ChangeSet>("review_reject", { id, reason: reason && reason.trim() ? reason.trim() : null });
}
