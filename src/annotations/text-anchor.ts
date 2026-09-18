import type { ResolutionState, TextAnchor, TextRange } from "./types";

const CONTEXT_LENGTH = 36;
const QUOTE_LIMIT = 240;

export function buildAnchor(source: string, range: TextRange): TextAnchor {
  const start = Math.max(0, Math.min(range.start, source.length));
  const end = Math.max(start, Math.min(range.end, source.length));
  return {
    quote: source.slice(start, end).slice(0, QUOTE_LIMIT),
    prefix: source.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: source.slice(end, end + CONTEXT_LENGTH),
  };
}

function occurrencesOf(source: string, quote: string): number[] {
  const positions: number[] = [];
  let offset = 0;
  while (offset <= source.length - quote.length) {
    const index = source.indexOf(quote, offset);
    if (index < 0) break;
    positions.push(index);
    offset = index + 1;
  }
  return positions;
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let count = 0;
  while (count < max && left[count] === right[count]) count += 1;
  return count;
}

function commonSuffixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let count = 0;
  while (count < max && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
  return count;
}

function contextScore(source: string, start: number, end: number, anchor: TextAnchor): number {
  const before = source.slice(Math.max(0, start - anchor.prefix.length), start);
  const after = source.slice(end, end + anchor.suffix.length);
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
}

export interface AnchorResolution {
  resolution: ResolutionState;
  range?: TextRange;
}

// Re-anchor pipeline: original offset -> unique quote -> context disambiguation -> ambiguous/orphaned.
// Never fall back to the first indexOf() match when candidates are ambiguous.
export function resolveTextAnchor(source: string, locator: TextRange | null | undefined, anchor: TextAnchor | null | undefined): AnchorResolution {
  const quote = anchor?.quote || "";
  if (!quote) return { resolution: "orphaned" };
  if (locator && quote.length <= QUOTE_LIMIT && source.slice(locator.start, locator.end) === quote) {
    return { resolution: "resolved", range: { start: locator.start, end: locator.end } };
  }
  const candidates = occurrencesOf(source, quote);
  if (candidates.length === 0) return { resolution: "orphaned" };
  if (candidates.length === 1) {
    return { resolution: "resolved", range: { start: candidates[0], end: candidates[0] + quote.length } };
  }
  if (anchor) {
    const scored = candidates
      .map((start) => ({ start, score: contextScore(source, start, start + quote.length, anchor) }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    if (best.score > 0 && (scored.length < 2 || best.score > scored[1].score)) {
      return { resolution: "resolved", range: { start: best.start, end: best.start + quote.length } };
    }
  }
  return { resolution: "ambiguous", range: { start: candidates[0], end: candidates[0] + quote.length } };
}
