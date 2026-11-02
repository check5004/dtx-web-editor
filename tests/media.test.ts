import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, serializeDTX } from "../src/chart.ts";
import {
  getMediaResources,
  setMediaResource,
  deleteMediaResource,
  reorderMediaResources,
  isBankChannel,
  resolveMediaFile,
} from "../src/media.ts";
import type { ImportedFile } from "../src/storage.ts";
const fixture = () =>
  parseDTX(
    "#TITLE: Media\n#BPM: 120\n#WAV01: kick.wav\n#WAV02: snare.wav\n#BMP01: back.png\n#BMP02: front.png\n#BMPTEX03: texture.png\n#AVI01: movie.webm\n#AVI02: other.mp4\n#00011: 0102\n#00004: 0102\n#000C4: 01\n#00054: 0102\n",
  );
test("media banks parse exact directive names without BMP matching BMPTEX", () => {
  const p = fixture();
  assert.deepEqual(
    getMediaResources(p, "BMP").map((r) => r.file),
    ["back.png", "front.png"],
  );
  assert.deepEqual(
    getMediaResources(p, "BMPTEX").map((r) => r.id),
    ["03"],
  );
  assert.equal(getMediaResources(p, "AVI").length, 2);
  assert.equal(getMediaResources(p, "WAV").length, 2);
});
test("media update is immutable, safely parsed and round-trippable", () => {
  const p = fixture(),
    changed = setMediaResource(p, "BMP", {
      id: "01",
      file: "new/background.png",
    });
  assert.equal(getMediaResources(p, "BMP")[0].file, "back.png");
  assert.equal(
    getMediaResources(parseDTX(serializeDTX(changed)), "BMP")[0].file,
    "new/background.png",
  );
  for (const path of [
    "../secret",
    "https://example.com/x",
    "a;#TITLE: injected",
    "bad\nname",
  ])
    assert.throws(() => setMediaResource(p, "BMP", { id: "01", file: path }));
  assert.throws(() => setMediaResource(p, "AVI", { id: "00", file: "a.mp4" }));
});
test("BMP reorder changes only image and scope-swap references, preserving WAV and AVI", () => {
  const p = fixture(),
    out = reorderMediaResources(p, "BMP", ["02", "01"]);
  assert.equal(getMediaResources(out, "BMP")[0].file, "front.png");
  for (const note of p.notes) {
    const after = out.notes.find((n) => n.id === note.id)!;
    assert.equal(
      after.value,
      ["04", "C4"].includes(note.channel)
        ? note.value === "01"
          ? "02"
          : "01"
        : note.value,
    );
  }
  assert.equal(getMediaResources(out, "BMPTEX")[0].id, "03");
});
test("WAV and AVI reorder each preserve other bank references", () => {
  for (const bank of ["WAV", "AVI"] as const) {
    const p = fixture(),
      out = reorderMediaResources(p, bank, ["02", "01"]);
    for (const note of p.notes)
      assert.equal(
        out.notes.find((n) => n.id === note.id)!.value,
        isBankChannel(bank, note.channel)
          ? note.value === "01"
            ? "02"
            : "01"
          : note.value,
      );
  }
});
test("delete requires explicit note removal and never removes same-ID other-domain notes", () => {
  const p = fixture();
  assert.throws(() => deleteMediaResource(p, "AVI", "01"));
  const out = deleteMediaResource(p, "AVI", "01", true);
  assert.equal(getMediaResources(out, "AVI").length, 1);
  assert.equal(
    out.notes.filter((n) => n.channel === "54" && n.value === "01").length,
    0,
  );
  assert.ok(out.notes.some((n) => n.channel === "11" && n.value === "01"));
  assert.ok(out.notes.some((n) => n.channel === "04" && n.value === "01"));
});
test("unsafe transforms, precedence overlap, malformed orders and protected charts block mutation", () => {
  const p = fixture();
  p.passthrough.push("#BGA01: 01 0 0 10 10 0 0");
  assert.throws(() => reorderMediaResources(p, "BMP", ["02", "01"]));
  assert.throws(() => deleteMediaResource(p, "BMP", "01", true));
  const overlap = fixture();
  overlap.passthrough.push("#BMPTEX01: texture.png");
  assert.throws(() => reorderMediaResources(overlap, "BMP", ["02", "01"]));
  assert.throws(() => reorderMediaResources(fixture(), "WAV", ["01", "01"]));
  const protectedP = fixture();
  protectedP.readOnlyReason = "protected";
  assert.throws(() =>
    setMediaResource(protectedP, "AVI", { id: "03", file: "a.mp4" }),
  );
});
test("local resource lookup respects source chart folder and never chooses duplicate basenames", () => {
  const f = (path: string): ImportedFile => ({
    path,
    name: "kick.wav",
    blob: new Blob(),
    hash: path,
    size: 0,
    type: "audio/wav",
  });
  const files = [f("songA/kick.wav"), f("songB/kick.wav")];
  assert.equal(resolveMediaFile(files, "kick.wav"), undefined);
  assert.equal(
    resolveMediaFile(files, "kick.wav", "songB/chart.dtx")?.path,
    "songB/kick.wav",
  );
  assert.equal(
    resolveMediaFile(files, "../songA/kick.wav", "songB/chart.dtx"),
    undefined,
  );
  assert.equal(resolveMediaFile(files, "https://example.com/x"), undefined);
});

import {
  CREATOR_LANES,
  getCreatorBindings,
  getCreatorPalette,
  getResourceAppearance,
} from "../src/creator-settings.ts";
test("media path changes preserve exact inline labels and unrelated definitions immutably", () => {
  for (const bank of ["BMP", "BMPTEX", "AVI"] as const) {
    const p = parseDTX(
        `#${bank}01: old.file\t;日本語ラベル;追記\n#CUSTOM: untouched\n`,
      ),
      out = setMediaResource(p, bank, { id: "01", file: "新規/changed.file" });
    assert.equal(
      getResourceAppearance(out, bank, "01").label,
      "日本語ラベル;追記",
    );
    assert.equal(getMediaResources(out, bank)[0].file, "新規/changed.file");
    assert.ok(
      out.passthrough.includes(
        `#${bank}01: 新規/changed.file\t;日本語ラベル;追記`,
      ),
    );
    assert.ok(out.passthrough.includes("#CUSTOM: untouched"));
    assert.equal(getMediaResources(p, bank)[0].file, "old.file");
    const again = parseDTX(serializeDTX(out));
    assert.equal(
      getResourceAppearance(again, bank, "01").label,
      "日本語ラベル;追記",
    );
  }
});
test("bank reorder atomically moves Creator color, palette, lane bindings and BGM metadata with resource identity", () => {
  for (const bank of ["WAV", "BMP", "BMPTEX", "AVI"] as const) {
    const colorBank = bank === "BMPTEX" ? "BMP" : bank,
      code = bank === "WAV" ? "0" : bank === "AVI" ? "2" : "1";
    const lane = CREATOR_LANES.find(
      (l) => l.bank === (bank === "BMPTEX" ? "BMP" : bank),
    )!.index;
    const laneText = String(lane).padStart(2, "0");
    const raw = `#${bank}01: first.file\t;First label\n#${bank}02: second.file\t;Second label\n#DTXC_${colorBank}FORECOLOR: 1 Red\n#DTXC_${colorBank}BACKCOLOR: 2 Blue\n#DTXC_CHIPPALETTE: ${code},01 ${code},02 malformed-token ;palette comment\n#DTXC_LANEBINDEDCHIP: ${laneText} 01 02 ;binding comment\n#BGMWAV: 01\n#CUSTOM: preserve\n`;
    const p = parseDTX(raw),
      before = structuredClone(p),
      out = reorderMediaResources(p, bank, ["02", "01"]);
    assert.equal(
      getMediaResources(out, bank).find((r) => r.id === "02")!.file,
      "first.file",
    );
    assert.equal(getResourceAppearance(out, bank, "02").foreground, "Red");
    assert.equal(getResourceAppearance(out, bank, "01").background, "Blue");
    assert.equal(getResourceAppearance(out, bank, "02").label, "First label");
    assert.deepEqual(
      getCreatorPalette(out).map((x) => x.id),
      ["02", "01"],
    );
    assert.deepEqual(
      getCreatorBindings(out).find((x) => x.lane === lane),
      { lane, front: "02", back: "01" },
    );
    assert.ok(
      out.passthrough.some((x) =>
        x.includes("malformed-token ;palette comment"),
      ),
    );
    assert.ok(
      out.passthrough.includes(
        `#DTXC_LANEBINDEDCHIP: ${laneText} 02 01 ;binding comment`,
      ),
    );
    assert.ok(
      out.passthrough.includes(bank === "WAV" ? "#BGMWAV: 02" : "#BGMWAV: 01"),
    );
    assert.ok(out.passthrough.includes("#CUSTOM: preserve"));
    assert.deepEqual(p, before);
    const restored = reorderMediaResources(out, bank, ["02", "01"]);
    assert.deepEqual(
      getMediaResources(restored, bank),
      getMediaResources(p, bank),
    );
  }
});
test("WAV metadata reorder does not change same-ID BMP/AVI metadata", () => {
  const p = parseDTX(
    "#WAV01: a.wav\n#WAV02: b.wav\n#DTXC_WAVFORECOLOR: 1 Red\n#DTXC_BMPFORECOLOR: 1 Blue\n#DTXC_AVIFORECOLOR: 1 Green\n#DTXC_CHIPPALETTE: 0,01 1,01 2,01",
  );
  const out = reorderMediaResources(p, "WAV", ["02", "01"]);
  assert.ok(out.passthrough.includes("#DTXC_BMPFORECOLOR: 1 Blue"));
  assert.ok(out.passthrough.includes("#DTXC_AVIFORECOLOR: 1 Green"));
  assert.deepEqual(getCreatorPalette(out), [
    { bank: "WAV", id: "02" },
    { bank: "BMP", id: "01" },
    { bank: "AVI", id: "01" },
  ]);
});
test("WAV bank operations include empty-hit sample references but exclude image IDs", () => {
  const p = parseDTX(
    "#WAV01: a.wav\n#WAV02: b.wav\n#000B1: 01\n#000BE: 01\n#00004: 01",
  );
  const swapped = reorderMediaResources(p, "WAV", ["02", "01"]);
  assert.equal(swapped.notes.find((n) => n.channel === "B1")!.value, "02");
  assert.equal(swapped.notes.find((n) => n.channel === "BE")!.value, "02");
  assert.equal(swapped.notes.find((n) => n.channel === "04")!.value, "01");
  assert.throws(() => deleteMediaResource(p, "WAV", "01"), /in use/);
  const removed = deleteMediaResource(p, "WAV", "01", true);
  assert.deepEqual(
    removed.notes.map((n) => n.channel),
    ["04"],
  );
});

import {
  parseMediaTransform,
  getMediaTransforms,
  setMediaTransform,
  deleteMediaTransform,
  mediaTransformDuration,
  interpolateMediaFrame,
  activeMediaLayers,
  clipMediaFrame,
} from "../src/media.ts";
test("BGA parser normalizes reversed corners; transform editing round-trips native declarations", () => {
  const t = parseMediaTransform("#BGA0A: 01 100 80 20 10 -5 7")!;
  assert.deepEqual(t.start, {
    sourceX: 20,
    sourceY: 10,
    width: 80,
    height: 70,
    destX: -5,
    destY: 7,
  });
  assert.deepEqual(t.end, t.start);
  const p = setMediaTransform(fixture(), t),
    out = parseDTX(serializeDTX(p));
  assert.deepEqual(getMediaTransforms(out), [t]);
  assert.equal(
    getMediaTransforms(deleteMediaTransform(p, "BGA", "0A")).length,
    0,
  );
  assert.throws(() => parseMediaTransform("#BGAPAN01: 01 1 2"));
  assert.throws(() => parseMediaTransform("#BGA01: 01 Infinity 0 20 20 0 0"));
  assert.throws(() =>
    setMediaTransform(p, { ...t, start: { ...t.start, width: -1 } }),
  );
});
test("BGAPAN interpolation uses NX count duration, cue tempo/meter and integer truncation", () => {
  const t = parseMediaTransform(
    "#BGAPAN0A: 01 100 80 200 160 0 0 11 21 10 20 31 41 384",
  )!;
  const p = fixture();
  p.barLengths = { 0: 0.5 };
  p.tempos = [{ id: "tempo", beat: 1, bpm: 60, channel: "08", value: "01" }];
  assert.equal(mediaTransformDuration(p, 0, t), 1);
  assert.equal(mediaTransformDuration(p, 1, t), 2);
  assert.deepEqual(interpolateMediaFrame(t, 0.5), {
    sourceX: 5,
    sourceY: 10,
    width: 150,
    height: 120,
    destX: 20,
    destY: 30,
  });
  assert.deepEqual(interpolateMediaFrame(t, 5), t.end);
  assert.deepEqual(interpolateMediaFrame(t, -1), t.start);
  const zero = parseMediaTransform(
    "#BGAPAN0B: 01 100 80 200 160 0 0 11 21 10 20 31 41 -10",
  )!;
  assert.equal(zero.durationTicks, 0);
});
test("scope swap replaces only direct image and preserves original scope, motion clock and backwards seek", () => {
  const p = parseDTX(
    "#BPM: 120\n#BMP01: a.png\n#BMPTEX02: b.png\n#BGAPAN0A: 01 100 80 200 160 0 0 10 20 0 0 30 40 384\n#00004: 0A00\n#000C4: 0002\n#000C7: 02\n",
  );
  const before = activeMediaLayers(p, 0.5),
    after = activeMediaLayers(p, 1.5),
    back = activeMediaLayers(p, 0.5);
  assert.equal(before.length, 1);
  assert.equal(before[0].resourceId, "01");
  assert.equal(after[0].resourceId, "02");
  assert.equal(after[0].originalResourceId, "01");
  assert.equal(after[0].startTime, 0);
  assert.deepEqual(after[0].transform, before[0].transform);
  assert.deepEqual(back, before);
});
test("media alias precedence is BGAPAN then BGA then direct, with missing alias-resource fallback", () => {
  const p = parseDTX(
    "#BPM: 120\n#BMP01: direct.png\n#BMP02: crop.png\n#BGA01: 02 0 0 50 50 0 0\n#BGAPAN01: 03 50 50 100 100 0 0 0 0 0 0 0 0 384\n#00004: 01\n",
  );
  assert.equal(activeMediaLayers(p, 0)[0].resourceId, "02");
  assert.equal(activeMediaLayers(p, 0)[0].transform?.kind, "BGA");
});
test("AVIPAN parses all fourteen args and exposes intended video crop and motion", () => {
  const t = parseMediaTransform(
    "#AVIPAN01: 02 100 80 200 160 1 2 11 12 3 4 13 14 192",
  )!;
  assert.equal(t.kind, "AVIPAN");
  assert.equal(t.resourceId, "02");
  assert.deepEqual(interpolateMediaFrame(t, 0.5), {
    sourceX: 6,
    sourceY: 7,
    width: 150,
    height: 120,
    destX: 8,
    destY: 9,
  });
});
test("media clipping keeps source and destination regions aligned with NX 278x355 viewport", () => {
  assert.deepEqual(
    clipMediaFrame(
      { sourceX: -10, sourceY: -5, width: 100, height: 80, destX: 0, destY: 0 },
      200,
      200,
    ),
    { sourceX: 0, sourceY: 0, width: 90, height: 75, destX: 10, destY: 5 },
  );
  assert.deepEqual(
    clipMediaFrame(
      {
        sourceX: 0,
        sourceY: 0,
        width: 100,
        height: 80,
        destX: 250,
        destY: 330,
      },
      200,
      200,
    ),
    { sourceX: 0, sourceY: 0, width: 28, height: 25, destX: 250, destY: 330 },
  );
  assert.equal(
    clipMediaFrame(
      { sourceX: 500, sourceY: 0, width: 100, height: 80, destX: 0, destY: 0 },
      200,
      200,
    ),
    undefined,
  );
});
import { applyBmpBlackKey } from "../src/media.ts";
test("BMP exact black key is transparent while nonblack colors and alpha remain intact", () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255, 0, 0, 1, 255, 255, 0, 0, 128,
  ]);
  applyBmpBlackKey(pixels);
  assert.deepEqual([...pixels], [0, 0, 0, 0, 0, 0, 1, 255, 255, 0, 0, 128]);
});
