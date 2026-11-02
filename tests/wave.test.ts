import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePCM16 } from "../src/wave.ts";
test("reference trim encodes exact stereo frames without changing timing", () => {
  const out = encodePCM16(
      [new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 1, -1])],
      44100,
      1,
    ),
    v = new DataView(out.buffer);
  assert.equal(out.length, 52);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(44, true), 16384);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(50, true), -32767);
});
test("invalid trims fail instead of empty BGM", () => {
  assert.throws(() => encodePCM16([new Float32Array(10)], 44100, 10));
  assert.throws(() => encodePCM16([], 44100));
});
