// Word 97-2003 (.doc) 与 PowerPoint 97-2003 (.ppt) 是 OLE 复合文档，没有公开稳定的
// 轻量解析路径。这里做尽力而为的正文抽取：扫描可打印文本段，两种编码各扫一遍取更优。
const MIN_UTF16_RUN = 12;
const MIN_ANSI_RUN = 16;
const MAX_OUTPUT_CHARACTERS = 300_000;

// 流名、字体名、模板名等结构噪声，不是正文；即使和正文粘在一段也要抠掉。
const NOISE_TOKEN = /(times new roman|normal\.dotm?|worddocument|summaryinformation|current user|wpscustomdata|ksoproductbuildver|msvcrt|calibri|arial|wingdings|simsun|simhei|dengxian|微软雅黑|宋体|黑体|仿宋|楷体|等线)/gi;
const NOISE_LINE = /^(root entry|data|1table|0table|documentinformation|_+\w+|\\\\\* \w+)$/i;

function isUtf16Text(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  if (code >= 0x2010 && code <= 0x206f) return true;
  if (code >= 0x3000 && code <= 0x30ff) return true;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0xac00 && code <= 0xd7af) return true;
  if (code >= 0xff00 && code <= 0xffef) return true;
  return false;
}

function scanUtf16(bytes: Uint8Array, alignment: number, minLength: number): string[] {
  const runs: string[] = [];
  let buffer = "";
  for (let index = alignment; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (isUtf16Text(code)) {
      buffer += code === 0x0d ? "\n" : String.fromCharCode(code);
    } else if (buffer.length >= minLength) {
      runs.push(buffer);
      buffer = "";
    } else {
      buffer = "";
    }
  }
  if (buffer.length >= minLength) runs.push(buffer);
  return runs;
}

function ansiDecoder(): TextDecoder {
  try {
    return new TextDecoder("gbk", { fatal: false });
  } catch {
    return new TextDecoder("windows-1252", { fatal: false });
  }
}

function scanAnsi(bytes: Uint8Array, minLength: number): string[] {
  const runs: string[] = [];
  const decoder = ansiDecoder();
  let start = -1;
  const flush = (end: number): void => {
    if (start >= 0 && end - start >= minLength) runs.push(decoder.decode(bytes.subarray(start, end)).replace(/\r\n?/g, "\n"));
    start = -1;
  };
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    const text = value === 0x09 || value === 0x0a || value === 0x0d || (value >= 0x20 && value <= 0x7e) || value >= 0x81;
    if (text) {
      if (start < 0) start = index;
    } else {
      flush(index);
    }
  }
  flush(bytes.length);
  return runs;
}

function meaningful(text: string): number {
  let score = 0;
  for (const character of text) {
    const code = character.codePointAt(0) || 0;
    const latin = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const digit = code >= 0x30 && code <= 0x39;
    const cjk = code >= 0x4e00 && code <= 0x9fff;
    if (latin || digit || cjk) score += cjk ? 3 : 1;
  }
  return score;
}

const CJK_SENTENCE_PUNCTUATION = /[，。、；：？！”“（）《》【】…—·]/;

// 随机二进制也能拼出“合法”码位，这里用语言结构再筛一遍：
// 含中文的行要么有中文标点，要么有足够长的连续中文；纯拉丁行要有两个以上实词。
function looksLikeSentence(line: string): boolean {
  if (line.length < 6) return false;
  if (/[㐀-鿿]/.test(line)) {
    return CJK_SENTENCE_PUNCTUATION.test(line) || /[㐀-鿿]{8,}/.test(line);
  }
  const words = line.split(/[^A-Za-z]+/).filter((token) => token.length >= 3);
  return words.length >= 2 || Math.max(0, ...words.map((token) => token.length)) >= 5;
}

function cleanLines(runs: string[]): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    for (const raw of run.replace(NOISE_TOKEN, " ").split("\n")) {
      const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
      if (line.length < 2 || NOISE_LINE.test(line)) continue;
      if (meaningful(line) < 2 || !looksLikeSentence(line)) continue;
      if (lines[lines.length - 1] === line) continue;
      lines.push(line);
      if (lines.join("\n").length > MAX_OUTPUT_CHARACTERS) return lines;
    }
  }
  return lines;
}

export function extractEmbeddedText(bytes: Uint8Array): string {
  // .doc/.ppt 正文多为 UTF-16LE；ANSI(GBK) 扫描只作兜底，并给 UTF-16 一点权重，
  // 避免二进制区段被 GBK 解成大量“看起来像中文”的噪声后压过真正文。
  const candidates: Array<{ lines: string[]; weight: number }> = [
    { lines: cleanLines(scanUtf16(bytes, 0, MIN_UTF16_RUN)), weight: 1.25 },
    { lines: cleanLines(scanUtf16(bytes, 1, MIN_UTF16_RUN)), weight: 1.25 },
    { lines: cleanLines(scanAnsi(bytes, MIN_ANSI_RUN)), weight: 1 },
  ];
  let best: string[] = [];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = meaningful(candidate.lines.join("\n")) * candidate.weight;
    if (score > bestScore) {
      bestScore = score;
      best = candidate.lines;
    }
  }
  return best.join("\n");
}
