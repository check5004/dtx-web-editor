/** Original, procedurally generated practice sounds. No bundled recordings. */
export const KIT_LANES = [
  "LC",
  "HH",
  "SD",
  "SN",
  "LP",
  "LB",
  "BD",
  "HT",
  "LT",
  "FT",
  "RC",
  "RD",
] as const;
export type KitLane = (typeof KIT_LANES)[number];
export const synthResourceId = (lane: string): string => `kit:${lane}`;
export interface TransportEvent {
  time: number;
  resourceId: string;
  lane?: string;
  volume?: number;
  pan?: number;
  channel?: string;
  kind?: "sample" | "bgm" | "mute";
}
export interface TransportState {
  time: number;
  playing: boolean;
  rate: number;
  duration: number;
  youtubeStatus?: string;
  youtubeError?: string;
}
export interface LoopRange {
  start: number;
  end: number;
}
interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        config: Record<string, unknown>,
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeAPI: Promise<void> | undefined;
function loadYouTubeAPI(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return (youtubeAPI ||= new Promise((resolve, reject) => {
    const old = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      old?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      youtubeAPI = undefined;
      reject(
        new Error(
          "YouTube player could not load. Check network/privacy settings.",
        ),
      );
    };
    document.head.append(script);
    setTimeout(() => {
      if (!window.YT?.Player) {
        youtubeAPI = undefined;
        reject(new Error("YouTube player timed out."));
      }
    }, 20000);
  }));
}
export function synthesizeKit(lane: string, sampleRate = 44100): Float32Array {
  lane =
    lane === "SN" ? "SD" : lane === "LB" ? "BD" : lane === "LP" ? "HH" : lane;
  const cymbal = ["HH", "LC", "RC", "RD"].includes(lane);
  const duration =
    lane === "HH" ? 0.16 : cymbal ? 1.25 : lane === "BD" ? 0.32 : 0.42;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = 12345,
    previous = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const high = noise - previous;
    previous = noise;
    const attack = Math.min(1, t * 800);
    let v: number;
    if (cymbal) {
      const decay = lane === "HH" ? 35 : lane === "RD" ? 6 : 4;
      v =
        (high * 0.28 +
          Math.sin(t * 2 * Math.PI * (lane === "RD" ? 3100 : 7100)) * 0.08) *
        Math.exp(-t * decay);
    } else if (lane === "SD")
      v =
        0.55 * noise * Math.exp(-t * 19) +
        0.35 * Math.sin(2 * Math.PI * 175 * t) * Math.exp(-t * 24);
    else {
      const f =
        lane === "BD" ? 52 : lane === "HT" ? 185 : lane === "LT" ? 130 : 90;
      v =
        Math.sin(2 * Math.PI * (f * t + 3 * (1 - Math.exp(-t * 35)))) *
          Math.exp(-t * (lane === "BD" ? 15 : 11)) *
          0.8 +
        noise * 0.06 * Math.exp(-t * 70);
    }
    samples[i] = Math.max(-1, Math.min(1, v * attack));
  }
  return samples;
}
export function synthesizeKitWav(lane: string): Blob {
  const rate = 44100,
    samples = synthesizeKit(lane, rate),
    buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const str = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) =>
    view.setInt16(44 + i * 2, Math.round(v * 32767), true),
  );
  return new Blob([buffer], { type: "audio/wav" });
}
export function exportDefaultKit(): Map<string, Blob> {
  return new Map(
    KIT_LANES.map((lane) => [`kit/${lane}.wav`, synthesizeKitWav(lane)]),
  );
}

export class AudioTransport {
  private context?: AudioContext;
  private samples = new Map<string, AudioBuffer>();
  private sampleGeneration = 0;
  private events: TransportEvent[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private previewSources = new Set<AudioBufferSourceNode>();
  private previewGeneration = 0;
  private voices = new Map<string, Set<AudioBufferSourceNode>>();
  private inputVoices = new Map<string, Set<AudioBufferSourceNode>>();
  private clickTimeline?: Array<{ time: number; accent?: boolean }>;
  private reference?: AudioBuffer;
  private referenceGeneration = 0;
  private referenceOffsetSeconds = 0;
  private youtubeWaitingOffset = false;
  private referenceSource?: AudioBufferSourceNode;
  private masterGain?: GainNode;
  private drumGain?: GainNode;
  private referenceGain?: GainNode;
  private masterVolume = 1;
  private drumVolume = 1;
  private referenceVolume = 1;
  private player?: YouTubePlayer;
  private youtubeReady = false;
  private youtubeStatus = "detached";
  private youtubeError?: string;
  private youtubeDesiredPlay = false;
  private youtubeStartWatchdog?:ReturnType<typeof setTimeout>;
  private ignoreYouTubeUntil = 0;
  private youtubeGeneration = 0;
  private cancelYouTubeLoad?: () => void;
  private listeners = new Set<(state: TransportState) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private origin = 0;
  private position = 0;
  private running = false;
  private playGeneration = 0;
  private speed = 1;
  private cursor = 0;
  private nextClick = 0;
  private bpm = 120;
  private metronome = false;
  private loop: LoopRange | null = null;
  private lastCorrection = 0;
  private length = 0;
  /** Seconds added to hit scheduling; positive delays drum hits. Set before play. */
  latencyOffset = 0;
  get isPlaying(): boolean {
    return this.running;
  }
  get currentTime(): number {
    return this.running && this.context
      ? this.position + (this.context.currentTime - this.origin) * this.speed
      : this.position;
  }
  get rate(): number {
    return this.speed;
  }
  get referenceOffset(): number {
    return this.referenceOffsetSeconds;
  }
  /** sourceTime = chartTime + offset. Negative offsets delay source onset. */
  setReferenceOffset(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const playing = this.running;
    this.pause();
    this.referenceOffsetSeconds = seconds;
    this.player?.seekTo(Math.max(0, this.position + seconds), true);
    if (playing) void this.play();
    else this.emit();
  }
  get duration(): number {
    const sourceDuration =
      this.reference?.duration ||
      (this.youtubeReady ? this.player?.getDuration() : 0) ||
      0;
    return Math.max(
      this.length,
      sourceDuration ? sourceDuration - this.referenceOffsetSeconds : 0,
    );
  }
  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.context.destination);
      this.drumGain = this.context.createGain();
      this.drumGain.gain.value = this.drumVolume;
      this.drumGain.connect(this.masterGain);
      this.referenceGain = this.context.createGain();
      this.referenceGain.gain.value = this.referenceVolume;
      this.referenceGain.connect(this.masterGain);
      for (const lane of KIT_LANES) {
        const wave = synthesizeKit(lane, this.context.sampleRate),
          buffer = this.context.createBuffer(
            1,
            wave.length,
            this.context.sampleRate,
          );
        buffer.getChannelData(0).set(wave);
        this.samples.set(synthResourceId(lane), buffer);
      }
    }
    return this.context;
  }
  clearSamples(): void {
    this.stopPreview();
    this.sampleGeneration++;
    for (const id of this.samples.keys())
      if (!id.startsWith("kit:")) this.samples.delete(id);
  }
  async loadSample(id: string, file: Blob): Promise<void> {
    const generation = this.sampleGeneration,
      ctx = this.ensureContext(),
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (generation === this.sampleGeneration) this.samples.set(id, buffer);
  }
  async setReferenceAudio(file: Blob | null): Promise<void> {
    const generation = ++this.referenceGeneration;
    const buffer = file
      ? await this.ensureContext().decodeAudioData(await file.arrayBuffer())
      : undefined;
    if (generation !== this.referenceGeneration) return;
    const playing = this.running;
    this.pause();
    if (file) this.detachYouTube();
    this.reference = buffer;
    if (playing) await this.play();
    else this.emit();
  }
  setMasterVolume(value: number): void {
    this.masterVolume = Math.max(
      0,
      Math.min(1, Number.isFinite(value) ? value : 1),
    );
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
    this.updateYouTubeVolume();
  }
  setDrumVolume(value: number): void {
    this.drumVolume = Math.max(
      0,
      Math.min(1, Number.isFinite(value) ? value : 1),
    );
    if (this.drumGain) this.drumGain.gain.value = this.drumVolume;
  }
  setReferenceVolume(value: number): void {
    this.referenceVolume = Math.max(
      0,
      Math.min(1, Number.isFinite(value) ? value : 1),
    );
    if (this.referenceGain)
      this.referenceGain.gain.value = this.referenceVolume;
    this.updateYouTubeVolume();
  }
  private updateYouTubeVolume(): void {
    if (this.youtubeReady)
      this.player?.setVolume(this.masterVolume * this.referenceVolume * 100);
  }
  setEvents(events: TransportEvent[], duration?: number): void {
    this.events = events
      .filter((e) => Number.isFinite(e.time) && e.time >= 0)
      .map((e) => ({ ...e }))
      .sort((a, b) => a.time - b.time);
    this.length = duration ?? (this.events.at(-1)?.time || 0) + 2;
    this.seek(this.currentTime);
  }
  setBeatEvents(
    events: Array<{ beat: number; resourceId: string; lane?: string }>,
    beatToSeconds: (beat: number) => number,
  ): void {
    this.setEvents(events.map((e) => ({ ...e, time: beatToSeconds(e.beat) })));
  }
  subscribe(listener: (state: TransportState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private state(): TransportState {
    return {
      time: this.currentTime,
      playing: this.running,
      rate: this.speed,
      duration: this.duration,
      youtubeStatus: this.youtubeStatus,
      youtubeError: this.youtubeError,
    };
  }
  private emit(): void {
    const state = this.state();
    this.listeners.forEach((l) => l(state));
  }
  async play(skipYouTube = false): Promise<void> {
    if (this.running) return;
    const generation = ++this.playGeneration;
    const ctx = this.ensureContext();
    await ctx.resume();
    if (this.running || generation !== this.playGeneration) return;
    if (!skipYouTube && this.youtubeStatus !== 'detached' && this.position+this.referenceOffsetSeconds>=0 && this.youtubeStatus!=='playing') {
      this.youtubeDesiredPlay=true;this.youtubeError=undefined;this.youtubeStatus=this.youtubeReady?'waiting':'loading';
      this.armYouTubeWatchdog();
      if(this.youtubeReady){this.ignoreYouTubeUntil=performance.now()+500;this.player?.seekTo(Math.max(0,this.position+this.referenceOffsetSeconds),true);this.player?.playVideo();}
      this.emit();return;
    }
    this.clearYouTubeWatchdog();
    this.origin = ctx.currentTime;
    this.running = true;
    this.resetCursor();
    this.startReference();
    this.resumeBgm();
    this.youtubeDesiredPlay = true;
    if (this.youtubeReady && !skipYouTube) {
      this.ignoreYouTubeUntil = performance.now() + 500;
      this.player?.seekTo(
        Math.max(0, this.position + this.referenceOffsetSeconds),
        true,
      );
      this.youtubeWaitingOffset =
        this.position + this.referenceOffsetSeconds < 0;
      if (!this.youtubeWaitingOffset) this.player?.playVideo();
      else this.player?.pauseVideo();
    }
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }
  pause(skipYouTube = false): void {
    this.playGeneration++;
    if (this.running) this.position = this.currentTime;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopSources();
    if (!skipYouTube) {
      this.clearYouTubeWatchdog();
      if(this.youtubeReady&&this.youtubeStatus!=='error')this.youtubeStatus='paused';
      this.youtubeDesiredPlay = false;
      this.ignoreYouTubeUntil = performance.now() + 500;
      this.player?.pauseVideo();
    }
    this.emit();
  }
  seek(seconds: number): void {
    const wasRunning = this.running||this.youtubeDesiredPlay;
    this.pause();
    this.position = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.player?.seekTo(
      Math.max(0, this.position + this.referenceOffsetSeconds),
      true,
    );
    this.resetCursor();
    this.emit();
    if (wasRunning) void this.play();
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const wasRunning = this.running||this.youtubeDesiredPlay;
    this.pause();
    this.speed = Math.max(0.25, Math.min(2, rate));
    if (this.youtubeReady) {
      const available = this.player?.getAvailablePlaybackRates();
      const rates = available?.length ? available : [1];
      const closest = rates.reduce((a, b) =>
        Math.abs(b - this.speed) < Math.abs(a - this.speed) ? b : a,
      );
      this.speed = closest;
      this.player?.setPlaybackRate(closest);
    }
    if (wasRunning) void this.play();
    else this.emit();
  }
  setLoop(loop: LoopRange | null): void {
    this.loop =
      loop &&
      Number.isFinite(loop.start) &&
      Number.isFinite(loop.end) &&
      loop.start >= 0 &&
      loop.end > loop.start + 0.05
        ? { ...loop }
        : null;
    if (this.running) this.seek(this.currentTime);
  }
  setMetronomeTimeline(
    beats: Array<{ time: number; accent?: boolean }> | null,
  ): void {
    this.clickTimeline = beats
      ?.filter((b) => Number.isFinite(b.time) && b.time >= 0)
      .sort((a, b) => a.time - b.time);
    this.resetCursor();
  }
  setMetronome(bpm: number, enabled: boolean): void {
    this.bpm = Math.max(20, Math.min(400, bpm || 120));
    this.metronome = enabled;
    this.nextClick = this.clickTimeline
      ? this.clickTimeline.findIndex((b) => b.time >= this.currentTime)
      : Math.ceil(this.currentTime / (60 / this.bpm));
    if (this.nextClick < 0) this.nextClick = this.clickTimeline?.length || 0;
  }
  /** Preview a sound, normally called directly from a user gesture. */
  async preview(
    resourceId: string,
    lane = "SD",
    volume = 1,
    pan = 0,
  ): Promise<void> {
    this.stopPreview();
    const generation = this.previewGeneration,
      ctx = this.ensureContext();
    await ctx.resume();
    if (generation !== this.previewGeneration) return;
    this.hit(
      { time: 0, resourceId, lane, volume, pan },
      ctx.currentTime,
      0,
      true,
    );
  }
  /** Layered live MIDI/keyboard hit. Unlike preview(), cymbal tails are retained. */
  async previewInput(
    resourceId: string,
    lane = "SD",
    volume = 1,
    pan = 0,
    channel?: string,
  ): Promise<void> {
    const generation = this.previewGeneration,
      ctx = this.ensureContext();
    await ctx.resume();
    if (generation !== this.previewGeneration) return;
    const channels: Record<string, string> = {
      HH: "11",
      LP: "1B",
      SN: "12",
      SD: "12",
      BD: "13",
      LB: "1C",
      HT: "14",
      LT: "15",
      FT: "17",
      RC: "16",
      RD: "19",
      LC: "1A",
    };
    this.hit(
      {
        time: 0,
        resourceId,
        lane,
        volume,
        pan,
        channel: channel || channels[lane],
      },
      ctx.currentTime,
      0,
      true,
      true,
    );
  }
  /** Stops only resource auditions; chart/BGM/reference playback is untouched. */
  stopPreview(): void {
    this.previewGeneration++;
    for (const source of this.previewSources) {
      try {
        source.stop();
      } catch {
        /* ended */
      }
    }
    this.previewSources.clear();
    this.inputVoices.clear();
  }
  private resetCursor(): void {
    const t = this.position - Math.max(0, this.latencyOffset);
    this.cursor = this.events.findIndex((e) => e.time >= t - 0.001);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.nextClick = this.clickTimeline
      ? this.clickTimeline.findIndex((b) => b.time >= this.position)
      : Math.ceil(this.position / (60 / this.bpm));
    if (this.nextClick < 0) this.nextClick = this.clickTimeline?.length || 0;
  }
  private stopSources(): void {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    });
    this.sources.clear();
    this.voices.clear();
    this.referenceSource = undefined;
  }
  private startReference(): void {
    const ctx = this.context;
    if (
      !ctx ||
      !this.reference ||
      this.position + this.referenceOffsetSeconds >= this.reference.duration
    )
      return;
    const source = ctx.createBufferSource();
    source.buffer = this.reference;
    source.playbackRate.value = this.speed;
    source.connect(this.referenceGain!);
    const sourceTime = this.position + this.referenceOffsetSeconds;
    source.start(
      ctx.currentTime + Math.max(0, -sourceTime) / this.speed,
      Math.max(0, sourceTime),
    );
    this.sources.add(source);
    this.referenceSource = source;
    source.onended = () => this.sources.delete(source);
  }
  private resumeBgm(): void {
    if (!this.context) return;
    for (const e of this.events) {
      if (e.time >= this.position) break;
      if (e.kind === "bgm" || e.channel === "01") {
        const buffer = this.samples.get(e.resourceId),
          offset = this.position - e.time;
        if (buffer && offset < buffer.duration)
          this.hit(e, this.context.currentTime, offset);
      }
    }
  }
  private choke(group: string, at: number, preview = false): void {
    const voices = preview ? this.inputVoices : this.voices;
    voices.get(group)?.forEach((s) => {
      try {
        s.stop(at);
      } catch {
        /* ended */
      }
    });
    voices.delete(group);
  }
  private hit(
    event: TransportEvent,
    at: number,
    offset = 0,
    preview = false,
    input = false,
  ): void {
    const ctx = this.context;
    if (!ctx) return;
    const muteGroup: Record<string, string> = {
      "84": "HH",
      "85": "RC",
      "86": "RD",
      "87": "LC",
    };
    if (event.kind === "mute" || muteGroup[event.channel || ""]) {
      this.choke(
        muteGroup[event.channel || ""] || event.lane || "",
        at,
        preview,
      );
      return;
    }
    const buffer = this.samples.get(event.resourceId);
    if (!buffer) return;
    const voices = preview ? this.inputVoices : this.voices;
    const group = preview && !input ? "" : event.lane || "";
    if ((event.channel === "11" || event.channel === "1B") && group)
      this.choke("HH", at, preview);
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    if (event.kind === "bgm" || event.channel === "01")
      source.playbackRate.value = this.speed;
    gain.gain.value = Math.max(0, Math.min(2, event.volume ?? 1));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, event.pan ?? 0));
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.drumGain!);
    (preview ? this.previewSources : this.sources).add(source);
    if (group) {
      if (!voices.has(group)) voices.set(group, new Set());
      voices.get(group)!.add(source);
    }
    source.onended = () => {
      this.sources.delete(source);
      this.previewSources.delete(source);
      if (group) voices.get(group)?.delete(source);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    source.start(Math.max(ctx.currentTime, at), offset);
  }
  private tick(): void {
    if (!this.running || !this.context) return;
    const time = this.currentTime;
    if (this.loop && time >= this.loop.end) {
      this.seek(
        this.loop.start +
          ((time - this.loop.end) % (this.loop.end - this.loop.start)),
      );
      return;
    }
    if (!this.loop && this.duration > 0 && time >= this.duration) {
      this.pause();
      this.position = this.duration;
      this.emit();
      return;
    }
    const horizon = Math.min(
      time + 0.1 * this.speed,
      this.loop?.end ?? Infinity,
    );
    while (
      this.cursor < this.events.length &&
      this.events[this.cursor].time + this.latencyOffset < horizon
    ) {
      const e = this.events[this.cursor++];
      const adjusted = e.time + this.latencyOffset;
      if (adjusted >= time - 0.04 && (!this.loop || e.time < this.loop.end))
        this.hit(e, this.context.currentTime + (adjusted - time) / this.speed);
    }
    if (this.metronome) {
      const step = 60 / this.bpm;
      while (
        (this.clickTimeline
          ? (this.clickTimeline[this.nextClick]?.time ?? Infinity)
          : this.nextClick * step) < horizon
      ) {
        const click = this.clickTimeline?.[this.nextClick];
        const t = click?.time ?? this.nextClick * step;
        this.nextClick++;
        if (t >= time - 0.04) {
          const osc = this.context.createOscillator(),
            gain = this.context.createGain(),
            at =
              this.context.currentTime + Math.max(0, (t - time) / this.speed);
          osc.frequency.value = (
            this.clickTimeline ? click?.accent : (this.nextClick - 1) % 4 === 0
          )
            ? 1400
            : 1000;
          gain.gain.setValueAtTime(0.08, at);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.025);
          osc.connect(gain);
          gain.connect(this.drumGain!);
          osc.start(at);
          osc.stop(at + 0.03);
          osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
          };
        }
      }
    }
    // The official embedded player is not sample accurate. Only correct material drift,
    // at most every three seconds; never fetch or extract YouTube media.
    if (
      this.youtubeReady &&
      this.youtubeWaitingOffset &&
      time + this.referenceOffsetSeconds >= 0
    ) {
      this.youtubeWaitingOffset = false;
      this.ignoreYouTubeUntil = performance.now() + 500;
      this.player?.seekTo(
        Math.max(0, time + this.referenceOffsetSeconds),
        true,
      );
      this.pause(true);this.youtubeDesiredPlay=true;this.youtubeStatus='waiting';this.armYouTubeWatchdog();this.player?.playVideo();return;
    }
    if (
      this.youtubeReady &&
      !this.youtubeWaitingOffset &&
      performance.now() - this.lastCorrection > 3000
    ) {
      this.lastCorrection = performance.now();
      const yt = this.player?.getCurrentTime();
      if (
        yt !== undefined &&
        Math.abs(yt - (time + this.referenceOffsetSeconds)) > 0.4
      )
        this.player?.seekTo(
          Math.max(0, time + this.referenceOffsetSeconds),
          true,
        );
    }
    this.emit();
  }
  private clearYouTubeWatchdog():void {if(this.youtubeStartWatchdog)clearTimeout(this.youtubeStartWatchdog);this.youtubeStartWatchdog=undefined;}
  private armYouTubeWatchdog():void {
    if(this.youtubeStartWatchdog)return;
    this.youtubeStartWatchdog=setTimeout(()=>{this.youtubeStartWatchdog=undefined;if(!this.youtubeDesiredPlay)return;this.youtubeDesiredPlay=false;this.pause(true);this.player?.pauseVideo();this.youtubeStatus='error';this.youtubeError='YouTube did not start within 12 seconds. Click play inside the video, allow the embed/cookies, or use a local audio file. Chart playback is paused.';this.emit();},12000);
  }
  private youtubeStateChanged(code: number): void {
    const ignored = performance.now() < this.ignoreYouTubeUntil;
    this.youtubeStatus =
      (
        {
          [-1]: "unstarted",
          0: "ended",
          1: "playing",
          2: "paused",
          3: "buffering",
          5: "cued",
        } as Record<number, string>
      )[code] || "unknown";
    if ((code === 3 || code === -1 || code === 5) && (this.running||this.youtubeDesiredPlay)) {
      this.pause(true);this.youtubeDesiredPlay=true;this.armYouTubeWatchdog();
    } else if (
      code === 1 &&
      !this.running &&
      (this.youtubeDesiredPlay || !ignored)
    ) {
      this.clearYouTubeWatchdog();this.youtubeError=undefined;
      this.position = Math.max(
        0,
        (this.player?.getCurrentTime() ??
          this.position + this.referenceOffsetSeconds) -
          this.referenceOffsetSeconds,
      );
      void this.play(true);
    } else if (code === 2 && !ignored) {
      this.clearYouTubeWatchdog();this.youtubeDesiredPlay = false;
      if (this.running) this.pause(true);
    } else if (code === 0) {
      this.clearYouTubeWatchdog();this.youtubeDesiredPlay = false;
      this.pause(true);
    }
    this.emit();
  }
  async attachYouTube(container: HTMLElement, videoId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
      throw new Error("Enter a valid 11-character YouTube video ID.");
    const resumeAfterAttach=this.running||this.youtubeDesiredPlay;this.pause();
    this.referenceGeneration++;
    this.detachYouTube();this.youtubeDesiredPlay=resumeAfterAttach;
    this.youtubeStatus = "loading";
    this.youtubeError = undefined;
    this.emit();
    const generation = this.youtubeGeneration;
    await loadYouTubeAPI();
    if (generation !== this.youtubeGeneration) return;
    this.reference = undefined;
    if (this.referenceSource) {
      try {
        this.referenceSource.stop();
      } catch {
        /* ended */
      }
      this.referenceSource = undefined;
    }
    const mount = document.createElement("div");
    container.replaceChildren(mount);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cancelYouTubeLoad = undefined;
        reject(new Error("YouTube player initialization timed out."));
      }, 20000);
      const finish = () => {
        clearTimeout(timeout);
        if (this.cancelYouTubeLoad === finish)
          this.cancelYouTubeLoad = undefined;
        resolve();
      };
      this.cancelYouTubeLoad = finish;
      this.player = new window.YT!.Player(mount, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "220",
        playerVars: { playsinline: 1, controls: 1, origin: location.origin },
        events: {
          onReady: () => {
            if (generation !== this.youtubeGeneration) {
              finish();
              return;
            }
            this.youtubeReady = true;
            this.youtubeStatus = "ready";
            this.updateYouTubeVolume();
            this.player?.seekTo(
              Math.max(0, this.currentTime + this.referenceOffsetSeconds),
              true,
            );
            const wanted=this.youtubeDesiredPlay||this.running;
            this.setRate(this.speed);
            if(wanted)void this.play();
            finish();
          },
          onStateChange: (event: { data: number }) => {
            if (generation === this.youtubeGeneration)
              this.youtubeStateChanged(event.data);
          },
          onPlaybackRateChange: (event: { data: number }) => {
            if (
              generation === this.youtubeGeneration &&
              Math.abs(event.data - this.speed) > 0.001
            )
              this.setRate(event.data);
          },
          onError: (event: { data: number }) => {
            if (generation !== this.youtubeGeneration) {
              finish();
              return;
            }
            clearTimeout(timeout);
            this.cancelYouTubeLoad = undefined;
            const reasons: Record<number, string> = {
              2: "Invalid video ID",
              5: "HTML5 player cannot decode this video",
              100: "Video removed or private",
              101: "Embedding disabled by owner",
              150: "Embedding disabled by owner",
              153: "YouTube requires an HTTP origin / Referer",
            };
            this.clearYouTubeWatchdog();
            this.youtubeError = `YouTube ${event.data}: ${reasons[event.data] || "Playback failed"}`;
            this.youtubeStatus = "error";
            this.youtubeDesiredPlay = false;
            this.pause(true);
            reject(new Error(this.youtubeError));
          },
        },
      });
    });
  }
  detachYouTube(): void {
    this.clearYouTubeWatchdog();
    this.youtubeGeneration++;
    this.cancelYouTubeLoad?.();
    this.cancelYouTubeLoad = undefined;
    this.youtubeReady = false;
    this.youtubeWaitingOffset = false;
    this.youtubeDesiredPlay = false;
    this.youtubeStatus = "detached";
    this.youtubeError = undefined;
    this.player?.destroy();
    this.player = undefined;
  }
  dispose(): void {
    this.referenceGeneration++;
    this.stopPreview();
    this.pause();
    this.detachYouTube();
    void this.context?.close();
    this.listeners.clear();
  }
}
