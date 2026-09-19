// 大文件打开策略（设计文档 §14）：宁可多次短等待，不允许一次长时间冻结。
export type OpenMode = "normal" | "lazy" | "external";

export interface OpenDecision {
  mode: OpenMode;
  reason: string;
}

export const LAZY_TEXT_LIMIT_BYTES = 32 * 1024 * 1024;
export const TEXT_CHUNK_BYTES = 2 * 1024 * 1024;
export const CSV_LOAD_STEP_BYTES = 8 * 1024 * 1024;

export function decideOpenMode(size: number, editableLimitBytes: number): OpenDecision {
  if (size <= editableLimitBytes) {
    return { mode: "normal", reason: "在可编辑大小内，直接普通编辑打开。" };
  }
  if (size <= LAZY_TEXT_LIMIT_BYTES) {
    return { mode: "lazy", reason: `文件 ${size} bytes 超过可编辑上限，按只读分批加载。` };
  }
  return {
    mode: "external",
    reason: `文件 ${size} bytes 超过 ${LAZY_TEXT_LIMIT_BYTES / 1024 / 1024} MB，建议用外部程序打开；也可确认后分批只读加载。`,
  };
}
