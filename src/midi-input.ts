import {
  validateMidiProfile,
  type MidiDeviceIdentity,
  type MidiProfile,
  type MidiTarget,
} from "./midi-profiles";
export interface MidiMessage {
  inputId: string;
  channel: number;
  kind: "note" | "off" | "cc";
  number: number;
  value: number;
  timeStamp: number;
}
export interface MidiHit {
  latencyMs?: number;
  inputId: string;
  profileId: string;
  zone: string;
  velocity: number;
  timeStamp: number;
  target: MidiTarget;
}
export function parseMidiMessage(
  inputId: string,
  data: ArrayLike<number>,
  timeStamp: number,
): MidiMessage | null {
  if (data.length !== 3 || !Number.isFinite(timeStamp)) return null;
  const [status, n, value] = Array.from(data);
  if (
    ![status, n, value].every(Number.isInteger) ||
    n < 0 ||
    n > 127 ||
    value < 0 ||
    value > 127 ||
    status < 0x80 ||
    status > 0xef
  )
    return null;
  const type = status & 0xf0,
    kind =
      type === 0x90
        ? value === 0
          ? "off"
          : "note"
        : type === 0x80
          ? "off"
          : type === 0xb0
            ? "cc"
            : null;
  return kind
    ? { inputId, channel: (status & 15) + 1, kind, number: n, value, timeStamp }
    : null;
}
interface PedalState {
  state: "open" | "half" | "closed";
  time: number;
  closedAt?: number;
  armed: boolean;
}
export interface MidiLearn {
  inputId: string;
  kind: "note" | "cc";
  onLearn: (message: MidiMessage) => void;
}
/** Pure resolver: explicit port binding, one active mode per port, no name-based fallback. */
export class MidiInputEngine {
  private bindings = new Map<string, MidiProfile>();
  private pedals = new Map<string, PedalState>();
  private learn: MidiLearn | null = null;
  constructor(
    private onHit: (hit: MidiHit) => void,
    private onMessage?: (message: MidiMessage) => void,
  ) {}
  bind(inputId: string, profile: MidiProfile | null): void {
    this.reset(inputId);
    if (profile) this.bindings.set(inputId, validateMidiProfile(profile));
    else this.bindings.delete(inputId);
  }
  reset(inputId?: string): void {
    if (inputId === undefined) this.pedals.clear();
    else this.pedals.delete(inputId);
  }
  unbind(inputId: string): void {
    this.bindings.delete(inputId);
    this.reset(inputId);
    if (this.learn?.inputId === inputId) this.cancelLearning();
  }
  setLearning(learn: MidiLearn): void {
    this.learn = learn;
    this.reset();
  }
  cancelLearning(): void {
    this.learn = null;
    this.reset();
  }
  get isLearning(): boolean {
    return this.learn !== null;
  }
  receive(inputId: string, data: ArrayLike<number>, timeStamp: number): void {
    const m = parseMidiMessage(inputId, data, timeStamp);
    if (!m) return;
    this.onMessage?.(m);
    // Suppress ALL hits while learning, including other connected ports.
    if (this.learn) {
      if (m.inputId === this.learn.inputId && m.kind === this.learn.kind)
        this.learn.onLearn(m);
      return;
    }
    const p = this.bindings.get(inputId);
    if (!p) return;
    const emit = (target: MidiTarget, zone: string, velocity = m.value) =>
      this.onHit({
        inputId,
        profileId: p.id,
        latencyMs: p.latencyMs ?? 0,
        zone,
        velocity,
        timeStamp,
        target: { ...target },
      });
    const pedal = p.pedal;
    let previous = this.pedals.get(inputId);
    if (
      previous &&
      pedal &&
      (timeStamp - previous.time > pedal.staleMs || timeStamp < previous.time)
    ) {
      this.reset(inputId);
      previous = undefined;
    }
    if (
      m.kind === "cc" &&
      pedal &&
      m.channel === pedal.channel &&
      m.number === pedal.cc
    ) {
      const v = pedal.invert ? 127 - m.value : m.value;
      let state: PedalState["state"];
      if (
        previous?.state === "closed" &&
        v >= pedal.closedMin - pedal.hysteresis
      )
        state = "closed";
      else if (
        previous?.state === "open" &&
        v <= pedal.openMax + pedal.hysteresis
      )
        state = "open";
      else
        state =
          v >= pedal.closedMin
            ? "closed"
            : v <= pedal.openMax
              ? "open"
              : "half";
      const next: PedalState = {
        state,
        time: timeStamp,
        armed: previous?.armed || state === "open",
        closedAt: previous?.closedAt,
      };
      // A full known open -> closed travel is required; first CC and threshold jitter never hit.
      if (
        state === "closed" &&
        previous?.state !== "closed" &&
        previous?.armed
      ) {
        if (pedal.footClose) emit(pedal.footClose, "foot-close", 127);
        next.closedAt = timeStamp;
        next.armed = false;
      }
      if (
        state === "open" &&
        previous?.state !== "open" &&
        previous?.closedAt !== undefined
      ) {
        if (
          timeStamp - previous.closedAt <= pedal.splashWindowMs &&
          pedal.splash
        )
          emit(pedal.splash, "foot-splash", 127);
        next.closedAt = undefined;
      }
      this.pedals.set(inputId, next);
      return;
    }
    if (m.kind !== "note") return;
    const mapping = p.mappings.find(
      (n) => n.channel === m.channel && n.note === m.number,
    );
    if (!mapping) return;
    // Unknown / stale pedal uses the explicit note's target, not a fabricated open/closed state.
    const h = mapping.hiHat;
    const state = pedal ? previous?.state : undefined;
    const target =
      h && state
        ? state === "closed"
          ? h.closed
          : state === "open"
            ? h.open
            : (h.halfOpen ?? h.closed)
        : mapping.target;
    emit(target, mapping.zone);
  }
}
export interface RecordingTimeline {
  nowMs: number;
  chartSeconds: number;
  playbackRate: number;
  isPlaying: boolean;
  latencyMs: number;
  secondsToBeat: (seconds: number) => number;
  quantizeBeat?: (beat: number) => number;
}
/** timestamp uses performance.now clock. Read chartSeconds from actual transport at nowMs. */
export function recordingBeat(
  timeStamp: number,
  t: RecordingTimeline,
): number | null {
  if (
    !t.isPlaying ||
    ![timeStamp, t.nowMs, t.chartSeconds, t.playbackRate, t.latencyMs].every(
      Number.isFinite,
    ) ||
    t.playbackRate <= 0
  )
    return null;
  const age = t.nowMs - timeStamp;
  if (age < -10 || age > 2000) return null; // reject stale queued events, not arbitrary chart positions
  const seconds =
    t.chartSeconds - ((Math.max(0, age) + t.latencyMs) * t.playbackRate) / 1000;
  if (seconds < 0) return null;
  const beat = t.secondsToBeat(seconds),
    result = t.quantizeBeat ? t.quantizeBeat(beat) : beat;
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export interface MidiInputDevice extends MidiDeviceIdentity {
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
}
export interface MidiInputOptions {
  onHit: (hit: MidiHit) => void;
  onMessage?: (m: MidiMessage) => void;
  onDevices?: (devices: MidiInputDevice[]) => void;
  onError?: (message: string) => void;
}
/** No MIDI permission is requested by construction, saved settings, or reload. */
export class MidiInputController extends MidiInputEngine {
  private access: MIDIAccess | null = null;
  private ports = new Map<string, MIDIInput>();
  private generation = 0;
  private pending: Promise<boolean> | null = null;
  constructor(
    private options: MidiInputOptions,
    private request:
      (() => Promise<MIDIAccess>) | undefined = typeof navigator !==
      "undefined" && navigator.requestMIDIAccess
      ? () => navigator.requestMIDIAccess({ sysex: false })
      : undefined,
  ) {
    super(options.onHit, options.onMessage);
  }
  get supported(): boolean {
    return !!this.request;
  }
  get devices(): MidiInputDevice[] {
    return [...this.ports.values()].map((p) => ({
      portId: p.id,
      name: p.name ?? "",
      manufacturer: p.manufacturer ?? "",
      state: p.state,
      connection: p.connection,
    }));
  }
  /** Call directly from an explicit user Connect action only. */
  connect(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.access) return Promise.resolve(true);
    if (!this.request) {
      this.options.onError?.(
        "このブラウザでは Web MIDI を利用できません。HTTPS 対応ブラウザを使用してください。",
      );
      return Promise.resolve(false);
    }
    const generation = ++this.generation;
    this.pending = this.request()
      .then((access) => {
        if (generation !== this.generation) return false;
        this.access = access;
        access.onstatechange = () => this.refresh();
        this.refresh();
        return true;
      })
      .catch((error) => {
        if (generation === this.generation)
          this.options.onError?.(
            `MIDI に接続できませんでした: ${error instanceof Error ? error.message : String(error)}`,
          );
        return false;
      })
      .finally(() => {
        if (generation === this.generation) this.pending = null;
      });
    return this.pending;
  }
  private refresh(): void {
    const inputs = this.access?.inputs;
    if (!inputs) return;
    for (const [id, port] of this.ports) {
      if (!inputs.has(id) || inputs.get(id)?.state === "disconnected") {
        port.onmidimessage = null;
        this.ports.delete(id);
        this.unbind(id);
      }
    }
    for (const port of inputs.values()) {
      if (port.state !== "connected") continue;
      const old = this.ports.get(port.id);
      if (old && old !== port) {
        old.onmidimessage = null;
        this.unbind(port.id);
      }
      this.ports.set(port.id, port);
      port.onmidimessage = (event) => {
        if (event.data) this.receive(port.id, event.data, event.timeStamp);
      };
    }
    this.options.onDevices?.(this.devices);
  }
  disconnect(): void {
    this.generation++;
    this.pending = null;
    if (this.access) this.access.onstatechange = null;
    for (const [id, p] of this.ports) {
      p.onmidimessage = null;
      void p.close().catch(() => {});
      this.unbind(id);
    }
    this.ports.clear();
    this.access = null;
    this.cancelLearning();
    this.options.onDevices?.([]);
  }
}
