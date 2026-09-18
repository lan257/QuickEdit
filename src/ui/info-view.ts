import { folderInfoPaneElement } from "./elements";

export type InfoViewKind = "folder" | "unsupported" | "executable" | "too-large" | "load-error";

export interface InfoViewMetadataItem {
  label: string;
  value: string;
}

export interface InfoViewAction {
  id: string;
  label: string;
  primary?: boolean;
  execute(): void | Promise<void>;
}

export interface FileInfoModel {
  kind: InfoViewKind;
  badge: string;
  title: string;
  subtitle: string;
  metadata: InfoViewMetadataItem[];
  actions: InfoViewAction[];
}

// Application-level fallback view shared by folders, unsupported files,
// executables, too-large files and load errors (design doc §6).
export function renderInfoView(model: FileInfoModel): void {
  const card = document.createElement("div");
  card.className = "folder-info-card";

  const heading = document.createElement("div");
  heading.className = "folder-info-heading";
  const badge = document.createElement("div");
  badge.className = "folder-info-icon";
  badge.textContent = model.badge;
  const titleBox = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = model.title;
  const subtitle = document.createElement("span");
  subtitle.textContent = model.subtitle;
  titleBox.append(title, subtitle);
  heading.append(badge, titleBox);

  const grid = document.createElement("div");
  grid.className = "folder-info-grid";
  for (const item of model.metadata) {
    const field = document.createElement("div");
    field.className = "folder-info-field";
    if (item.label === "位置") field.classList.add("folder-info-location");
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    value.title = item.value;
    field.append(label, value);
    grid.append(field);
  }

  const actions = document.createElement("div");
  actions.className = "folder-info-actions";
  for (const action of model.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn${action.primary ? " primary" : ""}`;
    button.textContent = action.label;
    button.addEventListener("click", () => void action.execute());
    actions.append(button);
  }

  card.append(heading);
  if (model.metadata.length > 0) card.append(grid);
  if (model.actions.length > 0) card.append(actions);
  folderInfoPaneElement.replaceChildren(card);
}
