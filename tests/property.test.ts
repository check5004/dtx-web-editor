import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDTX,
  serializeDTX,
  beatToSeconds,
  secondsToBeat,
  barStartBeat,
  barLengthAt,
  durationBeats,
  isWavReferenceChannel,
  type Project,
} from "../src/chart.js";
import {
  insertMeasures,
  deleteMeasures,
  changeMeasureLength,
  replaceWavReferences,
  swapResourceIds,
} from "../src/edit.js";
import { encodeCP932, decodeChartBytes } from "../src/encoding.js";

// Fixed seeds make every randomized regression exactly reproducible.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const near = (actual: number, expected: number, label = "") =>
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${label}: ${actual} != ${expected}`,
  );
const canonicalNotes = (p: Project) =>
  p.notes.map((n) => `${n.channel}:${n.value}:${n.beat.toFixed(8)}`).sort();
function fixture(seed: number): Project {
  const rnd = random(seed),
    pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const p = parseDTX(
    "#TITLE: 決定的な試験①\n#ARTIST: 試験㈱\n#BPM: 137.25\n#BASEBPM: 10\n#WAV01: 音源/スネア.wav\n#WAVAZ: 音源/髙いタム.wav\n#WAVZZ: 音源/﨑シンバル.ogg\n#VOLUME01: 72\n#PANAZ: -17\n#SIZEZZ: 83\n#BMPZZ: 画像/背景.png\n#AVIZZ: 映像/背景.avi\n#CUSTOM: 原文を保持",
  );
  p.barCount = 20;
  for (let bar = 0; bar < 17; bar++)
    if (rnd() < 0.4)
      p.barLengths[bar] = pick([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  let id = 0;
  for (let bar = 0; bar < 17; bar++) {
    const start = barStartBeat(p, bar),
      length = 4 * barLengthAt(p, bar);
    for (const channel of [
      "11",
      "12",
      "18",
      "19",
      "1A",
      "01",
      "04",
      "54",
      "21",
      "D3",
      "B1",
      "C4",
      "FE",
    ]) {
      const denominator = pick([1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
      for (let n = 0; n < 2; n++)
        p.notes.push({
          id: `random-${seed}-${++id}`,
          channel,
          value: pick(["01", "AZ", "ZZ"]),
          beat:
            start + (length * Math.floor(rnd() * denominator)) / denominator,
        });
    }
    if (bar % 3 === 1)
      p.tempos.push({
        id: `tempo-${seed}-${bar}`,
        beat: start + length / 2,
        bpm: pick([90, 120, 165.5, 210, 300.25]),
        channel: pick(["03", "08"]),
        value: "01",
      });
  }
  return p;
}

test("32 deterministic rational charts retain notes/resources/metadata/passthrough and timing after DTX round trip", () => {
  for (let seed = 1; seed <= 32; seed++) {
    const p = fixture(seed),
      q = parseDTX(serializeDTX(p));
    assert.deepEqual(canonicalNotes(q), canonicalNotes(p), `seed ${seed}`);
    assert.deepEqual(q.resources, p.resources);
    assert.deepEqual(q.metadata, p.metadata);
    assert.equal(q.barCount, p.barCount);
    for (const raw of p.passthrough) assert.ok(q.passthrough.includes(raw));
    for (let bar = 0; bar < p.barCount; bar++)
      near(barStartBeat(q, bar), barStartBeat(p, bar), `bar seed ${seed}`);
    const duration = durationBeats(p);
    near(durationBeats(q), duration);
    for (let i = 0; i <= 32; i++) {
      const beat = (duration * i) / 32;
      near(beatToSeconds(q, beat), beatToSeconds(p, beat), `time seed ${seed}`);
      near(secondsToBeat(q, beatToSeconds(q, beat)), beat);
    }
  }
});

test("insert→delete and measure resize→restore preserve every channel and within-measure fraction", () => {
  for (let seed = 41; seed <= 56; seed++) {
    const p = fixture(seed),
      at = seed % 16,
      count = (seed % 3) + 1;
    const restored = deleteMeasures(insertMeasures(p, at, count), at, count);
    assert.deepEqual(canonicalNotes(restored), canonicalNotes(p));
    assert.equal(restored.barCount, p.barCount);
    for (let beat = 0; beat < durationBeats(p); beat += 0.37)
      near(beatToSeconds(restored, beat), beatToSeconds(p, beat));
    const resized = changeMeasureLength(
      changeMeasureLength(p, at, 2.25),
      at,
      barLengthAt(p, at),
    );
    assert.deepEqual(canonicalNotes(resized), canonicalNotes(p));
    assert.equal(resized.barCount, p.barCount);
    assert.deepEqual(
      canonicalNotes(parseDTX(serializeDTX(resized))),
      canonicalNotes(p),
    );
  }
});

test("duplicate WAV refs and shared media IDs remain distinct through replacement and atomic swap", () => {
  for (let seed = 61; seed <= 68; seed++) {
    const p = fixture(seed),
      q = replaceWavReferences(p, "ZZ", "01");
    for (let i = 0; i < p.notes.length; i++) {
      const original = p.notes[i];
      assert.equal(
        q.notes[i].value,
        isWavReferenceChannel(original.channel) && original.value === "ZZ"
          ? "01"
          : original.value,
      );
    }
    const swapped = swapResourceIds(p, "01", "ZZ");
    for (let i = 0; i < p.notes.length; i++) {
      const original = p.notes[i];
      const expected = isWavReferenceChannel(original.channel)
        ? ({ "01": "ZZ", ZZ: "01" } as Record<string, string>)[
            original.value
          ] || original.value
        : original.value;
      assert.equal(swapped.notes[i].value, expected);
    }
    assert.equal(swapped.resources.ZZ.file, p.resources["01"].file);
    assert.equal(swapped.resources["01"].file, p.resources.ZZ.file);
    assert.deepEqual(
      canonicalNotes(swapResourceIds(swapped, "01", "ZZ")),
      canonicalNotes(p),
    );
    const q2 = parseDTX(serializeDTX(q));
    assert.deepEqual(canonicalNotes(q2), canonicalNotes(q));
    assert.ok(q2.passthrough.includes("#BMPZZ: 画像/背景.png"));
    assert.ok(q2.passthrough.includes("#AVIZZ: 映像/背景.avi"));
  }
});

test("999 / A00 / Z99 boundaries and ZZ values retain positions without decimal/base36 confusion", () => {
  const p = parseDTX(
    "#BPM: 120\n#WAVZZ: 終端.wav\n#99902: 0.75\n#A0102: 1\n#99911: 00ZZ\n#A0019: ZZ\n#Z991A: 00ZZ",
  );
  const q = parseDTX(serializeDTX(p));
  assert.equal(q.barCount, 3600);
  assert.deepEqual(canonicalNotes(q), canonicalNotes(p));
  assert.equal(p.notes.find((n) => n.channel === "11")!.beat, 3997.5);
  assert.equal(p.notes.find((n) => n.channel === "19")!.beat, 3999);
  assert.ok(serializeDTX(p).includes("#Z991A: 00ZZ"));
});

test("empty trailing bars survive alternating length changes and high boundary measure names", () => {
  for (const [last, expected] of [
    ["019", 20],
    ["999", 1000],
    ["A00", 1001],
    ["Z99", 3600],
  ] as const) {
    const p = parseDTX(
      `#00002: 0.75\n#00102: 1.25\n#00202: 1\n#00011: ZZ\n#${last}11: 00`,
    );
    const q = parseDTX(serializeDTX(p));
    assert.equal(q.barCount, expected);
    near(durationBeats(p), durationBeats(q));
    assert.equal(q.notes.length, 1);
  }
});

test("CP932 filenames and vendor extensions survive bytes→parse→export→bytes differential round trip", () => {
  const raw =
    "#TITLE: 演奏会①㈱\r\n#WAVZZ: 音源\\髙﨑の太鼓.wav\r\n#WAV01: 音源\\左シンバル.ogg\r\n#BMPZZ: 背景\\夕焼け.png\r\n#00011: ZZ\r\n#0001A: 01\r\n";
  const p = parseDTX(decodeChartBytes(encodeCP932(raw))),
    serialized = serializeDTX(p),
    q = parseDTX(decodeChartBytes(encodeCP932(serialized)));
  assert.deepEqual(q.metadata, p.metadata);
  assert.deepEqual(q.resources, p.resources);
  assert.deepEqual(canonicalNotes(q), canonicalNotes(p));
  assert.equal(decodeChartBytes(encodeCP932(raw)), raw);
});

test("incompatible rational grids reject within a bounded denominator cap instead of changing positions", () => {
  const p = parseDTX("#WAV01: a.wav");
  p.notes = [
    { id: "a", beat: 4 / 257, channel: "11", value: "01" },
    { id: "b", beat: 4 / 263, channel: "11", value: "01" },
  ];
  assert.throws(() => serializeDTX(p), /グリッド/);
  // Separate channels do not require a joint denominator and remain representable.
  p.notes[1].channel = "12";
  const q = parseDTX(serializeDTX(p));
  near(q.notes[0].beat, p.notes[1].beat);
  near(q.notes[1].beat, p.notes[0].beat);
});

test("independent channel oracle keeps visual/control IDs while swapping sound and empty-hit IDs", () => {
  const controls = [
    "04",
    "07",
    "50",
    "51",
    "52",
    "53",
    "54",
    "55",
    "56",
    "57",
    "58",
    "59",
    "5A",
    "60",
    "C1",
    "C2",
    "C4",
    "C7",
    "D5",
    "D6",
    "D7",
    "D8",
    "D9",
    "E0",
    "FE",
  ];
  const sounds = [
    "01",
    "11",
    "18",
    "1A",
    "1C",
    "21",
    "31",
    "61",
    "70",
    "80",
    "90",
    "93",
    "A0",
    "A9",
    "B1",
    "BE",
    "C5",
    "D0",
    "E8",
  ];
  const p = parseDTX(
    "#WAV01: first.wav\n#WAVZZ: last.wav\n#BPMZZ: 180\n#00008: ZZ\n" +
      [...controls, ...sounds].map((ch) => `#000${ch}: ZZ`).join("\n"),
  );
  const q = swapResourceIds(p, "01", "ZZ");
  for (const ch of controls)
    assert.equal(
      q.notes.find((n) => n.channel === ch)!.value,
      "ZZ",
      `control ${ch}`,
    );
  for (const ch of sounds)
    assert.equal(
      q.notes.find((n) => n.channel === ch)!.value,
      "01",
      `sound ${ch}`,
    );
  assert.equal(q.tempos[0].value, "ZZ");
  assert.equal(q.bpmDefinitions.ZZ, 180);
});
