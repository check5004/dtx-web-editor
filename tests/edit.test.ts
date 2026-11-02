import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, barLengthAt, serializeDTX } from "../src/chart.js";
import {
  insertMeasures,
  deleteMeasures,
  changeMeasureLength,
  replaceWavReferences,
  swapResourceIds,
  reorderResourceIds,
  scaleSelectedTempo,
} from "../src/edit.js";
const fixture = () =>
  parseDTX(
    "#BPM: 120\n#BPM01: 180\n#00002: .75\n#00202: 1.5\n#00011: 0001\n#00104: 02\n#00254: 03\n#00208: 0001\n#00312: 0001",
  );
test("insert preserves old measure fractions and persistent length boundary", () => {
  const p = fixture(),
    q = insertMeasures(p, 2, 2);
  assert.equal(q.barCount, 6);
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [1.5, 3, 18, 27],
  );
  assert.equal(q.tempos[0].beat, 21);
  assert.equal(barLengthAt(q, 2), 1.5);
  assert.equal(barLengthAt(q, 4), 1.5);
  assert.deepEqual(
    p.notes.map((n) => n.beat),
    [1.5, 3, 6, 15],
  );
});
test("insert at beginning and end handles original first-bar ratio", () => {
  const p = fixture();
  const q = insertMeasures(p, 0, 1);
  assert.equal(q.notes[0].beat, 4.5);
  assert.equal(barLengthAt(q, 0), 0.75);
  const end = insertMeasures(p, 4, 1);
  assert.equal(barLengthAt(end, 4), 1.5);
  assert.equal(end.barCount, 5);
});
test("deleting mixed-length measures removes all events inside and shifts media outside", () => {
  const p = fixture(),
    q = deleteMeasures(p, 1, 2);
  assert.equal(q.barCount, 2);
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [1.5, 6],
  );
  assert.equal(barLengthAt(q, 1), 1.5);
  assert.equal(q.tempos[0].beat, 3);
  assert.equal(q.tempos[0].bpm, 180);
});
test("deleting initial measures preserves incoming tempo and surviving fractions", () => {
  const p = fixture(),
    q = deleteMeasures(p, 0, 3);
  assert.equal(q.metadata.bpm, 180);
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [3],
  );
  assert.equal(barLengthAt(q, 0), 1.5);
});
test("deleting every measure leaves valid empty chart", () => {
  const q = deleteMeasures(fixture(), 0, 4);
  assert.equal(q.barCount, 1);
  assert.equal(q.notes.length, 0);
  assert.equal(q.tempos.length, 0);
  assert.doesNotThrow(() => serializeDTX(q));
});
test("change one measure length preserves fraction and restores next measure ratio", () => {
  const p = fixture(),
    q = changeMeasureLength(p, 0, 2);
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [4, 8, 11, 20],
  );
  assert.equal(q.tempos[0].beat, 14);
  assert.equal(barLengthAt(q, 1), 0.75);
  assert.equal(barLengthAt(q, 2), 1.5);
});
test("editing validates ranges, ratios, and read-only projects", () => {
  const p = fixture();
  for (const op of [
    () => insertMeasures(p, 5, 1),
    () => insertMeasures(p, 0, 3600),
    () => deleteMeasures(p, 3, 2),
    () => changeMeasureLength(p, 0, 0),
    () => changeMeasureLength(p, 5, 1),
  ])
    assert.throws(op);
  assert.throws(() => insertMeasures(parseDTX("#RANDOM 2"), 0, 1));
});
test("resource replacement targets only selected audible notes, not images or movies", () => {
  const p = parseDTX("#00011: 01\n#00054: 01\n#00004: 01\n#00020: 01");
  const q = replaceWavReferences(p, "01", "ZZ", [p.notes[0].id]);
  assert.deepEqual(
    q.notes.map((n) => n.value),
    ["ZZ", "01", "01", "01"],
  );
  const all = replaceWavReferences(p, "01", "02");
  assert.deepEqual(
    all.notes.map((n) => n.value),
    ["02", "01", "01", "02"],
  );
});
test("atomic resource swap preserves sample identity and ignores media IDs", () => {
  const p = parseDTX(
    "#WAV01: one.wav\n#WAV02: two.wav\n#00011: 01\n#00054: 01\n#00012: 02",
  );
  const q = swapResourceIds(p, "01", "02");
  assert.equal(q.resources["02"].file, "one.wav");
  assert.equal(q.resources["01"].file, "two.wav");
  assert.deepEqual(
    q.notes.map((n) => n.value),
    ["02", "01", "01"],
  );
  assert.equal(p.resources["01"].file, "one.wav");
});
test("resource remapping supports cycles and rejects collisions", () => {
  const p = parseDTX("#WAV01: one.wav\n#WAV02: two.wav\n#WAV03: three.wav");
  const q = reorderResourceIds(p, { "01": "02", "02": "03", "03": "01" });
  assert.equal(q.resources["01"].file, "three.wav");
  assert.throws(() => reorderResourceIds(p, { "01": "02" }));
  assert.throws(() => reorderResourceIds(p, { "01": "04", "02": "04" }));
});
test("scale selected tempos leaves initial and unselected values intact", () => {
  const p = fixture(),
    q = scaleSelectedTempo(p, 0.5, [p.tempos[0].id]);
  assert.equal(q.tempos[0].bpm, 90);
  assert.equal(q.metadata.bpm, 120);
  assert.equal(scaleSelectedTempo(p, 2).metadata.bpm, 240);
});
test("edited chart serializes and reparses with equal note times", () => {
  const p = changeMeasureLength(insertMeasures(fixture(), 1, 2), 2, 0.5);
  const q = parseDTX(serializeDTX(p));
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    p.notes.map((n) => n.beat),
  );
  assert.deepEqual(
    q.tempos.map((t) => t.beat),
    p.tempos.map((t) => t.beat),
  );
});

test("resource reorder updates empty-hit assignments without treating them as media", () => {
  const p = parseDTX(
    "#WAV01: one.wav\n#WAV02: two.wav\n#000B1: 01\n#000BE: 01\n#00054: 01",
  );
  const q = swapResourceIds(p, "01", "02");
  assert.deepEqual(
    q.notes.map((n) => n.value),
    ["02", "02", "01"],
  );
});

test("Creator-style length change preserves within-bar beat offsets and shifts later bars", () => {
  const p = parseDTX("#00011: 00010000\n#00112: 01");
  const q = changeMeasureLength(p, 0, 2, "preserve");
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [1, 8],
  );
});
test("Creator-style shortening refuses overflow without explicit delete and preserves following tempo", () => {
  const p = parseDTX(
    "#BPM01: 180\n#00011: 00000001\n#00008: 00000001\n#00112: 01",
  );
  assert.throws(() => changeMeasureLength(p, 0, 0.5, "preserve"), /はみ出/);
  const q = changeMeasureLength(p, 0, 0.5, {
    mode: "preserve",
    overflow: "delete",
  });
  assert.deepEqual(
    q.notes.map((n) => n.beat),
    [2],
  );
  assert.equal(q.tempos[0].beat, 2);
  assert.equal(q.tempos[0].bpm, 180);
});

test("atomic WAV swaps retain labels and remap BGM, colors, palette, lane bindings but not media", () => {
  const p = parseDTX(
    "#WAV01: kick.wav ; Kick label\n#WAV02: song.wav ; Song label\n#BGMWAV: 02\n#DTXC_WAVFORECOLOR: 1 Red\n#DTXC_CHIPPALETTE: 0,01 1,01 2,01\n#DTXC_LANEBINDEDCHIP: 02 01 02\n#DTXC_LANEBINDEDCHIP: 70 01 00\n#00011: 01\n#00001: 02\n#00004: 01\n#00054: 01",
  );
  const q = parseDTX(serializeDTX(swapResourceIds(p, "01", "02")));
  assert.equal(q.resources["02"].label, "Kick label");
  assert.equal(q.resources["01"].label, "Song label");
  assert(q.passthrough.includes("#BGMWAV: 01"));
  assert(q.passthrough.includes("#DTXC_WAVFORECOLOR: 2 Red"));
  assert(q.passthrough.includes("#DTXC_CHIPPALETTE: 0,02 1,01 2,01"));
  assert(q.passthrough.includes("#DTXC_LANEBINDEDCHIP: 02 02 01"));
  assert(q.passthrough.includes("#DTXC_LANEBINDEDCHIP: 70 01 00"));
  assert.equal(q.notes.find((n) => n.channel === "11")?.value, "02");
  assert.equal(q.notes.find((n) => n.channel === "01")?.value, "01");
  assert.equal(q.notes.find((n) => n.channel === "04")?.value, "01");
  assert.equal(q.notes.find((n) => n.channel === "54")?.value, "01");
  const replaced = replaceWavReferences(p, "01", "02");
  assert(replaced.passthrough.includes("#DTXC_WAVFORECOLOR: 1 Red"));
  assert(replaced.passthrough.includes("#BGMWAV: 02"));
});
