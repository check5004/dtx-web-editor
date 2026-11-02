import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { KIT_PRESETS, loadKit, KIT_LICENSE_PATH } from "../src/kits";
const root = new URL("../public/", import.meta.url);
const mock = (requests: string[], corrupt = false) =>
  (async (url: URL | RequestInfo, options?: RequestInit) => {
    const value = String(url);
    requests.push(value);
    if (options?.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
    const path = new URL(value).pathname.replace("/dtx-web-editor/", "");
    const bytes = await readFile(new URL(path, root));
    if (corrupt && path.endsWith("BD.wav")) bytes[44] ^= 255;
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
test("bundled banks have exact hashes, valid PCM and distinct four cymbals", async () => {
  assert.equal(KIT_PRESETS.length, 3);
  for (const kit of KIT_PRESETS) {
    assert.equal(kit.sounds.length, 13);
    assert.equal(
      new Set(
        kit.sounds
          .filter((x) => ["LC", "HH", "RC", "RD", "OH", "LP"].includes(x.lane))
          .map((x) => x.sha256),
      ).size,
      6,
    );
    for (const sound of kit.sounds) {
      const b = await readFile(new URL(sound.url, root));
      assert.equal(b.length, sound.bytes);
      assert.equal(createHash("sha256").update(b).digest("hex"), sound.sha256);
      assert.equal(b.toString("ascii", 0, 4), "RIFF");
      assert.equal(b.toString("ascii", 8, 12), "WAVE");
      assert.equal(b.readUInt16LE(20), 1);
      assert.equal(b.readUInt16LE(22), 1);
      assert.equal(b.readUInt32LE(24), 44100);
      assert.equal(b.readUInt16LE(34), 16);
      let peak = 0;
      for (let i = 44; i < b.length; i += 2)
        peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
      assert.ok(
        peak > 500 && peak < 32767,
        `${kit.id}/${sound.lane} peak ${peak}`,
      );
    }
  }
});
test("loads only selected bank and includes redistribution notices in returned files", async () => {
  const seen: string[] = [];
  const kit = await loadKit("standard", {
    baseUrl: "https://example.test/dtx-web-editor/",
    fetcher: mock(seen),
  });
  assert.equal(seen.length, 15);
  assert.ok(
    seen.every((x) => !x.includes("/jazz/") && !x.includes("/electronic/")),
  );
  assert.equal(kit.files.length, 15);
  assert.ok(kit.files.some((x) => x.path === KIT_LICENSE_PATH));
  assert.ok(kit.files.some((x) => x.path.endsWith("SOURCES.json")));
  assert.equal(kit.laneFiles.OH, "kit/fluidr3/standard/OH.wav");
  assert.equal(kit.laneFiles.SN, "kit/fluidr3/standard/SN.wav");
  const license = await kit.files
    .find((x) => x.path === KIT_LICENSE_PATH)!
    .blob.text();
  assert.match(license, /Permission is hereby granted/);
  assert.match(license, /Michael Cowgill/);
});
test("rejects corruption, invalid preset, failed download and cancellation atomically", async () => {
  await assert.rejects(
    loadKit("standard", {
      baseUrl: "https://example.test/dtx-web-editor/",
      fetcher: mock([], true),
    }),
    /整合性/,
  );
  await assert.rejects(loadKit("bad" as never), /不明/);
  await assert.rejects(
    loadKit("jazz", {
      fetcher: (async () => new Response("", { status: 404 })) as typeof fetch,
    }),
    /404/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    loadKit("standard", {
      baseUrl: "https://example.test/dtx-web-editor/",
      signal: abort.signal,
      fetcher: mock([]),
    }),
    { name: "AbortError" },
  );
});
