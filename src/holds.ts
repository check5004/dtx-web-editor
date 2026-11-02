import { stringChannel, type Project, type Note } from "./chart";
export interface HoldSpan {
  start: Note;
  end: Note;
  instrument: "guitar" | "bass";
}
/** NX CDTX long-note processing: a marker must coincide with a fretted start; no intervening visible note. */
export function getHoldSpans(p: Project): HoldSpan[] {
  const out: HoldSpan[] = [];
  for (const instrument of ["guitar", "bass"] as const) {
    let start: Note | undefined;
    const visible = p.notes.filter((n) => {
      const c = stringChannel(n.channel);
      return c?.instrument === instrument && ["note", "open"].includes(c.kind);
    });
    visible.sort((a, b) => a.beat - b.beat);
    const starts = new Map(
      visible
        .filter((n) => stringChannel(n.channel)?.kind === "note")
        .map((n) => [Math.round(n.beat * 1e8), n]),
    );
    const nextBeat = (beat: number) => {
      let lo = 0,
        hi = visible.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (visible[mid].beat <= beat) lo = mid + 1;
        else hi = mid;
      }
      return visible[lo]?.beat ?? Infinity;
    };
    const markers = p.notes
      .filter((n) => n.channel === (instrument === "guitar" ? "2C" : "2D"))
      .sort((a, b) => a.beat - b.beat);
    for (const end of markers) {
      if (!start) {
        start = starts.get(Math.round(end.beat * 1e8));
      } else {
        if (end.beat > start.beat && nextBeat(start.beat) > end.beat)
          out.push({ start, end, instrument });
        start = undefined;
      }
    }
  }
  return out;
}
export function setHold(p: Project, startId: string, endBeat: number): Project {
  if (p.readOnlyReason) throw new Error(p.readOnlyReason);
  const start = p.notes.find((n) => n.id === startId),
    c = start && stringChannel(start.channel);
  if (!start || c?.kind !== "note")
    throw new Error(
      "フレット付きの開始ノートを1つ選択してください（OPEN不可）。",
    );
  if (!Number.isFinite(endBeat) || endBeat <= start.beat)
    throw new Error("終端は開始ノートより後の拍にしてください。");
  if (
    p.notes.some((n) => {
      const info = stringChannel(n.channel);
      return (
        info?.instrument === c.instrument &&
        ["note", "open"].includes(info.kind) &&
        n.beat > start.beat &&
        n.beat <= endBeat
      );
    })
  )
    throw new Error(
      "ホールド区間・終端に別の演奏ノートがあります。NXではこのホールドは成立しません。",
    );
  const ch = c.instrument === "guitar" ? "2C" : "2D",
    next = structuredClone(p),
    old = getHoldSpans(p).find((s) => s.start.id === startId);
  next.notes = next.notes.filter(
    (n) =>
      !(
        n.channel === ch &&
        (Math.abs(n.beat - start.beat) < 1e-8 || (old && n.id === old.end.id))
      ),
  );
  if (
    next.notes.some(
      (n) => n.channel === ch && n.beat >= start.beat && n.beat <= endBeat,
    )
  )
    throw new Error(
      "範囲内に別のホールドマーカーがあります。先に削除してください。",
    );
  next.notes.push(
    { id: crypto.randomUUID(), beat: start.beat, channel: ch, value: "01" },
    { id: crypto.randomUUID(), beat: endBeat, channel: ch, value: "01" },
  );
  return next;
}
export function removeHold(p: Project, startId: string): Project {
  if (p.readOnlyReason) throw new Error(p.readOnlyReason);
  const span = getHoldSpans(p).find((s) => s.start.id === startId);
  if (!span) return structuredClone(p);
  const ch = span.end.channel,
    next = structuredClone(p);
  next.notes = next.notes.filter(
    (n) =>
      !(
        n.id === span.end.id ||
        (n.channel === ch && n.beat === span.start.beat)
      ),
  );
  return next;
}
