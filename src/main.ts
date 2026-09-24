import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import MarkdownIt from "markdown-it";
import configHelpMarkdown from "./QuickEdit_Config_Help.md?raw";
import { TextEditor } from "./editor/text-editor";
import { setFindHighlights } from "./editor/find-highlight";
import { collectTextMatches, MAX_FIND_MATCHES } from "./editor/find-matches";
import {
  annotationDamaged,
  annotationDocument,
  annotationPath,
  annotationStale,
  createAnnotation,
  loadAnnotations as loadAnnotationDocument,
  onAnnotationsChanged,
  persistAnnotations,
  recoverAnnotations as recoverAnnotationDocument,
  removeAnnotation,
  resolvedAnnotations,
  resolutionSummary,
  resetAnnotations,
  setActiveSourcePath,
  setAnnotationStatus,
  syncAfterSave,
  updateAnnotationText,
  type CreateAnnotationInput,
} from "./annotations/annotation-service";
import { buildAnchor, resolveTextAnchor } from "./annotations/text-anchor";
import { annotationExtensions, currentMarkerRanges, dispatchActiveMarker, dispatchMarkers } from "./annotations/renderers/text-renderer";
import { highlightPreviewAnnotations, mapRenderedQuoteToSource } from "./annotations/renderers/preview-highlight";
import { AnnotationComposer, type ComposerContext } from "./annotations/ui/annotation-composer";
import { renderAnnotationPanel } from "./annotations/ui/annotation-panel";
import type { AnnotationEntry, ResolvedAnnotation, TextRange } from "./annotations/types";
import {
  fallbackConfig,
  type HandlerKind,
  type FileMetadata,
  type MarkdownViewMode,
  type MenuItem,
  type AppConfig,
  type TerminalContext,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  type TextChunk,
  type TextDocument,
  type TextSession,
  type ThemeMode,
  type TreeNode,
  type TreeSortMode,
  type WorkspaceState,
} from "./core/types";
import {
  basename,
  commandFailure,
  countFiles,
  directoryOf,
  escapeHtml,
  failureMessage,
  formatBytes,
  formatCreatedTime,
  formatMeta,
  formatModifiedTime,
  hasTauriRuntime,
  nextId,
  samePath,
} from "./core/format";
import {
  addGeneralNoteButton, annotationBubbleElement, docMetaElement, docNameElement, docRunButton,
  editorEncodingElement, editorFileLabelElement,
  fileCountElement, findBarElement, findCaseInput, findCloseButton, findInputElement, findNextButton, findPrevButton,
  findStatusElement, logoButton, markdownBarLabelElement, markdownEditButton, markdownPreviewButton,
  markdownPreviewElement, htmlPreviewFrameElement, maxTextSizeInput, modePillElement, nameCancelButton, nameCloseButton,
  nameHintElement, nameInputElement, nameLabelElement, nameOkButton, nameOverlayElement, nameTitleElement,
  noteCountElement, noteFileLabelElement, noteFilterAllButton, noteFilterOpenButton, notePanelCountElement,
  noteTagFilterClearButton, notesButton, notesListElement, notesPanelElement,
  recoverNotesButton, replaceAllButton, replaceButton, replaceInputElement, restoreSessionInput, runnersInput,
  runtimeHintElement, settingsCancelButton, settingsCloseButton, settingsOverlayElement, settingsResetDefaultsButton,
  settingsSaveButton, shellContextMenuInput, shellOpenWithInput, sidebarResizerElement, statusCursorElement, statusInfoElement,
  statusModeElement, statusPathElement, textEditorHostElement, textExtensionsInput,
  themeDarkButton, themeLightButton, themeSelect, themeSystemButton, toastCloseButton,
  treeElement, treeSearchInput, treeSortSelect,
  winCloseButton, winControlsElement, winMaximizeButton, winMinimizeButton, workareaElement, contentElement,
  helpContentElement, helpOverlayElement, confirmCloseInput, annotationEnabledInput, closeNotesButton, helpCloseButton,
} from "./ui/elements";
import { hideToast, showToast } from "./ui/toast";
import { hideMenu, showMenu } from "./ui/context-menu";
import { renderInfoView, type InfoViewAction, type InfoViewKind, type InfoViewMetadataItem } from "./ui/info-view";
import { setMarkdownBarEnabled, showView } from "./ui/views";
import { activeDocumentHandler, disposeActiveHandler, hasHandler, openWithHandler, saveActiveHandler, type HandlerBridge } from "./core/handler-registry";
import { registerFormatHandlers } from "./handlers/index";
import { buildRunPlan, isRunnable } from "./features/runners/runner-service";
import { decideOpenMode, TEXT_CHUNK_BYTES } from "./core/open-decision";
import { renderHtmlPreviewDocument } from "./features/html-preview/html-preview";
import { createTerminalFeature } from "./features/terminal/terminal-feature";
import { createReviewPanel } from "./features/review/review-panel";

const markdownRenderer = new MarkdownIt({ html: false, linkify: false, typographer: false });
markdownRenderer.renderer.rules.image = (tokens, index) => {
  const alt = tokens[index].content.trim();
  return `<span class="md-image-placeholder">${alt ? `[图片：${escapeHtml(alt)}]` : "[图片]"}</span>`;
};
markdownRenderer.renderer.rules.link_open = () => "";
markdownRenderer.renderer.rules.link_close = () => "";

const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
let pendingTheme: ThemeMode = "light";

function updateThemeCards(mode: ThemeMode): void {
  themeLightButton.classList.toggle("active", mode === "light");
  themeDarkButton.classList.toggle("active", mode === "dark");
  themeSystemButton.classList.toggle("active", mode === "system");
}

function applyTheme(mode: ThemeMode): void {
  pendingTheme = mode;
  const resolved = mode === "system" ? (systemDarkQuery.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  themeSelect.value = mode;
  updateThemeCards(mode);
  themeColorMeta?.setAttribute("content", resolved === "dark" ? "#151922" : "#eef1f6");
}

// 设置弹窗里的即时预览：真正落盘要等用户点“保存”。
function requestTheme(mode: ThemeMode): void {
  applyTheme(mode);
}

systemDarkQuery.addEventListener("change", () => {
  if (pendingTheme === "system") applyTheme("system");
});


let config = fallbackConfig;
let roots: TreeNode[] = [];
let activeNode: TreeNode | null = null;
let activeSession: TextSession | null = null;
let markdownViewMode: MarkdownViewMode = "edit";
let markdownContentRevision = 0;
let markdownPreviewRevision = -1;
let markdownPreviewHtml = "";
let htmlPreviewRevision = -1;
let findMatches: Array<{ start: number; end: number }> = [];
let findMatchIndex = -1;
let findMatchesCapped = false;
let activeAnnotationId: string | null = null;
let annotationLoading = false;
let notesFilter: "all" | "open" = "all";
let notesTagFilter: string | null = null;
let textEditor: TextEditor | null = null;
let composer: AnnotationComposer | null = null;
let treeFilter = "";
let treeSortMode: TreeSortMode = "files-first";
let nameCallback: ((name: string) => void) | null = null;

const docsSection = createContainer("docs", "文档", "");
roots = [docsSection];

// 懒加载 Handler 不能反向 import 控制器，需要回主界面的动作统一走这座桥。
const handlerBridge: HandlerBridge = {
  markDirty: () => {
    if (!activeNode) return;
    activeNode.dirty = true;
    renderTree();
    statusInfoElement.textContent = "已修改 · 未保存";
  },
  status: (mode, info) => {
    statusModeElement.textContent = mode;
    statusInfoElement.textContent = info;
  },
  refreshCursor: () => updateCursorStatus(),
  revealAnnotation: (id) => activateAnnotation(id, { fromMarker: true }),
};


function createContainer(kind: "docs" | "workspace" | "folder", name: string, path: string): TreeNode {
  return {
    id: kind === "docs" ? "docs-section" : nextId(),
    kind,
    name,
    path,
    extension: "",
    size: 0,
    modifiedTime: 0,
    createdTime: 0,
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
    createdTime: metadata.createdTime,
    expanded: false,
    childrenLoaded: true,
    loading: false,
    children: [],
    dirty: false,
  };
}

// 脚本始终按纯文本编辑打开，不依赖用户配置里的后缀清单（旧配置可能缺少这些后缀，
// 会退化成信息概览页）。.exe 不在其中，仍走可执行文件概览。
const SCRIPT_EDIT_EXTENSIONS = new Set([".bat", ".cmd", ".ps1"]);

function getHandlerKind(node: TreeNode): HandlerKind {
  if (node.forceText) return "text";
  const extension = node.extension.toLowerCase();
  if (SCRIPT_EDIT_EXTENSIONS.has(extension)) return "text";
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
      showAddMenu(node, event.clientX, event.clientY);
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
    showNodeMenu(node, event.clientX, event.clientY);
  });
  treeElement.append(row);

  if (node.kind !== "file" && node.expanded) {
    for (const child of visibleChildren(node)) renderNode(child, depth + 1);
  }
}

function selectContainer(node: TreeNode): void {
  void disposeActiveHandler();
  closeFindBar();
  activeNode = node;
  activeSession = null;
  resetLargeText();
  resetAnnotations();
  activeAnnotationId = null;
  notesTagFilter = null;
  closeNotesPanel();
  showView("folder");
  renderFolderInfo(node);
  updateHeader();
  renderTree();
  void refreshContainerMetadata(node);
}

async function refreshContainerMetadata(node: TreeNode): Promise<void> {
  if (!hasTauriRuntime()) return;
  try {
    const path = node.kind === "docs" ? await invoke<string>("get_documents_directory") : node.path;
    if (!path) return;
    const metadata = await invoke<FileMetadata>("get_file_metadata", { path });
    if (activeNode?.id !== node.id) return;
    node.path = metadata.path;
    node.size = metadata.size;
    node.modifiedTime = metadata.modifiedTime;
    node.createdTime = metadata.createdTime;
    renderFolderInfo(node);
    updateHeader();
    renderTree();
  } catch (error) {
    if (activeNode?.id === node.id) showToast(failureMessage(error), true);
  }
}

async function toggleNode(node: TreeNode): Promise<void> {
  selectContainer(node);
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
    folder.createdTime = metadata.createdTime;
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

function showNodeMenu(node: TreeNode, x: number, y: number): void {
  const items: MenuItem[] = [];
  if (node.kind === "file") {
    items.push({ label: "打开", action: () => void openNode(node) });
    items.push({ label: "重新加载", action: () => void reloadNode(node) });
    items.push({ label: "重命名", action: () => renameNode(node) });
    items.push({ label: "在资源管理器中打开", action: () => void revealNode(node) });
    items.push({ label: "复制文件路径", action: () => void copyPath(node.path) });
  } else {
    items.push({ label: node.expanded ? "折叠" : "展开", action: () => void toggleNode(node) });
    if (node.kind === "workspace" || node.kind === "folder") {
      items.push({ label: "重新加载", action: () => void reloadNode(node) });
      items.push({ label: "重命名", action: () => renameNode(node) });
      items.push({ label: "在资源管理器中打开", action: () => void revealNode(node) });
      items.push({ label: "复制文件夹路径", action: () => void copyPath(node.path) });
    }
  }
  if (node.kind !== "docs") {
    items.push({ separator: true, label: "" });
    items.push({ label: "移除（不删除磁盘文件）", danger: true, action: () => removeNode(node) });
  }
  showMenu(items, x, y);
}

function showAddMenu(node: TreeNode, x: number, y: number): void {
  const items: MenuItem[] = [];
  if (node.kind !== "docs") items.push({ label: "新建文件夹", action: () => promptFolder(node) });
  items.push({ label: "新建文档", action: () => promptDocument(node) });
  showMenu(items, x, y);
}

// —— 重新加载：文件重读磁盘，文件夹只刷新自己的子节点 ——
async function reloadNode(node: TreeNode): Promise<void> {
  if (node.kind === "file") {
    if (node.dirty && !window.confirm("当前文档有未保存修改，重新加载会丢弃它们，继续吗？")) return;
    try {
      await openNode(node);
      showToast(`已重新加载 ${node.name}`);
    } catch (error) {
      showToast(failureMessage(error), true);
    }
    return;
  }
  try {
    node.childrenLoaded = false;
    node.expanded = false;
    await loadChildren(node);
    node.expanded = true;
    renderTree();
    if (activeNode?.id === node.id) {
      renderFolderInfo(node);
      updateHeader();
    }
    showToast(`已重新加载 ${node.name}`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

// 按树中当前可见顺序取文档列表（含过滤与排序结果）。
function visibleFiles(): TreeNode[] {
  const files: TreeNode[] = [];
  const walk = (node: TreeNode): void => {
    for (const child of visibleChildren(node)) {
      if (child.kind === "file") files.push(child);
      else if (child.expanded) walk(child);
    }
  };
  for (const root of roots) {
    if (root.kind === "file") files.push(root);
    else if (root.expanded) walk(root);
  }
  return files;
}

function stepDocument(direction: 1 | -1): void {
  const files = visibleFiles();
  if (files.length === 0) {
    showToast("列表里还没有可切换的文档。", true);
    return;
  }
  const current = activeNode ? files.findIndex((file) => file.id === activeNode?.id) : -1;
  const next = current < 0
    ? (direction > 0 ? 0 : files.length - 1)
    : (current + direction + files.length) % files.length;
  void openNode(files[next]);
}

function renderFolderInfo(node: TreeNode): void {
  const metadata: InfoViewMetadataItem[] = [
    { label: "名称", value: node.name },
    { label: "修改日期", value: formatModifiedTime(node.modifiedTime) },
    { label: "创建日期", value: formatCreatedTime(node.createdTime) },
    { label: "位置", value: node.path || "正在获取系统文档目录…" },
    { label: "包含文件", value: node.childrenLoaded ? `${countFiles(node)} 个文件` : "未展开" },
  ];
  const actions: InfoViewAction[] = [
    { id: "terminal", label: "⌨ 打开终端", primary: true, execute: () => void terminalFeature.openFor(node) },
    { id: "copy", label: "复制位置", execute: () => void copyPath(node.path) },
  ];
  renderInfoView({
    kind: "folder",
    badge: node.kind === "workspace" ? "WS" : "DIR",
    title: node.name,
    subtitle: node.kind === "workspace" ? "工作区" : "文件夹",
    metadata,
    actions,
  });
}

async function openWithSystemApp(node: TreeNode): Promise<void> {
  try {
    if (hasTauriRuntime()) {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(node.path);
    } else {
      showToast("浏览器预览不支持系统打开，请在桌面端使用。", true);
    }
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

// Application-level fallback for files without a usable handler (design doc §6).
function showFileInfoView(node: TreeNode, kind: InfoViewKind, subtitle: string, options?: { retry?: boolean; openAsText?: boolean; loadLarge?: boolean }): void {
  const executable = node.extension.toLowerCase() === ".exe";
  const badge = executable ? "EXE" : (node.extension ? node.extension.slice(1, 5).toUpperCase() : "FILE");
  const metadata: InfoViewMetadataItem[] = [
    { label: "名称", value: node.name },
    { label: "类型", value: node.extension ? `${node.extension} 文件` : "无扩展名" },
    { label: "大小", value: formatBytes(node.size) },
    { label: "修改日期", value: formatModifiedTime(node.modifiedTime) },
    { label: "创建日期", value: formatCreatedTime(node.createdTime) },
    { label: "位置", value: node.path },
  ];
  const actions: InfoViewAction[] = [];
  if (options?.retry) actions.push({ id: "retry", label: "重新尝试", primary: true, execute: () => void openNode(node) });
  if (options?.openAsText) actions.push({ id: "text", label: "以文本方式打开", primary: !options.retry, execute: () => void openNode(node, { forceText: true }) });
  if (options?.loadLarge) actions.push({ id: "large", label: "仍要分批只读加载", primary: true, execute: () => void openLargeText(node, true) });
  if (isRunnable(node.extension, config.runners)) actions.push({ id: "run", label: "在终端运行", execute: () => void runDocument(node) });
  actions.push({ id: "system", label: "使用系统程序打开", primary: !options?.retry && !options?.openAsText && !options?.loadLarge, execute: () => void openWithSystemApp(node) });
  actions.push({ id: "copy", label: "复制位置", execute: () => void copyPath(node.path) });
  renderInfoView({
    kind: executable && kind === "unsupported" ? "executable" : kind,
    badge,
    title: node.name,
    subtitle: executable && kind === "unsupported" ? "Windows 可执行程序" : subtitle,
    metadata,
    actions,
  });
  showView("folder");
}

function closeNotesPanel(): void {
  workareaElement.classList.remove("notes-open");
  notesPanelElement.classList.add("hidden");
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
    notesButton.classList.add("hidden");
    noteCountElement.textContent = "0";
    notePanelCountElement.textContent = "0";
    updateMarkdownControls();
    updateRunButton(null);
    statusModeElement.textContent = "—";
    statusInfoElement.textContent = "";
    statusPathElement.textContent = "";
    statusPathElement.removeAttribute("title");
    return;
  }

  if (activeNode.kind !== "file") {
    docNameElement.textContent = activeNode.name;
    docMetaElement.textContent = activeNode.path || "系统文档目录中的 quickedit 文件夹";
    docMetaElement.classList.toggle("path-copyable", Boolean(activeNode.path));
    docMetaElement.title = activeNode.path ? "点击复制完整路径" : "等待系统文档目录路径";
    modePillElement.textContent = activeNode.kind === "workspace" ? "工作区" : "文件夹";
    modePillElement.className = "pill readonly";
    notesButton.disabled = true;
    notesButton.classList.add("hidden");
    noteCountElement.textContent = "0";
    notePanelCountElement.textContent = "0";
    statusModeElement.textContent = "文件夹信息";
    statusInfoElement.textContent = activeNode.childrenLoaded ? `${countFiles(activeNode)} 个文件` : "目录未展开";
    statusPathElement.textContent = formatModifiedTime(activeNode.modifiedTime);
    statusPathElement.title = activeNode.path;
    renderFolderInfo(activeNode);
    updateMarkdownControls();
    updateRunButton(null);
    updateCursorStatus();
    return;
  }

  const handler = getHandlerKind(activeNode);
  const editable = handler === "text" || handler === "xlsx";
  const readonlyPreview = handler === "pdf" || handler === "docx" || hasHandler(activeNode.extension);
  docNameElement.textContent = activeNode.name;
  docMetaElement.textContent = formatMeta(activeNode);
  docMetaElement.classList.add("path-copyable");
  docMetaElement.title = "点击复制完整路径";
  modePillElement.textContent = editable ? "可编辑" : readonlyPreview ? "只读预览" : "未接入";
  modePillElement.className = `pill ${editable ? "editable" : "readonly"}`;
  notesButton.disabled = !config.annotations.enabled;
  notesButton.classList.remove("hidden");
  updateMarkdownControls();
  updateRunButton(activeNode);
  statusPathElement.textContent = formatModifiedTime(activeNode.modifiedTime);
  statusPathElement.title = activeNode.path;
  updateCursorStatus();
  const annotationTotal = annotationDocument()?.annotations.length || 0;
  noteCountElement.textContent = String(annotationTotal);
  notePanelCountElement.textContent = String(annotationTotal);
}

function updateRunButton(node: TreeNode | null): void {
  const runnable = Boolean(node && node.kind === "file" && isRunnable(node.extension, config.runners));
  docRunButton.classList.toggle("hidden", !runnable);
}

async function runDocument(node: TreeNode): Promise<void> {
  const workspaceRoot = roots
    .map((root) => workspaceRootFor(node, root))
    .find((root): root is TreeNode => root !== null);
  const plan = buildRunPlan(node, config.runners, workspaceRoot?.path || "");
  if (!plan) {
    showToast("该文件没有可用的运行方式。", true);
    return;
  }
  await terminalFeature.runCommand(node, plan.shell, plan.command, directoryOf(node.path));
}

async function runActiveDocument(): Promise<void> {
  const node = activeNode;
  if (!node || node.kind !== "file") return;
  await runDocument(node);
}

function isMarkdownNode(node: TreeNode | null): boolean {
  return node?.kind === "file" && node.extension.toLowerCase() === ".md";
}

function isHtmlNode(node: TreeNode | null): boolean {
  const extension = node?.kind === "file" ? node.extension.toLowerCase() : "";
  return extension === ".html" || extension === ".htm";
}

function isPreviewableNode(node: TreeNode | null): boolean {
  return isMarkdownNode(node) || isHtmlNode(node);
}

function updateMarkdownControls(): void {
  const enabled = isPreviewableNode(activeNode);
  markdownBarLabelElement.textContent = isHtmlNode(activeNode) ? "HTML" : "Markdown";
  markdownEditButton.classList.toggle("active", enabled && markdownViewMode === "edit");
  markdownPreviewButton.classList.toggle("active", enabled && markdownViewMode === "preview");
}

function renderMarkdownPreview(): void {
  if (!isMarkdownNode(activeNode)) return;
  const source = activeNode?.content;
  // 正文尚未加载（openNode 早期通知会打到这里）时直接跳过，
  // 否则会把空内容写进 revision 缓存，导致首次打开永远空白。
  if (source === undefined) return;
  if (markdownPreviewRevision !== markdownContentRevision) {
    markdownPreviewHtml = markdownRenderer.render(source);
    markdownPreviewRevision = markdownContentRevision;
  }
  markdownPreviewElement.innerHTML = markdownPreviewHtml;
  highlightPreviewAnnotations(markdownPreviewElement, annotationsForPanel());
}

// §8: HTML 静态预览委托给 features/html-preview（净化 + CSP + 沙箱 iframe）。
async function renderHtmlPreview(): Promise<void> {
  if (!isHtmlNode(activeNode)) return;
  const source = activeNode?.content;
  if (source === undefined) return;
  if (htmlPreviewRevision === markdownContentRevision) return;
  const frameDocument = await renderHtmlPreviewDocument(source);
  if (activeNode?.content !== source) return;
  htmlPreviewFrameElement.srcdoc = frameDocument;
  htmlPreviewRevision = markdownContentRevision;
}

function setMarkdownViewMode(mode: MarkdownViewMode): void {
  if (!isPreviewableNode(activeNode)) return;
  markdownViewMode = mode;
  updateMarkdownControls();
  if (mode === "preview") {
    if (isHtmlNode(activeNode)) {
      showView("htmlPreview");
      statusModeElement.textContent = "HTML 预览";
      statusInfoElement.textContent = activeNode?.dirty ? "未保存内容" : "只读预览（已净化）";
      updateCursorStatus();
      void renderHtmlPreview();
    } else {
      renderMarkdownPreview();
      showView("markdownPreview");
      statusModeElement.textContent = "Markdown 预览";
      statusInfoElement.textContent = activeNode?.dirty ? "未保存内容" : "只读预览";
      updateCursorStatus();
    }
  } else {
    showView("text");
    statusModeElement.textContent = "文本编辑";
    updateTextStatus();
  }
}

function ensureEditor(): TextEditor {
  if (!textEditor) {
    textEditor = new TextEditor(
      textEditorHostElement,
      annotationExtensions({
        onMarkerClick: (id) => activateAnnotation(id, { fromMarker: true }),
        tooltipFor: (id) => {
          const item = annotationsForPanel().find((annotation) => annotation.entry.id === id);
          if (!item) return null;
          return { title: item.entry.text, meta: annotationPositionLabel(item.entry, item.range) };
        },
      }),
      {
        onChange: () => {
          hideAnnotationBubble();
          markDirty();
        },
        onSelectionChange: () => {
          scheduleAnnotationBubble();
          updateCursorStatus();
        },
      }
    );
  }
  return textEditor;
}

function ensureComposer(): AnnotationComposer {
  if (!composer) composer = new AnnotationComposer(contentElement, { onSubmit: () => undefined });
  return composer;
}

function closeComposer(): void {
  if (composer?.open) composer.close();
}

function annotationPositionLabel(entry: AnnotationEntry, range?: TextRange): string {
  if (entry.scope === "text-range") {
    const target = range || (entry.locator && "start" in entry.locator ? entry.locator : null);
    if (textEditor && target) {
      const startLine = textEditor.lineOf(target.start);
      const endLine = textEditor.lineOf(target.end);
      return startLine === endLine ? `L${startLine}` : `L${startLine}–L${endLine}`;
    }
    return "文本选区";
  }
  if (entry.scope === "page" && entry.locator && "page" in entry.locator) return `第 ${entry.locator.page} 页`;
  if (entry.scope === "cell" && entry.locator && "sheet" in entry.locator) return `${entry.locator.sheet}!${entry.locator.cell}`;
  if (entry.scope === "general") return "全文";
  return "批注";
}

function annotationsForPanel(): ResolvedAnnotation[] {
  const runtime = textEditor ? currentMarkerRanges(textEditor.view) : null;
  return resolvedAnnotations().map((item) => {
    if (item.entry.scope === "text-range" && item.resolution === "resolved" && runtime) {
      const range = runtime.get(item.entry.id);
      if (range) return { ...item, range };
    }
    return item;
  });
}

function syncAnnotationMarkers(): void {
  if (!textEditor) return;
  const items = annotationsForPanel()
    .filter((item) => item.entry.scope === "text-range" && item.resolution === "resolved" && item.range && item.range.end > item.range.start)
    .map((item) => ({ id: item.entry.id, range: item.range as TextRange }));
  dispatchMarkers(textEditor.view, items);
  dispatchActiveMarker(textEditor.view, activeAnnotationId);
}

function renderAnnotationUi(): void {
  const hasDocument = Boolean(annotationDocument());
  const annotations = annotationsForPanel();
  noteCountElement.textContent = String(annotations.length);
  notePanelCountElement.textContent = String(annotations.length);
  if (activeNode?.kind === "file") {
    noteFileLabelElement.textContent = `${activeNode.name}${config.annotations.extension}`;
    noteFileLabelElement.title = annotationPath();
  } else {
    noteFileLabelElement.textContent = "未选择文档";
    noteFileLabelElement.removeAttribute("title");
  }
  addGeneralNoteButton.disabled = !hasDocument || !config.annotations.enabled;
  noteFilterAllButton.classList.toggle("active", notesFilter === "all");
  noteFilterOpenButton.classList.toggle("active", notesFilter === "open");
  noteTagFilterClearButton.classList.toggle("hidden", !notesTagFilter);
  if (notesTagFilter) noteTagFilterClearButton.textContent = `标签：${notesTagFilter} ✕`;
  const filterActive = notesFilter === "open" || Boolean(notesTagFilter);
  const visible = annotations.filter((item) => {
    if (notesFilter === "open" && item.entry.status === "resolved") return false;
    if (notesTagFilter && !(item.entry.tags || []).includes(notesTagFilter)) return false;
    return true;
  });
  renderAnnotationPanel({
    listElement: notesListElement,
    annotations: visible,
    hasDocument,
    loading: annotationLoading,
    staleSummary: annotationStale() && hasDocument && annotations.length > 0 ? resolutionSummary() : null,
    activeId: activeAnnotationId,
    activeTagFilter: notesTagFilter,
    filterActive,
    positionLabel: annotationPositionLabel,
    callbacks: {
      onActivate: (id) => activateAnnotation(id),
      onEdit: (id) => openEditComposer(id),
      onDelete: (id) => void deleteAnnotation(id),
      onToggleStatus: (id) => void toggleAnnotationStatus(id),
      onToggleTagFilter: (tag) => { notesTagFilter = notesTagFilter === tag ? null : tag; renderAnnotationUi(); },
    },
  });
  syncAnnotationMarkers();
  updateAnnotationBubble();
}

function selectionTextRange(): TextRange | null {
  if (!textEditor || markdownViewMode === "preview") return null;
  const range = textEditor.selectionRange();
  return range.start === range.end ? null : range;
}

function previewQuote(): string {
  if (!isMarkdownNode(activeNode) || markdownViewMode !== "preview") return "";
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !markdownPreviewElement.contains(selection.anchorNode)) return "";
  return selection.toString().trim().slice(0, 240);
}

function anchorRectForBubble(): DOMRect | null {
  if (markdownViewMode === "preview") {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }
  if (!textEditor) return null;
  const coords = textEditor.coordsAt(textEditor.selectionRange().end);
  if (!coords) return null;
  return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
}

let bubbleFrame = 0;
function scheduleAnnotationBubble(): void {
  if (bubbleFrame) return;
  bubbleFrame = window.requestAnimationFrame(() => {
    bubbleFrame = 0;
    updateAnnotationBubble();
  });
}

function updateAnnotationBubble(): void {
  const isTextNode = Boolean(activeNode?.kind === "file" && getHandlerKind(activeNode) === "text" && textEditor);
  const hasSelection = isTextNode && Boolean(selectionTextRange() || previewQuote());
  const rect = hasSelection ? anchorRectForBubble() : null;
  if (!isTextNode || !hasSelection || !rect || !annotationDocument() || !config.annotations.enabled || composer?.open) {
    hideAnnotationBubble();
    return;
  }
  const hostRect = contentElement.getBoundingClientRect();
  annotationBubbleElement.style.left = `${Math.max(8, Math.min(rect.left - hostRect.left, hostRect.width - 96))}px`;
  annotationBubbleElement.style.top = `${Math.max(8, Math.min(rect.bottom - hostRect.top + 8, hostRect.height - 40))}px`;
  annotationBubbleElement.classList.remove("hidden");
}

function hideAnnotationBubble(): void {
  annotationBubbleElement.classList.add("hidden");
}

async function commitAnnotationChange(mutate: () => void | Promise<unknown>): Promise<boolean> {
  await mutate();
  try {
    return await persistAnnotations();
  } catch (error) {
    renderAnnotationUi();
    showToast(failureMessage(error), true);
    return false;
  }
}

function annotationSubmit(scope: CreateAnnotationInput["scope"], locator: CreateAnnotationInput["locator"], anchor: CreateAnnotationInput["anchor"]): (text: string, tags: string[]) => Promise<void> {
  return async (text: string, tags: string[]) => {
    const persisted = await commitAnnotationChange(() => createAnnotation({ scope, locator, anchor, text, tags }));
    if (persisted) showToast(`已写入 ${activeNode?.name || ""}${config.annotations.extension}`);
  };
}

function openComposerForContext(context: ComposerContext, submit: (text: string, tags: string[]) => void | Promise<void>, at?: { x: number; y: number }): void {
  const instance = ensureComposer();
  instance.setOptions({
    onSubmit: async (text, tags) => {
      await submit(text, tags);
      instance.close();
    },
  });
  instance.openAt(context, at);
}

function openTextSelectionComposer(): void {
  const range = selectionTextRange();
  if (!range || !textEditor) return;
  const source = textEditor.getText();
  const quote = source.slice(range.start, range.end).slice(0, 240);
  const anchor = buildAnchor(source, range);
  const entryStub: AnnotationEntry = { id: "", scope: "text-range", locator: range, text: "", createdAt: "", updatedAt: "" };
  const rect = anchorRectForBubble();
  openComposerForContext(
    { quote, scopeHint: `文本选区 · ${annotationPositionLabel(entryStub, range)}` },
    annotationSubmit("text-range", { start: range.start, end: range.end }, anchor),
    rect ? { x: rect.left, y: rect.bottom } : undefined
  );
  hideAnnotationBubble();
}

function openPreviewSelectionComposer(): void {
  const quote = previewQuote();
  if (!quote) return;
  const source = textEditor ? textEditor.getText() : activeNode?.content || "";
  const outcome = resolveTextAnchor(source, null, { quote, prefix: "", suffix: "" });
  let range: TextRange | null = outcome.resolution === "resolved" ? outcome.range || null : null;
  if (!range) range = mapRenderedQuoteToSource(source, quote);
  if (!range) {
    showToast("预览选区无法唯一定位到源码；请切换到编辑模式选择范围后添加批注。", true);
    return;
  }
  const anchor = buildAnchor(source, range);
  openComposerForContext({ quote, scopeHint: "预览选区（已定位到源码）" }, annotationSubmit("text-range", range, anchor));
  hideAnnotationBubble();
}

function openContextComposer(at?: { x: number; y: number }): void {
  if (!activeNode || activeNode.kind !== "file" || !annotationDocument()) return;
  const handler = getHandlerKind(activeNode);
  if (handler === "text") {
    if (markdownViewMode === "preview" && previewQuote()) {
      openPreviewSelectionComposer();
      return;
    }
    if (selectionTextRange()) {
      openTextSelectionComposer();
      return;
    }
  }
  const target = activeDocumentHandler()?.annotationTarget?.();
  if (target) {
    const submit = target.scope === "cell"
      ? annotationSubmit("cell", target.locator, null)
      : annotationSubmit("page", target.locator, null);
    openComposerForContext({ scopeHint: target.scopeHint }, submit, at);
    return;
  }
  openComposerForContext({ scopeHint: "文件级批注（关联全文）" }, annotationSubmit("general", null, null), at);
}

function openEditComposer(id: string): void {
  const item = annotationsForPanel().find((annotation) => annotation.entry.id === id);
  if (!item) return;
  const instance = ensureComposer();
  instance.setOptions({
    onSubmit: async (text, tags) => {
      const persisted = await commitAnnotationChange(() => updateAnnotationText(id, text, tags));
      if (persisted) showToast("已更新批注");
      instance.close();
    },
  });
  instance.openAt({ quote: item.entry.anchor?.quote, scopeHint: `编辑批注 · ${annotationPositionLabel(item.entry, item.range)}`, tags: item.entry.tags, text: item.entry.text });
}

async function toggleAnnotationStatus(id: string): Promise<void> {
  const item = annotationsForPanel().find((annotation) => annotation.entry.id === id);
  if (!item) return;
  const next = item.entry.status === "resolved" ? "open" : "resolved";
  const persisted = await commitAnnotationChange(() => setAnnotationStatus(id, next));
  if (persisted) showToast(next === "resolved" ? "已标记为解决" : "已重新打开");
}

async function deleteAnnotation(id: string): Promise<void> {
  if (!window.confirm("删除这条批注？")) return;
  if (activeAnnotationId === id) activeAnnotationId = null;
  const persisted = await commitAnnotationChange(() => removeAnnotation(id));
  if (persisted) showToast("已删除批注");
}

function focusAnnotationTarget(item: ResolvedAnnotation): void {
  const { entry, resolution, range } = item;
  if (entry.scope === "text-range") {
    if (!activeNode || getHandlerKind(activeNode) !== "text" || !textEditor) return;
    if (isMarkdownNode(activeNode) && markdownViewMode !== "edit") setMarkdownViewMode("edit");
    if (resolution !== "resolved" || !range || range.end <= range.start) {
      showToast(resolution === "ambiguous" ? "有多处相似内容，定位不确定，请人工确认原文。" : "原位置已无法定位，批注内容仍会保留。", true);
      return;
    }
    textEditor.selectRange(range);
    return;
  }
  const locator = entry.locator;
  if (!locator) return;
  if (entry.scope === "page" || entry.scope === "cell") {
    const { sheet, cell, page } = locator as { sheet?: string; cell?: string; page?: number };
    activeDocumentHandler()?.locate?.({ sheet, cell, page });
  }
}

function activateAnnotation(id: string, options?: { fromMarker?: boolean }): void {
  activeAnnotationId = id;
  if (options?.fromMarker) {
    workareaElement.classList.add("notes-open");
    notesPanelElement.classList.remove("hidden");
  }
  const item = annotationsForPanel().find((annotation) => annotation.entry.id === id);
  if (item) focusAnnotationTarget(item);
  renderAnnotationUi();
}

function currentSourceForAnnotations(): string {
  if (!activeNode || activeNode.kind !== "file" || getHandlerKind(activeNode) !== "text") return "";
  return textEditor ? textEditor.getText() : activeNode.content || "";
}

async function loadAnnotationsForNode(node: TreeNode): Promise<void> {
  activeAnnotationId = null;
  annotationLoading = true;
  recoverNotesButton.classList.add("hidden");
  renderAnnotationUi();
  if (!config.annotations.enabled || !hasTauriRuntime()) {
    annotationLoading = false;
    renderAnnotationUi();
    return;
  }
  setActiveSourcePath(node.path);
  try {
    await loadAnnotationDocument(node.path, currentSourceForAnnotations());
  } catch (error) {
    annotationLoading = false;
    if (activeNode?.id !== node.id) return;
    if (annotationDamaged()) recoverNotesButton.classList.remove("hidden");
    renderAnnotationUi();
    showToast(failureMessage(error), true);
    return;
  }
  if (activeNode?.id !== node.id) return;
  annotationLoading = false;
  renderAnnotationUi();
  updateHeader();
  if (annotationStale()) {
    const summary = resolutionSummary();
    const parts = [`原文件已变化：✓ ${summary.relocated} 条已重新定位`];
    if (summary.ambiguous > 0) parts.push(`⚠ ${summary.ambiguous} 条定位不确定`);
    if (summary.orphaned > 0) parts.push(`⚠ ${summary.orphaned} 条无法定位`);
    showToast(parts.join(" · "));
  }
}

async function recoverNotes(): Promise<void> {
  if (!activeNode || activeNode.kind !== "file" || !hasTauriRuntime()) return;
  try {
    setActiveSourcePath(activeNode.path);
    await recoverAnnotationDocument(activeNode.path);
    recoverNotesButton.classList.add("hidden");
    renderAnnotationUi();
    updateHeader();
    showToast("损坏 qnote 已备份，并已创建新的批注文件。");
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function toggleNotes(): void {
  if (notesButton.disabled) return;
  const open = !workareaElement.classList.contains("notes-open");
  if (open) renderAnnotationUi();
  workareaElement.classList.toggle("notes-open", open);
  notesPanelElement.classList.toggle("hidden", !open);
}

async function openNode(node: TreeNode, options?: { preferEdit?: boolean; forceText?: boolean }): Promise<void> {
  if (options?.forceText) node.forceText = true;
  void disposeActiveHandler();
  closeFindBar();
  closeComposer();
  activeNode = node;
  activeSession = null;
  resetLargeText();
  markdownViewMode = isMarkdownNode(node) ? (options?.preferEdit ? "edit" : "preview") : "edit";
  setMarkdownBarEnabled(isPreviewableNode(node));
  markdownContentRevision = 0;
  markdownPreviewRevision = -1;
  markdownPreviewHtml = "";
  htmlPreviewRevision = -1;
  resetAnnotations();
  activeAnnotationId = null;
  notesTagFilter = null;
  updateHeader();
  renderAnnotationUi();
  if (node.kind === "file" && getHandlerKind(node) !== "text") void loadAnnotationsForNode(node);
  showView("loading");
  renderTree();
  if (node.kind === "file" && hasHandler(node.extension)) {
    try {
      if (await openWithHandler(node, config, handlerBridge)) {
        updateHeader();
        renderTree();
        return;
      }
    } catch (error) {
      statusModeElement.textContent = "加载失败";
      statusInfoElement.textContent = commandFailure(error).code || "HANDLER_ERROR";
      showFileInfoView(node, "load-error", "⚠ 无法解析该文件", { retry: true });
      updateHeader();
      showToast(failureMessage(error), true);
      return;
    }
  }
  const handler = getHandlerKind(node);
  if (handler !== "text") {
    statusModeElement.textContent = "只读预览";
    statusInfoElement.textContent = "处理器待接入";
    showFileInfoView(node, "unsupported", "当前版本暂不支持预览", { openAsText: node.extension.toLowerCase() !== ".exe" });
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
    const editor = ensureEditor();
    editor.setReadonly(false);
    editor.loadText(documentModel.content);
    editorFileLabelElement.textContent = `${node.name} · 文本编辑`;
    editorEncodingElement.textContent = documentModel.encoding.toUpperCase();
    if (isMarkdownNode(node)) {
      setMarkdownViewMode(options?.preferEdit ? "edit" : "preview");
    } else {
      statusModeElement.textContent = "文本编辑";
      updateTextStatus();
      showView("text");
    }
    updateHeader();
    renderTree();
    if (node.kind === "file") void loadAnnotationsForNode(node);
  } catch (error) {
    if (activeNode?.id !== node.id) return;
    const failure = commandFailure(error);
    statusModeElement.textContent = "加载失败";
    statusInfoElement.textContent = failure.code || "FILE_ERROR";
    if (failure.code === "TEXT_TOO_LARGE") {
      updateHeader();
      await openLargeText(node, false);
      return;
    }
    showFileInfoView(node, "load-error", "⚠ 无法解析该文件", { retry: true });
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
    const line = textEditor ? textEditor.lineOf(textEditor.selectionAnchor()) : 1;
    statusCursorElement.textContent = markdownViewMode === "preview" ? "预览模式" : `第 ${line} 行`;
    return;
  }
  // 表格/分页视图自己知道当前定位在哪。
  statusCursorElement.textContent = activeDocumentHandler()?.cursorLabel?.() ?? "—";
}

function updateTextStatus(): void {
  const lineCount = textEditor ? textEditor.lineCount() : 0;
  statusInfoElement.textContent = `${lineCount} 行 · ${activeNode?.dirty ? "未保存" : "已保存"}`;
  updateCursorStatus();
}

function findSupported(): boolean {
  return Boolean(activeNode && activeSession && getHandlerKind(activeNode) === "text");
}

// —— 大文本：分批只读加载（§14.2）。首块立即出内容，接近底部再取下一块。 ——
interface LargeTextSession {
  path: string;
  encoding: string;
  nextOffset: number;
  size: number;
  loading: boolean;
  task: number;
}

let largeText: LargeTextSession | null = null;
let largeTextTask = 0;

function editableLimitBytes(): number {
  return Math.max(1, config.editor.maxTextFileSizeMb) * 1024 * 1024;
}

function updateLargeTextStatus(): void {
  const session = largeText;
  if (!session) return;
  const loaded = Math.min(session.nextOffset, session.size);
  const percent = session.size > 0 ? Math.floor((loaded / session.size) * 100) : 100;
  statusInfoElement.textContent = `只读分批 · 已加载 ${formatBytes(loaded)} / ${formatBytes(session.size)}（${percent}%）`;
  const bar = editorFileLabelElement.querySelector<HTMLElement>(".large-text-more");
  if (loaded < session.size) {
    if (bar) bar.textContent = `继续加载（已 ${percent}%）`;
    else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "large-text-more";
      button.textContent = `继续加载（已 ${percent}%）`;
      button.addEventListener("click", () => void loadNextTextChunk());
      editorFileLabelElement.append(button);
    }
  } else {
    bar?.remove();
  }
}

async function loadNextTextChunk(): Promise<void> {
  const session = largeText;
  const node = activeNode;
  if (!session || !node || session.loading || session.nextOffset >= session.size) return;
  session.loading = true;
  statusInfoElement.textContent = "正在加载后续内容…";
  try {
    const chunk = await invoke<TextChunk>("read_text_chunk", {
      path: session.path,
      offset: session.nextOffset,
      length: TEXT_CHUNK_BYTES,
      encoding: session.encoding,
    });
    // 切走之后旧任务的结果必须作废，不能追加到新文档上。
    if (largeText !== session || session.task !== largeTextTask || activeNode?.id !== node.id) return;
    textEditor?.appendChunk(chunk.content);
    session.nextOffset = chunk.nextOffset;
    updateLargeTextStatus();
  } catch (error) {
    if (largeText === session) statusInfoElement.textContent = "后续内容加载失败，可重试或滚动到本段底部。";
    showToast(failureMessage(error), true);
  } finally {
    if (largeText === session) session.loading = false;
  }
}

function bindLargeTextScroll(): void {
  const scroller = textEditor?.view.scrollDOM;
  if (!scroller) return;
  scroller.onscroll = () => {
    if (!largeText || largeText.nextOffset >= largeText.size) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distance < 1200) void loadNextTextChunk();
  };
}

async function openLargeText(node: TreeNode, forced: boolean): Promise<void> {
  const decision = decideOpenMode(node.size, editableLimitBytes());
  if (decision.mode === "external" && !forced) {
    showFileInfoView(node, "too-large", decision.reason, { loadLarge: true });
    return;
  }
  showView("loading");
  try {
    const chunk = await invoke<TextChunk>("read_text_chunk", {
      path: node.path,
      offset: 0,
      length: TEXT_CHUNK_BYTES,
      encoding: null,
    });
    if (activeNode?.id !== node.id) return;
    largeTextTask += 1;
    largeText = {
      path: chunk.path,
      encoding: chunk.encoding,
      nextOffset: chunk.nextOffset,
      size: chunk.size,
      loading: false,
      task: largeTextTask,
    };
    activeSession = {
      path: chunk.path,
      encoding: chunk.encoding,
      size: chunk.size,
      modifiedTime: chunk.modifiedTime,
    };
    const editor = ensureEditor();
    editor.setReadonly(true);
    editor.loadText(chunk.content);
    node.size = chunk.size;
    node.modifiedTime = chunk.modifiedTime;
    node.encoding = chunk.encoding;
    node.dirty = false;
    editorFileLabelElement.textContent = `${node.name} · 大文本只读`;
    editorEncodingElement.textContent = chunk.encoding.toUpperCase();
    bindLargeTextScroll();
    statusModeElement.textContent = "大文本只读";
    updateLargeTextStatus();
    showView("text");
    updateHeader();
    renderTree();
  } catch (error) {
    if (activeNode?.id !== node.id) return;
    const failure = commandFailure(error);
    statusModeElement.textContent = "加载失败";
    statusInfoElement.textContent = failure.code || "CHUNK_ERROR";
    showFileInfoView(node, "load-error", "⚠ 无法分批读取该文件", { retry: true });
    updateHeader();
    showToast(failureMessage(error), true);
  }
}

function resetLargeText(): void {
  largeText = null;
  largeTextTask += 1;
  const scroller = textEditor?.view.scrollDOM;
  if (scroller) scroller.onscroll = null;
}

function updateFindHighlights(): void {
  if (!textEditor) return;
  const active = findMatches[findMatchIndex];
  textEditor.view.dispatch({
    effects: setFindHighlights.of(findMatches.map((match) => ({
      start: match.start,
      end: match.end,
      active: Boolean(active && match.start === active.start && match.end === active.end),
    }))),
  });
}

function refreshFindMatches(): void {
  findMatches = [];
  findMatchIndex = -1;
  findMatchesCapped = false;
  const query = findInputElement.value;
  if (!findSupported() || !textEditor || !query) {
    findStatusElement.textContent = query ? "无匹配" : "";
    updateFindHighlights();
    return;
  }
  findMatches = collectTextMatches(textEditor.getText(), query, findCaseInput.checked);
  findMatchesCapped = findMatches.length >= MAX_FIND_MATCHES;
  findStatusElement.textContent = findMatches.length
    ? (findMatchesCapped ? `${MAX_FIND_MATCHES}+ 个匹配` : `${findMatches.length} 个匹配`)
    : "无匹配";
  updateFindHighlights();
}

function selectFindMatch(index: number): void {
  if (findMatches.length === 0 || !textEditor) return;
  findMatchIndex = (index + findMatches.length) % findMatches.length;
  const match = findMatches[findMatchIndex];
  textEditor.selectRange(match);
  findStatusElement.textContent = `${findMatchIndex + 1} / ${findMatches.length}`;
  updateFindHighlights();
}

function findNextMatch(direction: 1 | -1): void {
  refreshFindMatches();
  if (findMatches.length === 0 || !textEditor) return;
  const cursor = textEditor.selectionRange().start;
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
  if (activeDocumentHandler()?.focusSearch?.()) return;
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
  findMatchesCapped = false;
  updateFindHighlights();
}

function replaceCurrentMatch(): void {
  if (!findSupported() || !textEditor) return;
  const editor = textEditor;
  const query = findInputElement.value;
  const { start, end } = editor.selectionRange();
  const selected = editor.getText().slice(start, end);
  const same = findCaseInput.checked ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
  if (!query || !same) {
    findNextMatch(1);
    return;
  }
  const replacement = replaceInputElement.value;
  editor.replaceRange({ from: start, to: end, insert: replacement });
  editor.selectRange({ start, end: start + replacement.length });
  refreshFindMatches();
  findNextMatch(1);
}

function replaceAllMatches(): void {
  if (!findSupported() || !textEditor) return;
  refreshFindMatches();
  if (findMatches.length === 0) return;
  if (findMatchesCapped) {
    showToast(`匹配超过 ${MAX_FIND_MATCHES} 处，请缩小查询范围后再全部替换。`, true);
    return;
  }
  if (!window.confirm(`确认替换全部 ${findMatches.length} 个匹配？`)) return;
  const replacement = replaceInputElement.value;
  textEditor.replaceRanges(findMatches.map((match) => ({ from: match.start, to: match.end, insert: replacement })));
  refreshFindMatches();
  showToast("已完成全部替换");
}

function markDirty(): void {
  if (!activeNode || !activeSession || !textEditor) return;
  activeNode.dirty = true;
  activeNode.content = textEditor.getText();
  if (isPreviewableNode(activeNode)) {
    markdownContentRevision += 1;
    markdownPreviewRevision = -1;
    htmlPreviewRevision = -1;
  }
  updateTextStatus();
  renderTree();
}

async function saveCurrent(): Promise<void> {
  if (!activeNode) return;
  if (textEditor?.isReadonly) {
    showToast("大文本只读模式不支持保存。", true);
    return;
  }
  // 表格类 Handler（csv/xlsx）自己序列化，保存后统一由这里回写节点状态。
  if (activeDocumentHandler()?.save) {
    statusInfoElement.textContent = "保存中…";
    try {
      const metadata = await saveActiveHandler();
      if (metadata) {
        activeNode.size = metadata.size;
        activeNode.modifiedTime = metadata.modifiedTime;
        activeNode.dirty = false;
        updateHeader();
        renderTree();
        showToast(`已保存 ${activeNode.name}`);
      }
    } catch (error) {
      const failure = commandFailure(error);
      showToast(failure.code === "EXTERNAL_MODIFICATION" ? "文件已被其他程序修改，请重新加载后再保存。" : failure.message || "保存失败。", true);
    }
    return;
  }
  const handler = getHandlerKind(activeNode);
  if (handler !== "text" || !activeSession || !textEditor) return;
  const node = activeNode;
  const session = activeSession;
  const editor = textEditor;
  const content = editor.toFileText();
  statusInfoElement.textContent = "保存中…";
  try {
    const metadata = await invoke<FileMetadata>("save_text_file", {
      path: session.path,
      content,
      encoding: session.encoding,
      expectedSize: session.size,
      expectedModifiedTime: session.modifiedTime,
    });
    if (activeNode?.id !== node.id) return;
    node.size = metadata.size;
    node.modifiedTime = metadata.modifiedTime;
    node.content = content;
    node.dirty = false;
    activeSession = { ...session, size: metadata.size, modifiedTime: metadata.modifiedTime };
    editor.setLastSavedText(content);
    updateTextStatus();
    updateHeader();
    renderTree();
    showToast(`已保存 ${node.name}`);
    try {
      await syncAfterSave(content, currentMarkerRanges(editor.view));
    } catch {
      showToast("文件已保存，但批注位置更新失败。批注文件仍保留旧位置，可稍后重新定位。", true);
    }
  } catch (error) {
    const failure = commandFailure(error);
    if (failure.code === "EXTERNAL_MODIFICATION") {
      showToast("文件已被其他程序修改，请重新加载后再保存。", true);
    } else {
      showToast(failure.message || "保存失败。", true);
    }
  }
}

function promptName(title: string, label: string, hint: string, callback: (name: string) => void, initial = ""): void {
  nameTitleElement.textContent = title;
  nameLabelElement.textContent = label;
  nameHintElement.textContent = hint;
  nameInputElement.value = initial;
  nameCallback = callback;
  nameOverlayElement.classList.remove("hidden");
  window.setTimeout(() => {
    nameInputElement.focus();
    // 改名时默认选中主名（不含最后一段扩展名），直接输入即可替换。
    const dot = nameInputElement.value.lastIndexOf(".");
    const end = dot > 0 ? dot : nameInputElement.value.length;
    nameInputElement.setSelectionRange(0, end);
  }, 0);
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
  maxTextSizeInput.value = String(Math.max(1, config.editor.maxTextFileSizeMb));
  confirmCloseInput.checked = config.editor.confirmBeforeCloseUnsaved;
  annotationEnabledInput.checked = config.annotations.enabled;
  restoreSessionInput.checked = config.workspace.restoreLastSession;
  shellContextMenuInput.checked = config.shell.contextMenu;
  shellOpenWithInput.checked = config.shell.openWith;
  runnersInput.value = config.runners.length > 0 ? JSON.stringify(config.runners, null, 2) : "";
  applyTheme(config.appearance.theme);
  settingsOverlayElement.classList.remove("hidden");
  window.setTimeout(() => textExtensionsInput.focus(), 0);
}

function restoreSettingsDefaults(): void {
  textExtensionsInput.value = fallbackConfig.handlers.text.extensions.join(", ");
  maxTextSizeInput.value = String(fallbackConfig.editor.maxTextFileSizeMb);
  confirmCloseInput.checked = fallbackConfig.editor.confirmBeforeCloseUnsaved;
  annotationEnabledInput.checked = fallbackConfig.annotations.enabled;
  restoreSessionInput.checked = fallbackConfig.workspace.restoreLastSession;
  shellContextMenuInput.checked = fallbackConfig.shell.contextMenu;
  shellOpenWithInput.checked = fallbackConfig.shell.openWith;
  runnersInput.value = "";
  requestTheme(fallbackConfig.appearance.theme);
}

// 取消时回到已保存的主题；保存路径上 config 已先更新，这里只是同一值重复应用。
function closeSettings(): void {
  applyTheme(config.appearance.theme);
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
  const runnersText = runnersInput.value.trim();
  let runners: AppConfig["runners"];
  if (!runnersText) {
    runners = [];
  } else {
    try {
      const parsed = JSON.parse(runnersText);
      if (!Array.isArray(parsed)) throw new Error("运行器配置必须是 JSON 数组。");
      runners = parsed.map((item, index) => {
        if (typeof item?.name !== "string" || !Array.isArray(item.extensions) || typeof item.command !== "string") {
          throw new Error(`第 ${index + 1} 个运行器缺少 name/extensions/command 字段。`);
        }
        const shell = item.shell === "cmd" ? "cmd" : "powershell";
        return {
          name: item.name,
          extensions: item.extensions.map((extension: unknown) => String(extension).toLowerCase()),
          shell,
          command: item.command,
          args: Array.isArray(item.args) ? item.args.map((arg: unknown) => String(arg)) : [],
        } as AppConfig["runners"][number];
      });
    } catch (error) {
      showToast(`运行器配置无效：${failureMessage(error)}`, true);
      return;
    }
  }
  if (!hasTauriRuntime()) {
    showToast("浏览器预览不能写入配置，请使用 QuickEdit 桌面运行。", true);
    return;
  }

  const nextConfig: AppConfig = {
    ...config,
    editor: {
      ...config.editor,
      maxTextFileSizeMb: maxSize,
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
      theme: pendingTheme,
    },
    runners,
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
    await openNode(documentNode, { preferEdit: true });
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
    node.name,
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
    node.createdTime = metadata.createdTime;
    if (activeSession) {
      activeSession = { ...activeSession, path: replacePathPrefix(activeSession.path, oldPath, metadata.path) };
    }
    renderTree();
    updateHeader();
    if (activeNode?.kind === "file" && containsNode(node, activeNode)) void loadAnnotationsForNode(activeNode);
    void saveWorkspaceState();
    showToast(`已重命名为 ${metadata.name}`);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}

function workspaceRootFor(target: TreeNode, workspace: TreeNode): TreeNode | null {
  if (workspace.kind !== "workspace") return null;
  return workspace.id === target.id || containsNode(workspace, target) ? workspace : null;
}

function isDocumentsNode(target: TreeNode | null): boolean {
  return Boolean(target && (target.id === docsSection.id || containsNode(docsSection, target)));
}

function terminalTarget(): TreeNode {
  return activeNode || roots.find((node) => node.kind === "workspace") || docsSection;
}

function scopePath(path: string | undefined): string {
  return path?.trim().toLowerCase() || "default";
}

async function terminalContextFor(target: TreeNode | null): Promise<TerminalContext> {
  const effectiveTarget = target || terminalTarget();
  if (isDocumentsNode(effectiveTarget)) {
    const cwd = hasTauriRuntime() ? await invoke<string>("get_documents_directory") : undefined;
    return { cwd, scopeKey: `documents:${scopePath(cwd)}`, scopeLabel: "文档 / quickedit" };
  }
  const workspace = roots
    .map((root) => workspaceRootFor(effectiveTarget, root))
    .find((root): root is TreeNode => root !== null);
  if (workspace) {
    return { cwd: workspace.path, scopeKey: `workspace:${scopePath(workspace.path)}`, scopeLabel: workspace.name };
  }
  return { cwd: undefined, scopeKey: "default", scopeLabel: "默认目录" };
}

const terminalFeature = createTerminalFeature({ contextFor: terminalContextFor });
const reviewPanel = createReviewPanel();


function containsNode(parent: TreeNode, target: TreeNode): boolean {
  if (parent.id === target.id) return true;
  return parent.children.some((child) => containsNode(child, target));
}

function removeNode(node: TreeNode): void {
  const removeFrom = (container: TreeNode): boolean => {
    const index = container.children.findIndex((child) => child.id === node.id);
    if (index >= 0) {
      container.children.splice(index, 1);
      return true;
    }
    return container.children.some((child) => removeFrom(child));
  };
  if (!window.confirm(`仅从 QuickEdit 列表移除“${node.name}”？\n磁盘文件和未来的 .qnote 不会被删除。`)) return;
  if (!removeFrom({ children: roots } as TreeNode)) return;
  if (activeNode && containsNode(node, activeNode)) {
    activeNode = null;
    activeSession = null;
    resetLargeText();
    resetAnnotations();
    activeAnnotationId = null;
    notesTagFilter = null;
    closeComposer();
    hideAnnotationBubble();
    workareaElement.classList.remove("notes-open");
    notesPanelElement.classList.add("hidden");
    renderAnnotationUi();
    showView("empty");
    updateHeader();
  }
  renderTree();
  void saveWorkspaceState();
  showToast(`已移除 ${node.name}（磁盘文件未删除）`);
}

function findLoadedNode(path: string): TreeNode | null {
  const search = (node: TreeNode): TreeNode | null => {
    if (node.kind !== "docs" && node.path && samePath(node.path, path)) return node;
    for (const child of node.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = search(root);
    if (found) return found;
  }
  return null;
}

async function scrollTreeToNode(node: TreeNode): Promise<void> {
  const chain: TreeNode[] = [];
  const walk = (parent: TreeNode): boolean => {
    chain.push(parent);
    if (parent.id === node.id) return true;
    for (const child of parent.children) if (walk(child)) return true;
    chain.pop();
    return false;
  };
  for (const root of roots) if (walk(root)) break;
  for (const ancestor of chain.slice(0, -1)) {
    if (!ancestor.expanded) {
      ancestor.expanded = true;
      await loadChildren(ancestor);
    }
  }
  renderTree();
  treeElement.querySelector<HTMLElement>(".tree-row.active")?.scrollIntoView({ block: "nearest" });
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
      const existing = findLoadedNode(metadata.path);
      if (existing) {
        lastAdded = existing;
        continue;
      }
      const node = createFileNode(metadata);
      docsSection.children.push(node);
      lastAdded = node;
      added += 1;
    }
    docsSection.expanded = true;
    renderTree();
    void saveWorkspaceState();
    if (lastAdded) {
      if (activeNode?.id !== lastAdded.id) await openNode(lastAdded);
      await scrollTreeToNode(lastAdded);
    }
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
           workspace.size = metadata.size;
           workspace.modifiedTime = metadata.modifiedTime;
           workspace.createdTime = metadata.createdTime;
    workspace.size = metadata.size;
    workspace.modifiedTime = metadata.modifiedTime;
    workspace.createdTime = metadata.createdTime;
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
      try {
         const metadata = await invoke<FileMetadata>("get_file_metadata", { path: reference.path });
         if (!metadata.isDirectory) continue;
         workspace.size = metadata.size;
         workspace.modifiedTime = metadata.modifiedTime;
         workspace.createdTime = metadata.createdTime;
       } catch {
         /* 恢复索引中的目录可能已被移动，选中时再次刷新。 */
       }
       workspace.expanded = reference.expanded;
      roots.push(workspace);
      if (workspace.expanded) await loadChildren(workspace);
    }
  } catch (error) {
    runtimeHintElement.textContent = `工作区索引未恢复：${failureMessage(error)}`;
  }
}

const SIDEBAR_WIDTH_KEY = "quickedit.sidebarWidth";
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 560;

function clampSidebarWidth(width: number): number {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.45)));
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), max);
}

function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

// 双击分隔条：清掉记忆值，回到样式表默认宽度。
function resetSidebarWidth(): void {
  window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  document.documentElement.style.removeProperty("--sidebar-width");
  terminalFeature.fit();
}

function bindSidebarResize(): void {
  const stored = Number.parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
  if (Number.isFinite(stored)) applySidebarWidth(clampSidebarWidth(stored));
  let pointerX = 0;
  let startWidth = 0;
  let draggedWidth = 0;
  const onMove = (event: MouseEvent): void => {
    draggedWidth = clampSidebarWidth(startWidth + event.clientX - pointerX);
    applySidebarWidth(draggedWidth);
  };
  const onUp = (): void => {
    sidebarResizerElement.classList.remove("dragging");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (draggedWidth) window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(draggedWidth));
    terminalFeature.fit();
  };
  sidebarResizerElement.addEventListener("mousedown", (event) => {
    event.preventDefault();
    pointerX = event.clientX;
    startWidth = sidebarResizerElement.parentElement?.getBoundingClientRect().width || 0;
    draggedWidth = 0;
    sidebarResizerElement.classList.add("dragging");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  sidebarResizerElement.addEventListener("dblclick", resetSidebarWidth);
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
  markdownEditButton.addEventListener("click", () => { setMarkdownViewMode("edit"); updateAnnotationBubble(); });
  markdownPreviewButton.addEventListener("click", () => { setMarkdownViewMode("preview"); updateAnnotationBubble(); });
  toastCloseButton.addEventListener("click", hideToast);
  notesButton.addEventListener("click", toggleNotes);
  docRunButton.addEventListener("click", () => void runActiveDocument());
  closeNotesButton.addEventListener("click", () => {
    workareaElement.classList.remove("notes-open");
    notesPanelElement.classList.add("hidden");
  });
  addGeneralNoteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const rect = addGeneralNoteButton.getBoundingClientRect();
    openComposerForContext({ scopeHint: "文件级批注（关联全文）" }, annotationSubmit("general", null, null), { x: rect.left, y: rect.bottom });
  });
  recoverNotesButton.addEventListener("click", () => void recoverNotes());
  noteFilterAllButton.addEventListener("click", () => { notesFilter = "all"; renderAnnotationUi(); });
  noteFilterOpenButton.addEventListener("click", () => { notesFilter = "open"; renderAnnotationUi(); });
  noteTagFilterClearButton.addEventListener("click", () => { notesTagFilter = null; renderAnnotationUi(); });
  markdownPreviewElement.addEventListener("click", (event) => {
    const highlight = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".md-annotation-hl") : null;
    if (!highlight?.dataset.annotationId) return;
    activateAnnotation(highlight.dataset.annotationId, { fromMarker: true });
  });
  annotationBubbleElement.addEventListener("mousedown", (event) => event.preventDefault());
  annotationBubbleElement.addEventListener("click", () => openContextComposer());
  contentElement.addEventListener("contextmenu", (event) => {
    if (!annotationDocument() || !config.annotations.enabled) return;
    showMenu([{ label: "＋ 添加批注", action: () => openContextComposer({ x: event.clientX, y: event.clientY }) }], event.clientX, event.clientY);
  });
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
  document.addEventListener("selectionchange", () => {
    scheduleAnnotationBubble();
  });
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
      closeComposer();
    }
    if (event.ctrlKey && event.altKey && event.code === "KeyM") {
      event.preventDefault();
      openContextComposer();
      return;
    }
    if (event.ctrlKey && (event.code === "Backquote" || event.key === "`")) {
      event.preventDefault();
      void terminalFeature.toggle();
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
    if (event.key === "F5") {
      event.preventDefault();
      void reloadNode(activeNode || roots.find((node) => node.kind === "workspace") || docsSection);
      return;
    }
    if (event.altKey && !event.ctrlKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      stepDocument(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrent();
    }
  });
  window.addEventListener("resize", () => {
    hideMenu();
    terminalFeature.fit();
  });
  terminalFeature.bindEvents();
  bindSidebarResize();
  reviewPanel.bind();
}

async function openPaths(paths: string[]): Promise<void> {
  let added = 0;
  let lastAdded: TreeNode | null = null;
  for (const path of paths) {
    try {
      const metadata = await invoke<FileMetadata>("get_file_metadata", { path });
      if (metadata.isDirectory) {
        const existing = roots.find((node) => node.kind === "workspace" && samePath(node.path, metadata.path));
        if (existing) {
          lastAdded = existing;
        } else {
          const workspace = createContainer("workspace", metadata.name || basename(metadata.path), metadata.path);
           workspace.size = metadata.size;
           workspace.modifiedTime = metadata.modifiedTime;
           workspace.createdTime = metadata.createdTime;
          roots.push(workspace);
          lastAdded = workspace;
          added += 1;
        }
      } else if (!metadata.name.toLowerCase().endsWith(config.annotations.extension.toLowerCase())) {
        const existing = findLoadedNode(metadata.path);
        if (existing) {
          lastAdded = existing;
        } else {
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
    showToast(`已打开 ${added} 个文件/工作区`);
  }
  if (lastAdded) {
    if (lastAdded.kind === "file") {
      if (activeNode?.id !== lastAdded.id) await openNode(lastAdded);
    } else {
      selectContainer(lastAdded);
    }
    await scrollTreeToNode(lastAdded);
  }
}

async function bringWindowToFront(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.unminimize();
    await appWindow.show();
    await appWindow.setAlwaysOnTop(true);
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await appWindow.setAlwaysOnTop(false);
    await appWindow.setFocus();
  } catch {
    /* 唤起失败不阻塞打开流程 */
  }
}

async function initialize(): Promise<void> {
  bindEvents();
  registerFormatHandlers();
  // Agent 通过本地审阅接口写入修改轮次，这里轮询+聚焦刷新，保证用户看得见。
  void reviewPanel.refresh();
  window.setInterval(() => void reviewPanel.refresh(), 20000);
  window.addEventListener("focus", () => void reviewPanel.refresh());
  onAnnotationsChanged(() => {
    renderAnnotationUi();
    activeDocumentHandler()?.refreshMarkers?.();
    if (isMarkdownNode(activeNode) && markdownViewMode === "preview") renderMarkdownPreview();
  });
  renderAnnotationUi();
  if (!hasTauriRuntime()) {
    runtimeHintElement.textContent = "浏览器预览：请使用 QuickEdit 桌面运行文件操作";
    renderTree();
    return;
  }
  try {
    config = await invoke<AppConfig>("load_config");
    applyTheme(config.appearance.theme);
    runtimeHintElement.textContent = "本地文件服务已连接 · V2.1";
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
  void listen<string[]>("open-paths", (event) => {
    if (event.payload.length > 0) void openPaths(event.payload);
    void bringWindowToFront();
  });
  void listen<TerminalOutputEvent>("terminal-output", (event) => terminalFeature.handleOutput(event.payload));
  void listen<TerminalExitEvent>("terminal-exit", (event) => terminalFeature.handleExit(event.payload));
}

void initialize();
