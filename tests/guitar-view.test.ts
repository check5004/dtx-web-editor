import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, stringChannel } from "../src/chart.js";
import {
  channelForFrets,
  toggleFret,
  setStringFrets,
  setStringChord,
  projectStringNotes,
  describeStringNote,
} from "../src/guitar-view.js";
test("all 32 five-fret/open combinations map bijectively for both instruments", () => {
  for (const instrument of ["guitar", "bass"] as const) {
    const channels = new Set<string>();
    for (let mask = 0; mask < 32; mask++) {
      const frets = Array.from({ length: 5 }, (_, i) => i).filter(
        (i) => mask & (1 << i),
      );
      const channel = channelForFrets(instrument, frets);
      channels.add(channel);
      assert.deepEqual(stringChannel(channel)?.frets, frets);
      assert.equal(stringChannel(channel)?.instrument, instrument);
    }
    assert.equal(channels.size, 32);
  }
});
test("toggle exact extended combination retains voice timing identity and original project", () => {
  const p = parseDTX("#00124: ZZ");
  const n = p.notes[0],
    q = toggleFret(p, n.id, 4);
  assert.equal(q.notes[0].channel, "9F");
  assert.equal(q.notes[0].value, "ZZ");
  assert.equal(q.notes[0].id, n.id);
  assert.equal(q.notes[0].beat, 4);
  assert.equal(p.notes[0].channel, "24");
});
test("clearing final fret becomes open rather than deleting sound", () => {
  const p = parseDTX("#00021: 01");
  assert.equal(toggleFret(p, p.notes[0].id, 2).notes[0].channel, "20");
});
test("multi-selection applies chord independently to guitar and bass", () => {
  const p = parseDTX("#00020: 01\n#000A0: 02");
  const q = setStringFrets(p, p.notes, [0, 2, 4]);
  assert.deepEqual(
    q.notes.map((n) => n.channel),
    ["A9", "DD"],
  );
  assert.deepEqual(
    q.notes.map((n) => n.value),
    ["01", "02"],
  );
});
test("projection yields one sound event with multiple fret cells, preserves special lanes", () => {
  const p = parseDTX("#000D3: 01\n#00028: 01\n#0002C: 01\n#00013: 01");
  const views = projectStringNotes(p, "guitar");
  assert.equal(views.length, 3);
  assert.deepEqual(views[0].frets, [0, 1, 2, 3, 4]);
  assert.equal(views[1].kind, "wail");
  assert.equal(views[2].kind, "hold");
  assert.equal(describeStringNote(p.notes[3]), undefined);
});
test("draw/update chord never makes separate WAV hits for each fret", () => {
  let p = parseDTX("");
  p = setStringChord(p, "guitar", 2, [0, 1], "ZZ");
  p = setStringChord(p, "guitar", 2, [0, 1, 4], "ZZ");
  assert.equal(p.notes.length, 1);
  assert.equal(p.notes[0].channel, "AA");
});
test("invalid selections, unsupported transforms, duplicate voices and protected source reject", () => {
  const p = parseDTX("#00028: 01");
  assert.throws(() => toggleFret(p, p.notes[0].id, 0));
  assert.throws(() => setStringFrets(p, ["missing"], []));
  assert.throws(() => channelForFrets("guitar", [5]));
  assert.throws(() =>
    setStringChord(parseDTX("#00020: 01\n#00024: 02"), "guitar", 0, [1], "01"),
  );
  assert.throws(() =>
    setStringChord(parseDTX("#RANDOM 2"), "guitar", 0, [1], "01"),
  );
});
