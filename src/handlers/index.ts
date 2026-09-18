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
}
