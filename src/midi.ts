/** Standard MIDI File 0/1 exchange. GM percussion only; sound samples are not MIDI data. */
import {
  parseDTX,
  channelToLane,
  barStartBeat,
  durationBeats,
  type Project,
} from "./chart.js";

export const MIDI_TO_DTX: Readonly<Record<number, string>> = {
  35: "13",
  36: "13",
  37: "12",
  38: "12",
  39: "12",
  40: "12",
  41: "17",
  43: "17",
  45: "15",
  47: "15",
  48: "14",
  50: "14",
  42: "11",
  44: "1B",
  46: "18",
  49: "1A",
  57: "16",
  51: "19",
  53: "19",
  59: "19",
  52: "16",
  55: "1A",
};
export const DTX_TO_MIDI: Readonly<Record<string, number>> = {
  "11": 42,
  "12": 38,
  "13": 36,
  "14": 50,
  "15": 47,
  "16": 57,
  "17": 43,
  "18": 46,
  "19": 51,
  "1A": 49,
  "1B": 44,
  "1C": 35,
};
const fail = (message: string): never => {
  throw new Error(`MIDI: ${message}`);
};
class Reader {
  at = 0;
  constructor(readonly data: Uint8Array) {}
  need(n: number) {
    if (n < 0 || this.at + n > this.data.length)
      fail("ファイルが途中で切れています。");
  }
  u8() {
    this.need(1);
    return this.data[this.at++];
  }
  u16() {
    return this.u8() * 256 + this.u8();
  }
  u32() {
    return (
      this.u8() * 0x1000000 + this.u8() * 65536 + this.u8() * 256 + this.u8()
    );
  }
  take(n: number) {
    this.need(n);
    const data = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return data;
  }
  ascii(n: number) {
    return String.fromCharCode(...this.take(n));
  }
  vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      n = n * 128 + (b & 127);
      if (!(b & 128)) return n;
    }
    return fail("可変長数値が 4 バイトを超えています。");
  }
}
interface Imported {
  tick: number;
  kind: "note" | "tempo" | "signature";
  a: number;
  b: number;
  order: number;
}
export function parseMIDI(bytes: Uint8Array): Project {
  const r = new Reader(bytes);
  if (r.ascii(4) !== "MThd") fail("SMF ヘッダーがありません。");
  const headerLength = r.u32();
  if (headerLength < 6) fail("ヘッダー長が不正です。");
  const format = r.u16(),
    tracks = r.u16(),
    division = r.u16();
  r.take(headerLength - 6);
  if (format > 1)
    fail(
      "形式 2 の非同期トラックには対応していません。形式 0 / 1 を使用してください。",
    );
  if (!tracks || (format === 0 && tracks !== 1)) fail("トラック数が不正です。");
  if (!division || division & 0x8000)
    fail("SMPTE 時刻形式には対応していません。PPQN 形式を使用してください。");
  const p = parseDTX("");
  delete p.originalText;
  delete p.originalFingerprint;
  p.metadata.title = "MIDI インポート";
  p.warnings.push(
    "MIDI は音声サンプルを含みません。GM のドラム（チャンネル 10）のみ取り込みます。WAV 素材は別途割り当ててください。",
  );
  const events: Imported[] = [];
  let order = 0,
    lastTick = 0,
    ignoredMelody = 0,
    ignoredDrums = 0;
  for (let track = 0; track < tracks; track++) {
    if (r.ascii(4) !== "MTrk") fail("MTrk チャンクがありません。");
    const tr = new Reader(r.take(r.u32()));
    let tick = 0,
      running = 0;
    while (tr.at < tr.data.length) {
      tick += tr.vlq();
      lastTick = Math.max(lastTick, tick);
      let status = tr.u8(),
        first: number | undefined;
      if (status < 0x80) {
        if (!running) fail("ランニングステータスが不正です。");
        first = status;
        status = running;
      } else if (status < 0xf0) running = status;
      if (status === 0xff) {
        running = 0;
        const type = tr.u8(),
          data = tr.take(tr.vlq());
        if (type === 0x2f) {
          if (data.length !== 0) fail("トラック終了イベントが不正です。");
          break;
        }
        if (type === 0x51) {
          if (data.length !== 3) fail("テンポイベント長が不正です。");
          const us = data[0] * 65536 + data[1] * 256 + data[2];
          if (!us) fail("テンポは正の値が必要です。");
          events.push({
            tick,
            kind: "tempo",
            a: 60000000 / us,
            b: 0,
            order: order++,
          });
        }
        if (type === 0x58) {
          if (data.length !== 4 || !data[0] || data[1] > 7)
            fail("拍子イベントが不正です。");
          events.push({
            tick,
            kind: "signature",
            a: data[0],
            b: 2 ** data[1],
            order: order++,
          });
        }
        if (
          type === 0x03 &&
          p.metadata.title === "MIDI インポート" &&
          data.length
        )
          p.metadata.title = new TextDecoder().decode(data);
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0;
        tr.take(tr.vlq());
      } else if (status >= 0xf0) fail("未対応のシステムイベントです。");
      else {
        const kind = status >> 4,
          channel = status & 15,
          a = first ?? tr.u8(),
          b = kind === 0xc || kind === 0xd ? 0 : tr.u8();
        if (a >= 128 || b >= 128) fail("MIDI データバイトが不正です。");
        if (kind === 9 && b > 0) {
          if (channel !== 9) ignoredMelody++;
          else if (!MIDI_TO_DTX[a]) ignoredDrums++;
          else events.push({ tick, kind: "note", a, b, order: order++ });
        }
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const resourceKeys = new Map<string, string>();
  for (const e of events) {
    const beat = e.tick / division;
    if (e.kind === "tempo") {
      if (e.tick === 0) p.metadata.bpm = e.a;
      else
        p.tempos.push({
          id: `midi-tempo-${e.order}`,
          beat,
          bpm: e.a,
          channel: "08",
          value: "01",
        });
    }
    if (e.kind === "note") {
      const key = `${e.a}:${e.b}`;
      let value = resourceKeys.get(key);
      if (!value) {
        if (resourceKeys.size >= 1295)
          fail(
            "WAV リソース数が 1295 を超えます。MIDI ベロシティを整理してください。",
          );
        value = (resourceKeys.size + 1)
          .toString(36)
          .toUpperCase()
          .padStart(2, "0");
        resourceKeys.set(key, value);
        p.resources[value] = { id: value, file: "", volume: (e.b * 100) / 127 };
      }
      const channel = MIDI_TO_DTX[e.a];
      p.notes.push({
        id: `midi-note-${e.order}`,
        beat,
        channel,
        value,
        lane: channelToLane(channel),
      });
    }
  }
  // A mid-measure signature starts a new measure; shorten the preceding partial measure, without moving any event.
  let bar = 0,
    start = 0,
    length = 4;
  for (const e of events.filter((e) => e.kind === "signature")) {
    const beat = e.tick / division;
    while (start + length <= beat + 1e-8) {
      start += length;
      bar++;
      if (bar > 3599) fail("小節数が DTX の範囲を超えます。");
    }
    if (beat > start + 1e-8) {
      p.barLengths[bar] = (beat - start) / 4;
      bar++;
      start = beat;
      p.warnings.push(
        "小節途中の拍子変更は、その位置で短い小節に分割しました。",
      );
    }
    length = (e.a * 4) / e.b;
    p.barLengths[bar] = length / 4;
  }
  const end = lastTick / division;
  let total = 0,
    count = 0,
    ratio = 1;
  do {
    if (p.barLengths[count] !== undefined) ratio = p.barLengths[count];
    total += 4 * ratio;
    count++;
    if (count > 3600) fail("小節数が DTX の範囲を超えます。");
  } while (total < end - 1e-8 || p.notes.some((n) => n.beat >= total - 1e-8));
  p.barCount = count;
  if (ignoredMelody)
    p.warnings.push(
      `ドラム以外のノート ${ignoredMelody} 個は取り込んでいません。`,
    );
  if (ignoredDrums)
    p.warnings.push(
      `未対応の GM 打楽器ノート ${ignoredDrums} 個は取り込んでいません。`,
    );
  return p;
}
function vlq(n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xfffffff)
    fail("イベント間隔が SMF の範囲を超えます。");
  const a = [n & 127];
  while ((n = Math.floor(n / 128))) a.unshift((n & 127) | 128);
  return a;
}
function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function signature(ratio: number): [number, number] {
  for (const power of [2, 3, 4, 5, 6, 7, 1, 0]) {
    const n = ratio * 2 ** power;
    if (n > 0 && n <= 255 && Math.abs(n - Math.round(n)) < 1e-8)
      return [Math.round(n), power];
  }
  return fail("この小節長は MIDI の拍子で正確に表せません。");
}
/** Export GM drum hits, tempo and measure lengths; guitar, media and audio samples are not representable. */
export function serializeMIDI(p: Project): Uint8Array<ArrayBuffer> {
  if (p.readOnlyReason)
    fail("分岐や再定義を含む読み取り専用譜面は MIDI に変換できません。");
  const ppqn = 9600,
    events: { tick: number; priority: number; data: number[] }[] = [];
  const at = (beat: number) => {
    if (!Number.isFinite(beat) || beat < 0) fail("拍位置が不正です。");
    const ticks = beat * ppqn;
    if (Math.abs(ticks - Math.round(ticks)) > 1e-5)
      fail("ノート位置を MIDI の 9600 PPQN グリッドで正確に表せません。");
    return Math.round(ticks);
  };
  const add = (beat: number, priority: number, data: number[]) =>
    events.push({ tick: at(beat), priority, data });
  const tempo = (beat: number, bpm: number) => {
    const us = Math.round(60000000 / bpm);
    if (!Number.isFinite(us) || us < 1 || us > 0xffffff)
      fail("BPM が MIDI の範囲外です。");
    add(beat, 0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]);
  };
  const title = Array.from(new TextEncoder().encode(p.metadata.title));
  add(0, -2, [0xff, 3, ...vlq(title.length), ...title]);
  tempo(0, p.metadata.bpm);
  for (const t of p.tempos) tempo(t.beat, t.bpm);
  const lengths = { 0: 1, ...p.barLengths };
  for (const [bar, ratio] of Object.entries(lengths)) {
    const [n, d] = signature(ratio);
    add(barStartBeat(p, Number(bar)), -1, [0xff, 0x58, 4, n, d, 24, 8]);
  }
  for (const n of p.notes) {
    const pitch = DTX_TO_MIDI[n.channel.toUpperCase()];
    if (pitch === undefined) continue;
    const volume = p.resources[n.value]?.volume ?? 100;
    const velocity = Math.max(
      1,
      Math.min(127, Math.round((volume * 127) / 100)),
    );
    if (volume <= 0) continue;
    add(n.beat, 2, [0x99, pitch, velocity]);
    add(n.beat + 1 / 32, 1, [0x89, pitch, 0]);
  }
  const end = Math.max(at(durationBeats(p)), ...events.map((e) => e.tick));
  events.push({ tick: end, priority: 9, data: [0xff, 0x2f, 0] });
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  let previous = 0;
  const track: number[] = [];
  for (const e of events) {
    track.push(...vlq(e.tick - previous), ...e.data);
    previous = e.tick;
  }
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    (ppqn >> 8) & 255,
    ppqn & 255,
    77,
    84,
    114,
    107,
    ...u32(track.length),
    ...track,
  ]);
}
