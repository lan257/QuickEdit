import type * as PdfJs from "pdfjs-dist";
import { readFileBytes } from "../../core/binary-file";
import type { DocumentCapabilities, DocumentHandler, HandlerBridge, HandlerContext, HandlerLocator } from "../../core/handler-registry";
import { firstAnnotationId, pageAnnotations } from "../../annotations/scope-queries";
import { pdfCanvasWrapElement, pdfPageLabelElement } from "../../ui/elements";
import { showView } from "../../ui/views";

// pdf.js 只在第一次打开 PDF 时进入主线程，Worker 地址同样按需解析。
let pdfjsModule: typeof import("pdfjs-dist") | null = null;

// §14.4 只保留当前页附近若干页的画布，远处释放成高度占位。
const PAGE_WINDOW_RADIUS = 3;

export function createPdfHandler(): DocumentHandler {
  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: true,
    paged: true,
  };
  let pdfDocument: PdfJs.PDFDocumentProxy | null = null;
  let currentPage = 1;
  let observer: IntersectionObserver | null = null;
  let bridge: HandlerBridge | null = null;
  let disposed = false;
  const hosts = new Map<number, HTMLElement>();
  const rendering = new Set<number>();

  const updateLabel = (): void => {
    if (!pdfDocument) return;
    pdfPageLabelElement.textContent = `PDF 连续阅读 · 第 ${currentPage} / ${pdfDocument.numPages} 页`;
    bridge?.refreshCursor();
  };

  const onScroll = (): void => {
    if (!pdfDocument || hosts.size === 0) return;
    const center = pdfCanvasWrapElement.getBoundingClientRect().top + pdfCanvasWrapElement.clientHeight / 2;
    let nearest = currentPage;
    let distance = Number.POSITIVE_INFINITY;
    for (const [pageNumber, host] of hosts) {
      const rect = host.getBoundingClientRect();
      const nextDistance = Math.abs(rect.top + rect.height / 2 - center);
      if (nextDistance < distance) {
        nearest = pageNumber;
        distance = nextDistance;
      }
    }
    if (nearest !== currentPage) {
      currentPage = nearest;
      updateLabel();
    }
    applyPageWindow();
  };

  const attachMarker = (pageNumber: number, host: HTMLElement): void => {
    const items = pageAnnotations(pageNumber);
    const existing = host.querySelector<HTMLElement>(".pdf-page-marker");
    if (items.length === 0) {
      existing?.remove();
      return;
    }
    const badge = existing ?? (() => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "pdf-page-marker";
      element.addEventListener("click", () => {
        const id = firstAnnotationId(pageAnnotations(pageNumber));
        if (id) bridge?.revealAnnotation(id);
      });
      host.append(element);
      return element;
    })();
    badge.textContent = `●${items.length}`;
    badge.title = `第 ${pageNumber} 页 · ${items.length} 条批注`;
  };

  const renderPage = async (pageNumber: number, host: HTMLElement): Promise<void> => {
    if (!pdfDocument || rendering.has(pageNumber) || host.dataset.rendered === "true") return;
    rendering.add(pageNumber);
    try {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建 PDF canvas 上下文。");
      host.style.minHeight = `${viewport.height + 22}px`;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      if (disposed) return;
      const label = document.createElement("div");
      label.className = "pdf-page-label";
      label.textContent = `第 ${pageNumber} 页`;
      host.replaceChildren(label, canvas);
      host.dataset.rendered = "true";
      attachMarker(pageNumber, host);
    } finally {
      rendering.delete(pageNumber);
    }
  };

  // 当前页附近补齐渲染，远处释放画布只留高度占位，避免长 PDF 堆满位图内存。
  const applyPageWindow = (): void => {
    for (const [pageNumber, host] of hosts) {
      if (Math.abs(pageNumber - currentPage) <= PAGE_WINDOW_RADIUS) {
        if (host.dataset.rendered !== "true") void renderPage(pageNumber, host);
        continue;
      }
      const canvas = host.querySelector("canvas");
      if (!canvas) continue;
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      host.dataset.rendered = "";
    }
  };

  const renderContinuous = async (): Promise<void> => {
    if (!pdfDocument) return;
    observer?.disconnect();
    observer = null;
    hosts.clear();
    rendering.clear();
    pdfCanvasWrapElement.replaceChildren();
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const host = document.createElement("section");
      host.className = "pdf-page";
      host.dataset.page = String(pageNumber);
      hosts.set(pageNumber, host);
      pdfCanvasWrapElement.append(host);
    }
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const host = entry.target as HTMLElement;
        void renderPage(Number(host.dataset.page), host);
      }
    }, { root: pdfCanvasWrapElement, rootMargin: "900px 0px" });
    for (const host of hosts.values()) observer.observe(host);
    currentPage = 1;
    updateLabel();
    for (const [pageNumber, host] of hosts) attachMarker(pageNumber, host);
    const first = hosts.get(1);
    if (first) await renderPage(1, first);
  };

  return {
    id: "pdf",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      bridge = context.bridge;
      disposed = false;
      const bytes = await readFileBytes(node.path);
      if (disposed) return;
      pdfjsModule ??= await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjsModule.GlobalWorkerOptions.workerSrc = worker.default;
      if (disposed) return;
      pdfDocument = await pdfjsModule.getDocument({ data: bytes }).promise;
      if (disposed) return;
      node.size = bytes.length;
      pdfCanvasWrapElement.addEventListener("scroll", onScroll, { passive: true });
      await renderContinuous();
      if (disposed) return;
      bridge.status("PDF 阅读", `${pdfDocument.numPages} 页`);
      showView("pdf");
    },
    cursorLabel(): string | null {
      return pdfDocument ? `第 ${currentPage} 页` : null;
    },
    annotationTarget() {
      if (!pdfDocument) return null;
      return { scope: "page" as const, scopeHint: `第 ${currentPage} 页`, locator: { page: currentPage } };
    },
    locate(locator: HandlerLocator): boolean {
      const page = locator.page;
      if (!pdfDocument || !page) return false;
      currentPage = Math.max(1, Math.min(page, pdfDocument.numPages));
      updateLabel();
      const host = hosts.get(currentPage);
      if (!host) return false;
      host.scrollIntoView({ behavior: "smooth", block: "start" });
      void renderPage(currentPage, host);
      return true;
    },
    refreshMarkers(): void {
      for (const [pageNumber, host] of hosts) attachMarker(pageNumber, host);
    },
    dispose(): void {
      disposed = true;
      pdfCanvasWrapElement.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      observer = null;
      hosts.clear();
      rendering.clear();
      pdfCanvasWrapElement.replaceChildren();
      pdfDocument = null;
      currentPage = 1;
    },
  };
}
