import { toastElement, toastMessageElement } from "./elements";

let toastTimer = 0;

export function showToast(message: string, isError = false): void {
  toastMessageElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 3000);
}

export function hideToast(): void {
  window.clearTimeout(toastTimer);
  toastElement.classList.add("hidden");
}
