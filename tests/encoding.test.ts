import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeChartText,
  encodeCP932,
  decodeChartBytes,
} from "../src/encoding.js";
test("CP932 Japanese metadata and paths round trip", () => {
  const text = "#TITLE: 夜明けの譜面\r\n#WAV01: 音楽\\スネア.wav\r\n";
  const bytes = encodeCP932(text);
  assert.equal(decodeChartBytes(bytes), text);
  assert.equal(decodeChartBytes(bytes, "cp932"), text);
});
test("CP932 vendor extension characters round trip", () => {
  const text = "①㈱髙﨑";
  assert.equal(decodeChartBytes(encodeCP932(text)), text);
});
test("unrepresentable emoji is rejected rather than replaced", () =>
  assert.throws(() => encodeCP932("曲 🎵"), /CP932/));
test("UTF8 supports all Unicode and BOM detection", () => {
  const text = "曲 🎵";
  assert.equal(decodeChartBytes(encodeChartText(text, "utf8")), text);
  assert.equal(
    decodeChartBytes(
      new Uint8Array([239, 187, 191, ...encodeChartText(text, "utf8")]),
    ),
    text,
  );
});
test("invalid byte sequence fails explicitly", () =>
  assert.throws(() => decodeChartBytes(new Uint8Array([0x81]), "cp932")));
test("UTF16 BOM import supported without misdetecting as CP932", () =>
  assert.equal(
    decodeChartBytes(new Uint8Array([255, 254, 65, 0, 66, 0])),
    "AB",
  ));
