/** Portable live MIDI configuration. Channels are human-facing 1–16, never status nibbles. */
export interface MidiTarget {
  channel: string;
  value: string;
}
export interface MidiDeviceIdentity {
  portId: string;
  name: string;
  manufacturer: string;
}
export interface MidiMapping {
  id: string;
  channel: number;
  note: number;
  zone: string;
  target: MidiTarget;
  hiHat?: { closed: MidiTarget; open: MidiTarget; halfOpen?: MidiTarget };
}
export interface MidiPedal {
  channel: number;
  cc: number;
  invert: boolean;
  openMax: number;
  closedMin: number;
  hysteresis: number;
  staleMs: number;
  footClose?: MidiTarget;
  splash?: MidiTarget;
  splashWindowMs: number;
}
export interface MidiProfile {
  id: string;
  name: string;
  mode: string;
  latencyMs?: number;
  device: MidiDeviceIdentity;
  mappings: MidiMapping[];
  pedal?: MidiPedal;
}
export interface MidiProfileFile {
  version: 1;
  profiles: MidiProfile[];
}
export const MIDI_PROFILE_STORAGE_KEY = "dtx-midi-profiles-v1";
const drumChannels = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "1A",
  "1B",
  "1C",
]);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("MIDI 設定の形式が不正です。");
  return v as Record<string, unknown>;
}
function str(v: unknown, max = 160): string {
  if (typeof v !== "string" || v.length > max)
    throw new Error("MIDI 設定の文字列が不正です。");
  return v;
}
function num(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error("MIDI 設定の数値が範囲外です。");
  return v;
}
function int(v: unknown, min: number, max: number): number {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) throw new Error("MIDI 設定には整数が必要です。");
  return n;
}
function target(v: unknown): MidiTarget {
  const o = object(v),
    channel = str(o.channel).toUpperCase(),
    value = str(o.value).toUpperCase();
  if (
    !drumChannels.has(channel) ||
    !/^[0-9A-Z]{2}$/.test(value) ||
    value === "00"
  )
    throw new Error("MIDI の DTX チャンネル / WAV ID が不正です。");
  return { channel, value };
}
export function validateMidiProfile(v: unknown): MidiProfile {
  const o = object(v),
    d = object(o.device);
  if (!Array.isArray(o.mappings) || o.mappings.length > 512)
    throw new Error("MIDI マッピングが多すぎます。");
  const p: MidiProfile = {
    id: str(o.id),
    name: str(o.name),
    mode: str(o.mode),
    ...(o.latencyMs === undefined
      ? {}
      : { latencyMs: num(o.latencyMs, -1000, 1000) }),
    device: {
      portId: str(d.portId, 512),
      name: str(d.name),
      manufacturer: str(d.manufacturer),
    },
    mappings: o.mappings.map((v) => {
      const m = object(v);
      const out: MidiMapping = {
        id: str(m.id),
        channel: int(m.channel, 1, 16),
        note: int(m.note, 0, 127),
        zone: str(m.zone),
        target: target(m.target),
      };
      if (m.hiHat !== undefined) {
        const h = object(m.hiHat);
        out.hiHat = { closed: target(h.closed), open: target(h.open) };
        if (h.halfOpen !== undefined) out.hiHat.halfOpen = target(h.halfOpen);
        for (const t of Object.values(out.hiHat))
          if (t.channel !== "11" && t.channel !== "18")
            throw new Error("HH は 11 / 18 チャンネルを使用してください。");
      }
      return out;
    }),
  };
  if (
    !p.id ||
    new Set(p.mappings.map((m) => `${m.channel}:${m.note}`)).size !==
      p.mappings.length ||
    new Set(p.mappings.map((m) => m.id)).size !== p.mappings.length
  )
    throw new Error(
      "MIDI マッピングの ID / チャンネル / ノートが重複しています。",
    );
  if (o.pedal !== undefined) {
    const q = object(o.pedal);
    if (typeof q.invert !== "boolean")
      throw new Error("ペダル方向が不正です。");
    p.pedal = {
      channel: int(q.channel, 1, 16),
      cc: int(q.cc, 0, 127),
      invert: q.invert,
      openMax: num(q.openMax, 0, 126),
      closedMin: num(q.closedMin, 1, 127),
      hysteresis: num(q.hysteresis, 0, 32),
      staleMs: num(q.staleMs, 100, 600000),
      splashWindowMs: num(q.splashWindowMs, 20, 1000),
    };
    if (
      p.pedal.openMax + p.pedal.hysteresis >=
      p.pedal.closedMin - p.pedal.hysteresis
    )
      throw new Error("ペダルの開閉しきい値が近すぎます。");
    if (q.footClose !== undefined) p.pedal.footClose = target(q.footClose);
    if (q.splash !== undefined) p.pedal.splash = target(q.splash);
  }
  return p;
}
export function importMidiProfiles(json: string): MidiProfile[] {
  if (json.length > 1_000_000)
    throw new Error("MIDI 設定ファイルが大きすぎます。");
  const o = object(JSON.parse(json));
  // Only our explicit v0 envelope is migrated; unknown versions are never guessed.
  if (o.version !== 1 && o.version !== 0)
    throw new Error("未対応の MIDI 設定バージョンです。");
  if (!Array.isArray(o.profiles) || o.profiles.length > 100)
    throw new Error("MIDI プロファイル数が不正です。");
  const profiles = o.profiles.map(validateMidiProfile);
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new Error("プロファイル ID が重複しています。");
  return profiles;
}
export function exportMidiProfiles(profiles: MidiProfile[]): string {
  return JSON.stringify(
    { version: 1, profiles: profiles.map(validateMidiProfile) },
    null,
    2,
  );
}
export function loadMidiProfiles(
  storage: Pick<Storage, "getItem"> = localStorage,
): MidiProfile[] {
  const text = storage.getItem(MIDI_PROFILE_STORAGE_KEY);
  return text ? importMidiProfiles(text) : [];
}
export function saveMidiProfiles(
  profiles: MidiProfile[],
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(MIDI_PROFILE_STORAGE_KEY, exportMidiProfiles(profiles));
}
/** Starter only, not a Roland/Yamaha device preset. Learn and calibrate before recording. */
export function createDefaultMidiProfile(
  device: MidiDeviceIdentity,
): MidiProfile {
  return {
    id: crypto.randomUUID(),
    name: device.name || "MIDI ドラム",
    mode: "標準",
    device: { ...device },
    mappings: [36, 38, 42, 46, 44, 48, 45, 41, 49, 51].map((note, i) => ({
      id: `gm-${note}`,
      channel: 10,
      note,
      zone: [
        "kick",
        "snare",
        "HH bow",
        "HH open",
        "foot",
        "high tom",
        "low tom",
        "floor tom",
        "crash",
        "ride",
      ][i],
      target: {
        channel: ["13", "12", "11", "18", "1B", "14", "15", "17", "16", "19"][
          i
        ],
        value: (i + 1).toString(36).toUpperCase().padStart(2, "0"),
      },
    })),
    pedal: {
      channel: 10,
      cc: 4,
      invert: false,
      openMax: 32,
      closedMin: 96,
      hysteresis: 4,
      staleMs: 10000,
      splashWindowMs: 180,
    },
  };
}
/** Use two captured raw CC values; leaves a broad half-open band and hysteresis. */
export function calibrateMidiPedal(
  pedal: MidiPedal,
  openValue: number,
  closedValue: number,
): MidiPedal {
  int(openValue, 0, 127);
  int(closedValue, 0, 127);
  if (Math.abs(openValue - closedValue) < 16)
    throw new Error(
      "開 / 閉の値が近すぎます。ペダルを動かして再測定してください。",
    );
  const invert = closedValue < openValue;
  const lo = invert ? 127 - openValue : openValue,
    hi = invert ? 127 - closedValue : closedValue;
  const width = hi - lo;
  return {
    ...pedal,
    invert,
    openMax: lo + width * 0.25,
    closedMin: hi - width * 0.25,
    hysteresis: Math.min(4, width * 0.1),
  };
}
