// 极简 ZIP 读取器：只为 .pptx/.docx 这类 OOXML 包服务，零依赖。
// 中央目录提供长度与压缩方式，本地头只提供数据起点（本地字段可能是数据描述符的 0）。
interface PendingEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function findEndOfCentralDirectory(view: DataView, bytes: Uint8Array): number {
  const lowest = Math.max(0, bytes.length - 65_557);
  for (let index = bytes.length - 22; index >= lowest; index -= 1) {
    if (index < 0) break;
    if (view.getUint32(index, true) === 0x06054b50) return index;
  }
  return -1;
}

function readName(bytes: Uint8Array, start: number, length: number): string {
  // OOXML 部件名规定用 '/'，但 .NET Framework 等打包工具会写成 '\'，统一成正斜杠。
  return new TextDecoder("utf-8").decode(bytes.subarray(start, start + length)).replace(/\\/g, "/");
}

function parseCentralDirectory(bytes: Uint8Array, view: DataView, cdOffset: number, count: number): PendingEntry[] {
  const entries: PendingEntry[] = [];
  let pointer = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    entries.push({ name: readName(bytes, pointer + 46, nameLength), method, compressedSize, localOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(method: number, data: Uint8Array): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`不支持的压缩算法 ${method}`);
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22) throw new Error("文件太小，不是有效的 ZIP 包");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes);
  if (eocd < 0) throw new Error("缺少 ZIP 中央目录结束记录");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const result = new Map<string, Uint8Array>();
  for (const entry of parseCentralDirectory(bytes, view, cdOffset, count)) {
    if (!wanted(entry.name)) continue;
    if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + entry.compressedSize);
    result.set(entry.name, await inflate(entry.method, new Uint8Array(data)));
  }
  return result;
}
