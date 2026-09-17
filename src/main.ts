import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import MarkdownIt from "markdown-it";
import configHelpMarkdown from "./QuickEdit_Config_Help.md?raw";
import type * as XLSX from "xlsx";
import type * as PdfJs from "pdfjs-dist";

type NodeKind = "docs" | "workspace" | "folder" | "file";
type HandlerKind = "text" | "xlsx" | "pdf" | "docx" | "future";
type MarkdownViewMode = "edit" | "preview";
type TreeSortMode = "files-first" | "folders-first" | "name-desc" | "modified-desc";
type AnnotationScope = "general" | "selection" | "page" | "cell";
type AnnotationLocator = { start: number; end: number; quote: string; preview?: boolean } | { page: number } | { sheet: string; cell: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[character] || character));
}

const markdownRenderer = new MarkdownIt({ html: false, linkify: false, typographer: false });
markdownRenderer.renderer.rules.image = (tokens, index) => {
  const alt = tokens[index].content.trim();
  return `<span class="md-image-placeholder">${alt ? `[图片：${escapeHtml(alt)}]` : "[图片]"}</span>`;
};
markdownRenderer.renderer.rules.link_open = () => "";
markdownRenderer.renderer.rules.link_close = () => "";

interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedTime: number;
  isDirectory: boolean;
}

interface TreeNode {
  id: string;
  kind: NodeKind;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedTime: number;
  expanded: boolean;
  childrenLoaded: boolean;
  loading: boolean;
  children: TreeNode[];
  dirty: boolean;
  content?: string;
  encoding?: string;
}

interface TextDocument {
  path: string;
  content: string;
  encoding: string;
  size: number;
  modifiedTime: number;
}

interface AnnotationTarget {
  name: string;
  size: number;
  modifiedTime: number;
}

interface AnnotationEntry {
  id: string;
  scope: AnnotationScope | string;
  locator?: AnnotationLocator | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface AnnotationDocument {
  version: number;
  target: AnnotationTarget;
  updatedAt: string;
  annotations: AnnotationEntry[];
}

interface AnnotationState {
  path: string;
  exists: boolean;
  stale?: boolean;
  document: AnnotationDocument;
}

type ThemeMode = "light" | "dark";

interface AppConfig {
  version: number;
  editor: {
    maxTextFileSizeMB: number;
    confirmBeforeCloseUnsaved: boolean;
  };
  handlers: {
    text: { enabled: boolean; extensions: string[] };
    spreadsheet: { enabled: boolean; extensions: string[] };
    pdf: { enabled: boolean; extensions: string[] };
    docx: { enabled: boolean; extensions: string[] };
  };
  annotations: {
    enabled: boolean;
    extension: string;
  };
  workspace: {
    restoreLastSession: boolean;
  };
  shell: {
    contextMenu: boolean;
    openWith: boolean;
  };
  appearance: {
    theme: ThemeMode;
  };
}

interface WorkspaceReference {
  name: string;
  path: string;
  expanded: boolean;
}

interface WorkspaceState {
  version: number;
  docsFiles: string[];
  workspaces: WorkspaceReference[];
}

interface TextSession {
  path: string;
  encoding: string;
  size: number;
  modifiedTime: number;
}

interface BinarySession {
  path: string;
  size: number;
  modifiedTime: number;
  bytes: Uint8Array;
}

interface CommandFailure {
  code?: string;
  message?: string;
}

interface MenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

const fallbackConfig: AppConfig = {
  version: 1,
  editor: {
    maxTextFileSizeMB: 1,
    confirmBeforeCloseUnsaved: true,
  },
  handlers: {
    text: {
      enabled: true,
      extensions: [
        ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".ini", ".log", ".csv",
        ".sql", ".py", ".js", ".ts", ".cs", ".java", ".cpp", ".html", ".css",
      ],
    },
    spreadsheet: { enabled: true, extensions: [".xlsx"] },
    pdf: { enabled: true, extensions: [".pdf"] },
    docx: { enabled: true, extensions: [".docx"] },
  },
  annotations: { enabled: true, extension: ".qnote" },
  workspace: { restoreLastSession: true },
  shell: { contextMenu: true, openWith: true },
  appearance: { theme: "light" },
};

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素: ${selector}`);
  return element;
};

function hasTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function updateThemeCards(mode: ThemeMode): void {
  themeLightButton.classList.toggle("active", mode === "light");
  themeDarkButton.classList.remove("active");
  themeSystemButton.classList.remove("active");
}

function applyTheme(_theme: string): void {
  document.documentElement.dataset.theme = "light";
  themeSelect.value = "light";
  updateThemeCards("light");
}

function requestTheme(mode: "light" | "dark" | "system"): void {
  if (mode !== "light") {
    showToast("深色/跟随系统主题暂不支持，已排入 V2。", true);
    return;
  }
  applyTheme("light");
}

const treeElement = $("#tree");
const fileCountElement = $("#fileCount");
const runtimeHintElement = $("#runtimeHint");
const docNameElement = $("#docName");
const modePillElement = $("#modePill");
const docMetaElement = $("#docMeta");
const emptyViewElement = $("#emptyView");
const loadingViewElement = $("#loadingView");
const textPaneElement = $("#textPane");
const excelPaneElement = $("#excelPane");
const sheetTabsElement = $("#sheetTabs");
const excelMetaElement = $("#excelMeta");
const excelTableWrapElement = $("#excelTableWrap");
const pdfPaneElement = $("#pdfPane");
const pdfPageLabelElement = $("#pdfPageLabel");
const pdfCanvasWrapElement = $("#pdfCanvasWrap");
const docxPaneElement = $("#docxPane");
const docxContentElement = $("#docxContent");
const unsupportedViewElement = $("#unsupportedView");
const unsupportedTitleElement = $("#unsupportedTitle");
const unsupportedMessageElement = $("#unsupportedMessage");
const textEditorElement = $("#textEditor") as HTMLTextAreaElement;
const markdownModeBarElement = $("#markdownModeBar");
const markdownPreviewPaneElement = $("#markdownPreviewPane");
const markdownPreviewElement = $("#markdownPreview");
const markdownEditButton = $("#markdownEditButton") as HTMLButtonElement;
const markdownPreviewButton = $("#markdownPreviewButton") as HTMLButtonElement;
const findBarElement = $("#findBar");
const findInputElement = $("#findInput") as HTMLInputElement;
const replaceInputElement = $("#replaceInput") as HTMLInputElement;
const findCaseInput = $("#findCaseInput") as HTMLInputElement;
const findStatusElement = $("#findStatus");
const findPrevButton = $("#findPrevButton") as HTMLButtonElement;
const findNextButton = $("#findNextButton") as HTMLButtonElement;
const replaceButton = $("#replaceButton") as HTMLButtonElement;
const replaceAllButton = $("#replaceAllButton") as HTMLButtonElement;
const findCloseButton = $("#findCloseButton") as HTMLButtonElement;
const editorFileLabelElement = $("#editorFileLabel");
const editorEncodingElement = $("#editorEncoding");
const statusModeElement = $("#statusMode");
const statusInfoElement = $("#statusInfo");
const statusCursorElement = $("#statusCursor");
const statusPathElement = $("#statusPath");
const winControlsElement = $("#winControls");
const winMinimizeButton = $("#winMinimize") as HTMLButtonElement;
const winMaximizeButton = $("#winMaximize") as HTMLButtonElement;
const winCloseButton = $("#winClose") as HTMLButtonElement;
const notesButton = $("#notesBtn") as HTMLButtonElement;
const noteCountElement = $("#noteCount");
const workareaElement = $("#workarea");
const notesPanelElement = $("#notesPanel");
const noteFileLabelElement = $("#noteFileLabel");
const notesListElement = $("#notesList");
const noteInputElement = $("#noteInput") as HTMLTextAreaElement;
const noteScopeElement = $("#noteScope") as HTMLSelectElement;
const noteContextHintElement = $("#noteContextHint");
const recoverNotesButton = $("#recoverNotesButton") as HTMLButtonElement;
const treeSearchInput = $("#treeSearchInput") as HTMLInputElement;
const treeSortSelect = $("#treeSortSelect") as HTMLSelectElement;
const closeNotesButton = $("#closeNotesButton") as HTMLButtonElement;
const addNoteButton = $("#addNoteButton") as HTMLButtonElement;
const logoButton = $("#logoButton") as HTMLButtonElement;
const menuElement = $("#menu");
const nameOverlayElement = $("#nameOverlay");
const nameTitleElement = $("#nameTitle");
const nameLabelElement = $("#nameLabel");
const nameInputElement = $("#nameInput") as HTMLInputElement;
const nameHintElement = $("#nameHint");
const nameCloseButton = $("#nameClose") as HTMLButtonElement;
const nameCancelButton = $("#nameCancel") as HTMLButtonElement;
const nameOkButton = $("#nameOk") as HTMLButtonElement;
const settingsOverlayElement = $("#settingsOverlay");
const helpOverlayElement = $("#helpOverlay");
const helpContentElement = $("#helpContent");
const helpCloseButton = $("#helpClose") as HTMLButtonElement;
const settingsCloseButton = $("#settingsClose") as HTMLButtonElement;
const settingsCancelButton = $("#settingsCancel") as HTMLButtonElement;
const settingsSaveButton = $("#settingsSave") as HTMLButtonElement;
const textExtensionsInput = $("#textExtensionsInput") as HTMLTextAreaElement;
const maxTextSizeInput = $("#maxTextSizeInput") as HTMLInputElement;
const confirmCloseInput = $("#confirmCloseInput") as HTMLInputElement;
const annotationEnabledInput = $("#annotationEnabledInput") as HTMLInputElement;
const restoreSessionInput = $("#restoreSessionInput") as HTMLInputElement;
const shellContextMenuInput = $("#shellContextMenuInput") as HTMLInputElement;
const shellOpenWithInput = $("#shellOpenWithInput") as HTMLInputElement;
const themeSelect = $("#themeSelect") as HTMLSelectElement;
const themeLightButton = $("#themeLightButton") as HTMLButtonElement;
const themeDarkButton = $("#themeDarkButton") as HTMLButtonElement;
const themeSystemButton = $("#themeSystemButton") as HTMLButtonElement;
const settingsResetDefaultsButton = $("#settingsResetDefaults") as HTMLButtonElement;
const toastElement = $("#toast");

let config = fallbackConfig;
let nodeSequence = 0;
let roots: TreeNode[] = [];
let activeNode: TreeNode | null = null;
let activeSession: TextSession | null = null;
let activeBinarySession: BinarySession | null = null;
let xlsxModule: typeof import("xlsx") | null = null;
let pdfjsModule: typeof import("pdfjs-dist") | null = null;
let mammothModule: typeof import("mammoth/mammoth.browser") | null = null;
let activeWorkbook: XLSX.WorkBook | null = null;
let activeSheetName = "";
let activePdfDocument: PdfJs.PDFDocumentProxy | null = null;
let activePdfPage = 1;
let pdfPageObserver: IntersectionObserver | null = null;
const pdfPageHosts = new Map<number, HTMLElement>();
const pdfPageRendering = new Set<number>();
let markdownViewMode: MarkdownViewMode = "edit";
let markdownContentRevision = 0;
let markdownPreviewRevision = -1;
let markdownPreviewHtml = "";
let findMatches: Array<{ start: number; end: number }> = [];
let findMatchIndex = -1;
let activeAnnotations: AnnotationDocument | null = null;
let activeAnnotationPath = "";
let activeAnnotationStale = false;
let activeCellLocator: { sheet: string; cell: string } | null = null;
let previewSelectionSnapshot: { quote: string; start: number; end: number } | null = null;
let treeFilter = "";
let treeSortMode: TreeSortMode = "files-first";
let nameCallback: ((name: string) => void) | null = null;
let toastTimer: number | undefined;

const docsSection = createContainer("docs", "文档", "");
roots = [docsSection];

function nextId(): string {
  nodeSequence += 1;
  return `node-${nodeSequence}`;
}

function createContainer(kind: "docs" | "workspace" | "folder", name: string, path: string): TreeNode {
  return {
    id: kind === "docs" ? "docs-section" : nextId(),
    kind,
    name,
    path,
    extension: "",
    size: 0,
    modifiedTime: 0,
    expanded: kind === "docs",
    childrenLoaded: kind === "docs",
    loading: false,
    children: [],
    dirty: false,
  };
}

function createFileNode(metadata: FileMetadata): TreeNode {
  return {
    id: nextId(),
    kind: "file",
    name: metadata.name,
    path: metadata.path,
    extension: metadata.extension,
    size: metadata.size,
    modifiedTime: metadata.modifiedTime,
    expanded: false,
    childrenLoaded: true,
    loading: false,
    children: [],
    dirty: false,
  };
}

function getHandlerKind(node: TreeNode): HandlerKind {
  const extension = node.extension.toLowerCase();
  if (config.handlers.text.enabled && config.handlers.text.extensions.some((item) => item.toLowerCase() === extension)) {
    return "text";
  }
  if (config.handlers.spreadsheet.enabled && config.handlers.spreadsheet.extensions.some((item) => item.toLowerCase() === extension)) {
    return "xlsx";
  }
  if (config.handlers.pdf.enabled && config.handlers.pdf.extensions.some((item) => item.toLowerCase() === extension)) {
    return "pdf";
  }
  if (config.handlers.docx.enabled && config.handlers.docx.extensions.some((item) => item.toLowerCase() === extension)) {
    return "docx";
  }
  return "future";
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMeta(node: TreeNode): string {
  if (node.kind !== "file") return node.path;
  return `${node.extension || "无扩展名"} · ${formatBytes(node.size)} · ${node.path}`;
}

async function copyPath(path: string): Promise<void> {
  if (!path) return;
  try {
    if (hasTauriRuntime()) {
      await writeText(path);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(path);
    } else {
      const helper = document.createElement("textarea");
      helper.value = path;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      if (!document.execCommand("copy")) throw new Error("clipboard fallback failed");
      helper.remove();
    }
    showToast("已复制文件路径");
  } catch {
    showToast("复制路径失败，请手动选择路径。", true);
  }
}

async function copyActivePath(): Promise<void> {
  if (activeNode?.path) await copyPath(activeNode.path);
}

function formatModifiedTime(value: number): string {
  if (!value) return "修改时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function countFiles(node: TreeNode): number {
  return node.children.reduce((count, child) => count + (child.kind === "file" ? 1 : countFiles(child)), 0);
}

function commandFailure(error: unknown): CommandFailure {
  if (typeof error === "object" && error !== null) {
    const value = error as CommandFailure;
    return { code: value.code, message: value.message };
  }
  return { message: typeof error === "string" ? error : "本地文件操作失败。" };
}

function failureMessage(error: unknown): string {
  return commandFailure(error).message || "本地文件操作失败。";
}

function showToast(message: string, isError = false): void {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.remove("hidden");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.add("hidden"), 2600);
}

function hideMenu(): void {
  menuElement.classList.add("hidden");
}

function showMenu(items: MenuItem[], x: number, y: number): void {
  menuElement.innerHTML = "";
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      menuElement.append(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.disabled = item.disabled ?? false;
    if (item.danger) button.classList.add("danger");
    button.addEventListener("click", () => {
      hideMenu();
      item.action?.();
    });
    menuElement.append(button);
  }
  menuElement.classList.remove("hidden");
  const width = menuElement.offsetWidth;
  const height = menuElement.offsetHeight;
  menuElement.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menuElement.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  window.setTimeout(() => {
    const close = (event: MouseEvent) => {
      if (!menuElement.contains(event.target as Node)) {
        hideMenu();
        document.removeEventListener("click", close, true);
      }
    };
    document.addEventListener("click", close, true);
  }, 0);
}

function iconFor(node: TreeNode): { className: string; label: string } {
  if (node.kind === "workspace") return { className: "workspace", label: "WS" };
  if (node.kind === "docs") return { className: "docs", label: "DOC" };
  if (node.kind === "folder") return { className: "folder", label: "DIR" };
  if (getHandlerKind(node) === "text") return { className: "text", label: node.extension ? node.extension.slice(1, 5).toUpperCase() : "TXT" };
  const extension = node.extension.toLowerCase();
  if (extension === ".xlsx") return { className: "future", label: "XLS" };
  if (extension === ".pdf") return { className: "future", label: "PDF" };
  if (extension === ".docx") return { className: "future", label: "DOC" };
  return { className: "future", label: "FILE" };
}

function nodeMatchesTreeFilter(node: TreeNode): boolean {
  if (!treeFilter) return true;
  const value = `${node.name} ${node.extension} ${node.path}`.toLowerCase();
  return value.includes(treeFilter);
}

function nodeVisibleInTree(node: TreeNode): boolean {
  if (!treeFilter || node.kind === "docs") return true;
  if (nodeMatchesTreeFilter(node)) return true;
  return node.kind !== "file" && node.childrenLoaded && node.children.some(nodeVisibleInTree);
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((left, right) => {
    if (treeSortMode === "modified-desc") {
      return right.modifiedTime - left.modifiedTime || left.name.localeCompare(right.name, "zh-CN");
    }
    if (treeSortMode === "name-desc") {
      return right.name.localeCompare(left.name, "zh-CN");
    }
    const leftRank = left.kind === "file" ? (treeSortMode === "files-first" ? 0 : 1) : (treeSortMode === "files-first" ? 1 : 0);
    const rightRank = right.kind === "file" ? (treeSortMode === "files-first" ? 0 : 1) : (treeSortMode === "files-first" ? 1 : 0);
    return leftRank - rightRank || left.name.localeCompare(right.name, "zh-CN");
  });
}

function visibleChildren(node: TreeNode): TreeNode[] {
  return sortTreeNodes(node.children.filter(nodeVisibleInTree));
}

function renderTree(): void {
  treeElement.innerHTML = "";
  for (const node of roots) renderNode(node, 0);
  fileCountElement.textContent = `${countFiles({ children: roots } as TreeNode)} 个文件`;
}

function renderNode(node: TreeNode, depth: number): void {
  if (node.kind !== "docs" && !nodeVisibleInTree(node)) return;
  const row = document.createElement("div");
  row.className = "tree-row";
  if (activeNode?.id === node.id) row.classList.add("active");
  if (node.loading) row.classList.add("loading");
  row.style.paddingLeft = `${6 + depth * 14}px`;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth + 1));
  row.setAttribute("aria-expanded", node.kind === "file" ? "false" : String(node.expanded));

  const caret = document.createElement("span");
  caret.className = `caret${node.kind === "file" ? " leaf" : ""}`;
  caret.textContent = node.kind === "file" ? "·" : node.loading ? "…" : node.expanded ? "▾" : "▸";

  const iconInfo = iconFor(node);
  const icon = document.createElement("span");
  icon.className = `tree-icon ${iconInfo.className}`;
  icon.textContent = iconInfo.label;

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = `${node.dirty ? "● " : ""}${node.name}`;
  name.title = node.path || node.name;

  row.append(caret, icon, name);
  if (node.kind === "workspace" && node.path) {
    const path = document.createElement("span");
    path.className = "tree-path";
    path.textContent = node.path;
    path.title = node.path;
    row.append(path);
  }

  const spacer = document.createElement("span");
  spacer.className = "tree-spacer";
  row.append(spacer);

  const actions = document.createElement("span");
  actions.className = "tree-actions";
  if (node.kind !== "file") {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tree-action";
    add.textContent = "+";
    add.title = "新建文件夹 / 新建文档";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      showAddMenu(node, add);
    });
    actions.append(add);
  }
  if (node.kind !== "docs") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tree-action remove";
    remove.textContent = "×";
    remove.title = "从列表移除，不删除磁盘文件";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeNode(node);
    });
    actions.append(remove);
  }
  row.append(actions);

  row.addEventListener("click", () => {
    if (node.kind === "file") {
      void openNode(node);
    } else {
      void toggleNode(node);
    }
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showNodeMenu(node, row);
  });
  treeElement.append(row);

  if (node.kind !== "file" && node.expanded) {
    for (const child of visibleChildren(node)) renderNode(child, depth + 1);
  }
}

async function toggleNode(node: TreeNode): Promise<void> {
  node.expanded = !node.expanded;
  if (node.expanded && node.kind !== "docs" && !node.childrenLoaded) {
    await loadChildren(node);
  }
  renderTree();
  void saveWorkspaceState();
}

async function loadChildren(node: TreeNode): Promise<void> {
  if (node.kind === "file" || node.kind === "docs" || node.childrenLoaded) return;
  node.loading = true;
  renderTree();
  try {
    const entries = await invoke<FileMetadata[]>("list_directory", { path: node.path });
    node.children = entries.map(createFileOrFolderNode);
    node.childrenLoaded = true;
  } catch (error) {
    node.expanded = false;
    showToast(failureMessage(error), true);
  } finally {
    node.loading = false;
    renderTree();
  }
}

function createFileOrFolderNode(metadata: FileMetadata): TreeNode {
  if (metadata.isDirectory) {
    const folder = createContainer("folder", metadata.name, metadata.path);
    folder.size = metadata.size;
    folder.modifiedTime = metadata.modifiedTime;
    return folder;
  }
  return createFileNode(metadata);
}

async function revealNode(node: TreeNode): Promise<void> {
  try {
    await invoke("reveal_in_explorer", { path: node.path });
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function showNodeMenu(node: TreeNode, row: HTMLElement): void {
  const rect = row.getBoundingClientRect();
  const items: MenuItem[] = [];
  if (node.kind === "file") {
    items.push({ label: "打开", action: () => void openNode(node) });
    items.push({ label: "重命名", action: () => renameNode(node) });
    items.push({ label: "在资源管理器中打开", action: () => void revealNode(node) });
    items.push({ label: "复制文件路径", action: () => void copyPath(node.path) });
  } else {
    items.push({ label: node.expanded ? "折叠" : "展开", action: () => void toggleNode(node) });
    if (node.kind === "workspace" || node.kind === "folder") {
      items.push({ label: "重命名", action: () => renameNode(node) });
      items.push({ label: "在资源管理器中打开", action: () => void revealNode(node) });
      items.push({ label: "复制文件夹路径", action: () => void copyPath(node.path) });
    }
  }
  if (node.kind !== "docs") {
    items.push({ separator: true, label: "" });
    items.push({ label: "移除（不删除磁盘文件）", danger: true, action: () => removeNode(node) });
  }
  showMenu(items, rect.left, rect.bottom + 2);
}

function showAddMenu(node: TreeNode, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const items: MenuItem[] = [];
  if (node.kind !== "docs") items.push({ label: "新建文件夹", action: () => promptFolder(node) });
  items.push({ label: "新建文档", action: () => promptDocument(node) });
  showMenu(items, rect.right - 4, rect.bottom + 2);
}

function updateHeader(): void {
  if (!activeNode) {
    docNameElement.textContent = "未选择文档";
    docMetaElement.textContent = "从左侧选择一个文档以开始";
    docMetaElement.classList.remove("path-copyable");
    docMetaElement.removeAttribute("title");
    modePillElement.textContent = "—";
    modePillElement.className = "pill";
    notesButton.disabled = true;
    noteCountElement.textContent = "0";
    updateMarkdownControls();
    updateAnnotationScopeOptions();
    statusModeElement.textContent = "—";
    statusInfoElement.textContent = "";
    statusPathElement.textContent = "";
    statusPathElement.removeAttribute("title");
    return;
  }
  const handler = getHandlerKind(activeNode);
  const editable = handler === "text" || handler === "xlsx";
  docNameElement.textContent = activeNode.name;
  docMetaElement.textContent = formatMeta(activeNode);
  docMetaElement.classList.add("path-copyable");
  docMetaElement.title = "点击复制完整路径";
  modePillElement.textContent = editable ? "可编辑" : handler === "pdf" || handler === "docx" ? "只读预览" : "未接入";
  modePillElement.className = `pill ${editable ? "editable" : "readonly"}`;
  notesButton.disabled = activeNode.kind !== "file" || !config.annotations.enabled;
  updateMarkdownControls();
  updateAnnotationScopeOptions();
  statusPathElement.textContent = formatModifiedTime(activeNode.modifiedTime);
  statusPathElement.title = activeNode.path;
  updateCursorStatus();
  noteCountElement.textContent = String(activeAnnotations?.annotations.length || 0);
}

function showView(view: "empty" | "loading" | "text" | "markdownPreview" | "xlsx" | "pdf" | "docx" | "unsupported"): void {
  emptyViewElement.classList.toggle("hidden", view !== "empty");
  loadingViewElement.classList.toggle("hidden", view !== "loading");
  textPaneElement.classList.toggle("hidden", view !== "text");
  markdownPreviewPaneElement.classList.toggle("hidden", view !== "markdownPreview");
  excelPaneElement.classList.toggle("hidden", view !== "xlsx");
  pdfPaneElement.classList.toggle("hidden", view !== "pdf");
  docxPaneElement.classList.toggle("hidden", view !== "docx");
  unsupportedViewElement.classList.toggle("hidden", view !== "unsupported");
  const markdownBarVisible = (view === "text" || view === "markdownPreview") && isMarkdownNode(activeNode);
  markdownModeBarElement.classList.toggle("hidden", !markdownBarVisible);
}

function isMarkdownNode(node: TreeNode | null): boolean {
  return node?.kind === "file" && node.extension.toLowerCase() === ".md";
}

function updateMarkdownControls(): void {
  const enabled = isMarkdownNode(activeNode);
  markdownEditButton.classList.toggle("active", enabled && markdownViewMode === "edit");
  markdownPreviewButton.classList.toggle("active", enabled && markdownViewMode === "preview");
}

function renderMarkdownPreview(): void {
  if (!isMarkdownNode(activeNode)) return;
  const source = activeNode?.content ?? textEditorElement.value;
  if (markdownPreviewRevision !== markdownContentRevision) {
    markdownPreviewHtml = markdownRenderer.render(source);
    markdownPreviewRevision = markdownContentRevision;
  }
  markdownPreviewElement.innerHTML = markdownPreviewHtml;
}

function setMarkdownViewMode(mode: MarkdownViewMode): void {
  if (!isMarkdownNode(activeNode)) return;
  markdownViewMode = mode;
  updateMarkdownControls();
  if (mode === "preview") {
    renderMarkdownPreview();
    showView("markdownPreview");
    statusModeElement.textContent = "Markdown 预览";
    statusInfoElement.textContent = activeNode?.dirty ? "未保存内容" : "只读预览";
    updateCursorStatus();
  } else {
    showView("text");
    statusModeElement.textContent = "文本编辑";
    updateTextStatus();
  }
}

function annotationScopeLabel(scope: string): string {
  return { general: "全文", selection: "当前选区", page: "当前页", cell: "当前单元格" }[scope] || scope;
}

function annotationLocatorLabel(annotation: AnnotationEntry): string {
  const locator = annotation.locator;
  if (!locator) return annotation.scope === "general" ? "全文" : "未记录定位";
  if (annotation.scope === "selection" && "start" in locator) {
    const label = locator.preview ? "预览选区" : `选区 ${locator.start}-${locator.end}`;
    return `${label}${locator.quote ? `：${locator.quote.slice(0, 48)}` : ""}`;
  }
  if (annotation.scope === "page" && "page" in locator) return `第 ${locator.page} 页`;
  if (annotation.scope === "cell" && "sheet" in locator) return `${locator.sheet}!${locator.cell}`;
  return "已记录定位";
}

function previewSelectionQuote(): string {
  if (!isMarkdownNode(activeNode) || markdownViewMode !== "preview") return "";
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !markdownPreviewElement.contains(selection.anchorNode)) return "";
  return selection.toString().trim().slice(0, 240);
}

function capturePreviewSelection(): void {
  const quote = previewSelectionQuote();
  if (!quote) return;
  const source = activeNode?.content ?? textEditorElement.value;
  const start = source.indexOf(quote);
  previewSelectionSnapshot = { quote, start, end: start < 0 ? -1 : start + quote.length };
}

function selectPreviewQuote(quote: string): void {
  if (!quote) return;
  const walker = document.createTreeWalker(markdownPreviewElement, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue || "";
    const start = value.indexOf(quote);
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + quote.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }
}

function currentAnnotationContext(): { scope: AnnotationScope; locator: AnnotationLocator | null; hint: string } | null {
  if (!activeNode || activeNode.kind !== "file") return null;
  const scope = noteScopeElement.value as AnnotationScope;
  if (scope === "general") return { scope, locator: null, hint: "当前批注关联全文。" };
  if (scope === "selection") {
    if (getHandlerKind(activeNode) !== "text") return null;
    if (markdownViewMode === "preview") {
      const liveQuote = previewSelectionQuote();
      const effective = liveQuote ? { quote: liveQuote, start: -1 } : previewSelectionSnapshot;
      if (!effective || !effective.quote) return null;
      const source = activeNode.content ?? textEditorElement.value;
      const start = effective.start >= 0 ? effective.start : source.indexOf(effective.quote);
      const end = start < 0 ? -1 : start + effective.quote.length;
      const prefix = liveQuote ? "当前批注关联预览选区：" : "已记住的预览选区：";
      return { scope, locator: { start, end, quote: effective.quote, preview: true }, hint: `${prefix}${effective.quote.slice(0, 48)}` };
    }
    if (!activeSession) return null;
    const start = Math.min(textEditorElement.selectionStart, textEditorElement.selectionEnd);
    const end = Math.max(textEditorElement.selectionStart, textEditorElement.selectionEnd);
    if (start === end) return null;
    const quote = textEditorElement.value.slice(start, end).slice(0, 240);
    return { scope, locator: { start, end, quote }, hint: `当前批注关联选区：${quote.slice(0, 48)}` };
  }
  if (scope === "page") {
    if (getHandlerKind(activeNode) !== "pdf" || !activePdfDocument) return null;
    return { scope, locator: { page: activePdfPage }, hint: `当前批注关联第 ${activePdfPage} 页。` };
  }
  if (scope === "cell") {
    if (getHandlerKind(activeNode) !== "xlsx" || !activeCellLocator) return null;
    return { scope, locator: activeCellLocator, hint: `当前批注关联 ${activeCellLocator.sheet}!${activeCellLocator.cell}。` };
  }
  return null;
}

function updateAnnotationScopeOptions(): void {
  const handler = activeNode?.kind === "file" ? getHandlerKind(activeNode) : "future";
  const hasSelection = handler === "text" && (textEditorElement.selectionStart !== textEditorElement.selectionEnd || Boolean(previewSelectionQuote()) || (markdownViewMode === "preview" && Boolean(previewSelectionSnapshot?.quote)));
  const available: Record<AnnotationScope, boolean> = {
    general: activeNode?.kind === "file",
    selection: handler === "text",
    page: handler === "pdf",
    cell: handler === "xlsx",
  };
  for (const option of Array.from(noteScopeElement.options)) {
    const scope = option.value as AnnotationScope;
    option.hidden = !available[scope];
    option.disabled = scope === "selection" ? !hasSelection : scope === "cell" ? !activeCellLocator : false;
  }
  const selected = noteScopeElement.value as AnnotationScope;
  if (!available[selected] || (selected === "selection" && !hasSelection) || (selected === "cell" && !activeCellLocator)) {
    noteScopeElement.value = "general";
  }
  const context = currentAnnotationContext();
  noteContextHintElement.textContent = activeAnnotationStale
    ? "批注可能对应旧版本文件，请确认定位后再添加。"
    : context?.hint || "先选择有效的批注范围。";
  addNoteButton.disabled = !context || !activeAnnotations || !config.annotations.enabled;
}

function focusAnnotation(annotation: AnnotationEntry): void {
  const locator = annotation.locator;
  if (!activeNode || !locator) return;
  if (annotation.scope === "selection" && "start" in locator && getHandlerKind(activeNode) === "text") {
    if (locator.preview && isMarkdownNode(activeNode) && markdownViewMode === "preview") {
      selectPreviewQuote(locator.quote);
      return;
    }
    if (isMarkdownNode(activeNode) && markdownViewMode !== "edit") setMarkdownViewMode("edit");
    textEditorElement.focus();
    textEditorElement.setSelectionRange(locator.start, locator.end);
    updateAnnotationScopeOptions();
    return;
  }
  if (annotation.scope === "page" && "page" in locator && activePdfDocument) {
    const page = Math.max(1, Math.min(locator.page, activePdfDocument.numPages));
    activePdfPage = page;
    updatePdfPageLabel();
    const host = pdfPageHosts.get(page);
    if (host) {
      host.scrollIntoView({ behavior: "smooth", block: "start" });
      void renderPdfPageInto(page, host);
    }
    return;
  }
  if (annotation.scope === "cell" && "sheet" in locator && activeWorkbook) {
    activeSheetName = locator.sheet;
    activeCellLocator = { sheet: locator.sheet, cell: locator.cell };
    renderWorkbook();
    window.setTimeout(() => {
      const cell = document.querySelector(`[data-sheet="${CSS.escape(locator.sheet)}"][data-cell="${CSS.escape(locator.cell)}"]`) as HTMLElement | null;
      cell?.scrollIntoView({ block: "center", inline: "center" });
      cell?.focus();
    }, 0);
    return;
  }
}

function renderNotes(): void {
  const annotations = activeAnnotations?.annotations || [];
  noteCountElement.textContent = String(annotations.length);
  noteFileLabelElement.textContent = activeAnnotationPath || (activeNode ? `${activeNode.name}${config.annotations.extension}` : "未选择文档");
  notesListElement.innerHTML = "";
  updateAnnotationScopeOptions();
  if (activeAnnotationStale) {
    const warning = document.createElement("div");
    warning.className = "note-stale-warning";
    warning.textContent = "原文件已变化，现有批注可能对应旧版本。";
    notesListElement.append(warning);
  }
  if (!activeNode || !activeAnnotations) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = activeNode ? "正在加载批注…" : "暂无批注";
    notesListElement.append(empty);
    return;
  }
  if (annotations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = "暂无批注";
    notesListElement.append(empty);
    return;
  }
  for (const annotation of annotations) {
    const card = document.createElement("article");
    card.className = "note-card note-card-interactive";
    card.addEventListener("click", () => focusAnnotation(annotation));
    const tag = document.createElement("span");
    tag.className = "note-tag";
    tag.textContent = annotationScopeLabel(annotation.scope);
    const locator = document.createElement("div");
    locator.className = "note-locator";
    locator.textContent = annotationLocatorLabel(annotation);
    const text = document.createElement("div");
    text.className = "note-text";
    text.textContent = annotation.text;
    const time = document.createElement("div");
    time.className = "note-time";
    time.textContent = annotation.updatedAt || annotation.createdAt || "刚刚";
    const actions = document.createElement("div");
    actions.className = "note-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "note-edit";
    edit.textContent = "编辑";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      void editAnnotation(annotation.id);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "note-remove";
    remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.confirm("删除这条批注？")) void deleteAnnotation(annotation.id);
    });
    actions.append(edit, remove);
    card.append(tag, locator, text, time, actions);
    notesListElement.append(card);
  }
}

async function editAnnotation(id: string): Promise<void> {
  const annotation = activeAnnotations?.annotations.find((item) => item.id === id);
  if (!annotation) return;
  const text = window.prompt("编辑批注", annotation.text);
  if (text === null) return;
  const nextText = text.trim();
  if (!nextText) {
    showToast("批注内容不能为空。", true);
    return;
  }
  annotation.text = nextText;
  annotation.updatedAt = new Date().toISOString();
  await persistAnnotations();
}

async function deleteAnnotation(id: string): Promise<void> {
  if (!activeAnnotations) return;
  activeAnnotations.annotations = activeAnnotations.annotations.filter((annotation) => annotation.id !== id);
  await persistAnnotations();
}

async function recoverAnnotations(): Promise<void> {
  if (!activeNode || activeNode.kind !== "file") return;
  try {
    const state = await invoke<AnnotationState>("recover_annotations", { targetPath: activeNode.path });
    activeAnnotations = state.document;
    activeAnnotationPath = state.path;
    activeAnnotationStale = false;
    recoverNotesButton.classList.add("hidden");
    renderNotes();
    updateHeader();
    showToast("损坏 qnote 已备份，并已创建新的批注文件。");
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

async function loadAnnotations(node: TreeNode): Promise<void> {
  activeAnnotations = null;
  activeAnnotationPath = "";
  activeAnnotationStale = false;
  recoverNotesButton.classList.add("hidden");
  renderNotes();
  if (!config.annotations.enabled) return;
  try {
    const state = await invoke<AnnotationState>("load_annotations", { targetPath: node.path });
    if (activeNode?.id !== node.id) return;
    activeAnnotations = state.document;
    activeAnnotationPath = state.path;
    activeAnnotationStale = Boolean(state.stale);
    renderNotes();
    updateHeader();
    if (activeAnnotationStale) showToast("批注可能对应旧版本文件，请核对定位。", true);
  } catch (error) {
    if (activeNode?.id !== node.id) return;
    const failure = commandFailure(error);
    renderNotes();
    if (failure.code === "QNOTE_INVALID") {
      recoverNotesButton.classList.remove("hidden");
      noteContextHintElement.textContent = "批注文件损坏，原文件已保留；可备份后新建。";
    }
    showToast(failureMessage(error), true);
  }
}

async function persistAnnotations(): Promise<boolean> {
  if (!activeNode || !activeAnnotations || !config.annotations.enabled) return false;
  try {
    const state = await invoke<AnnotationState>("save_annotations", {
      targetPath: activeNode.path,
      document: activeAnnotations,
    });
    activeAnnotations = state.document;
    activeAnnotationPath = state.path;
    activeAnnotationStale = false;
    renderNotes();
    updateHeader();
    return true;
  } catch (error) {
    showToast(failureMessage(error), true);
    return false;
  }
}

async function addAnnotation(): Promise<void> {
  if (!activeAnnotations || !activeNode) return;
  const context = currentAnnotationContext();
  if (!context) {
    showToast("当前批注范围没有有效定位，请先选择文本、页码或单元格。", true);
    return;
  }
  const text = noteInputElement.value.trim();
  if (!text) {
    showToast("批注内容不能为空。", true);
    return;
  }
  const now = new Date().toISOString();
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `note-${Date.now()}`;
  activeAnnotations.annotations.push({
    id,
    scope: context.scope,
    locator: context.locator,
    text,
    createdAt: now,
    updatedAt: now,
  });
  if (await persistAnnotations()) {
    noteInputElement.value = "";
    showToast(`已写入 ${activeNode.name}${config.annotations.extension}`);
  }
}

function toggleNotes(): void {
  if (notesButton.disabled) return;
  const open = !workareaElement.classList.contains("notes-open");
  workareaElement.classList.toggle("notes-open", open);
  notesPanelElement.classList.toggle("hidden", !open);
}

function markBinaryDirty(): void {
  if (!activeNode || !activeBinarySession) return;
  activeNode.dirty = true;
  renderTree();
  statusInfoElement.textContent = "已修改 · 未保存";
}

function sheetColumnName(column: number): string {
  let value = column + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function renderWorkbook(): void {
  if (!activeWorkbook || !xlsxModule) return;
  const xlsx = xlsxModule;
  sheetTabsElement.innerHTML = "";
  for (const name of activeWorkbook.SheetNames) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `sheet-tab${name === activeSheetName ? " active" : ""}`;
    tab.textContent = name;
    tab.addEventListener("click", () => {
      activeSheetName = name;
      activeCellLocator = null;
      renderWorkbook();
    });
    sheetTabsElement.append(tab);
  }
  const sheet = activeWorkbook.Sheets[activeSheetName];
  const rows = sheet ? xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) : [];
  const rowCount = Math.min(Math.max(rows.length, 1), 200);
  const colCount = Math.min(Math.max(...rows.map((row) => row.length), 1), 30);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "#";
  headRow.append(corner);
  for (let column = 0; column < colCount; column += 1) {
    const th = document.createElement("th");
    th.textContent = sheetColumnName(column);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const tr = document.createElement("tr");
    const rowNumber = document.createElement("th");
    rowNumber.textContent = String(rowIndex + 1);
    tr.append(rowNumber);
    const row = rows[rowIndex] || [];
    for (let column = 0; column < colCount; column += 1) {
      const td = document.createElement("td");
      td.contentEditable = "true";
      td.textContent = String(row[column] ?? "");
      const address = xlsx.utils.encode_cell({ r: rowIndex, c: column });
      td.dataset.sheet = activeSheetName;
      td.dataset.cell = address;
      const selectCell = () => {
        activeCellLocator = { sheet: activeSheetName, cell: address };
        updateCursorStatus();
        updateAnnotationScopeOptions();
      };
      td.addEventListener("click", selectCell);
      td.addEventListener("focus", selectCell);
      td.addEventListener("input", () => {
        sheet[address] = { t: "s", v: td.textContent || "" };
        if (!sheet["!ref"]) sheet["!ref"] = "A1";
        markBinaryDirty();
      });
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  excelTableWrapElement.replaceChildren(table);
  excelMetaElement.textContent = `${activeWorkbook.SheetNames.length} 个工作表 · ${activeSheetName}`;
}

async function saveSpreadsheet(): Promise<void> {
  if (!activeNode || !activeBinarySession || !activeWorkbook || !xlsxModule) return;
  const output = xlsxModule.write(activeWorkbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const bytes = Array.from(new Uint8Array(output));
  const metadata = await invoke<FileMetadata>("save_binary_file", {
    path: activeBinarySession.path,
    bytes,
    expectedSize: activeBinarySession.size,
    expectedModifiedTime: activeBinarySession.modifiedTime,
  });
  activeBinarySession = { ...activeBinarySession, size: metadata.size, modifiedTime: metadata.modifiedTime, bytes: new Uint8Array(bytes) };
  if (activeNode) {
    activeNode.size = metadata.size;
    activeNode.modifiedTime = metadata.modifiedTime;
    activeNode.dirty = false;
  }
  renderTree();
  updateHeader();
  statusInfoElement.textContent = "已保存";
  showToast(`已保存 ${activeNode.name}`);
}

function updatePdfPageLabel(): void {
  if (!activePdfDocument) return;
  pdfPageLabelElement.textContent = `PDF 连续阅读 · 第 ${activePdfPage} / ${activePdfDocument.numPages} 页`;
  updateCursorStatus();
  updateAnnotationScopeOptions();
}

function updateActivePdfPageFromScroll(): void {
  if (!activePdfDocument || pdfPageHosts.size === 0) return;
  const center = pdfCanvasWrapElement.getBoundingClientRect().top + pdfCanvasWrapElement.clientHeight / 2;
  let nearest = activePdfPage;
  let distance = Number.POSITIVE_INFINITY;
  for (const [pageNumber, host] of pdfPageHosts) {
    const rect = host.getBoundingClientRect();
    const hostCenter = rect.top + rect.height / 2;
    const nextDistance = Math.abs(hostCenter - center);
    if (nextDistance < distance) {
      nearest = pageNumber;
      distance = nextDistance;
    }
  }
  if (nearest !== activePdfPage) {
    activePdfPage = nearest;
    updatePdfPageLabel();
  }
}

async function renderPdfPageInto(pageNumber: number, host: HTMLElement): Promise<void> {
  if (!activePdfDocument || pdfPageRendering.has(pageNumber) || host.dataset.rendered === "true") return;
  pdfPageRendering.add(pageNumber);
  try {
    const page = await activePdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 PDF canvas 上下文。");
    host.style.minHeight = `${viewport.height + 22}px`;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const label = document.createElement("div");
    label.className = "pdf-page-label";
    label.textContent = `第 ${pageNumber} 页`;
    host.replaceChildren(label, canvas);
    host.dataset.rendered = "true";
  } finally {
    pdfPageRendering.delete(pageNumber);
  }
}

async function renderPdfDocumentContinuous(): Promise<void> {
  if (!activePdfDocument) return;
  pdfPageObserver?.disconnect();
  pdfPageObserver = null;
  pdfPageHosts.clear();
  pdfPageRendering.clear();
  pdfCanvasWrapElement.replaceChildren();
  for (let pageNumber = 1; pageNumber <= activePdfDocument.numPages; pageNumber += 1) {
    const host = document.createElement("section");
    host.className = "pdf-page";
    host.dataset.page = String(pageNumber);
    pdfPageHosts.set(pageNumber, host);
    pdfCanvasWrapElement.append(host);
  }
  pdfPageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const pageNumber = Number((entry.target as HTMLElement).dataset.page);
      const host = entry.target as HTMLElement;
      void renderPdfPageInto(pageNumber, host);
    }
  }, { root: pdfCanvasWrapElement, rootMargin: "900px 0px" });
  for (const host of pdfPageHosts.values()) pdfPageObserver.observe(host);
  activePdfPage = 1;
  updatePdfPageLabel();
  const firstPage = pdfPageHosts.get(1);
  if (firstPage) await renderPdfPageInto(1, firstPage);
}

async function openBinaryNode(node: TreeNode, handler: HandlerKind): Promise<void> {
  const raw = await invoke<number[]>("read_binary_file", { path: node.path });
  const bytes = new Uint8Array(raw);
  activeBinarySession = { path: node.path, size: node.size, modifiedTime: node.modifiedTime, bytes };
  if (handler === "xlsx") {
    xlsxModule ??= await import("xlsx");
    activeWorkbook = xlsxModule.read(bytes, { type: "array", cellStyles: true });
    activeSheetName = activeWorkbook.SheetNames[0] || "Sheet1";
    renderWorkbook();
    statusModeElement.textContent = "表格编辑";
    statusInfoElement.textContent = `${activeWorkbook.SheetNames.length} 个工作表`;
    showView("xlsx");
    return;
  }
  if (handler === "pdf") {
    pdfjsModule ??= await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjsModule.GlobalWorkerOptions.workerSrc = worker.default;
    activePdfDocument = await pdfjsModule.getDocument({ data: bytes }).promise;
    activePdfPage = 1;
    await renderPdfDocumentContinuous();
    statusModeElement.textContent = "PDF 阅读";
    statusInfoElement.textContent = `${activePdfDocument.numPages} 页`;
    showView("pdf");
    return;
  }
  if (handler === "docx") {
    mammothModule ??= await import("mammoth/mammoth.browser");
    const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
    const result = await mammothModule.convertToHtml({ arrayBuffer });
    docxContentElement.innerHTML = result.value;
    statusModeElement.textContent = "DOCX 阅读";
    statusInfoElement.textContent = "只读";
    showView("docx");
    return;
  }
  throw new Error("未接入该文件类型的 Handler。");
}

async function openNode(node: TreeNode): Promise<void> {
  closeFindBar();
  activeNode = node;
  activeSession = null;
  activeBinarySession = null;
  activeWorkbook = null;
  activeSheetName = "";
  activePdfDocument = null;
  pdfPageObserver?.disconnect();
  pdfPageObserver = null;
  pdfPageHosts.clear();
  pdfPageRendering.clear();
  activePdfPage = 1;
  markdownViewMode = isMarkdownNode(node) ? "preview" : "edit";
  markdownContentRevision = 0;
  markdownPreviewRevision = -1;
  markdownPreviewHtml = "";
  activeAnnotations = null;
  activeAnnotationPath = "";
  activeAnnotationStale = false;
  activeCellLocator = null;
  previewSelectionSnapshot = null;
  updateHeader();
  renderNotes();
  if (node.kind === "file") void loadAnnotations(node);
  showView("loading");
  renderTree();
  const handler = getHandlerKind(node);
  if (handler !== "text") {
    if (handler === "xlsx" || handler === "pdf" || handler === "docx") {
      try {
        await openBinaryNode(node, handler);
        updateHeader();
        renderTree();
      } catch (error) {
        const failure = commandFailure(error);
        unsupportedTitleElement.textContent = `${node.extension || "该文件"} 加载失败`;
        unsupportedMessageElement.textContent = failure.message || "无法加载该格式。";
        statusModeElement.textContent = "加载失败";
        statusInfoElement.textContent = failure.code || "FORMAT_ERROR";
        showView("unsupported");
        updateHeader();
        showToast(failure.message || "格式加载失败。", true);
      }
      return;
    }
    unsupportedTitleElement.textContent = `${node.extension || "该文件"} 暂未接入内置处理器`;
    unsupportedMessageElement.textContent = "当前扩展名未在 config.json Handler 中启用。";
    statusModeElement.textContent = "只读预览";
    statusInfoElement.textContent = "处理器待接入";
    showView("unsupported");
    return;
  }

  try {
    const documentModel = await invoke<TextDocument>("read_text_file", { path: node.path });
    if (activeNode?.id !== node.id) return;
    node.content = documentModel.content;
    node.encoding = documentModel.encoding;
    node.size = documentModel.size;
    node.modifiedTime = documentModel.modifiedTime;
    node.dirty = false;
    activeSession = {
      path: documentModel.path,
      encoding: documentModel.encoding,
      size: documentModel.size,
      modifiedTime: documentModel.modifiedTime,
    };
    textEditorElement.value = documentModel.content;
    editorFileLabelElement.textContent = `${node.name} · 文本编辑`;
    editorEncodingElement.textContent = documentModel.encoding.toUpperCase();
    if (isMarkdownNode(node)) {
      setMarkdownViewMode("preview");
    } else {
      statusModeElement.textContent = "文本编辑";
      updateTextStatus();
      showView("text");
    }
    updateHeader();
    renderTree();
  } catch (error) {
    if (activeNode?.id !== node.id) return;
    const failure = commandFailure(error);
    unsupportedTitleElement.textContent = failure.code === "TEXT_TOO_LARGE" ? "文件超过文本编辑上限" : "文档加载失败";
    unsupportedMessageElement.textContent = failure.message || "无法可靠加载该文档。";
    statusModeElement.textContent = "加载失败";
    statusInfoElement.textContent = failure.code || "FILE_ERROR";
    showView("unsupported");
    updateHeader();
    showToast(failure.message || "文档加载失败。", true);
  }
}

function updateCursorStatus(): void {
  if (!activeNode || activeNode.kind !== "file") {
    statusCursorElement.textContent = "—";
    return;
  }
  const handler = getHandlerKind(activeNode);
  if (handler === "text") {
    const line = textEditorElement.value.slice(0, textEditorElement.selectionStart).split("\n").length;
    statusCursorElement.textContent = markdownViewMode === "preview" ? "预览模式" : `第 ${line} 行`;
  } else if (handler === "xlsx") {
    statusCursorElement.textContent = activeCellLocator ? `${activeCellLocator.sheet}!${activeCellLocator.cell}` : "未选中单元格";
  } else if (handler === "pdf") {
    statusCursorElement.textContent = `第 ${activePdfPage} 页`;
  } else {
    statusCursorElement.textContent = "—";
  }
}

function updateTextStatus(): void {
  const lineCount = textEditorElement.value.split("\n").length;
  statusInfoElement.textContent = `${lineCount} 行 · ${activeNode?.dirty ? "未保存" : "已保存"}`;
  updateCursorStatus();
}

function findSupported(): boolean {
  return Boolean(activeNode && activeSession && getHandlerKind(activeNode) === "text");
}

function refreshFindMatches(): void {
  findMatches = [];
  findMatchIndex = -1;
  const query = findInputElement.value;
  if (!findSupported() || !query) {
    findStatusElement.textContent = query ? "无匹配" : "";
    return;
  }
  const source = textEditorElement.value;
  const haystack = findCaseInput.checked ? source : source.toLocaleLowerCase();
  const needle = findCaseInput.checked ? query : query.toLocaleLowerCase();
  let offset = 0;
  while (needle && offset <= haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    findMatches.push({ start: index, end: index + needle.length });
    offset = index + Math.max(needle.length, 1);
  }
  findStatusElement.textContent = findMatches.length ? `${findMatches.length} 个匹配` : "无匹配";
}

function selectFindMatch(index: number): void {
  if (findMatches.length === 0) return;
  findMatchIndex = (index + findMatches.length) % findMatches.length;
  const match = findMatches[findMatchIndex];
  textEditorElement.focus();
  textEditorElement.setSelectionRange(match.start, match.end);
  findStatusElement.textContent = `${findMatchIndex + 1} / ${findMatches.length}`;
  updateAnnotationScopeOptions();
}

function findNextMatch(direction: 1 | -1): void {
  refreshFindMatches();
  if (findMatches.length === 0) return;
  const cursor = textEditorElement.selectionStart;
  let index = -1;
  if (direction > 0) {
    index = findMatches.findIndex((match) => match.start > cursor);
  } else {
    for (let candidate = findMatches.length - 1; candidate >= 0; candidate -= 1) {
      if (findMatches[candidate].end < cursor) {
        index = candidate;
        break;
      }
    }
  }
  if (index < 0) index = direction > 0 ? 0 : findMatches.length - 1;
  selectFindMatch(index);
}

function openFindBar(replaceMode: boolean): void {
  if (!findSupported()) {
    showToast("当前视图不支持源码查找/替换。", true);
    return;
  }
  if (activeNode && isMarkdownNode(activeNode) && markdownViewMode !== "edit") setMarkdownViewMode("edit");
  findBarElement.classList.remove("hidden");
  replaceInputElement.classList.toggle("hidden", !replaceMode);
  replaceButton.classList.toggle("hidden", !replaceMode);
  replaceAllButton.classList.toggle("hidden", !replaceMode);
  refreshFindMatches();
  findInputElement.focus();
  findInputElement.select();
}

function closeFindBar(): void {
  findBarElement.classList.add("hidden");
  findMatches = [];
  findMatchIndex = -1;
}

function replaceCurrentMatch(): void {
  if (!findSupported()) return;
  const query = findInputElement.value;
  const start = textEditorElement.selectionStart;
  const end = textEditorElement.selectionEnd;
  const selected = textEditorElement.value.slice(start, end);
  const same = findCaseInput.checked ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
  if (!query || !same) {
    findNextMatch(1);
    return;
  }
  textEditorElement.setRangeText(replaceInputElement.value, start, end, "select");
  textEditorElement.dispatchEvent(new Event("input", { bubbles: true }));
  refreshFindMatches();
  findNextMatch(1);
}

function replaceAllMatches(): void {
  if (!findSupported()) return;
  refreshFindMatches();
  if (findMatches.length === 0) return;
  if (!window.confirm(`确认替换全部 ${findMatches.length} 个匹配？`)) return;
  const replacement = replaceInputElement.value;
  for (let index = findMatches.length - 1; index >= 0; index -= 1) {
    const match = findMatches[index];
    textEditorElement.setRangeText(replacement, match.start, match.end, "preserve");
  }
  textEditorElement.dispatchEvent(new Event("input", { bubbles: true }));
  refreshFindMatches();
  showToast("已完成全部替换");
}

function markDirty(): void {
  if (!activeNode || !activeSession) return;
  activeNode.dirty = true;
  activeNode.content = textEditorElement.value;
  if (isMarkdownNode(activeNode)) {
    markdownContentRevision += 1;
    markdownPreviewRevision = -1;
    previewSelectionSnapshot = null;
  }
  updateTextStatus();
  renderTree();
}

async function saveCurrent(): Promise<void> {
  if (!activeNode) return;
  const handler = getHandlerKind(activeNode);
  if (handler === "xlsx" && activeBinarySession) {
    statusInfoElement.textContent = "保存中…";
    try {
      await saveSpreadsheet();
    } catch (error) {
      showToast(failureMessage(error), true);
    }
    return;
  }
  if (handler !== "text" || !activeSession) return;
  const node = activeNode;
  const session = activeSession;
  statusInfoElement.textContent = "保存中…";
  try {
    const metadata = await invoke<FileMetadata>("save_text_file", {
      path: session.path,
      content: textEditorElement.value,
      encoding: session.encoding,
      expectedSize: session.size,
      expectedModifiedTime: session.modifiedTime,
    });
    if (activeNode?.id !== node.id) return;
    node.size = metadata.size;
    node.modifiedTime = metadata.modifiedTime;
    node.content = textEditorElement.value;
    node.dirty = false;
    activeSession = { ...session, size: metadata.size, modifiedTime: metadata.modifiedTime };
    updateTextStatus();
    updateHeader();
    renderTree();
    showToast(`已保存 ${node.name}`);
  } catch (error) {
    const failure = commandFailure(error);
    if (failure.code === "EXTERNAL_MODIFICATION") {
      showToast("文件已被其他程序修改，请重新加载后再保存。", true);
    } else {
      showToast(failure.message || "保存失败。", true);
    }
  }
}

function promptName(title: string, label: string, hint: string, callback: (name: string) => void): void {
  nameTitleElement.textContent = title;
  nameLabelElement.textContent = label;
  nameHintElement.textContent = hint;
  nameInputElement.value = "";
  nameCallback = callback;
  nameOverlayElement.classList.remove("hidden");
  window.setTimeout(() => nameInputElement.focus(), 0);
}

function closeNamePrompt(): void {
  nameCallback = null;
  nameOverlayElement.classList.add("hidden");
}

function openHelp(): void {
  helpContentElement.innerHTML = markdownRenderer.render(configHelpMarkdown);
  helpOverlayElement.classList.remove("hidden");
}

function closeHelp(): void {
  helpOverlayElement.classList.add("hidden");
}

function openSettings(): void {
  textExtensionsInput.value = config.handlers.text.extensions.join(", ");
  maxTextSizeInput.value = String(Math.max(1, config.editor.maxTextFileSizeMB));
  confirmCloseInput.checked = config.editor.confirmBeforeCloseUnsaved;
  annotationEnabledInput.checked = config.annotations.enabled;
  restoreSessionInput.checked = config.workspace.restoreLastSession;
  shellContextMenuInput.checked = config.shell.contextMenu;
  shellOpenWithInput.checked = config.shell.openWith;
  applyTheme(config.appearance.theme);
  settingsOverlayElement.classList.remove("hidden");
  window.setTimeout(() => textExtensionsInput.focus(), 0);
}

function restoreSettingsDefaults(): void {
  textExtensionsInput.value = fallbackConfig.handlers.text.extensions.join(", ");
  maxTextSizeInput.value = String(fallbackConfig.editor.maxTextFileSizeMB);
  confirmCloseInput.checked = fallbackConfig.editor.confirmBeforeCloseUnsaved;
  annotationEnabledInput.checked = fallbackConfig.annotations.enabled;
  restoreSessionInput.checked = fallbackConfig.workspace.restoreLastSession;
  shellContextMenuInput.checked = fallbackConfig.shell.contextMenu;
  shellOpenWithInput.checked = fallbackConfig.shell.openWith;
  requestTheme("light");
}

function closeSettings(): void {
  settingsOverlayElement.classList.add("hidden");
}

function normalizeExtensions(value: string): string[] {
  return value
    .split(/[\s,，、;；]+/)
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`)
    .filter((extension, index, values) => values.indexOf(extension) === index);
}

async function saveSettings(): Promise<void> {
  const textExtensions = normalizeExtensions(textExtensionsInput.value);
  const maxSize = Number.parseInt(maxTextSizeInput.value, 10);
  if (textExtensions.length === 0) {
    showToast("文本后缀不能为空。", true);
    return;
  }
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    showToast("文本大小上限必须是大于等于 1 的整数 MB。", true);
    return;
  }
  if (!hasTauriRuntime()) {
    showToast("浏览器预览不能写入配置，请使用 QuickEdit 桌面运行。", true);
    return;
  }

  const nextConfig: AppConfig = {
    ...config,
    editor: {
      ...config.editor,
      maxTextFileSizeMB: maxSize,
      confirmBeforeCloseUnsaved: confirmCloseInput.checked,
    },
    handlers: {
      ...config.handlers,
      text: { ...config.handlers.text, extensions: textExtensions },
    },
    annotations: {
      ...config.annotations,
      enabled: annotationEnabledInput.checked,
    },
    workspace: { ...config.workspace, restoreLastSession: restoreSessionInput.checked },
    shell: {
      ...config.shell,
      contextMenu: shellContextMenuInput.checked,
      openWith: shellOpenWithInput.checked,
    },
    appearance: {
      ...config.appearance,
      theme: "light",
    },
  };
  settingsSaveButton.disabled = true;
  try {
    await invoke("save_config", { config: nextConfig });
    if (!hasTauriRuntime()) return;
    if (nextConfig.shell.contextMenu !== config.shell.contextMenu) {
      await invoke("set_shell_integration", { kind: "contextMenu", enabled: nextConfig.shell.contextMenu });
    }
    if (nextConfig.shell.openWith !== config.shell.openWith) {
      await invoke("set_shell_integration", { kind: "openWith", enabled: nextConfig.shell.openWith });
    }
    config = nextConfig;
    applyTheme(config.appearance.theme);
    closeSettings();
    renderTree();
    showToast("配置已保存");
  } catch (error) {
    showToast(failureMessage(error), true);
  } finally {
    settingsSaveButton.disabled = false;
  }
}

function confirmName(): void {
  const value = nameInputElement.value.trim();
  const invalid = ["<", ">", ":", '"', "/", "\\", "|", "?", "*"];
  if (!value) {
    showToast("名称不能为空。", true);
    return;
  }
  if (invalid.some((character) => value.includes(character))) {
    showToast("名称不能包含 Windows 非法字符。", true);
    return;
  }
  const callback = nameCallback;
  closeNamePrompt();
  callback?.(value);
}

function promptFolder(parent: TreeNode): void {
  promptName("新建文件夹", "文件夹名称", `将在“${parent.name}”下创建文件夹，并写入磁盘。`, (name) => {
    void createFolder(parent, name);
  });
}

function promptDocument(parent: TreeNode): void {
  const hint = parent.kind === "docs"
    ? "将在系统文档目录的 quickedit 子目录中创建，例如 note.txt。"
    : `将在“${parent.name}”对应的磁盘目录中创建，例如 note.txt。`;
  promptName("新建文档", "文件名（含扩展名）", hint, (name) => {
    void createDocument(parent, name);
  });
}

async function parentPathFor(node: TreeNode): Promise<string> {
  if (node.kind === "docs") return invoke<string>("get_documents_directory");
  if (!node.path) throw new Error("目标目录路径为空。");
  return node.path;
}

async function createFolder(parent: TreeNode, name: string): Promise<void> {
  try {
    const parentPath = await parentPathFor(parent);
    const metadata = await invoke<FileMetadata>("create_folder", { parentPath, name });
    const folder = createFileOrFolderNode(metadata);
    parent.children.push(folder);
    parent.expanded = true;
    parent.childrenLoaded = true;
    renderTree();
    void saveWorkspaceState();
    showToast(`已新建文件夹 ${name}`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function defaultContentFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (extension === ".md") return `# ${name}\n\n`;
  if (extension === ".json") return "{\n  \n}\n";
  return "";
}

async function createDocument(parent: TreeNode, name: string): Promise<void> {
  try {
    const parentPath = await parentPathFor(parent);
    const metadata = await invoke<FileMetadata>("create_document", {
      parentPath,
      name,
      content: defaultContentFor(name),
    });
    const documentNode = createFileNode(metadata);
    parent.children.push(documentNode);
    parent.expanded = true;
    parent.childrenLoaded = true;
    renderTree();
    void saveWorkspaceState();
    showToast(`已新建文档 ${name}`);
    await openNode(documentNode);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  const oldNormalized = oldPath.replace(/[\\/]+$/, "");
  const lowerPath = path.toLowerCase();
  const lowerOld = oldNormalized.toLowerCase();
  if (lowerPath === lowerOld) return newPath;
  if (lowerPath.startsWith(`${lowerOld}\\`) || lowerPath.startsWith(`${lowerOld}/`)) {
    return `${newPath}${path.slice(oldNormalized.length)}`;
  }
  return path;
}

function rewriteNodePaths(node: TreeNode, oldPath: string, newPath: string): void {
  node.path = replacePathPrefix(node.path, oldPath, newPath);
  for (const child of node.children) rewriteNodePaths(child, oldPath, newPath);
}

function renameNode(node: TreeNode): void {
  if (node.kind === "docs") return;
  const isFolder = node.kind === "workspace" || node.kind === "folder";
  promptName(
    "重命名",
    isFolder ? "新文件夹名" : "新文件名（含扩展名）",
    isFolder ? "只重命名当前文件夹，不删除内部文件。" : "只重命名当前文件；如存在伴生 qnote 会同步改名。",
    (name) => { void renameDocument(node, name); },
  );
}

async function renameDocument(node: TreeNode, newName: string): Promise<void> {
  const oldPath = node.path;
  try {
    const metadata = await invoke<FileMetadata>("rename_document", { path: oldPath, newName });
    rewriteNodePaths(node, oldPath, metadata.path);
    node.name = metadata.name;
    node.extension = metadata.extension;
    node.size = metadata.size;
    node.modifiedTime = metadata.modifiedTime;
    if (activeSession) {
      activeSession = { ...activeSession, path: replacePathPrefix(activeSession.path, oldPath, metadata.path) };
    }
    renderTree();
    updateHeader();
    if (activeNode?.kind === "file" && containsNode(node, activeNode)) void loadAnnotations(activeNode);
    void saveWorkspaceState();
    showToast(`已重命名为 ${metadata.name}`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function workspaceRootFor(target: TreeNode, workspace: TreeNode): TreeNode | null {
  if (workspace.kind !== "workspace") return null;
  if (workspace.id === target.id) return workspace;
  for (const child of workspace.children) {
    if (child.id === target.id) return workspace;
    if (child.kind !== "file" && containsNode(child, target)) return workspace;
  }
  return null;
}

function terminalWorkingDirectory(): string | undefined {
  if (!activeNode) return undefined;
  if (activeNode.kind === "workspace" || activeNode.kind === "folder") return activeNode.path;
  for (const root of roots) {
    const workspace = workspaceRootFor(activeNode, root);
    if (workspace) return workspace.path;
  }
  const normalized = activeNode.path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return separator > 0 ? normalized.slice(0, separator) : undefined;
}

function containsNode(parent: TreeNode, target: TreeNode): boolean {
  if (parent.id === target.id) return true;
  return parent.children.some((child) => child.kind !== "file" && containsNode(child, target));
}

function removeNode(node: TreeNode): void {
  const removeFrom = (container: TreeNode): boolean => {
    const index = container.children.findIndex((child) => child.id === node.id);
    if (index >= 0) {
      container.children.splice(index, 1);
      return true;
    }
    return container.children.some((child) => child.kind !== "file" && removeFrom(child));
  };
  if (!window.confirm(`仅从 QuickEdit 列表移除“${node.name}”？\n磁盘文件和未来的 .qnote 不会被删除。`)) return;
  if (!removeFrom({ children: roots } as TreeNode)) return;
  if (activeNode && containsNode(node, activeNode)) {
    activeNode = null;
    activeSession = null;
    activeAnnotations = null;
    activeAnnotationPath = "";
    activeAnnotationStale = false;
    activeCellLocator = null;
    workareaElement.classList.remove("notes-open");
    notesPanelElement.classList.add("hidden");
    renderNotes();
    showView("empty");
    updateHeader();
  }
  renderTree();
  void saveWorkspaceState();
  showToast(`已移除 ${node.name}（磁盘文件未删除）`);
}

async function chooseDocuments(): Promise<void> {
  try {
    const selected = await open({ title: "打开文档", multiple: true, directory: false });
    const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected];
    let added = 0;
    let lastAdded: TreeNode | null = null;
    for (const path of paths) {
      const metadata = await invoke<FileMetadata>("get_file_metadata", { path });
      if (metadata.isDirectory || metadata.name.toLowerCase().endsWith(".qnote")) continue;
      if (docsSection.children.some((child) => samePath(child.path, metadata.path))) continue;
      const node = createFileNode(metadata);
      docsSection.children.push(node);
      lastAdded = node;
      added += 1;
    }
    docsSection.expanded = true;
    renderTree();
    void saveWorkspaceState();
    if (lastAdded) await openNode(lastAdded);
    if (added > 0) showToast(`已加入 ${added} 个文档`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

async function chooseWorkspace(): Promise<void> {
  try {
    const selected = await open({ title: "新增工作区", multiple: false, directory: true });
    if (!selected || Array.isArray(selected)) return;
    const metadata = await invoke<FileMetadata>("get_file_metadata", { path: selected });
    if (!metadata.isDirectory) {
      showToast("请选择文件夹作为工作区。", true);
      return;
    }
    if (roots.some((node) => node.kind === "workspace" && samePath(node.path, metadata.path))) {
      showToast("该工作区已经在列表中。", true);
      return;
    }
    const workspace = createContainer("workspace", metadata.name || basename(metadata.path), metadata.path);
    roots.push(workspace);
    renderTree();
    void saveWorkspaceState();
    showToast(`已新增工作区 ${workspace.name}`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

async function saveWorkspaceState(): Promise<void> {
  if (!hasTauriRuntime()) return;
  const workspaceState: WorkspaceState = {
    version: 2,
    docsFiles: docsSection.children.filter((node) => node.kind === "file").map((node) => node.path),
    workspaces: roots
      .filter((node): node is TreeNode & { kind: "workspace" } => node.kind === "workspace")
      .map((node) => ({ name: node.name, path: node.path, expanded: node.expanded })),
  };
  try {
    await invoke("save_workspace", { state: workspaceState });
  } catch (error) {
    runtimeHintElement.textContent = `索引保存失败：${failureMessage(error)}`;
  }
}

async function restoreWorkspaceState(): Promise<void> {
  if (!hasTauriRuntime() || !config.workspace.restoreLastSession) return;
  try {
    const state = await invoke<WorkspaceState>("load_workspace");
    const documentNodes = await Promise.all(state.docsFiles.map(async (path) => {
      try {
        const metadata = await invoke<FileMetadata>("get_file_metadata", { path });
        return metadata.isDirectory ? null : createFileNode(metadata);
      } catch {
        return null;
      }
    }));
    docsSection.children = documentNodes.filter((node): node is TreeNode => node !== null);
    for (const reference of state.workspaces) {
      if (!reference.path || roots.some((node) => node.kind === "workspace" && samePath(node.path, reference.path))) continue;
      const workspace = createContainer("workspace", reference.name || basename(reference.path), reference.path);
      workspace.expanded = reference.expanded;
      roots.push(workspace);
      if (workspace.expanded) await loadChildren(workspace);
    }
  } catch (error) {
    runtimeHintElement.textContent = `工作区索引未恢复：${failureMessage(error)}`;
  }
}

function bindEvents(): void {
  docMetaElement.addEventListener("click", () => void copyActivePath());
  logoButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const rect = logoButton.getBoundingClientRect();
    showMenu([
      { label: "打开文档", action: () => void chooseDocuments() },
      { label: "新增工作区", action: () => void chooseWorkspace() },
      { label: "设置", action: openSettings },
      { label: "帮助", action: openHelp },
    ], rect.left, rect.bottom + 4);
  });
  treeSearchInput.addEventListener("input", () => {
    treeFilter = treeSearchInput.value.trim().toLowerCase();
    renderTree();
  });
  treeSortSelect.addEventListener("change", () => {
    treeSortMode = treeSortSelect.value as TreeSortMode;
    renderTree();
  });
  document.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".tree-row")) event.preventDefault();
  }, true);
  if (hasTauriRuntime()) {
    const appWindow = getCurrentWindow();
    winMinimizeButton.addEventListener("click", () => void appWindow.minimize());
    winMaximizeButton.addEventListener("click", () => void appWindow.toggleMaximize());
    winCloseButton.addEventListener("click", () => void appWindow.close());
    void appWindow.onResized(async () => {
      try {
        document.body.classList.toggle("maximized", await appWindow.isMaximized());
      } catch {
        /* 状态查询失败时保留当前外观 */
      }
    });
  } else {
    winControlsElement.classList.add("hidden");
  }
  markdownEditButton.addEventListener("click", () => setMarkdownViewMode("edit"));
  markdownPreviewButton.addEventListener("click", () => setMarkdownViewMode("preview"));
  notesButton.addEventListener("click", toggleNotes);
  closeNotesButton.addEventListener("click", () => {
    workareaElement.classList.remove("notes-open");
    notesPanelElement.classList.add("hidden");
  });
  addNoteButton.addEventListener("click", () => void addAnnotation());
  recoverNotesButton.addEventListener("click", () => void recoverAnnotations());
  pdfCanvasWrapElement.addEventListener("scroll", updateActivePdfPageFromScroll, { passive: true });
  helpCloseButton.addEventListener("click", closeHelp);
  settingsCloseButton.addEventListener("click", closeSettings);
  settingsCancelButton.addEventListener("click", closeSettings);
  settingsSaveButton.addEventListener("click", () => void saveSettings());
  settingsResetDefaultsButton.addEventListener("click", restoreSettingsDefaults);
  themeLightButton.addEventListener("click", () => requestTheme("light"));
  themeDarkButton.addEventListener("click", () => requestTheme("dark"));
  themeSystemButton.addEventListener("click", () => requestTheme("system"));
  findInputElement.addEventListener("input", refreshFindMatches);
  replaceInputElement.addEventListener("input", () => undefined);
  findCaseInput.addEventListener("change", refreshFindMatches);
  findPrevButton.addEventListener("click", () => findNextMatch(-1));
  findNextButton.addEventListener("click", () => findNextMatch(1));
  replaceButton.addEventListener("click", replaceCurrentMatch);
  replaceAllButton.addEventListener("click", replaceAllMatches);
  findCloseButton.addEventListener("click", closeFindBar);
  findInputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); findNextMatch(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape") closeFindBar();
  });
  replaceInputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); replaceCurrentMatch(); }
    if (event.key === "Escape") closeFindBar();
  });
  textEditorElement.addEventListener("input", markDirty);
  textEditorElement.addEventListener("select", () => { updateAnnotationScopeOptions(); updateCursorStatus(); });
  textEditorElement.addEventListener("keyup", () => { updateAnnotationScopeOptions(); updateCursorStatus(); });
  document.addEventListener("selectionchange", () => {
    capturePreviewSelection();
    updateAnnotationScopeOptions();
  });
  noteScopeElement.addEventListener("change", updateAnnotationScopeOptions);
  nameCloseButton.addEventListener("click", closeNamePrompt);
  nameCancelButton.addEventListener("click", closeNamePrompt);
  nameOkButton.addEventListener("click", confirmName);
  nameInputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") confirmName();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMenu();
      closeNamePrompt();
      closeSettings();
      closeHelp();
      closeFindBar();
    }
    if (event.ctrlKey && (event.code === "Backquote" || event.key === "`")) {
      event.preventDefault();
      void invoke("launch_terminal", { cwd: terminalWorkingDirectory() }).catch((error) => showToast(failureMessage(error), true));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFindBar(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
      event.preventDefault();
      openFindBar(true);
      return;
    }
    if (event.key === "F2" && activeNode?.kind === "file") {
      event.preventDefault();
      renameNode(activeNode);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrent();
    }
  });
  window.addEventListener("resize", hideMenu);
}

async function openPaths(paths: string[]): Promise<void> {
  let added = 0;
  let lastAdded: TreeNode | null = null;
  for (const path of paths) {
    try {
      const metadata = await invoke<FileMetadata>("get_file_metadata", { path });
      if (metadata.isDirectory) {
        if (!roots.some((node) => node.kind === "workspace" && samePath(node.path, metadata.path))) {
          const workspace = createContainer("workspace", metadata.name || basename(metadata.path), metadata.path);
          roots.push(workspace);
          lastAdded = workspace;
          added += 1;
        }
      } else if (!metadata.name.toLowerCase().endsWith(config.annotations.extension.toLowerCase())) {
        if (!docsSection.children.some((child) => samePath(child.path, metadata.path))) {
          const node = createFileNode(metadata);
          docsSection.children.push(node);
          lastAdded = node;
          added += 1;
        }
      }
    } catch {
      showToast(`无法打开 ${path}`, true);
    }
  }
  if (added > 0) {
    renderTree();
    void saveWorkspaceState();
    if (lastAdded?.kind === "file") await openNode(lastAdded);
    showToast(`已打开 ${added} 个文件/工作区`);
  }
}

async function initialize(): Promise<void> {
  bindEvents();
  if (!hasTauriRuntime()) {
    runtimeHintElement.textContent = "浏览器预览：请使用 QuickEdit 桌面运行文件操作";
    renderTree();
    return;
  }
  try {
    config = await invoke<AppConfig>("load_config");
    applyTheme(config.appearance.theme);
    runtimeHintElement.textContent = "本地文件服务已连接 · V1 稳定版";
  } catch {
    config = fallbackConfig;
    applyTheme(config.appearance.theme);
    runtimeHintElement.textContent = "本地配置不可用：使用默认配置";
  }
  renderTree();
  await restoreWorkspaceState();
  renderTree();
  try {
    const launchPaths = await invoke<string[]>("take_launch_paths");
    if (launchPaths.length > 0) await openPaths(launchPaths);
  } catch {
    /* 启动参数读取失败不阻塞主流程 */
  }
  void listen<string[]>("open-paths", (event) => void openPaths(event.payload));
}

void initialize();
