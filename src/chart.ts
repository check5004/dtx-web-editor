/** DTXManiaNX codec. Timing semantics follow CDTX.cs: bar-length changes persist. */
export const LANES = [
  { id: "LC", label: "左シンバル", channel: "1A", color: "#ecbdf7" },
  { id: "HH", label: "ハイハット", channel: "11", color: "#72e0ef" },
  { id: "LP", label: "左ペダル", channel: "1B", color: "#ef9cd3" },
  { id: "SN", label: "スネア", channel: "12", color: "#ffd373" },
  { id: "BD", label: "バスドラム", channel: "13", color: "#cb9aff" },
  { id: "HT", label: "ハイタム", channel: "14", color: "#96df9a" },
  { id: "LT", label: "ロータム", channel: "15", color: "#ed9e80" },
  { id: "FT", label: "フロアタム", channel: "17", color: "#fa9cae" },
  { id: "RC", label: "右シンバル", channel: "16", color: "#a0caff" },
  { id: "RD", label: "ライド", channel: "19", color: "#8ab9ff" },
] as const;
export const DRUM_LANES = LANES;
export type LaneId = (typeof LANES)[number]["id"];
export interface ChartMetadata {
  title: string;
  artist: string;
  comment: string;
  bpm: number;
  baseBpm: number;
  preview: string;
  background: string;
  [key: string]: string | number;
}
export interface WavResource {
  id: string;
  file: string;
  label?: string;
  volume?: number;
  pan?: number;
  size?: number;
}
export interface Note {
  id: string;
  beat: number;
  channel: string;
  value: string;
  lane?: LaneId;
}
export interface Tempo {
  id: string;
  beat: number;
  bpm: number;
  channel: "03" | "08";
  value: string;
}
export interface Project {
  metadata: ChartMetadata;
  resources: Record<string, WavResource>;
  notes: Note[];
  tempos: Tempo[];
  /** Persistent measure-length changes, relative to 4/4. */
  barLengths: Record<number, number>;
  barCount: number;
  bpmDefinitions: Record<string, number>;
  passthrough: string[];
  warnings: string[];
  readOnlyReason?: string;
  originalText?: string;
  originalFingerprint?: string;
}
export type ChartProject = Project;
export function channelToLane(channel: string): LaneId | undefined {
  const ch = channel.toUpperCase();
  if (ch === "18") return "HH"; // open hi-hat
  if (ch === "1C") return "BD"; // left bass drum
  return LANES.find((l) => l.channel === ch)?.id;
}
/** Only these channels trigger WAV samples; never interpret BGA/AVI IDs as sounds. */
export function isAudioChannel(channel: string): boolean {
  const n = parseInt(channel, 16);
  return (
    n === 1 ||
    n === 0x1f ||
    (n >= 0x11 && n <= 0x1c) ||
    (n >= 0x31 && n <= 0x3c) ||
    (n >= 0x20 && n <= 0x27) ||
    n === 0x2f ||
    (n >= 0xa0 && n <= 0xa7) ||
    (n >= 0x61 && n <= 0x69) ||
    (n >= 0x70 && n <= 0x79) ||
    (n >= 0x80 && n <= 0x89) ||
    (n >= 0x90 && n <= 0x9f) ||
    (n >= 0xa9 && n <= 0xaf) ||
    (n >= 0xc5 && n <= 0xc6) ||
    (n >= 0xc8 && n <= 0xd3) ||
    (n >= 0xda && n <= 0xdf) ||
    (n >= 0xe1 && n <= 0xe8)
  );
}
function emptyProject(): Project {
  return {
    metadata: {
      title: "",
      artist: "",
      comment: "",
      bpm: 120,
      baseBpm: 0,
      preview: "",
      background: "",
    },
    resources: {},
    notes: [],
    tempos: [],
    barLengths: {},
    barCount: 1,
    bpmDefinitions: {},
    passthrough: [],
    warnings: [],
  };
}
function fingerprint(p: Project): string {
  const {
    originalText,
    originalFingerprint,
    warnings,
    readOnlyReason,
    ...data
  } = p;
  return JSON.stringify(data);
}
export function barLengthAt(p: Project, bar: number): number {
  let length = 1;
  for (const k of Object.keys(p.barLengths)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (k > bar) break;
    length = p.barLengths[k];
  }
  return length;
}
export function barStartBeat(p: Project, bar: number): number {
  let beat = 0;
  for (let i = 0; i < bar; i++) beat += 4 * barLengthAt(p, i);
  return beat;
}
export function beatToBar(
  p: Project,
  beat: number,
): { bar: number; fraction: number; startBeat: number; length: number } {
  if (!Number.isFinite(beat) || beat < 0)
    throw new Error("拍位置は 0 以上の有限数にしてください。");
  let bar = 0,
    startBeat = 0,
    length = 4 * barLengthAt(p, 0);
  while (beat >= startBeat + length - 1e-9) {
    startBeat += length;
    bar++;
    length = 4 * barLengthAt(p, bar);
    if (bar > 3599)
      throw new Error("DTX の小節範囲（000〜Z99）を超えています。");
  }
  return {
    bar,
    fraction: Math.max(0, (beat - startBeat) / length),
    startBeat,
    length,
  };
}
export function durationBeats(p: Project): number {
  const last = Math.max(
    0,
    ...p.notes.map((n) => n.beat),
    ...p.tempos.map((n) => n.beat),
  );
  return barStartBeat(p, Math.max(p.barCount, beatToBar(p, last).bar + 1));
}
const metaKeys: Record<string, string> = {
  TITLE: "title",
  ARTIST: "artist",
  COMMENT: "comment",
  BPM: "bpm",
  BASEBPM: "baseBpm",
  PREVIEW: "preview",
  BACKGROUND: "background",
};
export function encodeBar(bar: number): string {
  if (!Number.isInteger(bar) || bar < 0 || bar > 3599)
    throw new Error("小節番号は 000〜Z99 の範囲にしてください。");
  return (
    Math.floor(bar / 100)
      .toString(36)
      .toUpperCase() + String(bar % 100).padStart(2, "0")
  );
}
export function decodeBar(value: string): number {
  return parseInt(value[0], 36) * 100 + Number(value.slice(1));
}
const numeric = (s: string) => Number(s.trim().replace(",", "."));
export function parseDTX(text: string): Project {
  const p = emptyProject();
  p.originalText = text;
  const rows: { bar: number; channel: string; data: string; line: number }[] =
    [];
  const protectedConstruct = (reason: string) => {
    p.readOnlyReason ||= reason;
    if (!p.warnings.includes(reason)) p.warnings.push(reason);
  };
  if (/^\s*#(?:RANDOM|SETRANDOM|IF|ELSEIF|ELSE|ENDIF|ENDRANDOM)\b/im.test(text))
    protectedConstruct(
      "RANDOM / IF 分岐を含むため読み取り専用です。元の DTX はそのまま書き出せます。分岐を評価しないためプレビューは参考表示です。",
    );
  const seen = new Set<string>();
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.split(";")[0].trim();
      if (!line) {
        if (raw.trim()) p.passthrough.push(raw);
        return;
      }
      const row = line.match(/^#([0-9a-z]\d{2})([0-9a-f]{2})\s*:\s*(.*?)\s*$/i);
      if (row) {
        const bar = decodeBar(row[1]),
          channel = row[2].toUpperCase(),
          data = row[3].replace(/\s/g, "").toUpperCase();
        p.barCount = Math.max(p.barCount, bar + 1);
        if (channel === "02") {
          const length = numeric(data);
          if (length > 0 && Number.isFinite(length)) p.barLengths[bar] = length;
          else {
            p.passthrough.push(raw);
            protectedConstruct(
              `${index + 1} 行: 小節長が不正なため読み取り専用です。`,
            );
          }
        } else if (data.length % 2 || !/^[0-9A-Z]*$/.test(data)) {
          p.passthrough.push(raw);
          protectedConstruct(
            `${index + 1} 行: チップデータが不正なため読み取り専用です。`,
          );
        } else rows.push({ bar, channel, data, line: index + 1 });
        return;
      }
      const header = line.match(/^#([A-Z0-9_]+)(?:\s*:\s*|\s+)(.*)$/i);
      if (!header) {
        p.passthrough.push(raw);
        return;
      }
      const key = header[1].toUpperCase(),
        value = header[2].trim();
      const resource = key.match(
        /^(WAV|WAVVOL|VOLUME|WAVPAN|PAN|SIZE)([0-9A-Z]{2})$/,
      );
      const bpm = key.match(/^BPM([0-9A-Z]{2})$/);
      if (
        resource ||
        bpm ||
        key === "BPM" ||
        /^(?:BMP|BMPTEX|AVI|AVIPAN|BGA|BGAPAN)[0-9A-Z]{2}$/.test(key)
      ) {
        const canonical =
          key === "BPM"
            ? "BPM00"
            : resource
              ? `${({ WAVVOL: "VOLUME", WAVPAN: "PAN" } as Record<string, string>)[resource[1]] || resource[1]}${resource[2]}`
              : key;
        if (seen.has(canonical))
          protectedConstruct(
            "WAV / BPM / 音量などの再定義を含むため読み取り専用です。定義の順序を保つため元の DTX を書き出します。",
          );
        seen.add(canonical);
      }
      if (resource) {
        const [, kind, id] = resource;
        const r = (p.resources[id] ||= { id, file: "" });
        if (kind === "WAV") {
          r.file = value;
          const semicolon = raw.indexOf(";");
          if (semicolon >= 0) r.label = raw.slice(semicolon + 1).trim();
        } else {
          const n = numeric(value);
          if (Number.isFinite(n)) {
            if (kind === "SIZE") r.size = n;
            else if (kind === "PAN" || kind === "WAVPAN") r.pan = n;
            else r.volume = n;
          } else {
            p.passthrough.push(raw);
            protectedConstruct(`${index + 1} 行: リソース設定が不正です。`);
          }
        }
      } else if (bpm) {
        const n = numeric(value);
        if (n > 0 && Number.isFinite(n)) {
          if (bpm[1] === "00") p.metadata.bpm = n;
          else p.bpmDefinitions[bpm[1]] = n;
        } else {
          p.passthrough.push(raw);
          protectedConstruct(`${index + 1} 行: BPM 定義が不正です。`);
        }
      } else if (metaKeys[key]) {
        const prop = metaKeys[key];
        if (prop === "bpm" || prop === "baseBpm") {
          const n = numeric(value);
          if (Number.isFinite(n) && (prop === "baseBpm" ? n >= 0 : n > 0))
            p.metadata[prop] = n;
          else {
            p.passthrough.push(raw);
            protectedConstruct(`${index + 1} 行: BPM が不正です。`);
          }
        } else p.metadata[prop] = value;
      } else p.passthrough.push(raw);
    });
  rows.forEach(({ bar, channel, data, line }) => {
    const count = data.length / 2;
    for (let i = 0; i < count; i++) {
      const value = data.slice(i * 2, i * 2 + 2);
      if (value === "00") continue;
      const beat = barStartBeat(p, bar) + (4 * barLengthAt(p, bar) * i) / count;
      const id = `dtx-${line}-${i}-${channel}`;
      if (channel === "03" || channel === "08") {
        const rawBpm =
          channel === "03"
            ? /^[0-9A-F]{2}$/.test(value)
              ? parseInt(value, 16)
              : NaN
            : p.bpmDefinitions[value];
        if (!rawBpm || !Number.isFinite(rawBpm)) {
          protectedConstruct(
            `${line} 行: BPM ${value} を解決できないため読み取り専用です。`,
          );
          continue;
        }
        p.tempos.push({
          id,
          beat,
          bpm: rawBpm + p.metadata.baseBpm,
          channel,
          value,
        });
      } else
        p.notes.push({
          id,
          beat,
          channel,
          value,
          lane: channelToLane(channel),
        });
    }
  });
  p.notes.sort((a, b) => a.beat - b.beat);
  p.tempos.sort(
    (a, b) => a.beat - b.beat || a.channel.localeCompare(b.channel),
  );
  if (
    p.notes.some(
      (n) => isAudioChannel(n.channel) && !p.resources[n.value]?.file,
    )
  )
    p.warnings.push(
      "未定義の WAV を参照するチップがあります。該当音は再生できません。",
    );
  p.originalFingerprint = fingerprint(p);
  return p;
}
function tempoSegments(p: Project): { beat: number; bpm: number }[] {
  return [
    { beat: 0, bpm: p.metadata.bpm },
    ...p.tempos.slice().sort((a, b) => a.beat - b.beat),
  ].filter((t) => Number.isFinite(t.bpm) && t.bpm > 0);
}
export function beatToSeconds(p: Project, beat: number): number {
  let seconds = 0,
    at = 0,
    bpm = p.metadata.bpm;
  for (const t of tempoSegments(p)) {
    if (t.beat > beat) break;
    seconds += ((t.beat - at) * 60) / bpm;
    at = t.beat;
    bpm = t.bpm;
  }
  return seconds + ((beat - at) * 60) / bpm;
}
export function secondsToBeat(p: Project, seconds: number): number {
  let elapsed = 0,
    at = 0,
    bpm = p.metadata.bpm;
  for (const t of tempoSegments(p)) {
    const span = ((t.beat - at) * 60) / bpm;
    if (elapsed + span > seconds) return at + ((seconds - elapsed) * bpm) / 60;
    elapsed += span;
    at = t.beat;
    bpm = t.bpm;
  }
  return at + ((seconds - elapsed) * bpm) / 60;
}
function gcd(a: number, b: number): number {
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}
function denominator(f: number): number {
  for (let d = 1; d <= 65536; d++)
    if (Math.abs(f * d - Math.round(f * d)) < 1e-7) return d;
  throw new Error(
    "チップ位置を DTX の整数グリッドで表せません。位置をクオンタイズしてください。",
  );
}
const safeText = (s: string | number) => String(s).replace(/[\r\n]/g, " ");
export function serializeDTX(p: Project): string {
  if (p.readOnlyReason) {
    if (
      p.originalText !== undefined &&
      p.originalFingerprint === fingerprint(p)
    )
      return p.originalText;
    throw new Error(p.readOnlyReason + " 編集内容を安全に書き出せません。");
  }
  if (!(p.metadata.bpm > 0))
    throw new Error("BPM は 0 より大きくしてください。");
  const lines = ["; DTX Web Editor - DTXManiaNX"];
  for (const [key, prop] of Object.entries(metaKeys)) {
    const value = p.metadata[prop];
    if (
      value !== "" &&
      value !== undefined &&
      !(key === "BASEBPM" && value === 0)
    )
      lines.push(`#${key}: ${safeText(value)}`);
  }
  lines.push(...p.passthrough);
  for (const r of Object.values(p.resources).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (!/^[0-9A-Z]{2}$/.test(r.id))
      throw new Error("WAV ID は 2 桁の英数字にしてください。");
    if (r.file.includes(";"))
      throw new Error(
        "WAV ファイル名にセミコロンは使用できません。DTX ではコメント区切りになります。",
      );
    if (r.file)
      lines.push(
        `#WAV${r.id}: ${safeText(r.file)}${r.label !== undefined ? " ; " + safeText(r.label) : ""}`,
      );
    for (const [key, prop] of [
      ["VOLUME", "volume"],
      ["PAN", "pan"],
      ["SIZE", "size"],
    ] as const)
      if (r[prop] !== undefined) lines.push(`#${key}${r.id}: ${r[prop]}`);
  }
  const defs = { ...p.bpmDefinitions };
  const chips: { beat: number; channel: string; value: string }[] = [
    ...p.notes,
  ];
  for (const t of p.tempos) {
    const relative = t.bpm - p.metadata.baseBpm;
    if (!(relative > 0))
      throw new Error("テンポは BASEBPM より大きくしてください。");
    if (t.channel === "03" && Number.isInteger(relative) && relative <= 255)
      chips.push({
        ...t,
        value: relative.toString(16).toUpperCase().padStart(2, "0"),
      });
    else {
      let id = Object.keys(defs).find(
        (k) => k !== "00" && Math.abs(defs[k] - relative) < 1e-9,
      );
      if (!id) {
        for (let i = 1; i < 1296; i++) {
          const k = i.toString(36).toUpperCase().padStart(2, "0");
          if (defs[k] === undefined) {
            id = k;
            defs[k] = relative;
            break;
          }
        }
      }
      if (!id) throw new Error("拡張 BPM の ID が不足しています。");
      chips.push({ ...t, channel: "08", value: id });
    }
  }
  for (const [id, bpm] of Object.entries(defs)) lines.push(`#BPM${id}: ${bpm}`);
  for (const [bar, length] of Object.entries(p.barLengths)) {
    if (!(length > 0) || !Number.isFinite(length))
      throw new Error("小節長は正の数にしてください。");
    lines.push(`#${encodeBar(Number(bar))}02: ${length}`);
  }
  const groups = new Map<string, { fraction: number; value: string }[]>();
  for (const n of chips) {
    if (
      !/^[0-9A-F]{2}$/.test(n.channel) ||
      !/^[0-9A-Z]{2}$/.test(n.value) ||
      n.value === "00"
    )
      throw new Error("チャンネルまたはチップ ID が不正です。");
    const { bar, fraction } = beatToBar(p, n.beat);
    const key = `${encodeBar(bar)}${n.channel}`;
    const group = groups.get(key) || [];
    group.push({ fraction, value: n.value });
    groups.set(key, group);
  }
  for (const [key, group] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let count = 1;
    for (const n of group) {
      const d = denominator(n.fraction);
      count = (count / gcd(count, d)) * d;
      if (count > 65536)
        throw new Error(
          "小節グリッドが細かすぎます。チップをクオンタイズしてください。",
        );
    }
    const layers: string[][] = [Array<string>(count).fill("00")];
    for (const n of group) {
      const at = Math.round(n.fraction * count);
      let cells = layers.find((row) => row[at] === "00");
      if (!cells) {
        cells = Array<string>(count).fill("00");
        layers.push(cells);
      }
      cells[at] = n.value;
    }
    for (const cells of layers) lines.push(`#${key}: ${cells.join("")}`);
  }
  // Keep intentional trailing empty bars without introducing audible chips.
  if (p.barCount > 1 && !groups.has(`${encodeBar(p.barCount - 1)}11`))
    lines.push(`#${encodeBar(p.barCount - 1)}11: 00`);
  return lines.join("\r\n") + "\r\n";
}
export function createDemoProject(): Project {
  const p = emptyProject();
  p.metadata = {
    ...p.metadata,
    title: "夜明けのグルーヴ",
    artist: "DTX Web Studio",
    comment: "ブラウザーで編集できるデモ譜面",
    bpm: 132,
  };
  p.barCount = 8;
  for (const [i, lane] of LANES.entries())
    p.resources[(i + 1).toString(36).toUpperCase().padStart(2, "0")] = {
      id: (i + 1).toString(36).toUpperCase().padStart(2, "0"),
      file: `${lane.id.toLowerCase()}.wav`,
      volume: 100,
    };
  let id = 0;
  const add = (beat: number, lane: LaneId) => {
    const i = LANES.findIndex((l) => l.id === lane);
    p.notes.push({
      id: `demo-${++id}`,
      beat,
      channel: LANES[i].channel,
      value: (i + 1).toString(36).toUpperCase().padStart(2, "0"),
      lane,
    });
  };
  for (let bar = 0; bar < 8; bar++) {
    for (let i = 0; i < 8; i++) add(bar * 4 + i / 2, "HH");
    add(bar * 4, "BD");
    add(bar * 4 + 2, "BD");
    add(bar * 4 + 1, "SN");
    add(bar * 4 + 3, "SN");
    if (bar % 4 === 0) add(bar * 4, "LC");
    if (bar === 3 || bar === 7) {
      add(bar * 4 + 3.5, "HT");
      add(bar * 4 + 3.75, "LT");
    }
  }
  p.notes.sort((a, b) => a.beat - b.beat);
  return p;
}

/** Exact NX EChannel mapping. Frets are indices R=0,G=1,B=2,Y=3,P=4. */
export interface StringChannel {
  channel: string;
  instrument: "guitar" | "bass";
  pattern: string;
  kind: "note" | "open" | "wail" | "hold" | "wailSound" | "noChip";
  frets: number[];
}
export const STRING_CHANNELS: readonly StringChannel[] = [
  {
    channel: "20",
    instrument: "guitar",
    pattern: "Open",
    kind: "open",
    frets: [],
  },
  {
    channel: "21",
    instrument: "guitar",
    pattern: "xxBxx",
    kind: "note",
    frets: [2],
  },
  {
    channel: "22",
    instrument: "guitar",
    pattern: "xGxxx",
    kind: "note",
    frets: [1],
  },
  {
    channel: "23",
    instrument: "guitar",
    pattern: "xGBxx",
    kind: "note",
    frets: [1, 2],
  },
  {
    channel: "24",
    instrument: "guitar",
    pattern: "Rxxxx",
    kind: "note",
    frets: [0],
  },
  {
    channel: "25",
    instrument: "guitar",
    pattern: "RxBxx",
    kind: "note",
    frets: [0, 2],
  },
  {
    channel: "26",
    instrument: "guitar",
    pattern: "RGxxx",
    kind: "note",
    frets: [0, 1],
  },
  {
    channel: "27",
    instrument: "guitar",
    pattern: "RGBxx",
    kind: "note",
    frets: [0, 1, 2],
  },
  {
    channel: "28",
    instrument: "guitar",
    pattern: "Wailing",
    kind: "wail",
    frets: [],
  },
  {
    channel: "2C",
    instrument: "guitar",
    pattern: "LongNote",
    kind: "hold",
    frets: [],
  },
  {
    channel: "2D",
    instrument: "bass",
    pattern: "LongNote",
    kind: "hold",
    frets: [],
  },
  {
    channel: "2F",
    instrument: "guitar",
    pattern: "WailingSound",
    kind: "wailSound",
    frets: [],
  },
  {
    channel: "93",
    instrument: "guitar",
    pattern: "xxxYx",
    kind: "note",
    frets: [3],
  },
  {
    channel: "94",
    instrument: "guitar",
    pattern: "xxBYx",
    kind: "note",
    frets: [2, 3],
  },
  {
    channel: "95",
    instrument: "guitar",
    pattern: "xGxYx",
    kind: "note",
    frets: [1, 3],
  },
  {
    channel: "96",
    instrument: "guitar",
    pattern: "xGBYx",
    kind: "note",
    frets: [1, 2, 3],
  },
  {
    channel: "97",
    instrument: "guitar",
    pattern: "RxxYx",
    kind: "note",
    frets: [0, 3],
  },
  {
    channel: "98",
    instrument: "guitar",
    pattern: "RxBYx",
    kind: "note",
    frets: [0, 2, 3],
  },
  {
    channel: "99",
    instrument: "guitar",
    pattern: "RGxYx",
    kind: "note",
    frets: [0, 1, 3],
  },
  {
    channel: "9A",
    instrument: "guitar",
    pattern: "RGBYx",
    kind: "note",
    frets: [0, 1, 2, 3],
  },
  {
    channel: "9B",
    instrument: "guitar",
    pattern: "xxxxP",
    kind: "note",
    frets: [4],
  },
  {
    channel: "9C",
    instrument: "guitar",
    pattern: "xxBxP",
    kind: "note",
    frets: [2, 4],
  },
  {
    channel: "9D",
    instrument: "guitar",
    pattern: "xGxxP",
    kind: "note",
    frets: [1, 4],
  },
  {
    channel: "9E",
    instrument: "guitar",
    pattern: "xGBxP",
    kind: "note",
    frets: [1, 2, 4],
  },
  {
    channel: "9F",
    instrument: "guitar",
    pattern: "RxxxP",
    kind: "note",
    frets: [0, 4],
  },
  {
    channel: "A0",
    instrument: "bass",
    pattern: "Open",
    kind: "open",
    frets: [],
  },
  {
    channel: "A1",
    instrument: "bass",
    pattern: "xxBxx",
    kind: "note",
    frets: [2],
  },
  {
    channel: "A2",
    instrument: "bass",
    pattern: "xGxxx",
    kind: "note",
    frets: [1],
  },
  {
    channel: "A3",
    instrument: "bass",
    pattern: "xGBxx",
    kind: "note",
    frets: [1, 2],
  },
  {
    channel: "A4",
    instrument: "bass",
    pattern: "Rxxxx",
    kind: "note",
    frets: [0],
  },
  {
    channel: "A5",
    instrument: "bass",
    pattern: "RxBxx",
    kind: "note",
    frets: [0, 2],
  },
  {
    channel: "A6",
    instrument: "bass",
    pattern: "RGxxx",
    kind: "note",
    frets: [0, 1],
  },
  {
    channel: "A7",
    instrument: "bass",
    pattern: "RGBxx",
    kind: "note",
    frets: [0, 1, 2],
  },
  {
    channel: "A8",
    instrument: "bass",
    pattern: "Wailing",
    kind: "wail",
    frets: [],
  },
  {
    channel: "A9",
    instrument: "guitar",
    pattern: "RxBxP",
    kind: "note",
    frets: [0, 2, 4],
  },
  {
    channel: "AA",
    instrument: "guitar",
    pattern: "RGxxP",
    kind: "note",
    frets: [0, 1, 4],
  },
  {
    channel: "AB",
    instrument: "guitar",
    pattern: "RGBxP",
    kind: "note",
    frets: [0, 1, 2, 4],
  },
  {
    channel: "AC",
    instrument: "guitar",
    pattern: "xxxYP",
    kind: "note",
    frets: [3, 4],
  },
  {
    channel: "AD",
    instrument: "guitar",
    pattern: "xxBYP",
    kind: "note",
    frets: [2, 3, 4],
  },
  {
    channel: "AE",
    instrument: "guitar",
    pattern: "xGxYP",
    kind: "note",
    frets: [1, 3, 4],
  },
  {
    channel: "AF",
    instrument: "guitar",
    pattern: "xGBYP",
    kind: "note",
    frets: [1, 2, 3, 4],
  },
  {
    channel: "BA",
    instrument: "guitar",
    pattern: "NoChip",
    kind: "noChip",
    frets: [],
  },
  {
    channel: "BB",
    instrument: "bass",
    pattern: "NoChip",
    kind: "noChip",
    frets: [],
  },
  {
    channel: "C5",
    instrument: "bass",
    pattern: "xxxYx",
    kind: "note",
    frets: [3],
  },
  {
    channel: "C6",
    instrument: "bass",
    pattern: "xxBYx",
    kind: "note",
    frets: [2, 3],
  },
  {
    channel: "C8",
    instrument: "bass",
    pattern: "xGxYx",
    kind: "note",
    frets: [1, 3],
  },
  {
    channel: "C9",
    instrument: "bass",
    pattern: "xGBYx",
    kind: "note",
    frets: [1, 2, 3],
  },
  {
    channel: "CA",
    instrument: "bass",
    pattern: "RxxYx",
    kind: "note",
    frets: [0, 3],
  },
  {
    channel: "CB",
    instrument: "bass",
    pattern: "RxBYx",
    kind: "note",
    frets: [0, 2, 3],
  },
  {
    channel: "CC",
    instrument: "bass",
    pattern: "RGxYx",
    kind: "note",
    frets: [0, 1, 3],
  },
  {
    channel: "CD",
    instrument: "bass",
    pattern: "RGBYx",
    kind: "note",
    frets: [0, 1, 2, 3],
  },
  {
    channel: "CE",
    instrument: "bass",
    pattern: "xxxxP",
    kind: "note",
    frets: [4],
  },
  {
    channel: "CF",
    instrument: "bass",
    pattern: "xxBxP",
    kind: "note",
    frets: [2, 4],
  },
  {
    channel: "D0",
    instrument: "guitar",
    pattern: "RxxYP",
    kind: "note",
    frets: [0, 3, 4],
  },
  {
    channel: "D1",
    instrument: "guitar",
    pattern: "RxBYP",
    kind: "note",
    frets: [0, 2, 3, 4],
  },
  {
    channel: "D2",
    instrument: "guitar",
    pattern: "RGxYP",
    kind: "note",
    frets: [0, 1, 3, 4],
  },
  {
    channel: "D3",
    instrument: "guitar",
    pattern: "RGBYP",
    kind: "note",
    frets: [0, 1, 2, 3, 4],
  },
  {
    channel: "DA",
    instrument: "bass",
    pattern: "xGxxP",
    kind: "note",
    frets: [1, 4],
  },
  {
    channel: "DB",
    instrument: "bass",
    pattern: "xGBxP",
    kind: "note",
    frets: [1, 2, 4],
  },
  {
    channel: "DC",
    instrument: "bass",
    pattern: "RxxxP",
    kind: "note",
    frets: [0, 4],
  },
  {
    channel: "DD",
    instrument: "bass",
    pattern: "RxBxP",
    kind: "note",
    frets: [0, 2, 4],
  },
  {
    channel: "DE",
    instrument: "bass",
    pattern: "RGxxP",
    kind: "note",
    frets: [0, 1, 4],
  },
  {
    channel: "DF",
    instrument: "bass",
    pattern: "RGBxP",
    kind: "note",
    frets: [0, 1, 2, 4],
  },
  {
    channel: "E1",
    instrument: "bass",
    pattern: "xxxYP",
    kind: "note",
    frets: [3, 4],
  },
  {
    channel: "E2",
    instrument: "bass",
    pattern: "xxBYP",
    kind: "note",
    frets: [2, 3, 4],
  },
  {
    channel: "E3",
    instrument: "bass",
    pattern: "xGxYP",
    kind: "note",
    frets: [1, 3, 4],
  },
  {
    channel: "E4",
    instrument: "bass",
    pattern: "xGBYP",
    kind: "note",
    frets: [1, 2, 3, 4],
  },
  {
    channel: "E5",
    instrument: "bass",
    pattern: "RxxYP",
    kind: "note",
    frets: [0, 3, 4],
  },
  {
    channel: "E6",
    instrument: "bass",
    pattern: "RxBYP",
    kind: "note",
    frets: [0, 2, 3, 4],
  },
  {
    channel: "E7",
    instrument: "bass",
    pattern: "RGxYP",
    kind: "note",
    frets: [0, 1, 3, 4],
  },
  {
    channel: "E8",
    instrument: "bass",
    pattern: "RGBYP",
    kind: "note",
    frets: [0, 1, 2, 3, 4],
  },
];
export const GUITAR_CHANNELS = STRING_CHANNELS.filter(
  (c) => c.instrument === "guitar",
);
export const BASS_CHANNELS = STRING_CHANNELS.filter(
  (c) => c.instrument === "bass",
);
export function stringChannel(channel: string): StringChannel | undefined {
  return STRING_CHANNELS.find((c) => c.channel === channel.toUpperCase());
}

/** WAV references also include empty-hit sample assignments, which do not auto-play. */
export function isWavReferenceChannel(channel: string): boolean {
  const n = parseInt(channel, 16);
  return isAudioChannel(channel) || (n >= 0xb1 && n <= 0xbe);
}
