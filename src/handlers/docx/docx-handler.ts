import { invoke } from "@tauri-apps/api/core";
import type { DocumentCapabilities, DocumentHandler, HandlerContext } from "../../core/handler-registry";
import { docxContentElement } from "../../ui/elements";
import { showView } from "../../ui/views";

export function createDocxHandler(): DocumentHandler {
  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: true,
  };
  let disposed = false;

  return {
    id: "docx",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      disposed = false;
      const bytes = new Uint8Array(await invoke<number[]>("read_binary_file", { path: node.path }));
      if (disposed) return;
      const mammoth = await import("mammoth/mammoth.browser");
      if (disposed) return;
      const result = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer as ArrayBuffer });
      if (disposed) return;
      node.size = bytes.length;
      docxContentElement.innerHTML = result.value;
      docxContentElement.scrollTop = 0;
      context.bridge.status("DOCX 阅读", "只读");
      showView("docx");
    },
    dispose(): void {
      disposed = true;
      docxContentElement.replaceChildren();
    },
  };
}
