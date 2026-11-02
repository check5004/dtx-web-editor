import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeBeats,
  tempoFromAnchors,
  planTempoFromAnchors,
} from "../src/beat-analysis.ts";
const rate = 4000;
function clicks(bpm: number, duration = 20, offset = 0.3, amplitude = 0.8) {
  const pcm = new Float32Array(duration * rate);
  for (let t = offset; t < duration; t += 60 / bpm) {
    for (let j = 0; j < 16; j++)
      if (Math.floor(t * rate) + j < pcm.length)
        pcm[Math.floor(t * rate) + j] = amplitude * (1 - j / 16);
  }
  return pcm;
}
for (const bpm of [90, 120, 180])
  test(`periodicity includes ${bpm} BPM, explicit source beat phase`, async () => {
    const result = await analyzeBeats(clicks(bpm), rate);
    const candidate = result.candidates.find((c) => Math.abs(c.bpm - bpm) < 2);
    assert.ok(candidate, JSON.stringify(result.candidates));
    const phase = (candidate.beatOffsetSeconds - 0.3) / (60 / bpm);
    assert.ok(Math.abs(phase - Math.round(phase)) < 0.06);
    assert.ok(candidate.confidence < 1);
    assert.ok(
      result.candidates.some(
        (c) => Math.abs(c.bpm - bpm / 2) < 2 || Math.abs(c.bpm - bpm * 2) < 2,
      ),
    );
  });
test("silence and very short audio have no fabricated tempo", async () => {
  assert.equal(
    (await analyzeBeats(new Float32Array(rate * 8), rate)).candidates.length,
    0,
  );
  assert.equal((await analyzeBeats(clicks(120, 2), rate)).candidates.length, 0);
});
test("quiet regular audio remains usable", async () =>
  assert.ok(
    (await analyzeBeats(clicks(120, 20, 0.3, 0.0001), rate)).candidates.some(
      (c) => Math.abs(c.bpm - 120) < 2,
    ),
  ));
test("separate sections retain changing tempo, not a misleading averaged tempo", async () => {
  const audio = new Float32Array(rate * 40);
  audio.set(clicks(90));
  audio.set(clicks(180), rate * 20);
  const result = await analyzeBeats(audio, rate);
  assert.ok(
    result.sections[0].candidates.some((c) => Math.abs(c.bpm - 90) < 2),
  );
  assert.ok(
    result.sections[1].candidates.some((c) => Math.abs(c.bpm - 180) < 2),
  );
});
test("swing/offbeats remain proposals with ambiguity warning", async () => {
  const audio = clicks(120);
  for (let t = 0.3 + 1 / 3; t < 20; t += 0.5) {
    for (let j = 0; j < 16; j++)
      if (Math.floor(t * rate) + j < audio.length)
        audio[Math.floor(t * rate) + j] = 0.3 * (1 - j / 16);
  }
  const result = await analyzeBeats(audio, rate);
  assert.ok(result.candidates.some((c) => Math.abs(c.bpm - 120) < 2));
  assert.ok(result.warnings.some((w) => w.includes("裏拍")));
});
test("limits, invalid PCM, timeout and pre-cancel reject", async () => {
  await assert.rejects(
    analyzeBeats(clicks(120), rate, { maxDurationSeconds: 1 }),
  );
  await assert.rejects(analyzeBeats(new Float32Array([NaN]), rate));
  await assert.rejects(analyzeBeats(clicks(120), 0));
  await assert.rejects(
    analyzeBeats(clicks(120), rate, { minBpm: 240, maxBpm: 40 }),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    analyzeBeats(clicks(120), rate, { signal: abort.signal }),
    { name: "AbortError" },
  );
  await assert.rejects(
    analyzeBeats(clicks(120), rate, { timeoutMs: 0.0001 }),
    /時間上限/,
  );
});
test("active cancellation can interrupt analysis between bounded chunks", async () => {
  const abort = new AbortController();
  const pending = analyzeBeats(clicks(120, 100), rate, {
    signal: abort.signal,
  });
  setTimeout(() => abort.abort(), 1);
  await assert.rejects(pending, { name: "AbortError" });
});
test("anchors use quarter-note distances; source offset positive advances source", () => {
  assert.equal(
    tempoFromAnchors(
      { beat: 3, sourceSeconds: 2 },
      { beat: 9, sourceSeconds: 5 },
    ),
    120,
  );
  const plan = planTempoFromAnchors([
    { beat: 0, sourceSeconds: 0.3 },
    { beat: 3, sourceSeconds: 1.8 },
    { beat: 10, sourceSeconds: 8.8 },
  ]);
  assert.equal(plan.sourceOffsetSeconds, 0.3);
  assert.equal(plan.tempos[0].bpm, 120);
  assert.ok(Math.abs(plan.tempos[1].bpm - 60) < 1e-10);
  assert.equal(plan.tempos[1].beat, 3);
  assert.throws(() =>
    planTempoFromAnchors([
      { beat: 1, sourceSeconds: 0 },
      { beat: 2, sourceSeconds: 1 },
    ]),
  );
  assert.throws(() =>
    tempoFromAnchors(
      { beat: 2, sourceSeconds: 1 },
      { beat: 1, sourceSeconds: 2 },
    ),
  );
  assert.throws(() =>
    tempoFromAnchors(
      { beat: 0, sourceSeconds: 1 },
      { beat: 1, sourceSeconds: 1 },
    ),
  );
});
test("leading silence does not fabricate an offset in silence", async () => {
  const result = await analyzeBeats(clicks(120, 20, 5.3), rate);
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every((c) => c.beatOffsetSeconds >= 5.29));
});
test("DTX variable bars use quarter-note distance without changing the bar map", async () => {
  const { parseDTX, barStartBeat } = await import("../src/chart.ts");
  const project = parseDTX("#BPM:120\n#00002:0.75\n#00202:1.75\n#00311:01\n");
  const original = JSON.stringify(project.barLengths);
  const end = barStartBeat(project, 3);
  assert.equal(end, 13);
  const plan = planTempoFromAnchors([
    { beat: 0, sourceSeconds: 1 },
    { beat: end, sourceSeconds: 7.5 },
  ]);
  assert.equal(plan.tempos[0].bpm, 120);
  assert.equal(JSON.stringify(project.barLengths), original);
  assert.throws(() =>
    tempoFromAnchors(
      { beat: 0, sourceSeconds: 0 },
      { beat: 1e308, sourceSeconds: 1e-308 },
    ),
  );
});
test("120→180 confirmed anchors export/reparse with source offset and variable bars", async () => {
  const { parseDTX, serializeDTX, beatToSeconds } =
    await import("../src/chart.ts");
  const anchors = [
    { beat: 0, sourceSeconds: 0.25 },
    { beat: 4, sourceSeconds: 2.25 },
    { beat: 8, sourceSeconds: 2.25 + 4 / 3 },
  ];
  const plan = planTempoFromAnchors(anchors);
  const project = parseDTX(
    "#BPM:100\n#BASEBPM:10\n#00002:0.75\n#00202:1.75\n#00311:01\n",
  );
  const beforeBars = JSON.stringify(project.barLengths),
    beforeNotes = JSON.stringify(project.notes);
  project.metadata.bpm = plan.tempos[0].bpm;
  project.tempos = plan.tempos
    .slice(1)
    .map((t, i) => ({
      ...t,
      id: `anchor-${i}`,
      channel: "08" as const,
      value: "01",
    }));
  const exported = serializeDTX(project),
    reparsed = parseDTX(exported);
  assert.equal(reparsed.metadata.bpm, 120);
  assert.ok(Math.abs(reparsed.tempos[0].bpm - 180) < 1e-9);
  for (const anchor of anchors)
    assert.ok(
      Math.abs(
        beatToSeconds(reparsed, anchor.beat) -
          (anchor.sourceSeconds - plan.sourceOffsetSeconds),
      ) < 1e-9,
    );
  assert.equal(JSON.stringify(project.barLengths), beforeBars);
  assert.equal(JSON.stringify(project.notes), beforeNotes);
  assert.deepEqual(reparsed.barLengths, project.barLengths);
  assert.equal(plan.sourceOffsetSeconds, 0.25); // positive offset: chart beat0 plays later source at .25s
});
test("host replacement may normalize BASEBPM to zero without altering effective anchor timing", async () => {
  const { parseDTX, serializeDTX, beatToSeconds } =
    await import("../src/chart.ts");
  const plan = planTempoFromAnchors([
    { beat: 0, sourceSeconds: 0.25 },
    { beat: 4, sourceSeconds: 2.25 },
    { beat: 8, sourceSeconds: 2.25 + 4 / 3 },
  ]);
  const p = parseDTX(
    "#BPM:200\n#BASEBPM:150\n#BPM01:100\n#00108:01\n#00211:01\n",
  );
  p.metadata.bpm = plan.tempos[0].bpm;
  p.metadata.baseBpm = 0;
  p.bpmDefinitions = {};
  p.tempos = plan.tempos
    .slice(1)
    .map((t, i) => ({
      ...t,
      id: String(i),
      channel: "08" as const,
      value: "01",
    }));
  const q = parseDTX(serializeDTX(p));
  assert.equal(q.metadata.baseBpm, 0);
  assert.ok(Math.abs(beatToSeconds(q, 8) - (2 + 4 / 3)) < 1e-9);
});
