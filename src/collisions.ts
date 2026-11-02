import type { Note } from "./chart";
/** Existing imported overlap is preserved, but editing cannot introduce ambiguous stacking. */
export function assertNoNewNoteCollisions(
  before: readonly Note[],
  after: readonly Note[],
): void {
  const pairs = (notes: readonly Note[]) => {
    const groups = new Map<string, string[]>();
    for (const n of notes) {
      const key = `${n.channel}:${Math.round(n.beat * 1e7)}`;
      const group = groups.get(key) || [];
      group.push(n.id);
      groups.set(key, group);
    }
    const result = new Set<string>();
    for (const ids of groups.values()) {
      ids.sort();
      if (ids.length > 100)
        throw new Error("同位置に重なるチップが多すぎます。");
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          result.add(`${ids[i]}|${ids[j]}`);
    }
    return result;
  };
  const original = pairs(before);
  if ([...pairs(after)].some((pair) => !original.has(pair)))
    throw new Error(
      "同じチャンネル・拍にチップが重なります。位置または選択範囲を変更してください。",
    );
}
