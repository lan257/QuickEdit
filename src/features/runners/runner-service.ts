export interface RunnerConfig {
  name: string;
  extensions: string[];
  shell: "powershell" | "cmd";
  command: string;
  args?: string[];
}

export interface RunContext {
  file: string;
  dir: string;
  name: string;
  stem: string;
  workspace: string;
}

export interface RunPlan {
  shell: "powershell" | "cmd";
  command: string;
}

const BUILTIN_SCRIPT: Record<string, "powershell" | "cmd"> = {
  ".bat": "cmd",
  ".cmd": "cmd",
  ".ps1": "powershell",
};

function lower(extension: string): string {
  return extension.toLowerCase();
}

// Single-quote for PowerShell; embedded single quotes are doubled.
export function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Double-quote for cmd; escape embedded double/backtick is not needed for paths.
export function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function expandPlaceholders(template: string, context: RunContext): string {
  return template
    .replace(/\{file\}/g, context.file)
    .replace(/\{dir\}/g, context.dir)
    .replace(/\{name\}/g, context.name)
    .replace(/\{stem\}/g, context.stem)
    .replace(/\{workspace\}/g, context.workspace);
}

export function findRunner(extension: string, runners: RunnerConfig[]): RunnerConfig | null {
  const target = lower(extension);
  return runners.find((runner) => (runner.extensions || []).some((item) => lower(item) === target)) || null;
}

export function isRunnable(extension: string, runners: RunnerConfig[]): boolean {
  return Boolean(BUILTIN_SCRIPT[lower(extension)]) || lower(extension) === ".exe" || findRunner(extension, runners) !== null;
}

export function buildRunPlan(node: { path: string; name: string; extension: string }, runners: RunnerConfig[], workspace: string): RunPlan | null {
  const extension = lower(node.extension);
  const stem = node.name.replace(/(\.[^.]+)?$/, "");
  const lastSlash = Math.max(node.path.lastIndexOf("\\"), node.path.lastIndexOf("/"));
  const dir = lastSlash >= 0 ? node.path.slice(0, lastSlash) : ".";
  const context: RunContext = { file: node.path, dir, name: node.name, stem, workspace };

  const custom = findRunner(extension, runners);
  if (custom) {
    const quoted = (value: string): string => (custom.shell === "cmd" ? quoteCmd(value) : quotePowerShell(value));
    const args = (custom.args || []).map((arg) => quoted(expandPlaceholders(arg, context)));
    const commandBase = expandPlaceholders(custom.command, context);
    const line = [quoted(commandBase), ...args].filter(Boolean).join(" ");
    return { shell: custom.shell, command: custom.shell === "cmd" ? line : `& ${line}` };
  }

  const builtinShell = BUILTIN_SCRIPT[extension];
  if (builtinShell) {
    if (builtinShell === "cmd") {
      return { shell: "cmd", command: quoteCmd(node.path) };
    }
    return { shell: "powershell", command: `& ${quotePowerShell(node.path)}` };
  }

  if (extension === ".exe") {
    return { shell: "powershell", command: `& ${quotePowerShell(node.path)}` };
  }
  return null;
}
