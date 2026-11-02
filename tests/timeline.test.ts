import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDTX,
  beatToSeconds,
  secondsToBeat,
  barStartBeat,
  barLengthAt,
  beatToBar,
  durationBeats,
  type Project,
} from "../src/chart.js";
import { buildTimelineIndex } from "../src/timeline.js";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fixture(): Project {
  const p = parseDTX(
    "#BPM: 117.5\n#BASEBPM: 10\n#BPM01: 155.75\n#00002: .875\n#00302: 1.5\n#00702: .75\n#00003: 0078\n#00208: 0001\n#00811: 01",
  );
  p.tempos.push({
    id: "coincident",
    beat: p.tempos[1].beat,
    bpm: 190,
    channel: "08",
    value: "02",
  });
  return p;
}
test("indexed timing crosscompares codec including coincident tempos and negative extrapolation", () => {
  const p = fixture(),
    index = buildTimelineIndex(p);
  for (let beat = -2; beat < 100; beat += 0.0625) {
    near(index.beatToSeconds(beat), beatToSeconds(p, beat));
    near(
      index.secondsToBeat(beatToSeconds(p, beat)),
      secondsToBeat(p, beatToSeconds(p, beat)),
    );
    near(index.secondsToBeat(index.beatToSeconds(beat)), beat);
  }
  near(index.durationBeats(), durationBeats(p));
});
test("indexed meters match codec across exact, just-before and fractional boundaries", () => {
  const p = fixture(),
    index = buildTimelineIndex(p);
  for (let bar = 0; bar < 30; bar++) {
    near(index.barStartBeat(bar), barStartBeat(p, bar));
    near(index.barLengthAt(bar), barLengthAt(p, bar));
    for (const delta of [0, 1e-10, 0.01, 0.5])
      assert.deepEqual(
        index.beatToBar(index.barStartBeat(bar) + delta),
        beatToBar(p, index.barStartBeat(bar) + delta),
      );
    if (bar > 0)
      for (const eps of [1e-10, 1e-7])
        assert.deepEqual(
          index.beatToBar(index.barStartBeat(bar) - eps),
          beatToBar(p, index.barStartBeat(bar) - eps),
        );
  }
});
test("3600 bars and repeated meter/tempo changes remain exact with bounded index", () => {
  const p = parseDTX("#Z9911: ZZ");
  for (let bar = 0; bar < 3600; bar += 37)
    p.barLengths[bar] = [0.75, 1, 1.5, 1.25][Math.floor(bar / 37) % 4];
  for (let bar = 0; bar < 3600; bar += 71)
    p.tempos.push({
      id: `t${bar}`,
      beat: barStartBeat(p, bar),
      bpm: 80 + (bar % 170),
      channel: "08",
      value: "01",
    });
  p.notes[0].beat = barStartBeat(p, 3599) + 0.5;
  const index = buildTimelineIndex(p);
  for (const bar of [0, 1, 998, 999, 1000, 1001, 3598, 3599]) {
    const beat = barStartBeat(p, bar);
    near(index.barStartBeat(bar), beat);
    near(index.beatToSeconds(beat), beatToSeconds(p, beat));
    assert.equal(index.beatToBar(beat).bar, bar);
  }
  near(index.durationBeats(), durationBeats(p));
  assert.throws(() => index.beatToBar(index.barStartBeat(3600)));
  assert(index.metronomeEvents().length < 230400);
});
test("quarter clicks anchor each fractional measure start and use exact tempo integration", () => {
  const p = parseDTX(
    "#BPM: 120\n#00002: .625\n#00202: .75\n#00211: 00\n#00003: 0078",
  );
  const index = buildTimelineIndex(p),
    clicks = index.metronomeEvents();
  assert.deepEqual(
    clicks.map((c) => c.beat),
    [0, 1, 2, 2.5, 3.5, 4.5, 5, 6, 7],
  );
  assert.deepEqual(
    clicks.filter((c) => c.accent).map((c) => c.beat),
    [0, 2.5, 5],
  );
  for (const c of clicks) near(c.time, beatToSeconds(p, c.beat));
  assert.equal(index.metronomeEvents(), clicks);
});
test("index is snapshot and ignores later project mutations", () => {
  const p = fixture(),
    index = buildTimelineIndex(p),
    before = index.beatToSeconds(8);
  p.metadata.bpm = 999;
  p.tempos = [];
  p.barLengths = {};
  near(index.beatToSeconds(8), before);
  assert.notEqual(buildTimelineIndex(p).beatToSeconds(8), before);
});
test("metronome event budget fails before allocating pathological lengths", () => {
  const p = parseDTX("#00002: 1000000");
  const index = buildTimelineIndex(p);
  assert.throws(() => index.metronomeEvents(), /230,400/);
});
test("full supported max UI grid emits exactly 230400 bounded events", () => {
  const p = parseDTX("#00002: 16\n#Z9911: 00"),
    index = buildTimelineIndex(p);
  assert.equal(index.metronomeEvents().length, 230400);
});
