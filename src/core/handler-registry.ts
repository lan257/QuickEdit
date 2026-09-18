import type { AppConfig, TreeNode } from "./types";

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

export interface HandlerContext {
  node: TreeNode;
  config: AppConfig;
}

export interface DocumentHandler {
  readonly id: string;
  readonly capabilities: DocumentCapabilities;
  open(context: HandlerContext): Promise<void>;
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

export async function openWithHandler(node: TreeNode, config: AppConfig): Promise<boolean> {
  const manifest = findHandlerManifest(node.extension);
  if (!manifest) return false;
  let handler = instances.get(manifest.id);
  if (!handler) {
    handler = await manifest.load();
    instances.set(manifest.id, handler);
  }
  await handler.open({ node, config });
  activeId = manifest.id;
  return true;
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
