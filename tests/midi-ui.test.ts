import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createMidiUI } from "../src/midi-ui";
import { loadMidiProfiles } from "../src/midi-profiles";
import type { MidiHit } from "../src/midi-input";

function harness() {
  const window = new Window({ url: "https://dtx.example/" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let requests = 0;
  const port = {
    id: "port-a",
    name: "Electronic drums",
    manufacturer: "Test",
    state: "connected",
    connection: "open",
    onmidimessage: null as
      null | ((e: { data: Uint8Array; timeStamp: number }) => void),
    close: async () => {},
  };
  const access = { inputs: new Map([[port.id, port]]), onstatechange: null };
  for (const [key, value] of Object.entries({
    document: window.document,
    localStorage: window.localStorage,
    MutationObserver: window.MutationObserver,
    navigator: {
      requestMIDIAccess: async (options: unknown) => {
        requests++;
        assert.deepEqual(options, { sysex: false });
        return access;
      },
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const hits: { hit: MidiHit; record: boolean }[] = [];
  const arms: boolean[] = [];
  const messages: string[] = [];
  const ui = createMidiUI({
    show: (_title, html) => {
      window.document.body.innerHTML = html;
    },
    close: () => {
      window.document.body.innerHTML = "";
    },
    onHit: (hit, record) => hits.push({ hit, record }),
    onArmed: (value) => arms.push(value),
    toast: (value) => messages.push(value),
  });
  const field = (id: string) => {
    const el = window.document.querySelector(`#${id}`);
    assert.ok(el, `missing ${id}`);
    return el as unknown as HTMLInputElement;
  };
  const change = (id: string, value: string | boolean) => {
    const el = field(id);
    if (typeof value === "boolean") el.checked = value;
    else el.value = value;
    el.dispatchEvent(
      new window.Event("change", { bubbles: true }) as unknown as Event,
    );
  };
  const click = async (action: string) => {
    const el = window.document.querySelector(`[data-act="${action}"]`);
    assert.ok(el, `missing ${action}`);
    (el as unknown as HTMLButtonElement).click();
    await tick();
  };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
  const send = (status: number, note: number, value = 100) =>
    port.onmidimessage?.({
      data: new Uint8Array([status, note, value]),
      timeStamp: performance.now(),
    });
  return {
    ui,
    field,
    change,
    click,
    send,
    tick,
    hits,
    arms,
    messages,
    window,
    requests: () => requests,
    async setup() {
      ui.open();
      await click("connect");
      change("midi-device", port.id);
      await click("new");
    },
    async cleanup() {
      ui.dispose();
      await window.happyDOM.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("MIDI dialog opens without permission request and explicit connect/new profile routes hits and arm", async () => {
  const h = harness();
  try {
    h.ui.open();
    assert.equal(h.requests(), 0);
    h.change("midi-arm", true);
    assert.equal(h.arms.at(-1), false);
    assert.ok(h.messages.length);
    await h.click("connect");
    assert.equal(h.requests(), 1);
    h.change("midi-device", "port-a");
    await h.click("new");
    h.send(0x99, 38);
    assert.equal(h.hits.length, 1);
    assert.equal(h.hits[0].record, false);
    h.change("midi-arm", true);
    h.send(0x99, 38);
    assert.equal(h.hits[1].record, true);
    assert.equal(h.arms.at(-1), true);
    await h.click("close");
    h.send(0x99, 38);
    assert.equal(h.hits.at(-1)?.record, true); // recording deliberately remains usable while editing chart
    h.ui.open();
    assert.equal(h.requests(), 1);
    await h.click("disconnect");
    h.send(0x99, 38);
    assert.equal(h.hits.length, 3);
    assert.equal(h.arms.at(-1), false);
  } finally {
    await h.cleanup();
  }
});

test("profile editor applies channel/mode/latency and mode switch rebinds without cross-channel hits", async () => {
  const h = harness();
  try {
    await h.setup();
    const original = loadMidiProfiles()[0].id;
    await h.click("clone");
    const json = JSON.parse(h.field("midi-json").value);
    json.mappings = [
      {
        id: "new-pad",
        channel: 2,
        note: 38,
        zone: "rim",
        target: { channel: "12", value: "07" },
      },
    ];
    h.field("midi-json").value = JSON.stringify(json);
    h.field("midi-mode").value = "別モード";
    h.field("midi-name").value = "My kit";
    h.field("midi-latency").value = "75";
    await h.click("apply");
    h.send(0x99, 38);
    assert.equal(h.hits.length, 0);
    h.send(0x91, 38);
    assert.equal(h.hits.length, 1);
    assert.equal(h.hits[0].hit.target.value, "07");
    assert.equal(h.hits[0].hit.latencyMs, 75);
    const saved = loadMidiProfiles();
    assert.equal(saved.length, 2);
    assert.equal(saved[1].mode, "別モード");
    assert.equal(saved[1].name, "My kit");
    h.change("midi-arm", true);
    h.change("midi-profile", original);
    assert.equal(h.arms.at(-1), false);
    h.send(0x91, 38);
    assert.equal(h.hits.length, 1);
    h.send(0x99, 38);
    assert.equal(h.hits.length, 2);
    h.field("midi-latency").value = "1001";
    await h.click("apply");
    assert.match(h.messages.at(-1)!, /範囲外/);
    assert.equal(loadMidiProfiles()[0].latencyMs, undefined);
  } finally {
    await h.cleanup();
  }
});

test("learn updates mapping but does not record; removing dialog cancels pending learn", async () => {
  const h = harness();
  try {
    await h.setup();
    h.change("midi-arm", true);
    h.field("midi-zone").value = "HH edge";
    h.field("midi-target").value = "11";
    h.field("midi-wav").value = "09";
    h.field("midi-hh").checked = true;
    await h.click("learn-note");
    assert.equal(h.arms.at(-1), false);
    h.send(0x91, 42, 0);
    assert.equal(h.hits.length, 0);
    h.send(0x91, 42);
    assert.equal(h.hits.length, 0);
    const learned = loadMidiProfiles()[0].mappings.find(
      (m) => m.channel === 2 && m.note === 42,
    );
    assert.equal(learned?.zone, "HH edge");
    assert.equal(learned?.hiHat?.open.channel, "18");
    h.send(0x91, 42);
    assert.equal(h.hits.length, 1);
    assert.equal(h.hits[0].record, false);
    await h.click("learn-note");
    h.window.document.body.innerHTML = "";
    await h.tick();
    h.send(0x91, 42);
    assert.equal(h.hits.length, 2); // observer canceled learning, audition resumes
    h.ui.open();
    await h.click("learn-note");
    await h.click("close");
    h.send(0x91, 42);
    assert.equal(h.hits.length, 3);
  } finally {
    await h.cleanup();
  }
});

test("CC learn and open/closed UI calibration persist correct direction without phantom notes", async () => {
  const h = harness();
  try {
    await h.setup();
    await h.click("learn-cc");
    h.send(0xb0, 7, 127);
    assert.equal(h.hits.length, 0);
    let p = loadMidiProfiles()[0];
    assert.equal(p.pedal?.channel, 1);
    assert.equal(p.pedal?.cc, 7);
    h.send(0xb0, 7, 127);
    await h.click("open");
    h.send(0xb0, 7, 0);
    await h.click("closed");
    p = loadMidiProfiles()[0];
    assert.equal(p.pedal?.invert, true);
    assert.equal(h.hits.length, 0);
    assert.ok(p.pedal!.openMax < p.pedal!.closedMin);
    assert.equal(h.messages.length, 0);
  } finally {
    await h.cleanup();
  }
});
