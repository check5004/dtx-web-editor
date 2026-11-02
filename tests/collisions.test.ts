import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoNewNoteCollisions } from "../src/collisions";
const a = { id: "a", beat: 0, channel: "11", value: "01" },
  b = { ...a, id: "b", beat: 1 };
test("new collisions rejected, other lanes allowed", () => {
  assert.throws(() =>
    assertNoNewNoteCollisions([a, b], [a, { ...b, beat: 0 }]),
  );
  assert.doesNotThrow(() =>
    assertNoNewNoteCollisions([a, b], [a, { ...b, beat: 0, channel: "12" }]),
  );
});
test("existing imported overlap preserved", () => {
  const c = { ...b, beat: 0 };
  assert.doesNotThrow(() =>
    assertNoNewNoteCollisions(
      [a, c],
      [
        { ...a, beat: 2 },
        { ...c, beat: 2 },
      ],
    ),
  );
});
