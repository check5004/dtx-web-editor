import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDTX, serializeDTX } from "../src/chart";
import { getHoldSpans, setHold, removeHold } from "../src/holds";
test("native paired hold markers export/reimport without duplicate sound", () => {
  const p = parseDTX("#BPM:120\n#WAV01:g.wav\n#00024:01");
  const n = setHold(p, p.notes[0].id, 3);
  assert.equal(getHoldSpans(n).length, 1);
  assert.equal(getHoldSpans(parseDTX(serializeDTX(n)))[0].end.beat, 3);
  assert.equal(removeHold(n, p.notes[0].id).notes.length, 1);
  assert.equal(p.notes.length, 1);
});
test("open/intermediate-note hold is rejected", () => {
  const p = parseDTX("#00024:0101");
  assert.throws(() => setHold(p, p.notes[0].id, 3));
  const q = parseDTX("#00020:01");
  assert.throws(() => setHold(q, q.notes[0].id, 2));
});
