export interface MatchRange {
  start: number;
  end: number;
}

export const MAX_FIND_MATCHES = 2000;

// 忽略大小写交给正则的 i 标志：先整篇 toLocaleLowerCase 再 indexOf，
// 遇到长度会变化的字符（如 İ）会让后续所有偏移整体错位。
export function collectTextMatches(source: string, query: string, caseSensitive: boolean): MatchRange[] {
  const matches: MatchRange[] = [];
  if (!query) return matches;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  let result = pattern.exec(source);
  while (result && matches.length < MAX_FIND_MATCHES) {
    matches.push({ start: result.index, end: result.index + result[0].length });
    if (result[0].length === 0) pattern.lastIndex = result.index + 1;
    result = pattern.exec(source);
  }
  return matches;
}
