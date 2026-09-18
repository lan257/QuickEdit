import { invoke } from "@tauri-apps/api/core";
import { isLegacyDocument, normalizeDocument } from "./migration";
import { buildAnchor, resolveTextAnchor } from "./text-anchor";
import type {
  AnnotationDocument,
  AnnotationEntry,
  AnnotationState,
  CellLocator,
  PageLocator,
  ResolvedAnnotation,
  TextAnchor,
  TextRange,
  TextRangeLocator,
} from "./types";

export interface CreateAnnotationInput {
  scope: AnnotationEntry["scope"];
  locator?: TextRangeLocator | PageLocator | CellLocator | null;
  anchor?: TextAnchor | null;
  text: string;
  tags?: string[];
}

interface AnnotationService {
  document: AnnotationDocument | null;
  path: string;
  stale: boolean;
  damaged: boolean;
  migratedFromV1: boolean;
  resolved: Map<string, ResolvedAnnotation>;
  savedSnapshot: string;
  listeners: Set<() => void>;
}

const service: AnnotationService = {
  document: null,
  path: "",
  stale: false,
  damaged: false,
  migratedFromV1: false,
  resolved: new Map(),
  savedSnapshot: "",
  listeners: new Set(),
};

function newId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function onAnnotationsChanged(listener: () => void): void {
  service.listeners.add(listener);
}

function notify(): void {
  for (const listener of service.listeners) listener();
}

export function resetAnnotations(): void {
  service.document = null;
  service.path = "";
  service.stale = false;
  service.damaged = false;
  service.migratedFromV1 = false;
  service.resolved = new Map();
  service.savedSnapshot = "";
  notify();
}

export function annotationDocument(): AnnotationDocument | null {
  return service.document;
}

export function annotationPath(): string {
  return service.path;
}

export function annotationStale(): boolean {
  return service.stale;
}

export function annotationDamaged(): boolean {
  return service.damaged;
}

export function resolvedAnnotations(): ResolvedAnnotation[] {
  return (service.document?.annotations || []).map((entry) => service.resolved.get(entry.id) || { entry, resolution: "resolved" as const });
}

export function resolveEntry(source: string, entry: AnnotationEntry): ResolvedAnnotation {
  if (entry.scope !== "text-range" || !entry.anchor) return { entry, resolution: "resolved" };
  const locator = entry.locator && "start" in entry.locator ? entry.locator : null;
  const outcome = resolveTextAnchor(source, locator, entry.anchor);
  return { entry, resolution: outcome.resolution, range: outcome.resolution === "ambiguous" ? undefined : outcome.range };
}

export function resolveAllAnnotations(source: string): void {
  service.resolved = new Map();
  for (const entry of service.document?.annotations || []) {
    service.resolved.set(entry.id, resolveEntry(source, entry));
  }
}

export function resolutionSummary(): { relocated: number; ambiguous: number; orphaned: number } {
  const summary = { relocated: 0, ambiguous: 0, orphaned: 0 };
  for (const item of service.resolved.values()) {
    if (item.resolution === "resolved") summary.relocated += 1;
    else if (item.resolution === "ambiguous") summary.ambiguous += 1;
    else summary.orphaned += 1;
  }
  return summary;
}

export function commandFailureInfo(error: unknown): { code?: string; message?: string } {
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: string; message?: string };
    return { code: value.code, message: value.message };
  }
  return { message: typeof error === "string" ? error : undefined };
}

export async function loadAnnotations(targetPath: string, source: string): Promise<void> {
  resetAnnotations();
  try {
    const state = await invoke<AnnotationState>("load_annotations", { targetPath });
    const raw = state.document;
    service.migratedFromV1 = isLegacyDocument(raw);
    service.document = normalizeDocument(raw, source);
    service.path = state.path;
    service.stale = Boolean(state.stale);
    service.savedSnapshot = JSON.stringify(service.document);
    resolveAllAnnotations(source);
    notify();
  } catch (error) {
    const failure = commandFailureInfo(error);
    service.damaged = failure.code === "QNOTE_INVALID";
    notify();
    throw error;
  }
}

export async function recoverAnnotations(targetPath: string): Promise<void> {
  resetAnnotations();
  const state = await invoke<AnnotationState>("recover_annotations", { targetPath });
  service.document = normalizeDocument(state.document, "");
  service.path = state.path;
  service.savedSnapshot = JSON.stringify(service.document);
  resolveAllAnnotations("");
  notify();
}

export async function persistAnnotations(): Promise<boolean> {
  if (!service.document) return false;
  try {
    const state = await invoke<AnnotationState>("save_annotations", {
      targetPath: activeSourcePath,
      document: service.document,
    });
    service.document = normalizeDocument(state.document, "");
    service.path = state.path;
    service.stale = false;
    service.savedSnapshot = JSON.stringify(service.document);
    notify();
    return true;
  } catch (error) {
    notify();
    throw error;
  }
}

// save_annotations needs the target document path; the caller keeps it in sync.
let activeSourcePath = "";

export function setActiveSourcePath(path: string): void {
  activeSourcePath = path;
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<AnnotationEntry> {
  if (!service.document) throw new Error("批注文件尚未加载。");
  const now = new Date().toISOString();
  const entry: AnnotationEntry = {
    id: newId(),
    scope: input.scope,
    locator: input.locator ?? null,
    anchor: input.anchor ?? null,
    text: input.text,
    status: "open",
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now,
  };
  service.document.annotations.push(entry);
  service.resolved.set(entry.id, { entry, resolution: "resolved", range: entry.scope === "text-range" && entry.locator ? (entry.locator as TextRange) : undefined });
  notify();
  return entry;
}

export async function updateAnnotationText(id: string, text: string, tags?: string[]): Promise<void> {
  const entry = service.document?.annotations.find((item) => item.id === id);
  if (!entry) return;
  entry.text = text;
  if (tags) entry.tags = tags;
  entry.updatedAt = new Date().toISOString();
  notify();
}

export async function setAnnotationStatus(id: string, status: "open" | "resolved"): Promise<void> {
  const entry = service.document?.annotations.find((item) => item.id === id);
  if (!entry || entry.status === status) return;
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  notify();
}

export async function removeAnnotation(id: string): Promise<void> {
  if (!service.document) return;
  service.document.annotations = service.document.annotations.filter((entry) => entry.id !== id);
  service.resolved.delete(id);
  notify();
}

export function hasUnsavedSchemaChanges(): boolean {
  return Boolean(service.document) && JSON.stringify(service.document) !== service.savedSnapshot;
}

// After the source file was saved, refresh text-range locators from the runtime
// positions the editor mapped during editing. Only persist when something moved.
export async function syncAfterSave(source: string, runtimeRanges: Map<string, TextRange>): Promise<boolean> {
  if (!service.document) return false;
  const previous = service.savedSnapshot;
  for (const entry of service.document.annotations) {
    if (entry.scope !== "text-range") continue;
    const range = runtimeRanges.get(entry.id);
    if (!range || range.start === range.end) continue;
    entry.locator = { start: range.start, end: range.end };
    entry.anchor = buildAnchor(source, range);
    entry.updatedAt = entry.updatedAt || entry.createdAt;
    service.resolved.set(entry.id, { entry, resolution: "resolved", range });
  }
  if (JSON.stringify(service.document) === previous) return false;
  return persistAnnotations();
}
