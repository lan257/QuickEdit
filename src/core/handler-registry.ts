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
  return true;
}

export function activeCapabilities(extension: string): DocumentCapabilities | null {
  const manifest = findHandlerManifest(extension);
  if (!manifest) return null;
  const handler = instances.get(manifest.id);
  return handler ? handler.capabilities : null;
}

export async function disposeHandler(id: string): Promise<void> {
  const handler = instances.get(id);
  if (!handler) return;
  await handler.dispose();
}
