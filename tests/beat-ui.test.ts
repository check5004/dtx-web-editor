import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openBeatDialog, type BeatDialogHost } from "../src/beat-ui.ts";
function setup() {
  const window = new Window();
  const oldDocument = globalThis.document,
    oldObserver = globalThis.MutationObserver;
  Object.assign(globalThis, {
    document: window.document,
    MutationObserver: window.MutationObserver,
  });
  let revision = 1,
    applied: Parameters<BeatDialogHost["apply"]>[0] | undefined,
    closed = 0;
  const errors: unknown[] = [],
    seeks: number[] = [];
  const host: BeatDialogHost = {
    show: (_title, html) => {
      window.document.body.innerHTML = html;
    },
    close: () => {
      closed++;
      window.document.body.replaceChildren();
    },
    getSource: () => ({ blob: new Blob(), name: "local.wav", offset: 0.25 }),
    getRevision: () => revision,
    apply: (p) => {
      applied = p;
    },
    seekSource: (s) => seeks.push(s),
    error: (e) => errors.push(e),
  };
  const get = (id: string) => window.document.getElementById(id)!;
  const click = (id: string) =>
    (get(id) as unknown as HTMLButtonElement).click();
  const edit = (row: number, column: number, value: number) => {
    const input = window.document
      .querySelectorAll("#beat-anchors tr")
      [row].querySelectorAll("input")[column];
    input.value = String(value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const confirm = () => {
    (get("beat-confirm") as unknown as HTMLInputElement).checked = true;
  };
  return {
    window,
    host,
    get,
    click,
    edit,
    confirm,
    errors,
    seeks,
    get applied() {
      return applied;
    },
    get closed() {
      return closed;
    },
    changeRevision: () => revision++,
    async cleanup() {
      window.document.body.replaceChildren();
      await new Promise((r) => setTimeout(r, 0));
      Object.assign(globalThis, {
        document: oldDocument,
        MutationObserver: oldObserver,
      });
      await window.happyDOM.close();
    },
  };
}
test("dialog opening/analysis proposals do not apply; confirmation is required", async () => {
  const s = setup();
  try {
    openBeatDialog(s.host);
    assert.equal(s.applied, undefined);
    s.click("beat-apply");
    assert.equal(s.applied, undefined);
    assert.match(String(s.errors[0]), /確認/);
    assert.equal(s.closed, 0);
  } finally {
    await s.cleanup();
  }
});
test("confirmed edited anchors apply120→180 with +.25 source offset and close", async () => {
  const s = setup();
  try {
    openBeatDialog(s.host);
    s.click("beat-add");
    s.edit(0, 1, 0.25);
    s.edit(1, 0, 4);
    s.edit(1, 1, 2.25);
    s.edit(2, 0, 8);
    s.edit(2, 1, 2.25 + 4 / 3);
    assert.match(s.get("beat-plan").textContent!, /120.000 BPM.*180.000 BPM/);
    s.confirm();
    s.click("beat-apply");
    assert.equal(s.applied!.sourceOffsetSeconds, 0.25);
    assert.equal(s.applied!.tempos[0].bpm, 120);
    assert.ok(Math.abs(s.applied!.tempos[1].bpm - 180) < 1e-9);
    assert.equal(s.closed, 1);
    assert.equal(s.errors.length, 0);
  } finally {
    await s.cleanup();
  }
});
test("editing invalidates confirmation and stale revision blocks apply", async () => {
  const s = setup();
  try {
    openBeatDialog(s.host);
    s.confirm();
    s.edit(1, 1, 2.5);
    assert.equal(
      (s.get("beat-confirm") as unknown as HTMLInputElement).checked,
      false,
    );
    s.confirm();
    s.changeRevision();
    s.click("beat-apply");
    assert.equal(s.applied, undefined);
    assert.match(String(s.errors[0]), /変更/);
    assert.equal(s.closed, 0);
  } finally {
    await s.cleanup();
  }
});
test("invalid anchor ordering never applies and audition uses source seconds", async () => {
  const s = setup();
  try {
    openBeatDialog(s.host);
    (
      s.window.document.querySelector(
        "#beat-anchors button",
      ) as unknown as HTMLButtonElement
    ).click();
    assert.deepEqual(s.seeks, [0.25]);
    s.edit(1, 1, 0.1);
    s.confirm();
    s.click("beat-apply");
    assert.equal(s.applied, undefined);
    assert.match(String(s.errors[0]), /昇順/);
  } finally {
    await s.cleanup();
  }
});
test("no local source requests error without opening dialog", async () => {
  const s = setup();
  try {
    s.host.getSource = () => null;
    openBeatDialog(s.host);
    assert.equal(s.window.document.getElementById("beat-review"), null);
    assert.match(String(s.errors[0]), /ローカル音声/);
  } finally {
    await s.cleanup();
  }
});
test("closing during decode discards results and closes AudioContext", async () => {
  const s = setup(),
    old = globalThis.AudioContext;
  let closeCount = 0,
    resolveDecode:
      | ((buffer: {
          getChannelData: () => Float32Array;
          sampleRate: number;
        }) => void)
      | undefined;
  class FakeAudioContext {
    decodeAudioData() {
      return new Promise<{
        getChannelData: () => Float32Array;
        sampleRate: number;
      }>((r) => {
        resolveDecode = r;
      });
    }
    close() {
      closeCount++;
      return Promise.resolve();
    }
  }
  Object.assign(globalThis, { AudioContext: FakeAudioContext });
  try {
    openBeatDialog(s.host);
    s.click("beat-run");
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(resolveDecode);
    s.host.close();
    await new Promise((r) => setTimeout(r, 0));
    resolveDecode!({
      getChannelData: () => new Float32Array(4000),
      sampleRate: 4000,
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(s.applied, undefined);
    assert.ok(closeCount >= 1);
    assert.equal(s.window.document.getElementById("beat-review"), null);
  } finally {
    Object.assign(globalThis, { AudioContext: old });
    await s.cleanup();
  }
});
