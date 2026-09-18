import { buildAnchor, resolveTextAnchor } from "./text-anchor";
import type { AnnotationDocument, AnnotationEntry, LegacyV1Document, LegacyV1Entry, TextRangeLocator } from "./types";

function isLegacySelection(entry: LegacyV1Entry): boolean {
  return entry.scope === "selection" && Boolean(entry.locator && "quote" in entry.locator);
}

function migrateEntry(entry: LegacyV1Entry, source: string): AnnotationEntry {
  const base: AnnotationEntry = {
    id: entry.id,
    scope: entry.scope,
    locator: entry.locator ?? null,
    anchor: entry.anchor ?? null,
    text: entry.text,
    status: entry.status,
    tags: entry.tags,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  if (!isLegacySelection(entry)) return base;
  const legacy = entry.locator as Extract<LegacyV1Entry["locator"], { quote: string }>;
  const locator: TextRangeLocator = { start: legacy.start, end: legacy.end };
  const migrated: AnnotationEntry = {
    ...base,
    scope: "text-range",
    locator,
    anchor: { quote: legacy.quote.slice(0, 240), prefix: "", suffix: "" },
  };
  const outcome = resolveTextAnchor(source, locator, migrated.anchor);
  if (outcome.resolution === "resolved" && outcome.range) {
    migrated.anchor = buildAnchor(source, outcome.range);
    migrated.locator = outcome.range;
  }
  return migrated;
}

// Runtime-only migration. The document is written back as schema V2 only when the
// user edits an annotation or the anchors are refreshed after a file save.
export function normalizeDocument(raw: AnnotationDocument | LegacyV1Document, source: string): AnnotationDocument {
  const annotations = Array.isArray(raw.annotations) ? raw.annotations : [];
  return {
    version: 2,
    target: typeof raw.target === "string" ? { name: raw.target, size: 0, modifiedTime: 0 } : { ...raw.target },
    updatedAt: raw.updatedAt || "",
    annotations: annotations.map((entry) => migrateEntry(entry as LegacyV1Entry, source)),
  };
}

export function isLegacyDocument(raw: AnnotationDocument | LegacyV1Document): boolean {
  return (raw.version ?? 1) < 2 || raw.annotations.some((entry) => entry.scope === "selection");
}
