import { type Project } from "./chart.js";
export interface MetronomeEvent {
  time: number;
  seconds: number;
  beat: number;
  accent: boolean;
}
export interface TimelineIndex {
  beatToSeconds(beat: number): number;
  secondsToBeat(seconds: number): number;
  barStartBeat(bar: number): number;
  barLengthAt(bar: number): number;
  beatToBar(beat: number): {
    bar: number;
    fraction: number;
    startBeat: number;
    length: number;
  };
  durationBeats(): number;
  metronomeEvents(): readonly MetronomeEvent[];
}
const MAX_BARS = 3600,
  MAX_CLICKS = 230400;
function upperBound(values: ArrayLike<number>, value: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** Immutable timing snapshot. Rebuild when project content changes, not for every draw frame. */
export function buildTimelineIndex(project: Project): TimelineIndex {
  if (!Number.isFinite(project.metadata.bpm) || project.metadata.bpm <= 0)
    throw new Error("初期 BPM は正の有限数にしてください。");
  if (
    !Number.isInteger(project.barCount) ||
    project.barCount < 1 ||
    project.barCount > MAX_BARS
  )
    throw new Error("小節数は 1〜3600 の範囲にしてください。");
  const starts = new Float64Array(MAX_BARS + 1),
    ratios = new Float64Array(MAX_BARS);
  let ratio = 1;
  for (let bar = 0; bar < MAX_BARS; bar++) {
    if (project.barLengths[bar] !== undefined) {
      ratio = project.barLengths[bar];
      if (!Number.isFinite(ratio) || ratio <= 0)
        throw new Error("小節長は正の有限数にしてください。");
    }
    ratios[bar] = ratio;
    starts[bar + 1] = starts[bar] + 4 * ratio;
    if (!Number.isFinite(starts[bar + 1]))
      throw new Error("小節長の合計が数値の上限を超えています。");
  }
  const tempoBeats: number[] = [0],
    tempoSeconds: number[] = [0],
    tempoBpms: number[] = [project.metadata.bpm];
  const tempos = project.tempos
    .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0)
    .slice()
    .sort((a, b) => a.beat - b.beat);
  for (const t of tempos) {
    if (!Number.isFinite(t.beat) || t.beat < 0)
      throw new Error("テンポ位置は 0 以上の有限数にしてください。");
    const previous = tempoBeats.length - 1;
    tempoSeconds.push(
      tempoSeconds[previous] +
        ((t.beat - tempoBeats[previous]) * 60) / tempoBpms[previous],
    );
    tempoBeats.push(t.beat);
    tempoBpms.push(t.bpm);
  }
  const beatToSeconds = (beat: number): number => {
    if (!Number.isFinite(beat)) throw new Error("拍位置が不正です。");
    const i = Math.max(0, upperBound(tempoBeats, beat) - 1);
    return tempoSeconds[i] + ((beat - tempoBeats[i]) * 60) / tempoBpms[i];
  };
  const secondsToBeat = (seconds: number): number => {
    if (!Number.isFinite(seconds)) throw new Error("時刻が不正です。");
    const i = Math.max(0, upperBound(tempoSeconds, seconds) - 1);
    return tempoBeats[i] + ((seconds - tempoSeconds[i]) * tempoBpms[i]) / 60;
  };
  const barStartBeat = (bar: number): number => {
    if (!Number.isInteger(bar) || bar < 0 || bar > MAX_BARS)
      throw new Error("小節境界は 0〜3600 の範囲にしてください。");
    return starts[bar];
  };
  const barLengthAt = (bar: number): number => {
    if (!Number.isInteger(bar) || bar < 0 || bar >= MAX_BARS)
      throw new Error("小節番号は 000〜Z99 の範囲にしてください。");
    return ratios[bar];
  };
  const beatToBar = (beat: number) => {
    if (!Number.isFinite(beat) || beat < 0)
      throw new Error("拍位置は 0 以上の有限数にしてください。");
    const bar = upperBound(starts, beat + 1e-9) - 1;
    if (bar >= MAX_BARS)
      throw new Error("DTX の小節範囲（000〜Z99）を超えています。");
    const startBeat = starts[bar],
      length = ratios[bar] * 4;
    return {
      bar,
      fraction: Math.max(0, (beat - startBeat) / length),
      startBeat,
      length,
    };
  };
  let last = 0;
  for (const note of project.notes) last = Math.max(last, note.beat);
  for (const t of project.tempos) last = Math.max(last, t.beat);
  const duration = starts[Math.max(project.barCount, beatToBar(last).bar + 1)],
    count = project.barCount;
  let clicks: readonly MetronomeEvent[] | undefined;
  const metronomeEvents = (): readonly MetronomeEvent[] => {
    if (clicks) return clicks;
    // Bound before allocating; a huge but legal DTX ratio must not freeze the browser.
    let size = 0;
    for (let bar = 0; bar < count; bar++) {
      size += Math.max(1, Math.ceil(ratios[bar] * 4 - 1e-9));
      if (size > MAX_CLICKS)
        throw new Error(
          "メトロノームイベントが 230,400 個を超えます。小節長または小節数を減らしてください。",
        );
    }
    const result: MetronomeEvent[] = [];
    for (let bar = 0; bar < count; bar++) {
      const length = ratios[bar] * 4,
        clickCount = Math.max(1, Math.ceil(length - 1e-9));
      for (let offset = 0; offset < clickCount; offset++) {
        const beat = starts[bar] + offset,
          seconds = beatToSeconds(beat);
        result.push({ time: seconds, seconds, beat, accent: offset === 0 });
      }
    }
    clicks = result;
    return clicks;
  };
  return {
    beatToSeconds,
    secondsToBeat,
    barStartBeat,
    barLengthAt,
    beatToBar,
    durationBeats: () => duration,
    metronomeEvents,
  };
}
