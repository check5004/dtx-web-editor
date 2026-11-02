import test from "node:test";
import assert from "node:assert/strict";
import { parseDTX, serializeDTX } from "../src/chart";
import {
  CREATOR_LANES,
  creatorLaneForChannel,
  getResourceAppearance,
  setResourceAppearance,
  getCreatorPalette,
  setCreatorPalette,
  getCreatorBindings,
  setCreatorBinding,
  remapCreatorReferences,
} from "../src/creator-settings";
const fixture = () =>
  parseDTX(
    "#WAV01: kick.wav ; Kick\n#WAV02: song.wav ; Song\n#BMP01: cover.png ; Cover\n#AVI01: video.mp4 ; Video\n#BGMWAV: 02\n#DTXC_WAVFORECOLOR: 1 Red\n#DTXC_WAVBACKCOLOR: 2 #123456\n#DTXC_BMPFORECOLOR: 1 Blue\n#DTXC_CHIPPALETTE: 0,01 1,01 2,01 0,02\n#DTXC_LANEBINDEDCHIP: 02 01 02\n#DTXC_LANEBINDEDCHIP: 70 01 00\n#DTXC_LANEBINDEDCHIP: 71 01 00",
  );
test("NX lane indices and alternate channels match source", () => {
  assert.equal(CREATOR_LANES.length, 79);
  assert.equal(CREATOR_LANES[2].back, "18");
  assert.equal(CREATOR_LANES[21].front, "01");
  assert.equal(CREATOR_LANES[53].front, "92");
  assert.equal(CREATOR_LANES[54].name, "GtV");
  assert.equal(CREATOR_LANES[70].bank, "AVI");
  assert.equal(CREATOR_LANES[73].front, "55");
  assert.equal(CREATOR_LANES[78].back, "E0");
});
test("reads original palette, bindings, bank-specific labels, BGM and decimal color IDs", () => {
  const p = fixture();
  assert.equal(getResourceAppearance(p, "WAV", "02").bgm, true);
  assert.equal(getResourceAppearance(p, "WAV", "01").foreground, "Red");
  assert.equal(getResourceAppearance(p, "BMP", "01").label, "Cover");
  assert.deepEqual(
    getCreatorPalette(p).map((e) => e.bank),
    ["WAV", "BMP", "AVI", "WAV"],
  );
  assert.deepEqual(getCreatorBindings(p)[0], {
    lane: 2,
    front: "01",
    back: "02",
  });
});
test("set appearance changes only requested bank and preserves invalid unrelated directives", () => {
  let p = fixture();
  p.passthrough.push("#DTXC_WAVFORECOLOR: invalid nonsense");
  p = setResourceAppearance(p, "WAV", "01", {
    label: "New kick",
    foreground: "#aabbcc",
    background: "",
    bgm: true,
  });
  const a = getResourceAppearance(p, "WAV", "01");
  assert.equal(a.label, "New kick");
  assert.equal(a.foreground, "#aabbcc");
  assert.equal(a.bgm, true);
  assert(p.passthrough.includes("#DTXC_WAVFORECOLOR: invalid nonsense"));
  assert.equal(getResourceAppearance(p, "BMP", "01").foreground, "Blue");
  p = setResourceAppearance(p, "BMP", "01", { label: "Picture" });
  assert.equal(getResourceAppearance(p, "BMP", "01").label, "Picture");
  assert.equal(getResourceAppearance(p, "AVI", "01").label, "Video");
});
test("WAV metadata remap is atomic, bank-specific, and keeps raw comments", () => {
  const p = fixture();
  p.passthrough.push("#BGMWAV: 01 ; note");
  const q = remapCreatorReferences(p, "WAV", { "01": "02", "02": "01" });
  assert(q.passthrough.includes("#BGMWAV: 01"));
  assert(q.passthrough.includes("#BGMWAV: 02 ; note"));
  assert(q.passthrough.includes("#DTXC_WAVFORECOLOR: 2 Red"));
  assert(q.passthrough.includes("#DTXC_WAVBACKCOLOR: 1 #123456"));
  assert(q.passthrough.includes("#DTXC_BMPFORECOLOR: 1 Blue"));
  assert.deepEqual(
    getCreatorPalette(q).map((e) => e.id),
    ["02", "01", "01", "01"],
  );
  assert.deepEqual(getCreatorBindings(q)[0], {
    lane: 2,
    front: "02",
    back: "01",
  });
  assert.deepEqual(getCreatorBindings(q)[1], {
    lane: 70,
    front: "01",
    back: "00",
  });
  assert.equal(p.passthrough[0], "#BMP01: cover.png ; Cover");
});
test("media bank remap touches matching palette and binding only", () => {
  const p = remapCreatorReferences(fixture(), "BMP", { "01": "0A" });
  assert.deepEqual(
    getCreatorBindings(p).map((b) => b.front),
    ["01", "01", "0A"],
  );
  assert.equal(getCreatorPalette(p)[1].id, "0A");
  assert(p.passthrough.includes("#DTXC_BMPFORECOLOR: 10 Blue"));
});
test("palette replacement preserves unknown tokens and comments, deduplicates", () => {
  const p = fixture();
  p.passthrough.push("#DTXC_CHIPPALETTE: 0,01 broken 4,ZZ ; user comment");
  const q = setCreatorPalette(p, [
    { bank: "WAV", id: "02" },
    { bank: "WAV", id: "02" },
  ]);
  assert.deepEqual(getCreatorPalette(q), [{ bank: "WAV", id: "02" }]);
  assert(q.passthrough.some((x) => x.includes("broken 4,ZZ ; user comment")));
});
test("invalid bindings are preserved; valid setting can be reset", () => {
  let p = fixture();
  p.passthrough.push("#DTXC_LANEBINDEDCHIP: 99 GG XX");
  p = setCreatorBinding(p, { lane: 2, front: "0A", back: "0B" });
  assert.deepEqual(getCreatorBindings(p)[2], {
    lane: 2,
    front: "0A",
    back: "0B",
  });
  p = setCreatorBinding(p, { lane: 2, front: "00", back: "00" });
  assert(!getCreatorBindings(p).some((x) => x.lane === 2));
  assert(p.passthrough.includes("#DTXC_LANEBINDEDCHIP: 99 GG XX"));
});
test("malformed palette tokens do not get partially remapped", () => {
  const p = fixture();
  p.passthrough.push("#DTXC_CHIPPALETTE: 0,01,bad 3,01 0,00");
  const q = remapCreatorReferences(p, "WAV", { "01": "02" });
  assert(q.passthrough.includes("#DTXC_CHIPPALETTE: 0,01,bad 3,01 0,00"));
});
test("rejects collisions, malformed IDs, unsafe color strings and multiline labels", () => {
  const p = fixture();
  assert.throws(() =>
    remapCreatorReferences(p, "WAV", { "01": "03", "02": "03" }),
  );
  assert.throws(() => remapCreatorReferences(p, "WAV", { "01": "00" }));
  assert.throws(() =>
    setResourceAppearance(p, "WAV", "01", {
      foreground: "red;position:absolute",
    }),
  );
  assert.throws(() => setResourceAppearance(p, "WAV", "01", { label: "a\nb" }));
  assert.throws(() =>
    setCreatorBinding(p, { lane: 99, front: "01", back: "00" }),
  );
});
test("metadata survives serialize/reparse including source palette syntax", () => {
  const p = setResourceAppearance(fixture(), "WAV", "01", {
    bgm: true,
    foreground: "#123ABC",
  });
  const q = parseDTX(serializeDTX(p));
  assert.equal(getResourceAppearance(q, "WAV", "01").foreground, "#123ABC");
  assert(getResourceAppearance(q, "WAV", "01").bgm);
  assert.deepEqual(getCreatorPalette(q), getCreatorPalette(p));
});

test("malformed color directives remain byte-stable on edit and remap", () => {
  const p = fixture();
  const bad = [
    "#DTXC_WAVFORECOLOR: 1 url(x)",
    "#DTXC_WAVFORECOLOR: 1 Red extra",
    "#DTXC_WAVBACKCOLOR: 0 Blue",
  ];
  p.passthrough.push(...bad);
  const q = remapCreatorReferences(
    setResourceAppearance(p, "WAV", "01", { foreground: "Green" }),
    "WAV",
    { "01": "02", "02": "01" },
  );
  for (const line of bad) assert(q.passthrough.includes(line));
});

test("all guitar/bass note patterns resolve voice bindings, not fret lanes", () => {
  for (const channel of ["20", "24", "A9", "AF"])
    assert.equal(creatorLaneForChannel(channel)?.index, 54);
  for (const channel of ["A0", "A4", "DD"])
    assert.equal(creatorLaneForChannel(channel)?.index, 62);
  assert.equal(creatorLaneForChannel("11")?.index, 2);
  assert.notEqual(creatorLaneForChannel("28")?.index, 54);
});
