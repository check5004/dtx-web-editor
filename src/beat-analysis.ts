/** Local, dependency-free energy-onset periodicity estimator. Proposals, never chart edits. */
export interface BeatCandidate {
  bpm: number;
  /** Periodicity evidence, not a calibrated probability or metrical correctness guarantee. */
  confidence: number;
  score: number;
  /** A metrical alternative is mathematically related, not directly detected. */
  basis?: "periodicity" | "half-time" | "double-time";
  /** Candidate beat in SOURCE audio seconds. Not necessarily beat zero or a downbeat. */
  beatOffsetSeconds: number;
}
export interface BeatSection {
  startSeconds: number;
  endSeconds: number;
  candidates: BeatCandidate[];
}
export interface BeatAnalysis {
  durationSeconds: number;
  candidates: BeatCandidate[];
  sections: BeatSection[];
  warnings: string[];
}
export interface BeatAnalysisOptions {
  signal?: AbortSignal;
  minBpm?: number;
  maxBpm?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
}
export interface BeatAnchor {
  beat: number;
  sourceSeconds: number;
}
const HZ = 200;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function finitePositive(n: number) {
  return Number.isFinite(n) && n > 0;
}
/** Quarter-note beat distance, not a count of bars (DTX #mmm02 lengths can vary). */
export function tempoFromAnchors(a: BeatAnchor, b: BeatAnchor): number {
  if (
    ![a.beat, b.beat, a.sourceSeconds, b.sourceSeconds].every(
      Number.isFinite,
    ) ||
    a.beat < 0 ||
    a.sourceSeconds < 0 ||
    b.beat <= a.beat ||
    b.sourceSeconds <= a.sourceSeconds
  )
    throw new Error("アンカーは正の時間差・拍差で昇順に指定してください。");
  const bpm = 60 * ((b.beat - a.beat) / (b.sourceSeconds - a.sourceSeconds));
  if (!finitePositive(bpm))
    throw new Error("アンカーから有限の正のBPMを計算できません。");
  return bpm;
}
/** Review this plan before applying. Never rewrites notes, measure lengths or DTX definitions.
 * First anchor at beat 0 makes sourceTime = chartTime + sourceOffsetSeconds explicit.
 * Each interval is constant tempo; last interval tempo continues beyond the final anchor.
 */
export function planTempoFromAnchors(anchors: readonly BeatAnchor[]) {
  if (anchors.length < 2 || anchors[0].beat !== 0)
    throw new Error("拍0を含む2点以上の確認済みアンカーが必要です。");
  const tempos = anchors
    .slice(0, -1)
    .map((anchor, i) => ({
      beat: anchor.beat,
      bpm: tempoFromAnchors(anchor, anchors[i + 1]),
    }));
  return { tempos, sourceOffsetSeconds: anchors[0].sourceSeconds };
}
function rank(
  envelope: Float32Array,
  start: number,
  end: number,
  minBpm: number,
  maxBpm: number,
): BeatCandidate[] {
  const n = end - start;
  let power = 0,
    peak = 0;
  for (let i = start; i < end; i++) {
    power += envelope[i] * envelope[i];
    peak = Math.max(peak, envelope[i]);
  }
  if (power < 1e-12 || peak < 1e-7 || n < HZ * 4) return [];
  const lo = Math.max(2, Math.floor((60 * HZ) / maxBpm)),
    hi = Math.ceil((60 * HZ) / minBpm);
  const scores = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi; lag++) {
    let dot = 0,
      left = 0,
      right = 0;
    for (let i = start + lag; i < end; i++) {
      const a = envelope[i],
        b = envelope[i - lag];
      dot += a * b;
      left += a * a;
      right += b * b;
    }
    scores[lag] = dot / Math.max(1e-15, Math.sqrt(left * right));
  }
  const peaks: { lag: number; score: number }[] = [];
  for (let lag = lo; lag <= hi; lag++)
    if (
      scores[lag] > 0.06 &&
      scores[lag] >= scores[lag - 1] &&
      scores[lag] >= scores[lag + 1]
    ) {
      const l = scores[lag - 1],
        m = scores[lag],
        r = scores[lag + 1];
      const delta =
        lag > lo && lag < hi && Math.abs(l - 2 * m + r) > 1e-12
          ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / (l - 2 * m + r)))
          : 0;
      const refined = lag + delta,
        bpm = (60 * HZ) / refined;
      if (bpm >= minBpm - 0.5 && bpm <= maxBpm + 0.5)
        peaks.push({ lag: refined, score: m });
    }
  peaks.sort((a, b) => b.score - a.score);
  return peaks.slice(0, 6).map(({ lag, score }) => {
    // Find a real onset with strongest periodically repeated support, not an arbitrary bin-zero.
    let first = start;
    while (first < end && envelope[first] < peak * 0.1) first++;
    let best = first,
      bestSupport = -1;
    for (let i = first; i < Math.min(end, first + Math.ceil(lag * 2)); i++) {
      if (envelope[i] < peak * 0.1) continue;
      let support = 0;
      for (let j = i; j < end; j += lag) {
        const k = Math.round(j);
        if (k < end) support += envelope[k];
      }
      if (support > bestSupport) {
        bestSupport = support;
        best = i;
      }
    }
    return {
      basis: "periodicity" as const,
      bpm: Math.round(((60 * HZ) / lag) * 100) / 100,
      score,
      confidence: Math.min(0.85, score * 0.85),
      beatOffsetSeconds: best / HZ,
    };
  });
}
/** CPU work yields between bounded chunks. For larger production workloads call in a Worker.
 * Analyzes up to 24 evenly distributed 20-second windows (not a full beat tracker).
 */
export async function analyzeBeats(
  samples: Float32Array,
  sampleRate: number,
  options: BeatAnalysisOptions = {},
): Promise<BeatAnalysis> {
  const min = options.minBpm ?? 40,
    max = options.maxBpm ?? 240,
    limit = options.maxDurationSeconds ?? 1800,
    timeout = options.timeoutMs ?? 30000;
  if (
    !(samples instanceof Float32Array) ||
    !finitePositive(sampleRate) ||
    sampleRate < 1000 ||
    sampleRate > 384000 ||
    !finitePositive(limit) ||
    limit > 3600 ||
    !finitePositive(timeout) ||
    timeout > 120000 ||
    !finitePositive(min) ||
    min < 20 ||
    !finitePositive(max) ||
    max > 400 ||
    max <= min
  )
    throw new Error("音声形式または解析範囲が不正です。");
  const duration = samples.length / sampleRate;
  if (duration > limit || samples.length > 200_000_000)
    throw new Error(
      "解析上限を超えています。音声を短い区間に分割してください。",
    );
  const began = Date.now();
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("解析を中止しました。", "AbortError");
    if (Date.now() - began > timeout)
      throw new Error("解析時間上限に達しました。区間を短くしてください。");
  };
  check();
  const bins = Math.ceil(duration * HZ),
    envelope = new Float32Array(bins);
  let previous = 0;
  // Sample all PCM to retain short transients; energy bins are bounded to 200 Hz afterwards.
  for (let bin = 0; bin < bins; bin++) {
    let energy = 0;
    const from = Math.floor((bin * sampleRate) / HZ),
      to = Math.min(samples.length, Math.floor(((bin + 1) * sampleRate) / HZ));
    for (let i = from; i < to; i++) {
      const value = samples[i];
      if (!Number.isFinite(value))
        throw new Error("音声に非有限値が含まれています。");
      energy += value * value;
    }
    energy = Math.sqrt(energy / Math.max(1, to - from));
    envelope[bin] = Math.max(0, energy - previous);
    previous = energy;
    if (bin % 1000 === 0) {
      check();
      await pause();
    }
  }
  const sections: BeatSection[] = [];
  const window = 20 * HZ,
    count = Math.min(24, Math.max(1, Math.ceil(bins / window)));
  for (let i = 0; i < count; i++) {
    check();
    const start =
        count === 1
          ? 0
          : Math.round((i * Math.max(0, bins - window)) / (count - 1)),
      end = Math.min(bins, start + window);
    sections.push({
      startSeconds: start / HZ,
      endSeconds: end / HZ,
      candidates: rank(envelope, start, end, min, max),
    });
    await pause();
  }
  check();
  // Keep the best-supported windows' hypotheses; do not average incompatible tempo sections.
  const representatives = sections
    .flatMap((s) => s.candidates)
    .sort((a, b) => b.score - a.score);
  const candidates: BeatCandidate[] = [];
  for (const candidate of representatives)
    if (!candidates.some((c) => Math.abs(c.bpm - candidate.bpm) < 2)) {
      candidates.push(candidate);
      if (candidates.length === 6) break;
    }
  const strongest = candidates[0];
  if (strongest)
    for (const [factor, basis] of [
      [0.5, "half-time"],
      [2, "double-time"],
    ] as const) {
      const bpm = strongest.bpm * factor;
      if (
        bpm >= min &&
        bpm <= max &&
        !candidates.some((c) => Math.abs(c.bpm - bpm) < 2)
      )
        candidates.push({
          ...strongest,
          bpm,
          score: 0,
          confidence: strongest.confidence * 0.35,
          basis,
        });
    }
  const warnings = [
    "推定結果は未適用です。半分・倍速、裏拍、開始拍を試聴して確認してください。拍子は推定しません。",
    "開始位置の調整だけでは途中のテンポ変化は補正できません。区間の拍アンカーとテンポを編集してください。",
  ];
  if (!candidates.length)
    warnings.push(
      "十分な周期的アタックを検出できませんでした。無音・短い音声・弱い拍には手動アンカーを使用してください。",
    );
  if (count === 24 && duration > 480)
    warnings.push(
      "長い音声のため最大24区間を抽出解析しました。区間間のテンポ変化を見落とす可能性があります。",
    );
  return { durationSeconds: duration, candidates, sections, warnings };
}
