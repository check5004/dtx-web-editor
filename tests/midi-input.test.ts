import test from "node:test";
import assert from "node:assert/strict";
import {
  MidiInputEngine,
  MidiInputController,
  parseMidiMessage,
  recordingBeat,
  type MidiHit,
} from "../src/midi-input";
import {
  createDefaultMidiProfile,
  exportMidiProfiles,
  importMidiProfiles,
  calibrateMidiPedal,
  saveMidiProfiles,
  loadMidiProfiles,
} from "../src/midi-profiles";
function profile() {
  const p = createDefaultMidiProfile({
    portId: "a",
    name: "same",
    manufacturer: "",
  });
  p.mappings = [
    {
      id: "hh",
      channel: 10,
      note: 42,
      zone: "edge",
      target: { channel: "11", value: "01" },
      hiHat: {
        closed: { channel: "11", value: "01" },
        open: { channel: "18", value: "02" },
        halfOpen: { channel: "11", value: "03" },
      },
    },
  ];
  return p;
}
test("status channels 1/16 and note-on zero are decoded correctly", () => {
  assert.equal(parseMidiMessage("a", [0x90, 42, 1], 0)?.channel, 1);
  assert.equal(parseMidiMessage("a", [0x9f, 42, 1], 0)?.channel, 16);
  assert.equal(parseMidiMessage("a", [0x99, 42, 0], 0)?.kind, "off");
  assert.equal(parseMidiMessage("a", [0x99, 128, 1], 0), null);
});
test("same-name devices and same channels do not collide; mode switch resets", () => {
  const hits: MidiHit[] = [];
  const e = new MidiInputEngine((h) => hits.push(h));
  const a = profile(),
    b = profile();
  b.mappings[0].target.value = "04";
  e.bind("a", a);
  e.bind("b", b);
  e.receive("a", [0x99, 42, 90], 1);
  e.receive("b", [0x99, 42, 90], 2);
  assert.deepEqual(
    hits.map((h) => h.target.value),
    ["01", "04"],
  );
  a.mappings[0].channel = 2;
  e.bind("a", a);
  e.receive("a", [0x99, 42, 90], 3);
  e.receive("a", [0x91, 42, 90], 4);
  assert.equal(hits.length, 3);
});
test("pedal thresholds/hysteresis, isolation, stale and disconnect reset", () => {
  const hits: MidiHit[] = [];
  const e = new MidiInputEngine((h) => hits.push(h));
  e.bind("a", profile());
  e.bind("b", profile());
  e.receive("a", [0xb9, 4, 0], 0);
  e.receive("a", [0x99, 42, 80], 1);
  e.receive("b", [0x99, 42, 80], 2);
  e.receive("a", [0xb9, 4, 34], 3);
  e.receive("a", [0x99, 42, 80], 4);
  e.receive("a", [0xb9, 4, 64], 5);
  e.receive("a", [0x99, 42, 80], 6);
  e.receive("a", [0x99, 42, 80], 11000);
  assert.deepEqual(
    hits.map((h) => h.target.value),
    ["02", "01", "02", "03", "01"],
  );
  e.unbind("a");
  e.receive("a", [0x99, 42, 80], 11001);
  assert.equal(hits.length, 5);
});
test("foot close and splash require full travel, no initial/jitter phantom hits", () => {
  const hits: MidiHit[] = [];
  const p = profile();
  p.pedal!.footClose = { channel: "1B", value: "04" };
  p.pedal!.splash = { channel: "18", value: "05" };
  const e = new MidiInputEngine((h) => hits.push(h));
  e.bind("a", p);
  for (const [t, v] of [
    [0, 127],
    [1, 94],
    [2, 97],
    [3, 93],
  ])
    e.receive("a", [0xb9, 4, v], t);
  assert.equal(hits.length, 0);
  e.receive("a", [0xb9, 4, 0], 10);
  e.receive("a", [0xb9, 4, 127], 20);
  e.receive("a", [0xb9, 4, 94], 21);
  e.receive("a", [0xb9, 4, 127], 22);
  e.receive("a", [0xb9, 4, 0], 100);
  assert.deepEqual(
    hits.map((h) => h.zone),
    ["foot-close", "foot-splash"],
  );
});
test("learn ignores note off and suppresses recording from every source", () => {
  const hits: MidiHit[] = [];
  let learned = 0;
  const e = new MidiInputEngine((h) => hits.push(h));
  e.bind("a", profile());
  e.bind("b", profile());
  e.setLearning({ inputId: "a", kind: "note", onLearn: () => learned++ });
  e.receive("a", [0x99, 42, 0], 0);
  e.receive("b", [0x99, 42, 100], 1);
  e.receive("a", [0x99, 42, 100], 2);
  assert.equal(learned, 1);
  assert.equal(hits.length, 0);
  e.cancelLearning();
  e.receive("a", [0x89, 42, 100], 3);
  assert.equal(hits.length, 0);
});
test("portable persistence validation and explicit envelope migration", () => {
  const p = profile();
  const json = exportMidiProfiles([p]);
  assert.deepEqual(importMidiProfiles(json), [p]);
  assert.equal(
    importMidiProfiles(json.replace('"version": 1', '"version": 0')).length,
    1,
  );
  assert.throws(() =>
    importMidiProfiles(json.replace('"version": 1', '"version": 9')),
  );
  assert.throws(() =>
    importMidiProfiles(json.replace('"channel": 10', '"channel": 0')),
  );
  assert.throws(() =>
    importMidiProfiles(json.replace('"channel": "18"', '"channel": "1D"')),
  );
  let stored = "";
  const store = {
    getItem: () => stored,
    setItem: (_k: string, v: string) => {
      stored = v;
    },
  };
  saveMidiProfiles([p], store);
  assert.deepEqual(loadMidiProfiles(store), [p]);
  assert.throws(() => calibrateMidiPedal(p.pedal!, 5, 6));
  assert.equal(calibrateMidiPedal(p.pedal!, 127, 0).invert, true);
});
test("recording uses event clock, playback rate, input latency, and supplied tempo/quantizer", () => {
  const t = {
    nowMs: 1000,
    chartSeconds: 10,
    playbackRate: 0.5,
    isPlaying: true,
    latencyMs: 100,
    secondsToBeat: (s: number) => s * 2,
    quantizeBeat: (b: number) => Math.round(b * 4) / 4,
  };
  assert.equal(recordingBeat(900, t), 19.75);
  assert.equal(recordingBeat(900, { ...t, isPlaying: false }), null);
  assert.equal(recordingBeat(-2000, t), null);
});
test("controller requests only explicitly; denied/unsupported graceful", async () => {
  let requests = 0;
  const errors: string[] = [];
  const c = new MidiInputController(
    { onHit: () => {}, onError: (s) => errors.push(s) },
    async () => {
      requests++;
      throw new Error("denied");
    },
  );
  assert.equal(requests, 0);
  assert.equal(await c.connect(), false);
  assert.equal(requests, 1);
  assert.match(errors[0], /denied/);
  const unsupported = new MidiInputController({ onHit: () => {} }, undefined);
  assert.equal(await unsupported.connect(), false);
});

test("explicit pedal channel can control HH zones on another channel; other CC channels cannot", () => {
  const hits: MidiHit[] = [];
  const p = profile();
  p.pedal!.channel = 1;
  p.mappings.push({ ...p.mappings[0], id: "bell", note: 43, zone: "bell" });
  const e = new MidiInputEngine((h) => hits.push(h));
  e.bind("a", p);
  e.receive("a", [0xb9, 4, 0], 0);
  e.receive("a", [0x99, 42, 100], 1);
  e.receive("a", [0xb0, 4, 0], 2);
  e.receive("a", [0x99, 43, 100], 3);
  assert.deepEqual(
    hits.map((h) => [h.zone, h.target.channel]),
    [
      ["edge", "11"],
      ["bell", "18"],
    ],
  );
});
test("disconnect/reconnect same ID requires explicit rebinding, no permission on construction", async () => {
  const hits: MidiHit[] = [];
  const port = {
    id: "a",
    name: "same",
    manufacturer: "",
    state: "connected",
    connection: "open",
    onmidimessage: null,
    close: async () => {},
  };
  const access = { inputs: new Map([["a", port]]), onstatechange: null };
  const c = new MidiInputController(
    { onHit: (h) => hits.push(h) },
    async () => access as unknown as MIDIAccess,
  );
  await c.connect();
  c.bind("a", profile());
  const send = () => {
    (port.onmidimessage as unknown as (e: unknown) => void)?.({
      data: new Uint8Array([0x99, 42, 100]),
      timeStamp: 1,
    });
  };
  send();
  assert.equal(hits.length, 1);
  port.state = "disconnected";
  (access.onstatechange as unknown as () => void)();
  assert.equal(c.devices.length, 0);
  port.state = "connected";
  (access.onstatechange as unknown as () => void)();
  send();
  assert.equal(hits.length, 1);
  c.bind("a", profile());
  send();
  assert.equal(hits.length, 2);
  c.disconnect();
  assert.equal(port.onmidimessage, null);
});
test("inverted switch CC, wrong CC and stale-to-close do not emit foot hits", () => {
  const hits: MidiHit[] = [];
  const p = profile();
  p.pedal!.invert = true;
  p.pedal!.footClose = { channel: "1B", value: "04" };
  const e = new MidiInputEngine((h) => hits.push(h));
  e.bind("a", p);
  e.receive("a", [0xb9, 4, 127], 0);
  e.receive("a", [0xb9, 5, 0], 1);
  e.receive("a", [0x99, 42, 90], 2);
  e.receive("a", [0xb9, 4, 0], 11000);
  e.receive("a", [0x99, 42, 90], 11001);
  assert.deepEqual(
    hits.map((h) => h.target.channel),
    ["18", "11"],
  );
});

test("per-mode input latency validates, persists, and defaults to zero on hits", () => {
  const hits: MidiHit[] = [];
  const e = new MidiInputEngine((h) => hits.push(h));
  const p = profile();
  e.bind("a", p);
  e.receive("a", [0x99, 42, 100], 1);
  assert.equal(hits[0].latencyMs, 0);
  p.latencyMs = 125;
  e.bind("a", p);
  e.receive("a", [0x99, 42, 100], 2);
  assert.equal(hits[1].latencyMs, 125);
  assert.equal(importMidiProfiles(exportMidiProfiles([p]))[0].latencyMs, 125);
  p.latencyMs = 1001;
  assert.throws(() => exportMidiProfiles([p]));
});
