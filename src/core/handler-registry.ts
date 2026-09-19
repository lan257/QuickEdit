import type { AppConfig, FileMetadata, TreeNode } from "./types";

export interface DocumentCapabilities {
  editable: boolean;
  searchable: boolean;
  replaceable: boolean;
  annotatable: boolean;
  runnable?: boolean;
  preview?: { type: "markdown" | "html" };
  paged?: boolean;
  spreadsheet?: boolean;
}

// Handlers live in lazy modules and must not import the app controller, so the
// few things they need from it (tree/header repaint, annotation focus) come back
// through this small bridge.
export interface HandlerBridge {
  markDirty(): void;
  status(mode: string, info: string): void;
  // 视图内部改变了“当前定位”（如 PDF 滚动换页、表格选中单元格）后请状态栏重新取值。
  refreshCursor(): void;
  revealAnnotation(id: string): void;
}

export interface HandlerContext {
  node: TreeNode;
  config: AppConfig;
  bridge: HandlerBridge;
}

export interface HandlerLocator {
  sheet?: string;
  cell?: string;
  page?: number;
}

// 与批注定位器的判别联合保持一致，控制器可以直接按 scope 分支提交。
export type HandlerAnnotationTarget =
  | { scope: "cell"; scopeHint: string; locator: { sheet: string; cell: string } }
  | { scope: "page"; scopeHint: string; locator: { page: number } };

export interface DocumentHandler {
  readonly id: string;
  readonly capabilities: DocumentCapabilities;
  open(context: HandlerContext): Promise<void>;
  save?(): Promise<FileMetadata | null>;
  isDirty?(): boolean;
  // 批注相关：状态栏定位提示、新建批注的目标、跳转与标记刷新。
  cursorLabel?(): string | null;
  annotationTarget?(): HandlerAnnotationTarget | null;
  locate?(locator: HandlerLocator): boolean;
  refreshMarkers?(): void;
  // 自带查找框的视图（csv）接管 Ctrl+F，返回 true 表示已处理。
  focusSearch?(): boolean;
  dispose(): void | Promise<void>;
}

export interface HandlerManifest {
  id: string;
  extensions: string[];
  load: () => Promise<DocumentHandler>;
}

const manifests = new Map<string, HandlerManifest>();
const instances = new Map<string, DocumentHandler>();
let activeId: string | null = null;

export function registerHandler(manifest: HandlerManifest): void {
  for (const extension of manifest.extensions) {
    manifests.set(extension.toLowerCase(), manifest);
  }
}

export function findHandlerManifest(extension: string): HandlerManifest | null {
  return manifests.get(extension.toLowerCase()) || null;
}

// A registered handler claims this extension and should win over the generic
// text path (e.g. .csv is editable text but has a dedicated grid handler).
export function hasHandler(extension: string): boolean {
  return manifests.has(extension.toLowerCase());
}

export async function openWithHandler(node: TreeNode, config: AppConfig, bridge: HandlerBridge): Promise<boolean> {
  const manifest = findHandlerManifest(node.extension);
  if (!manifest) return false;
  let handler = instances.get(manifest.id);
  if (!handler) {
    handler = await manifest.load();
    instances.set(manifest.id, handler);
  }
  await handler.open({ node, config, bridge });
  activeId = manifest.id;
  return true;
}

export function activeDocumentHandler(): DocumentHandler | null {
  return activeId ? instances.get(activeId) || null : null;
}

export async function saveActiveHandler(): Promise<FileMetadata | null> {
  const handler = activeDocumentHandler();
  if (!handler?.save) return null;
  return handler.save();
}

export function activeHandlerIsDirty(): boolean {
  const handler = activeDocumentHandler();
  return handler?.isDirty ? handler.isDirty() : false;
}

// Release the currently open handler's resources (Blob URLs, observers, workers)
// before switching documents. No-op when a built-in view is active.
export async function disposeActiveHandler(): Promise<void> {
  if (!activeId) return;
  const handler = instances.get(activeId);
  activeId = null;
  if (handler) await handler.dispose();
}

export function activeHandlerId(): string | null {
  return activeId;
}
