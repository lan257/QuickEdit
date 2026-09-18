import type { MenuItem } from "../core/types";
import { menuElement } from "./elements";

export function hideMenu(): void {
  menuElement.classList.add("hidden");
}

export function showMenu(items: MenuItem[], x: number, y: number): void {
  menuElement.innerHTML = "";
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      menuElement.append(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.disabled = item.disabled ?? false;
    if (item.danger) button.classList.add("danger");
    button.addEventListener("click", () => {
      hideMenu();
      item.action?.();
    });
    menuElement.append(button);
  }
  menuElement.classList.remove("hidden");
  const width = menuElement.offsetWidth;
  const height = menuElement.offsetHeight;
  menuElement.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menuElement.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  window.setTimeout(() => {
    const close = (event: MouseEvent) => {
      if (!menuElement.contains(event.target as Node)) {
        hideMenu();
        document.removeEventListener("click", close, true);
      }
    };
    document.addEventListener("click", close, true);
  }, 0);
}
