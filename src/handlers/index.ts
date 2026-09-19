import { registerHandler } from "../core/handler-registry";

// Manifests only hold a lazy loader; the heavy handler module is imported
// on first open, so unused formats never enter the startup path (design doc §3.2).
export function registerFormatHandlers(): void {
  registerHandler({
    id: "image",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"],
    load: async () => (await import("./image/image-handler")).createImageHandler(),
  });
  registerHandler({
    id: "csv",
    extensions: [".csv"],
    load: async () => (await import("./csv/csv-handler")).createCsvHandler(),
  });
  // V1 已有能力迁入 Registry，保持“未打开该格式就不加载重型依赖”。
  registerHandler({
    id: "xlsx",
    extensions: [".xlsx"],
    load: async () => (await import("./xlsx/xlsx-handler")).createXlsxHandler(),
  });
  registerHandler({
    id: "pdf",
    extensions: [".pdf"],
    load: async () => (await import("./pdf/pdf-handler")).createPdfHandler(),
  });
  registerHandler({
    id: "docx",
    extensions: [".docx"],
    load: async () => (await import("./docx/docx-handler")).createDocxHandler(),
  });
  registerHandler({
    id: "pptx",
    extensions: [".pptx"],
    load: async () => (await import("./pptx/pptx-handler")).createPptxHandler(),
  });
  // 旧版二进制 Office 文档：只能抽取正文文字，因此与 OOXML 分开注册。
  registerHandler({
    id: "legacy-office",
    extensions: [".doc", ".ppt"],
    load: async () => (await import("./legacy-office/legacy-office-handler")).createLegacyOfficeHandler(),
  });
}
