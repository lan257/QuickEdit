import { readFileBytes } from "../../core/binary-file";
import type { DocumentCapabilities, DocumentHandler, HandlerContext } from "../../core/handler-registry";
import { formatBytes } from "../../core/format";
import { showView } from "../../ui/views";
import {
  imageElement, imageFileLabelElement, imageRotateButton, imageStageElement,
  imageSystemOpenButton, imageZoom100Button, imageZoomFitButton, imageZoomInButton, imageZoomLabelElement, imageZoomOutButton,
  statusInfoElement, statusModeElement,
} from "../../ui/elements";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};

function fitMode(): boolean {
  return imageElement.dataset.fit === "true";
}

function applyTransform(scale: number, rotation: number): void {
  imageElement.dataset.scale = String(scale);
  imageElement.dataset.rotation = String(rotation);
  const parts: string[] = [];
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  if (scale !== 1) parts.push(`scale(${scale})`);
  imageElement.style.transform = parts.length ? parts.join(" ") : "";
  imageZoomLabelElement.textContent = fitMode() ? "适应" : `${Math.round(scale * 100)}%`;
}

export function createImageHandler(): DocumentHandler {
  let objectUrl: string | null = null;
  let scale = 1;
  let rotation = 0;
  let disposed = false;

  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: false,
  };

  const setFit = (fit: boolean): void => {
    imageElement.dataset.fit = fit ? "true" : "false";
    imageElement.style.maxWidth = fit ? "100%" : "none";
    imageElement.style.maxHeight = fit ? "100%" : "none";
  };

  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setFit(false);
    scale = Math.min(8, Math.max(0.1, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    applyTransform(scale, rotation);
  };

  const bind = (): void => {
    imageZoomOutButton.onclick = () => { setFit(false); scale = Math.max(0.1, scale * 0.8); applyTransform(scale, rotation); };
    imageZoomInButton.onclick = () => { setFit(false); scale = Math.min(8, scale * 1.25); applyTransform(scale, rotation); };
    imageZoomFitButton.onclick = () => { scale = 1; setFit(true); applyTransform(1, rotation); };
    imageZoom100Button.onclick = () => { scale = 1; setFit(false); applyTransform(1, rotation); };
    imageRotateButton.onclick = () => { rotation = (rotation + 90) % 360; applyTransform(scale, rotation); };
    imageStageElement.onwheel = onWheel;
  };

  return {
    id: "image",
    capabilities,
    async open(context: HandlerContext): Promise<void> {
      const node = context.node;
      disposed = false;
      const bytes = await readFileBytes(node.path);
      if (disposed) return;
      const mime = MIME[node.extension.toLowerCase()] || "application/octet-stream";
      const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      scale = 1;
      rotation = 0;
      setFit(true);
      imageElement.src = objectUrl;
      applyTransform(1, 0);
      imageFileLabelElement.textContent = `${node.name} · ${formatBytes(node.size)}`;
      imageSystemOpenButton.onclick = async () => {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(node.path);
      };
      bind();
      statusModeElement.textContent = "图片预览";
      statusInfoElement.textContent = `${formatBytes(node.size)} · 只读`;
      showView("image");
    },
    dispose(): void {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      imageElement.removeAttribute("src");
      imageStageElement.onwheel = null;
    },
  };
}
