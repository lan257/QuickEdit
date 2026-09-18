import type { CommandFailure, TreeNode } from "./types";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[character] || character));
}

let idSequence = 0;
export function nextId(): string {
  idSequence += 1;
  return `node-${idSequence}`;
}

export function hasTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMeta(node: TreeNode): string {
  if (node.kind !== "file") return node.path;
  return `${node.extension || "无扩展名"} · ${formatBytes(node.size)} · ${node.path}`;
}

export function formatModifiedTime(value: number): string {
  if (!value) return "修改时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatCreatedTime(value: number): string {
  if (!value) return "创建时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function countFiles(node: Pick<TreeNode, "children">): number {
  return node.children.reduce((count, child) => count + (child.kind === "file" ? 1 : countFiles(child)), 0);
}

export function commandFailure(error: unknown): CommandFailure {
  if (typeof error === "object" && error !== null) {
    const value = error as CommandFailure;
    return { code: value.code, message: value.message };
  }
  return { message: typeof error === "string" ? error : "本地文件操作失败。" };
}

export function failureMessage(error: unknown): string {
  return commandFailure(error).message || "本地文件操作失败。";
}
