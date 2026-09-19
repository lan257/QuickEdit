import { readFileBytes } from "../../core/binary-file";
import type { DocumentCapabilities, DocumentHandler } from "../../core/handler-registry";
import { formatBytes } from "../../core/format";
import { officeBodyElement, statusInfoElement, statusModeElement } from "../../ui/elements";
import { openOfficePane, systemOpenFile } from "../office/office-view";
import { extractEmbeddedText } from "../office/legacy-text";

export function createLegacyOfficeHandler(): DocumentHandler {
  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: false,
  };

  return {
    id: "legacy-office",
    capabilities,
    async open(context): Promise<void> {
      const node = context.node;
      const bytes = await readFileBytes(node.path);
      const text = extractEmbeddedText(bytes);
      if (!text) throw new Error("未能从该文档中抽取到可读文本");
      const body = openOfficePane(
        `${node.name} · ${formatBytes(bytes.length)}`,
        "尽力而为的文字抽取：旧版二进制格式（Word/PowerPoint 97-2003）只能取出正文文字，不保留格式、图片与表格结构，也可能混入少量元数据。完整效果请用 Word / WPS / PowerPoint 打开。",
        () => void systemOpenFile(node.path),
      );
      const view = document.createElement("div");
      view.className = "office-text";
      view.textContent = text;
      body.append(view);
      body.scrollTop = 0;
      node.size = bytes.length;
      statusModeElement.textContent = "文字抽取";
      statusInfoElement.textContent = `${text.length.toLocaleString("zh-CN")} 字符 · 只读`;
    },
    dispose(): void {
      officeBodyElement.replaceChildren();
    },
  };
}
