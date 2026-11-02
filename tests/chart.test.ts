import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDTX,
  serializeDTX,
  createDemoProject,
  beatToSeconds,
  secondsToBeat,
  durationBeats,
  barStartBeat,
  barLengthAt,
  beatToBar,
  channelToLane,
  isAudioChannel,
  encodeBar,
  decodeBar,
} from "../src/chart.js";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("metadata, Japanese filenames and WAV settings parse and round trip", () => {
  const p = parseDTX(
    "#TITLE: 夜明け\n#ARTIST: 作者\n#COMMENT: テスト\n#BPM: 123.5\n#PREVIEW: demo.ogg\n#WAVAZ: 素材/音.wav\n#WAVVOLAZ: 80\n#WAVPANAZ: -30\n#SIZEAZ: 90\n#00011: AZ",
  );
  assert.equal(p.metadata.title, "夜明け");
  assert.equal(p.resources.AZ.file, "素材/音.wav");
  assert.equal(p.resources.AZ.volume, 80);
  assert.equal(p.resources.AZ.pan, -30);
  assert.equal(p.resources.AZ.size, 90);
  const q = parseDTX(serializeDTX(p));
  assert.deepEqual(q.metadata, p.metadata);
  assert.deepEqual(q.resources, p.resources);
});
test("correct NX drum channel mapping", () => {
  for (const [ch, lane] of Object.entries({
    "11": "HH",
    "18": "HH",
    "16": "RC",
    "19": "RD",
    "1A": "LC",
    "1B": "LP",
    "1C": "BD",
    "17": "FT",
  }))
    assert.equal(channelToLane(ch), lane);
  assert.equal(channelToLane("54"), undefined);
});
test("mixed persistent bar lengths use absolute quarter-note beats", () => {
  const p = parseDTX(
    "#00002: 0.75\n#00202: 1.5\n#00011: 0001\n#00112: 01\n#00213: 0001\n#00316: 01",
  );
  assert.deepEqual(
    p.notes.map((n) => n.beat),
    [1.5, 3, 9, 12],
  );
  near(barStartBeat(p, 4), 18);
  assert.equal(barLengthAt(p, 1), 0.75);
  assert.equal(barLengthAt(p, 3), 1.5);
  assert.deepEqual(beatToBar(p, 9), {
    bar: 2,
    fraction: 0.5,
    startBeat: 6,
    length: 6,
  });
  near(durationBeats(p), 18);
  assert.deepEqual(
    parseDTX(serializeDTX(p)).notes.map((n) => n.beat),
    p.notes.map((n) => n.beat),
  );
});
test("03 is hexadecimal and 08 is base36, BASEBPM offsets changes not initial BPM", () => {
  const p = parseDTX(
    "#BPM: 120\n#BASEBPM: 10\n#BPMGZ: 170.5\n#00003: 0078\n#00108: GZ",
  );
  assert.deepEqual(
    p.tempos.map((t) => t.bpm),
    [130, 180.5],
  );
  near(beatToSeconds(p, 2), 1);
  near(beatToSeconds(p, 4), 1 + 120 / 130);
  near(beatToSeconds(p, 5), 1 + 120 / 130 + 60 / 180.5);
  const q = parseDTX(serializeDTX(p));
  assert.deepEqual(
    q.tempos.map((t) => t.bpm),
    [130, 180.5],
  );
});
test("timing inverse works before, on and after tempo boundaries", () => {
  const p = parseDTX(
    "#BPM: 97.5\n#BPM01: 207.3\n#00003: 0000C800\n#00208: 0001",
  );
  for (let beat = 0; beat < 30; beat += 0.03125)
    near(secondsToBeat(p, beatToSeconds(p, beat)), beat);
});
test("unknown channels, guitar, BGA, AVI and definitions survive edits", () => {
  const p = parseDTX(
    "#BMP01: cover.png\n#BMPTEX02: tex.png\n#AVI03: clip.avi\n#AVIPAN04: 03,1,2,3\n#CUSTOM: unknown\n#DLEVEL: 56\n#00004: 01\n#00054: 03\n#000D3: 04\n#000FE: ZZ",
  );
  p.metadata.title = "edited";
  const out = serializeDTX(p);
  for (const str of [
    "#BMP01: cover.png",
    "#BMPTEX02: tex.png",
    "#AVI03: clip.avi",
    "#AVIPAN04: 03,1,2,3",
    "#CUSTOM: unknown",
    "#DLEVEL: 56",
  ])
    assert.ok(out.includes(str));
  assert.deepEqual(
    parseDTX(out).notes.map((n) => [n.channel, n.value]),
    [
      ["04", "01"],
      ["54", "03"],
      ["D3", "04"],
      ["FE", "ZZ"],
    ],
  );
});
test("audio channel dispatch excludes pictures, movies, wailing and reserved controls", () => {
  for (const ch of [
    "01",
    "11",
    "18",
    "1C",
    "20",
    "27",
    "31",
    "61",
    "70",
    "80",
    "90",
    "93",
    "A0",
    "A9",
    "D3",
    "E8",
  ])
    assert.ok(isAudioChannel(ch), ch);
  for (const ch of [
    "04",
    "08",
    "28",
    "29",
    "2C",
    "50",
    "54",
    "5A",
    "60",
    "8A",
    "A8",
    "B1",
    "C4",
    "D5",
    "E0",
    "FE",
  ])
    assert.equal(isAudioChannel(ch), false, ch);
});
test("random blocks exported byte-for-byte when untouched, edits rejected", () => {
  const raw =
    "; test\r\n#RANDOM 2\r\n#IF 1\r\n#00011: 01\r\n#ELSE\r\n#00012: 02\r\n#ENDIF\r\n";
  const p = parseDTX(raw);
  assert.ok(p.readOnlyReason);
  assert.equal(serializeDTX(p), raw);
  p.metadata.title = "change";
  assert.throws(() => serializeDTX(p), /安全/);
});
test("scoped redefinitions do not flatten silently", () => {
  for (const raw of [
    "#WAV01: first.wav\n#00011: 01\n#WAV01: second.wav\n#00111: 01",
    "#BPM01: 120\n#00008: 01\n#BPM01: 180\n#00108: 01",
    "#VOLUME01: 50\n#WAVVOL01: 70",
  ]) {
    const p = parseDTX(raw);
    assert.ok(p.readOnlyReason);
    assert.equal(serializeDTX(p), raw);
    p.notes.push({ id: "x", beat: 0, channel: "11", value: "01" });
    assert.throws(() => serializeDTX(p));
  }
});
test("missing tempo definition and malformed chips preserve original instead of losing data", () => {
  for (const raw of ["#00008: ZZ", "#00011: 123", "#00003: GG", "#00002: 0"]) {
    const p = parseDTX(raw);
    assert.ok(p.warnings.length);
    assert.ok(p.readOnlyReason);
    assert.equal(serializeDTX(p), raw);
  }
});
test("missing WAV resources warn but chart remains editable", () => {
  const p = parseDTX("#00011: 01");
  assert.ok(p.warnings.length);
  assert.equal(p.readOnlyReason, undefined);
  assert.equal(parseDTX(serializeDTX(p)).notes.length, 1);
});
test("mixed-radix measure numbers support 000 through Z99", () => {
  assert.equal(encodeBar(1000), "A00");
  assert.equal(decodeBar("Z99"), 3599);
  assert.throws(() => encodeBar(3600));
  const p = parseDTX("#A0011: 01\n#Z9912: 02");
  assert.equal(p.barCount, 3600);
  assert.deepEqual(
    p.notes.map((n) => n.beat),
    [4000, 14396],
  );
  assert.ok(serializeDTX(p).includes("#Z9912: 02"));
});
test("triplets, quintuplets and edited grid positions survive", () => {
  const p = parseDTX("#00011: 010001\n#00012: 0100000001");
  const q = parseDTX(serializeDTX(p));
  assert.deepEqual(
    q.notes.map((n) => [n.channel, n.beat]).sort(),
    p.notes.map((n) => [n.channel, n.beat]).sort(),
  );
});
test("tempo editing allocates extended definition rather than rounding", () => {
  const p = parseDTX("#BPM: 120\n#00003: 78");
  p.tempos[0].bpm = 321.75;
  const out = serializeDTX(p);
  const q = parseDTX(out);
  assert.equal(q.tempos[0].bpm, 321.75);
  assert.equal(q.tempos[0].channel, "08");
});
test("stable parsed IDs are unique and repeatable", () => {
  const raw = "#00011: 01010101\n#00012: 0101";
  assert.deepEqual(
    parseDTX(raw).notes.map((n) => n.id),
    parseDTX(raw).notes.map((n) => n.id),
  );
  assert.equal(new Set(parseDTX(raw).notes.map((n) => n.id)).size, 6);
});
test("demo exports and reparses without note or time loss", () => {
  const p = createDemoProject(),
    q = parseDTX(serializeDTX(p));
  assert.equal(q.notes.length, p.notes.length);
  assert.equal(durationBeats(q), 32);
  near(beatToSeconds(p, 32), beatToSeconds(q, 32));
});
test("empty trailing bars survive round trip", () => {
  const p = parseDTX("#BPM: 120\n#00711: 00");
  assert.equal(p.barCount, 8);
  assert.equal(parseDTX(serializeDTX(p)).barCount, 8);
});
test("coincident BGM layers retain all chips using repeated channel rows", () => {
  const p = parseDTX("#00001: 01\n#00001: 02");
  const q = parseDTX(serializeDTX(p));
  assert.deepEqual(
    q.notes.map((n) => n.value),
    ["01", "02"],
  );
});
test("BPM00 is equivalent to initial BPM, not an extended event", () => {
  const p = parseDTX("#BPM00: 180\n#BASEBPM: 20\n#00011: 01");
  assert.equal(p.metadata.bpm, 180);
  near(beatToSeconds(p, 3), 1);
  assert.equal(parseDTX(serializeDTX(p)).metadata.bpm, 180);
});

test("repeated initial BPM and media definitions retain ordered original text", () => {
  for (const raw of [
    "#BPM: 120\n#BPM00: 180",
    "#BMP01: one.png\n#00004: 01\n#BMP01: two.png\n#00104: 01",
  ]) {
    const p = parseDTX(raw);
    assert.ok(p.readOnlyReason);
    assert.equal(serializeDTX(p), raw);
  }
});

test("exact five-fret mapping includes A9 guitar and excludes BGA holes", async () => {
  const { GUITAR_CHANNELS, BASS_CHANNELS, stringChannel } =
    await import("../src/chart.js");
  assert.equal(GUITAR_CHANNELS.filter((c) => c.kind === "note").length, 31);
  assert.equal(BASS_CHANNELS.filter((c) => c.kind === "note").length, 31);
  assert.deepEqual(stringChannel("A9")?.frets, [0, 2, 4]);
  assert.equal(stringChannel("A9")?.instrument, "guitar");
  assert.equal(stringChannel("D5"), undefined);
  assert.equal(stringChannel("C7"), undefined);
  assert.equal(stringChannel("E0"), undefined);
  assert.equal(stringChannel("2C")?.kind, "hold");
  assert.equal(stringChannel("2D")?.instrument, "bass");
});

test("WAV labels survive parsing and serialization without treating them as filenames", () => {
  const p = parseDTX(
    "#WAV01: 音/kick.wav ; Kick label; extra detail\n#00011: 01",
  );
  assert.equal(p.resources["01"].file, "音/kick.wav");
  assert.equal(p.resources["01"].label, "Kick label; extra detail");
  assert.equal(
    parseDTX(serializeDTX(p)).resources["01"].label,
    "Kick label; extra detail",
  );
  p.resources["01"].file = "bad;name.wav";
  assert.throws(() => serializeDTX(p), /セミコロン/);
});
