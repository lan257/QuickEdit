import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalContext, TerminalOutputEvent, TerminalExitEvent, TerminalSession, TreeNode } from "../../core/types";
import { basename, failureMessage, hasTauriRuntime } from "../../core/format";
import { showToast } from "../../ui/toast";
import {
  terminalAddButton, terminalCloseButton, terminalHostElement, terminalListElement, terminalPanelElement,
  terminalResizeHandle, terminalRestartButton, terminalShellSelect, terminalStatusElement, terminalTitleElement,
  terminalToggleButton,
} from "../../ui/elements";

const terminalTheme = {
  background: "#fbfcfe",
  foreground: "#222b3a",
  cursor: "#5b6cf9",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(91, 108, 249, 0.22)",
};

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface TerminalFeatureDeps {
  contextFor(target: TreeNode | null): Promise<TerminalContext>;
}

export interface TerminalFeature {
  bindEvents(): void;
  fit(): void;
  openFor(target: TreeNode | null): Promise<void>;
  toggle(force?: boolean): Promise<void>;
  runCommand(target: TreeNode | null, shell: "powershell" | "cmd", command: string, cwd: string): Promise<void>;
  handleOutput(payload: TerminalOutputEvent): void;
  handleExit(payload: TerminalExitEvent): void;
}

export function createTerminalFeature(deps: TerminalFeatureDeps): TerminalFeature {
  let sessions: TerminalSession[] = [];
  let activeId: string | null = null;
  let visible = false;
  let sequence = 0;

  function activeSession(): TerminalSession | null {
    return sessions.find((session) => session.id === activeId) || null;
  }

  function updateHeader(): void {
    const session = activeSession();
    terminalTitleElement.textContent = session ? `${session.title} · ${session.scopeLabel}` : "终端";
    terminalShellSelect.disabled = !session;
    if (session) terminalShellSelect.value = session.shell;
    terminalStatusElement.textContent = session?.status || (session && !session.running ? "已退出" : "");
  }

  function renderList(): void {
    terminalListElement.replaceChildren();
    if (sessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "terminal-list-empty";
      empty.textContent = "暂无终端，点击右上角＋新建。";
      terminalListElement.append(empty);
      updateHeader();
      return;
    }
    for (const session of sessions) {
      const item = document.createElement("div");
      item.className = `terminal-list-item${session.id === activeId ? " active" : ""}`;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      const main = document.createElement("span");
      main.className = "terminal-list-item-main";
      const title = document.createElement("span");
      title.className = "terminal-list-item-title";
      title.textContent = `${session.title}${session.spawning ? " · 正在启动…" : session.running ? "" : " · 已退出"}`;
      const scope = document.createElement("span");
      scope.className = "terminal-list-item-scope";
      scope.textContent = session.scopeLabel;
      main.append(title, scope);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "terminal-list-item-close";
      close.title = "关闭此终端";
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void closeSession(session.id);
      });
      item.append(main, close);
      item.addEventListener("click", () => activate(session.id));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(session.id);
        }
      });
      terminalListElement.append(item);
    }
    updateHeader();
  }

  function setVisible(next: boolean): void {
    visible = next;
    terminalPanelElement.classList.toggle("hidden", !next);
    terminalToggleButton.classList.toggle("active", next);
    if (next) {
      renderList();
      requestAnimationFrame(fit);
    }
  }

  function fit(): void {
    const session = activeSession();
    if (!session || !visible) return;
    try {
      session.fitAddon.fit();
    } catch {
      /* 面板尺寸为 0 时忽略 */
    }
  }

  async function spawn(session: TerminalSession): Promise<void> {
    if (!hasTauriRuntime() || session.spawning || session.running) return;
    session.spawning = true;
    session.status = "正在启动…";
    const processId = `${session.id}-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session.processId = processId;
    renderList();
    try {
      await invoke("terminal_spawn", {
        sessionId: processId,
        cwd: session.cwd,
        shell: session.shell,
        rows: session.terminal.rows,
        cols: session.terminal.cols,
      });
      session.running = true;
      session.status = "";
    } catch (error) {
      session.processId = null;
      session.status = "启动失败";
      showToast(failureMessage(error), true);
    } finally {
      session.spawning = false;
      renderList();
    }
  }

  async function kill(session: TerminalSession): Promise<void> {
    const processId = session.processId;
    if (hasTauriRuntime() && processId && (session.running || session.spawning)) {
      try {
        await invoke("terminal_kill", { sessionId: processId });
      } catch {
        /* 终端已退出时忽略 */
      }
    }
    session.processId = null;
    session.running = false;
    session.spawning = false;
    session.status = "已退出";
  }

  function createSession(context: TerminalContext): TerminalSession {
    sequence += 1;
    const host = document.createElement("div");
    host.className = "terminal-instance-host hidden";
    terminalHostElement.append(host);
    const terminal = new Terminal({
      fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const session: TerminalSession = {
      id: `terminal-${Date.now()}-${sequence}`,
      processId: null,
      title: `终端 ${sequence}`,
      scopeKey: context.scopeKey,
      scopeLabel: context.scopeLabel,
      cwd: context.cwd,
      shell: "powershell",
      terminal,
      fitAddon,
      host,
      running: false,
      spawning: false,
      status: "",
    };
    terminal.onData((data) => {
      const processId = session.processId;
      if (!session.running || !processId) return;
      void invoke("terminal_write", { sessionId: processId, data }).catch((error) => showToast(failureMessage(error), true));
    });
    terminal.onResize(({ rows, cols }) => {
      const processId = session.processId;
      if (!session.running || !processId) return;
      void invoke("terminal_resize", { sessionId: processId, rows, cols }).catch(() => undefined);
    });
    terminal.open(host);
    sessions.push(session);
    renderList();
    return session;
  }

  function activate(id: string): void {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    activeId = id;
    setVisible(true);
    for (const item of sessions) item.host.classList.toggle("hidden", item.id !== id);
    renderList();
    requestAnimationFrame(() => {
      fit();
      session.terminal.focus();
    });
  }

  async function closeSession(id: string): Promise<void> {
    const index = sessions.findIndex((session) => session.id === id);
    if (index < 0) return;
    const session = sessions[index];
    const wasActive = activeId === id;
    await kill(session);
    session.terminal.dispose();
    session.host.remove();
    sessions.splice(index, 1);
    if (wasActive) {
      const next = sessions[index] || sessions[index - 1];
      activeId = next?.id || null;
      if (activeId) {
        activate(activeId);
      } else {
        setVisible(false);
        renderList();
      }
    } else {
      renderList();
    }
  }

  async function openFor(target: TreeNode | null): Promise<void> {
    try {
      const context = await deps.contextFor(target);
      let session = sessions.find((item) => item.scopeKey === context.scopeKey);
      if (!session) session = createSession(context);
      activate(session.id);
      await spawn(session);
      session.terminal.focus();
    } catch (error) {
      showToast(failureMessage(error), true);
    }
  }

  async function addManual(): Promise<void> {
    try {
      const context = await deps.contextFor(null);
      const session = createSession(context);
      activate(session.id);
      await spawn(session);
      session.terminal.focus();
    } catch (error) {
      showToast(failureMessage(error), true);
    }
  }

  async function restart(): Promise<void> {
    const session = activeSession();
    if (!session) return;
    session.terminal.reset();
    await kill(session);
    await spawn(session);
    session.terminal.focus();
  }

  // §3.4/§12: only ever invoked from an explicit user click. 每次运行都新建终端，
  // cwd 固定为脚本自身所在目录：复用旧终端会停在别的工作目录，相对路径必然出错。
  async function runCommand(target: TreeNode | null, shell: "powershell" | "cmd", command: string, cwd: string): Promise<void> {
    try {
      const session = createSession({
        cwd: cwd || undefined,
        scopeKey: `run:${Date.now()}-${sequence}`,
        scopeLabel: cwd ? basename(cwd) : "默认目录",
      });
      if (target?.name) session.title = `运行 ${target.name}`;
      session.shell = shell;
      activate(session.id);
      await spawn(session);
      const processId = session.processId;
      if (!session.running || !processId) return;
      renderList();
      // 新 shell 打印提示符需要时间，立刻写入会被初始化流程吞掉。
      window.setTimeout(() => {
        void invoke("terminal_write", { sessionId: processId, data: `${command}\r` }).catch((error) => showToast(failureMessage(error), true));
      }, 350);
    } catch (error) {
      showToast(failureMessage(error), true);
    }
  }

  function bindResizeDrag(): void {
    let startY = 0;
    let startHeight = 0;
    const onMove = (event: MouseEvent) => {
      const height = Math.min(Math.max(startHeight + (startY - event.clientY), 120), Math.floor(window.innerHeight * 0.75));
      terminalPanelElement.style.height = `${height}px`;
      fit();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      fit();
    };
    terminalResizeHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      startY = event.clientY;
      startHeight = terminalPanelElement.getBoundingClientRect().height;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  function bindEvents(): void {
    terminalToggleButton.addEventListener("click", () => void openFor(null));
    terminalAddButton.addEventListener("click", () => void addManual());
    terminalCloseButton.addEventListener("click", () => void setVisible(false));
    terminalRestartButton.addEventListener("click", () => void restart());
    terminalShellSelect.addEventListener("change", () => {
      const session = activeSession();
      if (!session) return;
      session.shell = terminalShellSelect.value === "cmd" ? "cmd" : "powershell";
      void restart();
    });
    bindResizeDrag();
  }

  async function toggle(force?: boolean): Promise<void> {
    if (force === false || (typeof force !== "boolean" && visible)) {
      setVisible(false);
      return;
    }
    await openFor(null);
  }

  function handleOutput(payload: TerminalOutputEvent): void {
    const session = sessions.find((item) => item.processId === payload.sessionId);
    session?.terminal.write(base64ToBytes(payload.data));
  }

  function handleExit(payload: TerminalExitEvent): void {
    const session = sessions.find((item) => item.processId === payload.sessionId);
    if (!session) return;
    session.processId = null;
    session.running = false;
    session.spawning = false;
    session.status = "已退出";
    session.terminal.write("\r\n\x1b[90m[进程已退出，按 ↻ 或重新打开面板可重启]\x1b[0m\r\n");
    renderList();
  }

  return { bindEvents, fit, openFor, toggle, runCommand, handleOutput, handleExit };
}
