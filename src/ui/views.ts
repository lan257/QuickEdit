import {
  docxPaneElement, emptyViewElement, excelPaneElement, folderInfoPaneElement, loadingViewElement,
  markdownModeBarElement, markdownPreviewPaneElement, pdfPaneElement, textPaneElement,
} from "./elements";

export type ViewKind = "empty" | "loading" | "folder" | "text" | "markdownPreview" | "xlsx" | "pdf" | "docx" | "image";

let currentView: ViewKind = "empty";
let markdownBarEnabled = false;

// Central view switch shared by the app controller and format handlers.
export function showView(view: ViewKind): void {
  currentView = view;
  emptyViewElement.classList.toggle("hidden", view !== "empty");
  loadingViewElement.classList.toggle("hidden", view !== "loading");
  folderInfoPaneElement.classList.toggle("hidden", view !== "folder");
  textPaneElement.classList.toggle("hidden", view !== "text");
  markdownPreviewPaneElement.classList.toggle("hidden", view !== "markdownPreview");
  excelPaneElement.classList.toggle("hidden", view !== "xlsx");
  pdfPaneElement.classList.toggle("hidden", view !== "pdf");
  docxPaneElement.classList.toggle("hidden", view !== "docx");
  const imagePane = document.getElementById("imagePane");
  if (imagePane) imagePane.classList.toggle("hidden", view !== "image");
  applyMarkdownBar();
}

export function setMarkdownBarEnabled(enabled: boolean): void {
  markdownBarEnabled = enabled;
  applyMarkdownBar();
}

function applyMarkdownBar(): void {
  const visible = (currentView === "text" || currentView === "markdownPreview") && markdownBarEnabled;
  markdownModeBarElement.classList.toggle("hidden", !visible);
}
