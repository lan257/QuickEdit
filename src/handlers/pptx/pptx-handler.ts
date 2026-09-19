import { invoke } from "@tauri-apps/api/core";
import type { DocumentCapabilities, DocumentHandler, HandlerContext } from "../../core/handler-registry";
import { formatBytes } from "../../core/format";
import { readZipEntries } from "../../core/zip-reader";
import { officeBodyElement, statusInfoElement, statusModeElement } from "../../ui/elements";
import { openOfficePane, systemOpenFile } from "../office/office-view";

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXml(value: string): string {
  return value.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] || match;
  });
}

export function slideParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const chunk of xml.split("</a:p>")) {
    const runs = chunk.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
    if (!runs) continue;
    const text = runs
      .map((run) => decodeXml(run.replace(/^<a:t[^>]*>/, "").replace(/<\/a:t>$/, "")))
      .join("")
      .replace(/\r\n?/g, "\n");
    if (text.trim()) paragraphs.push(text);
  }
  return paragraphs;
}

export async function readPptxSlides(bytes: Uint8Array): Promise<Array<{ order: number; paragraphs: string[] }>> {
  const entries = await readZipEntries(bytes, (name) => SLIDE_PATH.test(name));
  const slides = [...entries.entries()]
    .map(([name, data]) => ({ order: Number(SLIDE_PATH.exec(name)?.[1] || 0), paragraphs: slideParagraphs(new TextDecoder("utf-8").decode(data)) }))
    .sort((left, right) => left.order - right.order);
  if (slides.length === 0) throw new Error("未找到幻灯片内容");
  return slides;
}

export function createPptxHandler(): DocumentHandler {
  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: false,
  };

  return {
    id: "pptx",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      const bytes = new Uint8Array(await invoke<number[]>("read_binary_file", { path: node.path }));
      const slides = await readPptxSlides(bytes);
      const body = openOfficePane(
        `${node.name} · ${slides.length} 页 · ${formatBytes(bytes.length)}`,
        "文字抽取视图：按页给出每页文本，不还原版式、配色与图片。需要完整效果请用 PowerPoint / WPS 打开。",
        () => void systemOpenFile(node.path),
      );
      slides.forEach((slide, index) => {
        const card = document.createElement("section");
        card.className = "office-slide";
        const head = document.createElement("div");
        head.className = "office-slide-head";
        head.textContent = `第 ${index + 1} 页`;
        card.append(head);
        const paragraphs = slide.paragraphs.length ? slide.paragraphs : ["（本页没有文本）"];
        for (const paragraph of paragraphs) {
          const line = document.createElement("div");
          line.className = `office-line${slide.paragraphs.length ? "" : " empty"}`;
          line.textContent = paragraph;
          card.append(line);
        }
        body.append(card);
      });
      body.scrollTop = 0;
      node.size = bytes.length;
      statusModeElement.textContent = "PPTX 文字抽取";
      statusInfoElement.textContent = `${slides.length} 页 · 只读`;
    },
    dispose(): void {
      officeBodyElement.replaceChildren();
    },
  };
}
