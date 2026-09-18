export interface ComposerContext {
  quote?: string;
  scopeHint: string;
  tags?: string[];
  text?: string;
}

export interface ComposerOptions {
  onSubmit: (text: string, tags: string[]) => void | Promise<void>;
  onClose?: () => void;
}

export const QUICK_TAGS = ["TODO", "问题", "确认", "重要", "Agent"];

export class AnnotationComposer {
  private readonly root: HTMLDivElement;
  private readonly quoteElement: HTMLDivElement;
  private readonly hintElement: HTMLDivElement;
  private readonly inputElement: HTMLTextAreaElement;
  private readonly addButton: HTMLButtonElement;
  private readonly tagButtons = new Map<string, HTMLButtonElement>();
  private readonly selectedTags = new Set<string>();
  private options: ComposerOptions;
  open = false;

  constructor(parent: HTMLElement, options: ComposerOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "annotation-composer hidden";
    this.quoteElement = document.createElement("div");
    this.quoteElement.className = "composer-quote";
    this.inputElement = document.createElement("textarea");
    this.inputElement.className = "composer-input";
    this.inputElement.placeholder = "输入批注…";
    this.hintElement = document.createElement("div");
    this.hintElement.className = "composer-hint";
    const tagsRow = document.createElement("div");
    tagsRow.className = "composer-tags";
    for (const tag of QUICK_TAGS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "composer-tag";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        if (this.selectedTags.has(tag)) this.selectedTags.delete(tag);
        else this.selectedTags.add(tag);
        chip.classList.toggle("active", this.selectedTags.has(tag));
      });
      tagsRow.append(chip);
      this.tagButtons.set(tag, chip);
    }
    const actions = document.createElement("div");
    actions.className = "composer-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn";
    cancelButton.textContent = "取消";
    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "btn primary";
    this.addButton.textContent = "添加";
    actions.append(this.hintElement, cancelButton, this.addButton);
    this.root.append(this.quoteElement, this.inputElement, tagsRow, actions);
    parent.append(this.root);
    cancelButton.addEventListener("click", () => this.close());
    this.addButton.addEventListener("click", () => void this.submit());
    this.inputElement.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.submit();
      }
    });
  }

  setOptions(options: ComposerOptions): void {
    this.options = options;
  }

  openAt(context: ComposerContext, anchor?: { x: number; y: number }): void {
    this.quoteElement.textContent = context.quote ? `“${context.quote}”` : "";
    this.quoteElement.classList.toggle("hidden", !context.quote);
    this.hintElement.textContent = context.scopeHint;
    this.inputElement.value = context.text || "";
    this.selectedTags.clear();
    for (const tag of context.tags || []) this.selectedTags.add(tag);
    for (const [tag, chip] of this.tagButtons) chip.classList.toggle("active", this.selectedTags.has(tag));
    this.root.classList.remove("hidden");
    this.open = true;
    const host = this.root.parentElement;
    if (host && anchor) {
      const hostRect = host.getBoundingClientRect();
      const width = 300;
      const left = Math.max(8, Math.min(anchor.x - hostRect.left, hostRect.width - width - 12));
      this.root.style.transform = "";
      this.root.style.left = `${left}px`;
      this.root.style.top = `${Math.max(8, anchor.y - hostRect.top + 10)}px`;
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";
    } else if (host) {
      this.root.style.left = "50%";
      this.root.style.top = "64px";
      this.root.style.transform = "translateX(-50%)";
    }
    window.setTimeout(() => {
      this.inputElement.focus();
      if (context.text) this.inputElement.setSelectionRange(context.text.length, context.text.length);
      else this.inputElement.select();
    }, 0);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.root.style.transform = "";
    this.inputElement.value = "";
    this.options.onClose?.();
  }

  private async submit(): Promise<void> {
    const text = this.inputElement.value.trim();
    if (!text) return;
    await this.options.onSubmit(text, [...this.selectedTags]);
    this.inputElement.value = "";
  }
}
