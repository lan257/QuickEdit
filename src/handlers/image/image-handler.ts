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

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const STAGE_PADDING = 48;

export function createImageHandler(): DocumentHandler {
  let objectUrl: string | null = null;
  let observer: ResizeObserver | null = null;
  let scale = 1;
  let rotation = 0;
  let panX = 0;
  let panY = 0;
  let fitted = true;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let disposed = false;
  let pointerId: number | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const capabilities: DocumentCapabilities = {
    editable: false,
    searchable: false,
    replaceable: false,
    annotatable: false,
  };

  // 旋转绕中心进行，占位尺寸要按交换后的宽高算，才能正确夹取平移范围。
  const displayedSize = (): { width: number; height: number } => {
    const swapped = rotation % 180 !== 0;
    return {
      width: (swapped ? naturalHeight : naturalWidth) * scale,
      height: (swapped ? naturalWidth : naturalHeight) * scale,
    };
  };

  const fitScale = (): number => {
    if (!naturalWidth || !naturalHeight) return 1;
    const swapped = rotation % 180 !== 0;
    const boxWidth = swapped ? naturalHeight : naturalWidth;
    const boxHeight = swapped ? naturalWidth : naturalHeight;
    const availableWidth = Math.max(80, imageStageElement.clientWidth - STAGE_PADDING);
    const availableHeight = Math.max(80, imageStageElement.clientHeight - STAGE_PADDING);
    // 与旧版一致：适应窗口只缩小，不放大。
    return Math.min(1, availableWidth / boxWidth, availableHeight / boxHeight);
  };

  const applyTransform = (): void => {
    const parts = [`translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`];
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    imageElement.style.transform = parts.join(" ");
    imageZoomLabelElement.textContent = fitted ? "适应" : `${Math.round(scale * 100)}%`;
  };

  // 放大后允许平移到图像边缘对齐舞台边缘；比舞台小时固定居中，不会被拖出视野。
  const clampPan = (): void => {
    const size = displayedSize();
    const limitX = Math.max(0, (size.width - imageStageElement.clientWidth) / 2);
    const limitY = Math.max(0, (size.height - imageStageElement.clientHeight) / 2);
    panX = Math.min(limitX, Math.max(-limitX, panX));
    panY = Math.min(limitY, Math.max(-limitY, panY));
  };

  const zoomTo = (next: number, clientX?: number, clientY?: number): void => {
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    if (target === scale) return;
    const rect = imageStageElement.getBoundingClientRect();
    const centerOffsetX = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const centerOffsetY = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    // 指针为锚点：t' = (1-k)·(c-C) + k·t，缩放后指针下的图像点不动。
    const ratio = target / scale;
    panX = ratio * panX + (1 - ratio) * centerOffsetX;
    panY = ratio * panY + (1 - ratio) * centerOffsetY;
    scale = target;
    fitted = false;
    clampPan();
    applyTransform();
  };

  const applyFit = (): void => {
    fitted = true;
    panX = 0;
    panY = 0;
    scale = fitScale();
    applyTransform();
  };

  const applyActualSize = (): void => {
    fitted = false;
    panX = 0;
    panY = 0;
    scale = 1;
    applyTransform();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    zoomTo(scale * (event.deltaY < 0 ? 1.12 : 0.89), event.clientX, event.clientY);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    imageStageElement.setPointerCapture(event.pointerId);
    imageStageElement.classList.add("panning");
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    panX += event.clientX - pointerX;
    panY += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    clampPan();
    applyTransform();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null) return;
    pointerId = null;
    if (imageStageElement.hasPointerCapture(event.pointerId)) imageStageElement.releasePointerCapture(event.pointerId);
    imageStageElement.classList.remove("panning");
  };

  const bind = (): void => {
    imageZoomOutButton.onclick = () => zoomTo(scale * 0.8);
    imageZoomInButton.onclick = () => zoomTo(scale * 1.25);
    imageZoomFitButton.onclick = applyFit;
    imageZoom100Button.onclick = applyActualSize;
    imageRotateButton.onclick = () => {
      rotation = (rotation + 90) % 360;
      if (fitted) scale = fitScale();
      clampPan();
      applyTransform();
    };
    imageElement.onload = () => {
      naturalWidth = imageElement.naturalWidth;
      naturalHeight = imageElement.naturalHeight;
      applyFit();
    };
    imageStageElement.onwheel = onWheel;
    imageStageElement.onpointerdown = onPointerDown;
    imageStageElement.onpointermove = onPointerMove;
    imageStageElement.onpointerup = onPointerUp;
    imageStageElement.onpointercancel = onPointerUp;
    imageStageElement.ondblclick = () => {
      if (fitted) applyActualSize(); else applyFit();
    };
    observer?.disconnect();
    observer = new ResizeObserver(() => {
      if (!fitted) return;
      scale = fitScale();
      applyTransform();
    });
    observer.observe(imageStageElement);
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
      panX = 0;
      panY = 0;
      naturalWidth = 0;
      naturalHeight = 0;
      bind();
      fitted = true;
      applyTransform();
      imageElement.src = objectUrl;
      imageFileLabelElement.textContent = `${node.name} · ${formatBytes(node.size)} · 滚轮缩放 / 拖拽平移 / 双击适应`;
      imageSystemOpenButton.onclick = async () => {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(node.path);
      };
      statusModeElement.textContent = "图片预览";
      statusInfoElement.textContent = `${formatBytes(node.size)} · 只读`;
      showView("image");
    },
    dispose(): void {
      disposed = true;
      observer?.disconnect();
      observer = null;
      imageElement.onload = null;
      imageStageElement.onwheel = null;
      imageStageElement.onpointerdown = null;
      imageStageElement.onpointermove = null;
      imageStageElement.onpointerup = null;
      imageStageElement.onpointercancel = null;
      imageStageElement.ondblclick = null;
      imageStageElement.classList.remove("panning");
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      imageElement.removeAttribute("src");
    },
  };
}
