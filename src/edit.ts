import { remapCreatorReferences } from "./creator-settings.js";
import {
  type Project,
  type Note,
  type Tempo,
  barLengthAt,
  barStartBeat,
  beatToBar,
  isWavReferenceChannel,
} from "./chart.js";

function editable(p: Project): Project {
  if (p.readOnlyReason) throw new Error(p.readOnlyReason);
  return structuredClone(p);
}
function integer(n: number, name: string, min = 0): void {
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} は ${min} 以上の整数にしてください。`);
}
function effectiveCount(p: Project): number {
  return Math.max(
    p.barCount,
    1,
    ...p.notes.map((n) => beatToBar(p, n.beat).bar + 1),
    ...p.tempos.map((n) => beatToBar(p, n.beat).bar + 1),
  );
}
function lengths(p: Project, count: number): number[] {
  return Array.from({ length: count }, (_, i) => barLengthAt(p, i));
}
function setLengths(p: Project, values: number[]): void {
  p.barLengths = {};
  let previous = 1;
  values.forEach((value, bar) => {
    if (value !== previous) p.barLengths[bar] = value;
    previous = value;
  });
  p.barCount = values.length;
}
function remap<T extends Note | Tempo>(
  before: Project,
  after: Project,
  events: T[],
  map: (bar: number) => number | null,
): T[] {
  return events.flatMap((event) => {
    const { bar, fraction } = beatToBar(before, event.beat);
    const next = map(bar);
    return next === null
      ? []
      : [
          {
            ...event,
            beat:
              barStartBeat(after, next) +
              fraction * 4 * barLengthAt(after, next),
          },
        ];
  });
}
/** Insert empty bars, inheriting the length active at the insertion point. */
export function insertMeasures(
  project: Project,
  at: number,
  count = 1,
): Project {
  integer(at, "挿入位置");
  integer(count, "小節数", 1);
  const total = effectiveCount(project);
  if (at > total) throw new Error("挿入位置が譜面の末尾を超えています。");
  if (total + count > 3600) throw new Error("DTX の小節数上限は 3600 です。");
  const result = editable(project),
    values = lengths(project, total);
  values.splice(at, 0, ...Array<number>(count).fill(barLengthAt(project, at)));
  setLengths(result, values);
  const map = (bar: number) => (bar >= at ? bar + count : bar);
  result.notes = remap(project, result, project.notes, map);
  result.tempos = remap(project, result, project.tempos, map);
  return result;
}
function bpmAt(project: Project, beat: number): number {
  let bpm = project.metadata.bpm;
  for (const t of [...project.tempos].sort((a, b) => a.beat - b.beat)) {
    if (t.beat > beat) break;
    bpm = t.bpm;
  }
  return bpm;
}
/** Delete full bars and their events; preserve the tempo entering surviving content. */
export function deleteMeasures(
  project: Project,
  start: number,
  count = 1,
): Project {
  integer(start, "削除位置");
  integer(count, "小節数", 1);
  const total = effectiveCount(project);
  if (start >= total || start + count > total)
    throw new Error("削除範囲が譜面の末尾を超えています。");
  const result = editable(project),
    values = lengths(project, total),
    end = start + count;
  values.splice(start, count);
  setLengths(result, values.length ? values : [1]);
  const map = (bar: number) =>
    bar < start ? bar : bar < end ? null : bar - count;
  result.notes = remap(project, result, project.notes, map);
  result.tempos = remap(project, result, project.tempos, map);
  if (end < total) {
    const oldEnd = barStartBeat(project, end),
      boundary = barStartBeat(result, start),
      target = bpmAt(project, oldEnd);
    if (start === 0) result.metadata.bpm = target;
    else if (bpmAt(result, boundary) !== target)
      result.tempos.push({
        id: `tempo-cut-${start}-${end}`,
        beat: boundary,
        bpm: target,
        channel: "08",
        value: "01",
      });
    result.tempos.sort((a, b) => a.beat - b.beat);
  }
  return result;
}
/** Change one bar only. Events retain their within-bar fraction; later bars shift. */
export interface MeasureLengthOptions {
  mode?: "stretch" | "preserve";
  overflow?: "error" | "delete";
}
export function changeMeasureLength(
  project: Project,
  bar: number,
  ratio: number,
  options: MeasureLengthOptions | "stretch" | "preserve" = {},
): Project {
  integer(bar, "小節位置");
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw new Error("小節長は 0 より大きい有限数にしてください。");
  const total = effectiveCount(project);
  if (bar >= total) throw new Error("小節位置が譜面の末尾を超えています。");
  const settings = typeof options === "string" ? { mode: options } : options;
  const result = editable(project),
    values = lengths(project, total);
  values[bar] = ratio;
  setLengths(result, values);
  if (settings.mode !== "preserve") {
    result.notes = remap(project, result, project.notes, (b) => b);
    result.tempos = remap(project, result, project.tempos, (b) => b);
    return result;
  }
  const start = barStartBeat(project, bar),
    newLength = ratio * 4;
  const overflowing = [...project.notes, ...project.tempos].filter(
    (n) =>
      beatToBar(project, n.beat).bar === bar &&
      n.beat - start >= newLength - 1e-9,
  );
  if (overflowing.length && settings.overflow !== "delete")
    throw new Error(
      `短縮後の小節から ${overflowing.length} 個のチップがはみ出します。削除を明示的に選ぶか、伸縮モードを使用してください。`,
    );
  const reposition = <T extends Note | Tempo>(events: T[]): T[] =>
    events.flatMap((event) => {
      const position = beatToBar(project, event.beat);
      if (position.bar === bar) {
        if (event.beat - start >= newLength - 1e-9) return [];
        return [{ ...event }];
      }
      return [
        {
          ...event,
          beat:
            barStartBeat(result, position.bar) +
            position.fraction * 4 * barLengthAt(result, position.bar),
        },
      ];
    });
  result.notes = reposition(project.notes);
  result.tempos = reposition(project.tempos);
  if (bar + 1 < total) {
    const boundary = barStartBeat(result, bar + 1),
      target = bpmAt(project, barStartBeat(project, bar + 1));
    if (bpmAt(result, boundary) !== target)
      result.tempos.push({
        id: `tempo-length-${bar}`,
        beat: boundary,
        bpm: target,
        channel: "08",
        value: "01",
      });
    result.tempos.sort((a, b) => a.beat - b.beat);
  }
  return result;
}

const normalizeId = (id: string) => {
  const value = id.toUpperCase();
  if (!/^[0-9A-Z]{2}$/.test(value) || value === "00")
    throw new Error("WAV ID は 01〜ZZ の 2 桁で指定してください。");
  return value;
};
/** Rewrite sample references, never IDs belonging to BGA, AVI, BPM or control events. */
export function replaceWavReferences(
  project: Project,
  fromId: string,
  toId: string,
  noteIds?: Iterable<string>,
): Project {
  const from = normalizeId(fromId),
    to = normalizeId(toId),
    result = editable(project),
    selection = noteIds ? new Set(noteIds) : undefined;
  result.notes = result.notes.map((n) =>
    isWavReferenceChannel(n.channel) &&
    n.value === from &&
    (!selection || selection.has(n.id))
      ? { ...n, value: to }
      : n,
  );
  return result;
}
/** Atomic ID mapping. Existing sample identity and audible references move together. */
export function reorderResourceIds(
  project: Project,
  mapping: Record<string, string>,
): Project {
  const result = editable(project),
    map = new Map(
      Object.entries(mapping).map(([a, b]) => [normalizeId(a), normalizeId(b)]),
    );
  if (new Set(map.values()).size !== map.size)
    throw new Error("複数の WAV を同じ ID に移動できません。");
  for (const [from, to] of map) {
    if (!project.resources[from])
      throw new Error(`WAV ${from} が見つかりません。`);
    if (project.resources[to] && !map.has(to))
      throw new Error(`WAV ${to} は使用中です。`);
  }
  result.resources = {};
  for (const [id, resource] of Object.entries(project.resources)) {
    const next = map.get(id) || id;
    result.resources[next] = { ...resource, id: next };
  }
  result.notes = result.notes.map((n) =>
    isWavReferenceChannel(n.channel) && map.has(n.value)
      ? { ...n, value: map.get(n.value)! }
      : n,
  );
  return remapCreatorReferences(result, "WAV", Object.fromEntries(map));
}
export function swapResourceIds(
  project: Project,
  a: string,
  b: string,
): Project {
  const first = normalizeId(a),
    second = normalizeId(b);
  if (first === second) return editable(project);
  if (!project.resources[first] || !project.resources[second])
    throw new Error("入れ替える両方の WAV が必要です。");
  return reorderResourceIds(project, { [first]: second, [second]: first });
}
export function scaleSelectedTempo(
  project: Project,
  factor: number,
  tempoIds?: Iterable<string>,
): Project {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("BPM 倍率は正の数にしてください。");
  const result = editable(project),
    selection = tempoIds ? new Set(tempoIds) : undefined;
  if (!selection) result.metadata.bpm *= factor;
  result.tempos = result.tempos.map((t) =>
    !selection || selection.has(t.id) ? { ...t, bpm: t.bpm * factor } : t,
  );
  if (result.tempos.some((t) => t.bpm <= result.metadata.baseBpm))
    throw new Error("変更後の BPM は BASEBPM より大きくしてください。");
  return result;
}
