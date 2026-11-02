import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, beatToSeconds } from "../src/chart.js";
import { parseMIDI, serializeMIDI } from "../src/midi.js";
const smf = (track: number[], format = 0, division = 96) =>
  new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    1,
    division >> 8,
    division & 255,
    77,
    84,
    114,
    107,
    0,
    0,
    track.length >> 8,
    track.length & 255,
    ...track,
  ]);
test("MIDI percussion round trip retains HH open/closed, LC, RC, RD and all drum lanes", () => {
  const p = parseDTX(
    "#BPM: 120\n#00011: 01\n#00018: 0001\n#0001A: 01\n#00016: 0001\n#00019: 00000100\n#0011B: 01\n#0011C: 0001\n#00112: 01\n#00114: 01\n#00115: 01\n#00117: 01",
  );
  const q = parseMIDI(serializeMIDI(p));
  assert.equal(q.notes.length, p.notes.length);
  for (const ch of ["11", "18", "1A", "16", "19", "1B", "12", "14", "15", "17"])
    assert.ok(
      q.notes.some((n) => n.channel === ch),
      ch,
    );
  assert.ok(q.warnings.some((w) => w.includes("音声サンプル")));
});
test("tempo changes and persistent 3/4 -> 5/8 measures round trip", () => {
  const p = parseDTX(
    "#BPM: 120\n#BPM01: 150\n#00002: 0.75\n#00202: 0.625\n#00108: 01\n#00311: 01",
  );
  const q = parseMIDI(serializeMIDI(p));
  assert.equal(q.metadata.bpm, 120);
  assert.equal(q.tempos[0].bpm, 150);
  assert.equal(q.tempos[0].beat, 3);
  assert.equal(q.barLengths[0], 0.75);
  assert.equal(q.barLengths[2], 0.625);
  assert.equal(q.notes[0].beat, 8.5);
  assert.equal(beatToSeconds(q, 10), beatToSeconds(p, 10));
});
test("running status and note-on velocity zero are handled", () => {
  const p = parseMIDI(
    smf([0, 0x99, 42, 64, 96, 38, 100, 0, 42, 0, 0, 0xff, 0x2f, 0]),
  );
  assert.equal(p.notes.length, 2);
  assert.deepEqual(
    p.notes.map((n) => n.beat),
    [0, 1],
  );
  assert.equal(p.resources[p.notes[0].value].volume, (64 * 100) / 127);
});
test("non percussion and unsupported GM keys are explicitly warned", () => {
  const p = parseMIDI(
    smf([0, 0x90, 60, 100, 0, 0x99, 60, 100, 0, 0xff, 0x2f, 0]),
  );
  assert.equal(p.notes.length, 0);
  assert.ok(p.warnings.some((w) => w.includes("ドラム以外")));
  assert.ok(p.warnings.some((w) => w.includes("未対応")));
});
test("SMPTE, format 2, malformed VLQ, truncation and bad running status fail clearly", () => {
  assert.throws(() => parseMIDI(smf([0, 0xff, 0x2f, 0], 0, 0xe728)), /SMPTE/);
  assert.throws(() => parseMIDI(smf([], 2)), /形式 2/);
  assert.throws(() => parseMIDI(smf([0x81, 0x81, 0x81, 0x81, 0])), /4 バイト/);
  assert.throws(() => parseMIDI(smf([0, 42, 60])), /ステータス/);
  assert.throws(() => parseMIDI(new Uint8Array([77, 84])), /切れ/);
});
test("mid-measure time signature creates a short measure without shifting notes", () => {
  const p = parseMIDI(
    smf([96, 0xff, 0x58, 4, 3, 2, 24, 8, 96, 0x99, 42, 100, 0, 0xff, 0x2f, 0]),
  );
  assert.equal(p.barLengths[0], 0.25);
  assert.equal(p.barLengths[1], 0.75);
  assert.equal(p.notes[0].beat, 2);
  assert.ok(p.warnings.some((w) => w.includes("短い小節")));
});
test("non-percussion DTX channels do not leak into MIDI", () => {
  const p = parseDTX("#00011: 01\n#00054: 01\n#00004: 01\n#00021: 01");
  assert.equal(parseMIDI(serializeMIDI(p)).notes.length, 1);
});
test("unrepresentable DTX measure lengths and unsupported read-only charts reject", () => {
  const p = parseDTX("#00002: 0.3\n#00011: 01");
  assert.throws(() => serializeMIDI(p), /拍子/);
  assert.throws(
    () => serializeMIDI(parseDTX("#RANDOM 2\n#00011: 01")),
    /読み取り専用/,
  );
});
test("format 1 merges separate tempo and drum tracks", () => {
  const tempo = [0, 0xff, 0x51, 3, 0x06, 0x1a, 0x80, 0, 0xff, 0x2f, 0],
    notes = [96, 0x99, 49, 100, 0, 0xff, 0x2f, 0];
  const b = smf(tempo, 1);
  b[11] = 2;
  const bytes = new Uint8Array([
    ...b,
    77,
    84,
    114,
    107,
    0,
    0,
    0,
    notes.length,
    ...notes,
  ]);
  const p = parseMIDI(bytes);
  assert.equal(p.metadata.bpm, 150);
  assert.equal(p.notes[0].beat, 1);
  assert.equal(p.notes[0].lane, "LC");
});
