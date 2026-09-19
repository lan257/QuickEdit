import { officeBodyElement, officeMetaElement, officeNavElement, officeSystemOpenButton } from "../../ui/elements";
import { failureMessage } from "../../core/format";
import { showToast } from "../../ui/toast";
import { showView } from "../../ui/views";

export function openOfficePane(meta: string, warning: string, onSystemOpen: () => void): HTMLElement {
  officeMetaElement.textContent = meta;
  officeBodyElement.replaceChildren();
  // 翻页控件只有分页格式（pptx）会用，默认藏起来。
  officeNavElement.classList.add("hidden");
  officeBodyElement.onscroll = null;
  const banner = document.createElement("p");
  banner.className = "office-warning";
  banner.textContent = warning;
  officeBodyElement.append(banner);
  officeSystemOpenButton.onclick = onSystemOpen;
  showView("office");
  return officeBodyElement;
}

export async function systemOpenFile(path: string): Promise<void> {
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
  } catch (error) {
    showToast(failureMessage(error), true);
  }
}
