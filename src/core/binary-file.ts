import { invoke } from "@tauri-apps/api/core";

const PAGE_BYTES = 4 * 1024 * 1024;

// 二进制走 Tauri 的二进制 IPC（ArrayBuffer），不再序列化成 number[]；
// 单次上限由 Rust 侧钳制，因此按页循环拼接。
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const buffer = await invoke<ArrayBuffer>("read_binary_range", { path, offset, length: PAGE_BYTES });
    const piece = new Uint8Array(buffer);
    if (piece.length === 0) break;
    chunks.push(piece);
    offset += piece.length;
    total += piece.length;
    if (piece.length < PAGE_BYTES) break;
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }
  return merged;
}
