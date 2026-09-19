import { invoke } from "@tauri-apps/api/core";
import type { DocumentCapabilities, DocumentHandler, HandlerContext } from "../../core/handler-registry";
import type { FileMetadata } from "../../core/types";
import { showView } from "../../ui/views";
import {
  csvMetaElement, csvSearchInput, csvSearchStatusElement, csvViewportElement,
  statusInfoElement, statusModeElement,
} from "../../ui/elements";

const ROW_HEIGHT = 30;
const BUFFER_ROWS = 10;

interface CsvState {
  path: string;
  matrix: string[][];
  lineEnding: string;
  trailingNewline: boolean;
  bom: boolean;
  encoding: string;
  size: number;
  modifiedTime: number;
  dirty: boolean;
  columns: number;
}

function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function createCsvHandler(): DocumentHandler {
  let state: CsvState | null = null;
  let matches: Array<{ row: number; column: number }> = [];

  const capabilities: DocumentCapabilities = {
    editable: true,
    searchable: true,
    replaceable: false,
    annotatable: false,
    spreadsheet: true,
  };

  function detectLineEnding(text: string): string {
    const crlf = text.indexOf("\r\n");
    const lf = text.indexOf("\n");
    if (crlf >= 0 && (lf < 0 || crlf < lf)) return "\r\n";
    return "\n";
  }

  function renderWindow(): void {
    if (!state) return;
    const total = state.matrix.length;
    const scrollTop = csvViewportElement.scrollTop;
    const viewHeight = csvViewportElement.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const end = Math.min(total, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + BUFFER_ROWS);
    const headerHeight = 30;

    // 必须是普通 div：<table> 会把子元素变成匿名表格盒，sticky 表头会失效。
    const table = document.createElement("div");
    table.className = "csv-table";
    table.style.height = `${headerHeight + total * ROW_HEIGHT}px`;

    const head = document.createElement("div");
    head.className = "csv-head";
    head.style.height = `${headerHeight}px`;
    const corner = document.createElement("div");
    corner.className = "csv-corner";
    corner.textContent = "#";
    head.append(corner);
    for (let column = 0; column < state.columns; column += 1) {
      const cell = document.createElement("div");
      cell.className = "csv-head-cell";
      cell.textContent = columnLabel(column);
      head.append(cell);
    }

    const body = document.createElement("div");
    body.className = "csv-body";
    body.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    const matchSet = new Set(matches.map((match) => `${match.row}:${match.column}`));
    for (let row = start; row < end; row += 1) {
      const line = document.createElement("div");
      line.className = "csv-row";
      line.style.height = `${ROW_HEIGHT}px`;
      const number = document.createElement("div");
      number.className = "csv-row-number";
      number.textContent = String(row + 1);
      line.append(number);
      const cells = state.matrix[row] || [];
      for (let column = 0; column < state.columns; column += 1) {
        const cell = document.createElement("div");
        cell.className = "csv-cell";
        cell.contentEditable = "true";
        cell.spellcheck = false;
        cell.textContent = cells[column] ?? "";
        if (matchSet.has(`${row}:${column}`)) cell.classList.add("csv-cell-match");
        cell.addEventListener("input", () => {
          if (!state) return;
          while (state.matrix[row].length < state.columns) state.matrix[row].push("");
          state.matrix[row][column] = cell.textContent || "";
          if (!state.dirty) {
            state.dirty = true;
            updateStatus();
          }
        });
        line.append(cell);
      }
      body.append(line);
    }

    table.append(head, body);
    csvViewportElement.replaceChildren(table);
  }

  function updateStatus(): void {
    if (!state) return;
    statusInfoElement.textContent = state.dirty ? "已修改 · 未保存" : `${state.matrix.length} 行 · ${state.columns} 列`;
    csvMetaElement.textContent = `${state.matrix.length} 行 · ${state.columns} 列${state.dirty ? " · 未保存" : ""}`;
  }

  function runSearch(query: string): void {
    matches = [];
    if (!state || !query) {
      csvSearchStatusElement.textContent = query ? "无匹配" : "";
      renderWindow();
      return;
    }
    const needle = query.toLowerCase();
    for (let row = 0; row < state.matrix.length; row += 1) {
      for (let column = 0; column < (state.matrix[row]?.length || 0); column += 1) {
        if ((state.matrix[row][column] || "").toLowerCase().includes(needle)) {
          matches.push({ row, column });
          if (matches.length > 5000) break;
        }
      }
    }
    csvSearchStatusElement.textContent = matches.length ? `${matches.length} 个匹配` : "无匹配";
    renderWindow();
  }

  return {
    id: "csv",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      const documentModel = await invoke<{ path: string; content: string; encoding: string; size: number; modifiedTime: number }>("read_text_file", { path: node.path });
      const raw = documentModel.content;
      const { default: Papa } = await import("papaparse");
      const parsed = Papa.parse<string[]>(raw, { skipEmptyLines: false });
      const matrix = (parsed.data as string[][]).map((row) => row.map((cell) => cell ?? ""));
      // A file that ends with a newline yields a trailing [""] phantom row; drop it
      // and remember to re-add the newline on save (§11 last-empty-line handling).
      const trailingNewline = /[\r\n]$/.test(raw);
      if (trailingNewline && matrix.length > 0 && matrix[matrix.length - 1].length === 1 && matrix[matrix.length - 1][0] === "") {
        matrix.pop();
      }
      const columns = matrix.reduce((max, row) => Math.max(max, row.length), 1);
      state = {
        path: documentModel.path,
        matrix,
        lineEnding: detectLineEnding(raw),
        trailingNewline,
        bom: raw.charCodeAt(0) === 0xFEFF,
        encoding: documentModel.encoding,
        size: documentModel.size,
        modifiedTime: documentModel.modifiedTime,
        dirty: false,
        columns,
      };
      node.content = raw;
      node.encoding = documentModel.encoding;
      node.size = documentModel.size;
      node.modifiedTime = documentModel.modifiedTime;
      node.dirty = false;
      matches = [];
      csvSearchInput.value = "";
      csvSearchStatusElement.textContent = "";
      csvViewportElement.scrollTop = 0;
      csvViewportElement.onscroll = () => renderWindow();
      csvSearchInput.oninput = () => runSearch(csvSearchInput.value.trim());
      updateStatus();
      statusModeElement.textContent = "表格编辑";
      showView("csv");
      renderWindow();
    },
    async save(): Promise<FileMetadata | null> {
      if (!state) return null;
      const { default: Papa } = await import("papaparse");
      let text = Papa.unparse(state.matrix, { newline: "\n" });
      if (state.lineEnding === "\r\n") text = text.replace(/\r\n|\n/g, "\r\n");
      if (state.trailingNewline) text += state.lineEnding;
      const bytes = Array.from(new TextEncoder().encode(state.bom ? `\uFEFF${text}` : text));
      const metadata = await invoke<FileMetadata>("save_binary_file", {
        path: state.path,
        bytes,
        expectedSize: state.size,
        expectedModifiedTime: state.modifiedTime,
      });
      state.size = metadata.size;
      state.modifiedTime = metadata.modifiedTime;
      state.dirty = false;
      updateStatus();
      return metadata;
    },
    isDirty(): boolean {
      return state?.dirty || false;
    },
    dispose(): void {
      csvViewportElement.onscroll = null;
      csvSearchInput.oninput = null;
      csvViewportElement.replaceChildren();
      state = null;
      matches = [];
    },
  };
}
