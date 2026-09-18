import type { ResolvedAnnotation, TextRange } from "../types";

// §10: never guess positions — only highlight when the quote matches exactly
// once in the preview. But match robustly: across inline nodes within one
// block, with markdown syntax stripped and whitespace collapsed.

const BLOCK_DELIMITER = "\u0000";
const BLOCK_TAGS = new Set(["P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH", "PRE", "DIV", "TR", "TABLE", "HR", "FIGURE", "CAPTION"]);

interface PreviewTextMap {
  text: string;
  nodes: Array<{ node: Text; start: number }>;
}

function blockAncestor(node: Text): Element | null {
  let current: Element | null = node.parentElement;
  while (current) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return null;
}

function collectTextMap(root: HTMLElement): PreviewTextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = "";
  let previousBlock: Element | null = null;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const block = blockAncestor(node);
    if (previousBlock && block !== previousBlock) text += BLOCK_DELIMITER;
    previousBlock = block;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

function occurrencesOf(text: string, needle: string): number[] {
  const positions: number[] = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset);
    if (index < 0) break;
    positions.push(index);
    offset = index + 1;
  }
  return positions;
}

// Drop inline markdown syntax from a source-derived quote so it can be
// compared against rendered preview text ("**bold**" -> "bold").
function normalizeQuoteForPreview(quote: string): string {
  return quote
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)([\s\S]+?)\1/g, "$2")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapPreviewRange(map: PreviewTextMap, start: number, end: number, id: string, title: string): void {
  // Binary-search the first node that can overlap [start, end); then walk only
  // the few nodes in range instead of scanning every text node in the preview.
  const nodes = map.nodes;
  let low = 0;
  let high = nodes.length - 1;
  let first = nodes.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = nodes[mid];
    if (entry.start + entry.node.data.length > start) {
      first = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const segments: Array<{ node: Text; from: number; to: number }> = [];
  for (let index = first; index < nodes.length; index += 1) {
    const entry = nodes[index];
    if (entry.start >= end) break;
    const from = Math.max(start, entry.start) - entry.start;
    const to = Math.min(end, entry.start + entry.node.data.length) - entry.start;
    if (to > from && from >= 0 && to <= entry.node.data.length) segments.push({ node: entry.node, from, to });
  }
  // Wrap last-first so earlier segments keep valid offsets after splitting.
  for (const segment of segments.reverse()) {
    const range = document.createRange();
    range.setStart(segment.node, segment.from);
    range.setEnd(segment.node, segment.to);
    const span = document.createElement("span");
    span.className = "md-annotation-hl";
    span.dataset.annotationId = id;
    span.title = title;
    range.surroundContents(span);
  }
}

export function highlightPreviewAnnotations(root: HTMLElement, items: ResolvedAnnotation[]): void {
  const candidates = items.filter(
    (item) => item.entry.scope === "text-range" && item.resolution === "resolved" && Boolean(item.entry.anchor?.quote)
  );
  if (candidates.length === 0) return;
  const map = collectTextMap(root);
  const found: Array<{ start: number; end: number; id: string; title: string }> = [];
  for (const item of candidates) {
    const rawQuote = item.entry.anchor?.quote || "";
    let needle = rawQuote;
    let positions = occurrencesOf(map.text, needle);
    if (positions.length !== 1) {
      needle = normalizeQuoteForPreview(rawQuote);
      positions = needle ? occurrencesOf(map.text, needle) : [];
    }
    if (positions.length !== 1) continue;
    const start = positions[0];
    const end = start + needle.length;
    if (found.some((match) => match.start < end && start < match.end)) continue;
    found.push({ start, end, id: item.entry.id, title: item.entry.text });
  }
  if (found.length === 0) return;
  // Wrap last-first so wrapping never invalidates the offsets of earlier matches.
  found.sort((left, right) => right.start - left.start);
  for (const match of found) wrapPreviewRange(map, match.start, match.end, match.id, match.title);
}

// Build a syntax-free projection of the source with a char->offset map, so a
// quote selected in the rendered preview can be traced back to source offsets.
function normalizeSourceForPreview(source: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  const push = (character: string, index: number) => {
    if (/\s/.test(character)) {
      if (out.length > 0 && out[out.length - 1] === " ") {
        map[out.length - 1] = Math.max(map[out.length - 1], index);
        return;
      }
      out.push(" ");
      map.push(index);
      return;
    }
    out.push(character);
    map.push(index);
  };
  let i = 0;
  let atLineStart = true;
  const linkRe = /!?\[([^\]]*)\]\([^)]*\)/y;
  const pairRe = /(\*\*|__|~~)([\s\S]+?)\1/y;
  const codeRe = /`+([^`]+)`+/y;
  const prefixRe = /#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+/y;
  while (i < source.length) {
    if (atLineStart) {
      prefixRe.lastIndex = i;
      const prefix = prefixRe.exec(source);
      if (prefix) {
        i += prefix[0].length;
        continue;
      }
    }
    const character = source[i];
    if (/\s/.test(character)) {
      push(character, i);
      atLineStart = character === "\n";
      i += 1;
      continue;
    }
    atLineStart = false;
    linkRe.lastIndex = i;
    const link = linkRe.exec(source);
    if (link) {
      const label = link[1];
      const labelStart = i + link[0].indexOf("[") + 1;
      for (let k = 0; k < label.length; k += 1) push(label[k], labelStart + k);
      i += link[0].length;
      continue;
    }
    pairRe.lastIndex = i;
    const pair = pairRe.exec(source);
    if (pair) {
      for (let k = 0; k < pair[2].length; k += 1) push(pair[2][k], i + pair[1].length + k);
      i += pair[0].length;
      continue;
    }
    codeRe.lastIndex = i;
    const code = codeRe.exec(source);
    if (code) {
      const innerStart = i + code[0].indexOf(code[1]);
      for (let k = 0; k < code[1].length; k += 1) push(code[1][k], innerStart + k);
      i += code[0].length;
      continue;
    }
    if (character === "*" || character === "_") {
      i += 1;
      continue;
    }
    if (character === "\\" && i + 1 < source.length) {
      push(source[i + 1], i + 1);
      i += 2;
      continue;
    }
    push(character, i);
    i += 1;
  }
  return { text: out.join(""), map };
}

// Map a rendered-preview selection back to source offsets. Returns null when
// the quote does not occur or occurs more than once (never bind the first).
export function mapRenderedQuoteToSource(source: string, quote: string): TextRange | null {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return null;
  const direct = occurrencesOf(source, needle);
  if (direct.length === 1) return { start: direct[0], end: direct[0] + needle.length };
  if (direct.length > 1) return null;
  const { text, map } = normalizeSourceForPreview(source);
  const positions = occurrencesOf(text, needle);
  if (positions.length !== 1) return null;
  const start = map[positions[0]];
  const end = map[positions[0] + needle.length - 1] + 1;
  return { start, end };
}
