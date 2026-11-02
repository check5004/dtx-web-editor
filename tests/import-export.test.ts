import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseDTX, serializeDTX } from "../src/chart";
import {
  validateProjectManifest,
  safeUnzip,
  createSafeArchiveFilter,
  resolveChartAsset,
  deduplicateAssetLibrary,
} from "../src/import-export";
import type { ImportedFile } from "../src/storage";
const manifest = () => ({
  version: 1,
  project: parseDTX("#TITLE: Test\n#BPM: 120\n#WAV01: kick.wav\n#00011: 01\n"),
  referencePath: "",
});
test("manifest validation returns independent safe data and drops credentials/settings", () => {
  const input = {
    ...manifest(),
    apiKey: "secret",
    settings: { key: "secret" },
  };
  const output = validateProjectManifest(input);
  assert.equal(output.project.metadata.title, "Test");
  assert.equal("apiKey" in output, false);
  assert.equal("settings" in output, false);
  output.project.metadata.title = "changed";
  assert.equal(input.project.metadata.title, "Test");
});
test("manifest refuses finite-bound, shape and string-to-header numeric injection attempts", () => {
  const attacks: Array<(m: ReturnType<typeof manifest>) => void> = [
    (m) => {
      m.project.resources["01"].volume =
        "100\n#TITLE: injected" as unknown as number;
    },
    (m) => {
      m.project.resources["01"].pan = NaN;
    },
    (m) => {
      m.project.resources["01"].size = Infinity;
    },
    (m) => {
      m.project.metadata.bpm = 0;
    },
    (m) => {
      m.project.metadata.title = {} as unknown as string;
    },
    (m) => {
      m.project.barCount = 360000;
    },
    (m) => {
      m.project.barLengths[0] = 100000;
    },
    (m) => {
      m.project.notes[0].beat = 1e99;
    },
    (m) => {
      m.project.notes[0].channel = "G1";
    },
    (m) => {
      m.project.notes[0].value = "00";
    },
    (m) => {
      m.project.resources["01"].file = "../key";
    },
    (m) => {
      m.project.resources["01"].file = "https://example.com/audio.wav";
    },
    (m) => {
      m.project.notes.push({ ...m.project.notes[0] });
    },
    (m) => {
      m.project.notes = Array(50001).fill(m.project.notes[0]);
    },
  ];
  for (const attack of attacks) {
    const input = manifest();
    attack(input);
    assert.throws(() => validateProjectManifest(input));
  }
});
test("prototype pollution record keys are rejected", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const m = manifest();
    m.project.resources = JSON.parse(`{"${key}": {"id":"01","file":"x.wav"}}`);
    assert.throws(() => validateProjectManifest(m));
  }
});
test("read-only raw DTX reconstructed by parser, preserving bytes and ignoring forged manifest edits", () => {
  const raw =
    "#RANDOM 2\n#IF 1\n#TITLE: Protected\n#BPM: 120\n#WAV01: kick.wav\n#00011: 01\n#ENDIF\n";
  const p = parseDTX(raw);
  p.metadata.title = "forged";
  p.originalFingerprint = "forged";
  p.readOnlyReason = "fake";
  const validated = validateProjectManifest({ version: 1, project: p });
  assert.equal(validated.project.metadata.title, "Protected");
  assert.notEqual(validated.project.readOnlyReason, "fake");
  assert.equal(serializeDTX(validated.project), raw);
  const bad = manifest();
  bad.project.readOnlyReason = "fake";
  assert.throws(() => validateProjectManifest(bad));
});
test("archive safety checks count and uncompressed size before accepting payload entries", () => {
  const filter = createSafeArchiveFilter({
    maxFileBytes: 10,
    maxOriginalBytes: 15,
    maxEntries: 3,
  });
  assert.equal(
    filter({ name: "a.wav", size: 1, originalSize: 8, compression: 8 }),
    true,
  );
  assert.throws(() =>
    filter({ name: "b.wav", size: 1, originalSize: 8, compression: 8 }),
  );
  assert.throws(() =>
    createSafeArchiveFilter({ maxFileBytes: 10 })({
      name: "bomb.wav",
      size: 1,
      originalSize: 99999999,
      compression: 8,
    }),
  );
  assert.throws(() =>
    createSafeArchiveFilter()({
      name: "../secret",
      size: 0,
      originalSize: 0,
      compression: 0,
    }),
  );
});
test("safe unzip detects duplicate case-normalized names, traversal, compressed and expanded bounds", () => {
  const good = zipSync({
    "song/chart.dtx": strToU8("#TITLE: Song"),
    "song/sound.wav": new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(Object.keys(safeUnzip(good)), [
    "song/chart.dtx",
    "song/sound.wav",
  ]);
  assert.throws(() => safeUnzip(good, { maxCompressedBytes: 1 }));
  assert.throws(() => safeUnzip(good, { maxOriginalBytes: 1 }));
  assert.throws(() =>
    safeUnzip(
      zipSync({ "a.wav": new Uint8Array([1]), "A.WAV": new Uint8Array([2]) }),
    ),
  );
  assert.throws(() => safeUnzip(zipSync({ "../unsafe": new Uint8Array([1]) })));
});
const file = (path: string, content: string): ImportedFile => ({
  path,
  name: path.split("/").at(-1)!,
  blob: new Blob([content]),
  hash: "forged",
  size: content.length,
  type: "audio/wav",
});
test("asset resolution never substitutes another song or ambiguous case collision", () => {
  const files = [file("a/kick.wav", "A"), file("b/kick.wav", "B")];
  assert.equal(resolveChartAsset(files, "kick.wav"), undefined);
  assert.equal(
    resolveChartAsset(files, "kick.wav", "b/chart.dtx")?.path,
    "b/kick.wav",
  );
  assert.equal(
    resolveChartAsset(
      [...files, file("B/KICK.WAV", "C")],
      "kick.wav",
      "b/chart.dtx",
    ),
    undefined,
  );
});
test("actual hash dedup shares bytes while retaining reference paths and rejects conflicts", async () => {
  const result = await deduplicateAssetLibrary([
    file("a/kick.wav", "same"),
    file("b/drum.wav", "same"),
    file("c.wav", "different"),
  ]);
  assert.equal(result.assets.length, 2);
  assert.equal(result.files.length, 3);
  assert.deepEqual(result.assets[0].paths, ["a/kick.wav", "b/drum.wav"]);
  assert.equal(result.files[0].blob, result.files[1].blob);
  assert.notEqual(result.files[0].hash, "forged");
  await assert.rejects(() =>
    deduplicateAssetLibrary([file("x.wav", "A"), file("X.WAV", "B")]),
  );
});
test("safe label, source format and reference settings survive while malformed IDs/offsets fail", () => {
  const m = manifest();
  m.project.resources["01"].label = "Kick";
  m.project.metadata.sourceFormat = "dtx";
  const out = validateProjectManifest({
    ...m,
    youtubeId: "abcdefghijk",
    referenceOffset: -2.5,
  });
  assert.equal(out.project.resources["01"].label, "Kick");
  assert.equal(out.project.metadata.sourceFormat, "dtx");
  assert.equal(out.youtubeId, "abcdefghijk");
  assert.equal(out.referenceOffset, -2.5);
  assert.throws(() =>
    validateProjectManifest({ ...m, youtubeId: "javascript:" }),
  );
  assert.throws(() =>
    validateProjectManifest({ ...m, referenceOffset: Infinity }),
  );
});
test("protected legacy chart reconstruction does not permit raw legacy to be emitted as DTX", async () => {
  const { parseLegacyChart } = await import("../src/legacy");
  const raw = "#TITLE: Legacy\n#BPM: 120\n#000ZZ: 01\n";
  const project = parseLegacyChart(raw, "gda");
  const out = validateProjectManifest({ version: 1, project });
  assert.equal(out.project.metadata.sourceFormat, "gda");
  assert.equal(out.project.originalText, raw);
  assert.ok(out.project.readOnlyReason);
  assert.equal(out.project.originalFingerprint, undefined);
  assert.throws(() => serializeDTX(out.project));
});
test("reference BGM suppression ID is optional, safely validated and survives protected reconstruction", () => {
  assert.equal(validateProjectManifest(manifest()).referenceBgmId, "");
  assert.equal(
    validateProjectManifest({ ...manifest(), referenceBgmId: "ZZ" })
      .referenceBgmId,
    "ZZ",
  );
  for (const referenceBgmId of ["00", "a1", "001", "01\n#TITLE: bad", 3, null])
    assert.throws(() =>
      validateProjectManifest({ ...manifest(), referenceBgmId }),
    );
  const project = parseDTX("#RANDOM 2\n#TITLE: protected\n#BPM: 120\n");
  assert.equal(
    validateProjectManifest({ version: 1, project, referenceBgmId: "01" })
      .referenceBgmId,
    "01",
  );
});
test("nested editable imports rebase sibling assets to pack root without losing labels or transform data", async () => {
  const { rebaseImportedChart } = await import("../src/import-export");
  const source = parseDTX(
    "#TITLE: nested\n#BPM: 120\n#WAV01: ../sounds/kick.wav\n#BMP01: ../images/back.png\n#BMPTEX02: local.png\n#AVI01: ../movies/movie.webm\n#PREIMAGE: ../images/jacket.png\n#BGA01: 01 0 0 64 64 0 0\n#PREVIEW: ../sounds/preview.ogg\n#BACKGROUND: ../images/bg.png\n",
  );
  source.resources["01"].label = "Kick";
  const out = rebaseImportedChart(source, "charts/easy.dtx");
  assert.equal(out.resources["01"].file, "sounds/kick.wav");
  assert.equal(out.resources["01"].label, "Kick");
  assert.equal(out.metadata.preview, "sounds/preview.ogg");
  assert.equal(out.metadata.background, "images/bg.png");
  assert.ok(out.passthrough.includes("#BMP01: images/back.png"));
  assert.ok(out.passthrough.includes("#BMPTEX02: charts/local.png"));
  assert.ok(out.passthrough.includes("#AVI01: movies/movie.webm"));
  assert.ok(out.passthrough.includes("#PREIMAGE: images/jacket.png"));
  assert.ok(out.passthrough.includes("#BGA01: 01 0 0 64 64 0 0"));
  assert.equal(source.resources["01"].file, "../sounds/kick.wav");
  assert.doesNotThrow(() =>
    validateProjectManifest({ version: 1, project: out }),
  );
});
test("pack-relative resolution accepts bounded parent segments but rejects escaping, schemes and absolute paths", async () => {
  const { resolveImportedAssetPath, rebaseImportedChart } =
    await import("../src/import-export");
  assert.equal(
    resolveImportedAssetPath("..\\sounds\\kick.wav", "charts/easy.dtx"),
    "sounds/kick.wav",
  );
  assert.equal(
    resolveImportedAssetPath("../../sounds/kick.wav", "songs/charts/easy.dtx"),
    "sounds/kick.wav",
  );
  for (const path of [
    "../../sounds/kick.wav",
    "/sounds/kick.wav",
    "C:\\sounds\\kick.wav",
    "https://example.com/x.wav",
    "../..",
  ])
    assert.throws(() => resolveImportedAssetPath(path, "charts/easy.dtx"));
  const p = manifest().project;
  p.resources["01"].file = "../../escape.wav";
  assert.throws(() => rebaseImportedChart(p, "charts/easy.dtx"));
  const files = [file("sounds/kick.wav", "A")];
  assert.equal(
    resolveChartAsset(files, "../sounds/kick.wav", "charts/easy.dtx")?.path,
    "sounds/kick.wav",
  );
});
test("protected nested chart retains exact original and fingerprint, with explicit validation scope", async () => {
  const { rebaseImportedChart } = await import("../src/import-export");
  const raw =
    "#RANDOM 2\n#TITLE: Protected nested\n#BPM: 120\n#WAV01: ../sounds/kick.wav\n#BMP01: ../images/back.png\n#00011: 01\n";
  const p = parseDTX(raw),
    out = rebaseImportedChart(p, "charts/easy.dtx");
  assert.deepEqual(out, p);
  assert.equal(serializeDTX(out), raw);
  assert.throws(() => validateProjectManifest({ version: 1, project: out }));
  const validated = validateProjectManifest(
    { version: 1, project: out },
    { chartPath: "charts/easy.dtx" },
  );
  assert.equal(serializeDTX(validated.project), raw);
  assert.equal(validated.project.resources["01"].file, "../sounds/kick.wav");
});
test("protected nested project ZIP retains chart path and reloads sibling resources without rebasing", async () => {
  const { rebaseImportedChart } = await import("../src/import-export");
  const raw =
    "#RANDOM 2\n#TITLE: Protected pack\n#BPM: 120\n#WAV01: ../sounds/kick.wav\n#BMP01: ../images/back.png\n#00011: 01\n";
  const project = rebaseImportedChart(parseDTX(raw), "charts/easy.dtx");
  const saved = validateProjectManifest({
    version: 1,
    project,
    chartPath: "charts/easy.dtx",
    referenceBgmId: "01",
  });
  const bytes = zipSync({
    "project.json": strToU8(JSON.stringify(saved)),
    "charts/easy.dtx": strToU8(raw),
    "sounds/kick.wav": strToU8("audio"),
    "images/back.png": strToU8("image"),
  });
  const pack = safeUnzip(bytes),
    reloaded = validateProjectManifest(
      JSON.parse(new TextDecoder().decode(pack["project.json"])),
    );
  assert.equal(reloaded.chartPath, "charts/easy.dtx");
  assert.equal(reloaded.project.resources["01"].file, "../sounds/kick.wav");
  assert.equal(reloaded.referenceBgmId, "01");
  assert.equal(serializeDTX(reloaded.project), raw);
  assert.equal(new TextDecoder().decode(pack[reloaded.chartPath]), raw);
  assert.equal(
    resolveChartAsset(
      [file("sounds/kick.wav", "audio")],
      reloaded.project.resources["01"].file,
      reloaded.chartPath,
    )?.path,
    "sounds/kick.wav",
  );
});
test("manifest chart path is safe, optional, normalized and explicitly overridable", () => {
  assert.equal(validateProjectManifest(manifest()).chartPath, "");
  assert.equal(
    validateProjectManifest({ ...manifest(), chartPath: "charts\\easy.dtx" })
      .chartPath,
    "charts/easy.dtx",
  );
  assert.equal(
    validateProjectManifest(
      { ...manifest(), chartPath: "charts/easy.dtx" },
      { chartPath: "other/hard.dtx" },
    ).chartPath,
    "other/hard.dtx",
  );
  for (const chartPath of [
    "../escape.dtx",
    "/tmp/chart.dtx",
    "https://example.com/chart.dtx",
    42,
    null,
  ])
    assert.throws(() => validateProjectManifest({ ...manifest(), chartPath }));
  const project = parseDTX(
    "#RANDOM 2\n#BPM: 120\n#WAV01: ../sounds/kick.wav\n",
  );
  assert.throws(() =>
    validateProjectManifest(
      { version: 1, project, chartPath: "charts/easy.dtx" },
      { chartPath: "" },
    ),
  );
});
test('handcrafted note arrays cannot smuggle structural DTX channels',()=>{for(const channel of ['00','02','03','08']){const m=manifest();m.project.notes[0].channel=channel;assert.throws(()=>validateProjectManifest(m),/structural channels/);}const m=manifest();m.project.tempos=[{id:'tempo-valid',beat:0,bpm:120,channel:'03',value:'78'}];assert.doesNotThrow(()=>validateProjectManifest(m));});
