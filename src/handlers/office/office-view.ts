import { officeBodyElement, officeMetaElement, officeSystemOpenButton } from "../../ui/elements";
import { failureMessage } from "../../core/format";
import { showToast } from "../../ui/toast";
import { showView } from "../../ui/views";

export function openOfficePane(meta: string, warning: string, onSystemOpen: () => void): HTMLElement {
  officeMetaElement.textContent = meta;
  officeBodyElement.replaceChildren();
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
