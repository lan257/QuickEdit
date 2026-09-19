import { resolvedAnnotations } from "./annotation-service";
import type { ResolvedAnnotation } from "./types";

// 表格单元格 / PDF 页码两类批注的查询，供对应 Handler 与主控制器共用。
export function cellAnnotations(sheet: string, cell: string): ResolvedAnnotation[] {
  return resolvedAnnotations().filter((item) => {
    const locator = item.entry.locator;
    return item.entry.scope === "cell" && Boolean(locator && "sheet" in locator && locator.sheet === sheet && locator.cell === cell);
  });
}

export function pageAnnotations(page: number): ResolvedAnnotation[] {
  return resolvedAnnotations().filter((item) => {
    const locator = item.entry.locator;
    return item.entry.scope === "page" && Boolean(locator && "page" in locator && locator.page === page);
  });
}

export function firstAnnotationId(items: ResolvedAnnotation[]): string | null {
  return items.length > 0 ? items[0].entry.id : null;
}
