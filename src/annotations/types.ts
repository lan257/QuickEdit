export type AnnotationScope = "general" | "text-range" | "page" | "cell";

export interface TextRangeLocator {
  start: number;
  end: number;
}

export interface PageLocator {
  page: number;
}

export interface CellLocator {
  sheet: string;
  cell: string;
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface AnnotationEntry {
  id: string;
  scope: AnnotationScope | string;
  locator?: TextRangeLocator | PageLocator | CellLocator | null;
  anchor?: TextAnchor | null;
  text: string;
  status?: string;
  tags?: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationTarget {
  name: string;
  size: number;
  modifiedTime: number;
}

export interface AnnotationDocument {
  version: number;
  target: AnnotationTarget;
  updatedAt: string;
  annotations: AnnotationEntry[];
}

export interface AnnotationState {
  path: string;
  exists: boolean;
  stale?: boolean;
  document: AnnotationDocument;
}

export type ResolutionState = "resolved" | "ambiguous" | "orphaned";

export interface TextRange {
  start: number;
  end: number;
}

export interface ResolvedAnnotation {
  entry: AnnotationEntry;
  resolution: ResolutionState;
  range?: TextRange;
}

// V1 (.qnote schema 1) shapes, only used by migration.
export interface LegacyV1Locator {
  start: number;
  end: number;
  quote: string;
  preview?: boolean;
}

export interface LegacyV1Entry extends Omit<AnnotationEntry, "scope" | "locator"> {
  scope: string;
  locator?: (LegacyV1Locator & Partial<PageLocator> & Partial<CellLocator>) | PageLocator | CellLocator | null;
}

export interface LegacyV1Document {
  version: number;
  target: AnnotationTarget | string;
  updatedAt: string;
  annotations: LegacyV1Entry[];
}
