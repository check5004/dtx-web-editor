import test from "node:test";
import assert from "node:assert/strict";
import { parseChart, parseChartBytes, chartFormat } from "../src/io.js";
import { encodeCP932 } from "../src/encoding.js";
import { serializeMIDI } from "../src/midi.js";
test("filename routing uses the legacy importer rather than interpreting named GDA as raw DTX", () => {
  const p = parseChart("#000HH: 01", "SONG.GDA");
  assert.equal(p.notes[0].channel, "11");
  assert.equal(p.metadata.sourceFormat, "gda");
});
test("binary routing decodes CP932 text and accepts MIDI bytes", () => {
  const p = parseChartBytes(
    encodeCP932("#TITLE: 日本語\n#00011: 01"),
    "song.dtx",
  );
  assert.equal(p.metadata.title, "日本語");
  assert.equal(parseChartBytes(serializeMIDI(p), "song.mid").notes.length, 1);
});
test("unknown file extensions and binary-as-text are rejected", () => {
  assert.throws(() => chartFormat("song.xyz"));
  assert.throws(() => parseChart("MThd", "song.mid"));
});
