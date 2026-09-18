import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

export type NodeKind = "docs" | "workspace" | "folder" | "file";
export type HandlerKind = "text" | "xlsx" | "pdf" | "docx" | "future";
export type MarkdownViewMode = "edit" | "preview";
export type TreeSortMode = "files-first" | "folders-first" | "name-desc" | "modified-desc";
export type ThemeMode = "light" | "dark";
export type TerminalShell = "powershell" | "cmd";

export interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedTime: number;
  createdTime: number;
  isDirectory: boolean;
}

export interface TreeNode {
  id: string;
  kind: NodeKind;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedTime: number;
  createdTime: number;
  expanded: boolean;
  childrenLoaded: boolean;
  loading: boolean;
  children: TreeNode[];
  dirty: boolean;
  content?: string;
  encoding?: string;
}

export interface TextDocument {
  path: string;
  content: string;
  encoding: string;
  size: number;
  modifiedTime: number;
}

export interface AppConfig {
  version: number;
  editor: {
    maxTextFileSizeMB: number;
    confirmBeforeCloseUnsaved: boolean;
  };
  handlers: {
    text: { enabled: boolean; extensions: string[] };
    spreadsheet: { enabled: boolean; extensions: string[] };
    pdf: { enabled: boolean; extensions: string[] };
    docx: { enabled: boolean; extensions: string[] };
  };
  annotations: {
    enabled: boolean;
    extension: string;
  };
  workspace: {
    restoreLastSession: boolean;
  };
  shell: {
    contextMenu: boolean;
    openWith: boolean;
  };
  appearance: {
    theme: ThemeMode;
  };
}

export interface WorkspaceReference {
  name: string;
  path: string;
  expanded: boolean;
}

export interface WorkspaceState {
  version: number;
  docsFiles: string[];
  workspaces: WorkspaceReference[];
}

export interface TextSession {
  path: string;
  encoding: string;
  size: number;
  modifiedTime: number;
}

export interface BinarySession {
  path: string;
  size: number;
  modifiedTime: number;
  bytes: Uint8Array;
}

export interface TerminalContext {
  cwd?: string;
  scopeKey: string;
  scopeLabel: string;
}

export interface TerminalSession {
  id: string;
  processId: string | null;
  title: string;
  scopeKey: string;
  scopeLabel: string;
  cwd?: string;
  shell: TerminalShell;
  terminal: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement;
  running: boolean;
  spawning: boolean;
  status: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
}

export interface CommandFailure {
  code?: string;
  message?: string;
}

export interface MenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export const fallbackConfig: AppConfig = {
  version: 1,
  editor: {
    maxTextFileSizeMB: 1,
    confirmBeforeCloseUnsaved: true,
  },
  handlers: {
    text: {
      enabled: true,
      extensions: [
        ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".ini", ".log", ".csv",
        ".sql", ".py", ".js", ".ts", ".cs", ".java", ".cpp", ".html", ".css",
      ],
    },
    spreadsheet: { enabled: true, extensions: [".xlsx"] },
    pdf: { enabled: true, extensions: [".pdf"] },
    docx: { enabled: true, extensions: [".docx"] },
  },
  annotations: { enabled: true, extension: ".qnote" },
  workspace: { restoreLastSession: true },
  shell: { contextMenu: true, openWith: true },
  appearance: { theme: "light" },
};
