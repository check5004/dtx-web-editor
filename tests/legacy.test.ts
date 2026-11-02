import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, serializeDTX, beatToSeconds } from "../src/chart.js";
import { parseLegacyChart } from "../src/legacy.js";

test("GDA named drum and guitar channels match NX source maps", () => {
  const p = parseLegacyChart(
    "#TITLE: 古い譜面\n#WAV01: kick.wav\n#000HH: 01\n#000SD: 01\n#000BD: 01\n#000HT: 01\n#000LT: 01\n#000CY: 01\n#001G0: 01\n#001G7: 01\n#001B0: 01\n#001B7: 01",
    "gda",
  );
  assert.deepEqual(
    p.notes.map((n) => n.channel),
    ["11", "12", "13", "14", "15", "16", "20", "27", "A0", "A7"],
  );
  assert.equal(p.metadata.title, "古い譜面");
  assert.equal(p.resources["01"].file, "kick.wav");
  assert.equal(p.readOnlyReason, undefined);
  assert.equal(parseDTX(serializeDTX(p)).notes.length, 10);
});
test("G2D effect channels are hex 01–20 mapped to 32 SE channels", () => {
  const p = parseLegacyChart(
    "#00001: 01\n#0000A: 01\n#00014: 01\n#00020: 01",
    "g2d",
  );
  assert.deepEqual(
    p.notes.map((n) => n.channel),
    ["61", "70", "80", "92"],
  );
});
test("GDA BL lengths persist and TC is hexadecimal BPM", () => {
  const p = parseLegacyChart(
    "#BPM: 120\n#000BL: 0.75\n#001TC: 96\n#002HH: 01",
    "gda",
  );
  assert.equal(p.notes[0].beat, 6);
  assert.equal(p.tempos[0].beat, 3);
  assert.equal(p.tempos[0].bpm, 150);
  assert.equal(beatToSeconds(p, 6), 2.7);
});
test("BMS 5-key and BME 7-key conversions match DTXCreator", () => {
  const bms = parseLegacyChart(
    Array.from(
      { length: 7 },
      (_, i) => `#000${(0x11 + i).toString(16)}: 01`,
    ).join("\n"),
    "bms",
  );
  assert.deepEqual(
    bms.notes.map((n) => n.channel),
    ["11", "12", "13", "14", "15", "16", "53"],
  );
  const bme = parseLegacyChart(
    Array.from(
      { length: 9 },
      (_, i) => `#000${(0x11 + i).toString(16)}: 01`,
    ).join("\n"),
    "bme",
  );
  assert.deepEqual(
    bme.notes.map((n) => n.channel),
    ["1A", "11", "12", "13", "14", "16", "53", "15", "17"],
  );
});
test("BMS nonpersistent bar lengths explicitly reset in DTX", () => {
  const p = parseLegacyChart(
    "#00002: 0.5\n#00202: 0.75\n#00011: 01\n#00111: 01\n#00211: 01\n#00311: 01\n#00411: 01",
    "bms",
  );
  assert.deepEqual(
    p.notes.map((n) => n.beat),
    [0, 2, 6, 9, 13],
  );
  assert.deepEqual(p.barLengths, { 0: 0.5, 1: 1, 2: 0.75, 3: 1 });
  assert.deepEqual(
    parseDTX(serializeDTX(p)).notes.map((n) => n.beat),
    [0, 2, 6, 9, 13],
  );
});
test("consecutive BMS length changes do not get overwritten by resets", () => {
  const p = parseLegacyChart("#00002: 0.5\n#00102: 0.75\n#00211: 01", "bms");
  assert.equal(p.notes[0].beat, 5);
  assert.equal(p.barLengths[1], 0.75);
  assert.equal(p.barLengths[2], 1);
});
test("BMS layered BGM is assigned separate source-exact SE channels per bar", () => {
  const p = parseLegacyChart(
    "#00001: 01\n#00001: 02\n#00101: 03\n#00001: 04",
    "bms",
  );
  assert.deepEqual(
    p.notes.map((n) => [n.channel, n.value]),
    [
      ["61", "01"],
      ["62", "02"],
      ["63", "04"],
      ["61", "03"],
    ],
  );
});
test("BMP and arbitrary header definitions survive ordinary legacy conversion", () => {
  const p = parseLegacyChart(
    "#BMP01: cover.png\n#GENRE: genre\n#CUSTOM: x\n#00004: 01\n#00011: 02",
    "bms",
  );
  const out = serializeDTX(p);
  assert.ok(out.includes("#BMP01: cover.png"));
  assert.ok(out.includes("#CUSTOM: x"));
  assert.ok(out.includes("#GENRE: genre"));
  assert.ok(out.includes("#00004: 01"));
});
test("advanced BMS STOP, long notes, 2P and mines are protected rather than reinterpreted", () => {
  for (const raw of [
    "#STOP01: 192\n#00009: 01",
    "#00051: 01",
    "#00021: 01",
    "#000D1: 01",
    "#LNOBJ: ZZ\n#00011: 01",
  ]) {
    const p = parseLegacyChart(raw, "bms");
    assert.ok(p.readOnlyReason);
    assert.equal(p.originalText, raw);
    assert.throws(() => serializeDTX(p), /安全/);
  }
});
test("unknown GDA channels and random branches retain original source and block false DTX export", () => {
  for (const raw of ["#000XX: 01", "#RANDOM 2\n#IF 1\n#000HH: 01\n#ENDIF"]) {
    const p = parseLegacyChart(raw, "gda");
    assert.ok(p.readOnlyReason);
    assert.equal(p.originalText, raw);
    assert.throws(() => serializeDTX(p));
  }
});
test("extended base36 WAV and BPM references are maintained", () => {
  const p = parseLegacyChart(
    "#WAVGZ: sample.ogg\n#BPMXY: 175.5\n#00008: XY\n#00011: GZ",
    "bms",
  );
  assert.equal(p.notes[0].value, "GZ");
  assert.equal(p.tempos[0].bpm, 175.5);
  assert.equal(parseDTX(serializeDTX(p)).resources.GZ.file, "sample.ogg");
});
