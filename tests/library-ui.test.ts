import test from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_PREFIX,
  isLibraryRecord,
  validateSoundCollection,
  selectCollectionResources,
  collectionMatches,
} from "../src/library-ui.ts";
import type { ImportedFile } from "../src/storage.ts";
const file = (path: string, content = "audio"): ImportedFile => ({
  path,
  name: path.split("/").at(-1)!,
  blob: new Blob([content]),
  hash: "untrusted-hash",
  size: 999,
  type: "audio/wav",
});
const files = () => [
  file("drums/kick.wav"),
  file("drums/snare.wav"),
  file("LICENSE.txt", "reuse requires attribution"),
  file("README.md", "source details"),
];
const data = () => ({
  kind: "sound-library",
  version: 1,
  name: "Jazz kit",
  sourceTitle: "My song",
  tags: ["jazz", "brush", "jazz"],
  categories: ["acoustic"],
  resources: [
    { id: "01", file: "drums/kick.wav", volume: 90, pan: -20 },
    { id: "02", file: "drums/snare.wav", label: "Soft snare" },
  ],
});
test("sound library validation projects only safe resource metadata and preserves all original files", () => {
  const result = validateSoundCollection(
    {
      ...data(),
      apiKey: "secret",
      settings: { key: "secret" },
      project: { credentials: "secret" },
    },
    files(),
  );
  assert.equal(result.name, "Jazz kit");
  assert.deepEqual(result.tags, ["jazz", "brush"]);
  assert.equal("apiKey" in result, false);
  assert.equal("settings" in result, false);
  assert.equal(result.files.length, 4);
  assert.equal(result.files[0].size, result.files[0].blob.size);
  assert.equal(result.resources[1].label, "Soft snare");
});
test("subset import keeps every license/readme file and leaves library unchanged", () => {
  const collection = validateSoundCollection(data(), files()),
    selection = selectCollectionResources(collection, ["02"]);
  assert.deepEqual(
    selection.resources.map((r) => r.id),
    ["02"],
  );
  assert.deepEqual(
    selection.files.map((f) => f.path),
    collection.files.map((f) => f.path),
  );
  assert.equal(collection.resources.length, 2);
  selection.resources[0].file = "other.wav";
  assert.equal(collection.resources[1].file, "drums/snare.wav");
  assert.throws(() => selectCollectionResources(collection, []));
  assert.throws(() => selectCollectionResources(collection, ["03"]));
  assert.throws(() => selectCollectionResources(collection, ["01", "01"]));
});
test("sound collection rejects missing resources, invalid IDs, numeric injection and conflicting paths", () => {
  assert.throws(() =>
    validateSoundCollection(
      { ...data(), resources: [{ id: "01", file: "missing.wav" }] },
      files(),
    ),
  );
  for (const id of ["00", "001", "?!"])
    assert.throws(() =>
      validateSoundCollection(
        { ...data(), resources: [{ id, file: "drums/kick.wav" }] },
        files(),
      ),
    );
  assert.throws(() =>
    validateSoundCollection(
      {
        ...data(),
        resources: [{ id: "01", file: "drums/kick.wav", volume: Infinity }],
      },
      files(),
    ),
  );
  assert.throws(() =>
    validateSoundCollection(
      {
        ...data(),
        resources: [{ id: "01", file: "drums/kick.wav", pan: -101 }],
      },
      files(),
    ),
  );
  assert.throws(() =>
    validateSoundCollection(data(), [...files(), file("DRUMS/KICK.WAV")]),
  );
});
test("sound collection refuses external/traversal file paths and unsupported serialized objects", () => {
  for (const path of [
    "../kick.wav",
    "https://example.com/kick.wav",
    "/kick.wav",
    "bad;name.wav",
  ])
    assert.throws(() =>
      validateSoundCollection(
        { ...data(), resources: [{ id: "01", file: path }] },
        [file(path)],
      ),
    );
  assert.throws(() =>
    validateSoundCollection({ ...data(), version: 2 }, files()),
  );
  assert.throws(() =>
    validateSoundCollection({ ...data(), name: "" }, files()),
  );
  assert.throws(() =>
    validateSoundCollection(
      { ...data(), tags: new Array(41).fill("tag") },
      files(),
    ),
  );
  assert.throws(() =>
    validateSoundCollection(Object.create({ kind: "sound-library" }), files()),
  );
});
test("cross-project collection filtering searches name, source, tags, categories and labels", () => {
  const collection = validateSoundCollection(data(), files());
  assert.equal(collectionMatches(collection, "JAZZ acoustic"), true);
  assert.equal(collectionMatches(collection, "soft snare"), true);
  assert.equal(collectionMatches(collection, "my song"), true);
  assert.equal(collectionMatches(collection, "electronic"), false);
  assert.equal(isLibraryRecord({ name: LIBRARY_PREFIX + "Jazz kit" }), true);
  assert.equal(isLibraryRecord({ name: "Jazz kit" }), false);
});
