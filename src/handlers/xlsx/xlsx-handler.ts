import { invoke } from "@tauri-apps/api/core";
import type * as XLSX from "xlsx";
import { readFileBytes } from "../../core/binary-file";
import type { DocumentCapabilities, DocumentHandler, HandlerBridge, HandlerContext, HandlerLocator } from "../../core/handler-registry";
import type { FileMetadata } from "../../core/types";
import { cellAnnotations, firstAnnotationId } from "../../annotations/scope-queries";
import { excelMetaElement, excelTableWrapElement, sheetTabsElement } from "../../ui/elements";
import { showView } from "../../ui/views";

// SheetJS 只在第一次打开表格时加载；实例跨文档复用。
let xlsxModule: typeof import("xlsx") | null = null;

// 一次只渲染 200 行，超出部分分页浏览，避免整表铺进 DOM（§14.5）。
const PAGE_ROWS = 200;
const MAX_COLUMNS = 30;

function columnName(column: number): string {
  let value = column + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function createXlsxHandler(): DocumentHandler {
  const capabilities: DocumentCapabilities = {
    editable: true,
    searchable: false,
    replaceable: false,
    annotatable: true,
    spreadsheet: true,
  };
  let workbook: XLSX.WorkBook | null = null;
  let sheetName = "";
  let selected: { sheet: string; cell: string } | null = null;
  let session: { path: string; size: number; modifiedTime: number } | null = null;
  let dirty = false;
  let bridge: HandlerBridge | null = null;
  let disposed = false;
  let rowOffset = 0;
  let matrix: unknown[][] = [];
  const sheetCache = new Map<string, unknown[][]>();

  const matrixOf = (name: string): unknown[][] => {
    const cached = sheetCache.get(name);
    if (cached) return cached;
    const sheet = workbook?.Sheets[name];
    const rows = sheet && xlsxModule ? xlsxModule.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) : [];
    sheetCache.set(name, rows);
    return rows;
  };

  const goToCell = (address: string): void => {
    const row = Number(address.replace(/[A-Z]+/g, "")) - 1;
    if (!Number.isFinite(row) || row < 0) return;
    rowOffset = Math.floor(row / PAGE_ROWS) * PAGE_ROWS;
  };

  const render = (): void => {
    if (!workbook || !xlsxModule) return;
    sheetTabsElement.innerHTML = "";
    for (const name of workbook.SheetNames) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `sheet-tab${name === sheetName ? " active" : ""}`;
      tab.textContent = name;
      tab.addEventListener("click", () => {
        sheetName = name;
        matrix = matrixOf(name);
        rowOffset = 0;
        selected = null;
        render();
      });
      sheetTabsElement.append(tab);
    }
    const sheet = workbook.Sheets[sheetName];
    const totalRows = Math.max(matrix.length, 1);
    const rowCount = Math.min(PAGE_ROWS, Math.max(totalRows - rowOffset, 1));
    const colCount = Math.min(Math.max(...matrix.map((row) => row.length), 1), MAX_COLUMNS);
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.textContent = "#";
    headRow.append(corner);
    for (let column = 0; column < colCount; column += 1) {
      const th = document.createElement("th");
      th.textContent = columnName(column);
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    for (let windowRow = 0; windowRow < rowCount; windowRow += 1) {
      const rowIndex = rowOffset + windowRow;
      const tr = document.createElement("tr");
      const rowNumber = document.createElement("th");
      rowNumber.textContent = String(rowIndex + 1);
      tr.append(rowNumber);
      const row = matrix[rowIndex] || [];
      for (let column = 0; column < colCount; column += 1) {
        const td = document.createElement("td");
        td.contentEditable = "true";
        td.textContent = String(row[column] ?? "");
        const address = xlsxModule.utils.encode_cell({ r: rowIndex, c: column });
        td.dataset.sheet = sheetName;
        td.dataset.cell = address;
        const noteCount = cellAnnotations(sheetName, address).length;
        if (noteCount > 0) td.dataset.noteLabel = noteCount > 1 ? `●${noteCount}` : "●";
        const selectCell = (): void => {
          selected = { sheet: sheetName, cell: address };
          bridge?.refreshCursor();
        };
        td.addEventListener("click", (event) => {
          selectCell();
          if (noteCount === 0) return;
          const rect = td.getBoundingClientRect();
          if (event.clientX >= rect.right - 22 && event.clientY <= rect.top + 18) {
            const id = firstAnnotationId(cellAnnotations(sheetName, address));
            if (id) bridge?.revealAnnotation(id);
          }
        });
        td.addEventListener("focus", selectCell);
        td.addEventListener("contextmenu", selectCell);
        td.addEventListener("input", () => {
          if (!sheet) return;
          sheet[address] = { t: "s", v: td.textContent || "" };
          if (!sheet["!ref"]) sheet["!ref"] = "A1";
          dirty = true;
          bridge?.markDirty();
        });
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    excelTableWrapElement.replaceChildren(table);
    const lastRow = Math.min(rowOffset + rowCount, totalRows);
    excelMetaElement.textContent = `${workbook.SheetNames.length} 个工作表 · ${sheetName} · 第 ${rowOffset + 1}-${lastRow} 行 / 共 ${totalRows} 行`;
    if (totalRows > PAGE_ROWS) {
      const pager = document.createElement("div");
      pager.className = "sheet-pager";
      const previous = document.createElement("button");
      previous.type = "button";
      previous.className = "sheet-tab sheet-page";
      previous.textContent = "‹ 上一段";
      previous.disabled = rowOffset <= 0;
      previous.addEventListener("click", () => {
        rowOffset = Math.max(0, rowOffset - PAGE_ROWS);
        selected = null;
        render();
      });
      const next = document.createElement("button");
      next.type = "button";
      next.className = "sheet-tab sheet-page";
      next.textContent = "下一段 ›";
      next.disabled = lastRow >= totalRows;
      next.addEventListener("click", () => {
        rowOffset = Math.min(totalRows - 1, rowOffset + PAGE_ROWS);
        selected = null;
        render();
      });
      const page = document.createElement("span");
      page.className = "sheet-page-label";
      page.textContent = `${Math.floor(rowOffset / PAGE_ROWS) + 1} / ${Math.ceil(totalRows / PAGE_ROWS)}`;
      pager.append(previous, page, next);
      sheetTabsElement.append(pager);
    }
  };

  return {
    id: "xlsx",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      bridge = context.bridge;
      disposed = false;
      const bytes = await readFileBytes(node.path);
      if (disposed) return;
      xlsxModule ??= await import("xlsx");
      const parsed = xlsxModule.read(bytes, { type: "array", cellStyles: true });
      if (disposed) return;
      workbook = parsed;
      sheetName = parsed.SheetNames[0] || "Sheet1";
      sheetCache.clear();
      matrix = matrixOf(sheetName);
      rowOffset = 0;
      selected = null;
      dirty = false;
      session = { path: node.path, size: node.size, modifiedTime: node.modifiedTime };
      node.size = bytes.length;
      render();
      context.bridge.status("表格编辑", `${parsed.SheetNames.length} 个工作表`);
      showView("xlsx");
    },
    isDirty(): boolean {
      return dirty;
    },
    async save(): Promise<FileMetadata | null> {
      if (!workbook || !xlsxModule || !session) return null;
      const output = xlsxModule.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      const bytes = Array.from(new Uint8Array(output));
      const metadata = await invoke<FileMetadata>("save_binary_file", {
        path: session.path,
        bytes,
        expectedSize: session.size,
        expectedModifiedTime: session.modifiedTime,
      });
      session = { ...session, size: metadata.size, modifiedTime: metadata.modifiedTime };
      dirty = false;
      return metadata;
    },
    cursorLabel(): string | null {
      return selected ? `${selected.sheet}!${selected.cell}` : "未选中单元格";
    },
    annotationTarget() {
      if (!workbook || !selected) return null;
      return { scope: "cell" as const, scopeHint: `单元格 ${selected.sheet}!${selected.cell}`, locator: { ...selected } };
    },
    locate(locator: HandlerLocator): boolean {
      if (!workbook || !locator.sheet || !locator.cell) return false;
      if (locator.sheet !== sheetName) {
        sheetName = locator.sheet;
        matrix = matrixOf(sheetName);
      }
      goToCell(locator.cell);
      selected = { sheet: locator.sheet, cell: locator.cell };
      render();
      window.setTimeout(() => {
        const cell = document.querySelector<HTMLElement>(`[data-sheet="${CSS.escape(locator.sheet || "")}"][data-cell="${CSS.escape(locator.cell || "")}"]`);
        cell?.scrollIntoView({ block: "center", inline: "center" });
        cell?.focus();
      }, 0);
      return true;
    },
    refreshMarkers(): void {
      if (!workbook) return;
      // 原地更新角标，重建表格会打断正在编辑的单元格。
      for (const td of Array.from(excelTableWrapElement.querySelectorAll<HTMLElement>("td[data-cell]"))) {
        const cell = td.dataset.cell || "";
        const count = cellAnnotations(sheetName, cell).length;
        if (count > 0) td.dataset.noteLabel = count > 1 ? `●${count}` : "●";
        else delete td.dataset.noteLabel;
      }
    },
    dispose(): void {
      disposed = true;
      workbook = null;
      sheetName = "";
      matrix = [];
      sheetCache.clear();
      rowOffset = 0;
      selected = null;
      session = null;
      dirty = false;
      sheetTabsElement.innerHTML = "";
      excelTableWrapElement.replaceChildren();
    },
  };
}
