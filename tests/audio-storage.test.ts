import test from "node:test";
import assert from "node:assert/strict";
import {
  synthesizeKit,
  synthesizeKitWav,
  exportDefaultKit,
  AudioTransport,
} from "../src/audio.ts";
import { normalizePath, hashBlob, importFiles } from "../src/storage.ts";

test("generated kit WAV headers are valid mono PCM, deterministic, non-silent and finite", async () => {
  for (const [path, blob] of exportDefaultKit()) {
    const bytes = await blob.arrayBuffer(),
      v = new DataView(bytes),
      text = (a: number, b: number) =>
        new TextDecoder().decode(bytes.slice(a, b));
    assert.equal(text(0, 4), "RIFF");
    assert.equal(text(8, 12), "WAVE");
    assert.equal(text(12, 16), "fmt ");
    assert.equal(text(36, 40), "data");
    assert.equal(v.getUint32(4, true) + 8, bytes.byteLength);
    assert.equal(v.getUint32(40, true) + 44, bytes.byteLength);
    assert.equal(v.getUint16(20, true), 1);
    assert.equal(v.getUint16(22, true), 1);
    assert.equal(v.getUint16(34, true), 16);
    assert.equal(v.getUint32(24, true), 44100);
    const lane = path.slice(4, -4);
    assert.equal(await hashBlob(blob), await hashBlob(synthesizeKitWav(lane)));
    const samples = synthesizeKit(lane);
    assert.ok(samples.some((n) => Math.abs(n) > 0.01));
    assert.ok(samples.every((n) => Number.isFinite(n) && Math.abs(n) <= 1));
  }
});
test("editor lane aliases produce appropriate original synthetic sounds", () => {
  assert.deepEqual(synthesizeKit("SN"), synthesizeKit("SD"));
  assert.deepEqual(synthesizeKit("LB"), synthesizeKit("BD"));
  assert.deepEqual(synthesizeKit("LP"), synthesizeKit("HH"));
});
test("normalizePath preserves safe relative paths and refuses traversal and absolute paths", () => {
  assert.equal(
    normalizePath(".\\audio\\kit//snare.wav"),
    "audio/kit/snare.wav",
  );
  for (const path of [
    "",
    "/",
    "../a.wav",
    "kit/../../a.wav",
    "C:\\a.wav",
    "/tmp/a.wav",
    "bad\0.wav",
    "a\nb.wav",
  ])
    assert.throws(() => normalizePath(path));
});
test("imports skip identical paths, safely rename conflicts, retain distinct paths with same content", async () => {
  const files = [
    new File(["same"], "snare.wav"),
    new File(["same"], "SNARE.wav"),
    new File(["other"], "snare.wav"),
    new File(["same"], "kick.wav"),
  ];
  const result = await importFiles(files);
  assert.deepEqual(
    result.files.map((f) => f.path),
    ["snare.wav", "snare (2).wav", "kick.wav"],
  );
  assert.equal(result.warnings.length, 2);
  assert.equal(result.files[0].hash, result.files[2].hash);
  assert.notEqual(result.files[0].hash, result.files[1].hash);
  const again = await importFiles([files[0]], result.files);
  assert.equal(again.files.length, 0);
  assert.equal(again.warnings.length, 1);
});
test("folder import strips one selected root while retaining nested resource paths", async () => {
  const chart = new File(["#TITLE: test"], "song.dtx"),
    sample = new File(["wave"], "snare.wav");
  Object.defineProperty(chart, "webkitRelativePath", {
    value: "Song/song.dtx",
  });
  Object.defineProperty(sample, "webkitRelativePath", {
    value: "Song/sounds/snare.wav",
  });
  const imported = await importFiles([chart, sample]);
  assert.deepEqual(
    imported.files.map((f) => f.path),
    ["song.dtx", "sounds/snare.wav"],
  );
  assert.equal(imported.warnings.length, 0);
});
class FakeNode {
  gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  pan = { value: 0 };
  playbackRate = { value: 1 };
  frequency = { value: 0 };
  buffer: unknown;
  onended?: () => void;
  started?: { time: number; offset: number };
  stopped?: number;
  connect() {
    return this;
  }
  disconnect() {}
  start(time = 0, offset = 0) {
    this.started = { time, offset };
  }
  stop(time = 0) {
    this.stopped = time;
    this.onended?.();
  }
}
class FakeContext {
  static latest: FakeContext;
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  constructor() {
    FakeContext.latest = this;
  }
  sources: FakeNode[] = [];
  createGain() {
    return new FakeNode();
  }
  createStereoPanner() {
    return new FakeNode();
  }
  createBufferSource() {
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  }
  createOscillator() {
    return new FakeNode();
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData() {
        return new Float32Array(length);
      },
    };
  }
  async decodeAudioData() {
    return { duration: 10 };
  }
  async resume() {}
  async close() {}
}
test("transport seek, pause, rate and natural end stay bounded", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents(
      [{ time: 0.5, resourceId: "SN", lane: "SN", pan: 0.5 }],
      1,
    );
    transport.setMasterVolume(0.5);
    transport.setReferenceVolume(0.3);
    transport.setDrumVolume(0.8);
    await transport.play();
    FakeContext.latest.currentTime = 0.2;
    assert.equal(transport.currentTime, 0.2);
    transport.pause();
    assert.equal(transport.currentTime, 0.2);
    assert.equal(transport.isPlaying, false);
    transport.seek(0.4);
    transport.setRate(0.5);
    await transport.play();
    FakeContext.latest.currentTime = 0.4;
    assert.ok(Math.abs(transport.currentTime - 0.5) < 1e-8);
    FakeContext.latest.currentTime = 3;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(transport.isPlaying, false);
    assert.equal(transport.currentTime, 1);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("transport loop wraps without running beyond loop boundary", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents([], 4);
    transport.setLoop({ start: 1, end: 2 });
    transport.seek(1);
    await transport.play();
    FakeContext.latest.currentTime = 1.2;
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(Math.abs(transport.currentTime - 1.2) < 1e-8);
    assert.equal(transport.isPlaying, true);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("pause cancels a play still waiting for browser audio permission", async () => {
  const previous = globalThis.AudioContext;
  let resume!: () => void;
  class DelayedContext extends FakeContext {
    override resume(): Promise<void> {
      return new Promise((resolve) => {
        resume = resolve;
      });
    }
  }
  Object.assign(globalThis, { AudioContext: DelayedContext });
  const transport = new AudioTransport();
  try {
    const playing = transport.play();
    transport.pause();
    resume();
    await playing;
    assert.equal(transport.isPlaying, false);
    assert.equal(transport.currentTime, 0);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("missing imported BGM/SE never becomes a synthetic snare, and stale sample IDs are cleared", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents(
      [
        { time: 0, resourceId: "ZZ", channel: "01" },
        { time: 0, resourceId: "ZX", channel: "61", lane: "SN" },
        { time: 0, resourceId: "HH", channel: "11", lane: "HH" },
      ],
      2,
    );
    await transport.play();
    assert.equal(FakeContext.latest.sources.length, 0);
    transport.pause();
    await transport.loadSample("ZZ", new Blob(["fake"]));
    transport.clearSamples();
    await transport.preview("ZZ", "SN");
    assert.equal(FakeContext.latest.sources.length, 0);
    await transport.preview("kit:SN");
    assert.equal(FakeContext.latest.sources.length, 1);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("BGM resumes at seek offset with transport rate while drum audition stays pitch-stable", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    await transport.loadSample("01", new Blob(["fake"]));
    transport.setEvents([{ time: 0, resourceId: "01", channel: "01" }], 12);
    transport.seek(3);
    transport.setRate(0.5);
    await transport.play();
    const bgm = FakeContext.latest.sources[0];
    assert.equal(bgm.started?.offset, 3);
    assert.equal(bgm.playbackRate.value, 0.5);
    await transport.preview("kit:SN");
    assert.equal(FakeContext.latest.sources[1].playbackRate.value, 1);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("hi-hat close and cymbal mute stop their matching voices at scheduled event time", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents(
      [
        { time: 0, resourceId: "kit:HH", lane: "HH", channel: "18" },
        { time: 0.05, resourceId: "kit:HH", lane: "HH", channel: "11" },
        { time: 0, resourceId: "kit:RC", lane: "RC", channel: "16" },
        { time: 0.06, resourceId: "00", channel: "85" },
      ],
      2,
    );
    await transport.play();
    assert.equal(FakeContext.latest.sources[0].stopped, 0.05);
    assert.equal(FakeContext.latest.sources[1].stopped, 0.06);
    assert.equal(FakeContext.latest.sources.length, 3);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("import path mapping exposes cross-pack renames and refuses ambiguous same-name mappings", async () => {
  const first = await importFiles([new File(["old"], "kick.wav")]);
  const second = await importFiles(
    [new File(["new"], "kick.wav")],
    first.files,
  );
  assert.deepEqual(second.pathMap, { "kick.wav": "kick (2).wav" });
  assert.deepEqual(second.ambiguousPaths, []);
  const ambiguous = await importFiles([
    new File(["A"], "same.wav"),
    new File(["B"], "same.wav"),
  ]);
  assert.deepEqual(ambiguous.pathMap, {});
  assert.deepEqual(ambiguous.ambiguousPaths, ["same.wav"]);
});

test("reference decode is last-request-wins, null cancels decode and duration extends chart end", async () => {
  const previous = globalThis.AudioContext;
  const pending: Array<(value: { duration: number }) => void> = [];
  class DecodeContext extends FakeContext {
    override decodeAudioData(): Promise<{ duration: number }> {
      return new Promise((resolve) => pending.push(resolve));
    }
  }
  Object.assign(globalThis, { AudioContext: DecodeContext });
  const transport = new AudioTransport();
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  try {
    transport.setEvents([], 1);
    const a = transport.setReferenceAudio(new Blob(["A"]));
    await flush();
    const b = transport.setReferenceAudio(new Blob(["B"]));
    await flush();
    assert.equal(pending.length, 2);
    pending[1]({ duration: 12 });
    await b;
    pending[0]({ duration: 20 });
    await a;
    assert.equal(transport.duration, 12);
    await transport.play();
    FakeContext.latest.currentTime = 2;
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(transport.isPlaying, true);
    FakeContext.latest.currentTime = 13;
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(transport.isPlaying, false);
    assert.equal(transport.currentTime, 12);
    const c = transport.setReferenceAudio(new Blob(["C"]));
    await flush();
    await transport.setReferenceAudio(null);
    pending[2]({ duration: 30 });
    await c;
    assert.equal(transport.duration, 1);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("loop inside a sustained BGM resumes at loop offset", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    await transport.loadSample("01", new Blob());
    transport.setEvents([{ time: 0, resourceId: "01", channel: "01" }], 12);
    transport.setLoop({ start: 3, end: 4 });
    transport.seek(3);
    await transport.play();
    assert.equal(FakeContext.latest.sources[0].started?.offset, 3);
    FakeContext.latest.currentTime = 1.1;
    await new Promise((r) => setTimeout(r, 35));
    assert.ok(
      Math.abs(FakeContext.latest.sources.at(-1)!.started!.offset - 3.1) < 1e-6,
    );
    assert.equal(transport.isPlaying, true);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
class FakeYouTube {
  static all: FakeYouTube[] = [];
  time = 0;
  destroyed = false;
  rate = 1;
  callbacks: Record<string, (event: { data: number }) => void>;
  constructor(_element: unknown, config: Record<string, unknown>) {
    this.callbacks = config.events as typeof this.callbacks;
    FakeYouTube.all.push(this);
  }
  playVideo() {}
  pauseVideo() {}
  seekTo(time: number) {
    this.time = time;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return 10;
  }
  setPlaybackRate(rate: number) {
    this.rate = rate;
  }
  getAvailablePlaybackRates() {
    return [0.5, 1, 1.5, 2];
  }
  setVolume() {}
  destroy() {
    this.destroyed = true;
  }
  emit(name: string, data = 0) {
    this.callbacks[name]({ data });
  }
}
function fakeYouTubeEnvironment() {
  const previous = {
    AudioContext: globalThis.AudioContext,
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    performance: globalThis.performance,
  };
  let now = 1000;
  Object.assign(globalThis, {
    AudioContext: FakeContext,
    window: { YT: { Player: FakeYouTube } },
    document: { createElement: () => ({}) },
    location: { origin: "http://localhost" },
    performance: { now: () => now },
  });
  FakeYouTube.all = [];
  return {
    container: { replaceChildren() {} } as unknown as HTMLElement,
    advance: () => {
      now += 1000;
    },
    restore: () => Object.assign(globalThis, previous),
  };
}
test("official player callbacks buffer/pause/resume and external rate synchronize the audio clock", async () => {
  const env = fakeYouTubeEnvironment(),
    transport = new AudioTransport();
  let status = "";
  transport.subscribe((s) => {
    status = s.youtubeStatus || "";
  });
  try {
    transport.setEvents([{ time: 1, resourceId: "SN" }], 10);
    const attaching = transport.attachYouTube(env.container, "abcdefghijk");
    await Promise.resolve();
    const player = FakeYouTube.all[0];
    player.emit("onReady");
    await attaching;
    await transport.play();
    assert.equal(transport.isPlaying,false);player.emit("onStateChange",1);await Promise.resolve();
    FakeContext.latest.currentTime = 0.2;
    player.emit("onStateChange", 3);
    assert.equal(transport.isPlaying, false);
    assert.equal(status, "buffering");
    const sources = FakeContext.latest.sources.length;
    FakeContext.latest.currentTime = 5;
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(FakeContext.latest.sources.length, sources);
    assert.equal(transport.currentTime, 0.2);
    player.time = 0.2;
    player.emit("onStateChange", 1);
    await Promise.resolve();
    assert.equal(transport.isPlaying, true);
    env.advance();
    player.emit("onStateChange", 2);
    assert.equal(transport.isPlaying, false);
    env.advance();
    player.emit("onStateChange", 1);
    await Promise.resolve();
    assert.equal(transport.isPlaying, true);
    player.emit("onPlaybackRateChange", 0.5);
    await Promise.resolve();
    assert.equal(transport.rate, 0.5);
    player.emit("onStateChange", 0);
    assert.equal(transport.isPlaying, false);
  } finally {
    transport.dispose();
    env.restore();
  }
});
test("stale YouTube ready/error callbacks cannot overwrite newer attachment; 101/153 stop running clock", async () => {
  const env = fakeYouTubeEnvironment(),
    transport = new AudioTransport();
  let status = "",
    error = "";
  transport.subscribe((s) => {
    status = s.youtubeStatus || "";
    error = s.youtubeError || "";
  });
  try {
    transport.setEvents([], 10);
    const first = transport.attachYouTube(env.container, "abcdefghijk");
    await Promise.resolve();
    const old = FakeYouTube.all[0];
    const next = transport.attachYouTube(env.container, "zyxwvutsrqp");
    await Promise.resolve();
    const current = FakeYouTube.all[1];
    old.emit("onReady");
    old.emit("onError", 101);
    await first;
    assert.equal(status, "loading");
    assert.equal(error, "");
    assert.equal(old.destroyed, true);
    current.emit("onReady");
    await next;
    await transport.play();current.emit("onStateChange",1);await Promise.resolve();assert.equal(transport.isPlaying,true);
    current.emit("onError", 101);
    assert.equal(transport.isPlaying, false);
    assert.match(error, /101/);
    await transport.play();current.emit("onStateChange",1);await Promise.resolve();assert.equal(transport.isPlaying,true);
    current.emit("onError", 153);
    assert.equal(transport.isPlaying, false);
    assert.match(error, /153/);
    transport.detachYouTube();
    current.emit("onStateChange", 1);
    await Promise.resolve();
    assert.equal(transport.isPlaying, false);
  } finally {
    transport.dispose();
    env.restore();
  }
});
test("reference source offset trims intro or delays source onset, with matching duration", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents([], 1);
    await transport.setReferenceAudio(new Blob());
    transport.setReferenceOffset(3);
    assert.equal(transport.duration, 7);
    await transport.play();
    assert.deepEqual(FakeContext.latest.sources.at(-1)!.started, {
      time: 0,
      offset: 3,
    });
    transport.pause();
    transport.seek(0);
    transport.setReferenceOffset(-2);
    assert.equal(transport.duration, 12);
    await transport.play();
    assert.deepEqual(FakeContext.latest.sources.at(-1)!.started, {
      time: 2,
      offset: 0,
    });
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("YouTube offset translates chart seek into source seek and player position back into chart time", async () => {
  const env = fakeYouTubeEnvironment(),
    transport = new AudioTransport();
  try {
    transport.setEvents([], 1);
    transport.setReferenceOffset(3);
    const attaching = transport.attachYouTube(env.container, "abcdefghijk");
    await Promise.resolve();
    const player = FakeYouTube.all[0];
    player.emit("onReady");
    await attaching;
    assert.equal(player.time, 3);
    assert.equal(transport.duration, 7);
    transport.seek(2);
    assert.equal(player.time, 5);
    env.advance();
    player.time = 6;
    player.emit("onStateChange", 1);
    await Promise.resolve();
    assert.equal(transport.currentTime, 3);
    transport.pause();
    transport.setReferenceOffset(-2);
    transport.seek(0);
    assert.equal(player.time, 0);
  } finally {
    transport.dispose();
    env.restore();
  }
});
test("stopPreview and replacing auditions never stop scheduled chart or BGM voices", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    await transport.loadSample("01", new Blob());
    transport.setEvents(
      [
        { time: 0, resourceId: "01", channel: "01" },
        { time: 0, resourceId: "kit:SN", channel: "12", lane: "SN" },
      ],
      12,
    );
    await transport.play();
    const [bgm, drum] = FakeContext.latest.sources;
    await transport.preview("kit:RC", "RC");
    const first = FakeContext.latest.sources.at(-1)!;
    await transport.preview("kit:SN", "SN");
    const second = FakeContext.latest.sources.at(-1)!;
    assert.equal(first.stopped, 0);
    assert.equal(second.stopped, undefined);
    assert.equal(bgm.stopped, undefined);
    assert.equal(drum.stopped, undefined);
    transport.stopPreview();
    assert.equal(second.stopped, 0);
    assert.equal(bgm.stopped, undefined);
    assert.equal(drum.stopped, undefined);
    assert.equal(transport.isPlaying, true);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("stopPreview cancels an audition awaiting AudioContext resume", async () => {
  const previous = globalThis.AudioContext;
  let resume!: () => void;
  class DelayedPreviewContext extends FakeContext {
    override resume(): Promise<void> {
      return new Promise((resolve) => {
        resume = resolve;
      });
    }
  }
  Object.assign(globalThis, { AudioContext: DelayedPreviewContext });
  const transport = new AudioTransport();
  try {
    const pending = transport.preview("kit:SN");
    transport.stopPreview();
    resume();
    await pending;
    assert.equal(FakeContext.latest.sources.length, 0);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test("live MIDI previews layer cymbal tails and choke only input hi-hat voices", async () => {
  const previous = globalThis.AudioContext;
  Object.assign(globalThis, { AudioContext: FakeContext });
  const transport = new AudioTransport();
  try {
    transport.setEvents(
      [{ time: 0, resourceId: "kit:HH", lane: "HH", channel: "18" }],
      4,
    );
    await transport.play();
    const scheduled = FakeContext.latest.sources[0];
    await transport.previewInput("kit:RC", "RC");
    const cymbal = FakeContext.latest.sources.at(-1)!;
    await transport.previewInput("kit:SN", "SN");
    assert.equal(cymbal.stopped, undefined);
    await transport.previewInput("kit:HH", "HH", 1, 0, "18");
    const openHat = FakeContext.latest.sources.at(-1)!;
    await transport.previewInput("kit:HH", "HH", 1, 0, "11");
    assert.equal(openHat.stopped, 0);
    assert.equal(cymbal.stopped, undefined);
    assert.equal(scheduled.stopped, undefined);
    transport.stopPreview();
    assert.equal(cymbal.stopped, 0);
    assert.equal(scheduled.stopped, undefined);
  } finally {
    transport.dispose();
    Object.assign(globalThis, { AudioContext: previous });
  }
});
test('YouTube play request never advances chart without PLAYING callback and watchdog gives actionable error',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const env=fakeYouTubeEnvironment(),transport=new AudioTransport();let status='',error='';transport.subscribe(s=>{status=s.youtubeStatus||'';error=s.youtubeError||'';});
 try{transport.setEvents([{time:0,resourceId:'kit:SN'}],20);const attaching=transport.attachYouTube(env.container,'abcdefghijk');await Promise.resolve();const player=FakeYouTube.all[0];player.emit('onReady');await attaching;await transport.play();assert.equal(status,'waiting');assert.equal(transport.isPlaying,false);assert.equal(FakeContext.latest.sources.length,0);FakeContext.latest.currentTime=25;assert.equal(transport.currentTime,0);player.emit('onStateChange',-1);assert.equal(transport.isPlaying,false);t.mock.timers.tick(12000);assert.equal(transport.isPlaying,false);assert.equal(transport.currentTime,0);assert.equal(FakeContext.latest.sources.length,0);assert.equal(status,'error');assert.match(error,/Click play inside|local audio/);}
 finally{transport.dispose();env.restore();t.mock.timers.reset();}
});
test('YouTube PLAYING callback starts chart only after confirmation; pause cancels pending startup watchdog',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const env=fakeYouTubeEnvironment(),transport=new AudioTransport();let error='';transport.subscribe(s=>error=s.youtubeError||'');
 try{transport.setEvents([{time:0,resourceId:'kit:SN'}],20);const attaching=transport.attachYouTube(env.container,'abcdefghijk');await Promise.resolve();const player=FakeYouTube.all[0];player.emit('onReady');await attaching;await transport.play();assert.equal(transport.isPlaying,false);player.emit('onStateChange',1);await Promise.resolve();assert.equal(transport.isPlaying,true);assert.equal(FakeContext.latest.sources.length,1);transport.pause();await transport.play();assert.equal(transport.isPlaying,false);transport.pause();t.mock.timers.tick(15000);assert.equal(error,'');assert.equal(transport.isPlaying,false);}
 finally{transport.dispose();env.restore();t.mock.timers.reset();}
});
